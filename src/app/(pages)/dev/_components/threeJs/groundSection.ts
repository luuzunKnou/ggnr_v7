import type { GroundHeightField, GroundSectionLine } from './shapeTypes';
import { GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import { sampleHeight } from './groundSteppedMesh';

/** 단면도 사각형: 절단선 수직 한쪽(m). 띠 전체 = ± 이 값 */
export const SECTION_DEFAULT_HALF_WIDTH_M = 2.5;
/** 단면도 전용 격자 간격(m) — 얇은 띠에서도 삼각형이 생기도록 */
export const SECTION_STEP_M = 2;

function meterToProjAtY3857(y3857: number): number {
  const latRad = 2 * Math.atan(Math.exp(y3857 / 6378137)) - Math.PI / 2;
  const cosLat = Math.cos(latRad);
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return 1;
  return 1 / cosLat;
}

/**
 * 절단선을 항상 좌→우(서→동)로 정규화.
 * 그리는 방향(우→좌 / 좌→우)과 무관하게 사각형·perp가 같게.
 * EPSG:3857 +X=동. X가 같으면 남→북(+Y).
 */
export function normalizeSectionLineLTR(line: GroundSectionLine): GroundSectionLine {
  const [ax, ay] = line.start3857;
  const [bx, by] = line.end3857;
  const needSwap = bx < ax || (bx === ax && by < ay);
  if (!needSwap) return line;
  return {
    ...line,
    start3857: [bx, by],
    end3857: [ax, ay],
  };
}

/** 라인 길이(지표 m) */
export function sectionLineLengthM(line: GroundSectionLine): number {
  const n = normalizeSectionLineLTR(line);
  const [ax, ay] = n.start3857;
  const [bx, by] = n.end3857;
  const m2p = meterToProjAtY3857((ay + by) / 2);
  return Math.hypot(bx - ax, by - ay) / m2p;
}

/**
 * 절단선 → 덮는 정사각 반경(m).
 * 라인 중심, 좌우 halfWidthM 띠의 코너까지.
 */
export function sectionCoverRadiusM(line: GroundSectionLine): number {
  const halfL = sectionLineLengthM(line) / 2;
  const halfW = Math.max(1, line.halfWidthM);
  return Math.max(1, Math.min(2000, Math.hypot(halfL, halfW) * 1.08));
}

/** 단면도 사각형 깊이(m) — 절단선 수직 한쪽 */
export function suggestSectionHalfWidthM(_lengthM?: number): number {
  return SECTION_DEFAULT_HALF_WIDTH_M;
}

export type SectionAxesLocal = {
  /** 절단선 중점 로컬 */
  midX: number;
  midZ: number;
  /** 라인 방향 단위 (씬 XZ, −Z=북) */
  alongX: number;
  alongZ: number;
  /** 라인 수직(수평). 좌→우 진행 왼쪽 */
  perpX: number;
  perpZ: number;
  halfLenM: number;
  /** 라인에서 수직 한쪽 반폭(m, 씬 단위). 띠 전체 폭 = 2× */
  halfWidthM: number;
};

/** 3857 라인 → 지형 필드 로컬 축 (좌→우 정규화 후) */
export function sectionAxesFromField(
  field: GroundHeightField,
  line: GroundSectionLine
): SectionAxesLocal | null {
  const n = normalizeSectionLineLTR(line);
  const m2p = meterToProjAtY3857(field.centerY);
  const scale = GROUND_SCENE_M_PER_UNIT;
  const toLocal = (x3857: number, y3857: number) => ({
    x: (x3857 - field.centerX) / m2p / scale,
    z: -(y3857 - field.centerY) / m2p / scale,
  });
  const a = toLocal(n.start3857[0], n.start3857[1]);
  const b = toLocal(n.end3857[0], n.end3857[1]);
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  dx /= len;
  dz /= len;
  return {
    midX,
    midZ,
    alongX: dx,
    alongZ: dz,
    // 좌→우 진행 기준 왼쪽 = 사각형이 뻗는 쪽
    perpX: -dz,
    perpZ: dx,
    halfLenM: len / 2,
    halfWidthM: Math.max(1, n.halfWidthM) / scale,
  };
}

/**
 * 로컬점 → 단면도 사각형 내부.
 * 절단선(v=0) 중심, |v|≤halfWidth, |u|≤halfL
 * padM: 격자 경계 샘플을 넣기 위한 여유(채움 구멍 방지)
 */
export function isInsideSectionRect(
  localX: number,
  localZ: number,
  axes: SectionAxesLocal,
  padM = 0
): boolean {
  const rx = localX - axes.midX;
  const rz = localZ - axes.midZ;
  const u = rx * axes.alongX + rz * axes.alongZ;
  const v = rx * axes.perpX + rz * axes.perpZ;
  const pad = Math.max(0, padM);
  const hl = Math.max(1e-6, axes.halfLenM) + pad;
  const halfW = Math.max(1e-6, axes.halfWidthM) + pad;
  return Math.abs(u) <= hl && Math.abs(v) <= halfW;
}

/** @deprecated 이름 호환 — 사각형 판정 */
export const isInsideSectionRhombus = isInsideSectionRect;

/**
 * XZ 폴리라인 → 단면도 사각형 안쪽 연속 구간만.
 * 경계 교차 시 보간점으로 자름. 각 구간은 점 2개 이상.
 */
export function clipPolylineXZToSectionRect<T extends { x: number; z: number }>(
  pts: T[],
  axes: SectionAxesLocal,
  padM = 0,
  lerp: (a: T, b: T, t: number) => T
): T[][] {
  if (pts.length < 2) return [];
  const inside = (p: T) => isInsideSectionRect(p.x, p.z, axes, padM);
  const edgeClip = (a: T, b: T): T => {
    let lo = 0;
    let hi = 1;
    const aIn = inside(a);
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const p = lerp(a, b, mid);
      if (inside(p) === aIn) lo = mid;
      else hi = mid;
    }
    return lerp(a, b, (lo + hi) / 2);
  };

  const runs: T[][] = [];
  let cur: T[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = i > 0 ? pts[i - 1]! : null;
    if (inside(p)) {
      if (prev && !inside(prev)) cur.push(edgeClip(prev, p));
      cur.push(p);
    } else if (prev && inside(prev)) {
      cur.push(edgeClip(prev, p));
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/**
 * 격자 높이를 단면도 사각형 밖으로 null 처리.
 */
export function clipHeightFieldToSectionRect(
  field: GroundHeightField,
  line: GroundSectionLine
): GroundHeightField {
  const axes = sectionAxesFromField(field, line);
  if (!axes || field.size < 2) return field;

  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepU = field.stepM / scale;
  const mid = (field.size - 1) / 2;
  // step 절반 패딩 — 경계 셀 네 꼭짓점이 모두 살아 상단 채움이 끊기지 않게
  const pad = stepU * 0.55;
  const heights = field.heights.map((h, idx) => {
    if (h == null) return null;
    const i = idx % field.size;
    const j = Math.floor(idx / field.size);
    const x = (i - mid) * stepU;
    const z = -(j - mid) * stepU;
    return isInsideSectionRect(x, z, axes, pad) ? h : null;
  });

  const valid = heights.filter((h): h is number => h != null && Number.isFinite(h));
  const baseElevM = valid.length ? Math.min(...valid) : field.baseElevM;
  return { ...field, heights, baseElevM };
}

/** @deprecated 이름 호환 */
export const clipHeightFieldToSectionRhombus = clipHeightFieldToSectionRect;

/** 사각형 네 꼭짓점 로컬 XZ — 절단선 중심, 수직 ±halfWidth */
export function sectionRectCornersLocal(axes: SectionAxesLocal): {
  x: number;
  z: number;
}[] {
  const { midX, midZ, alongX, alongZ, perpX, perpZ, halfLenM, halfWidthM } = axes;
  const a = {
    x: midX - alongX * halfLenM,
    z: midZ - alongZ * halfLenM,
  };
  const b = {
    x: midX + alongX * halfLenM,
    z: midZ + alongZ * halfLenM,
  };
  return [
    { x: a.x - perpX * halfWidthM, z: a.z - perpZ * halfWidthM },
    { x: b.x - perpX * halfWidthM, z: b.z - perpZ * halfWidthM },
    { x: b.x + perpX * halfWidthM, z: b.z + perpZ * halfWidthM },
    { x: a.x + perpX * halfWidthM, z: a.z + perpZ * halfWidthM },
  ];
}

/** 표면 대표 높이(해발) — 카메라 타깃용 */
export function sectionSurfaceElevM(
  field: GroundHeightField,
  line: GroundSectionLine
): number {
  const axes = sectionAxesFromField(field, line);
  if (!axes) return field.baseElevM;
  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepU = field.stepM / scale;
  const mid = (field.size - 1) / 2;
  const vals: number[] = [];
  for (let j = 0; j < field.size; j++) {
    for (let i = 0; i < field.size; i++) {
      const h = sampleHeight(field, i, j);
      if (h == null) continue;
      const x = (i - mid) * stepU;
      const z = -(j - mid) * stepU;
      if (!isInsideSectionRect(x, z, axes)) continue;
      vals.push(h);
    }
  }
  if (!vals.length) return field.baseElevM;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)]!;
}

/**
 * 단면도 사각형 링 (EPSG:3857, 닫힘).
 * 절단선 중심, 수직 ±halfWidth — 2D 단면도 띠·관로 조회와 동일.
 */
export function sectionRectRing3857(
  line: GroundSectionLine
): [number, number][] {
  const n = normalizeSectionLineLTR(line);
  const [ax, ay] = n.start3857;
  const [bx, by] = n.end3857;
  const my = (ay + by) / 2;
  let dx = bx - ax;
  let dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    const m2p = meterToProjAtY3857(my);
    const h = Math.max(1, n.halfWidthM) * m2p;
    return [
      [ax - h, ay - h],
      [ax + h, ay - h],
      [ax + h, ay + h],
      [ax - h, ay + h],
      [ax - h, ay - h],
    ];
  }
  dx /= len;
  dy /= len;
  const m2p = meterToProjAtY3857(my);
  const halfProj = Math.max(1, n.halfWidthM) * m2p;
  const ox = -dy * halfProj;
  const oy = dx * halfProj;
  return [
    [ax + ox, ay + oy],
    [bx + ox, by + oy],
    [bx - ox, by - oy],
    [ax - ox, ay - oy],
    [ax + ox, ay + oy],
  ];
}

/**
 * 격자 조회용 중심 — 절단선 중점(띠 중심).
 * 3857.
 */
export function sectionRectCenter3857(line: GroundSectionLine): [number, number] {
  const ring = sectionRectRing3857(line);
  let sx = 0;
  let sy = 0;
  const n = ring.length - 1; // 닫힘 점 제외
  for (let i = 0; i < n; i++) {
    sx += ring[i]![0];
    sy += ring[i]![1];
  }
  return [sx / n, sy / n];
}
