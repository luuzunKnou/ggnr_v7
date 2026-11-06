import * as THREE from 'three';
import type { GroundContourLine, GroundHeightField } from './shapeTypes';
import { GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import { sampleHeight, sampleSurfaceY } from './groundSteppedMesh';

export const GROUND_CONTOUR_KEY = 'ggnrGroundContour';

const LINE_COLOR = 0xf59e0b;
const LABEL_SCALE = 0.32;
/** 표면 위 살짝 띄워 z-fighting 방지 */
const Y_EPS = 0.03;

function elevKey(h: number): number {
  return Math.round(h * 100) / 100;
}

function fmtElev(h: number): string {
  const v = elevKey(h);
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
}

function makeHeightLabel(text: string): THREE.Sprite {
  const pad = 4;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: LINE_COLOR }));
  }
  const label = `${text} m`;
  ctx.font = 'bold 26px "Malgun Gothic", "Nanum Gothic", sans-serif';
  const metrics = ctx.measureText(label);
  const tw = Math.ceil(metrics.width);
  const th = 30;
  canvas.width = tw + pad * 2;
  canvas.height = th + pad * 2;
  ctx.font = 'bold 26px "Malgun Gothic", "Nanum Gothic", sans-serif';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  const r = 4;
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
  ctx.fillStyle = '#fef3c7';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pad, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(LABEL_SCALE * (w / h), LABEL_SCALE, 1);
  sprite.raycast = () => {};
  sprite.userData[GROUND_CONTOUR_KEY] = true;
  return sprite;
}

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

function addLineSegments(
  root: THREE.Group,
  linePositions: number[],
  labelAt: Map<number, { x: number; y: number; z: number; len: number }>
): void {
  if (linePositions.length >= 6) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: LINE_COLOR,
        depthTest: true,
        transparent: true,
        opacity: 0.95,
      })
    );
    lines.userData.isEdge = true;
    lines.userData[GROUND_CONTOUR_KEY] = true;
    lines.raycast = () => {};
    root.add(lines);
  }

  for (const [elev, p] of labelAt) {
    if (p.len < 0.2) continue;
    const label = makeHeightLabel(fmtElev(elev));
    label.position.set(p.x, p.y + 0.02, p.z);
    root.add(label);
  }
}

/**
 * 실제 elevation 등고선(평면도와 동일 cont)을
 * 기울기 보간 메시 표면에 드레이프(고정 해발 Y 사용 금지).
 */
function createFromRealContours(
  root: THREE.Group,
  field: GroundHeightField,
  contours: GroundContourLine[]
): void {
  const scale = GROUND_SCENE_M_PER_UNIT;
  const m2p = meterToProjAtY3857(field.centerY);
  // 메시와 동일: ((size-1)/2)×stepM (radiusM 단독 사용 시 step 올림 어긋남)
  const half = ((field.size - 1) / 2) * (field.stepM / scale);
  const stepU = field.stepM / scale;
  /** 격자보다 촘촘히 샘플해 경사면에서 직선이 메시에 파묻히지 않게 */
  const densify = Math.max(0.2, stepU * 0.4);
  const linePositions: number[] = [];
  const labelAt = new Map<number, { x: number; y: number; z: number; len: number }>();

  for (const line of contours) {
    if (!line.coords3857 || line.coords3857.length < 2) continue;
    const elev = elevKey(line.elevM);
    const locals: { x: number; z: number }[] = [];
    for (const [gx, gy] of line.coords3857) {
      const p = mercatorToLocal(gx, gy, field.centerX, field.centerY, m2p);
      // 선택 정사각 밖은 버림
      if (Math.abs(p.x) > half + 0.05 || Math.abs(p.z) > half + 0.05) {
        if (locals.length >= 2) {
          flushDrapedPolyline(field, linePositions, locals, elev, densify, labelAt);
        }
        locals.length = 0;
        continue;
      }
      locals.push(p);
    }
    if (locals.length >= 2) {
      flushDrapedPolyline(field, linePositions, locals, elev, densify, labelAt);
    }
  }

  addLineSegments(root, linePositions, labelAt);
}

function surfaceYAt(field: GroundHeightField, x: number, z: number): number {
  return sampleSurfaceY(field, x, z) + Y_EPS;
}

/** 폴리라인을 지형 표면에 맞춰 분할·드레이프 */
function flushDrapedPolyline(
  field: GroundHeightField,
  linePositions: number[],
  locals: { x: number; z: number }[],
  elev: number,
  densify: number,
  labelAt: Map<number, { x: number; y: number; z: number; len: number }>
): void {
  const draped: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < locals.length; i++) {
    const cur = locals[i];
    if (i === 0) {
      draped.push({ x: cur.x, y: surfaceYAt(field, cur.x, cur.z), z: cur.z });
      continue;
    }
    const prev = locals[i - 1];
    const len = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    const n = Math.max(1, Math.ceil(len / densify));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = prev.x + t * (cur.x - prev.x);
      const z = prev.z + t * (cur.z - prev.z);
      draped.push({ x, y: surfaceYAt(field, x, z), z });
    }
  }

  let segLen = 0;
  for (let i = 1; i < draped.length; i++) {
    const a = draped[i - 1];
    const b = draped[i];
    linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    segLen += Math.hypot(b.x - a.x, b.z - a.z);
  }
  if (segLen < 0.15) return;

  const halfLen = segLen * 0.5;
  let acc = 0;
  let mid = draped[0];
  for (let i = 1; i < draped.length; i++) {
    const a = draped[i - 1];
    const b = draped[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + len >= halfLen) {
      const t = len > 0 ? (halfLen - acc) / len : 0;
      mid = {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
        z: a.z + t * (b.z - a.z),
      };
      break;
    }
    acc += len;
  }

  const prev = labelAt.get(elev);
  if (!prev || segLen > prev.len) {
    labelAt.set(elev, { x: mid.x, y: mid.y, z: mid.z, len: segLen });
  }
}

