import type {
  RoadNetworkOpenStatus,
  RoadNetworkOpenStatusFilter,
  RoadNetworkType,
  RoadNetworkTypeSelection,
} from "./roadNetworkMock";
import {
  isAllRoadNetworkTypes,
  matchesRoadNetworkTypeSelection,
} from "./roadNetworkMock";
import {
  ROAD_NETWORK_UNIFIED_LS,
  ROAD_NETWORK_UNIFIED_PS,
  featureIdInCql,
} from "./roadNetworkGrade";

/** legacy=종류별 rdl_* 테이블, unified=통합 rdl_network_ls(+표지 점) */
export type RoadNetworkSourceMode = "legacy" | "unified";

/** GeoServer·defineLayer 테이블명 — roadNetworkService SOURCES와 동일 */
export type RoadNetworkWmsSource = {
  table: string;
  roadType: RoadNetworkType;
  openStatus: RoadNetworkOpenStatus;
  /** 같은 표에 구분값으로 함께 들어 있는 종류 — 종류 필터 시 피처 id CQL로 거름 */
  sharedTypes?: readonly RoadNetworkType[];
};

const COUNTY_SHARED_TYPES: readonly RoadNetworkType[] = ["면도", "리도", "농도"];

export const ROAD_NETWORK_WMS_SOURCES: readonly RoadNetworkWmsSource[] = [
  { table: "rdl_national1_ls", roadType: "국도", openStatus: "개설" },
  { table: "rdl_national2_interc_ls", roadType: "입체교차로", openStatus: "개설" },
  { table: "rdl_nsprov_0610_ls", roadType: "국지도", openStatus: "개설" },
  { table: "rdl_prov_0610_ls", roadType: "지방도", openStatus: "개설" },
  {
    table: "rdl_county_opn_ls",
    roadType: "군도",
    openStatus: "개설",
    sharedTypes: COUNTY_SHARED_TYPES,
  },
  {
    table: "rdl_county_uopn_ls",
    roadType: "군도",
    openStatus: "미개설",
    sharedTypes: COUNTY_SHARED_TYPES,
  },
  { table: "rdl_perch_opn_ls", roadType: "농도", openStatus: "개설" },
  { table: "rdl_perch_uopn_ls", roadType: "농도", openStatus: "미개설" },
] as const;

/** 패널 소유 WMS — 종료 시 전부 끔 (통합 선 포함) */
export const ROAD_NETWORK_WMS_LAYER_IDS = [
  ...ROAD_NETWORK_WMS_SOURCES.map((s) => s.table),
  ROAD_NETWORK_UNIFIED_LS,
];

const ROAD_NETWORK_WMS_LAYER_ID_SET = new Set(
  ROAD_NETWORK_WMS_LAYER_IDS.map((id) => id.toLowerCase())
);

export function isRoadNetworkWmsLayerId(tableName: string): boolean {
  return ROAD_NETWORK_WMS_LAYER_ID_SET.has(
    String(tableName ?? "").trim().toLowerCase()
  );
}

/**
 * 통합 모드에서 선과 함께 켜는 노선번호 표지 점.
 * 점 테이블의 geometry 타입이 GEOMETRY라 짝 레이어 자동 추가가 동작하지 않아 패널이 직접 켠다.
 */
const ROAD_NETWORK_UNIFIED_WMS_LAYER_IDS = [ROAD_NETWORK_UNIFIED_LS, ROAD_NETWORK_UNIFIED_PS];

/** 패널이 켜고 끄는 전체 WMS (지도 클릭 선택 대상 + 표지 점) */
export const ROAD_NETWORK_OWNED_WMS_LAYER_IDS = [
  ...ROAD_NETWORK_WMS_LAYER_IDS,
  ROAD_NETWORK_UNIFIED_PS,
];

/** 모드별 켜는 전체 WMS 테이블 */
export function roadNetworkWmsLayerIdsForMode(mode: RoadNetworkSourceMode): string[] {
  return mode === "unified"
    ? [...ROAD_NETWORK_UNIFIED_WMS_LAYER_IDS]
    : ROAD_NETWORK_WMS_SOURCES.map((s) => s.table.toLowerCase());
}

function wmsSourceTypes(src: RoadNetworkWmsSource): RoadNetworkType[] {
  return [src.roadType, ...(src.sharedTypes ?? [])];
}

/** 목록 필터(종류·개설여부)에 맞는 WMS 테이블 — 통합 모드는 CQL로 거름 */
export function resolveRoadNetworkWmsLayerIds(
  opts: {
    typeFilter: RoadNetworkTypeSelection;
    openStatusFilter: RoadNetworkOpenStatusFilter;
  },
  mode: RoadNetworkSourceMode = "legacy"
): string[] {
  if (mode === "unified") return [...ROAD_NETWORK_UNIFIED_WMS_LAYER_IDS];
  const { typeFilter, openStatusFilter } = opts;
  return ROAD_NETWORK_WMS_SOURCES.filter((src) => {
    if (!wmsSourceTypes(src).some((t) => matchesRoadNetworkTypeSelection(t, typeFilter))) {
      return false;
    }
    if (openStatusFilter !== "전체" && src.openStatus !== openStatusFilter) {
      return false;
    }
    return true;
  }).map((src) => src.table.toLowerCase());
}

/**
 * 구분값이 섞인 표(군도 표)의 종류 필터 CQL — 목록 행 중 해당 종류의 피처 id만.
 * 표의 종류를 모두 고른 경우(전체 포함)는 조건 없음(null).
 */
export function buildRoadNetworkSharedTableCql(
  rows: readonly { id: string; roadType: RoadNetworkType }[],
  typeFilter: RoadNetworkTypeSelection
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const src of ROAD_NETWORK_WMS_SOURCES) {
    if (!src.sharedTypes) continue;
    const table = src.table.toLowerCase();
    if (
      isAllRoadNetworkTypes(typeFilter) ||
      wmsSourceTypes(src).every((t) => matchesRoadNetworkTypeSelection(t, typeFilter))
    ) {
      out[table] = null;
      continue;
    }
    const prefix = `${table}:`;
    const fids: number[] = [];
    for (const r of rows) {
      if (!r.id.toLowerCase().startsWith(prefix)) continue;
      if (!matchesRoadNetworkTypeSelection(r.roadType, typeFilter)) continue;
      const fid = Number(r.id.slice(prefix.length));
      if (Number.isFinite(fid)) fids.push(fid);
    }
    out[table] = featureIdInCql(table, fids);
  }
  return out;
}

/** identify 결과 → 목록 행 id (`table:ogc_fid`) */
export function buildRoadNetworkRowId(tableName: string, ogcFid: number): string {
  const table = String(tableName ?? "").trim().toLowerCase();
  return `${table}:${ogcFid}`;
}
