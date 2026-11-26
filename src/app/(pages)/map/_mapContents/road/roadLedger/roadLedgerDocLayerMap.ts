/**
 * 도로대장 상세 문서/구분 버튼 → define_table_name(GeoServer 레이어 id) 목록.
 * 출처: 공간정보 코드표(R01~R49) — 레이어 키는 WMS/레이어 목록과 동일하게 소문자 사용.
 */

import {
  MAP_SERVICE_WMS_LAYER_ALIAS,
  applyMapServiceWmsLayerAlias,
} from "@/lib/mapServiceWmsAlias";

/** 도로대장 총괄(노선, RDID 기준) define/WMS 레이어 id */
export const ROAD_LEDGER_SUMMARY_LAYER_ID = "a0020000";

/** 버튼 라벨(RoadLedgerDetailPanel DOC_ACTION_BUTTONS와 동일) */
export type RoadLedgerDocButtonKey =
  | "보고서"
  | "도로영상"
  | "매설물도"
  | "종평면도"
  | "용지도"
  | "주요시설"
  | "기하구조"
  | "배수시설"
  | "부대시설"
  | "안전시설"
  | "기타시설";

/** UI에서 `주요시설 (N)` 형태로 표시할 버튼 — N은 레이어 개수가 아니라 노선별 실데이터 건수(API) */
export const ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT: readonly RoadLedgerDocButtonKey[] = [
  "주요시설",
  "안전시설",
  "부대시설",
  "배수시설",
  "기타시설",
  "기하구조",
] as const;

/** 도면 구분 — 목록·상세(첨부 미리보기)로 표시. 시설 구분과 같은 RDID 조인으로 건수·목록 조회 */
export const ROAD_LEDGER_DRAWING_LABELS: readonly RoadLedgerDocButtonKey[] = [
  "매설물도",
  "종평면도",
  "용지도",
] as const;

/** 버튼 건수·하단 탭 대상 전체(시설 + 도면) */
export const ROAD_LEDGER_DOC_LIST_GROUP_LABELS: readonly RoadLedgerDocButtonKey[] = [
  ...ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT,
  ...ROAD_LEDGER_DRAWING_LABELS,
];

/** 도면 첨부 폴더·목록 분할코드 필드. 레이어 관리 키(ogc_fid)와 별개 */
export const ROAD_LEDGER_DRAWING_FILE_KEY_FIELD = "cons_code";

export function isRoadLedgerDrawingGroup(key: string): boolean {
  return (ROAD_LEDGER_DRAWING_LABELS as readonly string[]).includes(key);
}

/**
 * 클릭 시 켜지는 레이어 id 배열. 비어 있으면 공간 레이어 없음(안내용).
 * - 보고서: 레이어 토글 없음. 도로대장총괄(a0020000) 첨부 PDF (첨부 키 rdid)
 * - 매설물도·종평면도·용지도: 도면 구역 레이어(첨부 키 cons_code)
 * - 주요시설: R02~R07, R15 (교량·터널·육교·지하차도·고가도로·IC·지하보도)
 * - 기하구조: R08,R16~R19 (교차시설·도로중심선교점·오르막차로·종단경사·정차대)
 * - 배수시설: R11,R12,R13,R14,R20,R21 (석축·옹벽·절개·성토·측구·배수암거)
 * - 부대시설: R29~R35,R37~R39 (방음~졸음쉼터, 생태통로 포함 — 지하매설물 제외)
 * - 안전시설: R10,R22~R28
 * - 기타시설: R40~R49 (점용 3종 분리)
 */
export const ROAD_LEDGER_DOC_LAYERS: Record<RoadLedgerDocButtonKey, string[]> = {
  보고서: [],
  /** 레이어 없음. 보고서와 같은 첨부 폴더의 360° mp4 */
  도로영상: [],
  매설물도: ["ks_rd_jm_lm"],
  종평면도: ["ks_rd_jp_lm"],
  용지도: ["ks_rd_yj_lm"],

  주요시설: [
    "a0070000",
    "a0110020",
    "a0063321",
    "a0093352",
    "a0093351",
    "a0100000",
    "a9093353",
  ],

  기하구조: ["a9990001", "a0080000", "a9990002", "a9990003", "a9053327"],

  배수시설: ["c0076117", "f9047226", "f9047224", "f9037222", "f9037221", "c9070001"],

  부대시설: [
    "c0536114",
    "d0023372",
    "c0246341",
    "c9530006",
    "c9530007",
    "c9530008",
    "c9530009",
    "c9530002",
    "c9530003",
    "c9530004",
  ],

  안전시설: [
    "c0520000",
    "c9530005",
    "c0410000",
    "c9413426",
    "c0223367",
    "c0493376",
    "c0530000",
    "c9530001",
  ],

  기타시설: [
    "a9990011",
    "a9990007",
    "a9990008",
    "a9990009",
    "a9990010",
    "a9990004",
    "a9990005",
    "a9990006",
    "a9990012",
    "a9990013",
  ],
};

/**
 * RDID 27자리(코드표): 레이어(3) + 도로등급(4) + 관리기관(5) + 노선번호(4) + 구간번호(3) + 부여연도(4) + 일련번호(4).
 * 도로대장총괄 ↔ 시설 조인: 레이어 3글자 제외, 코드표 **4~19번째(1-based)** = 도로등급~구간번호 **16자** 동일.
 */
export const ROAD_LEDGER_RDID_FULL_LEN = 27;
/** 레이어 분류 길이 — 조인 키에서 제외 */
export const ROAD_LEDGER_RDID_LAYER_LEN = 3;
/** 도로등급(4)+관리기관(5)+노선(4)+구간(3) */
export const ROAD_LEDGER_RDID_JOIN_SEGMENT_LEN = 16;
/** 구간번호까지 포함하려면 RDID 최소 19자 (1-based 19번째까지) */
export const ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN = 19;

