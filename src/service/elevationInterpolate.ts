/** 등고 후보 상·하 거리가중 보간 (고도 측정·수치지형도 공용) */

export type ElevCandidate = { elevation: number; distanceM: number };

/** 등고선 위에 있다고 볼 거리(m) — 이내면 보간 없이 cont 그대로 */
export const ON_LINE_EPS_M = 0.5;

/**
 * 상·하 인접 등고선으로만 높이 보간 (역거리 가중).
 * - low·high 둘 다 있을 때만 보간 → 결과는 항상 [low, high] 안
 * - 한쪽만 있으면 최근접 cont만 사용 (외삽 금지)
 * - 선 위(0.5m 이내)면 해당 cont 그대로
 */
export function interpolateElevationFromCandidates(
  candidates: ElevCandidate[]
): { elevation: number; method: 'nearest' | 'idw'; distanceM: number } {
  if (!candidates.length) {
    return { elevation: NaN, method: 'nearest', distanceM: NaN };
  }
  const sorted = [...candidates]
    .filter((c) => Number.isFinite(c.elevation) && Number.isFinite(c.distanceM) && c.distanceM >= 0)
    .sort((a, b) => a.distanceM - b.distanceM);
  if (!sorted.length) {
    return { elevation: NaN, method: 'nearest', distanceM: NaN };
  }

  const a = sorted[0];
  if (a.distanceM <= ON_LINE_EPS_M) {
    return { elevation: a.elevation, method: 'nearest', distanceM: a.distanceM };
  }

  let low: ElevCandidate | null = null;
  let high: ElevCandidate | null = null;
  for (const c of sorted) {
    if (c.elevation < a.elevation - 0.05) {
      if (!low || c.distanceM < low.distanceM) low = c;
    } else if (c.elevation > a.elevation + 0.05) {
      if (!high || c.distanceM < high.distanceM) high = c;
    }
  }

  if (low && high) {
    const d0 = Math.max(low.distanceM, 1e-6);
    const d1 = Math.max(high.distanceM, 1e-6);
    const elevation = (low.elevation * d1 + high.elevation * d0) / (d0 + d1);
    return {
      elevation,
      method: 'idw',
      distanceM: a.distanceM,
    };
  }

  return { elevation: a.elevation, method: 'nearest', distanceM: a.distanceM };
}
