/**
 * 하천·계곡 구역 내 불법 점용시설 관리카드 — 시제품 설정.
 * 영문 컬럼명은 DB팀 확정 전 임시값. 확정 자료를 받으면 RIVER_ILLEGAL_OCCUPATION_COLUMNS·
 * RIVER_ILLEGAL_STATUS_KINDS 의 column 만 바꾸면 화면은 그대로 쓴다.
 */

/** serviceList `ser_eng` */
export const RIVER_ILLEGAL_OCCUPATION_OPENED_KEY = "riverIllegalOccupation";

export const RIVER_ILLEGAL_OCCUPATION_PANEL_DEFAULT_WIDTH = 400;
export const RIVER_ILLEGAL_OCCUPATION_PANEL_MIN_WIDTH = 300;
export const RIVER_ILLEGAL_OCCUPATION_PANEL_MAX_WIDTH = 560;
export const RIVER_ILLEGAL_OCCUPATION_DETAIL_DEFAULT_WIDTH = 720;
export const RIVER_ILLEGAL_OCCUPATION_DETAIL_MIN_WIDTH = 600;
export const RIVER_ILLEGAL_OCCUPATION_DETAIL_MAX_WIDTH = 980;

/** 여러 줄 항목의 줄 구분자 (DB팀 합의) */
export const RIVER_ILLEGAL_LINE_SEPARATOR = "@";

/** 카드 기본 항목 — key: 화면용, column: 임시 DB 컬럼명 */
export const RIVER_ILLEGAL_OCCUPATION_COLUMNS = {
  serialNo: { label: "연번", column: "serial_no" },
  riverType: { label: "하천구분", column: "river_type" },
  firstCheckYmd: { label: "최초확인일자", column: "first_chk_ymd" },
  completeYmd: { label: "완료(예정)일자", column: "cmpl_ymd" },
  location: { label: "위치", column: "loc_adr" },
  /** 주소 검색·점 찍기로 정한 좌표(EPSG:4326) — 지도 표시·위치도 그림에 사용 */
  lon: { label: "경도", column: "lon" },
  lat: { label: "위도", column: "lat" },
  recurrence: { label: "재발여부", column: "recur_yn" },
  actor: { label: "행위자", column: "actor" },
  violation: { label: "위법내용", column: "viol_cn" },
  relatedLaw: { label: "관련법", column: "rel_law" },
  actionContent: { label: "조치내용", column: "act_cn" },
  actionPlan: { label: "조치계획", column: "act_plan" },
  manager: { label: "관리책임자", column: "mng_resp" },
  locationMapUrl: { label: "위치도", column: "loc_map_url" },
  photo1Url: { label: "현황사진", column: "photo1_url" },
  photo2Url: { label: "현황사진", column: "photo2_url" },
  completePhotoUrl: { label: "완료사진", column: "cmpl_photo_url" },
} as const;

export type RiverIllegalOccupationFieldKey = keyof typeof RIVER_ILLEGAL_OCCUPATION_COLUMNS;

/** «@»로 줄을 나누는 여러 줄 항목 */
export const RIVER_ILLEGAL_MULTILINE_FIELDS: RiverIllegalOccupationFieldKey[] = [
  "actor",
  "violation",
  "relatedLaw",
  "actionContent",
  "actionPlan",
  "manager",
];

export const RIVER_ILLEGAL_RIVER_TYPES = ["국가하천", "지방하천", "소하천", "계곡"] as const;
export const RIVER_ILLEGAL_RECURRENCE_OPTIONS = ["유", "무"] as const;

/** 조치현황 시설 종류 — column 은 임시 DB 컬럼 접두어 (+ _det 적발 / _act 조치 / _non 미조치) */
export const RIVER_ILLEGAL_STATUS_KINDS = [
  { key: "bench", label: "평상 등", column: "bench" },
  { key: "shade", label: "그늘막", column: "shade" },
  { key: "bungalow", label: "방갈로", column: "bungalow" },
  { key: "building", label: "건축물", column: "bldg" },
  { key: "farming", label: "불법경작", column: "farm" },
  { key: "deck", label: "데크 등", column: "deck" },
  { key: "landChange", label: "형질변경", column: "land_chg" },
  { key: "storage", label: "물건적치", column: "storage" },
  { key: "vinylHouse", label: "비닐하우스", column: "vinyl" },
  { key: "etc", label: "기타", column: "etc" },
] as const;

export type RiverIllegalStatusKindKey = (typeof RIVER_ILLEGAL_STATUS_KINDS)[number]["key"];

export const RIVER_ILLEGAL_STATUS_ROWS = [
  { key: "detected", label: "적발", suffix: "_det" },
  { key: "acted", label: "조치", suffix: "_act" },
  { key: "notActed", label: "미조치", suffix: "_non" },
] as const;

export type RiverIllegalStatusRowKey = (typeof RIVER_ILLEGAL_STATUS_ROWS)[number]["key"];
