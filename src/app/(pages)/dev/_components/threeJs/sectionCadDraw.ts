import * as THREE from 'three';
import {
  clipPolylineXZToSectionRect,
  sectionAxesFromField,
  sectionLineLengthM,
  type SectionAxesLocal,
} from './groundSection';
import { sampleSurfaceY } from './groundSteppedMesh';
import { getShapeProps } from './createShapeObject';
import { getWtlLayerShapeDef } from '@/lib/wtlLayerShapeDefs';
import {
  GROUND_SCENE_M_PER_UNIT,
  SHAPE_NAME_KEY,
  elevToSceneY,
  isLineLayerShape,
  isPointLayerShape,
  type GroundHeightField,
  type ManholeFeature,
  type PipeSegment,
  type ShapeProps,
} from './shapeTypes';

const SNAP_W = 1600;
const SNAP_H = 1200;
const BG = '#1a1a1e';
const GRID = '#2a2a32';
const AXIS = '#64748b';
const GROUND_STROKE = '#e2e8f0';
const PIPE_STROKE = '#38bdf8';
const MANH_STROKE = '#c084fc';
const PRIM_STROKE = '#4ade80';
const LABEL = '#94a3b8';
const TITLE = '#e2e8f0';
const DIM = '#fbbf24';

const EMPTY_SECTION =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect fill="#1a1a1e" width="100%" height="100%"/><text x="50%" y="50%" fill="#666" font-size="12" text-anchor="middle" dominant-baseline="middle">지반 또는 도형 필요</text></svg>'
  );

type PrimFeat = {
  kind: 'box' | 'sphere' | 'cylinder';
  lx: number;
  lz: number;
  y0: number;
  y1: number;
  halfW: number;
  halfD: number;
  radius: number;
  color: string;
  name: string;
  kindLabel: string;
};

type TaggedPipe = PipeSegment & { layerLabel: string };
type TaggedManh = ManholeFeature & { layerLabel: string };

type LocalPt = { x: number; z: number; elev: number; surf: number; depth: number };

type CadLabelItem = {
  dataX: number;
  dataY: number;
  kindLine: string;
  labelLine: string;
  color: string;
};

/**
 * isSection(단면도 지반):
 *  - 횡단 = 절단선 거리 × 표고, 관·맨홀은 절단 평면 교차 → 원
 *  - 종단 = 관로 진행(또는 깊이) 방향 × 표고, 관은 외경 상·하선
 * extent(범위 지반):
 *  - 종단 = 동서, 횡단 = 남북(중점)
 */
type CadCtx = {
  field: GroundHeightField | null;
  axes: SectionAxesLocal;
  lengthM: number;
  depthM: number;
  isSection: boolean;
  pipes: TaggedPipe[];
  manholes: TaggedManh[];
  prims: PrimFeat[];
  caption: string;
};

function meterToProjAtY3857(y3857: number): number {
  const latRad = 2 * Math.atan(Math.exp(y3857 / 6378137)) - Math.PI / 2;
  const cosLat = Math.cos(latRad);
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return 1;
  return 1 / cosLat;
}

function toLocal(
  x3857: number,
  y3857: number,
  field: GroundHeightField
): { x: number; z: number } {
  const m2p = meterToProjAtY3857(field.centerY);
  const scale = GROUND_SCENE_M_PER_UNIT;
  return {
    x: (x3857 - field.centerX) / m2p / scale,
    z: -(y3857 - field.centerY) / m2p / scale,
  };
}

function uvOf(
  lx: number,
  lz: number,
  axes: SectionAxesLocal
): { u: number; v: number } {
  const dx = lx - axes.midX;
  const dz = lz - axes.midZ;
  return {
    u: dx * axes.alongX + dz * axes.alongZ,
    v: dx * axes.perpX + dz * axes.perpZ,
  };
}

function sampleHeightAt(
  field: GroundHeightField,
  i: number,
  j: number
): number | null {
  const { size, heights } = field;
  if (i < 0 || j < 0 || i >= size || j >= size) return null;
  const h = heights[j * size + i];
  return h != null && Number.isFinite(h) ? h : null;
}

