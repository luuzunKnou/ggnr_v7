import type {
  RoadNetworkOpenStatus,
  RoadNetworkOpenStatusFilter,
  RoadNetworkType,
  RoadNetworkTypeSelection,
} from "./roadNetworkMock";
import {
  isAllRoadNetworkTypes,
  isLocalRoadType,
  matchesRoadNetworkTypeSelection,
} from "./roadNetworkMock";

/** 통합 도로망 — 선(등급·번호·선종류)과 노선번호 표지 점 */
export const ROAD_NETWORK_UNIFIED_LS = "rdl_network_ls";
export const ROAD_NETWORK_UNIFIED_PS = "rdl_network_ps";

/** 통합 선 layer 컬럼의 등급 (미개설은 면·리·농도만 `(파선)` 접미) */
export const ROAD_NETWORK_GRADES = [
  "고속도로",
  "국도",
  "국가지원지방도",
  "지방도",
  "시군도",
  "면도",
  "리도",
  "농도",
  "철도",
] as const;
export type RoadNetworkGrade = (typeof ROAD_NETWORK_GRADES)[number];

const GRADE_TO_TYPE: Record<RoadNetworkGrade, RoadNetworkType> = {
  고속도로: "국도",
  국도: "국도",
  국가지원지방도: "지방도",
  지방도: "지방도",
  시군도: "군도",
  면도: "면도",
  리도: "리도",
  농도: "농도",
  철도: "철도",
};

const DASH_SUFFIX = "(파선)";
const UNOPENED_LINETYPES = ["파선", "점선"] as const;
/** 저장 시 미개설 등급 문자열에 `(파선)`을 붙이는 등급 */
const DASH_SUFFIX_GRADES = new Set<RoadNetworkGrade>(["면도", "리도", "농도"]);

/** `리도(파선)` → `리도` */
export function baseRoadNetworkGrade(layerValue: unknown): string {
  const s = String(layerValue ?? "").trim();
  return s.endsWith(DASH_SUFFIX) ? s.slice(0, -DASH_SUFFIX.length).trim() : s;
}

export function roadNetworkTypeFromGrade(grade: string): RoadNetworkType {
  return GRADE_TO_TYPE[grade as RoadNetworkGrade] ?? "군도";
}

export function roadNetworkOpenStatusFromLine(
  layerValue: unknown,
  linetype: unknown
): RoadNetworkOpenStatus {
  const layer = String(layerValue ?? "").trim();
  const lt = String(linetype ?? "").trim();
  if (layer.endsWith(DASH_SUFFIX)) return "미개설";
  return (UNOPENED_LINETYPES as readonly string[]).includes(lt) ? "미개설" : "개설";
}

/** 저장용 layer·linetype 값 */
export function roadNetworkLineAttrsForSave(
  grade: string,
  openStatus: RoadNetworkOpenStatus,
  prevLinetype?: string | null
): { layer: string; linetype: string } {
  const base = baseRoadNetworkGrade(grade);
  if (openStatus !== "미개설") return { layer: base, linetype: "실선" };
  const prev = String(prevLinetype ?? "").trim();
  const linetype = (UNOPENED_LINETYPES as readonly string[]).includes(prev) ? prev : "파선";
  const layer = DASH_SUFFIX_GRADES.has(base as RoadNetworkGrade) ? `${base}${DASH_SUFFIX}` : base;
  return { layer, linetype };
}

/** 표지 점 layer 값 → 도로종류 (선과 표기가 다름: 시군구, 면리농도_읍면명) */
export function roadNetworkTypeFromSignLayer(layerValue: unknown): RoadNetworkType | null {
  const s = String(layerValue ?? "").trim();
  if (s.startsWith("면리농도")) return "농도";
  if (s === "시군구") return "군도";
  const base = baseRoadNetworkGrade(s);
  return (ROAD_NETWORK_GRADES as readonly string[]).includes(base)
    ? roadNetworkTypeFromGrade(base)
    : null;
}

export type RoadNetworkSignIndexItem = {
  ogcFid: number;
  roadType: RoadNetworkType | null;
  /** 짝 선 ogc_fid — 같은 등급·번호 중 가장 가까운 선. 못 찾으면 null */
  lineFid?: number | null;
};

