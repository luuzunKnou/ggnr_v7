/**
 * tables.json 배열 항목의 JSON 키 표준 순서.
 * 여기 없는 키는 알파벳 순으로 맨 뒤에 둔다.
 */
export const DEFINE_LAYER_TABLE_JSON_KEY_ORDER = [
  "define_table_name",
  "define_table_kor_name",
  "define_table_shp_type",
  "define_table_read_share",
  "define_table_write_share",
  "define_table_group",
  "define_table_idx",
  "define_table_etc",
  "define_table_schema",
  "define_table_source",
  "define_table_div_query",
  "define_table_parents_layer",
] as const

const ORDER_SET = new Set<string>(DEFINE_LAYER_TABLE_JSON_KEY_ORDER)

export function reorderDefineLayerTableRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of DEFINE_LAYER_TABLE_JSON_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      out[k] = row[k]
    }
  }
  const extras = Object.keys(row)
    .filter((k) => !ORDER_SET.has(k))
    .sort()
  for (const k of extras) {
    out[k] = row[k]
  }
  return out
}

export function reorderDefineLayerTablesArray(tables: Record<string, unknown>[]): Record<string, unknown>[] {
  return tables.map(reorderDefineLayerTableRow)
}
