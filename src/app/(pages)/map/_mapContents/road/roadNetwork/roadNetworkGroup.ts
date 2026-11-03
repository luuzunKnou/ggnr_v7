import GeoJSONFormat from "ol/format/GeoJSON";
import { createEmpty, extend, isEmpty } from "ol/extent";
import {
  isNewRoadNetworkRowId,
  type RoadNetworkGeom,
  type RoadNetworkRow,
} from "./roadNetworkMock";

/** 도로망도 목록 묶음 — 통합 도로망은 «등급+노선번호»가 같은 구간을 한 행으로 */

export type RoadNetworkRowGroup = {
  key: string;
  rows: RoadNetworkRow[];
};

/** 통합 도로망이고 번호가 있으면 등급+번호, 아니면 구간 단독 */
export function roadNetworkGroupKey(row: RoadNetworkRow): string {
  const no = row.roadNo.trim();
  if (row.roadGrade === undefined || !no) return `id:${row.id}`;
  return `no:${row.roadGrade}|${no}`;
}

/** 입력 순서를 유지하며 묶는다 (그룹 위치 = 첫 구간 위치) */
export function groupRoadNetworkRows(rows: RoadNetworkRow[]): RoadNetworkRowGroup[] {
  const byKey = new Map<string, RoadNetworkRowGroup>();
  const out: RoadNetworkRowGroup[] = [];
  for (const row of rows) {
    const key = roadNetworkGroupKey(row);
    const g = byKey.get(key);
    if (g) {
      g.rows.push(row);
      continue;
    }
    const next = { key, rows: [row] };
    byKey.set(key, next);
    out.push(next);
  }
  return out;
}

/** 선택 구간과 같은 노선의 저장된 구간 전체 (자기 자신 포함, 목록 순서) */
export function roadNetworkSiblingSegments(
  rows: RoadNetworkRow[],
  row: RoadNetworkRow
): RoadNetworkRow[] {
  if (isNewRoadNetworkRowId(row.id)) return [row];
  const key = roadNetworkGroupKey(row);
  if (key.startsWith("id:")) return [row];
  return rows.filter((r) => !isNewRoadNetworkRowId(r.id) && roadNetworkGroupKey(r) === key);
}

/**
 * 목록 필터(종류·개설·검색·범위)를 통과한 구간 중 같은 노선 구간.
 * 선택 구간이 필터 밖이면(지도 클릭 등) 전체 구간 기준.
 */
export function roadNetworkVisibleSiblingSegments(
  allRows: RoadNetworkRow[],
  visibleRows: RoadNetworkRow[] | null | undefined,
  row: RoadNetworkRow
): RoadNetworkRow[] {
  if (visibleRows && visibleRows.some((r) => r.id === row.id)) {
    return roadNetworkSiblingSegments(visibleRows, row);
  }
  return roadNetworkSiblingSegments(allRows, row);
}

/** 여러 구간 도형을 합친 EPSG:3857 범위 */
export function extent3857FromRoadNetworkGeoms(
  geoms: (RoadNetworkGeom | null | undefined)[]
): [number, number, number, number] | null {
  const format = new GeoJSONFormat();
  const ext = createEmpty();
  for (const geom of geoms) {
    if (!geom) continue;
    try {
      const g = format.readGeometry(geom, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      });
      if (g) extend(ext, g.getExtent());
    } catch {
      // 잘못된 도형은 범위 계산에서 제외
    }
  }
  if (isEmpty(ext) || !ext.every((v) => Number.isFinite(v))) return null;
  return ext as [number, number, number, number];
}
