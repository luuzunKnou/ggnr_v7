import DxfParser from "dxf-parser";
import type { IDxf, IEntity, IInsertEntity } from "dxf-parser";
import type { ITextEntity } from "dxf-parser/dist/entities/text";
import type { IMtextEntity } from "dxf-parser/dist/entities/mtext";
import type { ILineEntity } from "dxf-parser/dist/entities/line";
import type { ICircleEntity } from "dxf-parser/dist/entities/circle";
import type { IArcEntity } from "dxf-parser/dist/entities/arc";
import type { ILwpolylineEntity } from "dxf-parser/dist/entities/lwpolyline";
import type { IPolylineEntity } from "dxf-parser/dist/entities/polyline";
import type { IPointEntity } from "dxf-parser/dist/entities/point";
import type { ISolidEntity } from "dxf-parser/dist/entities/solid";
import type { ISplineEntity } from "dxf-parser/dist/entities/spline";
import type { IEllipseEntity } from "dxf-parser/dist/entities/ellipse";
import Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import { LineString, Point, Polygon } from "ol/geom";
import type { Extent } from "ol/extent";
import { resolveEntityStyle } from "@/lib/dxfColors";

/** OpenLayers 스타일용 — DXF ACI·레이어 색 */
export const DXF_STROKE = "dxfStroke";
export const DXF_FILL = "dxfFill";
export const DXF_STROKE_WIDTH = "dxfStrokeWidth";
export const DXF_LABEL = "dxfLabel";
export const DXF_TEXT_HEIGHT = "dxfTextHeight";
export const DXF_ROTATION = "dxfRotation";
export const DXF_TEXT_ALIGN = "dxfTextAlign";
export const DXF_TEXT_BASELINE = "dxfTextBaseline";

function applyDxfSymbology(f: Feature<Geometry>, ent: IEntity, dxf: IDxf | null) {
  const { strokeCss, fillRgba, strokeWidth } = resolveEntityStyle(ent, dxf);
  f.setProperties({
    [DXF_STROKE]: strokeCss,
    [DXF_FILL]: fillRgba,
    [DXF_STROKE_WIDTH]: strokeWidth,
  });
}

