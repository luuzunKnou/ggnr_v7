/** 데이터 조회 행 이력 유형 (client/server 공용) */
export const DATA_QUERY_HISTORY_TYPES = ['점검', '보수', '이상발생', '준공'] as const;
export type DataQueryHistoryType = (typeof DATA_QUERY_HISTORY_TYPES)[number];

export function isDataQueryHistoryType(v: string): v is DataQueryHistoryType {
  return (DATA_QUERY_HISTORY_TYPES as readonly string[]).includes(v);
}
