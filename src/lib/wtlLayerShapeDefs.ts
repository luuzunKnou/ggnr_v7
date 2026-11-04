/**
 * Three.js 상수 레이어 도형 정의 (분할 레이어 제외).
 * 서버 조회·클라이언트 ShapeKind가 동일 테이블명을 쓴다.
 */

export type WtlLayerGeomKind = 'line' | 'point_std';

export type WtlLayerColorMode = 'pipe_saa' | 'css_stroke' | 'sld_stroke' | 'point_svg';

export type WtlLayerShapeDef = {
  kind: string;
  label: string;
  geom: WtlLayerGeomKind;
  table: string;
  /** 관경·규격 컬럼 후보 (우선순위) */
  diameterCols: string[];
  /** 심도 단일 컬럼 */
  depthCols: string[];
  depthHighCols: string[];
  depthLowCols: string[];
  /** 라벨 컬럼 후보 (SLD env 기본과 맞춤) */
  labelCols: string[];
  colorMode: WtlLayerColorMode;
  /** CSS·SVG·SLD 스타일 기준명 */
  styleName: string;
  fallbackColor: string;
  /** POINT 심도 없을 때 표시 높이(m) */
  defaultDisplayDepthM: number;
  /** POINT 기본 지름(m) — 규격 없을 때 */
  defaultDiameterM: number;
  /** 지형 일괄 생성 목록에 포함 */
  fromGround: boolean;
};

