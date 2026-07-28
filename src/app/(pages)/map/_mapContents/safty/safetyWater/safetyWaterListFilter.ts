import type { SafetyWaterStation, SafetyWaterStationKind } from './safetyWaterTypes';

/** 필터 칩 — 다중 선택 (빈 배열 = 전체) */
export type StationListFilterChip = 'water' | 'rain' | 'cctv';

export function deriveStationListFilter(chips: readonly StationListFilterChip[]) {
  const set = new Set(chips);
  const isAll = set.size === 0;
  const selectedKinds: SafetyWaterStationKind[] =
    isAll || (!set.has('water') && !set.has('rain'))
      ? ['water', 'rain']
      : [
          ...(set.has('water') ? (['water'] as const) : []),
          ...(set.has('rain') ? (['rain'] as const) : []),
        ];
  const cctvOnly = !isAll && set.has('cctv');
  return { isAll, selectedKinds, cctvOnly };
}

/** 목록·지도 공통: 토글칩 필터에 포함되는지 */
export function stationMatchesListFilter(
  st: Pick<SafetyWaterStation, 'id' | 'kind'>,
  chips: readonly StationListFilterChip[],
  stationIdsWithCctv: Set<string> | undefined
): boolean {
  const { selectedKinds, cctvOnly } = deriveStationListFilter(chips);
  if (!selectedKinds.includes(st.kind)) return false;
  if (cctvOnly && !(stationIdsWithCctv?.has(st.id) ?? false)) return false;
  return true;
}
