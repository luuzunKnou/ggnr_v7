/**
 * 편측(C) 겹침 표시.
 * - 긴(이어지는) 구간 = 중심선 그대로 (안 겹치는 부분도 선 따라 유지)
 * - 짧은 겹침 = 꺾임 반대측 오프셋 (우꺾→짧은 쪽 좌, 좌꺾→짧은 쪽 우)
 * 구간을 잘라 여러 피처로 나누지 않음
 */
import { fromLonLat, toLonLat } from "ol/proj";
import {
  BIKE_ROAD_DUAL_OFFSET_M,
  dualOffsetLines3857,
  offsetLine3857,
} from "./bikeRoadLineOffset";
import type { BikeRoadSegment, BikeRoadSegmentSide } from "./bikeRoadMock";
import type { Pt } from "./bikeRoadRoadNet";

const OVERLAP_TOL_M = 12;
const SAMPLE_STEP_M = 5;
const MIN_OVERLAP_M = 28;
const CLOSE_GAP_SAMPLES = 3;
/** 길이 차이(m) — 이보다 짧으면 «짧은 쪽»으로 옆으로 */
const LEN_EPS_M = 15;

export type DisplayLine = {
  segmentId: string;
  side: BikeRoadSegmentSide;
  coords: [number, number][];
};

function toLonLatCoords(coords: Pt[]): [number, number][] {
  return coords.map((c) => {
    const ll = toLonLat(c);
    return [ll[0]!, ll[1]!] as [number, number];
  });
}

function to3857Coords(coords: [number, number][]): Pt[] {
  return coords.map((c) => {
    const p = fromLonLat(c);
    return [p[0]!, p[1]!] as Pt;
  });
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + dx * t, a[1] + dy * t]);
}

function distToPolyline(p: Pt, line: Pt[]): number {
  if (line.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, distToSeg(p, line[i]!, line[i + 1]!));
  }
  return best;
}

function nearestSegDir(p: Pt, line: Pt[]): Pt | null {
  if (line.length < 2) return null;
  let best = Infinity;
  let dir: Pt | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const d = distToSeg(p, a, b);
    if (d < best) {
      best = d;
      const len = dist(a, b);
      if (len > 1e-6) dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    }
  }
  return dir;
}

function sampleAlong(line: Pt[], stepM: number): { p: Pt; along: number }[] {
  if (line.length < 2) return [];
  const out: { p: Pt; along: number }[] = [];
  let along = 0;
  out.push({ p: [line[0]![0], line[0]![1]], along: 0 });
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const segLen = dist(a, b);
    if (segLen < 1e-6) continue;
    let d = stepM;
    while (d < segLen - 0.5) {
      const t = d / segLen;
      out.push({
        p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        along: along + d,
      });
      d += stepM;
    }
    along += segLen;
    out.push({ p: [b[0], b[1]], along });
  }
  return out;
}

function lineLength(line: Pt[]): number {
  let n = 0;
  for (let i = 0; i < line.length - 1; i++) n += dist(line[i]!, line[i + 1]!);
  return n;
}

function closeMaskGaps(mask: boolean[], maxGap: number): boolean[] {
  const out = mask.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < out.length && !out[i]) i++;
    const gap = i - start;
    const left = start > 0 && out[start - 1];
    const right = i < out.length && out[i];
    if (left && right && gap > 0 && gap <= maxGap) {
      for (let k = start; k < i; k++) out[k] = true;
    }
  }
  return out;
}

