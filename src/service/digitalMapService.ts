/**
 * 수치지형도 — GGNR_DATA_DIR/digital_map/{폴더}/*.dxf
 * 도엽 범위는 DXF HEADER $EXTMIN/$EXTMAX 로 색인한다.
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getSessionUsrId } from '@/lib/auth/guard';
import { decodeDxfBytes } from '@/lib/dxfTextEncoding';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';
import { detectCrsCandidatesByExtent } from '@/service/shpUploadService';

type Params = Record<string, unknown>;

export type DigitalMapSheet = {
  file: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  size: number;
  mtimeMs: number;
};

export type DigitalMapFolderIndex = {
  version: number;
  folder: string;
  rootDir: string;
  scannedAt: string;
  sheets: DigitalMapSheet[];
  /** 읍면동 경계와 겹치는 평면좌표계 (예: 5187). 없으면 감지 전 */
  crs?: string;
};

export type DigitalMapFolderInfo = {
  name: string;
  dxfCount: number;
  indexed: boolean;
};

const INDEX_VERSION = 1;
const HEADER_READ_BYTES = 64 * 1024;
const INDEX_CONCURRENCY = 24;
/** 읍면동 겹침 감지 실패 시 */
const CRS_FALLBACK = '5186';

function rootDir(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.digitalMap);
}

function metaDir(): string {
  return path.join(resolveGgnrDataDir(), GGNR_DATA_PATHS.meta, 'digital_map');
}

function indexPath(folder: string): string {
  const safe = folder.replace(/[^\w가-힣().\-_]/gu, '_');
  return path.join(metaDir(), `${safe}.json`);
}

function assertSafeFolderName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('폴더 이름이 올바르지 않습니다.');
  }
  return name;
}

function assertSafeFileName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('파일 이름이 올바르지 않습니다.');
  }
  if (!/\.dxf$/i.test(name)) {
    throw new Error('DXF 파일만 허용됩니다.');
  }
  return name;
}

function folderAbs(folder: string): string {
  const abs = path.resolve(rootDir(), folder);
  const base = path.resolve(rootDir());
  const rel = path.relative(base, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('폴더 경로가 올바르지 않습니다.');
  }
  return abs;
}

function fileAbs(folder: string, file: string): string {
  const abs = path.resolve(folderAbs(folder), file);
  const base = path.resolve(folderAbs(folder));
  const rel = path.relative(base, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('파일 경로가 올바르지 않습니다.');
  }
  return abs;
}

/** DXF 헤더에서 EXTMIN/EXTMAX 추출 (전체 파싱 없음). 그룹코드 앞 공백 허용 */
export function parseDxfHeaderExtent(headerAscii: string): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const extMin = /\$EXTMIN\s+10\s+([^\r\n]+)\s+20\s+([^\r\n]+)/i.exec(headerAscii);
  const extMax = /\$EXTMAX\s+10\s+([^\r\n]+)\s+20\s+([^\r\n]+)/i.exec(headerAscii);
  if (!extMin || !extMax) return null;
  const minX = Number(String(extMin[1]).trim());
  const minY = Number(String(extMin[2]).trim());
  const maxX = Number(String(extMax[1]).trim());
  const maxY = Number(String(extMax[2]).trim());
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

