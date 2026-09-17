import type { Map } from 'ol';
import { WATER_PLAY_SIGN_GEO_TABLE } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { applySafetyMapGeoLayerCql } from '../applySafetyMapGeoLayerCql';
import { cqlIntersectsBoundaryWkt } from '@/lib/boundaryGeomCql';

function escCql(v: string): string {
  return v.replace(/'/g, "''");
}

export type WaterPlaySignLayerFilter = {
  keyword?: string;
  gubun?: string;
  /** 읍면동/리 경계 WKT(5181). 없으면 경계 조건 없음 */
  boundaryWkt?: string | null;
};

/** 목록 API 조건과 동일한 WMS CQL. 필터 없으면 null(전체 표시). */
export function buildWaterPlaySignListCql(f: WaterPlaySignLayerFilter): string | null {
  const parts: string[] = [];
  const kw = f.keyword?.trim();
  if (kw) {
    const e = escCql(kw);
    parts.push(
      `(sido ILIKE '%${e}%' OR sgg ILIKE '%${e}%' OR addr ILIKE '%${e}%' OR addr_detail ILIKE '%${e}%' OR concatenate(addr, ' ', addr_detail) ILIKE '%${e}%' OR gubun ILIKE '%${e}%' OR remark ILIKE '%${e}%')`
    );
  }
  const boundary = cqlIntersectsBoundaryWkt(f.boundaryWkt);
  if (boundary) parts.push(boundary);
  const gubun = f.gubun?.trim();
  if (gubun) parts.push(`gubun = '${escCql(gubun)}'`);
  if (parts.length === 0) return null;
  return parts.join(' AND ');
}

/** 물놀이 표지판 GeoServer ImageWMS에 CQL_FILTER 반영·해제 */
export function applyWaterPlaySignLayerCql(
  map: Map | null | undefined,
  cql: string | null
): void {
  applySafetyMapGeoLayerCql(map, WATER_PLAY_SIGN_GEO_TABLE, cql);
}
