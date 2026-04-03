/**
 * File Manager Service
 * 디렉터리 목록 조회. 베이스 = GGNR_DATA_DIR (사업명 폴더 없음).
 * 폴더 구조 없으면 생성: service_data/{file_data,gis_map_data,3dtiles,3dtiles_tiff,...}, upload_data/{tif,las}
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertSafeServiceFileBasename,
  fileDataRelativeDir,
  isServiceFileDataTmpMarkedFileName,
} from '@/lib/serviceFileData';

// 사업명 폴더 없이 데이터 루트가 곧 베이스. 환경변수 GGNR_DATA_DIR로 덮을 수 있음.
const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

function getBaseDir(): string {
  return GGNR_DATA_DIR;
}

/** 베이스 아래 고정 폴더 구조. 없으면 생성. (이력 파일은 .meta/upload_convert_history.json) */
const BASE_STRUCTURE = [
  'service_data',
  'service_data/file_data',
  'service_data/gis_map_data',
  'service_data/3dtiles',
  'service_data/3dtiles_tiff',
  'service_data/3dtiles_ecef',
  'service_data/3dtiles_pnts',
  'upload_data',
  'upload_data/tif',
  'upload_data/las',
  'service_data/shp_data',
  'service_data/excel_data',
  '.meta',
] as const;

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
  const base = getBaseDir();
  const raw = (relativePath ?? '').trim().replace(/^[/\\]+/, '');
  if (!raw) return base;
  const resolved = path.normalize(path.join(base, raw));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

export type ListDirectoryResult = {
  directories: string[];
  files: { name: string; size: number; modified?: string }[];
};

/**
 * 베이스(GGNR_DATA_DIR) 기준 상대 경로의 하위 디렉터리·파일 목록 반환.
 * @param params.relativePath - 상대 경로 (예: "", "upload_data", "upload_data/tif"). 사업명 미포함.
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
        (rel.startsWith('service_data/shp_data') ||
          rel.startsWith('service_data/excel_data') ||
          rel.startsWith('service_data/file_data')) &&
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

/**
 * service_data/file_data/{layerName}/{keyValue}/ 내 파일 목록 (첨부 공통).
 * 폴더가 없으면 빈 배열.
 */
export async function listServiceFileDataFiles(params: {
  layerName: string;
  keyValue: string;
}): Promise<ListDirectoryResult['files']> {
  const rel = fileDataRelativeDir(params.layerName, params.keyValue);
  if (!rel) return [];
  try {
    const r = await listDirectory({ relativePath: rel });
    return r.files.filter((f) => !isServiceFileDataTmpMarkedFileName(f.name));
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

const FILE_DATA_ROOT_REL = 'service_data/file_data';

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
    return { ok: false, error: 'service_data/file_data 하위만 삭제할 수 있습니다.' };
  }

  const base = path.resolve(getBaseDir());
  const prefixResolved = path.resolve(base, 'service_data', 'file_data');
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
 * service_data/3dtiles_pnts 하위 폴더 중 tileset.json이 있는 폴더 이름만 반환.
 * 3D 지도 타일 목록용 (tileset.json 없는 폴더는 제외).
 */
export async function list3DTilesetDirs(): Promise<{ directories: string[] }> {
  await ensureBaseStructure();
  const base = getBaseDir();
  const dir = path.join(base, 'service_data', '3dtiles_pnts');
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

/** 업로드·변환 이력 한 건 */
export type UploadConvertHistoryEntry = {
  at: string;
  kind: 'upload' | 'convert_hillshade' | 'convert_b3dm' | 'convert_cog' | 'convert_geotiff' | 'convert_ecef';
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

/** LAS 업로드 이력 집계: 파일당 한 행, 단계별 상태(업로드, geotiff, ecef, pnts). 파일 유무로 완료/실패 판단. */
export type UploadConvertHistoryAggregatedRow = {
  at: string;
  sourceFile: string;
  pathOrResult: string;
  steps: {
    upload?: AggregatedStepStatus;
    geotiff?: AggregatedStepStatus;
    ecef?: AggregatedStepStatus;
    pnts?: AggregatedStepStatus;
  };
};

const LAS_EXT = ['.las', '.laz'];

/**
 * upload_data/las 폴더의 파일 목록을 기준으로 행을 만들고,
 * GeoTIFF(3dtiles_tiff), ECEF(3dtiles_ecef), PNTS(3dtiles_pnts) 폴더 존재 여부로 단계 상태를 결정.
 */
export async function getUploadConvertHistoryAggregated(params?: {
  limit?: number;
}): Promise<{ rows: UploadConvertHistoryAggregatedRow[]; path: string }> {
  await ensureBaseStructure();
  const base = getBaseDir();
  const historyPath = path.join(base, HISTORY_FILE);
  const limit = params?.limit ?? 100;

  const lasDir = path.join(base, 'upload_data', 'las');
  let files: { name: string; mtime: Date }[] = [];
  try {
    const stat = await fs.stat(lasDir);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(lasDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!LAS_EXT.includes(ext)) continue;
        const fullPath = path.join(lasDir, e.name);
        const st = await fs.stat(fullPath).catch(() => null);
        files.push({ name: e.name, mtime: st?.mtime ?? new Date(0) });
      }
    }
  } catch {
    // upload_data/las 없음 → 빈 목록
  }

  const rows: UploadConvertHistoryAggregatedRow[] = [];
  for (const f of files) {
    const basename = path.basename(f.name, path.extname(f.name));
    const pathOrResult = `upload_data/las/${f.name}`;

    // 업로드: 행 존재 = upload_data/las에 파일 있음 → 완료
    const upload: AggregatedStepStatus = '완료';

    let geotiff: AggregatedStepStatus = '실패';
    try {
      const tiffDir = path.join(base, 'service_data', '3dtiles_tiff', basename);
      const st = await fs.stat(tiffDir);
      if (st.isDirectory()) {
        const list = await fs.readdir(tiffDir);
        const hasTif = list.some((n) => n.toLowerCase().endsWith('.tif') || n.toLowerCase().endsWith('.tiff'));
        geotiff = hasTif ? '완료' : '실패';
      }
    } catch {
      geotiff = '실패';
    }

    let ecef: AggregatedStepStatus = '실패';
    try {
      const ecefDir = path.join(base, 'service_data', '3dtiles_ecef', basename);
      const st = await fs.stat(ecefDir);
      if (st.isDirectory()) {
        const list = await fs.readdir(ecefDir);
        ecef = list.length > 0 ? '완료' : '실패';
      }
    } catch {
      ecef = '실패';
    }

    let pnts: AggregatedStepStatus = '실패';
    try {
      const pntsTileset = path.join(base, 'service_data', '3dtiles_pnts', basename, 'tileset.json');
      const st = await fs.stat(pntsTileset);
      pnts = st.isFile() ? '완료' : '실패';
    } catch {
      pnts = '실패';
    }

    rows.push({
      at: f.mtime.toISOString(),
      sourceFile: f.name,
      pathOrResult,
      steps: { upload, geotiff, ecef, pnts },
    });
  }

  rows.sort((a, b) => (b.at < a.at ? -1 : b.at > a.at ? 1 : 0));
  return { rows: rows.slice(0, limit), path: historyPath };
}
