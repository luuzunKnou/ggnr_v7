import { randomId } from '@/lib/randomId';
import type {
  EditHistoryAction,
  EditHistoryEntry,
  PendingChangeKind,
  PendingRowKey,
  PendingShapeChange,
  ShapeEditorDraftState,
  ShapeEditorLayerItem,
} from '../types';
import { pendingRowKeyId } from './pendingChange';

export function buildSessionKey(
  layer: ShapeEditorLayerItem,
  draft: Pick<ShapeEditorDraftState, 'changeKind' | 'rowKey' | 'selectedFeatureId'>
): string {
  if (draft.rowKey) {
    return `${layer.tableName}:${pendingRowKeyId(draft.rowKey)}`;
  }
  return `insert:${layer.tableName}:${draft.selectedFeatureId ?? 'new'}`;
}

export function formatHistoryKeyPart(
  kind: PendingChangeKind,
  rowKey: PendingRowKey | null
): string {
  if (rowKey) return `${rowKey.keyField}=${rowKey.keyValue}`;
  return '신규';
}

function historyActionLabel(
  action: EditHistoryAction,
  kind: PendingChangeKind,
  moveIndex?: number
): string {
  switch (action) {
    case 'select':
      return kind === 'update' ? '기존 도형 선택' : '도형 선택';
    case 'create':
      return '신규 도형 생성';
    case 'move':
      return moveIndex != null && moveIndex > 0 ? `위치 변경 ${moveIndex}` : '위치 변경';
    case 'delete':
      return '삭제';
    case 'attribute':
      return '속성 변경';
    default:
      return '편집';
  }
}

export function buildHistoryEntryLabel(
  layer: ShapeEditorLayerItem,
  action: EditHistoryAction,
  kind: PendingChangeKind,
  rowKey: PendingRowKey | null,
  moveIndex?: number
): string {
  const keyPart = formatHistoryKeyPart(kind, rowKey);
  switch (action) {
    case 'move':
      return `${layer.name} (${keyPart})`;
    case 'create':
      return `${layer.name} (신규)`;
    case 'delete':
      return `${layer.name} (${keyPart}) 삭제`;
    case 'attribute':
      return `${layer.name} (${keyPart}) 속성`;
    case 'select':
      return `${layer.name} · ${historyActionLabel(action, kind, moveIndex)}`;
    default:
      return `${layer.name} (${keyPart})`;
  }
}

/** 작업 내역 패널에 표시할 항목 (선택 제외) */
export function isHistoryEntryVisibleInLog(entry: EditHistoryEntry): boolean {
  return entry.action !== 'select';
}

function baseHistoryFields(
  layer: ShapeEditorLayerItem,
  draft: ShapeEditorDraftState,
  action: EditHistoryAction,
  wkt5181: string | null,
  moveIndex?: number
): EditHistoryEntry | null {
  const kind = draft.changeKind;
  if (kind === 'update' && !draft.rowKey) return null;

  const sessionKey = buildSessionKey(layer, draft);
  return {
    id: randomId(),
    action,
    kind,
    layer: {
      id: layer.id,
      name: layer.name,
      tableName: layer.tableName,
      schema: layer.schema,
      physicalTableName: layer.physicalTableName,
    },
    wkt5181,
    attributeValues: { ...draft.attributeValues },
    originalAttributeValues: { ...draft.originalAttributeValues },
    rowKey: draft.rowKey ? { ...draft.rowKey } : null,
    wmsFeatureId: draft.wmsFeatureId,
    featureId: draft.selectedFeatureId,
    sessionKey,
    label: buildHistoryEntryLabel(layer, action, kind, draft.rowKey, moveIndex),
    createdAt: Date.now(),
  };
}

export function buildHistoryEntry(
  layer: ShapeEditorLayerItem,
  draft: ShapeEditorDraftState,
  action: EditHistoryAction,
  moveIndex?: number
): EditHistoryEntry | null {
  if (!draft.wkt5181?.trim()) return null;
  return baseHistoryFields(layer, draft, action, draft.wkt5181, moveIndex);
}

/** 삭제 직전 draft 스냅샷 — wkt5181 은 null (캔버스 비움) */
export function buildDeleteHistoryEntry(
  layer: ShapeEditorLayerItem,
  draft: ShapeEditorDraftState
): EditHistoryEntry | null {
  if (!draft.wkt5181?.trim()) return null;
  return baseHistoryFields(layer, draft, 'delete', null);
}

export function attributesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) return false;
  }
  return true;
}

export function isHistoryEntryDirty(
  entry: EditHistoryEntry,
  baseline: EditHistoryEntry
): boolean {
  if (entry.kind === 'insert') return true;
  return (
    entry.wkt5181 !== baseline.wkt5181 ||
    !attributesEqual(entry.attributeValues, baseline.attributeValues)
  );
}

/** index 시점 세션의 최종 히스토리 항목 (delete 포함) */
export function effectiveSessionEntry(
  entries: EditHistoryEntry[],
  index: number,
  sessionKey: string
): EditHistoryEntry | null {
  for (let i = index; i >= 0; i--) {
    const e = entries[i]!;
    if (e.sessionKey === sessionKey) return e;
  }
  return null;
}
/** delete 제외, index 이하에서 세션의 마지막 도형 스냅샷 */
export function latestMeaningfulEntry(
  entries: EditHistoryEntry[],
  index: number,
  sessionKey: string
): EditHistoryEntry | null {
  for (let i = index; i >= 0; i--) {
    const e = entries[i]!;
    if (e.sessionKey !== sessionKey) continue;
    if (e.action === 'delete') continue;
    if (e.wkt5181?.trim()) return e;
  }
  return null;
}

