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

  const topPositions: number[] = [];
  const topIndices: number[] = [];

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const p = xz(i, j);
      topPositions.push(p.x, topY(i, j), p.z);
    }
  }

  const topIdx = (i: number, j: number) => j * size + i;
  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      const a = sampleHeight(field, i, j);
      const b = sampleHeight(field, i + 1, j);
      const c = sampleHeight(field, i, j + 1);
      const d = sampleHeight(field, i + 1, j + 1);
      if (a == null && b == null && c == null && d == null) continue;
      const v00 = topIdx(i, j);
      const v10 = topIdx(i + 1, j);
      const v01 = topIdx(i, j + 1);
      const v11 = topIdx(i + 1, j + 1);
      // +Y(위에서) 볼 때 CCW → 법선 위쪽 (FrontSide 채움 보이도록)
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

  const last = size - 1;

  // 윗면 외곽 (지형 표면 따라)
  for (let i = 0; i < last; i++) {
    const a = xz(i, 0);
    const b = xz(i + 1, 0);
    pushSeg(a.x, topY(i, 0), a.z, b.x, topY(i + 1, 0), b.z);
    const c = xz(i, last);
    const d = xz(i + 1, last);
    pushSeg(c.x, topY(i, last), c.z, d.x, topY(i + 1, last), d.z);
  }
  for (let j = 0; j < last; j++) {
    const a = xz(0, j);
    const b = xz(0, j + 1);
    pushSeg(a.x, topY(0, j), a.z, b.x, topY(0, j + 1), b.z);
    const c = xz(last, j);
    const d = xz(last, j + 1);
    pushSeg(c.x, topY(last, j), c.z, d.x, topY(last, j + 1), d.z);
  }

  if (thick > 1e-6) {
    // 아랫면 외곽
    for (let i = 0; i < last; i++) {
      const a = xz(i, 0);
      const b = xz(i + 1, 0);
      pushSeg(a.x, botY(i, 0), a.z, b.x, botY(i + 1, 0), b.z);
      const c = xz(i, last);
      const d = xz(i + 1, last);
      pushSeg(c.x, botY(i, last), c.z, d.x, botY(i + 1, last), d.z);
    }
    for (let j = 0; j < last; j++) {
      const a = xz(0, j);
      const b = xz(0, j + 1);
      pushSeg(a.x, botY(0, j), a.z, b.x, botY(0, j + 1), b.z);
      const c = xz(last, j);
      const d = xz(last, j + 1);
      pushSeg(c.x, botY(last, j), c.z, d.x, botY(last, j + 1), d.z);
    }

    // 옆면 세로 — 네 모서리만
    for (const [i, j] of [
      [0, 0],
      [last, 0],
      [last, last],
      [0, last],
    ] as const) {
      const p = xz(i, j);
      pushSeg(p.x, topY(i, j), p.z, p.x, botY(i, j), p.z);
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
