import * as THREE from 'three';
import type { GroundHeightField, GroundSectionLine } from './shapeTypes';
import { elevToSceneY, GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import {
  SECTION_STEP_M,
  sectionAxesFromField,
  sectionRectCornersLocal,
} from './groundSection';
import { sampleHeight, sampleSurfaceY } from './groundSteppedMesh';

export type InterpolatedGroundParts = {
  /** 윗면만 — 색상 채움용 */
  topGeo: THREE.BufferGeometry;
  /** 아랫면·옆면 외곽선 (LineSegments용 xyz 쌍) */
  outlinePositions: number[];
};

/**
 * 절단선 중심 ±halfWidth **축정렬이 아닌 사각형** 지형 메시.
 * 관로 조회 폴리곤(LINE 띠)과 같은 발자국.
 */
export function createSectionRectGroundParts(
  field: GroundHeightField,
  line: GroundSectionLine,
  thicknessM = 0
): InterpolatedGroundParts | null {
  const axes = sectionAxesFromField(field, line);
  if (!axes || field.size < 2 || !field.heights?.length) return null;

  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepM = Math.max(0.5, field.stepM || SECTION_STEP_M);
  const stepU = stepM / scale;
  const halfL = Math.max(1e-6, axes.halfLenM);
  const halfW = Math.max(1e-6, axes.halfWidthM);
  const nu = Math.max(2, Math.ceil((halfL * 2) / stepU) + 1);
  const nv = Math.max(2, Math.ceil((halfW * 2) / stepU) + 1);
  const thick = Math.max(0, thicknessM);

  const xzAt = (iu: number, iv: number) => {
    const u = -halfL + (iu / (nu - 1)) * (halfL * 2);
    const v = -halfW + (iv / (nv - 1)) * (halfW * 2);
    return {
      x: axes.midX + axes.alongX * u + axes.perpX * v,
      z: axes.midZ + axes.alongZ * u + axes.perpZ * v,
    };
  };

  const topPositions: number[] = [];
  const topIndices: number[] = [];
  const vertIndex = (iu: number, iv: number) => iv * nu + iu;

  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const p = xzAt(iu, iv);
      const y = sampleSurfaceY(field, p.x, p.z);
      topPositions.push(p.x, y, p.z);
    }
  }

  for (let iv = 0; iv < nv - 1; iv++) {
    for (let iu = 0; iu < nu - 1; iu++) {
      const v00 = vertIndex(iu, iv);
      const v10 = vertIndex(iu + 1, iv);
      const v01 = vertIndex(iu, iv + 1);
      const v11 = vertIndex(iu + 1, iv + 1);
      topIndices.push(v00, v10, v01, v10, v11, v01);
    }
  }

  if (!topIndices.length) return null;

  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPositions, 3));
  topGeo.setIndex(topIndices);
  topGeo.computeVertexNormals();

  const outlinePositions: number[] = [];
  const pushSeg = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
  ) => {
    outlinePositions.push(x0, y0, z0, x1, y1, z1);
  };

  // 사각형 네 변 외곽 (표면 높이 따라감)
  const corners = sectionRectCornersLocal(axes);
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const segs = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / stepU));
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const x0 = a.x + (b.x - a.x) * t0;
      const z0 = a.z + (b.z - a.z) * t0;
      const x1 = a.x + (b.x - a.x) * t1;
      const z1 = a.z + (b.z - a.z) * t1;
      const y0 = sampleSurfaceY(field, x0, z0);
      const y1 = sampleSurfaceY(field, x1, z1);
      pushSeg(x0, y0, z0, x1, y1, z1);
      if (thick > 1e-6) {
        pushSeg(x0, y0 - thick, z0, x1, y1 - thick, z1);
        pushSeg(x0, y0, z0, x0, y0 - thick, z0);
      }
    }
  }

  return { topGeo, outlinePositions };
}

/**
 * 격자 샘플 기울기 보간 지형.
 * 윗면 메시 + (두께>0일 때) 아랫면·옆면 외곽선.
 */
