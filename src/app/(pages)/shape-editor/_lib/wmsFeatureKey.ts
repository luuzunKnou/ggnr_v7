/** GeoServer WMS CQL 에서 쓸 PK 후보 (ogc_fid 제외 — GeoServer 레이어에 없는 경우가 많음) */
export const WMS_CQL_KEY_CANDIDATES = [
  'fid',
  'id',
  'ufid',
  'fsid',
  'rdid',
  'gid',
] as const;

export type WmsFeatureKey = {
  keyField: string;
  keyValue: string;
};

const GEOM_FIELD_NAMES = new Set(['geom', 'geometry', 'the_geom', 'shape']);

function isUsableKeyField(name: string): boolean {
  const lower = name.toLowerCase();
  return !!lower && lower !== 'ogc_fid' && !GEOM_FIELD_NAMES.has(lower);
}

/** defineLayer 필드명 + 기본 후보로 WMS CQL 키 후보 목록 생성 */
export function buildWmsKeyCandidates(
  defineFieldNames?: string[],
  preferredKeyField?: string | null
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (name: string) => {
    if (!isUsableKeyField(name)) return;
    const lower = name.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(name);
  };

  if (preferredKeyField?.trim()) push(preferredKeyField.trim());
  for (const c of WMS_CQL_KEY_CANDIDATES) push(c);
  if (defineFieldNames) {
    for (const f of defineFieldNames) push(f);
  }
  return out;
}

export function extractFeatureKeyForWms(
  row: Record<string, unknown>,
  preferredKeyField?: string | null,
  extraCandidates?: string[]
): WmsFeatureKey | null {
  const candidates = buildWmsKeyCandidates(extraCandidates, preferredKeyField);

  for (const name of candidates) {
    const lower = name.toLowerCase();
    const col = Object.keys(row).find((k) => k.toLowerCase() === lower);
    if (!col || row[col] == null) continue;
    if (typeof row[col] === 'object') continue;
    const keyValue = String(row[col]).trim();
    if (!keyValue) continue;
    return { keyField: col, keyValue };
  }
  return null;
}

/** GeoServer 레이어에 ogc_fid 가 없는 경우가 많아 WMS 숨김 CQL 에서는 제외 */
export function isWmsCqlSafeKeyField(keyField: string): boolean {
  return isUsableKeyField(keyField);
}

export function formatWmsFeatureId(key: WmsFeatureKey): string {
  return `wms:${key.keyField.toLowerCase()}:${encodeURIComponent(key.keyValue)}`;
}

export function parseWmsFeatureId(featureId: string | null | undefined): WmsFeatureKey | null {
  if (!featureId) return null;
  const tagged = /^wms:([^:]+):(.+)$/.exec(featureId);
  if (tagged) {
    const keyField = tagged[1]!;
    if (keyField === 'tmp') return null;
    return {
      keyField,
      keyValue: decodeURIComponent(tagged[2]!),
    };
  }
  const legacy = /^wms:(\d+)$/.exec(featureId);
  if (legacy) return null;
  return null;
}
