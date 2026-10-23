/** 레이어 설정에서 코드 분할을 여는 부모 테이블 → 구분 컬럼 */
export const SPLIT_LAYER_COLUMNS: Record<string, string> = {
  wtl_pipe_lm: "saa_cde",
  wtl_valv_ps: "ftr_cde",
  swl_pipe_lm: "sba_cde",
  swl_manh_ps: "smu_cde",
  swl_spot_ps: "sbd_cde",
}

/** 구분 컬럼 한글명 */
export const SPLIT_LAYER_COLUMN_LABELS: Record<string, string> = {
  saa_cde: "상수관용도",
  ftr_cde: "지형지물부호",
  sba_cde: "하수관용도",
  smu_cde: "하수맨홀용도",
  sbd_cde: "물받이용도",
}

const CODE_RE = /^[A-Za-z0-9_]+$/

export function splitLayerColumn(parentTable: string): string | null {
  const key = String(parentTable ?? "").trim().toLowerCase()
  return SPLIT_LAYER_COLUMNS[key] ?? null
}

export function splitLayerColumnLabel(column: string): string {
  return SPLIT_LAYER_COLUMN_LABELS[String(column ?? "").trim().toLowerCase()] ?? ""
}

export function isSplitLayerParent(parentTable: string): boolean {
  return splitLayerColumn(parentTable) != null
}

export function splitChildLayerName(parentTable: string, code: string): string {
  return `${String(parentTable).trim().toLowerCase()}_${String(code).trim().toLowerCase()}`
}

export function splitEtcLayerName(parentTable: string): string {
  return `${String(parentTable).trim().toLowerCase()}_etc`
}

export function isSplitLayerCode(code: string): boolean {
  return CODE_RE.test(String(code ?? "").trim())
}

export function splitCodeDivQuery(column: string, code: string): string {
  return `${column} = '${code}'`
}

/** 선택 코드 외 + 빈 값(NULL). 빈 문자열은 NOT IN에 포함된다. */
export function splitEtcDivQuery(column: string, codes: string[]): string {
  const list = codes.map((code) => `'${code}'`).join(", ")
  return `${column} IS NULL OR ${column} NOT IN (${list})`
}