/** 고도장 보간. null 칸은 최저표고 대신 주변 유효값 우선 (단면도 클립 경계 왜곡 완화) */
function elevAtLocal(field: GroundHeightField | null, lx: number, lz: number): number {
  if (!field || field.size < 2) return 0;
  const size = field.size;
  const scale = GROUND_SCENE_M_PER_UNIT;
  const stepU = field.stepM / scale;
  const mid = (size - 1) / 2;
  const fi = lx / stepU + mid;
  const fj = -lz / stepU + mid;
  const i0 = Math.max(0, Math.min(size - 2, Math.floor(fi)));
  const j0 = Math.max(0, Math.min(size - 2, Math.floor(fj)));
  const tx = Math.max(0, Math.min(1, fi - i0));
  const ty = Math.max(0, Math.min(1, fj - j0));

  const corners: { w: number; h: number }[] = [];
  const push = (i: number, j: number, w: number) => {
    if (w <= 0) return;
    const h = sampleHeightAt(field, i, j);
    if (h != null) corners.push({ w, h });
  };
  if (tx + ty <= 1) {
    push(i0, j0, 1 - tx - ty);
    push(i0 + 1, j0, tx);
    push(i0, j0 + 1, ty);
  } else {
    push(i0 + 1, j0, 1 - ty);
    push(i0 + 1, j0 + 1, tx + ty - 1);
    push(i0, j0 + 1, 1 - tx);
  }
  if (corners.length) {
    const wSum = corners.reduce((s, c) => s + c.w, 0);
    const elev = corners.reduce((s, c) => s + c.h * c.w, 0) / (wSum || 1);
    return elevToSceneY(elev);
  }

  // 셀 전체가 null → 최근접 유효 격자
  let best: number | null = null;
  let bestD = Infinity;
  const ic = Math.round(fi);
  const jc = Math.round(fj);
  for (let rad = 0; rad < size; rad++) {
    for (let dj = -rad; dj <= rad; dj++) {
      for (let di = -rad; di <= rad; di++) {
        if (rad > 0 && Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        const h = sampleHeightAt(field, ic + di, jc + dj);
        if (h == null) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
    }
    if (best != null) break;
  }
  if (best != null) return elevToSceneY(best);
  return sampleSurfaceY(field, lx, lz);
}

function groundElevAtPoly(
  ground: { x: number; y: number }[],
  x: number
): number | null {
  if (!ground.length) return null;
  if (x <= ground[0]!.x) return ground[0]!.y;
  const last = ground[ground.length - 1]!;
  if (x >= last.x) return last.y;
  for (let i = 0; i < ground.length - 1; i++) {
    const a = ground[i]!;
    const b = ground[i + 1]!;
    if (x < a.x || x > b.x) continue;
    const dx = b.x - a.x;
    const t = Math.abs(dx) < 1e-9 ? 0 : (x - a.x) / dx;
    return a.y + (b.y - a.y) * t;
  }
  return last.y;
}

/** 그린 지표면 보간에 심도를 적용 — 횡·종단 표고선과 관 표고 기준 통일 */
function pipeElevOnGround(
  ground: { x: number; y: number }[],
  stationX: number,
  depthM: number,
  fallbackSurf: number
): { surf: number; elev: number } {
  const surf = groundElevAtPoly(ground, stationX) ?? fallbackSurf;
  const depth = Math.max(0.05, depthM);
  return { surf, elev: surf - depth };
}

function extentAxesFromField(field: GroundHeightField): SectionAxesLocal {
  const scale = GROUND_SCENE_M_PER_UNIT;
  const half = Math.max(1, field.radiusM) / scale;
  return {
    midX: 0,
    midZ: 0,
    alongX: 1,
    alongZ: 0,
    perpX: 0,
    perpZ: -1,
    halfLenM: half,
    halfWidthM: half,
  };
}

function axesFromPrims(prims: PrimFeat[]): SectionAxesLocal {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of prims) {
    minX = Math.min(minX, p.lx - p.halfW);
    maxX = Math.max(maxX, p.lx + p.halfW);
    minZ = Math.min(minZ, p.lz - p.halfD);
    maxZ = Math.max(maxZ, p.lz + p.halfD);
  }
  if (!Number.isFinite(minX)) {
    minX = -5;
    maxX = 5;
    minZ = -5;
    maxZ = 5;
  }
  return {
    midX: (minX + maxX) / 2,
    midZ: (minZ + maxZ) / 2,
    alongX: 1,
    alongZ: 0,
    perpX: 0,
    perpZ: -1,
    halfLenM: Math.max(1, (maxX - minX) / 2),
    halfWidthM: Math.max(1, (maxZ - minZ) / 2),
  };
}

function primFromProps(props: ShapeProps, name: string): PrimFeat | null {
  if (props.kind === 'box') {
    return {
      kind: 'box',
      lx: props.posX,
      lz: props.posZ,
      y0: props.floorHeight,
      y1: props.floorHeight + props.height,
      halfW: props.width / 2,
      halfD: props.depth / 2,
      radius: Math.max(props.width, props.depth) / 2,
      color: props.color || PRIM_STROKE,
      name,
      kindLabel: '박스',
    };
  }
  if (props.kind === 'sphere') {
    const r = props.radius;
    return {
      kind: 'sphere',
      lx: props.posX,
      lz: props.posZ,
      y0: props.floorHeight,
      y1: props.floorHeight + r * 2,
      halfW: r,
      halfD: r,
      radius: r,
      color: props.color || PRIM_STROKE,
      name,
      kindLabel: '구',
    };
  }
  if (props.kind === 'cylinder') {
    const r = props.radius;
    return {
      kind: 'cylinder',
      lx: props.posX,
      lz: props.posZ,
      y0: props.floorHeight,
      y1: props.floorHeight + props.height,
      halfW: r,
      halfD: r,
      radius: r,
      color: props.color || PRIM_STROKE,
      name,
      kindLabel: '원기둥',
    };
  }
  return null;
}

function pipeLocalPts(pipe: PipeSegment, field: GroundHeightField): LocalPt[] {
  const out: LocalPt[] = [];
  const coords = pipe.coords3857 ?? [];
  for (let i = 0; i < coords.length; i++) {
    const [x, y] = coords[i]!;
    const loc = toLocal(x, y, field);
    // 3D와 동일 — 해당 좌표 지표 고도장 보간 (중점 surfaceElevM 사용 금지)
    const surf = elevAtLocal(field, loc.x, loc.z);
    const depthRaw =
      pipe.depthsM && pipe.depthsM.length === coords.length
        ? pipe.depthsM[i]
        : pipe.depthM;
    const depth = Math.max(0.05, depthRaw ?? pipe.depthM);
    out.push({
      x: loc.x,
      z: loc.z,
      surf,
      depth,
      elev: surf - depth,
    });
  }
  return out;
}

function lerpLocal(a: LocalPt, b: LocalPt, t: number): LocalPt {
  const depth = a.depth + (b.depth - a.depth) * t;
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  // surf/elev 은 교차 지점에서 고도장으로 다시 잡음
  return {
    x,
    z,
    depth,
    surf: a.surf + (b.surf - a.surf) * t,
    elev: a.elev + (b.elev - a.elev) * t,
  };
}

/** 교차점: 그 위치 지표 − 심도 (CAD 표고선과 동일 기준) */
function elevAtIntersection(
  field: GroundHeightField,
  p: LocalPt
): { surf: number; elev: number } {
  const surf = elevAtLocal(field, p.x, p.z);
  return { surf, elev: surf - Math.max(0.05, p.depth) };
}

/** 절단 평면(v=0)과 관 교차 — 꼭짓점이 띠 밖이어도 교차점 사용 */
function intersectPipeCutPlane(
  pipe: PipeSegment,
  field: GroundHeightField,
  axes: SectionAxesLocal,
  padU = 0.75
): { station: number; elev: number; surf: number; r: number; label?: string; color: string } | null {
  const pts = pipeLocalPts(pipe, field);
  if (pts.length < 2) return null;
  const depth = axes.halfWidthM;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const ua = uvOf(a.x, a.z, axes);
    const ub = uvOf(b.x, b.z, axes);
    // 절단 평면 v=0 교차. 띠 근처(깊이)를 지나가는 관만
    const nearStrip =
      (ua.v >= -padU && ua.v <= depth + padU) ||
      (ub.v >= -padU && ub.v <= depth + padU) ||
      ua.v * ub.v <= 0;
    if (!nearStrip) continue;
    if (ua.v * ub.v > 0 && Math.abs(ua.v) > 1e-4 && Math.abs(ub.v) > 1e-4) continue;
    const dv = ub.v - ua.v;
    const t = Math.abs(dv) < 1e-9 ? 0 : -ua.v / dv;
    if (t < -0.02 || t > 1.02) continue;
    const u = ua.u + (ub.u - ua.u) * t;
    if (Math.abs(u) > axes.halfLenM + padU) continue;
    const p = lerpLocal(a, b, Math.max(0, Math.min(1, t)));
    const { surf, elev } = elevAtIntersection(field, p);
    return {
      station: u + axes.halfLenM,
      elev,
      surf,
      r: Math.max(0.04, pipe.diameterM / 2),
      label: pipe.label || `${Math.round(pipe.diameterM * 1000)}`,
      color: pipe.color || PIPE_STROKE,
    };
  }
  return null;
}

