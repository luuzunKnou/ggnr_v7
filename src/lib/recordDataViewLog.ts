/**
 * 상세 패널 열림 → 데이터 이력관리 «조회» 기록 (실패해도 UI 무시)
 * — 데이터 이력관리에 조회 저장을 위해 추가
 */
import { call } from '@/lib/api';

/** effect 재실행·Strict Mode·앵커 remount 등으로 같은 조회가 연속 기록되는 것 방지 */
const RECENT_VIEW_LOG_MS = 2500;
const recentViewLogs = new Map<string, number>();

function pruneRecentViewLogs(now: number): void {
  if (recentViewLogs.size < 64) return;
  for (const [k, t] of recentViewLogs) {
    if (now - t >= RECENT_VIEW_LOG_MS) recentViewLogs.delete(k);
  }
}

export function recordDataViewLog(params: {
  tableName: string;
  keyField: string;
  keyValue: string | number;
  serviceName?: string | null;
  group?: string | null;
  tableKorName?: string | null;
}): void {
  const tableName = String(params.tableName ?? '').trim();
  const keyField = String(params.keyField ?? '').trim();
  const keyValue = String(params.keyValue ?? '').trim();
  if (!tableName || !keyField || !keyValue) return;

  const serviceName = String(params.serviceName ?? '').trim();
  const now = Date.now();
  pruneRecentViewLogs(now);
  /** 동일 파라미터 */
  const exactKey = `${tableName.toLowerCase()}\0${keyField.toLowerCase()}\0${keyValue}\0${serviceName}`;
  /** 키필드만 바뀌는 경우(ogc_fid → define key)도 같은 행으로 본다 */
  const rowKey = `${tableName.toLowerCase()}\0${keyValue}\0${serviceName}`;
  const prevExact = recentViewLogs.get(exactKey);
  const prevRow = recentViewLogs.get(rowKey);
  if (
    (prevExact != null && now - prevExact < RECENT_VIEW_LOG_MS) ||
    (prevRow != null && now - prevRow < RECENT_VIEW_LOG_MS)
  ) {
    return;
  }
  recentViewLogs.set(exactKey, now);
  recentViewLogs.set(rowKey, now);

  void call('', 'POST', {
    service: 'dataLogService',
    action: 'recordViewLog',
    params: {
      tableName,
      keyField,
      keyValue,
      serviceName: params.serviceName ?? undefined,
      group: params.group ?? undefined,
      tableKorName: params.tableKorName ?? undefined,
    },
  }).catch(() => {});
}
