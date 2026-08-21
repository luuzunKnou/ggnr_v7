/** 엑셀 레이어 시스템 컬럼 — 정합성 키로 사용 불가 (재적재 시 번호·값이 바뀜) */
export const EXCEL_LAYER_SYSTEM_COLS = new Set(['id', 'geom', 'parcel_address']);

/** 복합키 모드 기본 저장 컬럼명 (사용자가 UI에서 변경 가능) */
export const EXCEL_COMPOSITE_KEY_ENG = 'excel_sync_key';
export const EXCEL_COMPOSITE_KEY_KOR = '정합성키';
export const EXCEL_COMPOSITE_KEY_SEP = '|';

export type ExcelWizardKeyMode = 'single' | 'composite' | 'synthetic';

export function safeExcelColumnName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'col';
}

/** id·geom·parcel_address 등 시스템 컬럼은 키 후보에서 제외 */
export function isExcelSystemKeyColumn(headerEng: string): boolean {
  const n = safeExcelColumnName(headerEng).toLowerCase();
  return EXCEL_LAYER_SYSTEM_COLS.has(n);
}

/** 속성 컬럼·INSERT columns에서 제외 (geom은 parcels.geom 경로로만) */
export function isExcelSystemAttrField(headerEng: string, originalHeader?: string): boolean {
  if (isExcelSystemKeyColumn(headerEng)) return true;
  if (originalHeader != null && String(originalHeader).trim() !== '' && isExcelSystemKeyColumn(originalHeader)) {
    return true;
  }
  return false;
}

/** 키 구성 열 값들을 이어 붙여 비교용 키 문자열 생성 */
export function buildExcelCompositeKeyValue(parts: unknown[]): string {
  return parts.map((p) => String(p ?? '').trim()).join(EXCEL_COMPOSITE_KEY_SEP);
}

export type ExcelCompositeKeyField = {
  originalHeader: string
  headerKor: string
  headerEng: string
}

export type ExcelCompositeKeySuggestion = {
  labels: string[]
  headers: string[]
  unique: boolean
  dupGroupCount: number
  dupRowCount: number
  singleColumnEnough: boolean
  message: string
}

const COMPOSITE_KEY_SUGGEST_MAX_COLS = 4
const COMPOSITE_KEY_SUGGEST_EMPTY_SKIP = 0.5
/** 면적·금액·비고·내용 등 — 식별자로 쓰기 약한 열 (추천 제외·단일키 경고) */
const EXCEL_WEAK_KEY_LABEL =
  /면적|금액|사용료|부과|좌표|경도|위도|기타|전화|연락|비고|내용|설명|메모|특이|적요|remark|note|desc|comment|contents/i

export function isExcelWeakKeyColumn(label: string): boolean {
  return EXCEL_WEAK_KEY_LABEL.test(String(label ?? '').trim())
}

/** 단일키로 고른 열이 설명 성격이면 경고 문구, 아니면 null */
export function excelWeakSingleKeyWarning(opts: {
  headerKor?: string
  headerEng?: string
  originalHeader?: string
}): string | null {
  const label = (opts.headerKor || opts.headerEng || opts.originalHeader || '').trim()
  if (!label) return null
  if (
    !isExcelWeakKeyColumn(label) &&
    !isExcelWeakKeyColumn(opts.headerEng ?? '') &&
    !isExcelWeakKeyColumn(opts.originalHeader ?? '')
  ) {
    return null
  }
  return `「${label}」는 설명 성격 열이라 단일 Key로 쓰기엔 적합하지 않습니다. 번호·코드 열을 쓰거나 복합키를 권장합니다.`
}

function excelKeyCell(row: Record<string, unknown>, header: string): string {
  return String(row[header] ?? '').trim()
}

function excelKeyFieldLabel(f: ExcelCompositeKeyField): string {
  return (f.headerKor || f.headerEng || f.originalHeader).trim()
}

