/**
 * 수치지형도
 * - 지도 UI: GGNR_DATA_DIR/digital_map/*.pmtiles (listFolders / available)
 * - DXF 색인·내보내기·고도: digital_map/{폴더}/*.dxf (getFolderIndex / collect*)
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getSessionUsrId } from '@/lib/auth/guard';
import { decodeDxfBytes } from '@/lib/dxfTextEncoding';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import {
  hasDigitalMapPmtiles,
  listDigitalMapPmtiles,
  type DigitalMapPmtilesInfo,
} from '@/lib/digitalMapPmtiles';
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

/** 지도 사이드 «수치지형도» 목록 — PMTiles 메타 */
export type DigitalMapFolderInfo = DigitalMapPmtilesInfo;

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
  });
  indexJobs.set(folder, job);
  return job;
}

/** 서비스할 PMTiles 가 하나라도 있는지 — 사이드 «수치지형도» 버튼 노출 여부 */
export async function available(): Promise<{ available: boolean }> {
  await getSessionUsrId();
  return { available: await hasDigitalMapPmtiles() };
}

/** 서비스 중인 PMTiles 목록 (이름·줌 범위·위치) */
export async function listFolders(_params: Params = {}): Promise<{ folders: DigitalMapFolderInfo[] }> {
  await getSessionUsrId();
  return { folders: await listDigitalMapPmtiles() };
}

/** 내보내기용 — 세션 없이 digital_map 하위 DXF 폴더명만 */
async function listDigitalMapFolderNames(): Promise<string[]> {
  const root = rootDir();
  if (!existsSync(root)) return [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
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

export type DigitalMapExportFile = {
  /** ZIP 내 상대 경로 (수치지형도/폴더/파일.dxf) */
  entryName: string;
  absPath: string;
};

function boxesOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/**
 * EPSG:5181 bbox와 겹치는 수치지형도 DXF 목록.
 * - folderNames 지정: 해당 폴더만
 * - 미지정: 축척 폴더는 숫자 최소 폴더 우선, 없으면 전체 폴더
 */
export async function collectDigitalMapFilesIntersectingBbox5181(
  bbox5181: [number, number, number, number],
  opts?: { folderNames?: string[] | null }
): Promise<DigitalMapExportFile[]> {
  const [minX, minY, maxX, maxY] = bbox5181;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || !(maxX > minX) || !(maxY > minY)) {
    return [];
  }
  const query = { minX, minY, maxX, maxY };
  const folderNames = await listDigitalMapFolderNames();
  if (!folderNames.length) return [];

  const wanted = (opts?.folderNames ?? [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  let targets: string[];
  if (wanted.length > 0) {
    const want = new Set(wanted);
    targets = folderNames.filter((name) => want.has(name));
  } else {
    const { pickSmallestNumberFolder } = await import('@/service/digitalMapElevation');
    const preferred = pickSmallestNumberFolder(folderNames);
    targets = preferred ? [preferred] : folderNames;
  }
  if (!targets.length) return [];

  const { default: proj4 } = await import('proj4');
  proj4.defs(
    'EPSG:5181',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5186',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5187',
    '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5179',
    '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs'
  );

  const out: DigitalMapExportFile[] = [];
  for (const folderName of targets) {
    let index: DigitalMapFolderIndex;
    try {
      index = await ensureIndex(folderName, false);
    } catch {
      continue;
    }
    const crsCode = String(index.crs ?? CRS_FALLBACK).replace(/^EPSG:/i, '');
    const fromEpsg = `EPSG:${crsCode}`;
    if (!proj4.defs(fromEpsg)) {
      proj4.defs(
        fromEpsg,
        '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
      );
    }
    for (const sheet of index.sheets) {
      let sheet5181 = {
        minX: sheet.minX,
        minY: sheet.minY,
        maxX: sheet.maxX,
        maxY: sheet.maxY,
      };
      if (fromEpsg !== 'EPSG:5181') {
        try {
          const corners: Array<[number, number]> = [
            [sheet.minX, sheet.minY],
            [sheet.minX, sheet.maxY],
            [sheet.maxX, sheet.minY],
            [sheet.maxX, sheet.maxY],
          ];
          let sMinX = Infinity;
          let sMinY = Infinity;
          let sMaxX = -Infinity;
          let sMaxY = -Infinity;
          for (const c of corners) {
            const p = proj4(fromEpsg, 'EPSG:5181', c) as [number, number];
            sMinX = Math.min(sMinX, p[0]);
            sMinY = Math.min(sMinY, p[1]);
            sMaxX = Math.max(sMaxX, p[0]);
            sMaxY = Math.max(sMaxY, p[1]);
          }
          sheet5181 = { minX: sMinX, minY: sMinY, maxX: sMaxX, maxY: sMaxY };
        } catch {
          // 변환 실패 시 원본 좌표로 비교
        }
      }
      if (!boxesOverlap(query, sheet5181)) continue;
      const abs = fileAbs(folderName, sheet.file);
      if (!existsSync(abs)) continue;
      out.push({
        entryName: `수치지형도/${folderName}/${sheet.file}`,
        absPath: abs,
      });
    }
  }
  return out;
}

/** 수치지형도 DXF 등고 점 고도 — 폴더명 숫자 최소 폴더 */
export {
  getDigitalMapElevationAtPoint,
  hasDigitalMapFolders,
  pickSmallestNumberFolder,
} from '@/service/digitalMapElevation';
