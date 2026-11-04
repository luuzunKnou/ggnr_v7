import * as XLSX from 'xlsx'
import {
  formatDefineFieldDisplayValue,
  type DefineCodeRow,
} from '@/lib/defineLayerCodeDisplay'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isGeomLikeDefineFieldName,
  selectDefineLayerDetailFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import type { WtlNetworkRow } from './wtlNetworkTypes'

export type WtlNetworkExcelSheetInput = {
  sheetName: string
  rows: WtlNetworkRow[]
  fields: DefineFieldLike[]
  codesByField: Record<string, DefineCodeRow[]>
}

/** yyyyMMddHHmmss (로컬) */
export function wtlNetworkExcelStamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  )
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  const cleaned = String(raw ?? '')
    .replace(/[\\/?*[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  let base = (cleaned || 'Sheet').slice(0, 31)
  let candidate = base
  let i = 2
  while (used.has(candidate)) {
    const suffix = `_${i}`
    candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`
    i += 1
  }
  used.add(candidate)
  return candidate
}

function resolveExportFields(fields: DefineFieldLike[], sample: WtlNetworkRow | undefined): DefineFieldLike[] {
  const detail = selectDefineLayerDetailFields(fields)
  if (detail.length > 0) return detail
  const record = sample?.record
  if (!record) return []
  return Object.keys(record)
    .filter((k) => {
      const name = String(k ?? '').trim()
      return name && !isGeomLikeDefineFieldName(name)
    })
    .map((name) => ({ define_field_name: name, define_field_kor_name: name }))
}

function rowToExcelObject(
  row: WtlNetworkRow,
  fields: DefineFieldLike[],
  codesByField: Record<string, DefineCodeRow[]>
): Record<string, string> {
  const record = row.record ?? null
  const out: Record<string, string> = {}
  for (const f of fields) {
    const key = String(f.define_field_name ?? '').trim()
    if (!key) continue
    const header = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
    const raw = record ? getRowValueByField(record, key) : undefined
    out[header] = formatDefineFieldDisplayValue(
      raw,
      f.define_field_type,
      codesByField[key.toLowerCase()],
      ''
    )
  }
  return out
}

/** 현재 시설목록(레이어별)을 roadNetwork와 동일한 xlsx 서식으로 저장 */
export function exportWtlNetworkMapExcel(
  sheets: WtlNetworkExcelSheetInput[],
  fileName?: string
): void {
  const usable = sheets.filter((s) => s.rows.length > 0)
  if (usable.length === 0) return

  const wb = XLSX.utils.book_new()
  const usedNames = new Set<string>()

  for (const sheet of usable) {
    const fields = resolveExportFields(sheet.fields, sheet.rows[0])
    const data =
      fields.length > 0
        ? sheet.rows.map((r) => rowToExcelObject(r, fields, sheet.codesByField))
        : sheet.rows.map((r) => ({ 관리번호: r.name || '' }))
    const ws = XLSX.utils.json_to_sheet(data)
    const name = sanitizeSheetName(sheet.sheetName, usedNames)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  const stamp = wtlNetworkExcelStamp()
  XLSX.writeFile(wb, fileName ?? `${stamp}_관망조회.xlsx`)
}