async function readHeaderAscii(filePath: string): Promise<string> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEADER_READ_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_READ_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('latin1');
  } finally {
    await fh.close();
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function loadIndexFile(folder: string): Promise<DigitalMapFolderIndex | null> {
  try {
    const raw = await fs.readFile(indexPath(folder), 'utf8');
    const parsed = JSON.parse(raw) as DigitalMapFolderIndex;
    if (parsed?.version !== INDEX_VERSION) return null;
    if (parsed.folder !== folder) return null;
    if (parsed.rootDir !== folderAbs(folder)) return null;
    if (!Array.isArray(parsed.sheets)) return null;
    // 잘못된 파싱으로 0건 저장된 색인은 버리고 다시 만든다
    if (parsed.sheets.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveIndex(index: DigitalMapFolderIndex): Promise<void> {
  await fs.mkdir(metaDir(), { recursive: true });
  const tmp = `${indexPath(index.folder)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(index), 'utf8');
  await fs.rename(tmp, indexPath(index.folder));
}

/** 이름만 세는 빠른 목록 — 네트워크 폴더에서 파일마다 stat 하면 목록이 수 분 걸린다 */
async function listDxfNames(folder: string): Promise<string[]> {
  const dir = folderAbs(folder);
  const entries = await fs.readdir(dir);
  return entries.filter((n) => /\.dxf$/i.test(n)).sort((a, b) => a.localeCompare(b, 'ko'));
}

const indexJobs = new Map<string, Promise<DigitalMapFolderIndex>>();
let listFoldersCache: { at: number; folders: DigitalMapFolderInfo[] } | null = null;
const LIST_FOLDERS_TTL_MS = 60_000;

function sheetsUnionBox(sheets: DigitalMapSheet[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (!sheets.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of sheets) {
    minX = Math.min(minX, s.minX);
    minY = Math.min(minY, s.minY);
    maxX = Math.max(maxX, s.maxX);
    maxY = Math.max(maxY, s.maxY);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

/** 도엽 원시 범위를 우리 지역 읍면동과 겹치는 좌표계로 고른다 */
async function detectFolderCrs(sheets: DigitalMapSheet[]): Promise<string> {
  const box = sheetsUnionBox(sheets);
  if (!box) return CRS_FALLBACK;
  try {
    const res = await detectCrsCandidatesByExtent(box);
    const top = res.candidates?.[0]?.epsg;
    if (typeof top === 'number' && Number.isFinite(top)) return String(top);
  } catch (e) {
    console.warn('[digitalMap] CRS 감지 실패', e instanceof Error ? e.message : e);
  }
  return CRS_FALLBACK;
}

async function withCrs(index: DigitalMapFolderIndex): Promise<DigitalMapFolderIndex> {
  if (index.crs && /^\d{4,5}$/.test(index.crs)) return index;
  const crs = await detectFolderCrs(index.sheets);
  const next = { ...index, crs };
  await saveIndex(next);
  return next;
}

async function buildIndex(folder: string): Promise<DigitalMapFolderIndex> {
  const files = await listDxfNames(folder);
  const sheetsRaw = await mapPool(files, INDEX_CONCURRENCY, async (file) => {
    try {
      const header = await readHeaderAscii(fileAbs(folder, file));
      const ext = parseDxfHeaderExtent(header);
      if (!ext) return null;
      return {
        file,
        minX: ext.minX,
        minY: ext.minY,
        maxX: ext.maxX,
        maxY: ext.maxY,
        size: 0,
        mtimeMs: 0,
      } satisfies DigitalMapSheet;
    } catch {
      return null;
    }
  });

  const sheets = sheetsRaw.filter((s): s is DigitalMapSheet => s != null);
  const crs = await detectFolderCrs(sheets);
  const index: DigitalMapFolderIndex = {
    version: INDEX_VERSION,
    folder,
    rootDir: folderAbs(folder),
    scannedAt: new Date().toISOString(),
    sheets,
    crs,
  };
  await saveIndex(index);
  return index;
}

async function ensureIndex(folder: string, refresh = false): Promise<DigitalMapFolderIndex> {
  if (!refresh) {
    const cached = await loadIndexFile(folder);
    if (cached) {
      // 파일 개수가 크게 다르면 재색인 (이름만 세서 빠르게)
      try {
        const liveCount = (await listDxfNames(folder)).length;
        const tol = Math.max(2, Math.floor(liveCount * 0.02));
        if (Math.abs(liveCount - cached.sheets.length) <= tol) {
          return withCrs(cached);
        }
      } catch {
        return withCrs(cached);
      }
    }
  }

  const existing = indexJobs.get(folder);
  if (existing) return existing;

  const job = buildIndex(folder).finally(() => {
    indexJobs.delete(folder);
    listFoldersCache = null;
  });
  indexJobs.set(folder, job);
  return job;
}

export async function available(): Promise<{ available: boolean }> {
  await getSessionUsrId();
  const root = rootDir();
  if (!existsSync(root)) return { available: false };
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const hasFolder = entries.some((e) => e.isDirectory());
    return { available: hasFolder };
  } catch {
    return { available: false };
  }
}

export async function listFolders(_params: Params = {}): Promise<{ folders: DigitalMapFolderInfo[] }> {
  await getSessionUsrId();
  if (listFoldersCache && Date.now() - listFoldersCache.at < LIST_FOLDERS_TTL_MS) {
    return { folders: listFoldersCache.folders };
  }

  const root = rootDir();
  if (!existsSync(root)) return { folders: [] };

  const entries = await fs.readdir(root, { withFileTypes: true });
  const folders: DigitalMapFolderInfo[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    const idx = await loadIndexFile(name);
    let dxfCount = idx?.sheets.length ?? 0;
    const indexed = Boolean(idx);
    // 색인 없거나 0건이면 파일명만 센다
    if (!indexed || dxfCount <= 0) {
      try {
        dxfCount = (await listDxfNames(name)).length;
      } catch {
        dxfCount = 0;
      }
    }
    if (dxfCount > 0) folders.push({ name, dxfCount, indexed });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  // 빈 목록은 캐시하지 않음 — 잘못된 색인·일시 오류가 남을 수 있음
  listFoldersCache = folders.length > 0 ? { at: Date.now(), folders } : null;
  return { folders };
}

export async function getFolderIndex(params: Params = {}): Promise<DigitalMapFolderIndex> {
  await getSessionUsrId();
  const folder = assertSafeFolderName(params.folder);
  const refresh = Boolean(params.refresh);
  return ensureIndex(folder, refresh);
}

/** 서버 라우트용 — DXF 본문 문자열 */
export async function readDxfText(folderRaw: string, fileRaw: string): Promise<string> {
  await getSessionUsrId();
  const folder = assertSafeFolderName(folderRaw);
  const file = assertSafeFileName(fileRaw);
  const abs = fileAbs(folder, file);
  const buf = await fs.readFile(abs);
  return decodeDxfBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
