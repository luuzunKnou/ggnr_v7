/**
 * 색인도 방향 판정 — 색인도 칸 안 하천 모양(지도)과 도면 속 수면(PDF)을 격자로 비교한다.
 * 화면 의존 없음(서버 배치·검토 화면 공용). 회전은 pdf.js getViewport 의 시계방향 각도와 같다.
 */

export type Pt = [number, number];
export type RiverIndexRotation = 0 | 90 | 180 | 270;
export const RIVER_INDEX_ROTATIONS: RiverIndexRotation[] = [0, 90, 180, 270];

/** 색인도 칸 — 지도 축(동·북)에 가장 가깝게 맞춘 직사각형 좌표계 */
export type SheetFrame = {
  cx: number;
  cy: number;
  cos: number;
  sin: number;
  minU: number;
  minV: number;
  width: number;
  height: number;
};

export type BinaryGrid = { w: number; h: number; data: Uint8Array };

/** 도면 수면으로 볼 색 — 업체마다 다를 수 있어 조정 가능 */
export type WaterColorRule = {
  /** 파랑 최소값 */
  minBlue: number;
  /** 파랑 − 빨강 최소 차이 */
  minBlueMinusRed: number;
  /** 초록 − 빨강 최소 차이 (자홍 제외) */
  minGreenMinusRed: number;
};

export const DEFAULT_WATER_COLOR_RULE: WaterColorRule = {
  minBlue: 150,
  minBlueMinusRed: 25,
  minGreenMinusRed: 0,
};

/** 비교 격자 긴 변 칸 수 */
const GRID_LONG_CELLS = 96;
/** 칸 가로·세로 비율이 이만큼 넘게 다르면 그 방향은 후보에서 뺀다 */
const ASPECT_TOLERANCE = 1.3;
/** 격자 칸 안 수면 비율이 이 이상이면 수면 칸 */
const CELL_FILL_MIN = 0.15;

export function sheetFrameFromRing(ring: Pt[]): SheetFrame | null {
  const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]
    ? ring.slice(0, -1)
    : ring;
  if (pts.length < 3) return null;
  let bestLen = -1;
  let theta = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) {
      bestLen = len;
      theta = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  /** 가장 긴 변 각도를 −45°~45° 로 접어 지도 축에 가깝게 */
  const quarter = Math.PI / 2;
  theta = theta - Math.round(theta / quarter) * quarter;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const width = maxU - minU;
  const height = maxV - minV;
  if (!(width > 0 && height > 0)) return null;
  return { cx, cy, cos, sin, minU, minV, width, height };
}

/** 지도 좌표 → 칸 좌표(0~1, v 는 위쪽이 1) */
export function toSheetUv(frame: SheetFrame, x: number, y: number): [number, number] {
  const dx = x - frame.cx;
  const dy = y - frame.cy;
  const u = dx * frame.cos + dy * frame.sin;
  const v = -dx * frame.sin + dy * frame.cos;
  return [(u - frame.minU) / frame.width, (v - frame.minV) / frame.height];
}

function gridSizeForAspect(aspect: number): { w: number; h: number } {
  if (aspect >= 1) return { w: GRID_LONG_CELLS, h: Math.max(8, Math.round(GRID_LONG_CELLS / aspect)) };
  return { w: Math.max(8, Math.round(GRID_LONG_CELLS * aspect)), h: GRID_LONG_CELLS };
}

