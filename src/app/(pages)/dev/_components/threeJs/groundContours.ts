import * as THREE from 'three';
import type {
  GroundContourLine,
  GroundHeightField,
  GroundSectionLine,
} from './shapeTypes';
import { GROUND_SCENE_M_PER_UNIT } from './shapeTypes';
import {
  hasValidSurfaceCell,
  sampleHeight,
  sampleSurfaceY,
} from './groundSteppedMesh';
import {
  isInsideSectionRect,
  sectionAxesFromField,
  type SectionAxesLocal,
} from './groundSection';

export const GROUND_CONTOUR_KEY = 'ggnrGroundContour';

/** 범례 «등고선» 기본 주황 */
const DEFAULT_LINE_COLOR = 0xf97316;
const LABEL_SCALE = 0.32;
/** 표면 위 살짝 띄워 z-fighting 방지 */
const Y_EPS = 0.03;

export type GroundContourOverlayOpts = {
  /** 선 색 — 기본 주황 */
  color?: THREE.ColorRepresentation;
  /** 고도 수치 라벨. 기본 false */
  showLabels?: boolean;
  /** 단면도 띠 — 있으면 사각형 발자국 안으로만 */
  sectionLine?: GroundSectionLine | null;
  /** 범례·토글용 featureId */
  featureId?: string;
};

type FootprintClip = {
  half: number;
  axes: SectionAxesLocal | null;
};

function makeFootprintClip(
  field: GroundHeightField,
  sectionLine?: GroundSectionLine | null
): FootprintClip {
  const scale = GROUND_SCENE_M_PER_UNIT;
  const half = ((field.size - 1) / 2) * (field.stepM / scale);
  const axes =
    sectionLine != null ? sectionAxesFromField(field, sectionLine) : null;
  return { half, axes };
}

/** 지형 윗면(메시) 안인지 — 단면 띠 또는 정사각 + 유효 셀 */
function isOnGroundTop(
  field: GroundHeightField,
  x: number,
  z: number,
  clip: FootprintClip
): boolean {
  if (clip.axes) {
    if (!isInsideSectionRect(x, z, clip.axes, 0)) return false;
  } else if (Math.abs(x) > clip.half + 1e-4 || Math.abs(z) > clip.half + 1e-4) {
    return false;
  }
  return hasValidSurfaceCell(field, x, z);
}

/** 드레이프 후 곡선이 면 밖으로 나간 구간 절단 */
function clipDrapedToFootprint(
  field: GroundHeightField,
  pts: { x: number; y: number; z: number }[],
  clip: FootprintClip
): { x: number; y: number; z: number }[][] {
  if (pts.length < 2) return [];
  type P = { x: number; y: number; z: number };
  const inside = (p: P) => isOnGroundTop(field, p.x, p.z, clip);
  const lerp = (a: P, b: P, t: number): P => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  const edgeClip = (a: P, b: P): P => {
    let lo = 0;
    let hi = 1;
    const aIn = inside(a);
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const p = lerp(a, b, mid);
      if (inside(p) === aIn) lo = mid;
      else hi = mid;
    }
    const p = lerp(a, b, (lo + hi) / 2);
    // 경계점은 표면 Y 재샘플
    return { x: p.x, y: surfaceYAt(field, p.x, p.z), z: p.z };
  };

  const runs: P[][] = [];
  let cur: P[] = [];
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

function elevKey(h: number): number {
  return Math.round(h * 100) / 100;
}

function fmtElev(h: number): string {
  const v = elevKey(h);
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
}

