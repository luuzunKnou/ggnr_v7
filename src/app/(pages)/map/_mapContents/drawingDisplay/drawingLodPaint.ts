import type Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import type { Extent } from 'ol/extent';
import { buffer as bufferExtent, containsExtent, isEmpty } from 'ol/extent';
import type VectorSource from 'ol/source/Vector';
import { DXF_LABEL, DXF_LAYER, DXF_LENGTH } from '@/lib/dxfToOpenLayers';
import {
  DRAWING_LOD_LEVELS,
  DRAWING_PAINT_CHUNK,
  calcZoomFactor,
  resolveDrawingLod,
  type DrawingLodLevel,
} from './drawingDisplayConfig';

export const DXF_STABLE_IDX = 'dxfStableIdx';

export type LodPickResult = {
  level: DrawingLodLevel;
  levelIndex: number;
  zoomFactor: number;
  loadedExtent: Extent;
  candidates: Feature<Geometry>[];
};

export function bufferForLoad(viewExtent: Extent, factor = 0.75): Extent {
  const pad = Math.max(
    (viewExtent[2] - viewExtent[0]) * factor,
    (viewExtent[3] - viewExtent[1]) * factor
  );
  return bufferExtent(viewExtent, pad);
}

export function viewStillCovered(loaded: Extent | null, viewExtent: Extent): boolean {
  if (!loaded || isEmpty(loaded) || isEmpty(viewExtent)) return false;
  return containsExtent(loaded, viewExtent);
}

function featLength(f: Feature<Geometry>): number {
  const n = Number(f.get(DXF_LENGTH));
  if (Number.isFinite(n) && n > 0) return n;
  const e = f.getGeometry()?.getExtent();
  if (!e) return 0;
  return Math.hypot(e[2] - e[0], e[3] - e[1]);
}

/**
 * 격자 칸을 돌아가며 긴 선부터 집어, 한쪽에만 몰리지 않게 한다.
 */
function pickSpatiallySpread(
  features: Feature<Geometry>[],
  extent: Extent,
  max: number
): Feature<Geometry>[] {
  if (features.length <= max) return features;
  const cols = 32;
  const rows = 32;
  const cells: Feature<Geometry>[][] = Array.from({ length: cols * rows }, () => []);
  const w = Math.max(1e-9, extent[2] - extent[0]);
  const h = Math.max(1e-9, extent[3] - extent[1]);

  for (const f of features) {
    const e = f.getGeometry()?.getExtent();
    if (!e) continue;
    const cx = (e[0] + e[2]) / 2;
    const cy = (e[1] + e[3]) / 2;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((cx - extent[0]) / w) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((cy - extent[1]) / h) * rows)));
    cells[r * cols + c].push(f);
  }

  for (const cell of cells) {
    cell.sort((a, b) => featLength(b) - featLength(a));
  }

  const out: Feature<Geometry>[] = [];
  const seen = new Set<Feature<Geometry>>();
  let round = 0;
  let added = true;
  while (out.length < max && added) {
    added = false;
    for (const cell of cells) {
      if (out.length >= max) break;
      const f = cell[round];
      if (!f || seen.has(f)) continue;
      seen.add(f);
      out.push(f);
      added = true;
    }
    round++;
  }
  return out;
}

export function pickLodFeatures(
  indexSource: VectorSource,
  viewExtent: Extent,
  fullExtent: Extent,
  hiddenLayers: ReadonlySet<string>
): LodPickResult {
  const fullW = !isEmpty(fullExtent) ? fullExtent[2] - fullExtent[0] : 0;
  const viewW = !isEmpty(viewExtent) ? viewExtent[2] - viewExtent[0] : 0;
  const zoomFactor = calcZoomFactor(fullW, viewW);
  const { level, index } = resolveDrawingLod(zoomFactor);
  const loadedExtent = bufferForLoad(viewExtent, 0.8);

  if (level.overviewOnly || level.maxFeatures <= 0) {
    return { level, levelIndex: index, zoomFactor, loadedExtent, candidates: [] };
  }

  const raw = indexSource.getFeaturesInExtent(loadedExtent) as Feature<Geometry>[];
  const minLen = viewW > 0 ? viewW * (level.minSpanRatio || 0) : 0;
  const lines: Feature<Geometry>[] = [];
  const texts: Feature<Geometry>[] = [];

  for (const f of raw) {
    const layerName = String(f.get(DXF_LAYER) ?? '0');
    if (hiddenLayers.has(layerName)) continue;
    if (f.get(DXF_LABEL) != null) {
      texts.push(f);
      continue;
    }
    if (minLen > 0 && featLength(f) < minLen) continue;
    lines.push(f);
  }

  const labelCap = level.showLabels ? level.maxLabels : 0;
  const lineBudget = Math.max(0, level.maxFeatures - labelCap);
  const spread = pickSpatiallySpread(lines, loadedExtent, lineBudget);
  const out = spread.slice();

  if (level.showLabels && labelCap > 0) {
    texts.sort((a, b) => String(a.get(DXF_LABEL) ?? '').length - String(b.get(DXF_LABEL) ?? '').length);
    let n = 0;
    for (const f of texts) {
      if (n >= labelCap || out.length >= level.maxFeatures) break;
      out.push(f);
      n++;
    }
  }

  return { level, levelIndex: index, zoomFactor, loadedExtent, candidates: out };
}

export type PaintController = {
  cancel: () => void;
  get active(): boolean;
};

export function replaceFeaturesAtomic(
  source: VectorSource,
  features: Feature<Geometry>[],
  onDone?: (n: number) => void
): void {
  source.clear(true);
  if (features.length) source.addFeatures(features);
  onDone?.(features.length);
}

export function paintFeaturesProgressive(
  source: VectorSource,
  features: Feature<Geometry>[],
  onProgress?: (visible: number, total: number) => void,
  chunk = DRAWING_PAINT_CHUNK
): PaintController {
  let cancelled = false;
  let raf = 0;
  let i = 0;
  const keep = new Set(features);
  const existing = new Set(source.getFeatures());
  const toAdd = features.filter((f) => !existing.has(f));

  const finish = () => {
    if (cancelled) return;
    for (const f of source.getFeatures()) {
      if (!keep.has(f)) source.removeFeature(f);
    }
    onProgress?.(features.length, features.length);
  };

  const tick = () => {
    if (cancelled) return;
    if (i >= toAdd.length) {
      finish();
      return;
    }
    const end = Math.min(i + chunk, toAdd.length);
    source.addFeatures(toAdd.slice(i, end));
    i = end;
    onProgress?.(Math.min(features.length, existing.size + i), features.length);
    if (i < toAdd.length) raf = requestAnimationFrame(tick);
    else finish();
  };

  if (toAdd.length === 0) finish();
  else raf = requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    },
    get active() {
      return !cancelled && i < toAdd.length;
    },
  };
}

export function lodLevelCount(): number {
  return DRAWING_LOD_LEVELS.length;
}