/** 범위 지반 횡단 — 동서 중점 평면(u=0) 교차 */
function intersectPipeMidU(
  pipe: PipeSegment,
  field: GroundHeightField,
  axes: SectionAxesLocal,
  pad = 0.75
): { offset: number; elev: number; surf: number; r: number; label?: string; color: string } | null {
  const pts = pipeLocalPts(pipe, field);
  if (pts.length < 2) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const ua = uvOf(a.x, a.z, axes);
    const ub = uvOf(b.x, b.z, axes);
    if (ua.u * ub.u > 0 && Math.abs(ua.u) > pad && Math.abs(ub.u) > pad) continue;
    const du = ub.u - ua.u;
    const t = Math.abs(du) < 1e-9 ? 0 : -ua.u / du;
    if (t < -0.02 || t > 1.02) continue;
    const v = ua.v + (ub.v - ua.v) * t;
    if (Math.abs(v) > axes.halfWidthM + pad) continue;
    const p = lerpLocal(a, b, Math.max(0, Math.min(1, t)));
    const { surf, elev } = elevAtIntersection(field, p);
    return {
      offset: v,
      elev,
      surf,
      r: Math.max(0.04, pipe.diameterM / 2),
      label: pipe.label || `${Math.round(pipe.diameterM * 1000)}`,
      color: pipe.color || PIPE_STROKE,
    };
  }
  return null;
}

function clipPipeRuns(
  pipe: PipeSegment,
  field: GroundHeightField,
  axes: SectionAxesLocal
): LocalPt[][] {
  const pts = pipeLocalPts(pipe, field);
  if (pts.length < 2) return [];
  // 단면 띠가 얇아 꼭짓점이 빠져도 경계 보간으로 잡히게 패딩
  return clipPolylineXZToSectionRect(pts, axes, 0.6, lerpLocal);
}

