/**
 * 수치지형도 DXF 등고(표고) → 점 고도 보간
 * 폴더: 하위 폴더명 숫자 중 최소값 폴더만 사용
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import DxfParser, { type IDxf, type IEntity, type ILwpolylineEntity, type IPolylineEntity } from 'dxf-parser';
import proj4 from 'proj4';
import { decodeDxfBytes } from '@/lib/dxfTextEncoding';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';
import { interpolateElevationFromCandidates } from '@/service/elevationInterpolate';

const SEARCH_RADIUS_M = 300;
const CANDIDATE_DISTINCT_ELEV = 12;
const CONTOUR_LAYER_RE = /^F00171/i;
const MAX_SHEETS = 4;
const CACHE_MAX = 48;

type ContourLine = {
  elevation: number;
  coords: Array<[number, number]>;
};

type SheetContourCache = {
  cacheKey: string;
  lines: ContourLine[];
};

type SheetIndexRow = {
  file: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type DigitalMapElevationResult = {
  elevation: number;
  distanceM: number;
  method: 'nearest' | 'idw';
  folder: string;
};

let projReady = false;

function ensureProj(): void {
  if (projReady) return;
  proj4.defs(
    'EPSG:3857',
    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs'
  );
  proj4.defs(
    'EPSG:4326',
    '+proj=longlat +datum=WGS84 +no_defs'
  );
  proj4.defs(
    'EPSG:5179',
    '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5181',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5185',
    '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
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
    'EPSG:5188',
    '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
  );
  projReady = true;
}

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

function extractFolderNumber(name: string): number | null {
  const m = String(name).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** 폴더명 리스트 → 숫자 추출 → 가장 작은 수 폴더 */
export function pickSmallestNumberFolder(folderNames: string[]): string | null {
  let best: { name: string; n: number } | null = null;
  for (const name of folderNames) {
    const n = extractFolderNumber(name);
    if (n == null) continue;
    if (!best || n < best.n) best = { name, n };
  }
  return best?.name ?? null;
}

