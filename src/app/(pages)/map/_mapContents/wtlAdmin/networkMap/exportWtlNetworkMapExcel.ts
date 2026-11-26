import {
  formatDefineFieldDisplayValue,
  type DefineCodeRow,
} from '@/lib/defineLayerCodeDisplay'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  selectDefineLayerDetailFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import {
  formatWtlExcelFileStamp,
  writeWtlListExcelWorkbook,
  type WtlListExcelSheetInput,
} from '../wtlListExcelFormat'
import type { WtlNetworkRow } from './wtlNetworkTypes'

export type WtlNetworkExcelSheetInput = {
  sheetName: string
  /** 1행 제목 — 없으면 sheetName */
  title?: string
  rows: WtlNetworkRow[]
  fields: DefineFieldLike[]
  codesByField: Record<string, DefineCodeRow[]>
}

/** @deprecated formatWtlExcelFileStamp 사용 */
export function wtlNetworkExcelStamp(date = new Date()): string {
  return formatWtlExcelFileStamp(date)
}

/** 관망조회 시설목록 — show_detail 컬럼만, 제목·기준일시·헤더 틀고정 */
export function exportWtlNetworkMapExcel(
  sheets: WtlNetworkExcelSheetInput[],
  fileName?: string,
  opts?: { tableNames?: string[]; tableKorName?: string }
): void {
  const usable = sheets.filter((s) => s.rows.length > 0)
  if (usable.length === 0) return

  const out: WtlListExcelSheetInput[] = usable.map((sheet) => {
    const exportFields = selectDefineLayerDetailFields(sheet.fields)
    const headers = exportFields.map((f) => {
      const key = String(f.define_field_name ?? '').trim()
      return getDefineFieldDisplayLabel(key, f.define_field_kor_name)
    })
    const rows =
      exportFields.length > 0
        ? sheet.rows.map((row) => {
            const record = row.record ?? null
            return exportFields.map((f) => {
              const key = String(f.define_field_name ?? '').trim()
              const raw = record ? getRowValueByField(record, key) : undefined
              return formatDefineFieldDisplayValue(
                raw,
                f.define_field_type,
                sheet.codesByField[key.toLowerCase()],
                ''
              )
            })
          })
        : sheet.rows.map((r) => [r.name || ''])

    const sheetName = sheet.sheetName
    return {
      sheetName,
      title: String(sheet.title ?? sheetName).trim() || sheetName,
      headers: headers.length > 0 ? headers : ['관리번호'],
      rows,
    }
  })

  const stamp = formatWtlExcelFileStamp()
  writeWtlListExcelWorkbook({
    sheets: out,
    fileName: fileName ?? `${stamp}_관망조회.xlsx`,
    tableNames: opts?.tableNames,
    tableKorName: opts?.tableKorName ?? '관망조회',
  })
}
