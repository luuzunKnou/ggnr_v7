/** tables.json 행: excel만 유지, 그 외·누락은 shp */
export function normalizeDefineTableSource(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const s = String(row.define_table_source ?? "").toLowerCase()
    row.define_table_source = s === "excel" ? "excel" : "shp"
  }
}

function filledFieldCount(row: Record<string, unknown>): number {
  let n = 0
  for (const v of Object.values(row)) {
    if (v == null) continue
    if (String(v).trim() === "") continue
    n += 1
  }
  return n
}

/**
 * schema + 테이블명 기준 중복 제거.
 * 같은 키가 여러 번이면 필드가 더 채워진 행을 남긴다 (동점이면 앞선 행).
 */
export function dedupeDefineLayerTablesByName(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const seen = new Map<string, number>()
  const out: Record<string, unknown>[] = []

  for (const row of rows) {
    const name = String(row.define_table_name ?? "").trim().toLowerCase()
    if (!name) {
      out.push(row)
      continue
    }
    const schemaRaw = String(row.define_table_schema ?? "layer").trim().toLowerCase()
    const schema = schemaRaw === "public_layer" ? "public_layer" : "layer"
    const key = `${schema}:${name}`
    const prevIdx = seen.get(key)
    if (prevIdx == null) {
      seen.set(key, out.length)
      out.push(row)
      continue
    }
    if (filledFieldCount(row) > filledFieldCount(out[prevIdx]!)) {
      out[prevIdx] = row
    }
  }

  return out
}
