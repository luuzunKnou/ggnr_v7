/**
 * 상세 패널 열림 → 데이터 이력관리 «조회» 기록 (실패해도 UI 무시)
 * — 데이터 이력관리에 조회 저장을 위해 추가
 */
import { call } from '@/lib/api';

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
