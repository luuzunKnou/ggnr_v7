import { call } from '@/lib/api';
import {
  computeAttributeChanges,
  type PendingShapeChange,
} from './pendingChange';

export type SavePendingResult = {
  ok: boolean;
  error?: string;
  keyValue?: string;
};

export async function savePendingChange(item: PendingShapeChange): Promise<SavePendingResult> {
  const { layer } = item;

  if (item.kind === 'insert') {
    const res = await call('', 'POST', {
      service: 'layerRowService',
      action: 'insertTableRow',
      params: {
        table: layer.tableName,
        schema: layer.schema,
        values: { ...item.attributeValues },
        geomWkt5181: item.wkt5181,
      },
    });
    const data = res?.data ?? res;
    if (data?.error || data?.success === false) {
      return { ok: false, error: String(data?.error ?? '등록에 실패했습니다.') };
    }
    return { ok: true, keyValue: data?.keyValue != null ? String(data.keyValue) : undefined };
  }

  if (!item.rowKey) {
    return { ok: false, error: '수정 대상 키가 없습니다.' };
  }

  const changes = computeAttributeChanges(item.originalAttributeValues, item.attributeValues);
  const res = await call('', 'POST', {
    service: 'layerRowService',
    action: 'updateTableRowByKey',
    params: {
      table: layer.tableName,
      schema: layer.schema,
      keyField: item.rowKey.keyField,
      keyValue: item.rowKey.keyValue,
      changes,
      geomWkt5181: item.wkt5181,
    },
  });
  const data = res?.data ?? res;
  if (data?.error || data?.success === false) {
    return { ok: false, error: String(data?.error ?? '수정 저장에 실패했습니다.') };
  }
  return { ok: true, keyValue: item.rowKey.keyValue };
}

export async function savePendingChangesBatch(
  items: PendingShapeChange[]
): Promise<{ savedIds: string[]; failed: Array<{ id: string; error: string }> }> {
  const savedIds: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const item of items) {
    const result = await savePendingChange(item);
    if (result.ok) savedIds.push(item.id);
    else failed.push({ id: item.id, error: result.error ?? '저장 실패' });
  }

  return { savedIds, failed };
}
