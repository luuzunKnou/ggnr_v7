/**
 * SHP → DXF / DWG 변환
 * - 입력: SHPToDXF/{작업명}/SHP/*.shp (+ .shx .dbf, 선택 .prj .cpg)
 * - 출력: SHPToDXF/{작업명}/DXF/{파일명}.dxf
 *         캐드 선택 시 SHPToDXF/{작업명}/DWG/{파일명}.dwg (QCAD)
 * - 좌표는 재투영하지 않음. 면은 외곽선(폴리라인)으로 기록.
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import iconv from 'iconv-lite';
import { appendUploadConvertHistory } from './fileManagerService';
import { convertDxfFileToDwg, isQcadDwgConverterAvailable } from '@/lib/dwgToDxf';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const ROOT_REL = GGNR_DATA_PATHS.shpToDxf;
const SHP_INPUT_SUBDIR = 'SHP';
const DXF_OUTPUT_SUBDIR = 'DXF';
const DWG_OUTPUT_SUBDIR = 'DWG';

export type ShpCadOutputFormat = 'dxf' | 'dwg';
const PER_FILE_TIMEOUT_MS = 10 * 60 * 1000;
const REQUIRED_SIDECARS = ['.shx', '.dbf'] as const;
const SHP_COPY_EXTS = ['.shp', '.shx', '.dbf', '.prj', '.cpg', '.sbn', '.sbx'] as const;

export type ShpToDxfJobRow = {
  jobName: string;
  shpCount: number;
  dxfCount: number;
  dwgCount: number;
  pendingCount: number;
  incompleteCount: number;
  modified?: string;
};

export type ShpToDxfConvertResult = {
  success: boolean;
  message: string;
  jobName: string;
  convertedCount: number;
  failedCount: number;
  failures: { file: string; error: string }[];
};

function getBaseDir(): string {
  return path.normalize(GGNR_DATA_DIR);
}

function getRootAbs(): string {
  return path.join(getBaseDir(), ...ROOT_REL.split('/'));
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
  return `${ROOT_REL}/${assertSafeJobName(jobName)}`.replace(/\\/g, '/');
}

function shpInputAbs(jobName: string): string {
  return path.join(getRootAbs(), assertSafeJobName(jobName), SHP_INPUT_SUBDIR);
}

function dxfOutputAbs(jobName: string): string {
  return path.join(getRootAbs(), assertSafeJobName(jobName), DXF_OUTPUT_SUBDIR);
}

function dwgOutputAbs(jobName: string): string {
  return path.join(getRootAbs(), assertSafeJobName(jobName), DWG_OUTPUT_SUBDIR);
}

function normalizeOutputFormat(raw?: string | null): ShpCadOutputFormat {
  return String(raw ?? '').trim().toLowerCase() === 'dwg' ? 'dwg' : 'dxf';
}

function buildGdalEnv(envDir: string): NodeJS.ProcessEnv {
  const isWin = process.platform === 'win32';
  const shareDir = isWin ? path.join(envDir, 'Library', 'share') : path.join(envDir, 'share');
  const binDir = isWin ? path.join(envDir, 'Library', 'bin') : path.join(envDir, 'bin');
  const pluginDir = isWin
    ? path.join(envDir, 'Library', 'lib', 'gdalplugins')
    : path.join(envDir, 'lib', 'gdalplugins');
  const pathKey = isWin ? 'Path' : 'PATH';
  const existingPath = process.env[pathKey] ?? process.env.PATH ?? '';
  return {
    ...process.env,
    GDAL_DATA: path.join(shareDir, 'gdal'),
    GDAL_DRIVER_PATH: pluginDir,
    PROJ_DATA: path.join(shareDir, 'proj'),
    PROJ_LIB: path.join(shareDir, 'proj'),
    [pathKey]: `${binDir}${path.delimiter}${existingPath}`,
  };
}

function resolveOgr2ogrRun(): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } {
  const root = process.cwd();
  if (process.env.GGNR_GDAL_OGR2OGR) {
    const custom = path.resolve(root, process.env.GGNR_GDAL_OGR2OGR);
    const bin = fs.existsSync(custom) ? custom : process.env.GGNR_GDAL_OGR2OGR;
    return { cmd: bin, args: [] };
  }
  const pyEnv = process.env.GGNR_PIPELINE_PYTHON;
  if (pyEnv && pyEnv !== 'python') {
    const envDir = path.dirname(path.resolve(root, pyEnv));
    const isWin = process.platform === 'win32';
    const candidate = isWin
      ? path.join(envDir, 'Library', 'bin', 'ogr2ogr.exe')
      : path.join(envDir, 'bin', 'ogr2ogr');
    if (fs.existsSync(candidate)) {
      return { cmd: candidate, args: [], env: buildGdalEnv(envDir) };
    }
  }
  return { cmd: 'ogr2ogr', args: [] };
}

function decodeStderr(chunk: Buffer | string): string {
  const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
  if (buf.length === 0) return '';
  if (process.platform === 'win32') {
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

function runOgr2ogr(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      shell: false,
      env,
    });
    const stderrChunks: Buffer[] = [];
    const stdoutChunks: Buffer[] = [];
    if (child.stderr) {
      child.stderr.on('data', (d) => stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    }
    if (child.stdout) {
      child.stdout.on('data', (d) => stdoutChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        code: -1,
        stderr: `${decodeStderr(Buffer.concat(stderrChunks))}\n[타임아웃 ${timeoutMs}ms]`.trim(),
        stdout: decodeStderr(Buffer.concat(stdoutChunks)),
      });
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stderr: decodeStderr(Buffer.concat(stderrChunks)),
        stdout: decodeStderr(Buffer.concat(stdoutChunks)),
      });
    });
  });
}

function mapOgrError(code: number, stderr: string): string {
  const raw = stderr?.trim() || `변환 종료 코드 ${code}`;
  const notFound =
    /내부\s*또는\s*외부\s*명령|not recognized|not found|실행할 수 있는 프로그램|배치 파일이 아닙니다/i.test(raw);
  if (notFound) {
    return '변환 도구를 찾을 수 없습니다. 개발자 모드에서 파이프라인 환경을 설치하거나, 환경 변수로 실행 파일 경로를 지정하세요.';
  }
  return raw.slice(0, 500);
}

function resolveDbfEncoding(dir: string, basename: string): string {
  const cpgPath = path.join(dir, `${basename}.cpg`);
  try {
    if (!fs.existsSync(cpgPath)) return 'CP949';
    const raw = fs.readFileSync(cpgPath);
    const line =
      raw
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)[0]
        ?.trim() ?? '';
    if (!line) return 'CP949';
    const norm = line.replace(/\s+/g, '').toUpperCase().replace(/_/g, '');
    if (norm === 'UTF8' || norm === 'UTF8BIT') return 'UTF-8';
    if (norm === 'CP949' || norm === 'WINDOWS949' || norm === 'MS949') return 'CP949';
    if (norm === 'EUCKR' || norm.includes('KSC5601') || norm.includes('KS5601')) return 'EUC-KR';
    return line;
  } catch {
    return 'CP949';
  }
}

function sanitizeDxfLayerName(basename: string): string {
  const cleaned = basename.replace(/[<>/\\":;?*|=,]/g, '_').trim();
  return (cleaned || 'layer').slice(0, 255);
}

function ogrSqlLayerRef(basename: string): string {
  return `"${basename.replace(/"/g, '""')}"`;
}

function isOnlyDxfFieldCreationNoise(stderr: string): boolean {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/\[타임아웃/i.test(line));
  if (!lines.length) return true;
  return lines.every((line) => /DXF layer does not support arbitrary field creation/i.test(line));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusyFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'EAGAIN';
}

/**
 * 네트워크 공유에서 기존 파일을 바로 덮어쓰면 EBUSY가 난다.
 * 임시 이름으로 복사한 뒤 교체하고, 잠금이면 잠시 기다렸다가 다시 시도한다.
 */