function overlapLengthM(lineA: Pt[], lineB: Pt[]): number {
  const samples = sampleAlong(lineA, SAMPLE_STEP_M);
  if (samples.length === 0) return 0;
  let mask = samples.map((s, k) => {
    const p = s.p;
    if (distToPolyline(p, lineB) > OVERLAP_TOL_M) return false;
    const nearEnd =
      s.along < 12 || s.along > samples[samples.length - 1]!.along - 12;
    if (nearEnd && dist(p, lineB[0]!) < 16) return false;
    if (nearEnd && dist(p, lineB[lineB.length - 1]!) < 16) return false;
    const dirA =
      k > 0
        ? ([
            samples[k]!.p[0] - samples[k - 1]!.p[0],
            samples[k]!.p[1] - samples[k - 1]!.p[1],
          ] as Pt)
        : k < samples.length - 1
          ? ([
              samples[k + 1]!.p[0] - samples[k]!.p[0],
              samples[k + 1]!.p[1] - samples[k]!.p[1],
            ] as Pt)
          : null;
    const dirB = nearestSegDir(p, lineB);
    if (dirA && dirB) {
      const la = Math.hypot(dirA[0], dirA[1]) || 1;
      const dot = Math.abs(
        (dirA[0] / la) * dirB[0] + (dirA[1] / la) * dirB[1]
      );
      if (dot < 0.72) return false;
    }
    return true;
  });
  mask = closeMaskGaps(mask, CLOSE_GAP_SAMPLES);
  let best = 0;
  let i = 0;
  while (i < mask.length) {
    if (!mask[i]) {
      i++;
      continue;
    }
    const start = samples[i]!.along;
    let j = i + 1;
    while (j < mask.length && mask[j]) j++;
    const end = samples[j - 1]!.along;
    best = Math.max(best, end - start);
    i = j;
  }
  return best;
}

/** id 순 폴백 — 앞=우측, 뒤=좌측 */
function sideForPair(selfId: string, partnerId: string): "R" | "L" {
  return selfId <= partnerId ? "R" : "L";
}

/**
 * 진행방향 꺾임 합(rad). 3857(y북) 기준
 * >0 좌회전, <0 우회전
 */
function turnSumRad(line: Pt[]): number {
  let sum = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const c = line[i + 1]!;
    const ax = b[0] - a[0];
    const ay = b[1] - a[1];
    const bx = c[0] - b[0];
    const by = c[1] - b[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1.5 || lb < 1.5) continue;
    const ang = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    if (Math.abs(ang) < 0.1) continue;
    sum += ang;
  }
  return sum;
}

/**
 * 이어지는(긴) 구간의 꺾임 → 연결할 측.
 * 우측 꺾임 → 우측(R), 좌측 꺾임 → 좌측(L).
 */
function continuingSideFromTurn(longer: Pt[]): "R" | "L" | null {
  const s = turnSumRad(longer);
  if (Math.abs(s) < 0.25) return null;
  return s > 0 ? "L" : "R";
}

function oppositeSide(side: "R" | "L"): "R" | "L" {
  return side === "R" ? "L" : "R";
}

function offsetForSide(center: Pt[], side: "R" | "L"): Pt[] {
  const m = BIKE_ROAD_DUAL_OFFSET_M;
  return offsetLine3857(center, side === "R" ? -m : m);
}

function centerOf(seg: BikeRoadSegment): Pt[] | null {
  const c = seg.centerLineCoords ?? seg.lineCoords;
  if (!c || c.length < 2) return null;
  return to3857Coords(c);
}

/**
 * 표시용 라인 — 구간당 연속 1줄.
 * 긴 쪽: 중심선 그대로(안 겹침도 선 유지). 짧은 겹침만 꺾임 기준 옆으로.
 */