async function listFolderNames(): Promise<string[]> {
  const root = rootDir();
  if (!existsSync(root)) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function loadFolderIndex(folder: string): Promise<{
  sheets: SheetIndexRow[];
  crs?: string;
} | null> {
  try {
    const raw = await fs.readFile(indexPath(folder), 'utf8');
    const parsed = JSON.parse(raw) as {
      version?: number;
      folder?: string;
      sheets?: SheetIndexRow[];
      crs?: string;
    };
    if (!Array.isArray(parsed.sheets) || parsed.sheets.length === 0) return null;
    return { sheets: parsed.sheets, crs: parsed.crs };
  } catch {
    return null;
  }
}

function epsgCode(raw: string | undefined | null, fallback = '5186'): string {
  const n = String(raw ?? '').trim();
  if (/^\d{4,5}$/.test(n)) return `EPSG:${n}`;
  if (/^EPSG:\d+$/i.test(n)) return n.toUpperCase();
  return `EPSG:${fallback}`;
}

function transformXy(
  x: number,
  y: number,
  fromEpsg: string,
  toEpsg: string
): [number, number] | null {
  ensureProj();
  if (fromEpsg === toEpsg) return [x, y];
  try {
    const out = proj4(fromEpsg, toEpsg, [x, y]);
    if (!Array.isArray(out) || out.length < 2) return null;
    const ox = Number(out[0]);
    const oy = Number(out[1]);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
    return [ox, oy];
  } catch {
    return null;
  }
}

function isSaneElev(e: number): boolean {
  return Number.isFinite(e) && Math.abs(e) < 10_000;
}

function isContourLayer(layer: string | undefined): boolean {
  return CONTOUR_LAYER_RE.test(String(layer ?? '').trim());
}

function distPointToSeg(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function distPointToLine(px: number, py: number, coords: Array<[number, number]>): number {
  if (coords.length < 2) {
    if (coords.length === 1) return Math.hypot(px - coords[0][0], py - coords[0][1]);
    return Infinity;
  }
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distPointToSeg(px, py, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

function entityContourLines(ent: IEntity): ContourLine[] {
  if (!isContourLayer(ent.layer)) return [];
  if (ent.type === 'LWPOLYLINE') {
    const e = ent as ILwpolylineEntity;
    const elev = Number(e.elevation);
    if (!isSaneElev(elev) || !e.vertices?.length) return [];
    const coords = e.vertices
      .map((v) => [Number(v.x), Number(v.y)] as [number, number])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (coords.length < 2) return [];
    if (e.shape && coords.length > 2) {
      const a = coords[0];
      const b = coords[coords.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6) coords.push([a[0], a[1]]);
    }
    return [{ elevation: elev, coords }];
  }
  if (ent.type === 'POLYLINE') {
    const e = ent as IPolylineEntity;
    const verts = e.vertices;
    if (!verts?.length) return [];
    const zs = verts.map((v) => Number((v as { z?: number }).z)).filter(isSaneElev);
    const elev = zs.length ? zs[0] : NaN;
    if (!isSaneElev(elev)) return [];
    const coords = verts
      .map((v) => [Number(v.x), Number(v.y)] as [number, number])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (coords.length < 2) return [];
    return [{ elevation: elev, coords }];
  }
  if (ent.type === 'LINE') {
    const e = ent as IEntity & { vertices?: Array<{ x: number; y: number; z?: number }> };
    const v = e.vertices;
    if (!v || v.length < 2) return [];
    const z0 = Number(v[0].z);
    const z1 = Number(v[1].z);
    const elev = isSaneElev(z0) ? z0 : isSaneElev(z1) ? z1 : NaN;
    if (!isSaneElev(elev)) return [];
    const coords: Array<[number, number]> = [
      [Number(v[0].x), Number(v[0].y)],
      [Number(v[1].x), Number(v[1].y)],
    ];
    if (!coords.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return [];
    return [{ elevation: elev, coords }];
  }
  return [];
}

function extractContourLines(dxf: IDxf): ContourLine[] {
  const out: ContourLine[] = [];
  for (const ent of dxf.entities ?? []) {
    for (const line of entityContourLines(ent)) out.push(line);
  }
  return out;
}

const sheetCache = new Map<string, SheetContourCache>();

function trimCache(): void {
  while (sheetCache.size > CACHE_MAX) {
    const first = sheetCache.keys().next().value;
    if (first == null) break;
    sheetCache.delete(first);
  }
}

async function loadSheetContours(folder: string, file: string): Promise<ContourLine[]> {
  const abs = fileAbs(folder, file);
  const st = await fs.stat(abs);
  const cacheKey = `${folder}/${file}:${st.mtimeMs}:${st.size}`;
  const mapKey = `${folder}/${file}`;
  const hit = sheetCache.get(mapKey);
  if (hit && hit.cacheKey === cacheKey) return hit.lines;

  const buf = await fs.readFile(abs);
  const text = decodeDxfBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  const lines = dxf ? extractContourLines(dxf) : [];
  sheetCache.set(mapKey, { cacheKey, lines });
  trimCache();
  return lines;
}

function sheetIntersectsRadius(
  sheet: SheetIndexRow,
  x: number,
  y: number,
  radiusM: number
): boolean {
  return (
    x >= sheet.minX - radiusM &&
    x <= sheet.maxX + radiusM &&
    y >= sheet.minY - radiusM &&
    y <= sheet.maxY + radiusM
  );
}

function sheetCenterDist(sheet: SheetIndexRow, x: number, y: number): number {
  const cx = (sheet.minX + sheet.maxX) / 2;
  const cy = (sheet.minY + sheet.maxY) / 2;
  return Math.hypot(x - cx, y - cy);
}

/**
 * 클릭 좌표의 수치지형도(DXF 등고) 고도.
 * 폴더명 숫자 최소 폴더만 사용. 실패 시 null.
 */
export async function getDigitalMapElevationAtPoint(params: {
  x: number;
  y: number;
  srid?: number;
}): Promise<DigitalMapElevationResult | null> {
  const x = Number(params.x);
  const y = Number(params.y);
  const inputSrid = Number(params.srid) > 0 ? Number(params.srid) : 3857;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const folders = await listFolderNames();
  if (!folders.length) return null;
  const folder = pickSmallestNumberFolder(folders);
  if (!folder) return null;

  let index = await loadFolderIndex(folder);
  if (!index) {
    // 색인 없으면 digitalMapService ensure 경로 유도
    try {
      const { getFolderIndex } = await import('@/service/digitalMapService');
      const built = await getFolderIndex({ folder });
      index = { sheets: built.sheets, crs: built.crs };
    } catch {
      return null;
    }
  }
  if (!index?.sheets?.length) return null;

  const srcEpsg = epsgCode(String(inputSrid));
  const dstEpsg = epsgCode(index.crs, '5186');
  const pt = transformXy(x, y, srcEpsg, dstEpsg);
  if (!pt) return null;
  const [px, py] = pt;

  const near = index.sheets
    .filter((s) => sheetIntersectsRadius(s, px, py, SEARCH_RADIUS_M))
    .sort((a, b) => sheetCenterDist(a, px, py) - sheetCenterDist(b, px, py))
    .slice(0, MAX_SHEETS);
  if (!near.length) return null;

  const elevMinDist = new Map<number, number>();
  for (const sheet of near) {
    let lines: ContourLine[];
    try {
      lines = await loadSheetContours(folder, sheet.file);
    } catch {
      continue;
    }
    for (const line of lines) {
      const d = distPointToLine(px, py, line.coords);
      if (!(d <= SEARCH_RADIUS_M)) continue;
      const key = Math.round(line.elevation * 1000) / 1000;
      const prev = elevMinDist.get(key);
      if (prev == null || d < prev) elevMinDist.set(key, d);
    }
  }

  if (!elevMinDist.size) return null;

  const candidates = [...elevMinDist.entries()]
    .map(([elevation, distanceM]) => ({ elevation, distanceM }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, CANDIDATE_DISTINCT_ELEV);

  const { elevation, method, distanceM } = interpolateElevationFromCandidates(candidates);
  if (!Number.isFinite(elevation)) return null;

  return {
    elevation: Math.round(elevation * 10) / 10,
    distanceM: Number.isFinite(distanceM) ? distanceM : NaN,
    method,
    folder,
  };
}

/** digital_map 에 숫자 폴더가 하나라도 있는지 */
export async function hasDigitalMapFolders(): Promise<boolean> {
  const folders = await listFolderNames();
  return pickSmallestNumberFolder(folders) != null;
}