/** 폴리곤들(각 폴리곤 = 링 배열, 첫 링 외곽) 을 칸 격자로. 0행이 위(북) */
export function rasterizePolygons(frame: SheetFrame, polygons: Pt[][][]): BinaryGrid {
  const { w, h } = gridSizeForAspect(frame.width / frame.height);
  const data = new Uint8Array(w * h);
  const uvPolys = polygons
    .map((rings) => rings.map((ring) => ring.map((p) => toSheetUv(frame, p[0], p[1]))))
    .filter((rings) => rings.length > 0 && rings[0]!.length >= 3)
    .map((rings) => {
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const [u, v] of rings[0]!) {
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
      return { rings, minU, maxU, minV, maxV };
    });
  for (let j = 0; j < h; j++) {
    const v = 1 - (j + 0.5) / h;
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w;
      for (const poly of uvPolys) {
        if (u < poly.minU || u > poly.maxU || v < poly.minV || v > poly.maxV) continue;
        let inside = false;
        for (const ring of poly.rings) {
          for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
            const [ua, va] = ring[a]!;
            const [ub, vb] = ring[b]!;
            if (va > v !== vb > v && u < ((ub - ua) * (v - va)) / (vb - va) + ua) inside = !inside;
          }
        }
        if (inside) {
          data[j * w + i] = 1;
          break;
        }
      }
    }
  }
  return { w, h, data };
}

/** 도면 내곽선(가장 바깥 굵은 테두리) 안쪽 영역. 못 찾으면 가장자리 3% 를 뺀다 */
function findNeatlineBox(rgba: Uint8ClampedArray, w: number, h: number) {
  const dark = (i: number) => Math.max(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) < 110;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (dark((y * w + x) * 4)) n++;
    if (n > w * 0.5) rows.push(y);
  }
  const cols: number[] = [];
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < h; y++) if (dark((y * w + x) * 4)) n++;
    if (n > h * 0.5) cols.push(x);
  }
  const inset = Math.round(Math.min(w, h) * 0.01);
  if (rows.length >= 2 && cols.length >= 2) {
    const top = rows[0]! + inset;
    const bottom = rows[rows.length - 1]! - inset;
    const left = cols[0]! + inset;
    const right = cols[cols.length - 1]! - inset;
    if (bottom - top > h * 0.4 && right - left > w * 0.4) return { left, top, right, bottom };
  }
  const m = Math.round(Math.min(w, h) * 0.03);
  return { left: m, top: m, right: w - 1 - m, bottom: h - 1 - m };
}

/** 렌더한 도면(회전 0) → 내곽선 안 수면 마스크 */
export function extractWaterMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  rule: WaterColorRule = DEFAULT_WATER_COLOR_RULE
): BinaryGrid {
  const box = findNeatlineBox(rgba, w, h);
  const cw = Math.max(1, box.right - box.left + 1);
  const ch = Math.max(1, box.bottom - box.top + 1);
  const data = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = ((box.top + y) * w + (box.left + x)) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      if (b >= rule.minBlue && b - r >= rule.minBlueMinusRed && g - r >= rule.minGreenMinusRed) {
        data[y * cw + x] = 1;
      }
    }
  }
  return { w: cw, h: ch, data };
}

/** 원본 마스크를 시계방향 rot 만큼 돌렸을 때, 돌린 좌표 (x', y') 가 가리키는 원본 좌표 */
function sourceOf(rot: RiverIndexRotation, w: number, h: number, xr: number, yr: number): [number, number] {
  switch (rot) {
    case 90:
      return [yr, h - 1 - xr];
    case 180:
      return [w - 1 - xr, h - 1 - yr];
    case 270:
      return [w - 1 - yr, xr];
    default:
      return [xr, yr];
  }
}

/** 마스크를 rot 만큼 돌린 뒤 target 격자 크기로 줄임 */
export function rotateAndResample(mask: BinaryGrid, rot: RiverIndexRotation, tw: number, th: number): BinaryGrid {
  const swap = rot === 90 || rot === 270;
  const rw = swap ? mask.h : mask.w;
  const rh = swap ? mask.w : mask.h;
  const out = new Uint8Array(tw * th);
  const S = 3;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const xr = Math.min(rw - 1, Math.floor(((i + (sx + 0.5) / S) / tw) * rw));
          const yr = Math.min(rh - 1, Math.floor(((j + (sy + 0.5) / S) / th) * rh));
          const [x, y] = sourceOf(rot, mask.w, mask.h, xr, yr);
          if (mask.data[y * mask.w + x]) hit++;
        }
      }
      if (hit / (S * S) >= CELL_FILL_MIN) out[j * tw + i] = 1;
    }
  }
  return { w: tw, h: th, data: out };
}

