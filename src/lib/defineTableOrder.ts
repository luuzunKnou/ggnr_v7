import tables from '@/config/defineLayer/tables.json';

type DefineIdxRow = {
  define_table_name?: string;
  define_table_idx?: string | number;
};

const IDX_BY_TABLE = new Map<string, number>();

/** 비어 있거나 숫자가 아니면 맨 뒤로 보낸다. */
export function parseDefineTableIdx(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim();
  if (!text) return 999999;
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : 999999;
}

for (const row of tables as DefineIdxRow[]) {
  const name = String(row.define_table_name ?? '').trim().toLowerCase();
  if (!name || IDX_BY_TABLE.has(name)) continue;
  IDX_BY_TABLE.set(name, parseDefineTableIdx(row.define_table_idx));
}

export function defineTableIdx(tableName: string): number {
  const key = tableName.trim().toLowerCase();
  if (!key) return 999999;
  return IDX_BY_TABLE.get(key) ?? 999999;
}

/** 순번이 작을수록 앞. 같으면 한글 이름순. */
export function compareDefineTableOrder(
  aIdx: unknown,
  aName: string,
  bIdx: unknown,
  bName: string,
): number {
  const diff = parseDefineTableIdx(aIdx) - parseDefineTableIdx(bIdx);
  if (diff !== 0) return diff;
  return aName.localeCompare(bName, 'ko');
}

export function sortLayersByDefineIdx<T extends { tableName: string; layerName: string }>(
  layers: readonly T[],
): T[] {
  return [...layers].sort((a, b) =>
    compareDefineTableOrder(
      defineTableIdx(a.tableName),
      a.layerName,
      defineTableIdx(b.tableName),
      b.layerName,
    ),
  );
}
