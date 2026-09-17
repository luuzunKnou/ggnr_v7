/**
 * QGIS WMS GetMap — 드론영상(원본 TIF) PNG 렌더
 */
import proj4 from 'proj4';
import {
  parseOrthoWmsTuKey,
  resolveOrthoTifAbsPath,
} from '@/service/aerialOrthoService';
import { warpExtentToPng } from '@/service/orthophotoService';

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
  if (!te) {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: ogcError('BBOX가 올바르지 않습니다.', 'InvalidParameterValue'),
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
  const { minLon, minLat, maxLon, maxLat } = item;

  // WMS 1.3 EPSG:4326 = lat,lon 축순서
  const box4326 = {
    minx: minLat,
    miny: minLon,
    maxx: maxLat,
    maxy: maxLon,
  };
  const box84 = {
    minx: minLon,
    miny: minLat,
    maxx: maxLon,
    maxy: maxLat,
  };
  const box3857 = wgs84ExtentToCrsBox(minLon, minLat, maxLon, maxLat, 'EPSG:3857');
  const box5181 = wgs84ExtentToCrsBox(minLon, minLat, maxLon, maxLat, 'EPSG:5181');
  const box5186 = wgs84ExtentToCrsBox(minLon, minLat, maxLon, maxLat, 'EPSG:5186');

  return (
    `<Layer queryable="0" opaque="0">` +
    `<Name>${name}</Name>` +
    `<Title>${title}</Title>` +
    `<CRS>EPSG:4326</CRS>` +
    `<CRS>EPSG:3857</CRS>` +
    `<CRS>EPSG:5181</CRS>` +
    `<CRS>EPSG:5186</CRS>` +
    `<EX_GeographicBoundingBox>` +
    `<westBound>${minLon}</westBound>` +
    `<eastBound>${maxLon}</eastBound>` +
    `<southBound>${minLat}</southBound>` +
    `<northBound>${maxLat}</northBound>` +
    `</EX_GeographicBoundingBox>` +
    bboxXml('CRS:84', box84) +
    bboxXml('EPSG:4326', box4326) +
    (box3857 ? bboxXml('EPSG:3857', box3857) : '') +
    (box5181 ? bboxXml('EPSG:5181', box5181) : '') +
    (box5186 ? bboxXml('EPSG:5186', box5186) : '') +
    `</Layer>`
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