/** 분할(etc/saa003/saa004)은 별도 도형 없음 — wtl_pipe_lm + SLD 색 */
export const WTL_LAYER_SHAPE_DEFS: readonly WtlLayerShapeDef[] = [
  {
    kind: 'wtl_pipe_lm',
    label: '상수관로',
    geom: 'line',
    table: 'wtl_pipe_lm',
    diameterCols: ['std_dip', 'STD_DIP'],
    depthCols: [],
    depthHighCols: ['hgh_dep', 'HGH_DEP'],
    depthLowCols: ['low_dep', 'LOW_DEP'],
    labelCols: ['pip_lbl', 'PIP_LBL'],
    colorMode: 'pipe_saa',
    styleName: 'wtl_pipe_lm',
    fallbackColor: '#F44336',
    defaultDisplayDepthM: 1.2,
    defaultDiameterM: 0.1,
    fromGround: true,
  },
  {
    kind: 'wtl_clos_ls',
    label: '상수폐관관로',
    geom: 'line',
    table: 'wtl_clos_ls',
    diameterCols: ['PIP_DIP', 'pip_dip', 'std_dip'],
    depthCols: [],
    depthHighCols: ['hgh_dep', 'HGH_DEP'],
    depthLowCols: ['low_dep', 'LOW_DEP'],
    labelCols: ['pip_lbl', 'PIP_LBL', 'ftr_idn', 'FTR_IDN'],
    colorMode: 'css_stroke',
    styleName: 'wtl_clos_ls',
    fallbackColor: '#009688',
    defaultDisplayDepthM: 1.2,
    defaultDiameterM: 0.1,
    fromGround: true,
  },
  {
    kind: 'wtl_sply_ls',
    label: '급수관로',
    geom: 'line',
    table: 'wtl_sply_ls',
    diameterCols: ['STD_DIP', 'std_dip'],
    depthCols: ['LAY_DEP', 'lay_dep'],
    depthHighCols: ['HGH_DEP', 'hgh_dep'],
    depthLowCols: ['LOW_DEP', 'low_dep'],
    labelCols: ['PIP_LBL', 'pip_lbl', 'FTR_IDN', 'ftr_idn'],
    colorMode: 'sld_stroke',
    styleName: 'wtl_sply_ls',
    fallbackColor: '#26A3D1',
    defaultDisplayDepthM: 1.0,
    defaultDiameterM: 0.05,
    fromGround: true,
  },
  {
    kind: 'wtl_manh_ps',
    label: '상수맨홀',
    geom: 'point_std',
    table: 'wtl_manh_ps',
    diameterCols: ['MAN_STD', 'man_std'],
    depthCols: [],
    depthHighCols: [],
    depthLowCols: [],
    labelCols: ['FTR_IDN', 'ftr_idn'],
    colorMode: 'point_svg',
    styleName: 'wtl_manh_ps',
    fallbackColor: '#a42b96',
    defaultDisplayDepthM: 0.4,
    defaultDiameterM: 0.6,
    fromGround: true,
  },
  {
    kind: 'wtl_valv_ps',
    label: '변류시설',
    geom: 'point_std',
    table: 'wtl_valv_ps',
    diameterCols: ['VAL_DIP', 'val_dip', 'std_dip', 'STD_DIP', 'VAL_STD', 'val_std'],
    depthCols: [],
    depthHighCols: [],
    depthLowCols: [],
    labelCols: ['FTR_IDN', 'ftr_idn'],
    colorMode: 'point_svg',
    styleName: 'wtl_valv_ps',
    fallbackColor: '#1565C0',
    defaultDisplayDepthM: 0.35,
    defaultDiameterM: 0.25,
    fromGround: true,
  },
  {
    kind: 'wtl_fire_ps',
    label: '소방시설',
    geom: 'point_std',
    table: 'wtl_fire_ps',
    diameterCols: ['FIR_DIP', 'fir_dip', 'std_dip', 'PIP_DIP'],
    depthCols: [],
    depthHighCols: [],
    depthLowCols: [],
    labelCols: ['FTR_IDN', 'ftr_idn'],
    colorMode: 'point_svg',
    styleName: 'wtl_fire_ps',
    fallbackColor: '#D32F2F',
    defaultDisplayDepthM: 0.35,
    defaultDiameterM: 0.2,
    fromGround: true,
  },
  {
    kind: 'wtl_flow_ps',
    label: '유량계',
    geom: 'point_std',
    table: 'wtl_flow_ps',
    diameterCols: ['FLO_DIP', 'flo_dip', 'std_dip'],
    depthCols: [],
    depthHighCols: [],
    depthLowCols: [],
    labelCols: ['FTR_IDN', 'ftr_idn'],
    colorMode: 'point_svg',
    styleName: 'wtl_flow_ps',
    fallbackColor: '#00897B',
    defaultDisplayDepthM: 0.3,
    defaultDiameterM: 0.2,
    fromGround: true,
  },
  {
    kind: 'wtl_prga_ps',
    label: '수압계',
    geom: 'point_std',
    table: 'wtl_prga_ps',
    diameterCols: ['PGA_DIP', 'pga_dip', 'std_dip', 'PIP_DIP'],
    depthCols: [],
    depthHighCols: [],
    depthLowCols: [],
    labelCols: ['FTR_IDN', 'ftr_idn'],
    colorMode: 'point_svg',
    styleName: 'wtl_prga_ps',
    fallbackColor: '#5E35B1',
    defaultDisplayDepthM: 0.3,
    defaultDiameterM: 0.18,
    fromGround: true,
  },
  {
    kind: 'wtl_leak_ps',
    label: '누수지점',
    geom: 'point_std',
    table: 'wtl_leak_ps',
    diameterCols: ['pip_dip', 'PIP_DIP', 'std_dip'],
    depthCols: [],
    depthHighCols: [],
    depthLowCols: [],
    labelCols: ['ftr_idn', 'FTR_IDN'],
    colorMode: 'point_svg',
    styleName: 'wtl_leak_ps',
    fallbackColor: '#EF6C00',
    defaultDisplayDepthM: 0.3,
    defaultDiameterM: 0.2,
    fromGround: true,
  },
  {
    kind: 'wtl_meta_ps',
    label: '급수전계량기',
    geom: 'point_std',
    table: 'wtl_meta_ps',
    diameterCols: ['MET_DIP', 'met_dip'],
    depthCols: [],
    depthHighCols: [],
    depthLowCols: [],
    labelCols: ['FTR_IDN', 'ftr_idn'],
    colorMode: 'point_svg',
    styleName: 'wtl_meta_ps',
    fallbackColor: '#43A047',
    defaultDisplayDepthM: 0.25,
    defaultDiameterM: 0.12,
    fromGround: true,
  },
] as const;

export type WtlLayerShapeKind = (typeof WTL_LAYER_SHAPE_DEFS)[number]['kind'];

const DEF_BY_KIND = new Map(
  WTL_LAYER_SHAPE_DEFS.map((d) => [d.kind, d] as const)
);

export function getWtlLayerShapeDef(kind: string): WtlLayerShapeDef | null {
  return DEF_BY_KIND.get(kind) ?? null;
}

export function isWtlLineLayerKind(kind: string): boolean {
  return getWtlLayerShapeDef(kind)?.geom === 'line';
}

export function isWtlPointLayerKind(kind: string): boolean {
  return getWtlLayerShapeDef(kind)?.geom === 'point_std';
}

export function isWtlLayerShapeKind(kind: string): boolean {
  return DEF_BY_KIND.has(kind);
}