/** MTEXT 제어코드 제거(본문·줄바꿈 유지) */
export function cleanMtext(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/\r\n/g, "\n");
  s = s.replace(/\\P/gi, "\n");
  s = s.replace(/\\[^{};P\n\r\t\\]+(;|(?=[\s\n{]))/gi, " ");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

function textStyleFromDxfText(e: ITextEntity): {
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
} {
  const h = e.halign ?? 0;
  const v = e.valign ?? 0;
  const baselineFromValign = (): CanvasTextBaseline =>
    v === 1 ? "bottom" : v === 2 ? "middle" : v === 3 ? "top" : "alphabetic";
  if (h === 4) {
    return { align: "center", baseline: baselineFromValign() };
  }
  const align: CanvasTextAlign = h === 1 ? "center" : h === 2 ? "right" : "left";
  return { align, baseline: baselineFromValign() };
}

function mtextAttachment(ap: number | undefined): {
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
} {
  const a = Math.min(9, Math.max(1, ap ?? 1));
  const col = (a - 1) % 3;
  const row = Math.floor((a - 1) / 3);
  const align: CanvasTextAlign = col === 0 ? "left" : col === 1 ? "center" : "right";
  const baseline: CanvasTextBaseline = row === 0 ? "top" : row === 1 ? "middle" : "bottom";
  return { align, baseline };
}

function textEntityToFeature(e: ITextEntity, aff: Aff2D, dxf: IDxf | null): Feature<Geometry> | null {
  const sp = e.startPoint;
  if (!sp) return null;
  const txt = String(e.text ?? "").trim();
  if (!txt) return null;
  const ha = e.halign ?? 0;
  const ep = e.endPoint;
  const affScale = Math.hypot(aff.xx, aff.yx);
  const height = Math.max((e.textHeight ?? 2.5) * affScale, 1e-6);
  const affRot = Math.atan2(aff.yx, aff.xx);

  let p: [number, number];
  let rot: number;
  let align: CanvasTextAlign;
  let baseline: CanvasTextBaseline;

  if ((ha === 3 || ha === 5) && ep) {
    const p0 = applyAff(aff, sp.x, sp.y);
    const p1 = applyAff(aff, ep.x, ep.y);
    p = p0;
    const lineAng = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    rot = -lineAng;
    align = "left";
    baseline = "alphabetic";
  } else {
    p = applyAff(aff, sp.x, sp.y);
    const cadDeg = e.rotation ?? 0;
    rot = (-cadDeg * Math.PI) / 180 + affRot;
    const ts = textStyleFromDxfText(e);
    align = ts.align;
    baseline = ts.baseline;
  }

  const f = new Feature(new Point(p));
  f.setProperties({
    [DXF_LABEL]: txt,
    [DXF_TEXT_HEIGHT]: height,
    [DXF_ROTATION]: rot,
    [DXF_TEXT_ALIGN]: align,
    [DXF_TEXT_BASELINE]: baseline,
  });
  applyDxfSymbology(f, e, dxf);
  return f;
}

function mtextEntityToFeature(e: IMtextEntity, aff: Aff2D, dxf: IDxf | null): Feature<Geometry> | null {
  const pos = e.position;
  if (!pos) return null;
  const raw = String(e.text ?? "");
  const txt = cleanMtext(raw);
  if (!txt.trim()) return null;
  const p = applyAff(aff, pos.x, pos.y);
  const affScale = Math.hypot(aff.xx, aff.yx);
  const height = Math.max((e.height ?? 2.5) * affScale, 1e-6);
  const affRot = Math.atan2(aff.yx, aff.xx);
  const dir = e.directionVector;
  let rot: number;
  if (dir && (Math.abs(dir.x) > 1e-12 || Math.abs(dir.y) > 1e-12)) {
    const [dx, dy] = [aff.xx * dir.x + aff.xy * dir.y, aff.yx * dir.x + aff.yy * dir.y];
    rot = -Math.atan2(dy, dx);
  } else {
    rot = (-(e.rotation ?? 0) * Math.PI) / 180 + affRot;
  }
  const { align, baseline } = mtextAttachment(e.attachmentPoint);
  const f = new Feature(new Point(p));
  f.setProperties({
    [DXF_LABEL]: txt,
    [DXF_TEXT_HEIGHT]: height,
    [DXF_ROTATION]: rot,
    [DXF_TEXT_ALIGN]: align,
    [DXF_TEXT_BASELINE]: baseline,
  });
  applyDxfSymbology(f, e, dxf);
  return f;
}

/** 2D affine: (x,y) → scale·rotate then translate (블록 INSERT 체인) */
export type Aff2D = { xx: number; xy: number; yx: number; yy: number; ox: number; oy: number };

export const AFF_IDENTITY: Aff2D = { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };

export function multiplyAff(a: Aff2D, b: Aff2D): Aff2D {
  return {
    xx: a.xx * b.xx + a.xy * b.yx,
    xy: a.xx * b.xy + a.xy * b.yy,
    yx: a.yx * b.xx + a.yy * b.yx,
    yy: a.yx * b.xy + a.yy * b.yy,
    ox: a.xx * b.ox + a.xy * b.oy + a.ox,
    oy: a.yx * b.ox + a.yy * b.oy + a.oy,
  };
}

export function applyAff(m: Aff2D, x: number, y: number): [number, number] {
  return [m.xx * x + m.xy * y + m.ox, m.yx * x + m.yy * y + m.oy];
}

export function affFromInsert(insert: IInsertEntity): Aff2D {
  const rz = ((insert.rotation ?? 0) * Math.PI) / 180;
  const sx = insert.xScale ?? 1;
  const sy = insert.yScale ?? 1;
  const c = Math.cos(rz);
  const s = Math.sin(rz);
  return {
    xx: sx * c,
    xy: -sy * s,
    yx: sx * s,
    yy: sy * c,
    ox: insert.position?.x ?? 0,
    oy: insert.position?.y ?? 0,
  };
}

function arcToCoords(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  segments: number
): [number, number][] {
  let s = a0;
  let e = a1;
  while (e < s) e += 2 * Math.PI;
  while (e - s > 2 * Math.PI - 1e-9) e -= 2 * Math.PI;
  const sweep = e - s;
  const n = Math.max(8, Math.min(segments, Math.ceil((Math.abs(sweep) * r) / 5)));
  const coords: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = s + (sweep * i) / n;
    coords.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return coords;
}

/** LWPOLYLINE 세그먼트 bulge → 호 위 점들 (AutoCAD bulge = tan(φ/4)) */
function bulgeSegmentPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bulge: number,
  segments = 20
): [number, number][] {
  if (Math.abs(bulge) < 1e-14) return [[x2, y2]];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(x2 - x1, y2 - y1);
  if (chord < 1e-14) return [[x2, y2]];
  const r = Math.abs(chord / (2 * Math.sin(Math.abs(theta) / 2)));
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = -(y2 - y1) / chord;
  const ny = (x2 - x1) / chord;
  const sgn = bulge >= 0 ? 1 : -1;
  const h = r * Math.cos(theta / 2);
  const cx = mx + sgn * h * nx;
  const cy = my + sgn * h * ny;
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let a2 = Math.atan2(y2 - cy, x2 - cx);
  if (bulge > 0) {
    if (a2 < a1) a2 += 2 * Math.PI;
  } else {
    if (a2 > a1) a2 -= 2 * Math.PI;
  }
  const out: [number, number][] = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const a = a1 + (a2 - a1) * t;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function ellipseSamplePoints(e: IEllipseEntity, aff: Aff2D, steps = 48): [number, number][] {
  const c = e.center;
  const maj = e.majorAxisEndPoint;
  if (!c || !maj) return [];
  const ax = maj.x;
  const ay = maj.y;
  const aLen = Math.hypot(ax, ay);
  if (aLen < 1e-12) return [];
  const bLen = aLen * (e.axisRatio ?? 1);
  const ux = ax / aLen;
  const uy = ay / aLen;
  const vx = -uy;
  const vy = ux;
  let t0 = e.startAngle ?? 0;
  let t1 = e.endAngle ?? 2 * Math.PI;
  if (t1 < t0) t1 += 2 * Math.PI;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const lx = aLen * Math.cos(t);
    const ly = bLen * Math.sin(t);
    const wx = c.x + lx * ux + ly * vx;
    const wy = c.y + lx * uy + ly * vy;
    coords.push(applyAff(aff, wx, wy));
  }
  return coords;
}

