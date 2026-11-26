/**
 * 수치지형도 DXF → 범위 PNG (GeoServer 없이 서버 래스터)
 * LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / TEXT·MTEXT 위주.
 */
import fs from 'node:fs/promises';
import DxfParser, { type IDxf, type IEntity, type ILayer } from 'dxf-parser';
import { getAcadColor } from 'dxf-parser/dist/ParseHelpers.js';
import { decodeDxfBytes } from '@/lib/dxfTextEncoding';
import { cleanMtext } from '@/lib/dxfToOpenLayers';
import {
  collectDigitalMapFilesIntersectingBbox5181,
  type DigitalMapExportFile,
} from '@/service/digitalMapService';

const CRS_FALLBACK = '5186';
const DEFAULT_WIDTH = 2048;
const MAX_HEIGHT = 4096;
/** 도엽당 그릴 엔티티 상한 — 대용량 DXF 시간·메모리 보호 */
const MAX_ENTITIES_PER_SHEET = 80_000;

type Pt = [number, number];

type Proj4Like = {
  defs: (code: string, def?: string) => unknown;
  (from: string, to: string, coord: number[]): number[];
};

function ensureProjDefs(proj4: Proj4Like): void {
  proj4.defs(
    'EPSG:5181',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5186',
    '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5187',
    '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
  );
  proj4.defs(
    'EPSG:5179',
    '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs'
  );
}

function folderFromEntry(entryName: string): string {
  const parts = String(entryName).split(/[/\\]/);
  return parts.length >= 2 ? parts[1]! : 'digital_map';
}

async function loadFolderCrs(folder: string): Promise<string> {
  const { resolveGgnrDataDir } = await import('@/lib/turbopackFsPath');
  const { GGNR_DATA_PATHS } = await import('@/lib/ggnrDataPaths');
  const path = await import('node:path');
  const { existsSync, readFileSync } = await import('node:fs');
  const safe = folder.replace(/[^\w가-힣().\-_]/gu, '_');
  const idxPath = path.join(
    resolveGgnrDataDir(),
    GGNR_DATA_PATHS.meta,
    'digital_map',
    `${safe}.json`
  );
  if (!existsSync(idxPath)) return CRS_FALLBACK;
  try {
    const raw = JSON.parse(readFileSync(idxPath, 'utf8')) as { crs?: string };
    const crs = String(raw.crs ?? '').replace(/^EPSG:/i, '');
    return /^\d{4,5}$/.test(crs) ? crs : CRS_FALLBACK;
  } catch {
    return CRS_FALLBACK;
  }
}

