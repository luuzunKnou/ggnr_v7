/**
 * File Manager Service
 * 디렉터리 목록 조회. 베이스 = GGNR_DATA_DIR (사업명 폴더 없음).
 * 폴더 구조 없으면 생성: 3dtiles_*, tiles_*, file_data, shp_data, excel_data, .meta
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import {
  assertSafeServiceFileBasename,
  fileDataRelativeDir,
  isServiceFileDataTmpMarkedFileName,
} from '@/lib/serviceFileData';
import { GGNR_BASE_STRUCTURE, GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';

// 사업명 폴더 없이 데이터 루트가 곧 베이스. 환경변수 GGNR_DATA_DIR로 덮을 수 있음.
const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

function getBaseDir(): string {
  return GGNR_DATA_DIR;
}

function normalizeRelativePath(relativePath?: string): string {
  return String(relativePath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function resolveWithinBase(relativePath?: string): { base: string; baseResolved: string; abs: string; rel: string } | null {
  const base = getBaseDir();
  const baseResolved = path.resolve(base);
  const rel = normalizeRelativePath(relativePath);
  if (!rel) return { base, baseResolved, abs: baseResolved, rel: '' };
  const segments = rel.split('/').filter(Boolean);
  if (segments.some((seg) => seg === '.' || seg === '..')) return null;
  const abs = path.resolve(baseResolved, ...segments);
  if (abs !== baseResolved && !abs.startsWith(baseResolved + path.sep)) return null;
  return { base, baseResolved, abs, rel: segments.join('/') };
}

function assertSafeItemName(name: string): string | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  if (/[\\/]/.test(trimmed)) return null;
  return trimmed;
}

/** Asia/Seoul 기준 YYYYMMDDHHmmss */
function seoulCompactTimestamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value?.padStart(2, '0') ?? '00';
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  return `${y}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

function sanitizeZipName(label: string): string {
  const cleaned = String(label ?? '')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'download';
}

const FILE_DATA_ROOT_REL = GGNR_DATA_PATHS.fileData;
const SHP_DATA_ROOT_REL = GGNR_DATA_PATHS.shpData;
const EXCEL_DATA_ROOT_REL = GGNR_DATA_PATHS.excelData;
const TILES_LAS_ROOT_REL = GGNR_DATA_PATHS.dtilesLas;
const TILES_TIF_ROOT_REL = GGNR_DATA_PATHS.tilesTif;
const TILES_JPG_ROOT_REL = GGNR_DATA_PATHS.tilesJpg;
const TILES_PNTS_ROOT_REL = GGNR_DATA_PATHS.dtilesPnts;
const TILES_B3DM_ROOT_REL = GGNR_DATA_PATHS.dtilesB3dm;

/** 베이스 아래 고정 폴더 구조. 없으면 생성. (이력 파일은 .meta/upload_convert_history.json) */
const BASE_STRUCTURE = GGNR_BASE_STRUCTURE;

export async function ensureBaseStructure(): Promise<void> {
  const base = getBaseDir();
  for (const rel of BASE_STRUCTURE) {
    const dir = path.join(base, rel);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // 이미 존재하거나 권한 문제 등은 무시
    }
  }
}

/**
 * relativePath를 정규화하고 베이스 하위인지 검사. 경로 이탈 차단.
 */
function resolveSafe(relativePath: string | undefined): string | null {
  return resolveWithinBase(relativePath)?.abs ?? null;
}

export type ListDirectoryResult = {
  directories: string[];
  files: { name: string; size: number; modified?: string }[];
};

/**
 * 베이스(GGNR_DATA_DIR) 기준 상대 경로의 하위 디렉터리·파일 목록 반환.
 * @param params.relativePath - 상대 경로 (예: "", "3dtiles_las", "tiles_tif"). 사업명 미포함.
 */
export async function listDirectory(params: {
  relativePath?: string;
}): Promise<ListDirectoryResult> {
  await ensureBaseStructure();
  const dir = resolveSafe(params.relativePath);
  if (!dir) {
    throw new Error('Invalid path');
  }
  let stat;
  try {
    stat = await fs.stat(dir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      const base = getBaseDir();
      const rel = path.relative(base, dir).replace(/\\/g, '/');
      if (
        (rel.startsWith(SHP_DATA_ROOT_REL) ||
          rel.startsWith(EXCEL_DATA_ROOT_REL) ||
          rel.startsWith(FILE_DATA_ROOT_REL)) &&
        !rel.includes('..')
      ) {
        await fs.mkdir(dir, { recursive: true });
        stat = await fs.stat(dir);
      } else {
        throw new Error('Directory not found');
      }
    } else {
      throw new Error('Directory not found');
    }
  }
  if (!stat.isDirectory()) {
    throw new Error('Not a directory');
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const directories: string[] = [];
  const files: { name: string; size: number; modified?: string }[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      directories.push(e.name);
    } else if (e.isFile()) {
      try {
        const p = path.join(dir, e.name);
        const s = await fs.stat(p);
        files.push({
          name: e.name,
          size: s.size,
          modified: s.mtime?.toISOString?.() ?? undefined,
        });
      } catch {
        files.push({ name: e.name, size: 0 });
      }
    }
  }
  directories.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { directories, files };
}

export type FileManagerDirectoryItem = {
  name: string;
  relativePath: string;
  modified?: string;
};

export type FileManagerFileItem = {
  name: string;
  relativePath: string;
  size: number;
  modified?: string;
};

export async function getFileManagerRootInfo(): Promise<{ baseDir: string; rootName: string }> {
  await ensureBaseStructure();
  const baseDir = getBaseDir();
  const rootName = path.basename(baseDir.replace(/[\\/]+$/, '')) || baseDir;
  return { baseDir, rootName };
}

export async function listFileManagerDirectory(params: {
  relativePath?: string;
}): Promise<{
  baseDir: string;
  rootName: string;
  currentPath: string;
  parentPath: string | null;
  directories: FileManagerDirectoryItem[];
  files: FileManagerFileItem[];
}> {
  await ensureBaseStructure();
  const resolved = resolveWithinBase(params.relativePath);
  if (!resolved) throw new Error('Invalid path');
  const stat = await fs.stat(resolved.abs).catch(() => null);
  if (!stat) throw new Error('Directory not found');
  if (!stat.isDirectory()) throw new Error('Not a directory');
  const entries = await fs.readdir(resolved.abs, { withFileTypes: true });
  const directories: FileManagerDirectoryItem[] = [];
  const files: FileManagerFileItem[] = [];
  for (const e of entries) {
    const childRel = resolved.rel ? `${resolved.rel}/${e.name}` : e.name;
    const full = path.join(resolved.abs, e.name);
    if (e.isDirectory()) {
      const st = await fs.stat(full).catch(() => null);
      directories.push({
        name: e.name,
        relativePath: childRel.replace(/\\/g, '/'),
        modified: st?.mtime?.toISOString?.() ?? undefined,
      });
    } else if (e.isFile()) {
      const st = await fs.stat(full).catch(() => null);
      files.push({
        name: e.name,
        relativePath: childRel.replace(/\\/g, '/'),
        size: st?.size ?? 0,
        modified: st?.mtime?.toISOString?.() ?? undefined,
      });
    }
  }
  directories.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...(await getFileManagerRootInfo()),
    currentPath: resolved.rel,
    parentPath: resolved.rel ? path.posix.dirname(resolved.rel) === '.' ? '' : path.posix.dirname(resolved.rel) : null,
    directories,
    files,
  };
}

export async function createFileManagerDirectory(params: {
  parentPath?: string;
  name: string;
}): Promise<{ ok: true; relativePath: string }> {
  await ensureBaseStructure();
  const parent = resolveWithinBase(params.parentPath);
  const safeName = assertSafeItemName(params.name);
  if (!parent || !safeName) throw new Error('유효하지 않은 폴더명입니다.');
  const targetRel = parent.rel ? `${parent.rel}/${safeName}` : safeName;
  const target = resolveWithinBase(targetRel);
  if (!target) throw new Error('Invalid path');
  const exists = await fs.stat(target.abs).catch(() => null);
  if (exists) throw new Error('같은 이름의 폴더 또는 파일이 이미 있습니다.');
  await fs.mkdir(target.abs, { recursive: true });
  return { ok: true, relativePath: target.rel };
}

export async function renameFileManagerPath(params: {
  relativePath: string;
  newName: string;
}): Promise<{ ok: true; relativePath: string }> {
  const source = resolveWithinBase(params.relativePath);
  const safeName = assertSafeItemName(params.newName);
  if (!source || !source.rel) throw new Error('루트는 이름을 변경할 수 없습니다.');
  if (!safeName) throw new Error('유효하지 않은 이름입니다.');
  const parentRel = path.posix.dirname(source.rel);
  const nextRel = parentRel === '.' ? safeName : `${parentRel}/${safeName}`;
  const target = resolveWithinBase(nextRel);
  if (!target) throw new Error('Invalid path');
  const exists = await fs.stat(target.abs).catch(() => null);
  if (exists) throw new Error('같은 이름의 대상이 이미 있습니다.');
  await fs.rename(source.abs, target.abs);
  return { ok: true, relativePath: target.rel };
}

export async function moveFileManagerPaths(params: {
  sourcePaths: string[];
  targetDir: string;
}): Promise<{ ok: true; moved: string[] }> {
  const target = resolveWithinBase(params.targetDir);
  if (!target) throw new Error('대상 폴더 경로가 잘못되었습니다.');
  const targetStat = await fs.stat(target.abs).catch(() => null);
  if (!targetStat?.isDirectory()) throw new Error('대상 폴더를 찾을 수 없습니다.');

  const uniqueSources = Array.from(
    new Set((params.sourcePaths ?? []).map((p) => normalizeRelativePath(p)).filter(Boolean))
  );
  if (uniqueSources.length === 0) throw new Error('이동할 대상을 선택하세요.');

  const moved: string[] = [];
  for (const raw of uniqueSources) {
    const source = resolveWithinBase(raw);
    if (!source || !source.rel) throw new Error('루트는 이동할 수 없습니다.');
    if (target.rel === source.rel || target.rel.startsWith(source.rel + '/')) {
      throw new Error(`자기 자신 또는 하위 폴더로는 이동할 수 없습니다: ${source.rel}`);
    }
    const nextRel = target.rel ? `${target.rel}/${path.posix.basename(source.rel)}` : path.posix.basename(source.rel);
    const dest = resolveWithinBase(nextRel);
    if (!dest) throw new Error('Invalid target path');
    const exists = await fs.stat(dest.abs).catch(() => null);
    if (exists) throw new Error(`이미 같은 이름의 대상이 있습니다: ${nextRel}`);
    await fs.rename(source.abs, dest.abs);
    moved.push(dest.rel);
  }
  return { ok: true, moved };
}

export async function deleteFileManagerPaths(params: {
  relativePaths: string[];
}): Promise<{ ok: true; deleted: string[] }> {
  const uniquePaths = Array.from(
    new Set((params.relativePaths ?? []).map((p) => normalizeRelativePath(p)).filter(Boolean))
  ).sort((a, b) => b.length - a.length);
  if (uniquePaths.length === 0) throw new Error('삭제할 대상을 선택하세요.');
  const deleted: string[] = [];
  for (const raw of uniquePaths) {
    const target = resolveWithinBase(raw);
    if (!target || !target.rel) throw new Error('루트는 삭제할 수 없습니다.');
    const stat = await fs.stat(target.abs).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      await fs.rm(target.abs, { recursive: true, force: true });
    } else {
      await fs.unlink(target.abs);
    }
    deleted.push(target.rel);
  }
  return { ok: true, deleted };
}

export async function getFileManagerDownloadTarget(params: {
  relativePath: string;
}): Promise<{ absolutePath: string; fileName: string; isDirectory: boolean }> {
  const target = resolveWithinBase(params.relativePath);
  if (!target || !target.rel) throw new Error('유효하지 않은 경로입니다.');
  const stat = await fs.stat(target.abs).catch(() => null);
  if (!stat) throw new Error('대상을 찾을 수 없습니다.');
  return {
    absolutePath: target.abs,
    fileName: path.basename(target.rel),
    isDirectory: stat.isDirectory(),
  };
}

export async function createFileManagerZipStream(params: {
  relativePaths: string[];
}): Promise<{ stream: PassThrough; downloadFileName: string }> {
  const uniquePaths = Array.from(
    new Set((params.relativePaths ?? []).map((p) => normalizeRelativePath(p)).filter(Boolean))
  );
  if (uniquePaths.length === 0) throw new Error('압축할 대상을 선택하세요.');

  const pass = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err: unknown) => {
    pass.destroy(err instanceof Error ? err : new Error(String(err)));
  });
  archive.pipe(pass);

  for (const raw of uniquePaths) {
    const target = resolveWithinBase(raw);
    if (!target || !target.rel) throw new Error('유효하지 않은 경로가 포함되어 있습니다.');
    const stat = await fs.stat(target.abs).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      archive.directory(target.abs, target.rel);
    } else {
      archive.file(target.abs, { name: target.rel });
    }
  }

  void archive.finalize();
  const baseLabel =
    uniquePaths.length === 1 ? path.posix.basename(uniquePaths[0]!) : `선택_${uniquePaths.length}건`;
  const downloadFileName = `${seoulCompactTimestamp()}_${sanitizeZipName(baseLabel)}.zip`;
  return { stream: pass, downloadFileName };
}

/**
 * file_data/{layerName}/{keyValue}/ 내 파일 목록 (첨부 공통).
 * 폴더가 없으면 빈 배열.
 */
export async function listServiceFileDataFiles(params: {
  layerName: string;
  keyValue: string;
}): Promise<ListDirectoryResult['files']> {
  const rel = fileDataRelativeDir(params.layerName, params.keyValue);
  if (!rel) return [];

  const filterTmp = (files: ListDirectoryResult['files']) =>
    files.filter((f) => !isServiceFileDataTmpMarkedFileName(f.name));

  try {
    const r = await listDirectory({ relativePath: rel });
    return filterTmp(r.files);
  } catch {
    return [];
  }
}

/**
 * 첨부파일 소프트 삭제: 원본을 `{파일명}.tmp` 로 rename (목록에서 제외).
 */
export async function softDeleteServiceFileDataItem(params: {
  layerName: string;
  keyValue: string;
  fileName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const safeName = assertSafeServiceFileBasename(params.fileName);
  if (!safeName || isServiceFileDataTmpMarkedFileName(safeName)) {
    return { ok: false, error: '유효하지 않은 파일명입니다.' };
  }
  const rel = fileDataRelativeDir(params.layerName, params.keyValue);
  if (!rel) return { ok: false, error: '유효하지 않은 경로입니다.' };
  const base = getBaseDir();
  const dirAbs = path.resolve(path.join(base, ...rel.split('/')));
  const baseResolved = path.resolve(base);
  if (!dirAbs.startsWith(baseResolved)) {
    return { ok: false, error: 'Forbidden' };
  }
  const srcAbs = path.resolve(path.join(dirAbs, safeName));
  if (!srcAbs.startsWith(dirAbs + path.sep) && srcAbs !== dirAbs) {
    return { ok: false, error: 'Forbidden' };
  }
  const dstAbs = srcAbs + '.tmp';
  try {
    const st = await fs.stat(srcAbs);
    if (!st.isFile()) return { ok: false, error: '파일만 삭제할 수 있습니다.' };
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, error: '파일을 찾을 수 없습니다.' };
    return { ok: false, error: '확인 실패' };
  }
  try {
    await fs.rename(srcAbs, dstAbs);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return { ok: false, error: '이미 삭제된 파일이 있습니다.' };
    throw e;
  }
  return { ok: true };
}

/**
 * 개발자 모드 file_data 탐색기: 파일 또는 폴더(비어 있지 않아도) 삭제. file_data 루트 자체는 불가.
 */
export async function deleteFileDataPath(params: {
  relativePath: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const raw = String(params?.relativePath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!raw || raw.includes('..')) return { ok: false, error: '유효하지 않은 경로입니다.' };
  if (!raw.startsWith(FILE_DATA_ROOT_REL)) {
    return { ok: false, error: 'file_data 하위만 삭제할 수 있습니다.' };
  }

  const base = path.resolve(getBaseDir());
  const prefixResolved = path.resolve(base, FILE_DATA_ROOT_REL);
  const full = path.resolve(base, ...raw.split('/').filter(Boolean));

  if (full === prefixResolved) {
    return { ok: false, error: 'file_data 루트 폴더는 삭제할 수 없습니다.' };
  }
  const sep = path.sep;
  if (!full.startsWith(prefixResolved + sep)) {
    return { ok: false, error: 'Forbidden' };
  }

  try {
    const st = await fs.stat(full);
    if (st.isDirectory()) {
      await fs.rm(full, { recursive: true, force: true });
    } else {
      await fs.unlink(full);
    }
    return { ok: true };
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return { ok: false, error: '대상을 찾을 수 없습니다.' };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 3dtiles_pnts/<데이터셋>/tileset.json 이 있는 데이터셋 폴더명만 반환.
 */
export async function list3DTilesetDirs(): Promise<{ directories: string[] }> {
  await ensureBaseStructure();
  const base = getBaseDir();
  const dir = path.join(base, TILES_PNTS_ROOT_REL);
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return { directories: [] };
  } catch {
    return { directories: [] };
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const directories: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const tilesetPath = path.join(dir, e.name, 'tileset.json');
    try {
      const st = await fs.stat(tilesetPath);
      if (st.isFile()) directories.push(e.name);
    } catch {
      // tileset.json 없음 → 목록에서 제외
    }
  }
  directories.sort((a, b) => a.localeCompare(b));
  return { directories };
}

/**
 * 3dtiles_b3dm/<데이터셋>/tileset.json 이 있는 데이터셋 폴더명만 반환.
 */
export async function list3DB3dmTilesetDirs(): Promise<{ directories: string[] }> {
  await ensureBaseStructure();
  const base = getBaseDir();
  const dir = path.join(base, TILES_B3DM_ROOT_REL);
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return { directories: [] };
  } catch {
    return { directories: [] };
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const directories: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const tilesetPath = path.join(dir, e.name, 'tileset.json');
    try {
      const st = await fs.stat(tilesetPath);
      if (st.isFile()) directories.push(e.name);
    } catch {
      /* tileset.json 없음 */
    }
  }
  directories.sort((a, b) => a.localeCompare(b));
  return { directories };
}

/** 업로드·변환 이력 한 건 */
export type UploadConvertHistoryEntry = {
  at: string;
  kind:
    | 'upload'
    | 'convert_hillshade'
    | 'convert_b3dm'
    | 'merge_b3dm'
    | 'convert_cog'
    | 'convert_ecef'
    | 'convert_orthophoto_xyz';
  sourceFile: string;
  pathOrResult: string;
  status: '완료' | '변환 중' | '실패';
  note?: string;
};

const HISTORY_FILE = '.meta/upload_convert_history.json';

function normalizeHistoryData(parsed: unknown): UploadConvertHistoryEntry[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const arr = obj.data ?? obj.entries ?? obj.history ?? obj.list;
    if (Array.isArray(arr)) return arr;
  }
  return [];
}

/** 손상된 JSON에서 첫 번째 완전한 배열 [...] 구간만 추출해 파싱 시도 (문자열 안 [ ] 제외) */
function tryParseFirstArray(raw: string): UploadConvertHistoryEntry[] {
  const start = raw.indexOf('[');
  if (start === -1) return [];
  let depth = 0;
  let i = start;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      i++;
      while (i < raw.length) {
        if (raw[i] === '\\') i += 2;
        else if (raw[i] === '"') { i++; break; }
        else i++;
      }
      continue;
    }
    if (ch === '[') { depth++; i++; continue; }
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          const data = JSON.parse(raw.slice(start, i + 1)) as unknown;
          return normalizeHistoryData(data);
        } catch {
          return [];
        }
      }
      i++;
      continue;
    }
    i++;
  }
  return [];
}

async function readHistory(): Promise<UploadConvertHistoryEntry[]> {
  const base = getBaseDir();
  const filePath = path.join(base, HISTORY_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch (parseErr) {
      // 파싱 실패 시 첫 번째 완전한 배열만 추출해 복구 시도
      const recovered = tryParseFirstArray(raw);
      if (recovered.length > 0) {
        console.warn('[fileManagerService] readHistory: JSON 복구 성공 (손상 구간 무시), path:', filePath, 'count:', recovered.length);
        void writeHistory(recovered).catch((e) => console.warn('[fileManagerService] 복구 후 파일 정리 실패:', e));
        return recovered;
      }
      throw parseErr;
    }
    const entries = normalizeHistoryData(data);
    if (entries.length > 0) {
      console.info('[fileManagerService] readHistory ok, path:', filePath, 'count:', entries.length);
    }
    return entries;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!String(msg).toLowerCase().includes('enoent')) {
      console.warn('[fileManagerService] readHistory failed:', msg, 'path:', filePath);
    }
    return [];
  }
}

async function writeHistory(entries: UploadConvertHistoryEntry[]): Promise<void> {
  const base = getBaseDir();
  const dir = path.join(base, path.dirname(HISTORY_FILE));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(base, HISTORY_FILE);
  await fs.writeFile(filePath, JSON.stringify(entries, null, 0), 'utf-8');
}

/** 이력 추가 (업로드 완료 또는 변환 완료 시 호출) */
export async function appendUploadConvertHistory(entry: UploadConvertHistoryEntry): Promise<void> {
  const entries = await readHistory();
  entries.unshift(entry);
  const max = 500;
  if (entries.length > max) entries.length = max;
  await writeHistory(entries);
}

/** 업로드·변환 이력 조회 (최신순). path는 서버가 읽은 파일 경로(확인용). */
export async function getUploadConvertHistory(params?: {
  limit?: number;
}): Promise<{ entries: UploadConvertHistoryEntry[]; path: string }> {
  const base = getBaseDir();
  const filePath = path.join(base, HISTORY_FILE);
  const entries = await readHistory();
  const limit = params?.limit ?? 100;
  return {
    entries: entries.slice(0, limit),
    path: filePath,
  };
}

export type AggregatedStepStatus = '완료' | '실패' | '변환 중' | undefined;

/** LAS 업로드 이력 집계: 파일당 한 행, 단계별 상태(업로드, ecef, pnts). 파일 유무로 완료/실패 판단. */
export type UploadConvertHistoryAggregatedRow = {
  at: string;
  sourceFile: string;
  pathOrResult: string;
  steps: {
    upload?: AggregatedStepStatus;
    ecef?: AggregatedStepStatus;
    pnts?: AggregatedStepStatus;
  };
};

const LAS_EXT = ['.las', '.laz'];

/**
 * 3dtiles_las/<dataset>/ 원본 LAS를 기준으로 행을 만들고,
 * 같은 폴더의 ECEF LAS, 3dtiles_pnts/<dataset>/tileset.json 존재 여부로 단계 상태를 결정.
 */
export async function getUploadConvertHistoryAggregated(params?: {
  limit?: number;
}): Promise<{ rows: UploadConvertHistoryAggregatedRow[]; path: string }> {
  await ensureBaseStructure();
  const base = getBaseDir();
  const historyPath = path.join(base, HISTORY_FILE);
  const limit = params?.limit ?? 100;

  const lasDir = path.join(base, TILES_LAS_ROOT_REL);
  const files: { dataset: string; name: string; relativePath: string; mtime: Date }[] = [];
  try {
    const stat = await fs.stat(lasDir);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(lasDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const datasetDir = path.join(lasDir, e.name);
        const datasetFiles = await fs.readdir(datasetDir, { withFileTypes: true }).catch(() => []);
        for (const f of datasetFiles) {
          if (!f.isFile()) continue;
          const ext = path.extname(f.name).toLowerCase();
          if (!LAS_EXT.includes(ext)) continue;
          const baseName = path.basename(f.name, ext);
          if (/_4326$|_5181$|_ecef$/i.test(baseName)) continue;
          const fullPath = path.join(datasetDir, f.name);
          const st = await fs.stat(fullPath).catch(() => null);
          files.push({
            dataset: e.name,
            name: f.name,
            relativePath: `${TILES_LAS_ROOT_REL}/${e.name}/${f.name}`,
            mtime: st?.mtime ?? new Date(0),
          });
        }
      }
    }
  } catch {
    // 3dtiles_las 없음 → 빈 목록
  }

  const rows: UploadConvertHistoryAggregatedRow[] = [];
  for (const f of files) {
    const basename = path.basename(f.name, path.extname(f.name));
    const pathOrResult = f.relativePath;

    // 업로드: 원본 LAS 파일이 존재하면 완료
    const upload: AggregatedStepStatus = '완료';

    let ecef: AggregatedStepStatus = '실패';
    try {
      const ecefPath = path.join(base, TILES_LAS_ROOT_REL, f.dataset, `${basename}_ecef.las`);
      const st = await fs.stat(ecefPath).catch(() => null);
      ecef = st?.isFile() ? '완료' : '실패';
    } catch {
      ecef = '실패';
    }

    let pnts: AggregatedStepStatus = '실패';
    try {
      const pntsPath = path.join(base, TILES_PNTS_ROOT_REL, f.dataset, 'tileset.json');
      const st = await fs.stat(pntsPath).catch(() => null);
      pnts = st?.isFile() ? '완료' : '실패';
    } catch {
      pnts = '실패';
    }

    rows.push({
      at: f.mtime.toISOString(),
      sourceFile: f.name,
      pathOrResult,
      steps: { upload, ecef, pnts },
    });
  }

  rows.sort((a, b) => (b.at < a.at ? -1 : b.at > a.at ? 1 : 0));
  return { rows: rows.slice(0, limit), path: historyPath };
}
