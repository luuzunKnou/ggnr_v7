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
} from '../wtlListExcelFormat'
import type { WtlFacilityListRow } from './WtlFacilityListView'

/** 시설·설비 목록 — show_detail 컬럼만, 제목·기준일시·헤더 틀고정 */
export function exportWtlFacilityExcel(args: {
  rows: WtlFacilityListRow[]
  fields: DefineFieldLike[]
  codesByField: Record<string, DefineCodeRow[]>
  sheetName?: string
  title?: string
  fileName?: string
}): void {
  const { rows, fields, codesByField } = args
  if (rows.length === 0) return

  const exportFields = selectDefineLayerDetailFields(fields)
  const headers = exportFields.map((f) => {
    const key = String(f.define_field_name ?? '').trim()
    return getDefineFieldDisplayLabel(key, f.define_field_kor_name)
  })
  const body =
    exportFields.length > 0
      ? rows.map((row) =>
          exportFields.map((f) => {
            const key = String(f.define_field_name ?? '').trim()
            const raw = getRowValueByField(row.record, key)
            return formatDefineFieldDisplayValue(
              raw,
              f.define_field_type,
              codesByField[key.toLowerCase()],
              ''
            )
          })
        )
      : rows.map((r) => [r.name || ''])

  const sheetLabel = String(args.sheetName ?? '시설목록').trim() || '시설목록'
  const title = String(args.title ?? sheetLabel).trim() || sheetLabel
  const stamp = formatWtlExcelFileStamp()

  writeWtlListExcelWorkbook({
    sheets: [
      {
        sheetName: sheetLabel,
        title,
        headers: headers.length > 0 ? headers : ['시설명'],
        rows: body,
      },
    ],
    fileName: args.fileName ?? `${stamp}_${sheetLabel}.xlsx`,
  })
}