function gridXZ(
  i: number,
  j: number,
  mid: number,
  stepU: number
): { x: number; z: number } {
  return {
    x: (i - mid) * stepU,
    z: -(j - mid) * stepU,
  };
}

function edgeCross(
  x0: number,
  z0: number,
  h0: number,
  x1: number,
  z1: number,
  h1: number,
  level: number
): { x: number; z: number } | null {
  const d0 = h0 - level;
  const d1 = h1 - level;
  if (d0 === 0 && d1 === 0) return null;
  if (d0 === 0) return { x: x0, z: z0 };
  if (d1 === 0) return { x: x1, z: z1 };
  if (d0 * d1 > 0) return null;
  const t = d0 / (d0 - d1);
  if (t < 0 || t > 1) return null;
  return { x: x0 + t * (x1 - x0), z: z0 + t * (z1 - z0) };
}

/**
 * 폴백: 격자 heights에 실제로 등장하는 등고 레벨만 마칭 스퀘어.
 * (임의 등간격 생성 금지)
 */
function createFromHeightLevels(root: THREE.Group, field: GroundHeightField): void {
  const size = field.size;
  if (size < 2 || !field.heights?.length) return;

  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepU = field.stepM / scale;
  const mid = (size - 1) / 2;

  const levelSet = new Set<number>();
  if (field.levels?.length) {
    for (const L of field.levels) {
      if (Number.isFinite(L)) levelSet.add(elevKey(L));
    }
  } else {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const h = sampleHeight(field, i, j);
        if (h != null) levelSet.add(elevKey(h));
      }
    }
  }
  const levels = [...levelSet].sort((a, b) => a - b);
  // 최저는 영역 경계만 되는 경우가 많아 등고에서 제외(상위 레벨만)
  const drawLevels = levels.length > 1 ? levels.slice(1) : levels;
  if (!drawLevels.length) return;

  const linePositions: number[] = [];
  const labelAt = new Map<number, { x: number; y: number; z: number; len: number }>();

  for (const level of drawLevels) {
    for (let j = 0; j < size - 1; j++) {
      for (let i = 0; i < size - 1; i++) {
        const h00 = sampleHeight(field, i, j);
        const h10 = sampleHeight(field, i + 1, j);
        const h01 = sampleHeight(field, i, j + 1);
        const h11 = sampleHeight(field, i + 1, j + 1);
        if (h00 == null || h10 == null || h01 == null || h11 == null) continue;

        const p00 = gridXZ(i, j, mid, stepU);
        const p10 = gridXZ(i + 1, j, mid, stepU);
        const p01 = gridXZ(i, j + 1, mid, stepU);
        const p11 = gridXZ(i + 1, j + 1, mid, stepU);

        const crossings: { x: number; z: number }[] = [];
        const push = (c: { x: number; z: number } | null) => {
          if (!c) return;
          if (
            crossings.some(
              (p) => Math.abs(p.x - c.x) < 1e-9 && Math.abs(p.z - c.z) < 1e-9
            )
          ) {
            return;
          }
          crossings.push(c);
        };
        push(edgeCross(p00.x, p00.z, h00, p10.x, p10.z, h10, level));
        push(edgeCross(p10.x, p10.z, h10, p11.x, p11.z, h11, level));
        push(edgeCross(p01.x, p01.z, h01, p11.x, p11.z, h11, level));
        push(edgeCross(p00.x, p00.z, h00, p01.x, p01.z, h01, level));

        if (crossings.length === 2) {
          const [a, b] = crossings;
          const ya = surfaceYAt(field, a.x, a.z);
          const yb = surfaceYAt(field, b.x, b.z);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          linePositions.push(a.x, ya, a.z, b.x, yb, b.z);
          const prev = labelAt.get(level);
          if (!prev || len > prev.len) {
            labelAt.set(level, {
              x: (a.x + b.x) * 0.5,
              y: (ya + yb) * 0.5,
              z: (a.z + b.z) * 0.5,
              len,
            });
          }
        } else if (crossings.length === 4) {
          const [a, b, c, d] = crossings;
          linePositions.push(
            a.x,
            surfaceYAt(field, a.x, a.z),
            a.z,
            b.x,
            surfaceYAt(field, b.x, b.z),
            b.z,
            c.x,
            surfaceYAt(field, c.x, c.z),
            c.z,
            d.x,
            surfaceYAt(field, d.x, d.z),
            d.z
          );
        }
      }
    }
  }

  addLineSegments(root, linePositions, labelAt);
}

/**
 * 지형 위 등고선.
 * 1) 실제 elevation 등고선(cont) 우선 — 평면도 간격·형상과 동일
 * 2) 없으면 격자 heights에 등장하는 레벨만 사용 (임의 등간격 금지)
 */
export function createGroundContourOverlay(field: GroundHeightField): THREE.Group {
  const root = new THREE.Group();
  root.name = 'groundContours';
  root.userData[GROUND_CONTOUR_KEY] = true;

  if (field.contours?.length) {
    createFromRealContours(root, field, field.contours);
    return root;
  }

  createFromHeightLevels(root, field);
  return root;
}
