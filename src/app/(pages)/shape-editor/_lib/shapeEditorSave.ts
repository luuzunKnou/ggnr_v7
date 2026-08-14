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

/** 신규 INSERT 시 자동채번 PK·순번 컬럼은 보내지 않음 */
function stripInsertAutoKeyFields(
  tableName: string,
  values: Record<string, string>
): Record<string, string> {
  const tableKey = `${tableName.trim().toLowerCase()}_key`;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(values)) {
    const lower = key.toLowerCase();
    if (lower === tableKey || lower === 'ogc_fid' || lower === 'gid') continue;
    out[key] = val;
  }
  return out;
}

function attrPick(
  values: Record<string, string>,
  ...keys: string[]
): string | null {
  const want = new Set(keys.map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(values)) {
    if (!want.has(k.toLowerCase())) continue;
    const t = String(v ?? '').trim();
    if (t) return t;
  }
  return null;
}

/** 민원(comp) 신규 저장 후 민원관리와 동일하게 «접수» 이력 1건 */
async function ensureCompReceiptHistory(
  keyValue: string,
  attributeValues: Record<string, string>
): Promise<{ ok: boolean; error?: string }> {
  const compKey = Number(keyValue);
  if (!Number.isInteger(compKey) || compKey < 1) {
    return { ok: false, error: '민원 접수번호를 확인할 수 없습니다.' };
  }
  try {
    const res = await call('', 'POST', {
      service: 'complaintService',
      action: 'ensureInitialReceiptHistory',
      params: {
        compKey,
        compCu: attrPick(attributeValues, 'comp_cu', 'compCu'),
        compCt: attrPick(attributeValues, 'comp_ct', 'compCt'),
        compCg: attrPick(attributeValues, 'comp_cg', 'compCg'),
      },
    });
    if (res?.success === false) {
      return { ok: false, error: String(res?.error ?? '민원 접수 이력 등록에 실패했습니다.') };
    }
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || '민원 접수 이력 등록에 실패했습니다.' };
  }
}

export async function savePendingChange(item: PendingShapeChange): Promise<SavePendingResult> {
  const { layer } = item;

  if (item.kind === 'insert') {
    const res = await call('', 'POST', {
      service: 'layerRowService',
      action: 'insertTableRow',
      params: {
        table: layer.tableName,
        schema: layer.schema,
        values: stripInsertAutoKeyFields(layer.tableName, item.attributeValues),
        geomWkt5181: item.wkt5181,
      },
    });
    const data = res?.data ?? res;
    if (data?.error || data?.success === false) {
      return { ok: false, error: String(data?.error ?? '등록에 실패했습니다.') };
    }
    const keyValue = data?.keyValue != null ? String(data.keyValue) : undefined;
    if (layer.tableName.trim().toLowerCase() === 'comp' && keyValue) {
      const hist = await ensureCompReceiptHistory(keyValue, item.attributeValues);
      if (!hist.ok) {
        return {
          ok: false,
          error: hist.error ?? '민원 접수 이력 등록에 실패했습니다.',
          keyValue,
        };
      }
    }
    return { ok: true, keyValue };
  }

  if (!item.rowKey) {
    return {
      ok: false,
      error: item.kind === 'delete' ? '삭제 대상 키가 없습니다.' : '수정 대상 키가 없습니다.',
    };
  }

  if (item.kind === 'delete') {
    const res = await call('', 'POST', {
      service: 'layerRowService',
      action: 'deleteTableRowByKey',
      params: {
        table: layer.tableName,
        schema: layer.schema,
        keyField: item.rowKey.keyField,
        keyValue: item.rowKey.keyValue,
      },
    });
    const data = res?.data ?? res;
    if (data?.error || data?.success === false) {
      return { ok: false, error: String(data?.error ?? '삭제에 실패했습니다.') };
    }
    return { ok: true, keyValue: item.rowKey.keyValue };
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