export function createInterpolatedGroundParts(
  field: GroundHeightField,
  thicknessM = 0
): InterpolatedGroundParts | null {
  const size = field.size;
  if (size < 2 || !field.heights?.length) return null;

  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepU = field.stepM / scale;
  const mid = (size - 1) / 2;
  const fallback = field.baseElevM;
  const thick = Math.max(0, thicknessM);

  const has = (i: number, j: number) => sampleHeight(field, i, j) != null;
  const elevAt = (i: number, j: number): number => {
    const h = sampleHeight(field, i, j);
    return h ?? fallback;
  };

  const topY = (i: number, j: number) => elevToSceneY(elevAt(i, j));
  const botY = (i: number, j: number) => topY(i, j) - thick;
  const xz = (i: number, j: number) => ({
    x: (i - mid) * stepU,
    z: -(j - mid) * stepU,
  });

  // null(범위 밖) 칸은 제외 — 일부만 있으면 fallback 고도로 구멍·찢김이 생김
  const cellOk = (i: number, j: number) =>
    has(i, j) && has(i + 1, j) && has(i, j + 1) && has(i + 1, j + 1);

  const topPositions: number[] = [];
  const topIndices: number[] = [];
  const vertKey = new Map<string, number>();
  const ensureVert = (i: number, j: number): number => {
    const key = `${i},${j}`;
    const prev = vertKey.get(key);
    if (prev != null) return prev;
    const p = xz(i, j);
    const idx = topPositions.length / 3;
    topPositions.push(p.x, topY(i, j), p.z);
    vertKey.set(key, idx);
    return idx;
  };

  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      if (!cellOk(i, j)) continue;
      const v00 = ensureVert(i, j);
      const v10 = ensureVert(i + 1, j);
      const v01 = ensureVert(i, j + 1);
      const v11 = ensureVert(i + 1, j + 1);
      // +Y(위에서) 볼 때 CCW → 법선 위쪽
      topIndices.push(v00, v10, v01, v10, v11, v01);
    }
  }

  if (!topIndices.length) return null;

  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPositions, 3));
  topGeo.setIndex(topIndices);
  topGeo.computeVertexNormals();

  const outlinePositions: number[] = [];
  const pushSeg = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
  ) => {
    outlinePositions.push(x0, y0, z0, x1, y1, z1);
  };

  const pushEdge = (i0: number, j0: number, i1: number, j1: number) => {
    if (!has(i0, j0) || !has(i1, j1)) return;
    const a = xz(i0, j0);
    const b = xz(i1, j1);
    pushSeg(a.x, topY(i0, j0), a.z, b.x, topY(i1, j1), b.z);
    if (thick > 1e-6) {
      pushSeg(a.x, botY(i0, j0), a.z, b.x, botY(i1, j1), b.z);
      pushSeg(a.x, topY(i0, j0), a.z, a.x, botY(i0, j0), a.z);
    }
  };

  // 유효 셀 경계만 외곽 (이웃 셀 없거나 불완전하면 변 그림)
  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      if (!cellOk(i, j)) continue;
      if (i === 0 || !cellOk(i - 1, j)) pushEdge(i, j, i, j + 1);
      if (i === size - 2 || !cellOk(i + 1, j)) pushEdge(i + 1, j, i + 1, j + 1);
      if (j === 0 || !cellOk(i, j - 1)) pushEdge(i, j, i + 1, j);
      if (j === size - 2 || !cellOk(i, j + 1)) pushEdge(i, j + 1, i + 1, j + 1);
    }
  }

  return { topGeo, outlinePositions };
}

/** @deprecated createInterpolatedGroundParts 사용 */
export function createInterpolatedGroundGeometry(
  field: GroundHeightField,
  thicknessM = 0
): THREE.BufferGeometry | null {
  const parts = createInterpolatedGroundParts(field, thicknessM);
  return parts?.topGeo ?? null;
}