function sessionBaseline(
  entries: EditHistoryEntry[],
  index: number,
  sessionKey: string
): EditHistoryEntry | null {
  for (let i = 0; i <= index; i++) {
    const e = entries[i]!;
    if (e.sessionKey === sessionKey) return e;
  }
  return null;
}

function buildDeletePendingChange(entry: EditHistoryEntry): PendingShapeChange | null {
  if (!entry.rowKey) return null;
  return {
    id: entry.id,
    kind: 'delete',
    layer: entry.layer,
    wkt5181: '',
    attributeValues: { ...entry.attributeValues },
    originalAttributeValues: { ...entry.originalAttributeValues },
    rowKey: { ...entry.rowKey },
    wmsFeatureId: entry.wmsFeatureId,
    label: entry.label,
    status: 'pending',
    errorMessage: null,
    createdAt: entry.createdAt,
  };
}

export function historyEntryToPendingChange(entry: EditHistoryEntry): PendingShapeChange | null {
  if (!entry.wkt5181?.trim()) return null;
  if (entry.kind === 'update' && !entry.rowKey) return null;
  return {
    id: entry.id,
    kind: entry.kind,
    layer: entry.layer,
    wkt5181: entry.wkt5181,
    attributeValues: { ...entry.attributeValues },
    originalAttributeValues: { ...entry.originalAttributeValues },
    rowKey: entry.rowKey ? { ...entry.rowKey } : null,
    wmsFeatureId: entry.wmsFeatureId,
    label: entry.label,
    status: 'pending',
    errorMessage: null,
    createdAt: entry.createdAt,
  };
}

/** historyIndex 시점까지 세션별 최종 상태 중 DB 저장이 필요한 항목 */
export function collectDirtySaveItems(
  entries: EditHistoryEntry[],
  index: number
): PendingShapeChange[] {
  if (index < 0 || entries.length === 0) return [];

  const sessionKeys = new Set<string>();
  for (let i = 0; i <= index; i++) {
    sessionKeys.add(entries[i]!.sessionKey);
  }

  const out: PendingShapeChange[] = [];
  for (const sessionKey of sessionKeys) {
    const baseline = sessionBaseline(entries, index, sessionKey);
    if (!baseline) continue;

    const effective = effectiveSessionEntry(entries, index, sessionKey);
    if (!effective) continue;

    if (effective.action === 'delete') {
      const rowKey = effective.rowKey ?? baseline.rowKey;
      // 키 없는 신규 삭제 = 미저장 취소 → DB 반영 없음
      if (!rowKey) continue;
      const pending = buildDeletePendingChange({ ...effective, rowKey });
      if (pending) out.push(pending);
      continue;
    }

    const latest = latestMeaningfulEntry(entries, index, sessionKey);
    if (!latest) continue;
    if (!isHistoryEntryDirty(latest, baseline)) continue;
    const pending = historyEntryToPendingChange(latest);
    if (pending) out.push(pending);
  }
  return out;
}

export type PendingOverlayGeometry = {
  sessionKey: string;
  wkt5181: string;
};

/** 편집 캔버스에 올라간 세션을 제외한, 저장 대기 중인 도형 WKT */
export function collectPendingOverlayGeometries(
  entries: EditHistoryEntry[],
  index: number,
  excludeSessionKey: string | null
): PendingOverlayGeometry[] {
  if (index < 0 || entries.length === 0) return [];

  const sessionKeys = new Set<string>();
  for (let i = 0; i <= index; i++) {
    sessionKeys.add(entries[i]!.sessionKey);
  }

  const out: PendingOverlayGeometry[] = [];
  for (const sessionKey of sessionKeys) {
    if (excludeSessionKey && sessionKey === excludeSessionKey) continue;

    const baseline = sessionBaseline(entries, index, sessionKey);
    if (!baseline) continue;

    const effective = effectiveSessionEntry(entries, index, sessionKey);
    if (effective?.action === 'delete') continue;

    const latest = latestMeaningfulEntry(entries, index, sessionKey);
    if (!latest?.wkt5181?.trim()) continue;
    if (!isHistoryEntryDirty(latest, baseline)) continue;

    out.push({ sessionKey, wkt5181: latest.wkt5181 });
  }
  return out;
}

export function shouldHideWmsForHistoryEntry(
  entries: EditHistoryEntry[],
  index: number,
  entry: EditHistoryEntry
): boolean {
  if (!entry.rowKey) return false;
  const effective = effectiveSessionEntry(entries, index, entry.sessionKey);
  if (effective?.action === 'delete') return effective.kind === 'update';
  const latest = latestMeaningfulEntry(entries, index, entry.sessionKey);
  if (!latest || latest.kind !== 'update') return false;
  const baseline = sessionBaseline(entries, index, entry.sessionKey);
  if (!baseline) return false;
  return isHistoryEntryDirty(latest, baseline);
}

export function draftFromHistoryEntry(entry: EditHistoryEntry): ShapeEditorDraftState {
  const hasGeometry = !!entry.wkt5181?.trim();
  return {
    hasGeometry,
    wkt5181: hasGeometry ? entry.wkt5181 : null,
    saving: false,
    saveMessage: null,
    attributeValues: { ...entry.attributeValues },
    selectedFeatureId: entry.featureId,
    changeKind: entry.kind,
    rowKey: entry.rowKey ? { ...entry.rowKey } : null,
    wmsFeatureId: entry.wmsFeatureId,
    originalAttributeValues: { ...entry.originalAttributeValues },
  };
}

export function countSessionMoves(entries: EditHistoryEntry[], sessionKey: string): number {
  return entries.filter((e) => e.sessionKey === sessionKey && e.action === 'move').length;
}
