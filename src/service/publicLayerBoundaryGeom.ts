/**
 * public_layer 읍면동·리 경계(5181 WKT) — 목록 ST_Intersects·WMS CQL 공통.
 */
import { getEmdGeometry, getRiGeometry } from './devTestService';

/** 리 코드 우선, 없으면 읍면동 코드. 둘 다 없으면 null. */
export async function resolveBoundaryWkt5181(opts: {
  emdCode?: string | null;
  riCode?: string | null;
}): Promise<string | null> {
  const riCode = String(opts.riCode ?? '').trim();
  if (riCode) {
    const r = await getRiGeometry({ riCode });
    const wkt = r.wkt != null ? String(r.wkt).trim() : '';
    return wkt || null;
  }
  const emdCode = String(opts.emdCode ?? '').trim();
  if (emdCode) {
    const r = await getEmdGeometry({ emdCode });
    const wkt = r.wkt != null ? String(r.wkt).trim() : '';
    return wkt || null;
  }
  return null;
}

/** `alias.geom`(EPSG:5181) ∩ 경계 WKT — `$n` 바인딩. */
export function sqlIntersectsBoundaryWkt(aliasGeom: string, paramIndex: number): string {
  return `ST_Intersects(${aliasGeom}, ST_GeomFromText($${paramIndex}, 5181))`;
}

