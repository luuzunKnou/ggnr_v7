/** Field 탭 표준 자료형 (대문자) */
export const DEFINE_FIELD_TYPE_OPTIONS = [
  "TEXT",
  "NUMBER",
  "GEOMETRY",
  "DATE",
  "BOOLEAN",
  "CODE",
] as const

export type DefineFieldTypeOption = (typeof DEFINE_FIELD_TYPE_OPTIONS)[number]

/**
 * define_field_type 저장·수정 시 대문자 + 별칭을 표준값으로 맞춤.
 * integer/numeric 등 → NUMBER, varchar 등 → TEXT
 */
export function normalizeDefineFieldType(raw: unknown): string {
  const t = String(raw ?? "").trim().toUpperCase()
  if (!t) return t

  if (
    t === "INTEGER" ||
    t === "INT" ||
    t === "BIGINT" ||
    t === "SMALLINT" ||
    t === "SERIAL" ||
    t === "BIGSERIAL" ||
    t === "NUMERIC" ||
    t === "DECIMAL" ||
    t === "FLOAT" ||
    t === "DOUBLE" ||
    t === "REAL"
  ) {
    return "NUMBER"
  }
  if (
    t === "VARCHAR" ||
    t === "CHARACTER VARYING" ||
    t === "CHAR" ||
    t === "CHARACTER" ||
    t === "STRING"
  ) {
    return "TEXT"
  }
  if (t === "TIMESTAMP" || t === "TIMESTAMPTZ" || t === "TIME" || t === "TIMETZ") {
    return "DATE"
  }
  if (t === "BOOL") return "BOOLEAN"
  if (t === "GEOM" || t === "GEOGRAPHY") return "GEOMETRY"

  return t
}

/** 필드 배열의 define_field_type을 일괄 정규화 (저장 직전) */
export function normalizeDefineFieldsTypes<T extends Record<string, unknown>>(fields: T[]): T[] {
  return fields.map((f) => {
    if (!("define_field_type" in f)) return f
    return {
      ...f,
      define_field_type: normalizeDefineFieldType(f.define_field_type),
    }
  })
}