function addGeom(features: Feature<Geometry>[], geom: Geometry | null) {
  if (!geom) return;
  features.push(new Feature(geom));
}

function entityToGeometry(ent: IEntity, aff: Aff2D): Geometry | null {
  const t = ent.type;
  if (t === "LINE") {
    const e = ent as ILineEntity;
    const v = e.vertices;
    if (!v || v.length < 2) return null;
    const p0 = applyAff(aff, v[0].x, v[0].y);
    const p1 = applyAff(aff, v[1].x, v[1].y);
    return new LineString([p0, p1]);
  }
  if (t === "CIRCLE") {
    const e = ent as ICircleEntity;
    const c = e.center;
    if (!c || !(e.radius > 0)) return null;
    const cc = applyAff(aff, c.x, c.y);
    const r0 = e.radius;
    const scale = Math.hypot(aff.xx, aff.yx);
    const r = r0 * scale;
    const ring = arcToCoords(cc[0], cc[1], r, 0, 2 * Math.PI, 64);
    return new Polygon([ring]);
  }
  if (t === "ARC") {
    const e = ent as IArcEntity;
    const c = e.center;
    if (!c || !(e.radius > 0)) return null;
    const cc = applyAff(aff, c.x, c.y);
    const r0 = e.radius;
    const scale = Math.hypot(aff.xx, aff.yx);
    const r = r0 * scale;
    const a0 = e.startAngle;
    const a1 = e.endAngle;
    const coords = arcToCoords(cc[0], cc[1], r, a0, a1, 48);
    return new LineString(coords);
  }
  if (t === "LWPOLYLINE") {
    const e = ent as ILwpolylineEntity;
    const verts = e.vertices;
    if (!verts?.length) return null;
    const n = verts.length;
    const closed = e.shape && n > 2;
    const coords: [number, number][] = [applyAff(aff, verts[0].x, verts[0].y)];
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const v0 = verts[i];
      const v1 = verts[(i + 1) % n];
      const p0 = applyAff(aff, v0.x, v0.y);
      const p1 = applyAff(aff, v1.x, v1.y);
      const bulge = v0.bulge ?? 0;
      if (Math.abs(bulge) < 1e-14) {
        coords.push(p1);
      } else {
        const arcPts = bulgeSegmentPoints(p0[0], p0[1], p1[0], p1[1], bulge);
        for (const q of arcPts) coords.push(q);
      }
    }
    if (coords.length < 2) return null;
    if (closed && coords.length > 2) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) {
        coords.push([first[0], first[1]]);
      }
      return new Polygon([coords]);
    }
    return new LineString(coords);
  }
  if (t === "POLYLINE") {
    const e = ent as IPolylineEntity;
    const verts = e.vertices;
    if (!verts?.length) return null;
    const coords: [number, number][] = verts.map((v) => applyAff(aff, v.x, v.y));
    if (e.shape && coords.length > 2) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) coords.push([first[0], first[1]]);
      return new Polygon([coords]);
    }
    return new LineString(coords);
  }
  if (t === "POINT") {
    const e = ent as IPointEntity;
    const p = e.position;
    if (!p) return null;
    const q = applyAff(aff, p.x, p.y);
    return new Point(q);
  }
  if (t === "SOLID") {
    const e = ent as ISolidEntity;
    const pts = e.points;
    if (!pts || pts.length < 3) return null;
    const ring = pts.slice(0, 4).map((p) => applyAff(aff, p.x, p.y));
    if (ring.length === 3) {
      ring.push([ring[2][0], ring[2][1]]);
    }
    return new Polygon([ring]);
  }
  if (t === "SPLINE") {
    const e = ent as ISplineEntity;
    const fp = e.fitPoints ?? e.controlPoints;
    if (!fp?.length) return null;
    const coords = fp.map((p) => applyAff(aff, p.x, p.y));
    return new LineString(coords);
  }
  if (t === "ELLIPSE") {
    const e = ent as IEllipseEntity;
    const coords = ellipseSamplePoints(e, aff);
    if (coords.length < 2) return null;
    return new LineString(coords);
  }
  return null;
}