export function collectDisplayLines(segments: BikeRoadSegment[]): DisplayLine[] {
  const out: DisplayLine[] = [];
  const dualSegs = segments.filter((s) => s.side === "R" || s.side === "L");
  const centerSegs = segments.filter((s) => (s.side ?? "C") === "C");

  for (const s of dualSegs) {
    const center = s.centerLineCoords;
    if (center && center.length >= 2) {
      const path3857 = to3857Coords(center);
      const { right, left } = dualOffsetLines3857(path3857);
      out.push({
        segmentId: s.id,
        side: s.side!,
        coords: toLonLatCoords(s.side === "R" ? right : left),
      });
    } else if ((s.lineCoords?.length ?? 0) >= 2) {
      out.push({ segmentId: s.id, side: s.side!, coords: s.lineCoords! });
    }
  }

  if (centerSegs.length === 0) return out;

  const centers = centerSegs
    .map((s) => ({ seg: s, line: centerOf(s) }))
    .filter((x): x is { seg: BikeRoadSegment; line: Pt[] } => x.line != null);

  const pairContinue = new Map<string, "R" | "L">();

  function pairKey(idA: string, idB: string): string {
    return [idA, idB].sort().join("|");
  }

  /** 짧은 쪽을 둘 측 — 긴 구간 꺾임 반대 (우꺾→짧은=L, 좌꺾→짧은=R) */
  function shortSideFor(
    longer: { seg: BikeRoadSegment; line: Pt[] },
    shorterId: string
  ): "R" | "L" {
    const key = pairKey(longer.seg.id, shorterId);
    const cached = pairContinue.get(key);
    if (cached) return oppositeSide(cached);
    const cont =
      continuingSideFromTurn(longer.line) ??
      sideForPair(longer.seg.id, shorterId);
    pairContinue.set(key, cont);
    return oppositeSide(cont);
  }

  for (let i = 0; i < centers.length; i++) {
    const a = centers[i]!;
    const aLen = lineLength(a.line);

    type Partner = {
      id: string;
      len: number;
      overlapM: number;
      line: Pt[];
    };
    const partners: Partner[] = [];
    for (let j = 0; j < centers.length; j++) {
      if (i === j) continue;
      const b = centers[j]!;
      const ov = overlapLengthM(a.line, b.line);
      if (ov < MIN_OVERLAP_M) continue;
      partners.push({
        id: b.seg.id,
        len: lineLength(b.line),
        overlapM: ov,
        line: b.line,
      });
    }

    if (partners.length === 0) {
      out.push({
        segmentId: a.seg.id,
        side: "C",
        coords: toLonLatCoords(a.line),
      });
      continue;
    }

    partners.sort((x, y) => y.overlapM - x.overlapM);
    const main = partners[0]!;

    if (aLen + LEN_EPS_M < main.len) {
      // 짧은 겹침만 옆 — 긴 쪽 꺾임 반대
      const longer = centers.find((c) => c.seg.id === main.id)!;
      const side = shortSideFor(longer, a.seg.id);
      const offset = offsetForSide(a.line, side);
      out.push({
        segmentId: a.seg.id,
        side,
        coords: toLonLatCoords(offset.length >= 2 ? offset : a.line),
      });
    } else if (main.len + LEN_EPS_M < aLen) {
      // 긴·이어지는 쪽 — 중심선 그대로 (안 겹치는 구간도 선 따라)
      continueSideForCache(a, main.id);
      out.push({
        segmentId: a.seg.id,
        side: "C",
        coords: toLonLatCoords(a.line),
      });
    } else {
      // 길이 비슷 — 둘 다 좌·우 (꺾임 기준), 각각 전체 한 줄
      const key = pairKey(a.seg.id, main.id);
      let cont = pairContinue.get(key);
      if (!cont) {
        const longerLine = aLen >= main.len ? a.line : main.line;
        cont =
          continuingSideFromTurn(longerLine) ??
          sideForPair(a.seg.id, main.id);
        pairContinue.set(key, cont);
      }
      const side =
        a.seg.id <= main.id ? cont : oppositeSide(cont);
      const offset = offsetForSide(a.line, side);
      out.push({
        segmentId: a.seg.id,
        side,
        coords: toLonLatCoords(offset.length >= 2 ? offset : a.line),
      });
    }
  }

  function continueSideForCache(
    longer: { seg: BikeRoadSegment; line: Pt[] },
    shorterId: string
  ): void {
    const key = pairKey(longer.seg.id, shorterId);
    if (pairContinue.has(key)) return;
    const cont =
      continuingSideFromTurn(longer.line) ??
      sideForPair(longer.seg.id, shorterId);
    pairContinue.set(key, cont);
  }

  return out;
}

/** 노선 총 연장 — 양측 L 은 제외(R과 중복) */
export function sumBikeRoadLengthKm(segments: BikeRoadSegment[]): string {
  let sum = 0;
  for (const s of segments) {
    if (s.side === "L") continue;
    const n = parseFloat(String(s.totalLength ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isNaN(n) && n > 0) sum += n;
  }
  if (sum <= 0) return "";
  return String(Math.round(sum * 100) / 100);
}