/**
 * 시설 목록·건수는 원본 테이블, 지도 WMS만 선형 뷰 등으로 대체.
 * key/value 모두 define_table_name(소문자).
 */
export const ROAD_LEDGER_DOC_WMS_LAYER_ALIAS: Record<string, string> =
  MAP_SERVICE_WMS_LAYER_ALIAS;

/** 문서 버튼 레이어 id → 실제 WMS 레이어 id */
export function resolveRoadLedgerDocWmsLayerId(id: string): string {
  return applyMapServiceWmsLayerAlias(id).toLowerCase();
}

export function resolveRoadLedgerDocWmsLayers(layers: string[]): string[] {
  return layers.map((id) => resolveRoadLedgerDocWmsLayerId(id)).filter(Boolean);
}

/**
 * 지도 WMS용 id. 별칭이 정의돼 있으면 기본적으로 별칭.
 * existingIds에 별칭이 없고 원본만 있을 때만 원본으로 폴백.
 * 속성 목록·건수 조회는 항상 원본(source) id를 쓴다.
 */
export function resolveRoadLedgerDocWmsLayerIdWithFallback(
  id: string,
  existingIds?: Set<string> | null
): string {
  const src = String(id ?? "").trim().toLowerCase();
  if (!src) return src;
  const wms = resolveRoadLedgerDocWmsLayerId(src);
  if (wms === src) return src;
  if (existingIds && !existingIds.has(wms) && existingIds.has(src)) return src;
  return wms;
}

/** 시설관리·도로대장 체크박스: 지도에 해당 시설이 켜져 있는지 */
export function isRoadLedgerDocLayerVisibleOnMap(
  visible: Set<string>,
  sourceTable: string,
  existingIds?: Set<string> | null
): boolean {
  const src = String(sourceTable ?? "").trim().toLowerCase();
  if (!src) return false;
  const wms = resolveRoadLedgerDocWmsLayerIdWithFallback(src, existingIds);
  // 별칭 모드: 원본 면형만 켜진 상태는 «아직 선형으로 안 바뀜»으로 보고 false
  if (wms !== src) return visible.has(wms);
  return visible.has(src);
}

/** 시설관리·도로대장 체크박스: 지도 WMS on/off (별칭 있으면 원본 면형은 끔) */
export function setRoadLedgerDocLayerVisibleOnMap(
  prev: Set<string>,
  sourceTable: string,
  checked: boolean,
  existingIds?: Set<string> | null
): Set<string> {
  const next = new Set(prev);
  const src = String(sourceTable ?? "").trim().toLowerCase();
  if (!src) return next;
  const wms = resolveRoadLedgerDocWmsLayerIdWithFallback(src, existingIds);
  if (checked) {
    next.add(wms);
    if (wms !== src) next.delete(src);
  } else {
    next.delete(wms);
    next.delete(src);
  }
  return next;
}

/** 켜져 있는 원본 면형을 WMS 별칭(선형 등)으로 교체. 별칭이 명시적으로 없을 때만 유지. */
export function migrateRoadLedgerDocWmsAliasesInVisible(
  prev: Set<string>,
  existingIds?: Set<string> | null
): Set<string> {
  let changed = false;
  const next = new Set(prev);
  for (const [src, wms] of Object.entries(ROAD_LEDGER_DOC_WMS_LAYER_ALIAS)) {
    const s = src.toLowerCase();
    const w = wms.toLowerCase();
    if (existingIds && !existingIds.has(w) && existingIds.has(s)) continue;
    if (!next.has(s)) continue;
    next.delete(s);
    next.add(w);
    changed = true;
  }
  return changed ? next : prev;
}

/** 도로대장 문서 버튼에 매핑된 define_table_name 전체(중복 제거, 소문자). WMS 별칭 포함. */
export function getAllRoadLedgerDocLayerIds(): string[] {
  const s = new Set<string>();
  for (const layers of Object.values(ROAD_LEDGER_DOC_LAYERS)) {
    for (const id of layers) {
      const t = String(id ?? "").trim().toLowerCase();
      if (!t) continue;
      s.add(t);
      s.add(resolveRoadLedgerDocWmsLayerId(t));
    }
  }
  return [...s];
}

/** 주요시설~기타시설 레이어 id만(도면 제외, 소문자) */
export function getAllRoadLedgerFacilityLayerIds(): string[] {
  const s = new Set<string>();
  for (const key of ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT) {
    for (const id of ROAD_LEDGER_DOC_LAYERS[key]) {
      const t = String(id ?? "").trim().toLowerCase();
      if (t) s.add(t);
    }
  }
  return [...s];
}

/** 도면 구분 레이어 id인지(소문자 비교) */
export function isRoadLedgerDrawingLayerId(id: string): boolean {
  const t = String(id ?? "").trim().toLowerCase();
  if (!t) return false;
  return ROAD_LEDGER_DRAWING_LABELS.some((key) =>
    ROAD_LEDGER_DOC_LAYERS[key].some((x) => x.toLowerCase() === t)
  );
}

export function isRoadLedgerDocGroupActive(
  visible: Set<string>,
  layers: string[]
): boolean {
  if (layers.length === 0) return false;
  return layers.every((id) => visible.has(id));
}

export function toggleRoadLedgerDocLayers(
  prev: Set<string>,
  layers: string[]
): Set<string> {
  if (layers.length === 0) return prev;
  const next = new Set(prev);
  const allOn = layers.every((id) => next.has(id));
  if (allOn) {
    layers.forEach((id) => next.delete(id));
  } else {
    layers.forEach((id) => next.add(id));
  }
  return next;
}
