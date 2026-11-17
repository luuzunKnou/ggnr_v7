/**
 * 중심선 → 좌/우 평행 오프셋 (EPSG:3857 미터 근사).
 * 1차: 고정 오프셋 거리.
 */

import type { Pt } from "./bikeRoadRoadNet";

/** 양측 평행선 기본 반폭 (m) — 도로 가장자리 느낌 */
export const BIKE_ROAD_DUAL_OFFSET_M = 4.5;

function perpUnit(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [0, 0];
  return [-dy / len, dx / len];
}

/** 폴리라인 각 정점을 법선 방향으로 offsetM 이동 (양수 = 진행방향 왼쪽) */
export function offsetLine3857(coords: Pt[], offsetM: number): Pt[] {
  if (coords.length < 2) return coords.map((c) => [...c] as Pt);
  const out: Pt[] = [];
  for (let i = 0; i < coords.length; i++) {
    const prev = coords[Math.max(0, i - 1)]!;
    const next = coords[Math.min(coords.length - 1, i + 1)]!;
    const cur = coords[i]!;
    let dx: number;
    let dy: number;
    if (i === 0) {
      dx = next[0] - cur[0];
      dy = next[1] - cur[1];
    } else if (i === coords.length - 1) {
      dx = cur[0] - prev[0];
      dy = cur[1] - prev[1];
    } else {
      dx = next[0] - prev[0];
      dy = next[1] - prev[1];
    }
    const [nx, ny] = perpUnit(dx, dy);
    out.push([cur[0] + nx * offsetM, cur[1] + ny * offsetM]);
  }
  return out;
}

/** 양측: 진행방향 기준 오른쪽(+R)·왼쪽(+L) 오프셋 */
export function dualOffsetLines3857(
  center: Pt[],
  offsetM = BIKE_ROAD_DUAL_OFFSET_M
): { right: Pt[]; left: Pt[] } {
  return {
    right: offsetLine3857(center, -offsetM),
    left: offsetLine3857(center, offsetM),
  };
}
