/**
 * PDF to JPG 변환
 * - 입력: PDFToJPG/{작업명}/PDF/*.pdf
 * - 출력: PDFToJPG/{작업명}/JPG/{pdf파일명}/page-001.jpg ...
 * - 실제 변환은 Next.js 번들 밖 scripts/pdf_to_jpg_convert.ts CLI에서 수행
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import iconv from 'iconv-lite';
import { appendUploadConvertHistory } from './fileManagerService';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const PDF_ROOT_REL = GGNR_DATA_PATHS.pdfToJpg;
const PDF_INPUT_SUBDIR = 'PDF';
const JPG_OUTPUT_SUBDIR = 'JPG';
const PDF_TO_JPG_TIMEOUT_MS = 30 * 60 * 1000;
const CONVERT_SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'pdf_to_jpg_convert.ts');
const TSX_CLI_PATH = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

export type PdfToJpgJobRow = {
  jobName: string;
  pdfCount: number;
  convertedPdfCount: number;
  pendingPdfCount: number;
  totalJpgCount: number;
  modified?: string;
};

function getBaseDir(): string {
  return path.normalize(GGNR_DATA_DIR);
}

function getPdfRootAbs(): string {
  return path.join(getBaseDir(), ...PDF_ROOT_REL.split('/'));
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

function jobRelative(jobName: string): string {
  return `${PDF_ROOT_REL}/${assertSafeJobName(jobName)}`.replace(/\\/g, '/');
}

function pdfInputRelative(jobName: string): string {
  return `${jobRelative(jobName)}/${PDF_INPUT_SUBDIR}`;
}

function pdfInputAbs(jobName: string): string {
  return path.join(getPdfRootAbs(), assertSafeJobName(jobName), PDF_INPUT_SUBDIR);
}

function pdfOutputAbs(jobName: string, pdfBaseName: string): string {
  return path.join(getPdfRootAbs(), assertSafeJobName(jobName), JPG_OUTPUT_SUBDIR, pdfBaseName);
}

/** 이전 출력 구조({pdf파일명}/JPG) — 목록 집계 호환용 */
function legacyPdfOutputAbs(jobName: string, pdfBaseName: string): string {
  return path.join(getPdfRootAbs(), assertSafeJobName(jobName), pdfBaseName, JPG_OUTPUT_SUBDIR);
}

async function listPdfFilesInDir(dirAbs: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function countJpgFiles(dirAbs: string): Promise<number> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter((entry) => entry.isFile() && /\.jpe?g$/i.test(entry.name)).length;
}

async function countJpgsForPdf(jobName: string, pdfBaseName: string): Promise<number> {
  const primary = await countJpgFiles(pdfOutputAbs(jobName, pdfBaseName));
  if (primary > 0) return primary;
  return countJpgFiles(legacyPdfOutputAbs(jobName, pdfBaseName));
}

function pdfBaseName(fileName: string): string {
  return path.parse(fileName).name;
}

function decodeChildOutput(buf: Buffer, usedCmdShell: boolean): string {
  if (buf.length === 0) return '';
  if (usedCmdShell && process.platform === 'win32') {
    try {
      return iconv.decode(buf, 'cp949');
    } catch {
      return buf.toString('utf8');
    }
  }
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    try {
      return iconv.decode(buf, 'cp949');
    } catch {
      return utf8;
    }
  }
  return utf8;
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

function parseConvertScriptResult(stdout: string): {
  success: boolean;
  message: string;
  jobName: string;
  convertedPdfCount: number;
  totalJpgCount: number;
  failedPdfCount: number;
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
        convertedPdfCount?: number;
        totalJpgCount?: number;
        failedPdfCount?: number;
        failures?: { file: string; error: string }[];
      };
      if (parsed && typeof parsed === 'object' && (parsed.convertedPdfCount ?? 0) > 0) {
        return {
          success: Boolean(parsed.success),
          message: String(parsed.message ?? '변환 완료'),
          jobName: String(parsed.jobName ?? ''),
          convertedPdfCount: Number(parsed.convertedPdfCount ?? 0),
          totalJpgCount: Number(parsed.totalJpgCount ?? 0),
          failedPdfCount: Number(parsed.failedPdfCount ?? 0),
          failures: Array.isArray(parsed.failures) ? parsed.failures : [],
        };
      }
    } catch {
      // continue
    }
  }
  throw new Error('변환 결과를 읽지 못했습니다.');
}

