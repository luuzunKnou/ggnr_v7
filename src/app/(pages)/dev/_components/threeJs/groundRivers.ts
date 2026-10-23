import * as THREE from 'three';
import type { GroundHeightField, GroundRiverPoly } from './shapeTypes';
import { sampleSurfaceY } from './groundSteppedMesh';

export const GROUND_RIVER_KEY = 'ggnrGroundRiver';

const Y_EPS = 0.04;

export type GroundRiverStyle = {
  color?: string;
  opacity?: number;
};

function meterToProjAtY3857(y3857: number): number {
  const latRad = 2 * Math.atan(Math.exp(y3857 / 6378137)) - Math.PI / 2;
  const cosLat = Math.cos(latRad);
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return 1;
  return 1 / cosLat;
}

function mercatorToLocal(
  x3857: number,
  y3857: number,
  centerX: number,
  centerY: number,
  meterToProj: number
): { x: number; z: number } {
  return {
    x: (x3857 - centerX) / meterToProj,
    z: -(y3857 - centerY) / meterToProj,
  };
}

function ringToLocal(
  ring: [number, number][],
  field: GroundHeightField,
  m2p: number
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const [gx, gy] of ring) {
    out.push(mercatorToLocal(gx, gy, field.centerX, field.centerY, m2p));
  }
  // 닫힌 링이면 마지막 중복점 제거 (ShapeUtils)
  if (
    out.length >= 2 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z) < 1e-6
  ) {
    out.pop();
  }
  return out;
}

function addDrapedOutline(
  parent: THREE.Group,
  locals: { x: number; z: number }[],
  field: GroundHeightField,
  color: string,
  opacity: number
): void {
  if (locals.length < 2) return;
  const pts: THREE.Vector3[] = [];
  for (const p of locals) {
    pts.push(new THREE.Vector3(p.x, sampleSurfaceY(field, p.x, p.z) + Y_EPS, p.z));
  }
  // 닫기
  pts.push(pts[0].clone());
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({
      color,
      depthTest: true,
      transparent: true,
      opacity: Math.min(1, opacity + 0.35),
    })
  );
  line.userData.isEdge = true;
  line.userData[GROUND_RIVER_KEY] = true;
  line.raycast = () => {};
  parent.add(line);
}

function addDrapedFill(
  parent: THREE.Group,
  rings: { x: number; z: number }[][],
  field: GroundHeightField,
  color: string,
  opacity: number
): void {
  if (!rings.length || rings[0].length < 3) return;
  const outer = rings[0].map((p) => new THREE.Vector2(p.x, p.z));
  const holes = rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p.x, p.z)));

  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(outer, holes);
  } catch {
    return;
  }
  if (!faces.length) return;

  const positions: number[] = [];
  const indices: number[] = [];
  const vertIndex = new Map<string, number>();

  const getIdx = (x: number, z: number): number => {
    const key = `${x.toFixed(5)},${z.toFixed(5)}`;
    const existing = vertIndex.get(key);
    if (existing != null) return existing;
    const y = sampleSurfaceY(field, x, z) + Y_EPS * 0.5;
    const i = positions.length / 3;
    positions.push(x, y, z);
    vertIndex.set(key, i);
    return i;
  };

  // triangulateShape 인덱스는 outer+holes 순 concat
  const flatPts = [...outer, ...holes.flat()];
  for (const face of faces) {
    if (face.length < 3) continue;
    const p0 = flatPts[face[0]];
    const p1 = flatPts[face[1]];
    const p2 = flatPts[face[2]];
    if (!p0 || !p1 || !p2) continue;
    indices.push(getIdx(p0.x, p0.y), getIdx(p1.x, p1.y), getIdx(p2.x, p2.y));
  }

  if (indices.length < 3 || !positions.length) return;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: Math.max(0.02, Math.min(1, opacity)),
      depthWrite: false,
      side: THREE.DoubleSide,
      metalness: 0.05,
      roughness: 0.7,
    })
  );
  mesh.userData.isFill = true;
  mesh.userData[GROUND_RIVER_KEY] = true;
  parent.add(mesh);
}

/**
 * 지형 표면 위 지방하천·소하천 구역 (채움 + 외곽선).
 */
export function createGroundRiverOverlay(
  field: GroundHeightField,
  style?: GroundRiverStyle
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'groundRivers';
  root.userData[GROUND_RIVER_KEY] = true;

  const rivers = field.rivers;
  if (!rivers?.length || field.size < 2) return root;

  const color = style?.color || '#2563eb';
  const opacity = style?.opacity ?? 0.4;
  const m2p = meterToProjAtY3857(field.centerY);

  for (const river of rivers as GroundRiverPoly[]) {
    if (!river.rings3857?.length) continue;
    const localRings = river.rings3857
      .map((ring) => ringToLocal(ring, field, m2p))
      .filter((r) => r.length >= 3);
    if (!localRings.length) continue;

    addDrapedFill(root, localRings, field, color, opacity);
    addDrapedOutline(root, localRings[0], field, color, opacity);
  }

  return root;
}
