import type { PendingChangeKind, PendingRowKey } from '../types';
import type { WmsFeatureKey } from './wmsFeatureKey';

export const SHAPE_EDITOR_ATTRS_KEY = 'shapeEditorAttrs';
const ROW_KEY_PROP = 'shapeEditorRowKey';
const CHANGE_KIND_PROP = 'shapeEditorChangeKind';
const FEATURE_ID_PROP = 'shapeEditorFeatureId';

type FeatureLike = {
  get: (k: string) => unknown;
  set: (k: string, v: unknown) => void;
};

export function emptyAttributeValues(fields: { field: string }[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of fields) m[f.field] = '';
  return m;
}

export function readFeatureAttributes(
  feature: { get: (k: string) => unknown },
  fields: { field: string }[]
): Record<string, string> {
  const raw = feature.get(SHAPE_EDITOR_ATTRS_KEY);
  const base = emptyAttributeValues(fields);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const f of fields) {
      const v = (raw as Record<string, unknown>)[f.field];
      base[f.field] = v != null ? String(v) : '';
    }
  }
  return base;
}

export function writeFeatureAttributes(
  feature: { set: (k: string, v: unknown) => void },
  values: Record<string, string>
) {
  feature.set(SHAPE_EDITOR_ATTRS_KEY, { ...values });
}

export type ShapeEditorFeatureIdentity = {
  changeKind: PendingChangeKind;
  rowKey: PendingRowKey | null;
  featureId: string | null;
};

/** Select 재선택 시에도 신규/수정·PK 유지 */
export function writeFeatureIdentity(
  feature: FeatureLike,
  identity: ShapeEditorFeatureIdentity
): void {
  feature.set(CHANGE_KIND_PROP, identity.changeKind);
  feature.set(ROW_KEY_PROP, identity.rowKey ? { ...identity.rowKey } : null);
  feature.set(FEATURE_ID_PROP, identity.featureId);
}

export function readFeatureIdentity(feature: FeatureLike): ShapeEditorFeatureIdentity | null {
  const kindRaw = feature.get(CHANGE_KIND_PROP);
  const changeKind =
    kindRaw === 'update' || kindRaw === 'insert' || kindRaw === 'delete'
      ? kindRaw
      : null;
  if (!changeKind) return null;

  const rowRaw = feature.get(ROW_KEY_PROP);
  let rowKey: PendingRowKey | null = null;
  if (rowRaw && typeof rowRaw === 'object' && !Array.isArray(rowRaw)) {
    const keyField = String((rowRaw as PendingRowKey).keyField ?? '').trim();
    const keyValue = String((rowRaw as PendingRowKey).keyValue ?? '').trim();
    if (keyField && keyValue) rowKey = { keyField, keyValue };
  }

  const featureIdRaw = feature.get(FEATURE_ID_PROP);
  const featureId =
    featureIdRaw != null && String(featureIdRaw).trim()
      ? String(featureIdRaw).trim()
      : null;

  return { changeKind, rowKey, featureId };
}

export function identityFromWmsKey(
  wms: (WmsFeatureKey & { featureId?: string }) | null | undefined,
  fallbackFeatureId: string
): ShapeEditorFeatureIdentity {
  if (wms?.keyField && wms.keyValue) {
    return {
      changeKind: 'update',
      rowKey: { keyField: wms.keyField, keyValue: wms.keyValue },
      featureId: wms.featureId ?? fallbackFeatureId,
    };
  }
  return {
    changeKind: 'insert',
    rowKey: null,
    featureId: fallbackFeatureId,
  };
}