/**
 * 피처 ID 목록 CQL. 한글 리터럴 CQL은 GeoServer 요청 인코딩에 따라 깨질 수 있어 ID로 거른다.
 * 빈 목록이면 EXCLUDE.
 */
export function featureIdInCql(table: string, ogcFids: number[]): string {
  if (ogcFids.length === 0) return "EXCLUDE";
  return `IN (${ogcFids.map((n) => `'${table}.${n}'`).join(",")})`;
}

function ogcFidFromRowId(id: string): number | null {
  const m = /^rdl_network_ls:(\d+)$/i.exec(String(id ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** 통합 선 레이어 CQL — 목록 행 중 종류·개설 필터에 맞는 것만. 필터 없으면 null */
export function buildRoadNetworkUnifiedLineCql(
  rows: readonly { id: string; roadType: RoadNetworkType; openStatus: RoadNetworkOpenStatus }[],
  opts: {
    typeFilter: RoadNetworkTypeSelection;
    openStatusFilter: RoadNetworkOpenStatusFilter;
  }
): string | null {
  if (isAllRoadNetworkTypes(opts.typeFilter) && opts.openStatusFilter === "전체") return null;
  const fids: number[] = [];
  for (const r of rows) {
    const fid = ogcFidFromRowId(r.id);
    if (fid == null) continue;
    if (!matchesRoadNetworkTypeSelection(r.roadType, opts.typeFilter)) continue;
    if (opts.openStatusFilter !== "전체" && r.openStatus !== opts.openStatusFilter) continue;
    fids.push(fid);
  }
  return featureIdInCql(ROAD_NETWORK_UNIFIED_LS, fids);
}

/**
 * 통합 표지 점 레이어 CQL — 짝 선과 같은 노선(등급+번호, 농도는 읍면까지) 구간 중 하나라도 필터(종류·개설)를 통과하면 표시.
 * 표지가 실선 구간 옆에 있어도 그 노선에 미개설 구간이 있으면 미개설 필터에서 보인다.
 * 짝 선을 못 찾은 표지는 종류 필터만 적용하고 개설 필터 중에는 숨긴다. 필터 없으면 null
 */
export function buildRoadNetworkUnifiedSignCql(
  signs: readonly RoadNetworkSignIndexItem[],
  rows: readonly {
    id: string;
    roadType: RoadNetworkType;
    openStatus: RoadNetworkOpenStatus;
    roadGrade?: string;
    roadNo: string;
    address?: string;
  }[],
  opts: {
    typeFilter: RoadNetworkTypeSelection;
    openStatusFilter: RoadNetworkOpenStatusFilter;
  }
): string | null {
  if (isAllRoadNetworkTypes(opts.typeFilter) && opts.openStatusFilter === "전체") return null;
  /** 면·리·농도 번호는 읍면마다 따로 매겨져 읍면까지 같아야 같은 노선 */
  const routeKey = (r: (typeof rows)[number]) =>
    `${r.roadGrade ?? ""}|${r.roadNo.trim()}|${isLocalRoadType(r.roadType) ? (r.address ?? "").trim() : ""}`;
  const rowByFid = new Map<number, (typeof rows)[number]>();
  const passedRoutes = new Set<string>();
  for (const r of rows) {
    const fid = ogcFidFromRowId(r.id);
    if (fid != null) rowByFid.set(fid, r);
    if (
      matchesRoadNetworkTypeSelection(r.roadType, opts.typeFilter) &&
      (opts.openStatusFilter === "전체" || r.openStatus === opts.openStatusFilter)
    ) {
      passedRoutes.add(routeKey(r));
    }
  }
  const fids = signs
    .filter((s) => {
      const line = s.lineFid != null ? rowByFid.get(s.lineFid) : undefined;
      if (!line) {
        if (opts.openStatusFilter !== "전체" || s.roadType == null) return false;
        // 면리농도 표지는 면도·리도·농도 구분이 없어 셋 중 어느 필터에도 보인다
        if (s.roadType === "농도" && !isAllRoadNetworkTypes(opts.typeFilter)) {
          return opts.typeFilter.some((f) => isLocalRoadType(f as RoadNetworkType));
        }
        return matchesRoadNetworkTypeSelection(s.roadType, opts.typeFilter);
      }
      return passedRoutes.has(routeKey(line));
    })
    .map((s) => s.ogcFid);
  return featureIdInCql(ROAD_NETWORK_UNIFIED_PS, fids);
}
