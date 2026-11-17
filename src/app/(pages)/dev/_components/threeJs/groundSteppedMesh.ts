import * as THREE from 'three';
import type { GroundHeightField } from './shapeTypes';
import { elevToSceneY, GROUND_SCENE_M_PER_UNIT } from './shapeTypes';

function elevKey(h: number): number {
  return Math.round(h * 100) / 100;
}

/** 샘플 고도 (null=없음) */
export function sampleHeight(field: GroundHeightField, i: number, j: number): number | null {
  const { size, heights } = field;
  if (i < 0 || j < 0 || i >= size || j >= size) return null;
  const h = heights[j * size + i];
  if (h == null || !Number.isFinite(h)) return null;
  return elevKey(h);
}

/**
 * 로컬 XZ에서 기울기 보간 지형 메시와 동일한 삼각형 보간 Y.
 * 셀 분할: (i,j)-(i+1,j)-(i,j+1) / (i+1,j)-(i+1,j+1)-(i,j+1)
 */
export function sampleSurfaceY(
  field: GroundHeightField,
  localX: number,
  localZ: number
): number {
  const size = field.size;
  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepU = field.stepM / scale;
  const mid = (size - 1) / 2;
  const fallback = field.baseElevM;

  const fi = localX / stepU + mid;
  const fj = -localZ / stepU + mid;
  const i0 = Math.max(0, Math.min(size - 2, Math.floor(fi)));
  const j0 = Math.max(0, Math.min(size - 2, Math.floor(fj)));
  const tx = Math.max(0, Math.min(1, fi - i0));
  const ty = Math.max(0, Math.min(1, fj - j0));

  const h00 = sampleHeight(field, i0, j0) ?? fallback;
  const h10 = sampleHeight(field, i0 + 1, j0) ?? fallback;
  const h01 = sampleHeight(field, i0, j0 + 1) ?? fallback;
  const h11 = sampleHeight(field, i0 + 1, j0 + 1) ?? fallback;

  // createInterpolatedGroundParts 와 동일 대각선(v10↔v01)
  let elev: number;
  if (tx + ty <= 1) {
    elev = (1 - tx - ty) * h00 + tx * h10 + ty * h01;
  } else {
    elev = (1 - ty) * h10 + (tx + ty - 1) * h11 + (1 - tx) * h01;
  }
  return elevToSceneY(elev);
}

/**
 * 셀 (i,j) = 샘플 (i,j)~(i+1,j+1) 사이 정사각.
 * 계단 높이 = 네 모서리 중 유효값의 최소(낮은 등고로 양자화와 동일 취지).
 */
export function cellHeight(field: GroundHeightField, i: number, j: number): number | null {
  const a = sampleHeight(field, i, j);
  const b = sampleHeight(field, i + 1, j);
  const c = sampleHeight(field, i, j + 1);
  const d = sampleHeight(field, i + 1, j + 1);
  const vals = [a, b, c, d].filter((v): v is number => v != null);
  if (!vals.length) return null;
  return Math.min(...vals);
}

function pushQuad(
  positions: number[],
  indices: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3
): void {
  const base = positions.length / 3;
  for (const v of [a, b, c, d]) {
    positions.push(v.x, v.y, v.z);
  }
  // a-b-c, a-c-d
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * 셀마다 바닥(Y=0)~상단 높이의 직육면체(계단 블록) 메시.
 * i→+X(동), j→−Z(북)
 */
export function createSteppedGroundGeometry(field: GroundHeightField): THREE.BufferGeometry | null {
  const size = field.size;
  if (size < 2) return null;

  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepU = field.stepM / scale;
  const mid = (size - 1) / 2;
  const y0 = elevToSceneY(field.baseElevM);

  const positions: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      const elev = cellHeight(field, i, j);
      if (elev == null) continue;
      const y1 = Math.max(y0 + 0.02, elevToSceneY(elev));
      const x0 = (i - mid) * stepU;
      const x1 = (i + 1 - mid) * stepU;
      // j 증가 = 북 = −Z
      const zS = -(j - mid) * stepU; // 남쪽 변 (+Z 쪽)
      const zN = -(j + 1 - mid) * stepU; // 북쪽 변

      const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

      // 상단
      pushQuad(positions, indices, v(x0, y1, zS), v(x1, y1, zS), v(x1, y1, zN), v(x0, y1, zN));
      // 하단
      pushQuad(positions, indices, v(x0, y0, zN), v(x1, y0, zN), v(x1, y0, zS), v(x0, y0, zS));
      // 남 (+Z)
      pushQuad(positions, indices, v(x0, y0, zS), v(x1, y0, zS), v(x1, y1, zS), v(x0, y1, zS));
      // 북 (−Z)
      pushQuad(positions, indices, v(x1, y0, zN), v(x0, y0, zN), v(x0, y1, zN), v(x1, y1, zN));
      // 서 (−X)
      pushQuad(positions, indices, v(x0, y0, zN), v(x0, y0, zS), v(x0, y1, zS), v(x0, y1, zN));
      // 동 (+X)
      pushQuad(positions, indices, v(x1, y0, zS), v(x1, y0, zN), v(x1, y1, zN), v(x1, y1, zS));
    }
  }

  if (!positions.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
