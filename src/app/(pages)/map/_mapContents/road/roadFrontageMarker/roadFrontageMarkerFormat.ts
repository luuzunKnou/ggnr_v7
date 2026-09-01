import type { CSSProperties } from 'react';
import { getRoadLedgerRankBadgeStyle } from '../roadLedger/roadLedgerFormat';

/** 표주 roadType(한글) → 도로대장 ROAD_RANK 코드 */
const ROAD_TYPE_TO_RANK_CODE: Record<string, string> = {
  국도: '1502',
  지방도: '1504',
  군도: '1506',
};

/** 목록 «종류» 뱃지 — 도로대장 목록과 동일 색상 */
export function getRoadFrontageMarkerRoadTypeBadgeStyle(roadType: string): CSSProperties {
  const label = String(roadType ?? '').trim();
  const rankCode = ROAD_TYPE_TO_RANK_CODE[label] ?? label;
  return getRoadLedgerRankBadgeStyle(rankCode);
}
