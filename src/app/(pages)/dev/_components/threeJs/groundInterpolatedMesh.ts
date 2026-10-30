import * as THREE from 'three';
import type { GroundHeightField } from './shapeTypes';
import { elevToSceneY, GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import { sampleHeight } from './groundSteppedMesh';

export type InterpolatedGroundParts = {
  /** 윗면만 — 색상 채움용 */
  topGeo: THREE.BufferGeometry;
  /** 아랫면·옆면 외곽선 (LineSegments용 xyz 쌍) */
  outlinePositions: number[];
};

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