function to5181(
  proj4: Proj4Like,
  fromEpsg: string,
  x: number,
  y: number
): Pt | null {
  if (![x, y].every(Number.isFinite)) return null;
  if (fromEpsg === 'EPSG:5181') return [x, y];
  try {
    const p = proj4(fromEpsg, 'EPSG:5181', [x, y]) as [number, number];
    if (![p[0], p[1]].every(Number.isFinite)) return null;
    return p;
  } catch {
    return null;
  }
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

type CanvasCtx = {
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  closePath: () => void;
  stroke: () => void;
  clearRect: (x: number, y: number, w: number, h: number) => void;
  arc: (
    x: number,
    y: number,
    r: number,
    start: number,
    end: number,
    ccw?: boolean
  ) => void;
  save: () => void;
  restore: () => void;
  translate: (x: number, y: number) => void;
  rotate: (r: number) => void;
  fillText: (t: string, x: number, y: number) => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textBaseline: string;
  globalCompositeOperation: string;
};

type DrawCtx = {
  ctx: CanvasCtx;
  toPx: (p5181: Pt) => Pt;
  fromEpsg: string;
  proj4: Proj4Like;
  bbox: [number, number, number, number];
  dxf: IDxf | null;
};

/** PNG 동봉용 — 밝은 지도용 색 보정 없이 CAD 원본 색 유지 */
function resolveOriginalStroke(
  ent: IEntity,
  dxf: IDxf | null
): { strokeCss: string; strokeWidth: number } {
  const DEFAULT_RGB = 0x1e293b;
  const idx = ent.colorIndex;
  const inherits =
    idx === undefined ||
    idx === null ||
    Number.isNaN(idx) ||
    idx === 256 ||
    idx === 0;

  let rgb: number | null = null;
  if (!inherits) {
    if (typeof ent.color === 'number' && Number.isFinite(ent.color)) {
      rgb = ent.color >>> 0;
    } else if (typeof idx === 'number' && idx > 0 && idx < 256) {
      const fromAci = getAcadColor(idx);
      if (typeof fromAci === 'number') rgb = fromAci >>> 0;
    }
  }

  if (rgb == null && dxf?.tables?.layer?.layers) {
    const layerName = String(ent.layer ?? '').trim();
    const layers = dxf.tables.layer.layers;
    let lay: ILayer | undefined =
      layers[layerName] ?? layers[layerName.toUpperCase()];
    if (!lay) {
      const k = Object.keys(layers).find(
        (x) => x.toUpperCase() === layerName.toUpperCase()
      );
      if (k) lay = layers[k];
    }
    if (lay) {
      if (typeof lay.color === 'number' && Number.isFinite(lay.color)) {
        rgb = lay.color >>> 0;
      } else {
        const li = (lay as { colorIndex?: number }).colorIndex;
        if (typeof li === 'number' && li > 0 && li < 256) {
          const fromAci = getAcadColor(li);
          if (typeof fromAci === 'number') rgb = fromAci >>> 0;
        }
      }
    }
  }

  if (
    rgb == null &&
    typeof ent.color === 'number' &&
    Number.isFinite(ent.color) &&
    idx !== 256 &&
    idx !== 0
  ) {
    rgb = ent.color >>> 0;
  }
  if (rgb == null) rgb = DEFAULT_RGB;

  const v = rgb >>> 0;
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  let lw = 1.1;
  const lwRaw = ent.lineweight;
  if (typeof lwRaw === 'number' && lwRaw > 0 && lwRaw < 500) {
    lw = Math.min(6, Math.max(0.35, lwRaw / 40));
  }
  return { strokeCss: `rgb(${r},${g},${b})`, strokeWidth: lw };
}

function applyEntityStyle(d: DrawCtx, ent: IEntity): void {
  const { strokeCss, strokeWidth } = resolveOriginalStroke(ent, d.dxf);
  d.ctx.strokeStyle = strokeCss;
  d.ctx.fillStyle = strokeCss;
  d.ctx.lineWidth = strokeWidth;
}

function inBboxLoose(p: Pt, bbox: [number, number, number, number], pad: number): boolean {
  return (
    p[0] >= bbox[0] - pad &&
    p[0] <= bbox[2] + pad &&
    p[1] >= bbox[1] - pad &&
    p[1] <= bbox[3] + pad
  );
}

function drawPolyline(d: DrawCtx, coords: Pt[], closed: boolean): void {
  if (coords.length < 2) return;
  const pts = coords
    .map((c) => to5181(d.proj4, d.fromEpsg, c[0], c[1]))
    .filter((p): p is Pt => p != null);
  if (pts.length < 2) return;
  if (!pts.some((p) => inBboxLoose(p, d.bbox, 50))) return;
  d.ctx.beginPath();
  const first = d.toPx(pts[0]!);
  d.ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const q = d.toPx(pts[i]!);
    d.ctx.lineTo(q[0], q[1]);
  }
  if (closed) d.ctx.closePath();
  d.ctx.stroke();
}

