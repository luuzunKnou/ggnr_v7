/**
 * QGIS WMS GetMap — 드론영상 PNG 렌더
 * EPSG:3857 요청은 변환 산출 XYZ 타일을 합성하고, 최대 줌보다 확대된 경우·타 좌표계는 원본 TIF gdalwarp.
 */
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';
import {
  parseOrthoWmsTuKey,
  resolveOrthoTifAbsPath,
} from '@/service/aerialOrthoService';
import { warpExtentToPng } from '@/service/orthophotoService';

const MERC_ORIGIN = 20037508.342789244;
/** gdal2tiles --tilesize=512 (줌 선택 기준) */
const XYZ_TILE_PX = 512;

type XyzZoomInfo = { zooms: number[]; xsByZoom: Map<number, Set<number>> };
const xyzZoomCache = new Map<string, { at: number; info: XyzZoomInfo }>();
const XYZ_ZOOM_TTL_MS = 60_000;

/** 타일 폴더의 줌·x 디렉터리 목록 (캐시) */
async function readXyzZoomInfo(tilesAbsDir: string): Promise<XyzZoomInfo> {
  const hit = xyzZoomCache.get(tilesAbsDir);
  if (hit && Date.now() - hit.at < XYZ_ZOOM_TTL_MS) return hit.info;
  const zooms: number[] = [];
  const xsByZoom = new Map<number, Set<number>>();
  const zDirs = await fsPromises.readdir(tilesAbsDir, { withFileTypes: true });
  for (const d of zDirs) {
    if (!d.isDirectory() || !/^\d+$/.test(d.name)) continue;
    const z = Number(d.name);
    const xDirs = await fsPromises.readdir(path.join(tilesAbsDir, d.name), { withFileTypes: true });
    const xs = new Set<number>();
    for (const x of xDirs) {
      if (x.isDirectory() && /^\d+$/.test(x.name)) xs.add(Number(x.name));
    }
    zooms.push(z);
    xsByZoom.set(z, xs);
  }
  zooms.sort((a, b) => a - b);
  const info = { zooms, xsByZoom };
  xyzZoomCache.set(tilesAbsDir, { at: Date.now(), info });
  return info;
}

/** 요청 해상도(m/px)에 맞는 줌 — 타일 해상도가 요청 이하가 되는 최소 줌 */
function neededXyzZoom(resX: number): number {
  return Math.ceil(Math.log2((2 * MERC_ORIGIN) / (XYZ_TILE_PX * resX)));
}

/** XYZ 타일 합성 → PNG (te: EPSG:3857 minx,miny,maxx,maxy) */
async function renderXyzTilesToPng(opts: {
  tilesAbsDir: string;
  info: XyzZoomInfo;
  z: number;
  te: [number, number, number, number];
  width: number;
  height: number;
}): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const [minx, miny, maxx, maxy] = opts.te;
  const width = Math.max(1, Math.min(4096, Math.floor(opts.width)));
  const height = Math.max(1, Math.min(4096, Math.floor(opts.height)));
  const resX = (maxx - minx) / width;
  const resY = (maxy - miny) / height;
  const n = 2 ** opts.z;
  const span = (2 * MERC_ORIGIN) / n;
  const clampIdx = (v: number) => Math.max(0, Math.min(n - 1, v));
  const x0 = clampIdx(Math.floor((minx + MERC_ORIGIN) / span));
  const x1 = clampIdx(Math.floor((maxx + MERC_ORIGIN) / span));
  const y0 = clampIdx(Math.floor((MERC_ORIGIN - maxy) / span));
  const y1 = clampIdx(Math.floor((MERC_ORIGIN - miny) / span));
  const xs = opts.info.xsByZoom.get(opts.z) ?? new Set<number>();

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const jobs: Array<Promise<void>> = [];
  for (let x = x0; x <= x1; x++) {
    if (!xs.has(x)) continue;
    for (let y = y0; y <= y1; y++) {
      const file = path.join(opts.tilesAbsDir, String(opts.z), String(x), `${y}.png`);
      jobs.push(
        fsPromises
          .readFile(file)
          .then(async (buf) => {
            const img = await loadImage(buf);
            // 정수 픽셀 경계로 맞춰 타일 사이 틈(안티앨리어싱 선) 방지
            const dx0 = Math.round((x * span - MERC_ORIGIN - minx) / resX);
            const dx1 = Math.round(((x + 1) * span - MERC_ORIGIN - minx) / resX);
            const dy0 = Math.round((maxy - (MERC_ORIGIN - y * span)) / resY);
            const dy1 = Math.round((maxy - (MERC_ORIGIN - (y + 1) * span)) / resY);
            ctx.drawImage(img, dx0, dy0, dx1 - dx0, dy1 - dy0);
          })
          .catch(() => undefined)
      );
    }
  }
  await Promise.all(jobs);
  return canvas.toBuffer('image/png');
}

function escapeXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ogcError(message: string, code = 'NoApplicableCode'): Uint8Array {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ServiceExceptionReport version="1.3.0">` +
    `<ServiceException code="${escapeXml(code)}">${escapeXml(message)}</ServiceException>` +
    `</ServiceExceptionReport>`;
  return new TextEncoder().encode(xml);
}

let projReady = false;
function ensureProj(): void {
  if (projReady) return;
  proj4.defs(
    'EPSG:3857',
    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs'
  );
  proj4.defs(
    'EPSG:5181',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5186',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
  );
  projReady = true;
}

/** WGS84 범위 → 대상 CRS 사각형 (모서리 변환) */
function wgs84ExtentToCrsBox(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
  targetEpsg: string
): { minx: number; miny: number; maxx: number; maxy: number } | null {
  ensureProj();
  try {
    const corners: Array<[number, number]> = [
      [minLon, minLat],
      [maxLon, minLat],
      [minLon, maxLat],
      [maxLon, maxLat],
    ];
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    for (const [lon, lat] of corners) {
      const [x, y] = proj4('EPSG:4326', targetEpsg, [lon, lat]) as [number, number];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      minx = Math.min(minx, x);
      miny = Math.min(miny, y);
      maxx = Math.max(maxx, x);
      maxy = Math.max(maxy, y);
    }
    if (!(maxx > minx && maxy > miny)) return null;
    return { minx, miny, maxx, maxy };
  } catch {
    return null;
  }
}

function bboxXml(crs: string, box: { minx: number; miny: number; maxx: number; maxy: number }): string {
  return (
    `<BoundingBox CRS="${escapeXml(crs)}" ` +
    `minx="${box.minx}" miny="${box.miny}" maxx="${box.maxx}" maxy="${box.maxy}"/>`
  );
}

/** BBOX 문자열 → [minx,miny,maxx,maxy]. WMS 1.3.0 + EPSG:4326 은 lat,lon 축순서. */
export function parseWmsBbox(
  bboxRaw: string,
  crs: string,
  version: string
): [number, number, number, number] | null {
  const parts = String(bboxRaw ?? '')
    .split(',')
    .map((s) => Number(String(s).trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [a, b, c, d] = parts as [number, number, number, number];
  const ver = String(version || '1.3.0');
  const crsU = String(crs || '').toUpperCase();
  const is4326 = /EPSG:4326\b/.test(crsU) || /CRS:84\b/.test(crsU);
  if (ver.startsWith('1.3') && is4326 && !/CRS:84/.test(crsU)) {
    return [b, a, d, c];
  }
  return [a, b, c, d];
}

export function normalizeWmsEpsg(crs: string): string {
  const s = String(crs ?? '').trim();
  const m = /EPSG[:\s]*(\d+)/i.exec(s);
  if (m) return `EPSG:${m[1]}`;
  if (/CRS:84/i.test(s)) return 'EPSG:4326';
  return 'EPSG:3857';
}

/** 단일 ortho 레이어 GetMap */
export async function renderOrthoWmsGetMap(opts: {
  layerName: string;
  bbox: string;
  width: number;
  height: number;
  crs: string;
  version: string;
}): Promise<{ status: number; contentType: string; body: Uint8Array }> {
  const tuKey = parseOrthoWmsTuKey(opts.layerName);
  if (tuKey == null) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: ogcError('드론영상 레이어명이 올바르지 않습니다.', 'LayerNotDefined'),
    };
  }
  const src = await resolveOrthoTifAbsPath(tuKey);
  if (!src) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: ogcError('드론영상 원본 파일을 찾을 수 없습니다.', 'LayerNotDefined'),
    };
  }
  const epsg = normalizeWmsEpsg(opts.crs);
  const te = parseWmsBbox(opts.bbox, epsg, opts.version);
  if (!te || !(te[2] > te[0] && te[3] > te[1])) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: ogcError('BBOX가 올바르지 않습니다.', 'InvalidParameterValue'),
    };
  }

  if (epsg === 'EPSG:3857' && src.tilesAbsDir) {
    try {
      const info = await readXyzZoomInfo(src.tilesAbsDir);
      if (info.zooms.length > 0) {
        const minZ = info.zooms[0]!;
        const maxZ = info.zooms[info.zooms.length - 1]!;
        const need = neededXyzZoom((te[2] - te[0]) / Math.max(1, opts.width));
        // 최대 줌보다 확대 시 원본 해상도로 (좁은 범위라 원본 읽기도 빠름)
        if (!(need > maxZ && src.absSource)) {
          const z = info.zooms.find((zz) => zz >= Math.max(minZ, Math.min(maxZ, need))) ?? maxZ;
          const buffer = await renderXyzTilesToPng({
            tilesAbsDir: src.tilesAbsDir,
            info,
            z,
            te,
            width: opts.width,
            height: opts.height,
          });
          return { status: 200, contentType: 'image/png', body: new Uint8Array(buffer) };
        }
      }
    } catch {
      /* 타일 실패 시 원본 렌더로 */
    }
  }

  if (!src.absSource) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: ogcError('드론영상 원본 파일을 찾을 수 없습니다.', 'LayerNotDefined'),
    };
  }
  const rendered = await warpExtentToPng({
    absSource: src.absSource,
    te,
    width: opts.width,
    height: opts.height,
    targetEpsg: epsg,
    sourceEpsg: src.sourceCrs,
  });
  if (!rendered.ok) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: ogcError(rendered.error || '영상 렌더 실패'),
    };
  }
  return {
    status: 200,
    contentType: 'image/png',
    body: new Uint8Array(rendered.buffer),
  };
}

/** Capabilities에 넣을 Layer XML 조각 */
export function buildOrthoWmsLayerXml(item: {
  wmsLayerName: string;
  title: string;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}): string {
  const name = escapeXml(item.wmsLayerName);
  const title = escapeXml(item.title);
  return (
    `<Layer queryable="0" opaque="0">` +
    `<Name>${name}</Name>` +
    `<Title>${title}</Title>` +
    buildWmsExtentXml(item.minLon, item.minLat, item.maxLon, item.maxLat) +
    `</Layer>`
  );
}

/** WMS 1.3 Layer 공통 CRS·범위 XML (WGS84 범위 기준) */
export function buildWmsExtentXml(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number
): string {
  const box84 = {
    minx: minLon,
    miny: minLat,
    maxx: maxLon,
    maxy: maxLat,
  };
  const box3857 = wgs84ExtentToCrsBox(minLon, minLat, maxLon, maxLat, 'EPSG:3857');

  // 타일이 EPSG:3857 — 타 좌표계 프로젝트는 QGIS가 재투영
  return (
    `<CRS>EPSG:3857</CRS>` +
    `<EX_GeographicBoundingBox>` +
    `<westBoundLongitude>${minLon}</westBoundLongitude>` +
    `<eastBoundLongitude>${maxLon}</eastBoundLongitude>` +
    `<southBoundLatitude>${minLat}</southBoundLatitude>` +
    `<northBoundLatitude>${maxLat}</northBoundLatitude>` +
    `</EX_GeographicBoundingBox>` +
    bboxXml('CRS:84', box84) +
    (box3857 ? bboxXml('EPSG:3857', box3857) : '')
  );
}

export async function listOrthoExtentsForWmsCaps(
  readableLocals: Set<string>
): Promise<
  Array<{
    wmsLayerName: string;
    title: string;
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  }>
> {
  const { listCompletedOrthoExtents } = await import('@/service/aerialOrthoService');
  const { items } = await listCompletedOrthoExtents({ requireSession: false });
  return items.filter((it) => {
    const local = it.wmsLayerName;
    if (readableLocals.has(local)) return true;
    for (const r of readableLocals) {
      if (r === local || r.endsWith(`:${local}`)) return true;
    }
    return false;
  });
}

/** 권한 UI용 */
export async function listOrthoCatalogForPermissions(): Promise<
  Array<{ layerName: string; layerTitle: string; layerGroup: string }>
> {
  const { listCompletedOrthoExtents } = await import('@/service/aerialOrthoService');
  const { items } = await listCompletedOrthoExtents({ requireSession: false });
  return items.map((it) => ({
    layerName: it.wmsLayerName,
    layerTitle: it.title,
    layerGroup: '드론영상',
  }));
}
