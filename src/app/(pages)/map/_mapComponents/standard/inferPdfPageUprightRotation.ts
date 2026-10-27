import type { PDFPageProxy } from 'pdfjs-dist';

export type PdfCardinalRotation = 0 | 90 | 180 | 270;
export type IndexSheetMode = 'landscape' | 'portrait';

/** 색인도 칸 외곽(3857)과 칸 안 종단선. 미리보기 방향을 지도와 맞출 때 사용 */
export type IndexSheetGuide = {
  ring3857?: [number, number][] | null;
  guide3857?: [number, number][] | null;
};

/** 원본 박스 기준 세로로 볼 최소 비율 (가로는 손대지 않음) */
const PORTRAIT_MIN_RATIO = 1.08;
/** 작게 그리면 등고선·하천이 섞여 0·180 점수가 비슷해진다 */
const MATCH_LONG_PX = 256;
const GUIDE_SAMPLES = 48;
const SAMPLE_RADIUS_PX = 2;

const CARDINALS: PdfCardinalRotation[] = [0, 90, 180, 270];

const pageRotCache = new WeakMap<PDFPageProxy, Map<string, Promise<PdfCardinalRotation>>>();

function normalizePdfRotation(deg: number): PdfCardinalRotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  if (r === 90 || r === 180 || r === 270) return r;
  return 0;
}

export function combinePdfRotation(upright: number, user: number): PdfCardinalRotation {
  return normalizePdfRotation(upright + user);
}

export type InferPdfUprightOpts = {
  /** 색인도일 때만 지정. 칸·원본이 가로로 같으면 0·180, 세로 원본은 90·270. */
  indexSheetMode?: IndexSheetMode;
  /** 색인도 칸·종단선. 없으면 페이지에 적힌 각도를 그대로 쓴다. */
  indexSheetGuide?: IndexSheetGuide;
};

/** 지도 범위 가로가 세로보다 뚜렷이 길면 가로 색인으로 본다. */
export function extent3857IsLandscape(
  ext: [number, number, number, number] | null | undefined
): boolean {
  if (ext == null || ext.length < 4) return false;
  const w = Math.abs(ext[2] - ext[0]);
  const h = Math.abs(ext[3] - ext[1]);
  if (!(w > 0 && h > 0)) return false;
  return w > h * PORTRAIT_MIN_RATIO;
}

function closedRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  return ring;
}

type SheetFrame = {
  originX: number;
  originY: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
};

/** 칸 외곽으로 종이 좌표(가로=동, 세로=북)를 만든다. */
function sheetFrameFromRing(ring: [number, number][]): SheetFrame | null {
  const pts = closedRing(ring).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 3) return null;
  let bestLen = -1;
  let ax = 1;
  let ay = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      ax = dx / len;
      ay = dy / len;
    }
  }
  if (!(bestLen > 0)) return null;
  const bx = -ay;
  const by = ax;
  const aNorth = Math.abs(ay);
  const bNorth = Math.abs(by);
  let vx: number;
  let vy: number;
  if (aNorth >= bNorth) {
    vx = ax;
    vy = ay;
  } else {
    vx = bx;
    vy = by;
  }
  if (vy < 0) {
    vx = -vx;
    vy = -vy;
  }
  let ux = vy;
  let uy = -vx;
  if (ux < 0) {
    ux = -ux;
    uy = -uy;
  }
  if (ux * vy - uy * vx < 0) {
    ux = -ux;
    uy = -uy;
  }
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    const u = p[0] * ux + p[1] * uy;
    const v = p[0] * vx + p[1] * vy;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const width = maxU - minU;
  const height = maxV - minV;
  if (!(width > 0 && height > 0)) return null;
  return {
    originX: minU * ux + minV * vx,
    originY: minU * uy + minV * vy,
    ux,
    uy,
    vx,
    vy,
    width,
    height,
  };
}

function toUv(frame: SheetFrame, x: number, y: number): { u: number; v: number } | null {
  const dx = x - frame.originX;
  const dy = y - frame.originY;
  const u = (dx * frame.ux + dy * frame.uy) / frame.width;
  const v = (dx * frame.vx + dy * frame.vy) / frame.height;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return { u, v };
}

