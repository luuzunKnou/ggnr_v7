import * as XLSX from 'xlsx-js-style'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { WtlNetworkSaaMatrix } from './wtlNetworkTypes'

/** 화면 교차표와 동일(틀고정: 관재질·계 열 + 헤더·총계 행) */
const STICKY_COLS = 2

function fmtMeters(n: number) {
  return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type CellStyle = NonNullable<XLSX.CellObject['s']>

function thinBorder(): CellStyle['border'] {
  const side = { style: 'thin' as const, color: { rgb: 'CBD5E1' } }
  return { top: side, bottom: side, left: side, right: side }
}

function headerStyle(): CellStyle {
  return {
    font: { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: '0F172A' } },
    fill: { fgColor: { rgb: 'F1F5F9' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder(),
  }
}

function cellStyle(opts?: { bold?: boolean; align?: 'left' | 'center' | 'right' }): CellStyle {
  return {
    font: {
      name: '맑은 고딕',
      sz: 10,
      bold: opts?.bold ?? false,
      color: { rgb: '0F172A' },
    },
    alignment: {
      horizontal: opts?.align ?? 'center',
      vertical: 'center',
    },
    border: thinBorder(),
  }
}

function setCell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  v: string | number,
  style: CellStyle
) {
  const addr = XLSX.utils.encode_cell({ r, c })
  ws[addr] = { t: typeof v === 'number' ? 'n' : 's', v, s: style }
}

function injectFrozenPanes(
  xlsxBytes: Uint8Array,
  xSplit: number,
  ySplit: number,
  topLeftCell: string
): Uint8Array {
  const files = unzipSync(xlsxBytes)
  const paneXml =
    `<sheetViews>` +
    `<sheetView workbookViewId="0">` +
    `<pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeftCell}" activePane="bottomRight" state="frozen"/>` +
    `<selection pane="bottomRight" activeCell="${topLeftCell}" sqref="${topLeftCell}"/>` +
    `</sheetView>` +
    `</sheetViews>`

  for (const name of Object.keys(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) continue
    const raw = files[name]
    if (!raw) continue
    let xml = strFromU8(raw)
    if (/<sheetViews[\s\S]*?<\/sheetViews>/.test(xml)) {
      xml = xml.replace(/<sheetViews[\s\S]*?<\/sheetViews>/, paneXml)
    } else {
      xml = xml.replace(/(<dimension\b[^>]*\/>)/, `$1${paneXml}`)
    }
    files[name] = strToU8(xml)
  }
  return zipSync(files, { level: 6 })
}

function downloadXlsxBytes(data: Uint8Array, filename: string): void {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const blob = new Blob([copy], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function buildSheet(matrix: WtlNetworkSaaMatrix): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const headers = [
    '관재질\\관용도',
    '계',
    ...matrix.columns.map((col) => matrix.columnLabels[col] ?? col),
  ]
  const colCount = headers.length
  const hs = headerStyle()

  headers.forEach((h, c) => setCell(ws, 0, c, h, hs))

  matrix.rows.forEach((row, i) => {
    const r = 1 + i
    const bold = row.isTotal
    const left = cellStyle({ bold, align: 'left' })
    const num = cellStyle({ bold, align: 'right' })

    setCell(ws, r, 0, row.label, left)
    setCell(ws, r, 1, fmtMeters(row.total), num)
    matrix.columns.forEach((col, ci) => {
      setCell(ws, r, STICKY_COLS + ci, fmtMeters(row.lengths[col] ?? 0), num)
    })
  })

  const lastRow = matrix.rows.length
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(lastRow, 0), c: colCount - 1 },
  })
  ws['!cols'] = headers.map((_, idx) => {
    if (idx === 0) return { wch: 16 }
    if (idx === 1) return { wch: 12 }
    return { wch: 12 }
  })
  return ws
}

/** 현재 화면에 보이는 관용도 교차표(검색 조건 반영분)를 틀고정 포함 엑셀로 저장 */
export function exportWtlSaaMatrixExcel(matrix: WtlNetworkSaaMatrix): void {
  if (!matrix.rows.length) return

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildSheet(matrix), '관용도별연장')

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `관용도별_관로연장_${stamp}.xlsx`

  const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
  const hasTotal = matrix.rows[0]?.isTotal
  const ySplit = 1 + (hasTotal ? 1 : 0)
  const topLeft = XLSX.utils.encode_cell({ r: ySplit, c: STICKY_COLS })
  const frozen = injectFrozenPanes(new Uint8Array(raw), STICKY_COLS, ySplit, topLeft)
  downloadXlsxBytes(frozen, filename)
}
