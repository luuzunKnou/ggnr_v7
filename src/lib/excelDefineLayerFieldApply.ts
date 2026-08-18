/**
 * 엑셀 헤더와 레이어 설정 컬럼을 한글명(또는 영문명)으로 짝 맞춘다.
 */
export type ExcelDefineLayerFieldMeta = {
  define_field_name: string
  define_field_kor_name: string
  define_field_show_list?: boolean
  define_field_show_search?: boolean
  define_field_is_key?: boolean
}

export type ExcelDefineLayerMeta = {
  exists: boolean
  tableKorName?: string
  tableGroup?: string
  fields?: ExcelDefineLayerFieldMeta[]
}

/** 엑셀 파일명에서 레이어 설정 비교용 이름(확장자·날짜시각 접두어 제거) */
export function excelUploadFileStemCandidates(fileName: string): string[] {
  const leaf = String(fileName ?? '').split(/[/\\]/).pop() ?? ''
  const withExt = leaf.replace(/\.(xlsx|xls|csv)$/i, '').trim()
  const stripped = withExt.replace(/^\d{14}_/, '').trim()
  const out: string[] = []
  for (const s of [stripped, withExt]) {
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

export function excelUploadFileStem(fileName: string): string {
  return excelUploadFileStemCandidates(fileName)[0] ?? ''
}

/** 파일명이 레이어 이름과 같거나, 이름 뒤에 _·공백 등 접미가 붙은 경우 */
export function excelUploadNameIsPrefixMatch(fileStem: string, layerName: string): boolean {
  const stem = String(fileStem ?? '').trim()
  const name = String(layerName ?? '').trim()
  if (!stem || !name) return false
  const stemLc = stem.toLowerCase()
  const nameLc = name.toLowerCase()
  if (stemLc === nameLc) return true
  if (!stemLc.startsWith(nameLc)) return false
  const rest = stem.slice(name.length)
  return rest === '' || /^[_\-\s(\[]/.test(rest)
}

export function pickDefineLayerRowByExcelFileName(
  fileName: string,
  rows: Array<Record<string, unknown>>
): Record<string, unknown> | undefined {
  const candidates = excelUploadFileStemCandidates(fileName)
  if (candidates.length === 0 || !rows.length) return undefined

  type Hit = { row: Record<string, unknown>; score: number; len: number }
  const hits: Hit[] = []
  for (const row of rows) {
    const tableName = String(row.define_table_name ?? '').trim()
    const korName = String(row.define_table_kor_name ?? '').trim()
    for (const cand of candidates) {
      if (tableName && excelUploadNameIsPrefixMatch(cand, tableName)) {
        const exact = cand.toLowerCase() === tableName.toLowerCase()
        hits.push({ row, score: exact ? 3 : 1, len: tableName.length })
      }
      if (korName && excelUploadNameIsPrefixMatch(cand, korName)) {
        const exact = cand.toLowerCase() === korName.toLowerCase()
        hits.push({ row, score: exact ? 2 : 1, len: korName.length })
      }
    }
  }
  if (hits.length === 0) return undefined
  hits.sort((a, b) => b.score - a.score || b.len - a.len)
  return hits[0]?.row
}

export function findDefineLayerFieldForExcelHeader(
  header: string,
  fields: ExcelDefineLayerFieldMeta[] | undefined
): ExcelDefineLayerFieldMeta | undefined {
  const t = String(header ?? '').trim()
  if (!t || !fields?.length) return undefined
  return (
    fields.find((f) => String(f.define_field_kor_name ?? '').trim() === t) ??
    fields.find((f) => String(f.define_field_name ?? '').trim() === t)
  )
}

export function excelLayerTableCheckHint(opts: {
  dbExists: boolean
  tableName: string
  defineExists: boolean
  fieldCount: number
}): string {
  const chunks: string[] = []
  if (opts.dbExists) {
    chunks.push(`layer.${opts.tableName} 테이블이 있습니다.`)
  } else {
    chunks.push('동일 이름의 layer 테이블이 없습니다. 신규 테이블로 생성합니다.')
  }
  if (opts.defineExists) {
    chunks.push(
      opts.fieldCount > 0
        ? `레이어 설정에 같은 이름이 있어 컬럼 ${opts.fieldCount}건을 다음 단계 매핑에 반영합니다.`
        : '레이어 설정에 같은 이름이 있습니다.'
    )
  }
  if (opts.dbExists) {
    chunks.push('다음 단계에서 엑셀과 컬럼 DIFF를 확인할 수 있습니다.')
  }
  return chunks.join(' ')
}

export function excelLayerTableCheckBadge(opts: {
  dbExists: boolean
  defineExists: boolean
}): { label: string; className: string } {
  if (opts.dbExists) {
    return { label: '기존 테이블 있음', className: 'text-amber-800 dark:text-amber-200' }
  }
  if (opts.defineExists) {
    return { label: '레이어 설정에 있음', className: 'text-teal-700 dark:text-teal-400' }
  }
  return { label: '신규 테이블 (동일 이름 없음)', className: 'text-green-700 dark:text-green-400' }
}