function estimateLongDir(
  pipes: PipeSegment[],
  field: GroundHeightField,
  axes: SectionAxesLocal
): { x: number; z: number } {
  let sx = 0;
  let sz = 0;
  let w = 0;
  for (const pipe of pipes) {
    for (const run of clipPipeRuns(pipe, field, axes)) {
      if (run.length < 2) continue;
      const a = run[0]!;
      const b = run[run.length - 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      sx += dx;
      sz += dz;
      w += len;
    }
  }
  if (w < 1e-4) {
    // 관 없으면 깊이 방향(절단선 수직)을 종단축으로
    return { x: axes.perpX, z: axes.perpZ };
  }
  const len = Math.hypot(sx, sz) || 1;
  return { x: sx / len, z: sz / len };
}

function collectCadContext(shapesRoot: THREE.Object3D): CadCtx | null {
  type GroundHit = {
    field: GroundHeightField;
    axes: SectionAxesLocal;
    lengthM: number;
    depthM: number;
    isSection: boolean;
    caption: string;
    priority: number;
  };
  const grounds: GroundHit[] = [];
  const pipes: TaggedPipe[] = [];
  const manholes: TaggedManh[] = [];
  const prims: PrimFeat[] = [];

  for (const child of shapesRoot.children) {
    if (!(child instanceof THREE.Group)) continue;
    const props = getShapeProps(child);
    if (!props) continue;
    const name = String(child.userData?.[SHAPE_NAME_KEY] ?? props.kind);
    const layerLabel = getWtlLayerShapeDef(props.kind)?.label ?? name;

    if (props.kind === 'ground' && props.groundHeightField) {
      const field = props.groundHeightField;
      if (props.groundDrawMode === 'section' && props.groundSectionLine) {
        const a = sectionAxesFromField(field, props.groundSectionLine);
        if (a) {
          const lengthM = sectionLineLengthM(props.groundSectionLine);
          const depthM = Math.max(1, props.groundSectionLine.halfWidthM);
          grounds.push({
            field,
            axes: a,
            lengthM,
            depthM,
            isSection: true,
            caption: `단면도 · 절단 ${Math.round(lengthM)} m · 깊이 ${Math.round(depthM)} m`,
            priority: 2,
          });
        }
      } else {
        const a = extentAxesFromField(field);
        grounds.push({
          field,
          axes: a,
          lengthM: a.halfLenM * 2,
          depthM: a.halfWidthM * 2,
          isSection: false,
          caption: `범위 지반 · ${Math.round(a.halfLenM * 2)} × ${Math.round(a.halfWidthM * 2)} m`,
          priority: 1,
        });
      }
    }

    if (isLineLayerShape(props.kind) && props.pipeSegments?.length) {
      for (const p of props.pipeSegments) {
        pipes.push({ ...p, layerLabel });
      }
    }
    if (isPointLayerShape(props.kind) && props.manholeFeatures?.length) {
      for (const m of props.manholeFeatures) {
        manholes.push({ ...m, layerLabel });
      }
    }
    const prim = primFromProps(props, name);
    if (prim) prims.push(prim);
  }

  grounds.sort((a, b) => b.priority - a.priority);
  const g0 = grounds[0];
  if (g0) {
    return {
      field: g0.field,
      axes: g0.axes,
      lengthM: g0.lengthM,
      depthM: g0.depthM,
      isSection: g0.isSection,
      pipes,
      manholes,
      prims,
      caption: g0.caption,
    };
  }

  if (!prims.length && !pipes.length && !manholes.length) return null;
  const axes = axesFromPrims(prims);
  return {
    field: null,
    axes,
    lengthM: axes.halfLenM * 2,
    depthM: axes.halfWidthM * 2,
    isSection: false,
    pipes,
    manholes,
    prims,
    caption: `도형 기준 · ${prims.length + pipes.length + manholes.length}건`,
  };
}

type PlotMap = {
  x0: number;
  y0: number;
  w: number;
  h: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

function makePlot(
  padL: number,
  padR: number,
  padT: number,
  padB: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number
): PlotMap {
  const w = SNAP_W - padL - padR;
  const h = SNAP_H - padT - padB;
  const dx = Math.max(1e-3, xMax - xMin);
  const dy = Math.max(1e-3, yMax - yMin);
  const s = Math.min(w / dx, h / dy);
  const usedW = dx * s;
  const usedH = dy * s;
  return {
    x0: padL + (w - usedW) / 2,
    y0: padT + (h - usedH) / 2,
    w: usedW,
    h: usedH,
    xMin,
    xMax,
    yMin,
    yMax,
  };
}

function toPx(plot: PlotMap, x: number, y: number): { px: number; py: number } {
  return {
    px: plot.x0 + ((x - plot.xMin) / (plot.xMax - plot.xMin)) * plot.w,
    py: plot.y0 + plot.h - ((y - plot.yMin) / (plot.yMax - plot.yMin)) * plot.h,
  };
}

function niceStep(span: number, target = 6): number {
  if (span <= 0) return 1;
  const raw = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  plot: PlotMap,
  title: string,
  xLabel: string,
  yLabel: string
): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SNAP_W, SNAP_H);
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(plot.x0, plot.y0, plot.w, plot.h);

  const xStep = niceStep(plot.xMax - plot.xMin);
  const yStep = niceStep(plot.yMax - plot.yMin);
  ctx.font = '18px sans-serif';

  for (let x = Math.ceil(plot.xMin / xStep) * xStep; x <= plot.xMax + 1e-6; x += xStep) {
    const { px, py } = toPx(plot, x, plot.yMin);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, plot.y0);
    ctx.lineTo(px, plot.y0 + plot.h);
    ctx.stroke();
    ctx.fillStyle = LABEL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(Math.round(x * 100) / 100), px, py + 6);
  }
  for (let y = Math.ceil(plot.yMin / yStep) * yStep; y <= plot.yMax + 1e-6; y += yStep) {
    const { px, py } = toPx(plot, plot.xMin, y);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x0, py);
    ctx.lineTo(plot.x0 + plot.w, py);
    ctx.stroke();
    ctx.fillStyle = LABEL;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(y * 100) / 100), px - 8, py);
  }

  ctx.fillStyle = TITLE;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(title, SNAP_W / 2, 24);
  ctx.fillStyle = LABEL;
  ctx.font = '16px sans-serif';
  ctx.fillText(xLabel, SNAP_W / 2, SNAP_H - 28);
  ctx.save();
  ctx.translate(28, SNAP_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function strokePoly(
  ctx: CanvasRenderingContext2D,
  plot: PlotMap,
  pts: { x: number; y: number }[],
  color: string,
  width = 2
): void {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const p0 = toPx(plot, pts[0]!.x, pts[0]!.y);
  ctx.moveTo(p0.px, p0.py);
  for (let i = 1; i < pts.length; i++) {
    const p = toPx(plot, pts[i]!.x, pts[i]!.y);
    ctx.lineTo(p.px, p.py);
  }
  ctx.stroke();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  plot: PlotMap,
  x: number,
  y: number,
  rM: number,
  color: string
): void {
  const c = toPx(plot, x, y);
  const edge = toPx(plot, x + rM, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c.px, c.py, Math.max(2, Math.abs(edge.px - c.px)), 0, Math.PI * 2);
  ctx.stroke();
}

function drawRectElev(
  ctx: CanvasRenderingContext2D,
  plot: PlotMap,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  color: string
): void {
  const a = toPx(plot, x0, y0);
  const b = toPx(plot, x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    Math.min(a.px, b.px),
    Math.min(a.py, b.py),
    Math.abs(b.px - a.px),
    Math.abs(b.py - a.py)
  );
}

function drawDimV(
  ctx: CanvasRenderingContext2D,
  plot: PlotMap,
  x: number,
  y0: number,
  y1: number,
  label: string
): void {
  const a = toPx(plot, x, y0);
  const b = toPx(plot, x, y1);
  ctx.strokeStyle = DIM;
  ctx.fillStyle = DIM;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(a.px + 10, a.py);
  ctx.lineTo(b.px + 10, b.py);
  ctx.moveTo(a.px + 4, a.py);
  ctx.lineTo(a.px + 16, a.py);
  ctx.moveTo(b.px + 4, b.py);
  ctx.lineTo(b.px + 16, b.py);
  ctx.stroke();
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, a.px + 18, (a.py + b.py) / 2);
}

const LABEL_ROW_H = 40;
const LABEL_NEAR_PX = 72;

/** 한글·영문 혼합 라벨 표시 폭(대략) */
function estimateLabelTextW(kind: string, lab: string): number {
  const wOf = (s: string) => {
    let w = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0) ?? 0;
      w += c >= 0xac00 && c <= 0xd7a3 ? 13 : c > 0x7f ? 11 : 7.5;
    }
    return w;
  };
  return Math.max(36, Math.max(wOf(kind), wOf(lab)) + 12);
}

