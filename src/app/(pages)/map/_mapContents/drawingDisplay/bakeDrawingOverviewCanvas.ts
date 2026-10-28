import type Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import type { Extent } from 'ol/extent';
import { DXF_LABEL, DXF_LAYER, DXF_LENGTH, DXF_STROKE } from '@/lib/dxfToOpenLayers';
import { DRAWING_OVERVIEW_MAX_PX } from './drawingDisplayConfig';

export type BakedOverview = {
  canvas: HTMLCanvasElement;
  imageExtent: Extent;
  blobUrl: string;
};

function featLength(f: Feature<Geometry>): number {
  const n = Number(f.get(DXF_LENGTH));
  if (Number.isFinite(n) && n > 0) return n;
  const e = f.getGeometry()?.getExtent();
  if (!e) return 0;
  return Math.hypot(e[2] - e[0], e[3] - e[1]);
}

/** 1단계: 짧은 내부 선 제외 — 긴 선·큰 범위만 외곽으로 */
function isOutlineFeature(f: Feature<Geometry>, fullW: number, fullH: number, diag: number): boolean {
  if (f.get(DXF_LABEL) != null) return false;
  const g = f.getGeometry();
  if (!g) return false;
  const t = g.getType();
  if (t === 'Point' || t === 'MultiPoint') return false;
  const e = g.getExtent();
  const span = Math.max(e[2] - e[0], e[3] - e[1]);
  if (span >= Math.max(fullW, fullH) * 0.1) return true;
  const len = featLength(f);
  return len >= diag * 0.045;
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  coords: number[][],
  toX: (x: number) => number,
  toY: (y: number) => number
) {
  if (coords.length < 2) return;
  ctx.moveTo(toX(coords[0][0]), toY(coords[0][1]));
  for (let i = 1; i < coords.length; i++) ctx.lineTo(toX(coords[i][0]), toY(coords[i][1]));
}

/**
 * 전체 도면 외곽 선을 한 장 비트맵으로 — 1단계 전용.
 */
export function bakeDrawingOverviewCanvas(
  features: Feature<Geometry>[],
  fullExtent: Extent,
  hiddenLayers: ReadonlySet<string>,
  maxPx = DRAWING_OVERVIEW_MAX_PX
): BakedOverview | null {
  if (!fullExtent.every(Number.isFinite)) return null;
  const [minX, minY, maxX, maxY] = fullExtent;
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return null;
  const diag = Math.hypot(w, h);

  const scale = maxPx / Math.max(w, h);
  const cw = Math.max(1, Math.ceil(w * scale));
  const ch = Math.max(1, Math.ceil(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const toX = (x: number) => (x - minX) * scale;
  const toY = (y: number) => (maxY - y) * scale;

  const visible: Feature<Geometry>[] = [];
  for (const f of features) {
    const layerName = String(f.get(DXF_LAYER) ?? '0');
    if (hiddenLayers.has(layerName)) continue;
    visible.push(f);
  }

  let outline = visible.filter((f) => isOutlineFeature(f, w, h, diag));
  if (outline.length < 250) {
    const rest = visible
      .filter((f) => f.get(DXF_LABEL) == null && !outline.includes(f))
      .sort((a, b) => featLength(b) - featLength(a));
    outline = outline.concat(rest.slice(0, 250 - outline.length));
  }
  if (outline.length > 4_000) {
    outline.sort((a, b) => featLength(b) - featLength(a));
    outline = outline.slice(0, 4_000);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.15;

  for (const f of outline) {
    const g = f.getGeometry();
    if (!g) continue;
    ctx.strokeStyle = (f.get(DXF_STROKE) as string) || 'rgb(30,41,59)';
    ctx.beginPath();
    const type = g.getType();
    if (type === 'LineString') {
      strokePath(ctx, (g as import('ol/geom').LineString).getCoordinates(), toX, toY);
      ctx.stroke();
    } else if (type === 'MultiLineString') {
      for (const coords of (g as import('ol/geom').MultiLineString).getCoordinates()) {
        strokePath(ctx, coords, toX, toY);
      }
      ctx.stroke();
    } else if (type === 'Polygon' || type === 'MultiPolygon') {
      const polys =
        type === 'Polygon'
          ? [(g as import('ol/geom').Polygon).getCoordinates()]
          : (g as import('ol/geom').MultiPolygon).getCoordinates();
      for (const rings of polys) {
        if (rings[0]) strokePath(ctx, rings[0], toX, toY);
      }
      ctx.stroke();
    }
  }

  const blobUrl = canvas.toDataURL('image/png');
  return { canvas, imageExtent: fullExtent.slice() as Extent, blobUrl };
}

export function revokeOverviewUrl(baked: BakedOverview | null) {
  if (!baked) return;
  if (baked.blobUrl.startsWith('blob:')) URL.revokeObjectURL(baked.blobUrl);
}