function dilate(g: BinaryGrid): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!g.data[y * g.w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h) out[ny * g.w + nx] = 1;
        }
      }
    }
  }
  return out;
}

function fillRatio(g: BinaryGrid): number {
  let n = 0;
  for (const v of g.data) n += v;
  return n / Math.max(1, g.data.length);
}

/** 두 격자의 겹침 — 한 칸 여유를 두고 정밀도·재현율의 조화평균 */
function overlapF1(pdf: BinaryGrid, ref: BinaryGrid): number {
  const dRef = dilate(ref);
  const dPdf = dilate(pdf);
  let p = 0;
  let pHit = 0;
  let r = 0;
  let rHit = 0;
  for (let k = 0; k < pdf.data.length; k++) {
    if (pdf.data[k]) {
      p++;
      if (dRef[k]) pHit++;
    }
    if (ref.data[k]) {
      r++;
      if (dPdf[k]) rHit++;
    }
  }
  if (p === 0 || r === 0) return 0;
  const precision = pHit / p;
  const recall = rHit / r;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

export type RiverIndexRotationScore = { rotation: RiverIndexRotation; score: number };

/** 네 방향 점수. 칸 비율과 맞지 않는 방향은 −1 */
export function scoreRotations(water: BinaryGrid, ref: BinaryGrid): RiverIndexRotationScore[] {
  const refAspect = ref.w / ref.h;
  return RIVER_INDEX_ROTATIONS.map((rotation) => {
    const swap = rotation === 90 || rotation === 270;
    const aspect = swap ? water.h / water.w : water.w / water.h;
    const ratio = Math.max(aspect, refAspect) / Math.min(aspect, refAspect);
    if (ratio > ASPECT_TOLERANCE) return { rotation, score: -1 };
    return { rotation, score: overlapF1(rotateAndResample(water, rotation, ref.w, ref.h), ref) };
  });
}

/* ── 방위표 ───────────────────────────────────────────── */

export type NorthArrow = {
  /** 도면을 이만큼(시계방향) 돌리면 N 이 위 */
  rotation: RiverIndexRotation;
  /** 회전 0 도면에서 N 팔 방향(도, 오른쪽 0·위 90, 반시계) */
  angle: number;
  /** 방위표 중심·반지름(회전 0 도면 대비 0~1) */
  cx: number;
  cy: number;
  r: number;
};

const ANGLE_BINS = 72;

function isInk(rgba: Uint8ClampedArray, i: number): boolean {
  const r = rgba[i]!;
  const g = rgba[i + 1]!;
  const b = rgba[i + 2]!;
  const mx = Math.max(r, g, b);
  return mx < 130 && mx - Math.min(r, g, b) < 60;
}

/** 메울 틈 반경(px, 긴 변 1600 기준) */
const INK_GAP_PX = 2;

/** 정사각 요소 팽창(fill=1)·침식(fill=0) — 가로·세로 분리 */
function morph(src: Uint8Array, w: number, h: number, r: number, fill: 0 | 1): Uint8Array {
  const pass = (a: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = fill === 1 ? 0 : 1;
        for (let t = -r; t <= r; t++) {
          const nx = horizontal ? x + t : x;
          const ny = horizontal ? y : y + t;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const s = a[ny * w + nx]!;
          if (fill === 1 ? s === 1 : s === 0) {
            v = fill;
            break;
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

type Comp = { id: number; n: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number };

/** 검은 잉크 연결 요소(8방향) */
function labelInk(rgba: Uint8ClampedArray, w: number, h: number): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(w * h);
  const comps: Comp[] = [];
  let ink: Uint8Array = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) if (isInk(rgba, k * 4)) ink[k] = 1;
  /** 다른 색 가는 선이 방위표를 가로질러 끊은 틈을 메움(닫기 연산) */
  ink = morph(morph(ink, w, h, INK_GAP_PX, 1), w, h, INK_GAP_PX, 0);
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || labels[start]) continue;
    const id = comps.length + 1;
    const c: Comp = { id, n: 0, x0: w, y0: h, x1: 0, y1: 0, sx: 0, sy: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const k = stack[--top]!;
      const x = k % w;
      const y = (k - x) / w;
      c.n++;
      c.sx += x;
      c.sy += y;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const nk = ny * w + nx;
          if (ink[nk] && !labels[nk]) {
            labels[nk] = id;
            stack[top++] = nk;
          }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

function binOf(dx: number, dy: number): number {
  const a = Math.atan2(-dy, dx);
  return ((Math.round((a / (2 * Math.PI)) * ANGLE_BINS) % ANGLE_BINS) + ANGLE_BINS) % ANGLE_BINS;
}

/** 별 모양(긴 팔 4개가 90° 간격, 팔 사이가 깊게 패임, 가운데 채움, 90° 돌려도 같은 모양)인지 */
function starShape(
  labels: Int32Array,
  w: number,
  h: number,
  c: Comp,
  debug?: (msg: string) => void
): { cx: number; cy: number; arms: { bin: number; len: number }[]; R: number } | null {
  const fail = (why: string) => {
    debug?.(`  reject ${c.x0},${c.y0} ${c.x1 - c.x0 + 1}x${c.y1 - c.y0 + 1} n=${c.n}: ${why}`);
    return null;
  };
  /** 중심 — 팔이 잘리거나 글자가 붙어도 흔들리지 않게 가운데 뭉친 곳으로 좁혀 간다 */
  let cx = c.sx / c.n;
  let cy = c.sy / c.n;
  const r0 = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) / 2;
  for (const f of [0.5, 0.3, 0.2]) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = Math.max(c.y0, Math.floor(cy - r0 * f)); y <= Math.min(c.y1, Math.ceil(cy + r0 * f)); y++) {
      for (let x = Math.max(c.x0, Math.floor(cx - r0 * f)); x <= Math.min(c.x1, Math.ceil(cx + r0 * f)); x++) {
        if (labels[y * w + x] !== c.id || Math.hypot(x - cx, y - cy) > r0 * f) continue;
        sx += x;
        sy += y;
        n++;
      }
    }
    if (n === 0) break;
    cx = sx / n;
    cy = sy / n;
  }
  const ext = new Float64Array(ANGLE_BINS);
  let core = 0;
  let coreTotal = 0;
  let R = 0;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (labels[y * w + x] !== c.id) continue;
      if (d > R) R = d;
      const b = binOf(dx, dy);
      if (d > ext[b]!) ext[b] = d;
    }
  }
  if (R < 8) return fail('small');
  for (let y = Math.floor(cy - R * 0.08); y <= Math.ceil(cy + R * 0.08); y++) {
    for (let x = Math.floor(cx - R * 0.08); x <= Math.ceil(cx + R * 0.08); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h || Math.hypot(x - cx, y - cy) > R * 0.08) continue;
      coreTotal++;
      if (labels[y * w + x] === c.id) core++;
    }
  }
  if (coreTotal === 0 || core / coreTotal < 0.5) return fail(`core ${core}/${coreTotal}`);

  const q = ANGLE_BINS / 4;
  const sm = (b: number) => Math.max(ext[(b + ANGLE_BINS - 1) % ANGLE_BINS]!, ext[b]!, ext[(b + 1) % ANGLE_BINS]!);
  let bestOff = 0;
  let bestSum = -1;
  for (let off = 0; off < q; off++) {
    const s = sm(off) + sm(off + q) + sm(off + 2 * q) + sm((off + 3 * q) % ANGLE_BINS);
    if (s > bestSum) {
      bestSum = s;
      bestOff = off;
    }
  }
  const arms = [0, 1, 2, 3].map((k) => {
    const bin = (bestOff + k * q) % ANGLE_BINS;
    return { bin, len: sm(bin) };
  });
  /** 방향은 90° 단위로만 정하므로 큰 팔이 가로·세로 축에서 10° 넘게 기울면 제외 */
  if (bestOff > 2 && bestOff < q - 2) return fail(`tilt ${bestOff}`);
  const armMax = Math.max(...arms.map((a) => a.len));
  const armMin = Math.min(...arms.map((a) => a.len));
  /** 남북 팔이 동서 팔보다 훨씬 긴 방위표도 있음 */
  if (armMin < armMax * 0.4) return fail(`arms ${arms.map((a) => a.len.toFixed(1)).join(',')}`);
  const armMean = arms.reduce((s, a) => s + a.len, 0) / 4;
  /** 8방 방위표 — 큰 팔 사이 45° 에 짧은 팔, 그 사이(약 22°)는 깊게 패임 */
  const at = (b: number) => ext[((b % ANGLE_BINS) + ANGLE_BINS) % ANGLE_BINS]!;
  for (const a of arms) {
    const d = a.bin + q / 2;
    const diag = Math.max(at(d - 2), at(d - 1), at(d), at(d + 1), at(d + 2));
    if (diag < armMean * 0.25 || diag > armMean * 0.9) return fail(`diag ${diag.toFixed(1)}/${armMean.toFixed(1)}`);
    const valley = Math.min(
      Math.min(at(a.bin + 4), at(a.bin + 5)),
      Math.min(at(a.bin + q - 4), at(a.bin + q - 5))
    );
    if (valley > diag * 0.75) return fail(`valley ${valley.toFixed(1)}/${diag.toFixed(1)}`);
  }

  /** 90° 돌려도 같은 모양 */
  let hit = 0;
  let tot = 0;
  for (let y = c.y0; y <= c.y1; y += 1) {
    for (let x = c.x0; x <= c.x1; x += 1) {
      if (labels[y * w + x] !== c.id) continue;
      tot++;
      const rx = Math.round(cx - (y - cy));
      const ry = Math.round(cy + (x - cx));
      let ok = false;
      for (let dy = -1; dy <= 1 && !ok; dy++) {
        for (let dx = -1; dx <= 1 && !ok; dx++) {
          const nx = rx + dx;
          const ny = ry + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && labels[ny * w + nx] === c.id) ok = true;
        }
      }
      if (ok) hit++;
    }
  }
  if (tot === 0 || hit / tot < 0.5) return fail(`sym ${(hit / Math.max(1, tot)).toFixed(2)}`);
  return { cx, cy, arms, R };
}

