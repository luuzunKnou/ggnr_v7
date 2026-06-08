/** tables.json 행: excel만 유지, 그 외·누락은 shp */
export function normalizeDefineTableSource(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const s = String(row.define_table_source ?? "").toLowerCase()
    row.define_table_source = s === "excel" ? "excel" : "shp"
  }
}
