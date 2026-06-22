/**
 * OCR Data Migration CLI
 * Usage: tsx scripts/ocr_run_job.ts --params-file {json}
 * 1단계 PaddleOCR → 2단계 GPT-4o Vision (이미지 + Paddle 참조 텍스트)
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import iconv from 'iconv-lite';
import { sql } from 'drizzle-orm';
import { db, pool, closePool } from '@/database/db';

const OCR_ROOT_REL = 'OCR';
const FILE_DATA_REL = 'file_data';
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;
const PARCEL_ADDRESS_COL = 'parcel_address';

type OcrParams = {
  jobName: string;
  tableName: string;
  documentType: string;
  extractFields: string;
  jijukFields: string;
  jijukSuffix: string;
  openaiApiKey: string;
};

type GptOcrResult = {
  pageTitle?: string;
  isPrimaryDocument?: boolean;
  suggestedFileName?: string;
  fields?: Record<string, string>;
  jijukItems?: string[];
};

type PaddleOcrLine = {
  text: string;
  score: number;
  box?: number[][];
  centerY?: number;
  centerX?: number;
};

type PaddleMergedRow = {
  text: string;
  score: number;
  centerY?: number;
  centerX?: number;
};

type PaddleOcrResult = {
  fullText: string;
  lines: PaddleOcrLine[];
  mergedRows?: PaddleMergedRow[];
  imageWidth: number;
  imageHeight: number;
};

type ProcessFailure = { file: string; error: string };

const PADDLE_SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'ocr_paddle_extract.py');
const PADDLE_EXTRACT_TIMEOUT_MS = 3 * 60 * 1000;

function logProgress(msg: string): void {
  process.stderr.write(`[ocr] ${msg}\n`);
}

function getBaseDir(): string {
  return path.normalize(process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir');
}

function parseParamsFile(): OcrParams {
  const idx = process.argv.indexOf('--params-file');
  const filePath = idx >= 0 ? String(process.argv[idx + 1] ?? '').trim() : '';
  if (!filePath) throw new Error('--params-file 가 필요합니다.');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as OcrParams;
  if (!parsed.jobName || !parsed.tableName || !parsed.openaiApiKey) {
    throw new Error('params-file 내용이 올바르지 않습니다.');
  }
  return parsed;
}

function safeTableName(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'ocr_table';
  return s.toLowerCase();
}

function safeJijukSuffix(suffix: string): string {
  const s = suffix.replace(/[^a-zA-Z0-9_]/g, '_');
  return s.startsWith('_') ? s : `_${s}`;
}

function escapePostgresStringLiteral(text: string): string {
  return String(text ?? '').replace(/'/g, "''");
}

function parseFieldList(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

function isPrimaryDocument(pageTitle: string, documentType: string, gptFlag: boolean): boolean {
  if (!gptFlag) return false;
  const pt = normalizeTitle(pageTitle);
  const dt = normalizeTitle(documentType);
  if (!pt || !dt) return gptFlag;
  return pt.includes(dt) || dt.includes(pt);
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function getImageGroupKey(rel: string): string {
  const dir = path.posix.dirname(rel.replace(/\\/g, '/'));
  return dir === '.' ? '' : dir;
}

function extractPageNumber(rel: string): number {
  const base = path.posix.basename(rel.replace(/\\/g, '/'));
  const pageMatch = base.match(/page[-_]?(\d+)/i);
  if (pageMatch) return Number.parseInt(pageMatch[1]!, 10);
  const numMatch = base.match(/(\d+)/);
  return numMatch ? Number.parseInt(numMatch[1]!, 10) : Number.MAX_SAFE_INTEGER;
}

function groupImagesByFolder(images: { abs: string; rel: string }[]): Map<string, { abs: string; rel: string }[]> {
  const groups = new Map<string, { abs: string; rel: string }[]>();
  for (const image of images) {
    const key = getImageGroupKey(image.rel);
    const list = groups.get(key) ?? [];
    list.push(image);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const pageDiff = extractPageNumber(a.rel) - extractPageNumber(b.rel);
      if (pageDiff !== 0) return pageDiff;
      return naturalCompare(a.rel, b.rel);
    });
  }
  return groups;
}

async function collectImages(dirAbs: string, baseAbs: string): Promise<{ abs: string; rel: string }[]> {
  const out: { abs: string; rel: string }[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectImages(full, baseAbs)));
    } else if (entry.isFile() && IMAGE_EXT.test(entry.name)) {
      out.push({ abs: full, rel: path.relative(baseAbs, full).replace(/\\/g, '/') });
    }
  }
  return out;
}

function sanitizeFileName(name: string): string {
  const trimmed = String(name ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return trimmed || 'document';
}

function decodeChildOutput(buf: Buffer, usedCmdShell: boolean): string {
  if (!buf.length) return '';
  if (usedCmdShell && process.platform === 'win32') {
    return iconv.decode(buf, 'cp949');
  }
  return buf.toString('utf8');
}

function resolvePythonRun(): { cmd: string; argsPrefix: string[]; usedCmdShell: boolean } {
  const root = process.cwd();
  const pyEnv = (process.env.GGNR_PIPELINE_PYTHON ?? '').trim();
  if (pyEnv && pyEnv !== 'python') {
    const envDir = path.dirname(path.resolve(root, pyEnv));
    return {
      cmd: 'conda',
      argsPrefix: ['run', '--no-capture-output', '--prefix', envDir, 'python'],
      usedCmdShell: false,
    };
  }
  const py = process.platform === 'win32' ? 'python' : 'python3';
  return { cmd: py, argsPrefix: [], usedCmdShell: false };
}

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  childEnv: NodeJS.ProcessEnv,
  usedCmdShell: boolean
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: childEnv,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    if (child.stdout) child.stdout.on('data', (d) => stdoutChunks.push(Buffer.from(d)));
    if (child.stderr) child.stderr.on('data', (d) => stderrChunks.push(Buffer.from(d)));
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      const stdout = decodeChildOutput(Buffer.concat(stdoutChunks), usedCmdShell);
      const stderr = decodeChildOutput(Buffer.concat(stderrChunks), usedCmdShell);
      resolve({ code: -1, stdout, stderr: `${stderr}\n[타임아웃 ${timeoutMs}ms]`.trim() });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        code: code ?? -1,
        stdout: decodeChildOutput(Buffer.concat(stdoutChunks), usedCmdShell),
        stderr: decodeChildOutput(Buffer.concat(stderrChunks), usedCmdShell),
      });
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function parsePaddleStdout(stdout: string): PaddleOcrResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as PaddleOcrResult & { error?: string };
      if (parsed?.error) throw new Error(parsed.error);
      if (typeof parsed.fullText === 'string' && Array.isArray(parsed.lines)) {
        return {
          fullText: parsed.fullText,
          lines: parsed.lines,
          mergedRows: Array.isArray(parsed.mergedRows) ? parsed.mergedRows : undefined,
          imageWidth: Number(parsed.imageWidth ?? 0),
          imageHeight: Number(parsed.imageHeight ?? 0),
        };
      }
    } catch (err) {
      if (err instanceof Error && err.message !== 'Unexpected token') throw err;
    }
  }
  throw new Error('PaddleOCR 결과 JSON을 읽지 못했습니다.');
}

async function runPaddleExtract(imageAbs: string): Promise<PaddleOcrResult> {
  const { cmd, argsPrefix, usedCmdShell } = resolvePythonRun();
  const args = [...argsPrefix, PADDLE_SCRIPT_PATH, '--image', imageAbs];
  const modelDir = (process.env.PADDLEOCR_MODEL_DIR ?? '').trim();
  if (modelDir) args.push('--model-dir', modelDir);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GGNR_PROJECT_ROOT: process.cwd(),
  };
  const proc = await runProcess(cmd, args, process.cwd(), PADDLE_EXTRACT_TIMEOUT_MS, childEnv, usedCmdShell);
  if (proc.code !== 0) {
    const detail = [proc.stderr.trim(), proc.stdout.trim()].filter(Boolean).join('\n').slice(0, 500);
    throw new Error(detail || 'PaddleOCR 실행 실패');
  }
  return parsePaddleStdout(proc.stdout);
}

function formatLinesForGpt(ocr: PaddleOcrResult): string {
  const rows = ocr.mergedRows?.length ? ocr.mergedRows : ocr.lines;
  if (!rows.length) return '(없음)';
  return rows
    .map((line) => {
      const y = Math.round(line.centerY ?? 0);
      const x = Math.round(line.centerX ?? 0);
      const score = line.score != null ? line.score.toFixed(2) : '?';
      return `- [y=${y}, x=${x}, score=${score}] ${line.text}`;
    })
    .join('\n');
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  if (e === '.bmp') return 'image/bmp';
  if (e === '.tif' || e === '.tiff') return 'image/tiff';
  return 'image/jpeg';
}

async function imageToBase64DataUrl(imageAbs: string): Promise<string> {
  const buf = await fsPromises.readFile(imageAbs);
  const mime = mimeFromExt(path.extname(imageAbs));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function buildGptPrompt(
  params: {
    documentType: string;
    extractFields: string[];
    jijukFields: string[];
  },
  ocr: PaddleOcrResult
): string {
  const fieldList = params.extractFields.join(', ');
  const jijukList = params.jijukFields.join(', ');
  const linesBlock = formatLinesForGpt(ocr);
  return `당신은 한국 행정 문서 OCR 전문가입니다. 첨부 이미지와 PaddleOCR 참조 텍스트를 함께 보고 필드를 추출하세요.

주요 문서 유형: "${params.documentType}"
추출할 필드: ${fieldList}
${jijukList ? `다음 필드는 복수 필지로 분리: ${jijukList}` : ''}

판단 우선순위:
1. 이미지가 최우선: 레이아웃, 줄바꿈, 표 구조, 손글씨(포스트잇·메모 등)는 이미지를 그대로 반영하세요. 손글씨를 제거하거나 무시하지 마세요.
2. PaddleOCR은 인쇄체 문자 보정용 참고: 인쇄된 필드명·값에서 OCR 오인식(예: 상하지골→상하지필)만 Paddle 텍스트로 교정하세요.
3. Paddle 텍스트만으로 문장을 재조합하지 마세요. 이미지에 보이는 내용만 사용하고 추측·의역하지 마세요.
4. "${params.documentType}" 본문이면 isPrimaryDocument=true, 첨부·부속·다른 문서면 false.

규칙:
- pageTitle: 문서 제목(이미지 상단 제목).
- suggestedFileName: 짧은 한글 파일명(확장자 제외, 40자 이내).
- fields: 추출 필드명을 키로 값. 없으면 빈 문자열.
- jijukItems: jijuk 대상 필지/주소 배열. 없으면 [].

--- PaddleOCR 참조 fullText (인쇄체 보정용) ---
${ocr.fullText}

--- PaddleOCR 참조 lines (y/x 정렬) ---
${linesBlock}

JSON만 반환:
{
  "pageTitle": "...",
  "isPrimaryDocument": true,
  "suggestedFileName": "...",
  "fields": { ${params.extractFields.map((f) => `"${f}": ""`).join(', ')} },
  "jijukItems": []
}`;
}

async function callGptVisionWithPaddle(
  apiKey: string,
  imageDataUrl: string,
  prompt: string
): Promise<GptOcrResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `OpenAI API 오류 (${res.status})`);
  }
  const content = String(json?.choices?.[0]?.message?.content ?? '').trim();
  if (!content) throw new Error('GPT Vision 응답이 비어 있습니다.');
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]!.trim() : content;
  return JSON.parse(body) as GptOcrResult;
}

async function gptSplitParcels(apiKey: string, rawText: string): Promise<string[]> {
  const text = String(rawText ?? '').trim();
  if (!text) return [];
  const prompt = `다음은 토지소재지 등 복수 필지가 한 문자열에 적힌 텍스트입니다.
콤마/줄바꿈/세미콜론/외 N필지 등을 개별 지번·주소 문자열 배열로 분리하세요.
모르는 정보는 추정하지 마세요. 빈값 제외.
JSON만: { "parcels": ["...", "..."] }

입력:
${text}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) return text.split(/[,，、;；\n]+/).map((s) => s.trim()).filter(Boolean);
  const content = String(json?.choices?.[0]?.message?.content ?? '');
  try {
    const parsed = JSON.parse(content) as { parcels?: unknown[] };
    const arr = Array.isArray(parsed.parcels) ? parsed.parcels.map((x) => String(x).trim()).filter(Boolean) : [];
    return arr.length > 0 ? arr : [text];
  } catch {
    return [text];
  }
}

async function ensureOcrTables(
  tableName: string,
  fieldLabels: string[],
  jijukTableName: string | null,
  jijukSuffix: string
): Promise<{ colMap: Record<string, string> }> {
  const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
  const colMap: Record<string, string> = {};
  const createParts = [
    'id SERIAL PRIMARY KEY',
    'ocr_key text UNIQUE NOT NULL',
    'page_title text',
    'source_image text',
  ];
  fieldLabels.forEach((label, idx) => {
    const col = `col_${String(idx + 1).padStart(3, '0')}`;
    colMap[label] = col;
    createParts.push(`${col} text`);
  });
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS layer.${quotedTable} (${createParts.join(', ')})`)
  );
  const fqTable = `layer.${quotedTable}`;
  const setComment = async (col: string, kor: string) => {
    const body = escapePostgresStringLiteral(kor);
    await db.execute(sql.raw(`COMMENT ON COLUMN ${fqTable}.${col} IS '${body}'`));
  };
  await setComment('id', 'id');
  await setComment('ocr_key', 'OCR 행 키');
  await setComment('page_title', '페이지 제목');
  await setComment('source_image', '원본 이미지 경로');
  for (const label of fieldLabels) {
    await setComment(colMap[label]!, label);
  }

  if (jijukTableName) {
    const quotedJijuk = `"${jijukTableName.replace(/"/g, '""')}"`;
    await db.execute(
      sql.raw(`CREATE TABLE IF NOT EXISTS layer.${quotedJijuk} (
        id SERIAL PRIMARY KEY,
        parent_id integer NOT NULL REFERENCES layer.${quotedTable}(id) ON DELETE CASCADE,
        field_name text,
        ${PARCEL_ADDRESS_COL} text
      )`)
    );
    const fqJijuk = `layer.${quotedJijuk}`;
    const jc = escapePostgresStringLiteral(`${tableName}${jijukSuffix} 필지`);
    await db.execute(sql.raw(`COMMENT ON TABLE ${fqJijuk} IS '${jc}'`));
  }
  return { colMap };
}

async function copyToFileData(
  srcAbs: string,
  tableName: string,
  ocrKey: string,
  suggestedFileName: string
): Promise<string> {
  const destDir = path.join(getBaseDir(), FILE_DATA_REL, tableName, ocrKey);
  await fsPromises.mkdir(destDir, { recursive: true });
  const ext = path.extname(srcAbs) || '.jpg';
  let baseName = sanitizeFileName(suggestedFileName);
  let destAbs = path.join(destDir, `${baseName}${ext}`);
  let seq = 1;
  while (fs.existsSync(destAbs)) {
    destAbs = path.join(destDir, `${baseName}_${seq}${ext}`);
    seq += 1;
  }
  await fsPromises.copyFile(srcAbs, destAbs);
  return path.relative(getBaseDir(), destAbs).replace(/\\/g, '/');
}

async function insertPrimaryRow(
  tableName: string,
  ocrKey: string,
  pageTitle: string,
  sourceImage: string,
  colMap: Record<string, string>,
  fields: Record<string, string>
): Promise<number> {
  const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
  const cols = ['ocr_key', 'page_title', 'source_image', ...Object.values(colMap)];
  const vals: string[] = [
    `'${escapePostgresStringLiteral(ocrKey)}'`,
    `'${escapePostgresStringLiteral(pageTitle)}'`,
    `'${escapePostgresStringLiteral(sourceImage)}'`,
  ];
  for (const label of Object.keys(colMap)) {
    const v = String(fields[label] ?? '').trim();
    vals.push(`'${escapePostgresStringLiteral(v)}'`);
  }
  const insertSql = `INSERT INTO layer.${quotedTable} (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id`;
  const result = await pool.query(insertSql);
  const id = (result.rows[0] as { id?: number } | undefined)?.id;
  if (typeof id !== 'number') throw new Error('행 삽입 후 id를 받지 못했습니다.');
  return id;
}

async function insertJijukRows(
  jijukTableName: string,
  parentId: number,
  fieldName: string,
  parcels: string[]
): Promise<void> {
  if (!parcels.length) return;
  const quotedJijuk = `"${jijukTableName.replace(/"/g, '""')}"`;
  for (const parcel of parcels) {
    const p = escapePostgresStringLiteral(parcel);
    const fn = escapePostgresStringLiteral(fieldName);
    await db.execute(
      sql.raw(
        `INSERT INTO layer.${quotedJijuk} (parent_id, field_name, ${PARCEL_ADDRESS_COL}) VALUES (${parentId}, '${fn}', '${p}')`
      )
    );
  }
}

async function main(): Promise<void> {
  const params = parseParamsFile();
  const tableName = safeTableName(params.tableName);
  const jijukSuffix = safeJijukSuffix(params.jijukSuffix || '_jijuk');
  const jijukTableName = params.jijukFields.trim() ? safeTableName(`${tableName}${jijukSuffix}`) : null;
  const extractFieldList = parseFieldList(params.extractFields);
  const jijukFieldList = parseFieldList(params.jijukFields);

  const jobDir = path.join(getBaseDir(), OCR_ROOT_REL, params.jobName);
  const allImages = await collectImages(jobDir, jobDir);

  if (!allImages.length) {
    throw new Error('처리할 이미지가 없습니다.');
  }

  const imageGroups = groupImagesByFolder(allImages);
  const sortedGroupKeys = [...imageGroups.keys()].sort((a, b) => naturalCompare(a, b));
  const totalImages = allImages.length;

  logProgress(
    `작업 시작: ${params.jobName}, 이미지 ${totalImages}장(${sortedGroupKeys.length}그룹), 테이블 layer.${tableName}`
  );

  const { colMap } = await ensureOcrTables(tableName, extractFieldList, jijukTableName, jijukSuffix);

  let primarySeq = 0;
  let processedCount = 0;
  let primaryRowCount = 0;
  let attachmentCount = 0;
  let skippedCount = 0;
  const failures: ProcessFailure[] = [];

  for (const groupKey of sortedGroupKeys) {
    const groupImages = imageGroups.get(groupKey)!;
    let lastPrimaryKey: string | null = null;
    logProgress(`그룹 시작: ${groupKey || '(루트)'} (${groupImages.length}장)`);

    for (const image of groupImages) {
      processedCount += 1;
      logProgress(`[${processedCount}/${totalImages}] ${image.rel}`);
      try {
        const paddle = await runPaddleExtract(image.abs);
        if (!paddle.fullText.trim() && !paddle.lines.length) {
          throw new Error('PaddleOCR 텍스트가 비어 있습니다.');
        }
        const gptPrompt = buildGptPrompt(
          {
            documentType: params.documentType,
            extractFields: extractFieldList,
            jijukFields: jijukFieldList,
          },
          paddle
        );
        const imageDataUrl = await imageToBase64DataUrl(image.abs);
        const gpt = await callGptVisionWithPaddle(params.openaiApiKey, imageDataUrl, gptPrompt);
        const pageTitle = String(gpt.pageTitle ?? '').trim();
        const rawFileName =
          gpt.suggestedFileName ?? (pageTitle || path.basename(image.rel, path.extname(image.rel)));
        const suggestedFileName = sanitizeFileName(String(rawFileName));
        const fields = gpt.fields ?? {};
        const primary = isPrimaryDocument(pageTitle, params.documentType, gpt.isPrimaryDocument === true);

        if (primary) {
          primarySeq += 1;
          const ocrKey = `${tableName}_${String(primarySeq).padStart(4, '0')}`;
          const storedRel = await copyToFileData(image.abs, tableName, ocrKey, suggestedFileName);
          const parentId = await insertPrimaryRow(
            tableName,
            ocrKey,
            pageTitle,
            storedRel,
            colMap,
            fields
          );
          lastPrimaryKey = ocrKey;
          primaryRowCount += 1;

          if (jijukTableName && jijukFieldList.length > 0) {
            for (const jf of jijukFieldList) {
              const raw = String(fields[jf] ?? '').trim();
              let parcels = Array.isArray(gpt.jijukItems)
                ? gpt.jijukItems.map((x) => String(x).trim()).filter(Boolean)
                : [];
              if (!parcels.length && raw) {
                parcels = await gptSplitParcels(params.openaiApiKey, raw);
              }
              await insertJijukRows(jijukTableName, parentId, jf, parcels);
            }
          }
        } else if (lastPrimaryKey) {
          await copyToFileData(image.abs, tableName, lastPrimaryKey, suggestedFileName);
          attachmentCount += 1;
        } else {
          skippedCount += 1;
          logProgress(`  건너뜀 (그룹 내 선행 ${params.documentType} 없음): ${image.rel}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({ file: image.rel, error: msg });
        logProgress(`  오류: ${msg}`);
      }
    }
  }

  const message =
    failures.length > 0
      ? `OCR 완료 (일부 실패 ${failures.length}건). 본문 ${primaryRowCount}행, 첨부 ${attachmentCount}건`
      : `OCR 완료. 본문 ${primaryRowCount}행, 첨부 ${attachmentCount}건, 건너뜀 ${skippedCount}건`;

  console.log(
    JSON.stringify({
      success: failures.length === 0 || primaryRowCount > 0,
      message,
      jobName: params.jobName,
      tableName,
      processedCount,
      primaryRowCount,
      attachmentCount,
      skippedCount,
      failures,
    })
  );
}

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      JSON.stringify({
        success: false,
        message: msg,
        processedCount: 0,
        primaryRowCount: 0,
        attachmentCount: 0,
        skippedCount: 0,
        failures: [{ file: '-', error: msg }],
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
