/**
 * 하천·계곡 구역 내 불법 점용시설 관리카드.
 * 영문 컬럼명(`column`)은 DBF·레이어정의서(수정사항) 기준.
 * 최초확인·완료일자는 화면에서 날짜 한 칸으로 다루고,
 * SHP/DB 수신 시 FIRST_Y/M/D · END_Y/M/D · END_YN 로 나눈다(구 FIRST_DT/END_DT 도 읽기 호환).
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

/**
 * 카드 기본 항목 — key: 화면용, column: DBF·레이어정의서 영문 컬럼명.
 * 일자 화면 키(firstCheckYmd·completeYmd)는 SHP/DB 저장 시 FIRST_Y/M/D·END_Y/M/D 로 나눈다.
 * column 의 FIRST_DT/END_DT 는 구 DBF 합친 일자 읽기용 이름.
 */
export const RIVER_ILLEGAL_OCCUPATION_COLUMNS = {
  mgmtNo: { label: "관리번호", column: "MGMT_NO" },
  serialNo: { label: "연번", column: "SEQ_NO" },
  riverType: { label: "하천구분", column: "RIVER_TP" },
  /** 화면용 합친 날짜 — 저장은 FIRST_Y / FIRST_M / FIRST_D */
  firstCheckYmd: { label: "최초확인일자", column: "FIRST_DT" },
  /** 화면용 합친 날짜 — 저장은 END_Y / END_M / END_D */
  completeYmd: { label: "완료(예정)일자", column: "END_DT" },
  /** 완료 여부 — END_YN (Y/N). 상세 표 완료일자 옆 체크 */
  completeYn: { label: "완료", column: "END_YN" },
  location: { label: "위치", column: "LOCATION" },
  pnu: { label: "PNU", column: "PNU" },
  /** 주소 검색·점 찍기 좌표(EPSG:4326) — 지도·위치도용 (레이어 정의 외 앱 확장) */
  lon: { label: "경도", column: "lon" },
  lat: { label: "위도", column: "lat" },
  recurrence: { label: "재발여부", column: "RECUR_YN" },
  actor: { label: "행위자", column: "ACTOR" },
  violation: { label: "위법내용", column: "VIOL_DESC" },
  relatedLaw: { label: "관련법", column: "REL_LAW" },
  actionContent: { label: "조치내용", column: "ACT_DESC" },
  actionPlan: { label: "조치계획", column: "ACT_PLAN" },
  manager: { label: "관리책임자", column: "MANAGER" },
  locationMapUrl: { label: "위치도", column: "MAP_IMG" },
  photo1Url: { label: "현황사진", column: "PHOTO1" },
  photo2Url: { label: "현황사진", column: "PHOTO2" },
  completePhotoUrl: { label: "완료사진", column: "PHOTO_END" },
} as const;

export type RiverIllegalOccupationFieldKey = keyof typeof RIVER_ILLEGAL_OCCUPATION_COLUMNS;

/** 최초확인일자 → DB 년/월/일 컬럼 */
export const RIVER_ILLEGAL_FIRST_DATE_DB = {
  y: "FIRST_Y",
  m: "FIRST_M",
  d: "FIRST_D",
} as const;

/** 완료(예정)일자 → DB 년/월/일 컬럼 */
export const RIVER_ILLEGAL_END_DATE_DB = {
  y: "END_Y",
  m: "END_M",
  d: "END_D",
} as const;

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

/**
 * 조치현황 시설 종류 — DB 접두어는 레이어정의서·DBF 와 동일
 * (DET_ 적발 / ACT_ 조치 / UNA_ 미조치 + BED·SHD·BNG·BLD·FRM·DCK·ALT·STK·VNL·ETC)
 */
export const RIVER_ILLEGAL_STATUS_KINDS = [
  { key: "bench", label: "평상 등", column: "BED" },
  { key: "shade", label: "그늘막", column: "SHD" },
  { key: "bungalow", label: "방갈로", column: "BNG" },
  { key: "building", label: "건축물", column: "BLD" },
  { key: "farming", label: "불법경작", column: "FRM" },
  { key: "deck", label: "데크 등", column: "DCK" },
  { key: "landChange", label: "형질변경", column: "ALT" },
  { key: "storage", label: "물건적치", column: "STK" },
  { key: "vinylHouse", label: "비닐하우스", column: "VNL" },
  { key: "etc", label: "기타", column: "ETC" },
] as const;

export type RiverIllegalStatusKindKey = (typeof RIVER_ILLEGAL_STATUS_KINDS)[number]["key"];

export const RIVER_ILLEGAL_STATUS_ROWS = [
  { key: "detected", label: "적발", prefix: "DET_" },
  { key: "acted", label: "조치", prefix: "ACT_" },
  { key: "notActed", label: "미조치", prefix: "UNA_" },
] as const;

export type RiverIllegalStatusRowKey = (typeof RIVER_ILLEGAL_STATUS_ROWS)[number]["key"];