function makeHeightLabel(text: string, lineColor: THREE.ColorRepresentation): THREE.Sprite {
  const pad = 4;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const strokeHex = `#${new THREE.Color(lineColor).getHexString()}`;
  if (!ctx) {
    return new THREE.Sprite(new THREE.SpriteMaterial({ color: lineColor }));
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
  ctx.strokeStyle = strokeHex;
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

function addContourPolylines(
  root: THREE.Group,
  polylines: { x: number; y: number; z: number }[][],
  labelAt: Map<number, { x: number; y: number; z: number; len: number }>,
  lineColor: THREE.ColorRepresentation,
  showLabels: boolean
): void {
  const mat = new THREE.LineBasicMaterial({
    color: lineColor,
    depthTest: true,
    transparent: true,
    opacity: 0.95,
  });
  for (const pts of polylines) {
    if (pts.length < 2) continue;
    const geo = new THREE.BufferGeometry().setFromPoints(
      pts.map((p) => new THREE.Vector3(p.x, p.y, p.z))
    );
    const line = new THREE.Line(geo, mat);
    line.userData.isEdge = true;
    line.userData[GROUND_CONTOUR_KEY] = true;
    line.raycast = () => {};
    root.add(line);
  }

  if (!showLabels) return;
  for (const [elev, p] of labelAt) {
    if (p.len < 0.2) continue;
    const label = makeHeightLabel(fmtElev(elev), lineColor);
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
  contours: GroundContourLine[],
  lineColor: THREE.ColorRepresentation,
  showLabels: boolean,
  clip: FootprintClip
): void {
  const m2p = meterToProjAtY3857(field.centerY);
  const stepU = field.stepM / GROUND_SCENE_M_PER_UNIT;
  /** 곡선 샘플 간격 — 격자보다 촘촘히 */
  const densify = Math.max(0.12, stepU * 0.25);
  const polylines: { x: number; y: number; z: number }[][] = [];
  const labelAt = new Map<number, { x: number; y: number; z: number; len: number }>();

  for (const line of contours) {
    if (!line.coords3857 || line.coords3857.length < 2) continue;
    const elev = elevKey(line.elevM);
    const locals: { x: number; z: number }[] = [];
    for (const [gx, gy] of line.coords3857) {
      const p = mercatorToLocal(gx, gy, field.centerX, field.centerY, m2p);
      // 지형 윗면 밖은 끊고 구간만 유지
      if (!isOnGroundTop(field, p.x, p.z, clip)) {
        if (locals.length >= 2) {
          flushDrapedCurve(field, polylines, locals, elev, densify, labelAt, clip);
        }
        locals.length = 0;
        continue;
      }
      locals.push(p);
    }
    if (locals.length >= 2) {
      flushDrapedCurve(field, polylines, locals, elev, densify, labelAt, clip);
    }
  }

  addContourPolylines(root, polylines, labelAt, lineColor, showLabels);
}

function surfaceYAt(field: GroundHeightField, x: number, z: number): number {
  return sampleSurfaceY(field, x, z) + Y_EPS;
}

/**
 * 평면 제어점 → CatmullRom 곡선 샘플 → 지형 표면 드레이프.
 * 직선 꺾임이 아닌 곡선 등고 느낌.
 */
function flushDrapedCurve(
  field: GroundHeightField,
  polylines: { x: number; y: number; z: number }[][],
  locals: { x: number; z: number }[],
  elev: number,
  densify: number,
  labelAt: Map<number, { x: number; y: number; z: number; len: number }>,
  clip: FootprintClip
): void {
  if (locals.length < 2) return;

  // 중복·아주 가까운 점 제거(스플라인 꼬임 방지)
  const cleaned: { x: number; z: number }[] = [locals[0]!];
  for (let i = 1; i < locals.length; i++) {
    const p = locals[i]!;
    const prev = cleaned[cleaned.length - 1]!;
    if (Math.hypot(p.x - prev.x, p.z - prev.z) > 1e-4) cleaned.push(p);
  }
  if (cleaned.length < 2) return;

  let pathLen = 0;
  for (let i = 1; i < cleaned.length; i++) {
    pathLen += Math.hypot(
      cleaned[i]!.x - cleaned[i - 1]!.x,
      cleaned[i]!.z - cleaned[i - 1]!.z
    );
  }
  if (pathLen < 0.15) return;

  const sampleN = Math.max(
    cleaned.length,
    Math.min(400, Math.ceil(pathLen / densify) + 1)
  );

  const drapedRaw: { x: number; y: number; z: number }[] = [];
  if (cleaned.length === 2) {
    for (let k = 0; k <= sampleN; k++) {
      const t = k / sampleN;
      const x = cleaned[0]!.x + t * (cleaned[1]!.x - cleaned[0]!.x);
      const z = cleaned[0]!.z + t * (cleaned[1]!.z - cleaned[0]!.z);
      drapedRaw.push({ x, y: surfaceYAt(field, x, z), z });
    }
  } else {
    const curve = new THREE.CatmullRomCurve3(
      cleaned.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      false,
      'catmullrom',
      0.5
    );
    const samples = curve.getPoints(sampleN);
    for (const s of samples) {
      drapedRaw.push({ x: s.x, y: surfaceYAt(field, s.x, s.z), z: s.z });
    }
  }

  // 곡선 오버슈트·단면 띠 밖·무효 셀 → 윗면 안으로만
  const runs = clipDrapedToFootprint(field, drapedRaw, clip);
  for (const draped of runs) {
    if (draped.length < 2) continue;
    polylines.push(draped);

    let segLen = 0;
    for (let i = 1; i < draped.length; i++) {
      const a = draped[i - 1]!;
      const b = draped[i]!;
      segLen += Math.hypot(b.x - a.x, b.z - a.z);
    }
    const halfLen = segLen * 0.5;
    let acc = 0;
    let mid = draped[0]!;
    for (let i = 1; i < draped.length; i++) {
      const a = draped[i - 1]!;
      const b = draped[i]!;
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
function createFromHeightLevels(
  root: THREE.Group,
  field: GroundHeightField,
  lineColor: THREE.ColorRepresentation,
  showLabels: boolean,
  clip: FootprintClip
): void {
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

  type Seg = { ax: number; az: number; bx: number; bz: number };
  const segsByLevel = new Map<number, Seg[]>();
  const labelAt = new Map<number, { x: number; y: number; z: number; len: number }>();
  const snap = Math.max(1e-6, stepU * 1e-4);

  for (const level of drawLevels) {
    const segs: Seg[] = [];
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
          segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
        } else if (crossings.length === 4) {
          const [a, b, c, d] = crossings;
          segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
          segs.push({ ax: c.x, az: c.z, bx: d.x, bz: d.z });
        }
      }
    }
    segsByLevel.set(level, segs);
  }

  const polylines: { x: number; y: number; z: number }[][] = [];
  const densify = Math.max(0.12, stepU * 0.25);

  for (const [level, segs] of segsByLevel) {
    const used = new Array(segs.length).fill(false);
    const near = (x0: number, z0: number, x1: number, z1: number) =>
      Math.hypot(x0 - x1, z0 - z1) <= snap * 20 + 1e-5;

    for (let si = 0; si < segs.length; si++) {
      if (used[si]) continue;
      used[si] = true;
      const s0 = segs[si]!;
      const chain: { x: number; z: number }[] = [
        { x: s0.ax, z: s0.az },
        { x: s0.bx, z: s0.bz },
      ];
      let extended = true;
      while (extended) {
        extended = false;
        const head = chain[0]!;
        const tail = chain[chain.length - 1]!;
        for (let j = 0; j < segs.length; j++) {
          if (used[j]) continue;
          const s = segs[j]!;
          if (near(tail.x, tail.z, s.ax, s.az)) {
            chain.push({ x: s.bx, z: s.bz });
            used[j] = true;
            extended = true;
            break;
          }
          if (near(tail.x, tail.z, s.bx, s.bz)) {
            chain.push({ x: s.ax, z: s.az });
            used[j] = true;
            extended = true;
            break;
          }
          if (near(head.x, head.z, s.bx, s.bz)) {
            chain.unshift({ x: s.ax, z: s.az });
            used[j] = true;
            extended = true;
            break;
          }
          if (near(head.x, head.z, s.ax, s.az)) {
            chain.unshift({ x: s.bx, z: s.bz });
            used[j] = true;
            extended = true;
            break;
          }
        }
      }
      flushDrapedCurve(field, polylines, chain, level, densify, labelAt, clip);
    }
  }

  addContourPolylines(root, polylines, labelAt, lineColor, showLabels);
}

/**
 * 지형 윗면 등고선 외곽.
 * 1) 실제 elevation 등고선(cont) 우선 — 평면도 간격·형상과 동일
 * 2) 없으면 격자 heights에 등장하는 레벨만 사용 (임의 등간격 금지)
 * 선 색은 지형 외곽선과 동일하게 넘기고, 수치는 기본 숨김.
 * 단면 띠·유효 셀 밖은 그리지 않음.
 */
export function createGroundContourOverlay(
  field: GroundHeightField,
  opts?: GroundContourOverlayOpts
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'groundContours';
  root.userData[GROUND_CONTOUR_KEY] = true;
  root.userData.isEdge = true;
  if (opts?.featureId) root.userData.featureId = opts.featureId;

  const lineColor = opts?.color ?? DEFAULT_LINE_COLOR;
  const showLabels = opts?.showLabels === true;
  const clip = makeFootprintClip(field, opts?.sectionLine);

  if (field.contours?.length) {
    createFromRealContours(
      root,
      field,
      field.contours,
      lineColor,
      showLabels,
      clip
    );
    return root;
  }

  createFromHeightLevels(root, field, lineColor, showLabels, clip);
  return root;
}
