/** 지도 «도면 표시» — 수치지형도 DXF/DWG 임시 표시 */

export const DRAWING_DISPLAY_OPENED_KEY = 'drawingDisplay';

export const DRAWING_DISPLAY_PANEL_DEFAULT_WIDTH = 400;
export const DRAWING_DISPLAY_PANEL_MIN_WIDTH = 320;
export const DRAWING_DISPLAY_PANEL_MAX_WIDTH = 720;

/** 브라우저에서 통째로 읽는 상한 */
export const DRAWING_DISPLAY_MAX_BYTES = 150 * 1024 * 1024;

export type DrawingCrsCode =
  | '4326'
  | '3857'
  | '5174'
  | '5176'
  | '5179'
  | '5180'
  | '5181'
  | '5182'
  | '5183'
  | '5184'
  | '5185'
  | '5186'
  | '5187'
  | '5188';

export const DRAWING_CRS_OPTIONS: Array<{ code: DrawingCrsCode; label: string }> = [
  { code: '4326', label: '위경도 (WGS84)' },
  { code: '3857', label: '웹 메르카토르' },
  { code: '5174', label: '중부원점 (구 베셀)' },
  { code: '5176', label: '동부원점 (구 베셀)' },
  { code: '5179', label: '통합좌표계 (UTM-K)' },
  { code: '5180', label: '서부원점' },
  { code: '5181', label: '중부원점' },
  { code: '5182', label: '제주원점' },
  { code: '5183', label: '동부원점' },
  { code: '5184', label: '동해(울릉)원점' },
  { code: '5185', label: '서부원점 2010' },
  { code: '5186', label: '중부원점 2010' },
  { code: '5187', label: '동부원점 2010' },
  { code: '5188', label: '동해(울릉)원점 2010' },
];

/** 수치지형도 기본 — 중부원점 2010 */
export const DRAWING_DEFAULT_CRS: DrawingCrsCode = '5186';

export function getDrawingCrsLabel(code: DrawingCrsCode | ''): string {
  if (!code) return '—';
  const hit = DRAWING_CRS_OPTIONS.find((o) => o.code === code);
  return hit ? `${hit.label} · EPSG:${code}` : `EPSG:${code}`;
}

export const DRAWING_ACCEPT = '.dxf,.dwg,.DXF,.DWG';

/**
 * 이 개수 이상이면 줌 LOD(단계) 표시.
 * zoomFactor = 도면 가로 / 화면 가로 (클수록 확대)
 */
export const DRAWING_LARGE_FEATURE_THRESHOLD = 8_000;

/** 개요 캔버스 한 변 최대 픽셀 */
export const DRAWING_OVERVIEW_MAX_PX = 2048;

/** LOD 단계 상승 시 청크 페인트 */
export const DRAWING_PAINT_CHUNK = 2_500;

/** 글자 최대 개수 (단계별에서 상한으로 사용) */
export const DRAWING_MAX_LABELS = 120;

/**
 * 줌 단계 — 1단계는 외곽 개요 이미지만. 2단계부터 선명한 벡터.
 * minZoomFactor: 도면폭/뷰폭
 */
export type DrawingLodLevel = {
  minZoomFactor: number;
  label: string;
  /** true면 개요 이미지만 (벡터 없음) */
  overviewOnly: boolean;
  /** 화면 가로 대비 이보다 짧은 선은 건너뜀 (0이면 전부) */
  minSpanRatio: number;
  maxFeatures: number;
  showLabels: boolean;
  maxLabels: number;
};

export const DRAWING_LOD_LEVELS: DrawingLodLevel[] = [
  {
    minZoomFactor: 0,
    label: '전체',
    overviewOnly: true,
    minSpanRatio: 0,
    maxFeatures: 0,
    showLabels: false,
    maxLabels: 0,
  },
  {
    minZoomFactor: 1.35,
    label: '개요+',
    overviewOnly: false,
    minSpanRatio: 0.01,
    maxFeatures: 3_500,
    showLabels: false,
    maxLabels: 0,
  },
  {
    minZoomFactor: 2.4,
    label: '중경',
    overviewOnly: false,
    minSpanRatio: 0.004,
    maxFeatures: 5_500,
    showLabels: false,
    maxLabels: 0,
  },
  {
    minZoomFactor: 4.0,
    label: '근경',
    overviewOnly: false,
    minSpanRatio: 0.0015,
    maxFeatures: 7_500,
    showLabels: true,
    maxLabels: 50,
  },
  {
    minZoomFactor: 7.0,
    label: '상세',
    overviewOnly: false,
    minSpanRatio: 0,
    maxFeatures: 12_000,
    showLabels: true,
    maxLabels: 80,
  },
];

/** 도면 가로 ÷ 화면 가로 */
export function calcZoomFactor(
  fullWidth: number,
  viewWidth: number
): number {
  if (!(fullWidth > 0) || !(viewWidth > 0)) return 1;
  return fullWidth / viewWidth;
}

export function resolveDrawingLod(zoomFactor: number): { level: DrawingLodLevel; index: number } {
  const z = Number.isFinite(zoomFactor) ? zoomFactor : 1;
  let best = 0;
  for (let i = 0; i < DRAWING_LOD_LEVELS.length; i++) {
    if (z >= DRAWING_LOD_LEVELS[i].minZoomFactor) best = i;
  }
  return { level: DRAWING_LOD_LEVELS[best], index: best };
}
