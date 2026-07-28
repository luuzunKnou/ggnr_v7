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

/** 목록·지도 공통: 검색어 매칭 (빈 문자열이면 통과) */
export function stationMatchesSearchQuery(
  st: Pick<SafetyWaterStation, 'name' | 'address' | 'code'>,
  searchQuery: string
): boolean {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  return `${st.name} ${st.address} ${st.code}`.toLowerCase().includes(q);
}

/** 목록·지도 공통: 토글칩·검색 필터에 포함되는지 */
export function stationMatchesListFilter(
  st: Pick<SafetyWaterStation, 'id' | 'kind' | 'name' | 'address' | 'code'>,
  chips: readonly StationListFilterChip[],
  stationIdsWithCctv: Set<string> | undefined,
  searchQuery = ''
): boolean {
  const { selectedKinds, cctvOnly } = deriveStationListFilter(chips);
  if (!selectedKinds.includes(st.kind)) return false;
  if (cctvOnly && !(stationIdsWithCctv?.has(st.id) ?? false)) return false;
  if (!stationMatchesSearchQuery(st, searchQuery)) return false;
  return true;
}
