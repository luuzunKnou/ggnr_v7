import * as XLSX from 'xlsx'
import { downloadExcelWithPledge } from '@/app/(pages)/_components/securityPledge/excelPledgeGate'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

/** yyyy-MM-dd HH:mm:ss (로컬) */
export function formatWtlExcelAsOf(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  )
}

/** yyyyMMddHHmmss (파일명) */
export function formatWtlExcelFileStamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  )
}

export type WtlListExcelSheetInput = {
  /** 시트 탭 이름 */
  sheetName: string
  /** 1행 제목 */
  title: string
  headers: string[]
  /** 헤더 순서와 동일한 행 값 */
  rows: string[][]
}

/**
 * 1행 제목 · 2행 기준일시 · 3행 헤더 · 4행~ 데이터.
 * 틀고정은 write 후 zip에 pane 주입.
 */
export function buildWtlListExcelSheet(
  input: WtlListExcelSheetInput,
  asOfLabel: string
): XLSX.WorkSheet {
  const headers =
    input.headers.length > 0 ? input.headers : ['(표시할 상세 필드 없음)']
  const aoa: (string | number)[][] = [
    [input.title],
    [`기준일시: ${asOfLabel}`],
    headers,
    ...input.rows.map((row) =>
      headers.map((_, i) => (row[i] != null ? String(row[i]) : ''))
    ),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const lastCol = Math.max(0, headers.length - 1)
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ]
  ws['!cols'] = headers.map((h) => ({
    wch: Math.min(40, Math.max(12, String(h).length + 2)),
  }))
  return ws
}

/** SheetJS community는 freeze 미지원 — sheetViews pane 주입 (헤더 행까지 고정) */
function injectFrozenHeaderRows(
  xlsxBytes: Uint8Array,
  ySplit: number,
  topLeftCell: string
): Uint8Array {
  const files = unzipSync(xlsxBytes)
  const paneXml =
    `<sheetViews>` +
    `<sheetView workbookViewId="0">` +
    `<pane ySplit="${ySplit}" topLeftCell="${topLeftCell}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="${topLeftCell}" sqref="${topLeftCell}"/>` +
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

function downloadXlsxBytes(
  data: Uint8Array,
  filename: string,
  opts?: { tableNames?: string[]; tableKorName?: string }
): void {
  downloadExcelWithPledge({
    data,
    fileName: filename,
    tableKorName:
      opts?.tableKorName || filename.replace(/\.xlsx?$/i, '') || '엑셀',
    tableNames: opts?.tableNames,
  })
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

/** 여러 시트 공통 서식으로 저장 (틀고정: 제목·기준일시·헤더) */
export function writeWtlListExcelWorkbook(args: {
  sheets: WtlListExcelSheetInput[]
  fileName: string
  asOf?: Date
  /** SHP/엑셀 다운로드 권한 조회용 레이어명 */
  tableNames?: string[]
  tableKorName?: string
}): void {
  const usable = args.sheets.filter(
    (s) => s.headers.length > 0 || s.rows.length > 0
  )
  if (usable.length === 0) return

  const asOf = args.asOf ?? new Date()
  const asOfLabel = formatWtlExcelAsOf(asOf)
  const wb = XLSX.utils.book_new()
  const usedNames = new Set<string>()

  for (const sheet of usable) {
    const name = sanitizeSheetName(sheet.sheetName, usedNames)
    XLSX.utils.book_append_sheet(
      wb,
      buildWtlListExcelSheet(sheet, asOfLabel),
      name
    )
  }

  const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
  // 1~3행 고정 → 데이터는 A4부터 스크롤
  const frozen = injectFrozenHeaderRows(new Uint8Array(raw), 3, 'A4')
  downloadXlsxBytes(frozen, args.fileName, {
    tableNames: args.tableNames,
    tableKorName: args.tableKorName,
  })
}