function excelCompositeDupStats(
  rows: Record<string, unknown>[],
  headers: string[]
): { unique: boolean; dupGroupCount: number; dupRowCount: number } {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const k = buildExcelCompositeKeyValue(headers.map((h) => excelKeyCell(row, h)))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let dupGroupCount = 0
  let dupRowCount = 0
  for (const n of counts.values()) {
    if (n > 1) {
      dupGroupCount += 1
      dupRowCount += n
    }
  }
  return { unique: dupGroupCount === 0, dupGroupCount, dupRowCount }
}

function formatExcelCompositeKeySuggestion(opts: {
  labels: string[]
  unique: boolean
  dupGroupCount: number
  dupRowCount: number
  singleColumnEnough: boolean
}): string {
  const combo = opts.labels.join(' + ')
  if (opts.singleColumnEnough) {
    return `추천: ${combo} — 이 열만으로 행마다 유일합니다. 복합키가 없어도 됩니다.`
  }
  if (opts.unique) {
    return `추천: ${combo} — 이 조합이면 행마다 유일합니다.`
  }
  return `추천: ${combo} — 거의 유일합니다. 같은 값 ${opts.dupGroupCount}종(${opts.dupRowCount}행)이 남습니다.`
}

/**
 * 이미 파싱된 엑셀만 보고, 값이 잘 갈라지는 열을 앞에서부터 고른다.
 * 빈 값이 많은 열은 빼고, 모든 조합은 찾지 않는다.
 */
export function suggestExcelCompositeKey(opts: {
  rows: Record<string, unknown>[]
  fields: ExcelCompositeKeyField[]
}): ExcelCompositeKeySuggestion | null {
  const rows = opts.rows
  if (!rows.length || !opts.fields.length) return null

  const scored: { field: ExcelCompositeKeyField; uniq: number; emptyRatio: number }[] = []
  for (const field of opts.fields) {
    const header = field.originalHeader?.trim()
    if (!header) continue
    if (isExcelSystemKeyColumn(field.headerEng) || isExcelSystemKeyColumn(header)) continue
    if (isExcelWeakKeyColumn(excelKeyFieldLabel(field))) continue
    let empty = 0
    const set = new Set<string>()
    for (const row of rows) {
      const v = excelKeyCell(row, header)
      if (!v) empty += 1
      set.add(v)
    }
    const emptyRatio = empty / rows.length
    if (emptyRatio > COMPOSITE_KEY_SUGGEST_EMPTY_SKIP) continue
    scored.push({ field, uniq: set.size, emptyRatio })
  }
  if (scored.length === 0) return null
  scored.sort((a, b) => b.uniq - a.uniq || a.emptyRatio - b.emptyRatio)

  const picked: ExcelCompositeKeyField[] = [scored[0].field]
  let stats = excelCompositeDupStats(rows, [picked[0].originalHeader])
  const singleColumnEnough = stats.unique

  if (!stats.unique) {
    const remaining = scored.slice(1).map((s) => s.field)
    while (picked.length < COMPOSITE_KEY_SUGGEST_MAX_COLS && remaining.length > 0 && !stats.unique) {
      let bestIdx = -1
      let bestStats = stats
      for (let i = 0; i < remaining.length; i++) {
        const headers = [...picked.map((f) => f.originalHeader), remaining[i].originalHeader]
        const next = excelCompositeDupStats(rows, headers)
        if (
          bestIdx < 0 ||
          next.dupGroupCount < bestStats.dupGroupCount ||
          (next.dupGroupCount === bestStats.dupGroupCount && next.dupRowCount < bestStats.dupRowCount)
        ) {
          bestIdx = i
          bestStats = next
        }
      }
      if (bestIdx < 0 || bestStats.dupGroupCount >= stats.dupGroupCount) break
      picked.push(remaining.splice(bestIdx, 1)[0]!)
      stats = bestStats
    }
  }

  const labels = picked.map(excelKeyFieldLabel)
  return {
    labels,
    headers: picked.map((f) => f.originalHeader),
    unique: stats.unique,
    dupGroupCount: stats.dupGroupCount,
    dupRowCount: stats.dupRowCount,
    singleColumnEnough,
    message: formatExcelCompositeKeySuggestion({
      labels,
      unique: stats.unique,
      dupGroupCount: stats.dupGroupCount,
      dupRowCount: stats.dupRowCount,
      singleColumnEnough,
    }),
  }
}