/** N 글자 잉크량(별 반지름² 대비) 최소값과, 다른 팔보다 몇 배 많아야 하는지 */
const NORTH_LETTER_MIN = 0.01;
const NORTH_LETTER_DOMINANCE = 2.5;

function isLetterInk(rgba: Uint8ClampedArray, i: number): boolean {
  const r = rgba[i]!;
  const g = rgba[i + 1]!;
  const b = rgba[i + 2]!;
  const mx = Math.max(r, g, b);
  return mx < 170 && mx - Math.min(r, g, b) < 60;
}

/**
 * 팔마다 끝 근처의 «반대편에 짝이 없는» 잉크량(별 반지름² 대비).
 * 방위표는 중심 대칭이고 N 글자만 한쪽에 있으므로, 글자가 떨어져 있든 팔 끝에 붙어 있든 그 팔만 커진다.
 */
function armAsymmetry(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  star: { cx: number; cy: number; arms: { bin: number; len: number }[]; R: number }
): number[] {
  const { cx, cy, R } = star;
  /** 반대편 짝 — 다른 색 선이 팔을 가로질러 끊긴 자리도 짝으로 본다 */
  const drawn = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = xi + dx;
        const ny = yi + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const i = (ny * w + nx) * 4;
        if (Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) < 215) return true;
      }
    }
    return false;
  };
  const inner = (10 * Math.PI) / 180;
  const outer = (22 * Math.PI) / 180;
  return star.arms.map((a, k) => {
    const opp = star.arms[(k + 2) % 4]!;
    const len = Math.max(a.len, opp.len);
    const theta = (a.bin / ANGLE_BINS) * 2 * Math.PI;
    const rMin = len * 0.6;
    const rMax = len + R * 0.6;
    let onAxis = 0;
    let beside = 0;
    const x0 = Math.max(0, Math.floor(cx - rMax));
    const x1 = Math.min(w - 1, Math.ceil(cx + rMax));
    const y0 = Math.max(0, Math.floor(cy - rMax));
    const y1 = Math.min(h - 1, Math.ceil(cy + rMax));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < rMin || d > rMax) continue;
        const turn = 2 * Math.PI;
        let diff = (((Math.atan2(-dy, dx) - theta) % turn) + turn) % turn;
        if (diff > Math.PI) diff = turn - diff;
        if (diff > outer) continue;
        if (!isLetterInk(rgba, (y * w + x) * 4)) continue;
        if (drawn(2 * cx - x, 2 * cy - y)) continue;
        if (diff <= inner) onAxis++;
        else beside++;
      }
    }
    /** N 글자는 팔 축에 좁게 모여 있고, 글자열·선은 옆으로 퍼진다 */
    return Math.max(0, onAxis - beside) / (R * R);
  });
}

