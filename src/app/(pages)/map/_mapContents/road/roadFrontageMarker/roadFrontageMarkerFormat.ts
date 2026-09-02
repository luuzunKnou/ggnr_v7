/** 표주 roadType(한글) → 도로대장 ROAD_RANK 코드 */
const ROAD_TYPE_TO_RANK_CODE: Record<string, string> = {
  국도: '1502',
  지방도: '1504',
  군도: '1506',
};

const ROAD_TYPE_BADGE_CLASS: Record<string, string> = {
  국도: 'standard-road-rank-badge standard-road-rank-badge-national',
  지방도: 'standard-road-rank-badge standard-road-rank-badge-provincial',
  군도: 'standard-road-rank-badge standard-road-rank-badge-county',
};

/** 목록 «종류» 뱃지 — theme 토큰 기반(다크모드 대응) */
export function getRoadFrontageMarkerRoadTypeBadgeClass(roadType: string): string {
  const label = String(roadType ?? '').trim();
  if (label && ROAD_TYPE_BADGE_CLASS[label]) return ROAD_TYPE_BADGE_CLASS[label];
  const rankCode = ROAD_TYPE_TO_RANK_CODE[label] ?? label;
  if (rankCode === '1502') return ROAD_TYPE_BADGE_CLASS['국도'];
  if (rankCode === '1504') return ROAD_TYPE_BADGE_CLASS['지방도'];
  if (rankCode === '1506') return ROAD_TYPE_BADGE_CLASS['군도'];
  return 'standard-road-rank-badge standard-road-rank-badge-unknown';
}