function findBlock(dxf: IDxf, rawName: string) {
  const name = rawName.trim();
  if (!name) return undefined;
  const blocks = dxf.blocks;
  if (!blocks) return undefined;
  if (blocks[name]) return blocks[name];
  const up = name.toUpperCase();
  for (const k of Object.keys(blocks)) {
    if (k.toUpperCase() === up) return blocks[k];
  }
  return undefined;
}

function walkEntities(
  entities: IEntity[],
  dxf: IDxf,
  aff: Aff2D,
  depth: number,
  out: Feature<Geometry>[]
) {
  for (const ent of entities) {
    if (ent.type === "INSERT") {
      const ins = ent as IInsertEntity;
      const name = ins.name?.trim();
      if (!name) continue;
      const block = findBlock(dxf, name);
      const childAff = multiplyAff(aff, affFromInsert(ins));
      if (block?.entities?.length) {
        walkEntities(block.entities, dxf, childAff, depth + 1, out);
      }
      continue;
    }
    if (ent.type === "TEXT") {
      const tf = textEntityToFeature(ent as ITextEntity, aff, dxf);
      if (tf) out.push(tf);
      continue;
    }
    if (ent.type === "MTEXT") {
      const mf = mtextEntityToFeature(ent as IMtextEntity, aff, dxf);
      if (mf) out.push(mf);
      continue;
    }
    const g = entityToGeometry(ent, aff);
    if (g) {
      const f = new Feature(g);
      applyDxfSymbology(f, ent, dxf);
      out.push(f);
    }
  }
}

export type DxfToOlResult = {
  features: Feature<Geometry>[];
  extent: Extent | null;
  parseError: string | null;
};

/**
 * DXF 문자열(ASCII 권장) → OpenLayers Feature 목록.
 * 좌표는 도면 단위 그대로이며, 뷰의 projection과 일치시켜야 합니다.
 */
export function dxfStringToOlFeatures(source: string): DxfToOlResult {
  const parser = new DxfParser();
  let dxf: IDxf | null;
  try {
    dxf = parser.parseSync(source);
  } catch (e) {
    return {
      features: [],
      extent: null,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
  if (!dxf) {
    return { features: [], extent: null, parseError: "DXF 파싱 결과가 비어 있습니다." };
  }

  const features: Feature<Geometry>[] = [];
  walkEntities(dxf.entities ?? [], dxf, AFF_IDENTITY, 0, features);

  let extent: Extent | null = null;
  for (const f of features) {
    const g = f.getGeometry();
    if (!g) continue;
    const e = g.getExtent();
    if (!extent) extent = e.slice() as Extent;
    else {
      extent[0] = Math.min(extent[0], e[0]);
      extent[1] = Math.min(extent[1], e[1]);
      extent[2] = Math.max(extent[2], e[2]);
      extent[3] = Math.max(extent[3], e[3]);
    }
  }

  if (extent && (!Number.isFinite(extent[0]) || extent[2] <= extent[0] || extent[3] <= extent[1])) {
    extent = null;
  }

  return {
    features,
    extent,
    parseError: features.length === 0 ? "표시할 도형이 없습니다. (ASCII DXF·지원 엔티티 확인)" : null,
  };
}

export function padExtent(extent: Extent, ratio = 0.08): Extent {
  const w = extent[2] - extent[0];
  const h = extent[3] - extent[1];
  const dx = Math.max(w * ratio, 1e-6);
  const dy = Math.max(h * ratio, 1e-6);
  return [extent[0] - dx, extent[1] - dy, extent[2] + dx, extent[3] + dy];
}
