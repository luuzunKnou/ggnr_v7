/**
 * 지하시설물 패널 선택 ↔ 데이터 조회 visibleLayerNames 양방향 연동 헬퍼.
 */

export function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

/** 데이터 조회 켜진 레이어 중 지하시설물 카탈로그에 있는 테이블만 */
export function pickUndergroundFacilityFromVisible(
  visibleLayerNames: Set<string>,
  availableTableNames: Set<string>
): Set<string> {
  const next = new Set<string>();
  for (const name of visibleLayerNames) {
    if (availableTableNames.has(name)) next.add(name);
  }
  return next;
}

/**
 * visibleLayerNames에서 지하시설물 가용 테이블을 filtered 집합으로 맞춘다.
 * 가용분 외 레이어는 유지.
 */
export function mirrorUndergroundFacilityIntoVisible(
  prevVisible: Set<string>,
  availableTableNames: Set<string>,
  selectedUnderground: Set<string>
): Set<string> {
  const next = new Set<string>();
  for (const name of prevVisible) {
    if (!availableTableNames.has(name)) next.add(name);
  }
  for (const name of selectedUnderground) {
    if (availableTableNames.has(name)) next.add(name);
  }
  if (sameStringSet(prevVisible, next)) return prevVisible;
  return next;
}