async function copyReplaceWithRetry(srcAbs: string, destAbs: string): Promise<void> {
  const destDir = path.dirname(destAbs);
  await fsPromises.mkdir(destDir, { recursive: true });
  const partAbs = path.join(
    destDir,
    `${path.basename(destAbs)}.${process.pid}.${Date.now()}.part`
  );
  const delays = [0, 250, 500, 1000, 2000];
  let lastErr: unknown;
  try {
    await fsPromises.copyFile(srcAbs, partAbs);
    for (const delay of delays) {
      if (delay > 0) await sleep(delay);
      try {
        await fsPromises.rm(destAbs, { force: true });
      } catch (err) {
        lastErr = err;
        if (!isBusyFsError(err)) throw err;
        continue;
      }
      try {
        await fsPromises.rename(partAbs, destAbs);
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'EXDEV') {
          await fsPromises.copyFile(partAbs, destAbs);
          await fsPromises.rm(partAbs, { force: true }).catch(() => {});
          return;
        }
        if (!isBusyFsError(err)) throw err;
      }
    }
  } finally {
    await fsPromises.rm(partAbs, { force: true }).catch(() => {});
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'EBUSY');
  throw new Error(
    `결과 파일을 저장하지 못했습니다. 캐드나 탐색기에서 같은 파일을 닫고 다시 변환하세요. (${msg})`
  );
}

