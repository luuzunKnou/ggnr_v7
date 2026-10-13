import type { Map } from 'ol';
import { RADIATION_SHELTER_GEO_TABLE } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { applySafetyMapGeoLayerCql } from '../applySafetyMapGeoLayerCql';
import { cqlIntersectsBoundaryWkt } from '@/lib/boundaryGeomCql';

function escCql(v: string): string {
  return v.replace(/'/g, "''");
}

export type RadiationShelterLayerFilter = {
  keyword?: string;
  /** 읍면동 경계 WKT(5181). 없으면 경계 조건 없음 */
  boundaryWkt?: string | null;
};

/** 목록 API 조건과 동일한 WMS CQL. 필터 없으면 null(전체 표시). */
export function buildRadiationShelterListCql(f: RadiationShelterLayerFilter): string | null {
  const parts: string[] = [];
  const kw = f.keyword?.trim();
  if (kw) {
    const e = escCql(kw);
    parts.push(
      `(ftn_nm ILIKE '%${e}%' OR addr ILIKE '%${e}%' OR remark ILIKE '%${e}%')`
    );
  }
  const boundary = cqlIntersectsBoundaryWkt(f.boundaryWkt);
  if (boundary) parts.push(boundary);
  if (parts.length === 0) return null;
  return parts.join(' AND ');
}

/** 방사선 대피소 GeoServer ImageWMS에 CQL_FILTER 반영·해제 */
export function applyRadiationShelterLayerCql(
  map: Map | null | undefined,
  cql: string | null
): void {
  applySafetyMapGeoLayerCql(map, RADIATION_SHELTER_GEO_TABLE, cql);
}