/** 라벨 배치에 필요한 하단 패딩(px) — 행이 모자라면 플롯을 줄여 확보 */
function labelBandPadB(count: number): number {
  // 최악: 전부 한쪽에 쌓임 → count행. 밴드 높이 ≈ padB−40
  const rows = Math.max(1, count);
  return Math.min(560, Math.max(160, 56 + rows * LABEL_ROW_H));
}

type LabelPlan = {
  ax: number;
  ay: number;
  onLeft: boolean;
  row: number;
  kindLine: string;
  labelLine: string;
  color: string;
  dataX: number;
  dataY: number;
};

/** 데이터 좌표 기준으로 좌·우 행 계획 (플롯 확정 전) */
function planCadLabels(
  plot: PlotMap,
  items: CadLabelItem[]
): LabelPlan[] {
  const entries = items
    .map((it) => {
      const a = toPx(plot, it.dataX, it.dataY);
      return { ...it, ax: a.px, ay: a.py };
    })
    .sort((a, b) => a.ax - b.ax || a.ay - b.ay);

  const plans: LabelPlan[] = [];
  let leftRow = 0;
  let rightRow = 0;
  const placedSides: { ax: number; onLeft: boolean }[] = [];

  for (const e of entries) {
    const conflictsLeft = placedSides.some(
      (p) => p.onLeft && Math.abs(p.ax - e.ax) < LABEL_NEAR_PX
    );
    const onLeft = !conflictsLeft;
    const row = onLeft ? leftRow++ : rightRow++;
    placedSides.push({ ax: e.ax, onLeft });
    plans.push({
      ax: e.ax,
      ay: e.ay,
      onLeft,
      row,
      kindLine: e.kindLine || '도형',
      labelLine: e.labelLine || '—',
      color: e.color,
      dataX: e.dataX,
      dataY: e.dataY,
    });
  }
  return plans;
}

/**
 * 도형 라벨 2행(종류 / 개별라벨).
 * V6 횡단과 동일: 기본 왼쪽, 가까운 X만 오른쪽. 같은 쪽은 행을 쌓아 겹침 방지.
 */
function drawCadLabels(
  ctx: CanvasRenderingContext2D,
  plot: PlotMap,
  items: CadLabelItem[]
): void {
  if (!items.length) return;
  const plans = planCadLabels(plot, items);
  const bandTop = plot.y0 + plot.h + 12;
  const maxRow = Math.max(1, Math.floor((SNAP_H - bandTop - 24) / LABEL_ROW_H));

  type Placed = {
    ax: number;
    ay: number;
    textX: number;
    labelY: number;
    onLeft: boolean;
    kindLine: string;
    labelLine: string;
    color: string;
  };
  const placed: Placed[] = [];

  for (const e of plans) {
    const tw = estimateLabelTextW(e.kindLine, e.labelLine);
    ctx.font = 'bold 13px sans-serif';
    const measured = Math.max(
      tw,
      ctx.measureText(e.kindLine).width + 12,
      ctx.measureText(e.labelLine).width + 12
    );
    // 행이 밴드를 넘치면 반대쪽 남는 행·또는 순환 배치 (같은 쪽 동일 행은 피함)
    let row = e.row;
    let onLeft = e.onLeft;
    if (row >= maxRow) {
      onLeft = !onLeft;
      row = e.row % maxRow;
    }
    const textX = onLeft
      ? Math.max(10 + measured, Math.min(SNAP_W - 10, e.ax - 10))
      : Math.max(10, Math.min(SNAP_W - 10 - measured, e.ax + 10));

    placed.push({
      ax: e.ax,
      ay: e.ay,
      textX,
      labelY: bandTop + LABEL_ROW_H * Math.min(row, maxRow - 1),
      onLeft,
      kindLine: e.kindLine,
      labelLine: e.labelLine,
      color: e.color,
    });
  }

  // 동일 행·동일 쪽에서 텍스트 X가 겹치면 옆으로 밈
  const byKey = new Map<string, Placed[]>();
  for (const p of placed) {
    const k = `${p.onLeft ? 'L' : 'R'}:${Math.round((p.labelY - bandTop) / LABEL_ROW_H)}`;
    const arr = byKey.get(k) ?? [];
    arr.push(p);
    byKey.set(k, arr);
  }
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.ax - b.ax);
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1]!;
      const cur = arr[i]!;
      const minGap = estimateLabelTextW(prev.kindLine, prev.labelLine) * 0.6 + 18;
      if (Math.abs(cur.textX - prev.textX) >= minGap) continue;
      if (cur.onLeft) {
        cur.textX = Math.max(10, prev.textX - minGap);
      } else {
        cur.textX = Math.min(SNAP_W - 10, prev.textX + minGap);
      }
    }
  }

  for (const p of placed) {
    const elbowX = p.onLeft ? p.ax - 6 : p.ax + 6;
    const midY = p.labelY + 8;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.ax, p.ay);
    ctx.lineTo(p.ax, Math.min(p.ay + 12, bandTop - 2));
    ctx.lineTo(p.ax, bandTop - 2);
    ctx.lineTo(elbowX, midY);
    ctx.lineTo(p.textX, midY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p.ax, p.ay);
    ctx.lineTo(p.ax - 3, p.ay + 6);
    ctx.lineTo(p.ax + 3, p.ay + 6);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();

    ctx.fillStyle = p.color;
    ctx.textAlign = p.onLeft ? 'end' : 'start';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(p.kindLine, p.textX, p.labelY);
    ctx.font = '12px sans-serif';
    ctx.fillText(p.labelLine, p.textX, p.labelY + 16);
  }
}

function sampleAlong(
  field: GroundHeightField | null,
  midX: number,
  midZ: number,
  dirX: number,
  dirZ: number,
  halfM: number,
  stepHint: number
): { x: number; y: number }[] {
  const length = halfM * 2;
  const samples = Math.max(24, Math.min(200, Math.ceil(length / Math.max(0.4, stepHint))));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const station = t * length;
    const s = station - halfM;
    const lx = midX + dirX * s;
    const lz = midZ + dirZ * s;
    out.push({ x: station, y: elevAtLocal(field, lx, lz) });
  }
  return out;
}

