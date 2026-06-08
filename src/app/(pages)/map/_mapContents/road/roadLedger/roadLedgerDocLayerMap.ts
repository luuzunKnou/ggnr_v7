/**
 * 도로대장 상세 문서/구분 버튼 → define_table_name(GeoServer 레이어 id) 목록.
 * 출처: 공간정보 코드표(R01~R49) — 레이어 키는 WMS/레이어 목록과 동일하게 소문자 사용.
 */

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

/**
 * 클릭 시 켜지는 레이어 id 배열. 비어 있으면 공간 레이어 없음(안내용).
 * - 보고서: UI만 (도로대장총괄 a0020000 등과 연동 없음, 레이어 토글 없음)
 * - 주요시설: R02~R07, R15 (교량·터널·육교·지하차도·고가도로·IC·지하보도)
 * - 기하구조: R08,R16~R19 (교차시설·도로중심선교점·오르막차로·종단경사·정차대)
 * - 배수시설: R11,R12,R13,R14,R20,R21 (석축·옹벽·절개·성토·측구·배수암거)
 * - 부대시설: R29~R35,R37~R39 (방음~졸음쉼터, 생태통로 포함)
 * - 안전시설: R10,R22~R28
 * - 기타시설: R40~R49 (점용 3종 분리)
 */
export const ROAD_LEDGER_DOC_LAYERS: Record<RoadLedgerDocButtonKey, string[]> = {
  보고서: [],
  /** 공간 레이어 매핑 전 — UI만 */
  도로영상: [],
  /** 지하매설물 R31 */
  매설물도: ["c0246120"],
  종평면도: [],
  용지도: [],

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
    "c0246120",
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

/** 도로대장 문서 버튼에 매핑된 define_table_name 전체(중복 제거, 소문자) */
export function getAllRoadLedgerDocLayerIds(): string[] {
  const s = new Set<string>();
  for (const layers of Object.values(ROAD_LEDGER_DOC_LAYERS)) {
    for (const id of layers) {
      const t = String(id ?? "").trim().toLowerCase();
      if (t) s.add(t);
    }
  }
  return [...s];
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