async function buildJobRow(jobName: string): Promise<PdfToJpgJobRow> {
  const safeJob = assertSafeJobName(jobName);
  const pdfDir = pdfInputAbs(safeJob);
  const jobDir = path.join(getPdfRootAbs(), safeJob);
  const pdfFiles = await listPdfFilesInDir(pdfDir);

  let convertedPdfCount = 0;
  let totalJpgCount = 0;
  for (const pdfFile of pdfFiles) {
    const base = pdfBaseName(pdfFile);
    const jpgCount = await countJpgsForPdf(safeJob, base);
    totalJpgCount += jpgCount;
    if (jpgCount > 0) convertedPdfCount += 1;
  }

  const stats = await Promise.all([
    fsPromises.stat(jobDir).catch(() => null),
    fsPromises.stat(pdfDir).catch(() => null),
  ]);
  const latest = stats
    .map((stat) => stat?.mtime?.getTime() ?? 0)
    .reduce((max, value) => (value > max ? value : max), 0);

  return {
    jobName: safeJob,
    pdfCount: pdfFiles.length,
    convertedPdfCount,
    pendingPdfCount: Math.max(pdfFiles.length - convertedPdfCount, 0),
    totalJpgCount,
    modified: latest > 0 ? new Date(latest).toISOString() : undefined,
  };
}

export async function listPdfToJpgJobs(params?: {
  limit?: number;
}): Promise<{ rows: PdfToJpgJobRow[]; rootRelative: string }> {
  await fsPromises.mkdir(getPdfRootAbs(), { recursive: true });
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(getPdfRootAbs(), { withFileTypes: true });
  } catch {
    return { rows: [], rootRelative: PDF_ROOT_REL };
  }

  const jobNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  const rows = await Promise.all(jobNames.map((jobName) => buildJobRow(jobName)));
  return {
    rows: rows.slice(0, params?.limit ?? 200),
    rootRelative: PDF_ROOT_REL,
  };
}

export async function runPdfToJpgConversion(params: {
  jobName: string;
}): Promise<{
  success: boolean;
  message: string;
  jobName: string;
  convertedPdfCount: number;
  totalJpgCount: number;
}> {
  const jobName = assertSafeJobName(params.jobName);
  const pdfDir = pdfInputAbs(jobName);
  const pdfFiles = await listPdfFilesInDir(pdfDir);
  if (!pdfFiles.length) {
    throw new Error(`PDF 폴더가 비어 있습니다: ${pdfInputRelative(jobName)}`);
  }

  let historyStatus: '완료' | '실패' = '완료';
  let historyNote = '';
  let result: {
    success: boolean;
    message: string;
    jobName: string;
    convertedPdfCount: number;
    totalJpgCount: number;
  } | null = null;

  try {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GGNR_DATA_DIR: getBaseDir(),
    };
    const proc = await runProcess(
      process.execPath,
      [TSX_CLI_PATH, CONVERT_SCRIPT_PATH, '--job-name', jobName],
      process.cwd(),
      PDF_TO_JPG_TIMEOUT_MS,
      childEnv
    );
    if (proc.code !== 0 && proc.code !== 2) {
      const detail = [proc.stderr.trim(), proc.stdout.trim()].filter(Boolean).join('\n').slice(0, 500);
      throw new Error(detail || 'PDF to JPG 변환 CLI 실행에 실패했습니다.');
    }
    result = parseConvertScriptResult(proc.stdout);
    if (result.failedPdfCount > 0) {
      const failDetail = result.failures
        .map((f) => `${f.file}: ${f.error}`)
        .join('\n')
        .slice(0, 800);
      throw new Error(`${result.message}\n${failDetail}`);
    }
    historyNote = `job=${jobName}, pdfs=${result.convertedPdfCount}, jpgs=${result.totalJpgCount}`;
    return result;
  } catch (err) {
    historyStatus = '실패';
    historyNote = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: 'convert_pdf_to_jpg',
      sourceFile: pdfFiles.length === 1 ? pdfFiles[0]! : `${pdfFiles.length} PDF files`,
      pathOrResult: jobRelative(jobName),
      status: historyStatus,
      note: historyNote.slice(0, 200),
    }).catch((appendErr) => {
      console.error('[pdfToJpgService] appendUploadConvertHistory failed:', appendErr);
    });
  }
}
