import {
  GROUND_DEFAULT_RADIUS_M,
  PIPE_DEFAULT_RADIUS_M,
  type ShapeKind,
  type ShapeModule,
  type ShapeProps,
} from './shapeTypes';

const COMMON_APPEARANCE = [
  { key: 'color' as const, label: '색상', type: 'color' as const },
  {
    key: 'opacity' as const,
    label: '불투명도',
    type: 'ratio' as const,
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'innerRatio' as const,
    label: '내경 비율',
    type: 'ratio' as const,
    min: 0,
    max: 0.95,
    step: 0.01,
  },
];

/** 내경 비율 → 실제 내경 길이(지름·안쪽 가로 등) 안내 문구 */
export function innerLengthHint(props: ShapeProps): string | null {
  const ratio = Math.max(0, Math.min(0.95, props.innerRatio ?? 0));
  if (ratio <= 0) return null;
  const fmt = (n: number) => {
    const v = Math.round(n * 100) / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  };
  switch (props.kind) {
    case 'cylinder': {
      const outerD = Math.max(0.05, props.radius) * 2;
      return `내경 길이 ⌀${fmt(outerD * ratio)} (바깥 ⌀${fmt(outerD)})`;
    }
    case 'sphere': {
      const outerD = Math.max(0.05, props.radius) * 2;
      return `안쪽 지름 ⌀${fmt(outerD * ratio)} (바깥 ⌀${fmt(outerD)})`;
    }
    case 'box': {
      const w = Math.max(0.05, props.width) * ratio;
      const d = Math.max(0.05, props.depth) * ratio;
      const h = Math.max(0.05, props.height) * ratio;
      return `안쪽 ${fmt(w)} × ${fmt(d)} × ${fmt(h)}`;
    }
    case 'ground':
      return null;
    default:
      return null;
  }
}

const POSITION_FIELDS = [
  {
    key: 'floorHeight' as const,
    label: '바닥 높이',
    type: 'number' as const,
    min: 0,
    max: 50,
    step: 0.05,
  },
];

const ROTATION_FIELDS = [
  { key: 'rotX' as const, label: '회전 X(도)', type: 'number' as const, min: -360, max: 360, step: 1 },
  { key: 'rotY' as const, label: '회전 Y(도)', type: 'number' as const, min: -360, max: 360, step: 1 },
  { key: 'rotZ' as const, label: '회전 Z(도)', type: 'number' as const, min: -360, max: 360, step: 1 },
];

const ZERO_POSE = { floorHeight: 0, posX: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0 };

export const SHAPE_MODULES: readonly ShapeModule[] = [
  {
    kind: 'box',
    label: '사각형',
    defaults: {
      kind: 'box',
      color: '#3b82f6',
      opacity: 0,
      innerRatio: 0,
      width: 1,
      depth: 1,
      height: 1,
      radius: 0.5,
      ...ZERO_POSE,
    },
    fields: [
      ...COMMON_APPEARANCE,
      { key: 'width', label: '가로', type: 'number', min: 0.05, max: 20, step: 0.05 },
      { key: 'depth', label: '세로', type: 'number', min: 0.05, max: 20, step: 0.05 },
      { key: 'height', label: '높이', type: 'number', min: 0.05, max: 20, step: 0.05 },
      ...POSITION_FIELDS,
      ...ROTATION_FIELDS,
    ],
  },
  {
    kind: 'sphere',
    label: '원(구)',
    defaults: {
      kind: 'sphere',
      color: '#22c55e',
      opacity: 0,
      innerRatio: 0,
      width: 1,
      depth: 1,
      height: 1,
      radius: 0.5,
      ...ZERO_POSE,
    },
    fields: [
      ...COMMON_APPEARANCE,
      { key: 'radius', label: '반지름', type: 'number', min: 0.05, max: 20, step: 0.05 },
      ...POSITION_FIELDS,
      ...ROTATION_FIELDS,
    ],
  },
  {
    kind: 'cylinder',
    label: '원기둥',
    defaults: {
      kind: 'cylinder',
      color: '#f59e0b',
      opacity: 0,
      innerRatio: 0,
      width: 1,
      depth: 1,
      height: 1.2,
      radius: 0.4,
      ...ZERO_POSE,
    },
    fields: [
      ...COMMON_APPEARANCE,
      { key: 'radius', label: '반지름', type: 'number', min: 0.05, max: 20, step: 0.05 },
      { key: 'height', label: '높이', type: 'number', min: 0.05, max: 20, step: 0.05 },
      ...POSITION_FIELDS,
      ...ROTATION_FIELDS,
    ],
  },
  {
    kind: 'ground',
    label: '지형(GROUND)',
    defaults: {
      kind: 'ground',
      color: '#84cc16',
      opacity: 0.35,
      innerRatio: 0,
      width: 1,
      depth: 1,
      /** 지형 솔리드 두께(m). 0이면 표면만 */
      height: 5,
      radius: 0.5,
      ...ZERO_POSE,
      groundCenterX: undefined,
      groundCenterY: undefined,
      groundRadiusM: GROUND_DEFAULT_RADIUS_M,
      groundHeightField: null,
      riverColor: '#2563eb',
      riverOpacity: 0.4,
    },
    /** GROUND는 지도 클릭 모달 — 색·높이·불투명도는 모달에서 편집 */
    fields: [],
  },
  {
    kind: 'pipe',
    label: '관로',
    defaults: {
      kind: 'pipe',
      color: '#38bdf8',
      opacity: 0.92,
      innerRatio: 0,
      width: 1,
      depth: 1,
      height: 0.1,
      radius: 0.5,
      ...ZERO_POSE,
      pipeCenterX: undefined,
      pipeCenterY: undefined,
      pipeRadiusM: PIPE_DEFAULT_RADIUS_M,
      pipeSegments: null,
      pipeHeightField: null,
    },
    /** PIPE는 지도 클릭 모달 — 색·불투명도는 모달에서 편집 */
    fields: [],
  },
] as const;

export function getShapeModule(kind: ShapeKind): ShapeModule {
  const mod = SHAPE_MODULES.find((m) => m.kind === kind);
  if (!mod) throw new Error(`알 수 없는 도형: ${kind}`);
  return mod;
}

export function cloneDefaults(kind: ShapeKind): ShapeProps {
  return { ...getShapeModule(kind).defaults };
}

export function shapeHalfExtentY(props: ShapeProps): number {
  if (props.kind === 'ground' || props.kind === 'pipe') return 0;
  if (props.kind === 'sphere') return Math.max(0.05, props.radius);
  return Math.max(0.05, props.height) / 2;
}

export function shapePropsEqual(a: ShapeProps, b: ShapeProps): boolean {
  const keys = new Set([
    ...(Object.keys(a) as (keyof ShapeProps)[]),
    ...(Object.keys(b) as (keyof ShapeProps)[]),
  ]);
  return [...keys].every((k) => {
    if (
      k === 'groundHeightField' ||
      k === 'pipeHeightField' ||
      k === 'pipeSegments'
    ) {
      return JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null);
    }
    return a[k] === b[k];
  });
}