async function copyShpBundleToDir(shpAbs: string, destDir: string): Promise<string> {
  const srcDir = path.dirname(shpAbs);
  const base = path.parse(shpAbs).name;
  const destShp = path.join(destDir, path.basename(shpAbs));
  for (const ext of SHP_COPY_EXTS) {
    const from = path.join(srcDir, `${base}${ext}`);
    try {
      await fsPromises.copyFile(from, path.join(destDir, `${base}${ext}`));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') continue;
      throw err;
    }
  }
  return destShp;
}

function missingSidecars(dir: string, basename: string): string[] {
  return REQUIRED_SIDECARS.filter((ext) => {
    const p = path.join(dir, `${basename}${ext}`);
    try {
      return !fs.existsSync(p) || fs.statSync(p).size <= 0;
    } catch {
      return true;
    }
  });
}

async function listShpFilesInDir(dirAbs: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /\.shp$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

async function listCadBasenames(dirAbs: string, extRe: RegExp): Promise<Set<string>> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return new Set();
  }
  return new Set(
    entries
      .filter((entry) => entry.isFile() && extRe.test(entry.name))
      .map((entry) => path.parse(entry.name).name.toLowerCase())
  );
}

async function buildJobRow(jobName: string): Promise<ShpToDxfJobRow> {
  const safeJob = assertSafeJobName(jobName);
  const shpDir = shpInputAbs(safeJob);
  const dxfDir = dxfOutputAbs(safeJob);
  const dwgDir = dwgOutputAbs(safeJob);
  const jobDir = path.join(getRootAbs(), safeJob);
  const shpFiles = await listShpFilesInDir(shpDir);
  const dxfNames = await listCadBasenames(dxfDir, /\.dxf$/i);
  const dwgNames = await listCadBasenames(dwgDir, /\.dwg$/i);

  let dxfCount = 0;
  let dwgCount = 0;
  let incompleteCount = 0;
  for (const shpFile of shpFiles) {
    const base = path.parse(shpFile).name;
    if (missingSidecars(shpDir, base).length > 0) incompleteCount += 1;
    if (dxfNames.has(base.toLowerCase())) dxfCount += 1;
    if (dwgNames.has(base.toLowerCase())) dwgCount += 1;
  }

  const stats = await Promise.all([
    fsPromises.stat(jobDir).catch(() => null),
    fsPromises.stat(shpDir).catch(() => null),
    fsPromises.stat(dxfDir).catch(() => null),
    fsPromises.stat(dwgDir).catch(() => null),
  ]);
  const latest = stats
    .map((stat) => stat?.mtime?.getTime() ?? 0)
    .reduce((max, value) => (value > max ? value : max), 0);

  return {
    jobName: safeJob,
    shpCount: shpFiles.length,
    dxfCount,
    dwgCount,
    pendingCount: Math.max(shpFiles.length - dxfCount, 0),
    incompleteCount,
    modified: latest > 0 ? new Date(latest).toISOString() : undefined,
  };
}

export async function listShpToDxfJobs(params?: {
  limit?: number;
}): Promise<{ rows: ShpToDxfJobRow[]; rootRelative: string; dwgConverterAvailable: boolean }> {
  await fsPromises.mkdir(getRootAbs(), { recursive: true });
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(getRootAbs(), { withFileTypes: true });
  } catch {
    return { rows: [], rootRelative: ROOT_REL, dwgConverterAvailable: isQcadDwgConverterAvailable() };
  }

  const jobNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, 'ko'));

  const rows = await Promise.all(jobNames.map((jobName) => buildJobRow(jobName)));
  return {
    rows: rows.slice(0, params?.limit ?? 200),
    rootRelative: ROOT_REL,
    dwgConverterAvailable: isQcadDwgConverterAvailable(),
  };
}

