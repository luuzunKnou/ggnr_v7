/** 급경사지 안전점검 — 패널 크기·opened 키·점검 문항 */

export const STEEP_SLOPE_SAFETY_OPENED_KEY = "steepSlopeSafety";

export const STEEP_SLOPE_SAFETY_PANEL_DEFAULT_WIDTH = 380;
export const STEEP_SLOPE_SAFETY_PANEL_MIN_WIDTH = 300;
export const STEEP_SLOPE_SAFETY_PANEL_MAX_WIDTH = 560;

export const STEEP_SLOPE_SAFETY_DETAIL_DEFAULT_WIDTH = 520;
export const STEEP_SLOPE_SAFETY_DETAIL_MIN_WIDTH = 420;
export const STEEP_SLOPE_SAFETY_DETAIL_MAX_WIDTH = 720;

/** 점검결과 첨부(세부 사진) — 한글 원본 최대 6장 */
export const STEEP_SLOPE_ATTACHMENT_MAX = 6;

/** 있음 / 없음 / 해당없음 */
export type SteepSlopeCheckValue = "yes" | "no" | "na" | "";

export type SteepSlopeCheckItemDef = {
  key: string;
  label: string;
};

export type SteepSlopeCheckGroupDef = {
  key: string;
  title: string;
  items: readonly SteepSlopeCheckItemDef[];
};

/** 한글 서식 세부점검사항 */
export const STEEP_SLOPE_CHECK_GROUPS: readonly SteepSlopeCheckGroupDef[] = [
  {
    key: "surround",
    title: "인공비탈면의 상･하부 및 주변",
    items: [
      {
        key: "s1",
        label: "인위적 훼손 및 개발(태양광 설치, 임도 설치, 밭 경작 등) 여부",
      },
      {
        key: "s2",
        label:
          "토석류, 인장균열, 붕괴, 침하, 낙석 등의 지반변형으로 인공비탈면의 위험성 증가",
      },
      {
        key: "s3",
        label: "하부 시설(주택, 도로 등)의 변형 및 파손",
      },
    ],
  },
  {
    key: "slope",
    title: "인공비탈면",
    items: [
      { key: "p1", label: "지하수 용출 여부" },
      { key: "p2", label: "인장균열 발생 여부" },
      { key: "p3", label: "지반 침하 및 융기(배부름) 발생 여부" },
      { key: "p4", label: "붕괴 발생 여부" },
      { key: "p5", label: "표층유실 및 세굴 발생 여부" },
      { key: "p7", label: "낙석, 뜬돌 및 전도가능 수목 존재" },
    ],
  },
  {
    key: "facility",
    title: "비탈면 시설물(옹벽, 낙석방지책 등)",
    items: [
      {
        key: "f1",
        label:
          "시설물 변형 여부 - 시설물 미관리(낙석 방치 등)에 따른 기능 저하",
      },
      { key: "f2", label: "시설물 파손 여부" },
      { key: "f3", label: "배수시설(배수공 등)의 배수기능 저하 여부" },
    ],
  },
  {
    key: "sign",
    title: "붕괴위험지역 표지판",
    items: [
      { key: "g1", label: "붕괴위험지역 안내 표지판 설치 여부" },
      { key: "g2", label: "표지판 내 글씨 등 훼손 여부" },
    ],
  },
  {
    key: "alert",
    title: "조기경보시스템",
    items: [
      { key: "a1", label: "계측기기 파손 및 유실 여부" },
      {
        key: "a2",
        label:
          "계측기기 정상 작동 여부 - 계측, 모니터링 시스템, CCTV, 전광판 등",
      },
    ],
  },
] as const;

export const STEEP_SLOPE_CHECK_VALUE_LABEL: Record<
  Exclude<SteepSlopeCheckValue, "">,
  string
> = {
  yes: "있음",
  no: "없음",
  na: "해당 없음",
};
