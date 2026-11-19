/**
 * 중심선 → 좌/우 평행 오프셋 (EPSG:3857 미터 근사).
 * 끊긴 모서리 앞부분(대각 이음)은 버리고, 양쪽 팔을 일직선 연장해 만난 점으로 붙임.
 * 좌·우 동일.
 */

import type { Pt } from "./bikeRoadRoadNet";

/** 양측 평행선 기본 반폭 (m) — 좌·우가 떨어져 보이게 */
export const BIKE_ROAD_DUAL_OFFSET_M = 6.5;

/**
 * miter 길이 상한 = |offset| × 이 값.
 * 직각(≈1.41)은 유지, 그보다 길면 같은 방향으로만 자름.
 */
const MITER_LIMIT = 1.5;
/** 오프셋 전 너무 가까운 정점 병합 (m) */
const MIN_VERTEX_M = 1.2;
/** 거의 일직선이면 중간점 제거 */
const COLLINEAR_SIN = 0.04;
/**
 * 끊긴 모서리 «앞부분» 최대 길이 (m).
 * 사거리 짧은 이음만 — 길면 실제 도로를 따라간 것으로 보고 유지.
 */
const MAX_CORNER_CUT_M = 32;
/** 연장할 양쪽 팔 최소 길이 (m) */
const MIN_ARM_M = 6;
/**
 * 오프셋 결과에서 «뾰족한 삼각형» 판정:
 * 중간점이 현(AC)에서 이 배수×|offset| 이상 튀면 제거
 */
const SPIKE_CHORD_FACTOR = 0.85;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function perpUnit(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [0, 0];
  return [-dy / len, dx / len];
}

/** 두 직선의 교차 (선분 연장). 평행이면 null */
function lineIntersect(a0: Pt, a1: Pt, b0: Pt, b1: Pt): Pt | null {
  const ax = a1[0] - a0[0];
  const ay = a1[1] - a0[1];
  const bx = b1[0] - b0[0];
  const by = b1[1] - b0[1];
  const den = ax * by - ay * bx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b0[0] - a0[0]) * by - (b0[1] - a0[1]) * bx) / den;
  return [a0[0] + t * ax, a0[1] + t * ay];
}

/** 점 P → 선분 AB 수선 발 거리 */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + dx * t, a[1] + dy * t]);
}

/** 미세 꺾임·중복·짧은 되접힘 제거 — 오프셋 전 중심선 정리 */
export function simplifyPolyline3857(coords: Pt[], minDistM = MIN_VERTEX_M): Pt[] {
  if (coords.length < 3) return coords.map((c) => [c[0], c[1]] as Pt);

  const merged: Pt[] = [[coords[0]![0], coords[0]![1]]];
  for (let i = 1; i < coords.length - 1; i++) {
    const p = coords[i]!;
    const last = merged[merged.length - 1]!;
    if (dist(last, p) >= minDistM) merged.push([p[0], p[1]]);
  }
  {
    const end = coords[coords.length - 1]!;
    const last = merged[merged.length - 1]!;
    if (dist(last, end) < minDistM && merged.length > 1) {
      merged[merged.length - 1] = [end[0], end[1]];
    } else {
      merged.push([end[0], end[1]]);
    }
  }

  if (merged.length < 3) return merged;

  const out: Pt[] = [[merged[0]![0], merged[0]![1]]];
  for (let i = 1; i < merged.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = merged[i]!;
    const next = merged[i + 1]!;
    const d01 = dist(prev, cur);
    const d12 = dist(cur, next);
    const d02 = dist(prev, next);
    if (d01 < 1e-6 || d12 < 1e-6) continue;

    const ax = (cur[0] - prev[0]) / d01;
    const ay = (cur[1] - prev[1]) / d01;
    const bx = (next[0] - cur[0]) / d12;
    const by = (next[1] - cur[1]) / d12;
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;

    // 일직선 전진 — 중간점 불필요
    if (Math.abs(cross) < COLLINEAR_SIN && dot > 0.97) continue;
    // 짧게 나갔다 꺾임(오프셋 바늘의 원인) — 제거
    if (d02 <= 16 && d01 + d12 > d02 * 1.2 + 1) continue;
    // 되접힘
    if (dot < -0.25 && Math.min(d01, d12) <= 16) continue;

    out.push([cur[0], cur[1]]);
  }
  out.push([merged[merged.length - 1]![0], merged[merged.length - 1]![1]]);
  return out.length >= 2 ? out : coords.map((c) => [c[0], c[1]] as Pt);
}

/**
 * 끊긴 모서리 앞부분(B→C 대각·이음)을 버리고
 * 양쪽 팔(A→B, C→D)을 일직선으로 더 나가 만난 점으로 대체.
 * 도로를 따라 그리다 끊긴 끝을 그대로 이으면 생기는 대각선을 없앰.
 */