async function convertOneShp(params: {
  shpAbs: string;
  dxfAbs: string;
  encoding: string;
  layerName: string;
}): Promise<void> {
  const { cmd, args: prefix, env } = resolveOgr2ogrRun();
  const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'shp-to-dxf-'));
  try {
    const tmpShp = await copyShpBundleToDir(params.shpAbs, tmpRoot);
    const tmpDxf = path.join(tmpRoot, 'out.dxf');
    const layerRef = ogrSqlLayerRef(path.parse(params.shpAbs).name);
    const ogrArgs = [
      '-f',
      'DXF',
      tmpDxf,
      tmpShp,
      '-oo',
      `ENCODING=${params.encoding}`,
      '-nln',
      params.layerName,
      '-dsco',
      'INSUNITS=METERS',
      '-dsco',
      'MEASUREMENT=METRIC',
      '-sql',
      `SELECT FID FROM ${layerRef}`,
    ];
    const execArgs = prefix.length > 0 ? [...prefix, ...ogrArgs] : ogrArgs;
    const runEnv: NodeJS.ProcessEnv = {
      ...(env ?? process.env),
      DXF_WRITE_HATCH: 'FALSE',
    };

    const result = await runOgr2ogr(cmd, execArgs, runEnv, PER_FILE_TIMEOUT_MS);
    let st: fs.Stats | null = null;
    try {
      st = await fsPromises.stat(tmpDxf);
    } catch {
      st = null;
    }
    const hasOutput = Boolean(st?.isFile() && (st.size ?? 0) > 0);
    if (result.code !== 0 && !(hasOutput && isOnlyDxfFieldCreationNoise(result.stderr))) {
      throw new Error(mapOgrError(result.code, result.stderr));
    }
    if (!hasOutput) {
      throw new Error('도면 파일이 생성되지 않았습니다.');
    }

    await fsPromises.mkdir(path.dirname(params.dxfAbs), { recursive: true });
    await fsPromises.rm(`${params.dxfAbs}.tmp`, { force: true }).catch(() => {});
    await copyReplaceWithRetry(tmpDxf, params.dxfAbs);
  } finally {
    await fsPromises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runShpToDxfConversion(params: {
  jobName: string;
  outputFormat?: ShpCadOutputFormat | string | null;
}): Promise<ShpToDxfConvertResult> {
  const jobName = assertSafeJobName(params.jobName);
  const outputFormat = normalizeOutputFormat(params.outputFormat);
  if (outputFormat === 'dwg' && !isQcadDwgConverterAvailable()) {
    throw new Error('캐드(DWG) 변환 환경을 찾지 못했습니다. QCAD를 설치하거나 도면(DXF)으로 변환하세요.');
  }

  const shpDir = shpInputAbs(jobName);
  const dxfDir = dxfOutputAbs(jobName);
  const dwgDir = dwgOutputAbs(jobName);
  const shpFiles = await listShpFilesInDir(shpDir);
  if (!shpFiles.length) {
    throw new Error(`SHP 폴더가 비어 있습니다: ${jobRelative(jobName)}/${SHP_INPUT_SUBDIR}`);
  }

  let historyStatus: '완료' | '실패' = '완료';
  let historyNote = '';
  const failures: { file: string; error: string }[] = [];
  let convertedCount = 0;
  const outLabel = outputFormat === 'dwg' ? '캐드' : '도면';
  const outDirRel =
    outputFormat === 'dwg'
      ? `${jobRelative(jobName)}/${DWG_OUTPUT_SUBDIR}`
      : `${jobRelative(jobName)}/${DXF_OUTPUT_SUBDIR}`;

  try {
    await fsPromises.mkdir(dxfDir, { recursive: true });
    if (outputFormat === 'dwg') {
      await fsPromises.mkdir(dwgDir, { recursive: true });
    }
    for (const shpFile of shpFiles) {
      const base = path.parse(shpFile).name;
      const missing = missingSidecars(shpDir, base);
      if (missing.length > 0) {
        failures.push({
          file: shpFile,
          error: `짝 파일이 없습니다: ${missing.join(', ')}`,
        });
        continue;
      }
      try {
        const dxfAbs = path.join(dxfDir, `${base}.dxf`);
        await convertOneShp({
          shpAbs: path.join(shpDir, shpFile),
          dxfAbs,
          encoding: resolveDbfEncoding(shpDir, base),
          layerName: sanitizeDxfLayerName(base),
        });
        if (outputFormat === 'dwg') {
          const dwgAbs = path.join(dwgDir, `${base}.dwg`);
          const dwg = await convertDxfFileToDwg(dxfAbs, dwgAbs);
          if (!dwg.ok) {
            throw new Error(dwg.reason);
          }
        }
        convertedCount += 1;
      } catch (err) {
        failures.push({
          file: shpFile,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (convertedCount === 0) {
      const detail = failures
        .map((f) => `${f.file}: ${f.error}`)
        .join('\n')
        .slice(0, 800);
      throw new Error(detail || '변환에 실패했습니다.');
    }

    const failNote =
      failures.length > 0
        ? ` (실패 ${failures.length}건: ${failures.map((f) => f.file).join(', ')})`
        : '';
    historyNote = `job=${jobName}, shp=${shpFiles.length}, ${outputFormat}=${convertedCount}`;
    return {
      success: true,
      message: `${jobName}: 형상파일 ${convertedCount}개 → ${outLabel} 변환 완료${failNote}`,
      jobName,
      convertedCount,
      failedCount: failures.length,
      failures,
    };
  } catch (err) {
    historyStatus = '실패';
    historyNote = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: outputFormat === 'dwg' ? 'convert_shp_to_dwg' : 'convert_shp_to_dxf',
      sourceFile: shpFiles.length === 1 ? shpFiles[0]! : `${shpFiles.length} SHP files`,
      pathOrResult: outDirRel,
      status: historyStatus,
      note: historyNote.slice(0, 200),
    }).catch((appendErr) => {
      console.error('[shpToDxfService] appendUploadConvertHistory failed:', appendErr);
    });
  }
}