function resampleGuide(guide: [number, number][], n: number): [number, number][] {
  if (guide.length < 2) return guide;
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < guide.length; i++) {
    const d = Math.hypot(guide[i][0] - guide[i - 1][0], guide[i][1] - guide[i - 1][1]);
    seg.push(d);
    total += d;
  }
  if (!(total > 0)) return [guide[0], guide[guide.length - 1]];
  const out: [number, number][] = [];
  for (let s = 0; s < n; s++) {
    const t = (s / Math.max(1, n - 1)) * total;
    let acc = 0;
    let picked: [number, number] = guide[guide.length - 1];
    for (let i = 1; i < guide.length; i++) {
      const d = seg[i - 1];
      if (acc + d >= t || i === guide.length - 1) {
        const r = d > 0 ? (t - acc) / d : 0;
        const a = guide[i - 1];
        const b = guide[i];
        picked = [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r];
        break;
      }
      acc += d;
    }
    out.push(picked);
  }
  return out;
}

function paperMatchesPdf(
  paperW: number,
  paperH: number,
  pdfW: number,
  pdfH: number
): boolean {
  const paperLand = paperW > paperH * PORTRAIT_MIN_RATIO;
  const paperPort = paperH > paperW * PORTRAIT_MIN_RATIO;
  const pdfLand = pdfW > pdfH * PORTRAIT_MIN_RATIO;
  const pdfPort = pdfH > pdfW * PORTRAIT_MIN_RATIO;
  if (paperLand && pdfLand) return true;
  if (paperPort && pdfPort) return true;
  if (!paperLand && !paperPort && !pdfLand && !pdfPort) return true;
  return false;
}

function candidateRotations(
  paperW: number,
  paperH: number,
  rawW: number,
  rawH: number
): PdfCardinalRotation[] {
  const out: PdfCardinalRotation[] = [];
  for (const r of CARDINALS) {
    const w = r === 90 || r === 270 ? rawH : rawW;
    const h = r === 90 || r === 270 ? rawW : rawH;
    if (paperMatchesPdf(paperW, paperH, w, h)) out.push(r);
  }
  /** 가로 원본은 이미 바로 누워 있다. 180은 글자를 뒤집기만 한다. 세로는 0·180으로 바로 세운다. */
  const pdfLand = rawW > rawH * PORTRAIT_MIN_RATIO;
  const filtered = pdfLand ? out.filter((r) => r !== 180) : out;
  return filtered.length ? filtered : [0];
}

function sampleInk(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number
): number {
  const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
  const i = (yi * w + xi) * 4;
  const r = data[i] ?? 255;
  const g = data[i + 1] ?? 255;
  const b = data[i + 2] ?? 255;
  const dark = 1 - Math.max(r, g, b) / 255;
  const yellow = Math.max(0, (r + g) / 2 - b) / 255;
  return dark * 0.65 + yellow * 0.35;
}

function sampleInkNeighborhood(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number
): number {
  let best = 0;
  for (let dy = -SAMPLE_RADIUS_PX; dy <= SAMPLE_RADIUS_PX; dy++) {
    for (let dx = -SAMPLE_RADIUS_PX; dx <= SAMPLE_RADIUS_PX; dx++) {
      const s = sampleInk(data, w, h, x + dx, y + dy);
      if (s > best) best = s;
    }
  }
  return best;
}

