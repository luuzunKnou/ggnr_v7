import type {
  RoadNetworkOpenStatus,
  RoadNetworkOpenStatusFilter,
  RoadNetworkType,
  RoadNetworkTypeFilter,
} from "./roadNetworkMock";
import { matchesRoadNetworkTypeFilter } from "./roadNetworkMock";

/** GeoServer·defineLayer 테이블명 — roadNetworkService SOURCES와 동일 */
export type RoadNetworkWmsSource = {
  table: string;
  roadType: RoadNetworkType;
  openStatus: RoadNetworkOpenStatus;
};

export const ROAD_NETWORK_WMS_SOURCES: readonly RoadNetworkWmsSource[] = [
  { table: "rdl_national1_ls", roadType: "국도", openStatus: "개설" },
  { table: "rdl_national2_interc_ls", roadType: "입체교차로", openStatus: "개설" },
  { table: "rdl_nsprov_0610_ls", roadType: "국지도", openStatus: "개설" },
  { table: "rdl_prov_0610_ls", roadType: "지방도", openStatus: "개설" },
  { table: "rdl_county_opn_ls", roadType: "군도", openStatus: "개설" },
  { table: "rdl_county_uopn_ls", roadType: "군도", openStatus: "미개설" },
  { table: "rdl_perch_opn_ls", roadType: "농도", openStatus: "개설" },
  { table: "rdl_perch_uopn_ls", roadType: "농도", openStatus: "미개설" },
  { table: "rdl_sprd_0610_ls", roadType: "일반도로", openStatus: "개설" },
  { table: "rdl_frl_0610_ls", roadType: "임도", openStatus: "개설" },
] as const;

/** 패널 소유 WMS — 종료 시 전부 끔 */
export const ROAD_NETWORK_WMS_LAYER_IDS = ROAD_NETWORK_WMS_SOURCES.map((s) => s.table);

const ROAD_NETWORK_WMS_LAYER_ID_SET = new Set(
  ROAD_NETWORK_WMS_LAYER_IDS.map((id) => id.toLowerCase())
);

export function isRoadNetworkWmsLayerId(tableName: string): boolean {
  return ROAD_NETWORK_WMS_LAYER_ID_SET.has(
    String(tableName ?? "").trim().toLowerCase()
  );
}

/** 목록 필터(종류·개설여부)에 맞는 WMS 테이블 */
export function resolveRoadNetworkWmsLayerIds(opts: {
  typeFilter: RoadNetworkTypeFilter;
  openStatusFilter: RoadNetworkOpenStatusFilter;
}): string[] {
  const { typeFilter, openStatusFilter } = opts;
  return ROAD_NETWORK_WMS_SOURCES.filter((src) => {
    if (!matchesRoadNetworkTypeFilter(src.roadType, typeFilter)) return false;
    if (openStatusFilter !== "전체" && src.openStatus !== openStatusFilter) {
      return false;
    }
    return true;
  }).map((src) => src.table.toLowerCase());
}

/** identify 결과 → 목록 행 id (`table:ogc_fid`) */
export function buildRoadNetworkRowId(tableName: string, ogcFid: number): string {
  const table = String(tableName ?? "").trim().toLowerCase();
  return `${table}:${ogcFid}`;
}