function drawEntity(d: DrawCtx, ent: IEntity): void {
  const type = String(ent.type ?? '').toUpperCase();
  applyEntityStyle(d, ent);
  if (type === 'LINE') {
    const e = ent as IEntity & {
      vertices?: Array<{ x: number; y: number }>;
      startPoint?: { x: number; y: number };
      endPoint?: { x: number; y: number };
    };
    const a = e.vertices?.[0] ?? e.startPoint;
    const b = e.vertices?.[1] ?? e.endPoint;
    if (!a || !b) return;
    drawPolyline(d, [
      [Number(a.x), Number(a.y)],
      [Number(b.x), Number(b.y)],
    ], false);
    return;
  }
  if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
    const e = ent as IEntity & {
      vertices?: Array<{ x: number; y: number }>;
      shape?: boolean;
      closed?: boolean;
    };
    const verts = (e.vertices ?? []).map(
      (v) => [Number(v.x), Number(v.y)] as Pt
    );
    drawPolyline(d, verts, Boolean(e.shape ?? e.closed));
    return;
  }
  if (type === 'CIRCLE') {
    const e = ent as IEntity & {
      center?: { x: number; y: number };
      radius?: number;
    };
    if (!e.center || !(Number(e.radius) > 0)) return;
    const c = to5181(d.proj4, d.fromEpsg, Number(e.center.x), Number(e.center.y));
    if (!c || !inBboxLoose(c, d.bbox, Number(e.radius) + 50)) return;
    const edge = to5181(
      d.proj4,
      d.fromEpsg,
      Number(e.center.x) + Number(e.radius),
      Number(e.center.y)
    );
    if (!edge) return;
    const cp = d.toPx(c);
    const ep = d.toPx(edge);
    const rPx = Math.hypot(ep[0] - cp[0], ep[1] - cp[1]);
    if (!(rPx > 0.2)) return;
    d.ctx.beginPath();
    d.ctx.arc(cp[0], cp[1], rPx, 0, Math.PI * 2);
    d.ctx.stroke();
    return;
  }
  if (type === 'ARC') {
    const e = ent as IEntity & {
      center?: { x: number; y: number };
      radius?: number;
      startAngle?: number;
      endAngle?: number;
    };
    if (!e.center || !(Number(e.radius) > 0)) return;
    const c = to5181(d.proj4, d.fromEpsg, Number(e.center.x), Number(e.center.y));
    if (!c) return;
    const edge = to5181(
      d.proj4,
      d.fromEpsg,
      Number(e.center.x) + Number(e.radius),
      Number(e.center.y)
    );
    if (!edge) return;
    const cp = d.toPx(c);
    const ep = d.toPx(edge);
    const rPx = Math.hypot(ep[0] - cp[0], ep[1] - cp[1]);
    const start = degToRad(Number(e.startAngle ?? 0));
    const end = degToRad(Number(e.endAngle ?? 0));
    d.ctx.beginPath();
    d.ctx.arc(cp[0], cp[1], Math.max(0.2, rPx), -end, -start, true);
    d.ctx.stroke();
    return;
  }
  if (type === 'TEXT' || type === 'MTEXT') {
    const e = ent as IEntity & {
      text?: string;
      string?: string;
      startPoint?: { x: number; y: number };
      position?: { x: number; y: number };
      textHeight?: number;
      height?: number;
      rotation?: number;
    };
    const raw = String(e.text ?? e.string ?? '');
    const label = type === 'MTEXT' ? cleanMtext(raw) : raw.trim();
    if (!label) return;
    const pos = e.startPoint ?? e.position;
    if (!pos) return;
    const p = to5181(d.proj4, d.fromEpsg, Number(pos.x), Number(pos.y));
    if (!p || !inBboxLoose(p, d.bbox, 20)) return;
    const q = d.toPx(p);
    const hWorld = Number(e.textHeight ?? e.height ?? 1);
    const hPx = Math.max(
      8,
      Math.min(
        28,
        Math.abs(d.toPx([p[0], p[1] + hWorld])[1] - q[1]) || 10
      )
    );
    d.ctx.save();
    d.ctx.translate(q[0], q[1]);
    const rot = Number(e.rotation ?? 0);
    if (rot) d.ctx.rotate(-degToRad(rot));
    d.ctx.font = `${hPx}px sans-serif`;
    d.ctx.textBaseline = 'alphabetic';
    d.ctx.fillText(label.slice(0, 80), 0, 0);
    d.ctx.restore();
  }
}