/**
 * 횡단면도 — V6과 동일 개념:
 * 절단선(또는 중점 남북)을 가로축, 교차 관·맨홀은 원단면.
 */
function drawCrossSection(cad: CadCtx): string {
  const { field, axes, lengthM, depthM, isSection, pipes, manholes, prims, caption } = cad;
  const step = field?.stepM ?? 1;

  type Hit = {
    x: number;
    elev: number;
    surf: number;
    /** 지표→관중심 심도(m). 관만 */
    depth?: number;
    r: number;
    kindLine: string;
    labelLine: string;
    color: string;
    kind: 'pipe' | 'manh' | 'prim';
    y0?: number;
    y1?: number;
    half?: number;
    primKind?: PrimFeat['kind'];
  };
  const hits: Hit[] = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  let ground: { x: number; y: number }[] = [];
  let xMin = 0;
  let xMax = 1;
  let xLabel = '거리 (m)';

  if (isSection) {
    xMin = 0;
    xMax = Math.max(1, lengthM);
    xLabel = '절단 거리 (m)';
    ground = sampleAlong(
      field,
      axes.midX,
      axes.midZ,
      axes.alongX,
      axes.alongZ,
      axes.halfLenM,
      step / 2
    );
    for (const g of ground) {
      yMin = Math.min(yMin, g.y);
      yMax = Math.max(yMax, g.y);
    }
    if (field) {
      for (const pipe of pipes) {
        const hit = intersectPipeCutPlane(pipe, field, axes);
        if (!hit) continue;
        yMin = Math.min(yMin, hit.elev - hit.r);
        yMax = Math.max(yMax, hit.surf);
        hits.push({
          x: hit.station,
          elev: hit.elev,
          surf: hit.surf,
          depth: Math.max(0.05, hit.surf - hit.elev),
          r: hit.r,
          kindLine: pipe.layerLabel,
          labelLine: hit.label || '—',
          color: hit.color,
          kind: 'pipe',
        });
      }
      for (const m of manholes) {
        const loc = toLocal(m.x3857, m.y3857, field);
        const { u, v } = uvOf(loc.x, loc.z, axes);
        if (Math.abs(u) > axes.halfLenM + 0.8) continue;
        if (v < -0.8 || v > axes.halfWidthM + 0.8) continue;
        if (Math.abs(v) > Math.max(1.2, axes.halfWidthM * 0.35) && Math.abs(v) > 1.5) {
          continue;
        }
        const surf =
          m.surfaceElevM != null && Number.isFinite(m.surfaceElevM)
            ? elevToSceneY(m.surfaceElevM)
            : elevAtLocal(field, loc.x, loc.z);
        const h = Math.max(0.05, m.depthM);
        const elev = surf + h / 2;
        const r = Math.max(0.05, m.diameterM / 2);
        yMin = Math.min(yMin, surf);
        yMax = Math.max(yMax, surf + h);
        hits.push({
          x: u + axes.halfLenM,
          elev,
          surf,
          r,
          kindLine: m.layerLabel,
          labelLine: m.label?.trim() || '—',
          color: m.color || MANH_STROKE,
          kind: 'manh',
          y0: surf,
          y1: surf + h,
          half: r,
        });
      }
    }
    for (const p of prims) {
      const { u, v } = uvOf(p.lx, p.lz, axes);
      if (Math.abs(u) > axes.halfLenM + 0.8) continue;
      if (Math.abs(v) > 1.2) continue;
      yMin = Math.min(yMin, p.y0);
      yMax = Math.max(yMax, p.y1);
      hits.push({
        x: u + axes.halfLenM,
        elev: (p.y0 + p.y1) / 2,
        surf: p.y1,
        r: Math.max(0.05, (p.y1 - p.y0) / 2),
        kindLine: p.kindLabel,
        labelLine: p.name || '—',
        color: p.color,
        kind: 'prim',
        y0: p.y0,
        y1: p.y1,
        half: Math.max(0.05, p.halfW),
        primKind: p.kind,
      });
    }
  } else {
    xMin = -depthM / 2;
    xMax = depthM / 2;
    xLabel = '이격 (m)';
    ground = sampleAlong(
      field,
      axes.midX,
      axes.midZ,
      axes.perpX,
      axes.perpZ,
      axes.halfWidthM,
      step / 2
    ).map((g) => ({ x: g.x - axes.halfWidthM, y: g.y }));
    for (const g of ground) {
      yMin = Math.min(yMin, g.y);
      yMax = Math.max(yMax, g.y);
    }
    if (field) {
      for (const pipe of pipes) {
        const hit = intersectPipeMidU(pipe, field, axes);
        if (!hit) continue;
        yMin = Math.min(yMin, hit.elev - hit.r);
        yMax = Math.max(yMax, hit.surf);
        hits.push({
          x: hit.offset,
          elev: hit.elev,
          surf: hit.surf,
          depth: Math.max(0.05, hit.surf - hit.elev),
          r: hit.r,
          kindLine: pipe.layerLabel,
          labelLine: hit.label || '—',
          color: hit.color,
          kind: 'pipe',
        });
      }
      for (const m of manholes) {
        const loc = toLocal(m.x3857, m.y3857, field);
        const { u, v } = uvOf(loc.x, loc.z, axes);
        if (Math.abs(u) > 1.2) continue;
        if (Math.abs(v) > axes.halfWidthM + 0.8) continue;
        const surf =
          m.surfaceElevM != null && Number.isFinite(m.surfaceElevM)
            ? elevToSceneY(m.surfaceElevM)
            : elevAtLocal(field, loc.x, loc.z);
        const h = Math.max(0.05, m.depthM);
        const elev = surf + h / 2;
        const r = Math.max(0.05, m.diameterM / 2);
        yMin = Math.min(yMin, surf);
        yMax = Math.max(yMax, surf + h);
        hits.push({
          x: v,
          elev,
          surf,
          r,
          kindLine: m.layerLabel,
          labelLine: m.label?.trim() || '—',
          color: m.color || MANH_STROKE,
          kind: 'manh',
          y0: surf,
          y1: surf + h,
        });
      }
    }
    for (const p of prims) {
      const { u, v } = uvOf(p.lx, p.lz, axes);
      if (Math.abs(u) > 1.2) continue;
      yMin = Math.min(yMin, p.y0);
      yMax = Math.max(yMax, p.y1);
      hits.push({
        x: v,
        elev: (p.y0 + p.y1) / 2,
        surf: p.y1,
        r: Math.max(0.05, (p.y1 - p.y0) / 2),
        kindLine: p.kindLabel,
        labelLine: p.name || '—',
        color: p.color,
        kind: 'prim',
        y0: p.y0,
        y1: p.y1,
        half: Math.max(0.05, p.halfD),
        primKind: p.kind,
      });
    }
  }

  // 관로: 그린 지표면 보간 − 심도 (표고선보다 위로 뜨는 현상 방지)
  yMin = Infinity;
  yMax = -Infinity;
  for (const g of ground) {
    yMin = Math.min(yMin, g.y);
    yMax = Math.max(yMax, g.y);
  }
  for (const h of hits) {
    if (h.kind === 'pipe') {
      const depth = h.depth ?? Math.max(0.05, h.surf - h.elev);
      const anchored = pipeElevOnGround(ground, h.x, depth, h.surf);
      h.surf = anchored.surf;
      h.elev = anchored.elev;
      h.depth = depth;
      yMin = Math.min(yMin, h.elev - h.r);
      yMax = Math.max(yMax, h.surf);
    } else if (h.kind === 'manh' && h.y0 != null && h.y1 != null) {
      yMin = Math.min(yMin, h.y0);
      yMax = Math.max(yMax, h.y1);
    } else if (h.y0 != null && h.y1 != null) {
      yMin = Math.min(yMin, h.y0);
      yMax = Math.max(yMax, h.y1);
    } else {
      yMin = Math.min(yMin, h.elev - h.r);
      yMax = Math.max(yMax, h.elev + h.r);
    }
  }

  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 10;
  }
  const padY = Math.max(1, (yMax - yMin) * 0.15);
  const padB = labelBandPadB(hits.length);
  const plot = makePlot(72, 40, 64, padB, xMin, xMax, yMin - padY, yMax + padY);
  const canvas = document.createElement('canvas');
  canvas.width = SNAP_W;
  canvas.height = SNAP_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return EMPTY_SECTION;

  drawFrame(ctx, plot, '횡단면도', xLabel, '표고 (m)');
  strokePoly(ctx, plot, ground, GROUND_STROKE, 2.5);

  const labelItems: CadLabelItem[] = [];
  for (const h of hits) {
    if (h.kind === 'prim' && h.primKind === 'box' && h.y0 != null && h.y1 != null && h.half != null) {
      drawRectElev(ctx, plot, h.x - h.half, h.x + h.half, h.y0, h.y1, h.color);
    } else if (h.kind === 'manh' && h.y0 != null && h.y1 != null) {
      drawRectElev(ctx, plot, h.x - h.r, h.x + h.r, h.y0, h.y1, h.color);
      drawCircle(ctx, plot, h.x, h.elev, h.r, h.color);
    } else {
      drawCircle(ctx, plot, h.x, h.elev, h.r, h.color);
    }
    if (h.kind === 'pipe' || h.kind === 'manh') {
      drawDimV(
        ctx,
        plot,
        h.x,
        h.surf,
        h.elev + h.r,
        `토피 ${Math.round(Math.max(0, h.surf - (h.elev + h.r)) * 100) / 100}`
      );
    }
    labelItems.push({
      dataX: h.x,
      dataY: h.kind === 'prim' && h.y1 != null ? h.y1 : h.elev + h.r,
      kindLine: h.kindLine,
      labelLine: h.labelLine,
      color: h.color,
    });
  }
  drawCadLabels(ctx, plot, labelItems);

  ctx.fillStyle = LABEL;
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${caption} · 관 ${hits.filter((h) => h.kind === 'pipe').length}개`, 72, 56);
  return canvas.toDataURL('image/png');
}

/**
 * 종단면도 — 관로 진행 방향(단면도면 관 평균·없으면 깊이축) 프로필.
 * 관은 띠 안으로 클립한 뒤 외경 상·하선.
 */
function drawLongSection(cad: CadCtx): string {
  const { field, axes, lengthM, isSection, pipes, manholes, prims, caption } = cad;
  const step = field?.stepM ?? 1;

  let dirX = axes.alongX;
  let dirZ = axes.alongZ;
  let half = axes.halfLenM;
  let xLabel = '거리 (m)';

  if (isSection && field) {
    const d = estimateLongDir(pipes, field, axes);
    dirX = d.x;
    dirZ = d.z;
    // 종단 길이: 클립된 관 투영 span, 최소 절단 깊이·길이의 큰 쪽
    let minS = 0;
    let maxS = 0;
    let any = false;
    for (const pipe of pipes) {
      for (const run of clipPipeRuns(pipe, field, axes)) {
        for (const p of run) {
          const s = (p.x - axes.midX) * dirX + (p.z - axes.midZ) * dirZ;
          if (!any) {
            minS = maxS = s;
            any = true;
          } else {
            minS = Math.min(minS, s);
            maxS = Math.max(maxS, s);
          }
        }
      }
    }
    const span = any ? Math.max(2, maxS - minS) : Math.max(axes.halfWidthM * 2, axes.halfLenM * 2);
    half = span / 2;
    xLabel = '관로 거리 (m)';
  } else {
    half = axes.halfLenM;
    xLabel = '동서 거리 (m)';
  }

  const length = Math.max(1, half * 2);
  const ground = sampleAlong(field, axes.midX, axes.midZ, dirX, dirZ, half, step / 2);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const g of ground) {
    yMin = Math.min(yMin, g.y);
    yMax = Math.max(yMax, g.y);
  }

  type Tube = {
    pts: { x: number; y: number }[];
    r: number;
    surfAt: number;
    kindLine: string;
    labelLine: string;
    color: string;
    isPipe: boolean;
  };
  const tubes: Tube[] = [];

  if (field) {
    for (const pipe of pipes) {
      const runs = isSection
        ? clipPipeRuns(pipe, field, axes)
        : [pipeLocalPts(pipe, field)].filter((r) => r.length >= 2);
      for (const run of runs) {
        if (run.length < 2) continue;
        // 종단 표고선(중심축) 보간 − 꼭짓점 심도 (관 위치 지표와 표고선 불일치 방지)
        const pts = run.map((p) => {
          const s = (p.x - axes.midX) * dirX + (p.z - axes.midZ) * dirZ;
          const x = s + half;
          const anchored = pipeElevOnGround(ground, x, p.depth, p.surf);
          return { x, y: anchored.elev };
        });
        pts.sort((a, b) => a.x - b.x);
        const mid = pts[Math.floor(pts.length / 2)]!;
        const midSurf = groundElevAtPoly(ground, mid.x) ?? run[Math.floor(run.length / 2)]!.surf;
        const r = Math.max(0.04, pipe.diameterM / 2);
        yMin = Math.min(yMin, ...pts.map((p) => p.y - r));
        yMax = Math.max(yMax, midSurf);
        tubes.push({
          pts,
          r,
          surfAt: midSurf,
          kindLine: pipe.layerLabel,
          labelLine: pipe.label?.trim() || '—',
          color: pipe.color || PIPE_STROKE,
          isPipe: true,
        });
      }
    }
    for (const m of manholes) {
      const loc = toLocal(m.x3857, m.y3857, field);
      if (isSection) {
        const { u, v } = uvOf(loc.x, loc.z, axes);
        if (Math.abs(u) > axes.halfLenM + 0.8) continue;
        if (v < -0.8 || v > axes.halfWidthM + 0.8) continue;
      }
      const s = (loc.x - axes.midX) * dirX + (loc.z - axes.midZ) * dirZ;
      const surf =
        m.surfaceElevM != null && Number.isFinite(m.surfaceElevM)
          ? elevToSceneY(m.surfaceElevM)
          : elevAtLocal(field, loc.x, loc.z);
      const h = Math.max(0.05, m.depthM);
      const elev = surf + h / 2;
      const r = Math.max(0.05, m.diameterM / 2);
      yMin = Math.min(yMin, surf);
      yMax = Math.max(yMax, surf + h);
      tubes.push({
        pts: [{ x: s + half, y: elev }],
        r,
        surfAt: surf + h,
        kindLine: m.layerLabel,
        labelLine: m.label?.trim() || '—',
        color: m.color || MANH_STROKE,
        isPipe: false,
      });
    }
  }

  for (const p of prims) {
    const s = (p.lx - axes.midX) * dirX + (p.lz - axes.midZ) * dirZ;
    if (Math.abs(s) > half + Math.max(p.halfW, p.halfD) + 0.5) continue;
    yMin = Math.min(yMin, p.y0);
    yMax = Math.max(yMax, p.y1);
    tubes.push({
      pts: [
        { x: s + half - p.halfW, y: (p.y0 + p.y1) / 2 },
        { x: s + half + p.halfW, y: (p.y0 + p.y1) / 2 },
      ],
      r: Math.max(0.05, (p.y1 - p.y0) / 2),
      surfAt: p.y1,
      kindLine: p.kindLabel,
      labelLine: p.name || '—',
      color: p.color,
      isPipe: false,
    });
  }

  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 10;
  }
  const padY = Math.max(1, (yMax - yMin) * 0.12);
  const padB = labelBandPadB(tubes.length);
  const plot = makePlot(72, 40, 64, padB, 0, length, yMin - padY, yMax + padY);
  const canvas = document.createElement('canvas');
  canvas.width = SNAP_W;
  canvas.height = SNAP_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return EMPTY_SECTION;

  drawFrame(ctx, plot, '종단면도', xLabel, '표고 (m)');
  strokePoly(ctx, plot, ground, GROUND_STROKE, 2.5);

  const labelItems: CadLabelItem[] = [];
  for (const t of tubes) {
    if (t.pts.length >= 2) {
      strokePoly(
        ctx,
        plot,
        t.pts.map((p) => ({ x: p.x, y: p.y + t.r })),
        t.color,
        2
      );
      strokePoly(
        ctx,
        plot,
        t.pts.map((p) => ({ x: p.x, y: p.y - t.r })),
        t.color,
        2
      );
      ctx.setLineDash([4, 4]);
      strokePoly(ctx, plot, t.pts, t.color, 1);
      ctx.setLineDash([]);
    } else if (t.pts.length === 1) {
      drawCircle(ctx, plot, t.pts[0]!.x, t.pts[0]!.y, t.r, t.color);
    }
    const mid = t.pts[Math.floor(t.pts.length / 2)];
    if (mid) {
      drawDimV(
        ctx,
        plot,
        mid.x,
        t.surfAt,
        mid.y + t.r,
        `토피 ${Math.round(Math.max(0, t.surfAt - (mid.y + t.r)) * 100) / 100}`
      );
      labelItems.push({
        dataX: mid.x,
        dataY: mid.y + t.r,
        kindLine: t.kindLine,
        labelLine: t.labelLine,
        color: t.color,
      });
    }
  }
  drawCadLabels(ctx, plot, labelItems);

  ctx.fillStyle = LABEL;
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(
    `${caption} · 종단 ${Math.round(lengthM)}/${Math.round(length)} m · 관 ${tubes.length}구간`,
    72,
    56
  );
  return canvas.toDataURL('image/png');
}

/** CAD 종·횡단 PNG. cross=횡단(절단 원단면), long=종단(관로 프로필) */
export function captureSectionCadViews(shapesRoot: THREE.Object3D): {
  cross: string;
  long: string;
} {
  const cad = collectCadContext(shapesRoot);
  if (!cad) {
    return { cross: EMPTY_SECTION, long: EMPTY_SECTION };
  }
  return {
    cross: drawCrossSection(cad),
    long: drawLongSection(cad),
  };
}
