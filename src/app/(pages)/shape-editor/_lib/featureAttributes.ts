export const SHAPE_EDITOR_ATTRS_KEY = 'shapeEditorAttrs';

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
