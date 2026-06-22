/**
 * OCR Data Migration
 * - 입력: OCR/{작업명}/*.jpg (하위 폴더 포함)
 * - 출력: layer.{tableName} 테이블 + file_data/{tableName}/{ocr_key}/파일
 * - PaddleOCR(로컬) + GPT 텍스트 구조화 (scripts/ocr_run_job.ts CLI)
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import iconv from 'iconv-lite';
import { appendUploadConvertHistory } from './fileManagerService';
import { getMapConfig } from './configService';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const OCR_ROOT_REL = GGNR_DATA_PATHS.ocr;
const OCR_RUN_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const OCR_SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'ocr_run_job.ts');
const TSX_CLI_PATH = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

export type OcrJobRow = {
  jobName: string;
  imageCount: number;
  modified?: string;
};

export type OcrRunParams = {
  jobName: string;
  tableName: string;
  documentType: string;
  extractFields: string;
  jijukFields: string;
  jijukSuffix: string;
};

function getBaseDir(): string {
  return path.normalize(GGNR_DATA_DIR);
}

function assertSafeJobName(jobName: string): string {
  const trimmed = String(jobName ?? '').trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new Error('작업명이 올바르지 않습니다.');
  }
  if (/[\\/]/.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) {
    throw new Error('작업명이 올바르지 않습니다.');
  }
  return trimmed;
}

function assertSafeTableName(tableName: string): string {
  const s = String(tableName ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!s) throw new Error('테이블명이 올바르지 않습니다.');
  return s;
}

function getOcrRootAbs(): string {
  return path.join(getBaseDir(), ...OCR_ROOT_REL.split('/'));
}

function jobRelative(jobName: string): string {
  return `${OCR_ROOT_REL}/${assertSafeJobName(jobName)}`.replace(/\\/g, '/');
}

async function countImagesRecursive(dirAbs: string): Promise<number> {
  let count = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      count += await countImagesRecursive(full);
    } else if (entry.isFile() && IMAGE_EXT.test(entry.name)) {
      count += 1;
    }
  }
  return count;
}

function decodeChildOutput(buf: Buffer, usedCmdShell: boolean): string {
  if (!buf.length) return '';
  if (usedCmdShell && process.platform === 'win32') {
    return iconv.decode(buf, 'cp949');
  }
  return buf.toString('utf8');
}

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  childEnv: NodeJS.ProcessEnv = process.env
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const exeLooksResolved =
      path.isAbsolute(cmd) || (isWin && /^[A-Za-z]:[\\/]/.test(cmd)) || cmd.includes(path.sep);
    const usedCmdShell = isWin && !exeLooksResolved;
    const child = usedCmdShell
      ? spawn('cmd.exe', ['/c', cmd, ...args], {
          cwd,
          windowsHide: true,
          shell: false,
          env: childEnv,
        })
      : spawn(cmd, args, {
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
      const stdout = decodeChildOutput(Buffer.concat(stdoutChunks), usedCmdShell);
      const stderr = decodeChildOutput(Buffer.concat(stderrChunks), usedCmdShell);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function parseOcrScriptResult(stdout: string): {
  success: boolean;
  message: string;
  jobName: string;
  processedCount: number;
  primaryRowCount: number;
  attachmentCount: number;
  skippedCount: number;
  failures: { file: string; error: string }[];
} {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]!) as {
        success?: boolean;
        message?: string;
        jobName?: string;
        processedCount?: number;
        primaryRowCount?: number;
        attachmentCount?: number;
        skippedCount?: number;
        failures?: { file: string; error: string }[];
      };
      if (parsed && typeof parsed === 'object' && 'processedCount' in parsed) {
        return {
          success: Boolean(parsed.success),
          message: String(parsed.message ?? 'OCR 완료'),
          jobName: String(parsed.jobName ?? ''),
          processedCount: Number(parsed.processedCount ?? 0),
          primaryRowCount: Number(parsed.primaryRowCount ?? 0),
          attachmentCount: Number(parsed.attachmentCount ?? 0),
          skippedCount: Number(parsed.skippedCount ?? 0),
          failures: Array.isArray(parsed.failures) ? parsed.failures : [],
        };
      }
    } catch {
      // continue
    }
  }
  throw new Error('OCR 결과를 읽지 못했습니다.');
}

async function buildJobRow(jobName: string): Promise<OcrJobRow> {
  const safeJob = assertSafeJobName(jobName);
  const jobDir = path.join(getOcrRootAbs(), safeJob);
  const imageCount = await countImagesRecursive(jobDir);
  const stat = await fsPromises.stat(jobDir).catch(() => null);
  return {
    jobName: safeJob,
    imageCount,
    modified: stat?.mtime?.toISOString(),
  };
}

export async function listOcrJobs(params?: {
  limit?: number;
}): Promise<{ rows: OcrJobRow[]; rootRelative: string }> {
  await fsPromises.mkdir(getOcrRootAbs(), { recursive: true });
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(getOcrRootAbs(), { withFileTypes: true });
  } catch {
    return { rows: [], rootRelative: OCR_ROOT_REL };
  }
  const jobNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  const rows = await Promise.all(jobNames.map((jobName) => buildJobRow(jobName)));
  return {
    rows: rows.slice(0, params?.limit ?? 200),
    rootRelative: OCR_ROOT_REL,
  };
}

export async function runOcrMigration(params: OcrRunParams): Promise<{
  success: boolean;
  message: string;
  jobName: string;
  processedCount: number;
  primaryRowCount: number;
  attachmentCount: number;
}> {
  const jobName = assertSafeJobName(params.jobName);
  const tableName = assertSafeTableName(params.tableName);
  const documentType = String(params.documentType ?? '').trim();
  const extractFields = String(params.extractFields ?? '').trim();
  const jijukFields = String(params.jijukFields ?? '').trim();
  const jijukSuffix = String(params.jijukSuffix ?? '_jijuk').trim() || '_jijuk';

  if (!documentType) throw new Error('문서 유형(대괄호)을 입력하세요.');
  if (!extractFields) throw new Error('추출 필드(대괄호)를 입력하세요.');

  const jobDir = path.join(getOcrRootAbs(), jobName);
  const imageCount = await countImagesRecursive(jobDir);
  if (imageCount === 0) {
    throw new Error(`OCR 작업 폴더에 이미지가 없습니다: ${jobRelative(jobName)}`);
  }

  const mapConfig = getMapConfig();
  const openaiApiKey = String(mapConfig?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? '').trim();
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  }

  const paramsPayload = {
    jobName,
    tableName,
    documentType,
    extractFields,
    jijukFields,
    jijukSuffix,
    openaiApiKey,
  };

  const paramsFile = path.join(
    os.tmpdir(),
    `ocr_params_${process.pid}_${Date.now()}.json`
  );
  await fsPromises.writeFile(paramsFile, JSON.stringify(paramsPayload), 'utf8');

  let historyStatus: '완료' | '실패' = '완료';
  let historyNote = '';
  let result: {
    success: boolean;
    message: string;
    jobName: string;
    processedCount: number;
    primaryRowCount: number;
    attachmentCount: number;
  } | null = null;

  try {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GGNR_DATA_DIR: getBaseDir(),
    };
    const proc = await runProcess(
      process.execPath,
      [TSX_CLI_PATH, OCR_SCRIPT_PATH, '--params-file', paramsFile],
      process.cwd(),
      OCR_RUN_TIMEOUT_MS,
      childEnv
    );
    await fsPromises.unlink(paramsFile).catch(() => undefined);

    if (proc.code !== 0 && proc.code !== 2) {
      const detail = [proc.stderr.trim(), proc.stdout.trim()].filter(Boolean).join('\n').slice(0, 800);
      throw new Error(detail || 'OCR CLI 실행에 실패했습니다.');
    }
    const parsed = parseOcrScriptResult(proc.stdout);
    if (parsed.failures.length > 0 && parsed.primaryRowCount === 0) {
      const failDetail = parsed.failures
        .map((f) => `${f.file}: ${f.error}`)
        .join('\n')
        .slice(0, 800);
      throw new Error(`${parsed.message}\n${failDetail}`);
    }
    result = {
      success: parsed.success,
      message: parsed.message,
      jobName: parsed.jobName,
      processedCount: parsed.processedCount,
      primaryRowCount: parsed.primaryRowCount,
      attachmentCount: parsed.attachmentCount,
    };
    historyNote = `job=${jobName}, table=${tableName}, rows=${parsed.primaryRowCount}, files=${parsed.processedCount}`;
    return result;
  } catch (err) {
    historyStatus = '실패';
    historyNote = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await fsPromises.unlink(paramsFile).catch(() => undefined);
    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: 'ocr_migration',
      sourceFile: `${imageCount} images`,
      pathOrResult: jobRelative(jobName),
      status: historyStatus,
      note: historyNote.slice(0, 200),
    }).catch((appendErr) => {
      console.error('[ocrMigrationService] appendUploadConvertHistory failed:', appendErr);
    });
  }
}