export function extendArmsCollapseCuts(coords: Pt[]): Pt[] {
  if (coords.length < 4) return coords.map((c) => [c[0], c[1]] as Pt);

  let cur = coords.map((c) => [c[0], c[1]] as Pt);
  for (let pass = 0; pass < 6; pass++) {
    if (cur.length < 4) break;
    const out: Pt[] = [[cur[0]![0], cur[0]![1]]];
    let i = 1;
    let changed = false;

    while (i < cur.length - 2) {
      const a = out[out.length - 1]!;
      const b = cur[i]!;
      const c = cur[i + 1]!;
      const d = cur[i + 2]!;
      const ab = dist(a, b);
      const bc = dist(b, c);
      const cd = dist(c, d);

      const ax = b[0] - a[0];
      const ay = b[1] - a[1];
      const cx = d[0] - c[0];
      const cy = d[1] - c[1];
      const al = Math.hypot(ax, ay);
      const cl = Math.hypot(cx, cy);

      let turnOk = false;
      if (al > 1e-6 && cl > 1e-6) {
        const ang = Math.atan2(ax * cy - ay * cx, ax * cx + ay * cy);
        const abs = Math.abs(ang);
        turnOk = abs > 0.35 && abs < 2.95;
      }

      if (
        turnOk &&
        bc <= MAX_CORNER_CUT_M &&
        ab >= MIN_ARM_M &&
        cd >= MIN_ARM_M
      ) {
        const hit = lineIntersect(a, b, c, d);
        if (hit) {
          // B 앞으로 연장, C는 두 번째 팔의 뒤쪽(모서리 쪽)으로 연장
          const pastB =
            (hit[0] - b[0]) * ax + (hit[1] - b[1]) * ay > 0;
          const pastC =
            (hit[0] - c[0]) * (c[0] - d[0]) +
              (hit[1] - c[1]) * (c[1] - d[1]) >
            0;
          const extB = dist(hit, b);
          const extC = dist(hit, c);
          const lim = MAX_CORNER_CUT_M + 20;
          if (pastB && pastC && extB <= lim && extC <= lim) {
            const last = out[out.length - 1]!;
            if (dist(last, hit) >= 0.4) out.push(hit);
            else {
              out[out.length - 1] = hit;
            }
            i += 2; // B·C(앞부분) 버림, D부터 이어서
            changed = true;
            continue;
          }
        }
      }

      out.push([b[0], b[1]]);
      i += 1;
    }

    while (i < cur.length) {
      const p = cur[i]!;
      const last = out[out.length - 1]!;
      if (dist(last, p) >= 0.4) out.push([p[0], p[1]]);
      else out[out.length - 1] = [p[0], p[1]];
      i += 1;
    }

    cur = out.length >= 2 ? out : cur;
    if (!changed) break;
  }
  return cur;
}

/**
 * 오프셋 후 남은 삼각형·바늘 꼭짓점 제거.
 * 좌·우 동일 규칙 — 중간점이 현에서 크게 튀고 각이 예각이면 삭제.
 */
function stripOffsetSpikes(coords: Pt[], offsetAbs: number): Pt[] {
  if (coords.length < 3 || offsetAbs < 1e-6) return coords;
  const lim = offsetAbs * SPIKE_CHORD_FACTOR;
  let cur = coords.map((c) => [c[0], c[1]] as Pt);
  for (let pass = 0; pass < 4; pass++) {
    if (cur.length < 3) break;
    const next: Pt[] = [[cur[0]![0], cur[0]![1]]];
    let removed = false;
    for (let i = 1; i < cur.length - 1; i++) {
      const a = next[next.length - 1]!;
      const b = cur[i]!;
      const c = cur[i + 1]!;
      const dAb = dist(a, b);
      const dBc = dist(b, c);
      const dAc = dist(a, c);
      if (dAb < 1e-6 || dBc < 1e-6) {
        removed = true;
        continue;
      }
      const ax = (b[0] - a[0]) / dAb;
      const ay = (b[1] - a[1]) / dAb;
      const bx = (c[0] - b[0]) / dBc;
      const by = (c[1] - b[1]) / dBc;
      const dot = ax * bx + ay * by;
      const chordH = distToSegment(b, a, c);
      // 짧은 다리만 바늘 — 긴 팔의 정상 직각 모서리는 유지
      const shortLeg = Math.min(dAb, dBc) <= offsetAbs * 3.2;
      if (
        shortLeg &&
        dot < 0.15 &&
        chordH > lim &&
        dAc < Math.max(dAb, dBc) * 2.5
      ) {
        removed = true;
        continue;
      }
      if (
        shortLeg &&
        dAc <= offsetAbs * 2.2 &&
        dAb + dBc > dAc * 1.15 + 0.5 &&
        chordH > lim * 0.55
      ) {
        removed = true;
        continue;
      }
      next.push([b[0], b[1]]);
    }
    next.push([cur[cur.length - 1]![0], cur[cur.length - 1]![1]]);
    cur = next.length >= 2 ? next : cur;
    if (!removed) break;
  }
  return cur;
}

