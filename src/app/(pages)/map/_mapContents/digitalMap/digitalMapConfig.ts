/** 지도 우측 «수치지형도» */

export const DIGITAL_MAP_CONTROL_ID = 'digital-map';

/** 동시 다운로드 */
export const DIGITAL_MAP_FETCH_CONCURRENCY = 8;

/** 도엽 파싱 캐시 상한 (화면 밖만 버림) */
export const DIGITAL_MAP_SHEET_CACHE_MAX = 160;

/**
 * 색인 CRS 감지 실패 시 임시값.
 * 실제 표시는 도엽 범위 ↔ 사업 읍면동 겹침으로 고른 좌표계를 쓴다.
 */
export const DIGITAL_MAP_DEFAULT_CRS = '5186' as const;

/** 도엽 테두리 — 검은 실선 */
export const DIGITAL_MAP_FOOTPRINT_STROKE = '#000000';
export const DIGITAL_MAP_FOOTPRINT_WIDTH = 1.2;

/**
 * 상세 단계 — 지도 축척 막대 거리(m) 기준.
 * 화면 안 도엽은 모두 올리고, 확대될수록 도엽당 선·글자만 조금씩 늘린다.
 * 이보다 축소(막대 m이 더 큼)면 테두리만.
 */
export type DigitalMapDetailLevel = {
  /** 축척 막대(m) ≤ 이 값이면 해당 단계 */
  maxScaleBarM: number;
  /** 도엽당 선·도형 상한 (긴 선 우선) */
  maxFeaturesPerSheet: number;
  /** 화면 가로 대비 이보다 짧은 선 생략 (0이면 전부) */
  minSpanRatio: number;
  showLabels: boolean;
  /** 도엽당 글자 상한 */
  maxLabelsPerSheet: number;
  /** 도엽 도곽 가로·세로선 포함 (120 이하만) */
  includeSheetFrame: boolean;
};

/**
 * 240m 초과 → 테두리만 (도엽 수가 적을 때만 DXF 로드 — 960은 너무 느림)
 * 240→120→60→30 로 확대할수록 도엽당 선만 늘림
 */
export const DIGITAL_MAP_DETAIL_LEVELS: DigitalMapDetailLevel[] = [
  {
    maxScaleBarM: 240,
    maxFeaturesPerSheet: 4,
    minSpanRatio: 0.07,
    showLabels: false,
    maxLabelsPerSheet: 0,
    includeSheetFrame: false,
  },
  {
    maxScaleBarM: 120,
    maxFeaturesPerSheet: 28,
    minSpanRatio: 0.02,
    showLabels: true,
    maxLabelsPerSheet: 24,
    includeSheetFrame: true,
  },
  {
    maxScaleBarM: 60,
    maxFeaturesPerSheet: 56,
    minSpanRatio: 0.008,
    showLabels: true,
    maxLabelsPerSheet: 48,
    includeSheetFrame: true,
  },
  {
    maxScaleBarM: 30,
    maxFeaturesPerSheet: 100,
    minSpanRatio: 0,
    showLabels: true,
    maxLabelsPerSheet: 80,
    includeSheetFrame: true,
  },
];

/** 테두리만 — 축척 막대가 이보다 크면 */
export const DIGITAL_MAP_OUTLINE_MIN_SCALE_BAR_M =
  DIGITAL_MAP_DETAIL_LEVELS[0]?.maxScaleBarM ?? 240;

export function resolveDigitalMapDetailLevel(
  scaleBarM: number
): { level: DigitalMapDetailLevel; index: number } | null {
  if (!(scaleBarM > 0) || scaleBarM > DIGITAL_MAP_OUTLINE_MIN_SCALE_BAR_M) return null;
  let best = 0;
  for (let i = 0; i < DIGITAL_MAP_DETAIL_LEVELS.length; i++) {
    if (scaleBarM <= DIGITAL_MAP_DETAIL_LEVELS[i].maxScaleBarM) best = i;
  }
  return { level: DIGITAL_MAP_DETAIL_LEVELS[best], index: best };
}
