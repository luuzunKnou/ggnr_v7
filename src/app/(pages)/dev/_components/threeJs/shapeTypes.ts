export type ShapeKind = 'box' | 'sphere' | 'cylinder' | 'ground' | 'pipe';

/** 상수관로 세그먼트 (wtl_pipe_lm) */
export type PipeSegment = {
  id: string;
  /** 관라벨 (pip_lbl) */
  label?: string;
  /** EPSG:3857 라인 좌표 (범위로 클립됨) */
  coords3857: [number, number][];
  /** 외경(m) — std_dip (호칭지름) */
  diameterM: number;
  /** 심도(m, 지표 기준) — 횡단면도와 동일(최근접 pip_dep → low/hgh 평균) */
  depthM: number;
  /** 지표 해발(m) — 등고 상·하 보간(고도 측정과 동일). 없으면 고도장·0 */
  surfaceElevM?: number;
};

/** @deprecated PipeSegment 사용 */
export type GroundPipeSegment = PipeSegment;

/** 실제 등고선 세그먼트 (elevation.cont, 범위 클립) */
export type GroundContourLine = {
  elevM: number;
  coords3857: [number, number][];
};

/** 하천구역 폴리곤 (지방·소하천, 범위 클립). rings[0]=외곽 */
export type GroundRiverPoly = {
  kind: 'local' | 'small';
  rings3857: [number, number][][];
};

/** 지형 높이장 (정사각 격자) */
export type GroundHeightField = {
  /** 격자 한 변 샘플 수 (cols = rows) */
  size: number;
  /** 샘플 간격(m) */
  stepM: number;
  /** 중심→변 절반(m). 한 변 = 2×radiusM */
  radiusM: number;
  /** 중심 EPSG:3857 */
  centerX: number;
  centerY: number;
  /** 범위 내 최저 표고(m, 해발). 참고용 — 메시 Y는 절대고도 */
  baseElevM: number;
  /** row-major, 길이 size*size */
  heights: (number | null)[];
  /** 격자·등고에 등장하는 실제 고도 레벨(m) */
  levels?: number[];
  /** 평면도와 동일 등고선 (우선 사용) */
  contours?: GroundContourLine[] | null;
  /** 지방하천·소하천 구역 */
  rivers?: GroundRiverPoly[] | null;
};

/** 씬에 올라간 도형 1개의 편집 가능 속성 */
export type ShapeProps = {
  kind: ShapeKind;
  color: string;
  opacity: number;
  /** 0 = 채움, 0~0.95 = 속이 빔(내경 비율) */
  innerRatio: number;
  /** 사각형: 가로 */
  width: number;
  /** 사각형: 깊이(Z) / 원기둥 미사용 시에도 보관 */
  depth: number;
  /** 사각형·원기둥: 높이 */
  height: number;
  /** 구·원기둥: 바깥 반지름 */
  radius: number;
  /** 바닥(Y=0)으로부터 도형 밑면까지 높이 */
  floorHeight: number;
  /** 수평 위치 (바닥면 X·Z) */
  posX: number;
  posZ: number;
  /** 회전각 (도) */
  rotX: number;
  rotY: number;
  rotZ: number;
  /** GROUND 전용 — 지도 클릭 중심·높이장 */
  groundCenterX?: number;
  groundCenterY?: number;
  groundRadiusM?: number;
  groundHeightField?: GroundHeightField | null;
  /** GROUND — 하천 구역 색·불투명도 (땅 color/opacity 와 분리) */
  riverColor?: string;
  riverOpacity?: number;
  /** PIPE 전용 — 지도 클릭 중심·관로 */
  pipeCenterX?: number;
  pipeCenterY?: number;
  pipeRadiusM?: number;
  pipeSegments?: PipeSegment[] | null;
  /** 관로 지표 고도장 — 지형과 동일 절대고도로 배치할 때 */
  pipeHeightField?: GroundHeightField | null;
};

export type ShapeFieldKey =
  | 'color'
  | 'opacity'
  | 'innerRatio'
  | 'width'
  | 'depth'
  | 'height'
  | 'radius'
  | 'floorHeight'
  | 'posX'
  | 'posZ'
  | 'rotX'
  | 'rotY'
  | 'rotZ';

export type ShapeFieldDef = {
  key: ShapeFieldKey;
  label: string;
  type: 'color' | 'number' | 'ratio';
  min?: number;
  max?: number;
  step?: number;
};

export type ShapeModule = {
  kind: ShapeKind;
  label: string;
  defaults: ShapeProps;
  fields: ShapeFieldDef[];
};

/** 등록된 도형 목록 행 */
export type RegisteredShapeRow = {
  id: string;
  kind: ShapeKind;
  name: string;
};

export const SHAPE_USER_DATA_KEY = 'ggnrShapeId';
export const SHAPE_PROPS_KEY = 'ggnrShapeProps';
export const SHAPE_NAME_KEY = 'ggnrShapeName';

/** Three.js 단위: 실제 m / 이 값 = 씬 단위 */
export const GROUND_SCENE_M_PER_UNIT = 1;

/**
 * 표고(m, 해발) → 씬 Y.
 * 범위 최저를 0으로 내리지 않고 절대고도를 그대로 씀.
 */
export function elevToSceneY(elevM: number): number {
  if (!Number.isFinite(elevM)) return 0;
  return elevM / GROUND_SCENE_M_PER_UNIT;
}

/**
 * GROUND 등고 격자 기본값
 * radiusM = 중심→변 절반(m). 선택·격자는 정사각 (한 변 2×radiusM).
 */
export const GROUND_DEFAULT_RADIUS_M = 10;
export const GROUND_DEFAULT_STEP_M = 5;

/** 관로 범위 기본값 (지형과 동일 스케일) */
export const PIPE_DEFAULT_RADIUS_M = 10;