/**
 * 모서리 한 점 — 두 오프셋 직선 교차(miter)로 일자 L.
 * 교차가 길면 같은 방향으로만 잘라 붙임(miter-clip).
 * a1–b0를 이으면 바깥 모서리가 블록을 가로지르는 대각선이 되므로 쓰지 않음.
 */
function appendCornerOffset(
  out: Pt[],
  prev: Pt,
  cur: Pt,
  next: Pt,
  offsetM: number,
  maxMiter: number
): void {
  const [nx0, ny0] = perpUnit(cur[0] - prev[0], cur[1] - prev[1]);
  const [nx1, ny1] = perpUnit(next[0] - cur[0], next[1] - cur[1]);

  const a0: Pt = [prev[0] + nx0 * offsetM, prev[1] + ny0 * offsetM];
  const a1: Pt = [cur[0] + nx0 * offsetM, cur[1] + ny0 * offsetM];
  const b0: Pt = [cur[0] + nx1 * offsetM, cur[1] + ny1 * offsetM];
  const b1: Pt = [next[0] + nx1 * offsetM, next[1] + ny1 * offsetM];

  // 이등분선은 «오프셋된» 법선 합 — 좌/우(부호) 모두 같은 쪽을 가리킴
  const bisX = nx0 * offsetM + nx1 * offsetM;
  const bisY = ny0 * offsetM + ny1 * offsetM;
  const bisLen = Math.hypot(bisX, bisY);

  const hit = lineIntersect(a0, a1, b0, b1);
  if (hit && bisLen > 1e-9) {
    const d = dist(hit, cur);
    if (d > 1e-6) {
      const ux = (hit[0] - cur[0]) / d;
      const uy = (hit[1] - cur[1]) / d;
      const align = (ux * bisX + uy * bisY) / bisLen;
      if (align > 0.25) {
        if (d <= maxMiter + 0.5) {
          out.push(hit);
          return;
        }
        out.push([cur[0] + ux * maxMiter, cur[1] + uy * maxMiter]);
        return;
      }
    }
  }

  // 폴백: 오프셋 이등분선 위 한 점 (대각선 이음 없음)
  if (bisLen > 1e-9) {
    const scale = Math.abs(offsetM) / bisLen;
    out.push([cur[0] + bisX * scale, cur[1] + bisY * scale]);
  } else {
    out.push([(a1[0] + b0[0]) / 2, (a1[1] + b0[1]) / 2]);
  }
}

/** 오프셋 전 중심선 정리 — 짧은 점 병합 + 끊긴 모서리 앞부분 제거·팔 연장 */
export function prepareCenterForOffset(coords: Pt[]): Pt[] {
  return extendArmsCollapseCuts(simplifyPolyline3857(coords));
}

/**
 * 폴리라인 평행 오프셋 (양수 = 진행방향 왼쪽).
 * 모서리는 팔 연장 교차(miter). 끊긴 앞부분은 prepare에서 이미 버림.
 */
export function offsetLine3857(coords: Pt[], offsetM: number): Pt[] {
  const src = prepareCenterForOffset(coords);
  if (src.length < 2) return src.map((c) => [c[0], c[1]] as Pt);
  if (Math.abs(offsetM) < 1e-9) return src.map((c) => [c[0], c[1]] as Pt);

  if (src.length === 2) {
    const a = src[0]!;
    const b = src[1]!;
    const [nx, ny] = perpUnit(b[0] - a[0], b[1] - a[1]);
    return [
      [a[0] + nx * offsetM, a[1] + ny * offsetM],
      [b[0] + nx * offsetM, b[1] + ny * offsetM],
    ];
  }

  const out: Pt[] = [];
  const maxMiter = Math.abs(offsetM) * MITER_LIMIT;

  for (let i = 0; i < src.length; i++) {
    const cur = src[i]!;
    if (i === 0) {
      const next = src[1]!;
      const [nx, ny] = perpUnit(next[0] - cur[0], next[1] - cur[1]);
      out.push([cur[0] + nx * offsetM, cur[1] + ny * offsetM]);
      continue;
    }
    if (i === src.length - 1) {
      const prev = src[i - 1]!;
      const [nx, ny] = perpUnit(cur[0] - prev[0], cur[1] - prev[1]);
      out.push([cur[0] + nx * offsetM, cur[1] + ny * offsetM]);
      continue;
    }

    appendCornerOffset(out, src[i - 1]!, cur, src[i + 1]!, offsetM, maxMiter);
  }
  return stripOffsetSpikes(out, Math.abs(offsetM));
}

/** 양측: 진행방향 기준 오른쪽(+R)·왼쪽(+L) 오프셋 */
export function dualOffsetLines3857(
  center: Pt[],
  offsetM = BIKE_ROAD_DUAL_OFFSET_M
): { right: Pt[]; left: Pt[] } {
  const cleaned = prepareCenterForOffset(center);
  return {
    right: offsetLine3857(cleaned, -offsetM),
    left: offsetLine3857(cleaned, offsetM),
  };
}
