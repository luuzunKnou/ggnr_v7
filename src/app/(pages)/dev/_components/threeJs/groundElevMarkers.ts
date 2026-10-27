import * as THREE from 'three';
import type { GroundHeightField } from './shapeTypes';
import { GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import { sampleHeight, sampleSurfaceY } from './groundSteppedMesh';

export const GROUND_ELEV_MARKER_KEY = 'ggnrGroundElevMarker';

const LABEL_SCALE = 0.38;
const Y_EPS = 0.06;
/** 이 이상 고도 차가 날 때만 별도 표기 */
const MIN_DELTA_M = 0.5;
/** 라벨끼리 최소 간격(씬 단위 m) */
const MIN_SPACING_M = 8;
const MAX_LABELS = 6;

function elevKey(h: number): number {
  return Math.round(h * 10) / 10;
}

function fmtElev(h: number): string {
  const v = elevKey(h);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function makeJibangoSprite(elevM: number): THREE.Sprite {
  const pad = 6;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const text = `지반고 ${fmtElev(elevM)}m`;
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x84cc16 }));
  }
  ctx.font = 'bold 26px "Malgun Gothic", "Nanum Gothic", sans-serif';
  const tw = Math.ceil(ctx.measureText(text).width);
  const th = 30;
  canvas.width = tw + pad * 2;
  canvas.height = th + pad * 2;
  ctx.font = 'bold 26px "Malgun Gothic", "Nanum Gothic", sans-serif';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  ctx.strokeStyle = '#84cc16';
  ctx.lineWidth = 1.5;
  const r = 5;
  const w = canvas.width;
  const h = canvas.height;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ecfccb';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    })
  );
  sprite.scale.set(LABEL_SCALE * (w / h), LABEL_SCALE, 1);
  sprite.raycast = () => {};
  sprite.userData[GROUND_ELEV_MARKER_KEY] = true;
  sprite.userData.isEdge = true;
  return sprite;
}

type Candidate = {
  elev: number;
  x: number;
  z: number;
  /** 이웃과 고도 차 합 — 변화가 큰 곳 우선 */
  score: number;
};

/**
 * 지반고: 이웃과 고도 차가 나는 격자점만.
 * 동일 고도·근접 라벨은 1개로 줄임. 평탄하면 표기 없음.
 */
export function createGroundElevMarkers(field: GroundHeightField): THREE.Group {
  const root = new THREE.Group();
  root.name = 'groundElevMarkers';
  root.userData[GROUND_ELEV_MARKER_KEY] = true;
  if (field.size < 2 || !field.heights?.length) return root;

  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepU = field.stepM / scale;
  const mid = (field.size - 1) / 2;
  const size = field.size;

  const candidates: Candidate[] = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = sampleHeight(field, i, j);
      if (h == null) continue;
      let score = 0;
      for (const [di, dj] of dirs) {
        const nh = sampleHeight(field, i + di, j + dj);
        if (nh == null) continue;
        const d = Math.abs(h - nh);
        if (d >= MIN_DELTA_M) score += d;
      }
      if (score < MIN_DELTA_M) continue;
      const x = (i - mid) * stepU;
      const z = -(j - mid) * stepU;
      candidates.push({ elev: elevKey(h), x, z, score });
    }
  }

  if (candidates.length === 0) return root;

  // 고도별 최고 score 후보만 남김
  const bestByElev = new Map<number, Candidate>();
  for (const c of candidates) {
    const prev = bestByElev.get(c.elev);
    if (!prev || c.score > prev.score) bestByElev.set(c.elev, c);
  }

  // 고도 오름차순 → 공간 간격 유지하며 배치
  const ordered = [...bestByElev.values()].sort((a, b) => a.elev - b.elev);
  const placed: Candidate[] = [];
  for (const c of ordered) {
    if (placed.length >= MAX_LABELS) break;
    const tooClose = placed.some(
      (p) => Math.hypot(p.x - c.x, p.z - c.z) < MIN_SPACING_M
    );
    if (tooClose) continue;
    // 이미 비슷한 고도(MIN_DELTA 미만)가 있으면 스킵
    const sameBand = placed.some((p) => Math.abs(p.elev - c.elev) < MIN_DELTA_M);
    if (sameBand) continue;
    placed.push(c);
  }

  // 고도 차가 실질적으로 1개뿐이면(표기 의미 없음) 생략 — 2개 이상만
  if (placed.length < 2) return root;

  for (const c of placed) {
    const y = sampleSurfaceY(field, c.x, c.z) + Y_EPS;
    const sprite = makeJibangoSprite(c.elev);
    sprite.position.set(c.x, y + 0.25, c.z);
    root.add(sprite);
  }

  return root;
}
