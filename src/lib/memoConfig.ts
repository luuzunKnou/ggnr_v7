/** defineLayer tables.json 「메모」 그룹 — GeoServer WMS 레이어명과 동일 */
export const MEMO_TABLES = [
  { tableName: "memo", label: "메모" },
  { tableName: "memo_city", label: "도시 메모" },
  { tableName: "memo_farm", label: "농업 메모" },
  { tableName: "memo_river", label: "하천 메모" },
  { tableName: "memo_road", label: "도로 메모" },
  { tableName: "memo_swl", label: "하수 메모" },
  { tableName: "memo_tour", label: "관광 메모" },
  { tableName: "memo_wtl", label: "상수 메모" },
  { tableName: "memo_permit", label: "인허가 메모" },
] as const;

export type MemoTableName = (typeof MEMO_TABLES)[number]["tableName"];

export const MEMO_SCHEMA = "layer";
export const MEMO_KEY_FIELD = "memo_key";

const ROW_KEY_SEP = "::";

export function encodeMemoRowKey(tableName: string, memoKey: string | number): string {
  return `${String(tableName).trim()}${ROW_KEY_SEP}${String(memoKey).trim()}`;
}

export function parseMemoRowKey(rowKey: string): { tableName: string; memoKey: string } | null {
  const raw = String(rowKey ?? "").trim();
  const idx = raw.indexOf(ROW_KEY_SEP);
  if (idx <= 0) return null;
  const tableName = raw.slice(0, idx).trim();
  const memoKey = raw.slice(idx + ROW_KEY_SEP.length).trim();
  if (!tableName || !memoKey) return null;
  return { tableName, memoKey };
}

export function memoWmsLayerId(tableName: string): string {
  return String(tableName).trim().toLowerCase();
}
