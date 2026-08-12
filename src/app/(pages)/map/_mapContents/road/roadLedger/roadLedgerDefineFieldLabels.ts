/**
 * 도로대장·시설관리 목록 헤더 — 데이터 조회와 동일하게 defineLayer 한글명 사용.
 */

type DefineFieldRow = {
  define_field_name?: string;
  define_field_kor_name?: string;
};

const labelCache = new Map<string, Record<string, string>>();
const inflight = new Map<string, Promise<Record<string, string>>>();

function tableCacheKey(tableName: string): string {
  return String(tableName ?? "").trim().toLowerCase();
}

/** fieldKey(대소문자 무시) → 한글 라벨 */
export async function fetchRoadLedgerDefineFieldLabels(
  tableName: string
): Promise<Record<string, string>> {
  const key = tableCacheKey(tableName);
  if (!key) return {};
  const cached = labelCache.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(key)}`);
      const json = (await res.json()) as { data?: DefineFieldRow[] } | DefineFieldRow[];
      const rows = Array.isArray(json)
        ? json
        : Array.isArray(json?.data)
          ? json.data
          : [];
      const map: Record<string, string> = {};
      for (const row of rows) {
        const name = String(row?.define_field_name ?? "").trim();
        if (!name) continue;
        const kor = String(row?.define_field_kor_name ?? "").trim();
        map[name.toLowerCase()] = kor || name;
      }
      labelCache.set(key, map);
      return map;
    } catch {
      const empty: Record<string, string> = {};
      labelCache.set(key, empty);
      return empty;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

export function resolveRoadLedgerFieldLabel(
  labels: Record<string, string> | null | undefined,
  fieldKey: string
): string {
  const k = String(fieldKey ?? "").trim();
  if (!k) return "";
  if (!labels) return k;
  return labels[k.toLowerCase()] || k;
}

/** 이미 로드된 defineField 배열에서 한글명 조회 */
export function resolveDefineFieldKorName(
  fields: Array<{ define_field_name?: string; define_field_kor_name?: string }> | null | undefined,
  fieldKey: string
): string {
  const k = String(fieldKey ?? "").trim();
  if (!k) return "";
  const kl = k.toLowerCase();
  const hit = (fields ?? []).find(
    (f) => String(f.define_field_name ?? "").trim().toLowerCase() === kl
  );
  const kor = String(hit?.define_field_kor_name ?? "").trim();
  return kor || k;
}