async function parseDxfFile(absPath: string): Promise<IDxf | null> {
  const buf = await fs.readFile(absPath);
  const text = decodeDxfBytes(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
  const parser = new DxfParser();
  try {
    return parser.parseSync(text) ?? null;
  } catch {
    return null;
  }
}

/**
 * 선택 폴더·범위와 겹치는 DXF를 폴더별 PNG 1장으로 렌더.
 */
export async function renderDigitalMapPngForBbox5181(
  bbox5181: [number, number, number, number],
  opts?: { folderNames?: string[] | null; width?: number }
): Promise<Array<{ entryName: string; buffer: Buffer }>> {
  const dxfs = await collectDigitalMapFilesIntersectingBbox5181(bbox5181, {
    folderNames: opts?.folderNames ?? null,
  });
  if (!dxfs.length) return [];
  const MAX_SHEETS = 40;
  if (dxfs.length > MAX_SHEETS) {
    throw new Error(
      `범위와 겹치는 수치지형도가 ${dxfs.length}건입니다. ${MAX_SHEETS}건 이하가 되도록 화면 범위를 좁히거나 구역을 작게 지정하세요.`
    );
  }

  const proj4mod = await import('proj4');
  const proj4 = (proj4mod.default ?? proj4mod) as unknown as Proj4Like;
  ensureProjDefs(proj4);
  const { createCanvas } = await import('@napi-rs/canvas');

  const [minX, minY, maxX, maxY] = bbox5181;
  const width = Math.max(
    512,
    Math.min(4096, Math.floor(opts?.width ?? DEFAULT_WIDTH))
  );
  const height = Math.max(
    512,
    Math.min(
      MAX_HEIGHT,
      Math.round(width * ((maxY - minY) / Math.max(1e-6, maxX - minX)))
    )
  );
  const pad = 2;
  const toPx = (p: Pt): Pt => {
    const x = pad + ((p[0] - minX) / (maxX - minX)) * (width - pad * 2);
    const y = pad + ((maxY - p[1]) / (maxY - minY)) * (height - pad * 2);
    return [x, y];
  };

  const byFolder = new Map<string, DigitalMapExportFile[]>();
  for (const f of dxfs) {
    const folder = folderFromEntry(f.entryName);
    const list = byFolder.get(folder) ?? [];
    list.push(f);
    byFolder.set(folder, list);
  }

  const out: Array<{ entryName: string; buffer: Buffer }> = [];
  for (const [folder, files] of byFolder) {
    const crs = await loadFolderCrs(folder);
    const fromEpsg = `EPSG:${crs}`;
    if (!proj4.defs(fromEpsg)) {
      proj4.defs(
        fromEpsg,
        '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
      );
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d') as unknown as CanvasCtx;
    // 투명 배경 — 흰 바탕 채우지 않음
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const draw: DrawCtx = {
      ctx,
      toPx,
      fromEpsg,
      proj4,
      bbox: bbox5181,
      dxf: null,
    };

    for (const file of files) {
      const dxf = await parseDxfFile(file.absPath);
      if (!dxf?.entities?.length) continue;
      draw.dxf = dxf;
      const ents = dxf.entities.slice(0, MAX_ENTITIES_PER_SHEET);
      for (const ent of ents) {
        try {
          drawEntity(draw, ent);
        } catch {
          /* skip bad entity */
        }
      }
    }

    const png = (
      canvas as unknown as { toBuffer: (t: string) => Buffer }
    ).toBuffer('image/png');
    const safe = folder.replace(/[\\/:*?"<>|]+/g, '_');
    out.push({
      entryName: `수치지형도/${safe}.png`,
      buffer: Buffer.isBuffer(png) ? png : Buffer.from(png),
    });
  }
  return out;
}