/**
 * N 글자(상자)가 팔 끝에 붙어 한 덩어리가 된 경우 — 그 팔만 반대편보다 뚜렷이 길고, 다른 두 팔은 서로 같다.
 */
function attachedLetterArm(star: { arms: { bin: number; len: number }[]; R: number }): number | null {
  const excess = star.arms.map((a, k) => (a.len - star.arms[(k + 2) % 4]!.len) / star.R);
  const k = excess.indexOf(Math.max(...excess));
  const cross = Math.abs(excess[(k + 1) % 4]!);
  return excess[k]! >= 0.12 && cross <= 0.05 ? k : null;
}

/**
 * 도면(회전 0 렌더)에서 방위표를 찾아 N 쪽 팔 방향을 돌려준다.
 * 별 모양 방위표의 네 긴 팔 중, 끝 근처에 반대편 짝이 없는 잉크(N 글자)가 뚜렷이 많은 팔을 북쪽으로 본다.
 * 도면에 글자로 들어 있는 «N» 위치(렌더 픽셀)를 주면, 팔 끝 근처에 그 글자가 있는 팔을 먼저 북쪽으로 본다.
 * 방위표가 없거나 N 쪽이 하나로 정해지지 않으면 null.
 */
export function detectNorthArrow(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  opts: { letterPoints?: Pt[]; debug?: (msg: string) => void } = {}
): NorthArrow | null {
  const { letterPoints = [], debug } = opts;
  const L = Math.max(w, h);
  const { labels, comps } = labelInk(rgba, w, h);
  let best: (NorthArrow & { quality: number }) | null = null;
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    const size = Math.max(bw, bh);
    if (size < L * 0.024 || size > L * 0.15) continue;
    if (Math.max(bw, bh) / Math.min(bw, bh) > 2.2) continue;
    const star = starShape(labels, w, h, c, debug);
    if (!star) continue;
    debug?.(`star at ${star.cx.toFixed(0)},${star.cy.toFixed(0)} R=${star.R.toFixed(1)} arms=${star.arms.map((a) => `${a.bin}:${a.len.toFixed(1)}`).join(' ')}`);

    /** 글자 «N» 이 팔 끝 근처에 있는 팔 */
    const textArms = new Set<number>();
    for (const [px, py] of letterPoints) {
      const dx = px - star.cx;
      const dy = py - star.cy;
      const d = Math.hypot(dx, dy);
      const b = binOf(dx, dy);
      star.arms.forEach((a, k) => {
        const diff = Math.min(Math.abs(b - a.bin), ANGLE_BINS - Math.abs(b - a.bin));
        if (diff <= 3 && d >= a.len * 0.5 && d <= a.len + star.R * 0.8) textArms.add(k);
      });
    }
    let northArm: number | null = textArms.size === 1 ? [...textArms][0]! : null;
    if (northArm == null) {
      const asym = armAsymmetry(rgba, w, h, star);
      const order = asym.map((v, k) => ({ v, k })).sort((a, b) => b.v - a.v);
      debug?.(`  asym ${asym.map((v) => v.toFixed(4)).join(' ')}`);
      const top = order[0]!;
      const second = order[1]!;
      if (top.v >= NORTH_LETTER_MIN && top.v >= second.v * NORTH_LETTER_DOMINANCE) northArm = top.k;
      else northArm = attachedLetterArm(star);
    } else {
      debug?.(`  text N arm ${northArm}`);
    }
    if (northArm == null) continue;
    const arm = star.arms[northArm]!;
    const angle = (arm.bin / ANGLE_BINS) * 360;
    /** 작은 별 모양 기호보다 큰 방위표를 우선 */
    const quality = star.R;
    if (!best || quality > best.quality) {
      best = {
        rotation: normalizeRotation(angle - 90),
        angle,
        cx: star.cx / w,
        cy: star.cy / h,
        r: star.R / L,
        quality,
      };
    }
  }
  if (!best) return null;
  const { quality: _q, ...out } = best;
  void _q;
  return out;
}

