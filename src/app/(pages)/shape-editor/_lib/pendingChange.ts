import { randomId } from '@/lib/randomId';
import type {
  PendingChangeKind,
  PendingRowKey,
  PendingShapeChange,
  ShapeEditorDraftState,
  ShapeEditorLayerItem,
} from '../types';

export type { PendingChangeKind, PendingRowKey, PendingShapeChange };

export function computeAttributeChanges(
  original: Record<string, string>,
  current: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = new Set([...Object.keys(original), ...Object.keys(current)]);
  for (const key of keys) {
    if ((original[key] ?? '') !== (current[key] ?? '')) {
      out[key] = current[key] ?? '';
    }
  }
  return out;
}

export function buildPendingChangeLabel(
  layerName: string,
  kind: PendingChangeKind,
  rowKey: PendingRowKey | null
): string {
  if (kind === 'insert') return `${layerName} · 신규`;
  if (kind === 'delete') {
    if (rowKey) return `${layerName} · ${rowKey.keyField}=${rowKey.keyValue} 삭제`;
    return `${layerName} · 삭제`;
  }
  if (rowKey) return `${layerName} · ${rowKey.keyField}=${rowKey.keyValue}`;
  return `${layerName} · 수정`;
}

export function draftToPendingChange(
  layer: ShapeEditorLayerItem,
  draft: ShapeEditorDraftState
): PendingShapeChange | null {
  if (!draft.wkt5181?.trim()) return null;
  if (draft.changeKind === 'update' && !draft.rowKey) return null;

  const kind = draft.changeKind;
  return {
    id: randomId(),
    kind,
    layer: {
      id: layer.id,
      name: layer.name,
      tableName: layer.tableName,
      schema: layer.schema,
      physicalTableName: layer.physicalTableName,
    },
    wkt5181: draft.wkt5181,
    attributeValues: { ...draft.attributeValues },
    originalAttributeValues: { ...draft.originalAttributeValues },
    rowKey: draft.rowKey ? { ...draft.rowKey } : null,
    wmsFeatureId: draft.wmsFeatureId,
    label: buildPendingChangeLabel(layer.name, kind, draft.rowKey),
    status: 'pending',
    errorMessage: null,
    createdAt: Date.now(),
  };
}

export function pendingRowKeyId(rowKey: PendingRowKey): string {
  return `${rowKey.keyField.toLowerCase()}:${rowKey.keyValue}`;
}

export function upsertPendingChange(
  list: PendingShapeChange[],
  item: PendingShapeChange
): PendingShapeChange[] {
  if ((item.kind === 'update' || item.kind === 'delete') && item.rowKey) {
    const rid = pendingRowKeyId(item.rowKey);
    const idx = list.findIndex(
      (p) =>
        (p.kind === 'update' || p.kind === 'delete') &&
        p.layer.tableName === item.layer.tableName &&
        p.rowKey &&
        pendingRowKeyId(p.rowKey) === rid
    );
    if (idx >= 0) {
      const next = [...list];
      next[idx] = { ...item, id: list[idx]!.id, createdAt: list[idx]!.createdAt };
      return next;
    }
  }
  return [...list, item];
}