async function renderInk(
  page: PDFPageProxy,
  rotation: PdfCardinalRotation,
  longPx: number
): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> {
  if (typeof document === 'undefined') return null;
  const base = page.getViewport({ scale: 1, rotation });
  const scale = longPx / Math.max(base.width, base.height, 1);
  const vp = page.getViewport({ scale, rotation });
  const w = Math.max(1, Math.ceil(vp.width));
  const h = Math.max(1, Math.ceil(vp.height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

function scoreGuideOnInk(
  ink: { data: Uint8ClampedArray; w: number; h: number },
  uvs: Array<{ u: number; v: number }>
): number {
  if (uvs.length === 0) return 0;
  let s = 0;
  const n = uvs.length;
  for (let i = 0; i < n; i++) {
    const p = uvs[i];
    const prev = uvs[Math.max(0, i - 1)];
    const next = uvs[Math.min(n - 1, i + 1)];
    const tx = next.u - prev.u;
    const ty = next.v - prev.v;
    const tlen = Math.hypot(tx, ty) || 1;
    const nx = -ty / tlen;
    const ny = tx / tlen;
    let best = 0;
    for (const o of [0, 0.012, -0.012]) {
      const x = (p.u + nx * o) * (ink.w - 1);
      const y = (1 - (p.v + ny * o)) * (ink.h - 1);
      const sc = sampleInkNeighborhood(ink.data, ink.w, ink.h, x, y);
      if (sc > best) best = sc;
    }
    s += best;
  }
  return s / n;
}

function snapTextAngle(tr: number[]): PdfCardinalRotation {
  const deg = ((Math.atan2(tr[1], tr[0]) * 180) / Math.PI + 360) % 360;
  let best: PdfCardinalRotation = 0;
  let bestDiff = 999;
  for (const o of CARDINALS) {
    const diff = Math.min(Math.abs(deg - o), 360 - Math.abs(deg - o));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = o;
    }
  }
  return best;
}

/** 방위표 글자 N의 방향. 이 각만큼 돌리면 북이 화면 위. 없으면 null */
async function inferFromCompassN(page: PDFPageProxy): Promise<PdfCardinalRotation | null> {
  if (typeof page.getTextContent !== 'function') return null;
  const tc = await page.getTextContent();
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const hits: Array<{ rot: PdfCardinalRotation; edge: number }> = [];
  for (const item of tc.items) {
    if (item == null || typeof item !== 'object') continue;
    if (!('str' in item) || !('transform' in item)) continue;
    const str = String((item as { str: string }).str).trim();
    if (str !== 'N') continue;
    const tr = (item as { transform: number[] }).transform;
    if (!tr || tr.length < 6) continue;
    const x = tr[4];
    const y = tr[5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const edge = Math.min(x, y, vp.width - x, vp.height - y);
    hits.push({ rot: snapTextAngle(tr), edge });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.edge - b.edge);
  return hits[0]?.rot ?? null;
}

function cacheKey(opts?: InferPdfUprightOpts): string {
  const mode = opts?.indexSheetMode ?? '0';
  const g = opts?.indexSheetGuide?.guide3857;
  if (g == null || g.length < 2) return `${mode}|v5`;
  const a = g[0];
  const b = g[g.length - 1];
  return `v5|${mode}|${g.length}|${a[0].toFixed(0)}|${b[0].toFixed(0)}|${b[1].toFixed(0)}`;
}

/**
 * 색인도 미리보기 각도. 방위표 N이 있으면 북이 위로, 없으면 칸·종단선.
 * 보고서는 가이드가 없어 페이지에 적힌 각도를 그대로 쓴다.
 */
export function inferPdfPageUprightRotation(
  page: PDFPageProxy,
  opts?: InferPdfUprightOpts
): Promise<PdfCardinalRotation> {
  const mode = opts?.indexSheetMode;
  if (mode !== 'landscape' && mode !== 'portrait') {
    return Promise.resolve(normalizePdfRotation(page.rotate));
  }
  const guide = opts?.indexSheetGuide?.guide3857;
  const ring = opts?.indexSheetGuide?.ring3857;
  let slot = pageRotCache.get(page);
  if (!slot) {
    slot = new Map();
    pageRotCache.set(page, slot);
  }
  const key = cacheKey(opts);
  const hit = slot.get(key);
  if (hit) return hit;
  const pending = inferUncached(page, ring ?? [], guide ?? []).catch(() =>
    normalizePdfRotation(page.rotate)
  );
  slot.set(key, pending);
  return pending;
}

async function inferUncached(
  page: PDFPageProxy,
  ring: [number, number][],
  guide: [number, number][]
): Promise<PdfCardinalRotation> {
  const fallback = normalizePdfRotation(page.rotate);
  const compass = await inferFromCompassN(page);
  if (compass != null) return compass;
  const frame = sheetFrameFromRing(ring.length >= 3 ? ring : guide);
  if (!frame) return fallback;
  const uvs = resampleGuide(guide, GUIDE_SAMPLES)
    .map((p) => toUv(frame, p[0], p[1]))
    .filter((p): p is { u: number; v: number } => p != null && p.u >= -0.05 && p.u <= 1.05 && p.v >= -0.05 && p.v <= 1.05);
  if (uvs.length < 8) return fallback;

  const raw = page.getViewport({ scale: 1, rotation: 0 });
  const rots = candidateRotations(frame.width, frame.height, raw.width, raw.height);
  let best: PdfCardinalRotation = fallback;
  let bestScore = -1;
  let second = -1;
  let score0 = -1;
  let score180 = -1;
  for (const r of rots) {
    const ink = await renderInk(page, r, MATCH_LONG_PX);
    if (!ink) continue;
    const sc = scoreGuideOnInk(ink, uvs);
    if (r === 0) score0 = sc;
    if (r === 180) score180 = sc;
    if (sc > bestScore) {
      second = bestScore;
      bestScore = sc;
      best = r;
    } else if (sc > second) {
      second = sc;
    }
  }
  if (bestScore < 0.04) return fallback;
  if (second >= 0 && bestScore < second * 1.08 && bestScore - second < 0.02) return fallback;
  /** 원본이 이미 칸과 같은 가로·세로면 0을 우선. 손두들처럼 뚜렷이 나을 때만 180 */
  if (best === 180 && score0 >= 0 && !(score180 > score0 * 1.35 && score180 - score0 >= 0.05)) {
    return 0;
  }
  return best;
}