export type RiverIndexOrientationMethod = 'north' | 'shape' | 'weak' | 'pdf' | 'none';

export type RiverIndexOrientationDecision = {
  rotation: RiverIndexRotation;
  method: RiverIndexOrientationMethod;
  score: number;
  second: number;
  confidence: number;
  waterRatio: number;
  riverRatio: number;
};

/** 확신도(1등−2등)가 이 미만이면 «검토 필요» */
export const RIVER_INDEX_CONFIDENCE_MIN = 0.06;

function normalizeRotation(deg: number): RiverIndexRotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return (r === 90 || r === 180 || r === 270 ? r : 0) as RiverIndexRotation;
}

/**
 * 점수 → 방향 결정.
 * - shape: 하천 모양 비교로 뚜렷이 결정
 * - weak: 비교는 했지만 애매 — 파일 회전값이 상위 둘 안이면 그 값, 아니면 1등
 * - pdf / none: 비교할 하천·수면이 부족 — 파일 회전값(칸 비율과 맞으면) 사용
 */
export function decideRotation(
  scores: RiverIndexRotationScore[],
  pageRotate: number,
  water: BinaryGrid,
  ref: BinaryGrid
): RiverIndexOrientationDecision {
  const waterRatio = fillRatio(water);
  const riverRatio = fillRatio(ref);
  const fileRot = normalizeRotation(pageRotate);
  const valid = scores.filter((s) => s.score >= 0).sort((a, b) => b.score - a.score);
  const fileValid = valid.some((s) => s.rotation === fileRot);
  const fallback: RiverIndexRotation = fileValid ? fileRot : (valid[0]?.rotation ?? fileRot);

  if (riverRatio < 0.01 || waterRatio < 0.003 || valid.length === 0) {
    return {
      rotation: fallback,
      method: fileValid ? 'pdf' : 'none',
      score: 0,
      second: 0,
      confidence: 0,
      waterRatio,
      riverRatio,
    };
  }
  const best = valid[0]!;
  const second = valid[1]?.score ?? 0;
  const confidence = best.score - Math.max(0, second);
  if (best.score >= 0.2 && confidence >= RIVER_INDEX_CONFIDENCE_MIN) {
    return { rotation: best.rotation, method: 'shape', score: best.score, second, confidence, waterRatio, riverRatio };
  }
  const topTwo = valid.slice(0, 2).map((s) => s.rotation);
  return {
    rotation: topTwo.includes(fileRot) ? fileRot : best.rotation,
    method: 'weak',
    score: best.score,
    second,
    confidence,
    waterRatio,
    riverRatio,
  };
}
