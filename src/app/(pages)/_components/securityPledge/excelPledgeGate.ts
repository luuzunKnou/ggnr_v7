/**
 * 엑셀 다운로드 → 보안서약 게이트 (클라이언트 생성 바이트 업로드).
 */

export type ExcelPledgeRequest = {
  fileName: string
  tableKorName: string
  /** xlsx/xls/csv bytes */
  bytes: Uint8Array
}

type Opener = (req: ExcelPledgeRequest) => void

/** Turbopack/청크 중복 모듈에서도 같은 Host를 보게 globalThis에 둔다 */
const EXCEL_PLEDGE_OPENER_KEY = '__ggnrExcelPledgeOpener__'

type ExcelPledgeGlobal = typeof globalThis & {
  [EXCEL_PLEDGE_OPENER_KEY]?: Opener | null
}

function getExcelOpener(): Opener | null {
  return (globalThis as ExcelPledgeGlobal)[EXCEL_PLEDGE_OPENER_KEY] ?? null
}

export function registerExcelPledgeOpener(fn: Opener | null): void {
  ;(globalThis as ExcelPledgeGlobal)[EXCEL_PLEDGE_OPENER_KEY] = fn
}

export function requestExcelPledge(req: ExcelPledgeRequest): boolean {
  const opener = getExcelOpener()
  if (!opener) return false
  opener(req)
  return true
}

function toUint8(data: Uint8Array | ArrayBuffer | Blob | number[]): Promise<Uint8Array> | Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(data)
  return data.arrayBuffer().then((ab) => new Uint8Array(ab))
}

/**
 * 엑셀 저장(다운로드) 공통 싱크 — 서약 모달 후 데이터요청 접수.
 * Host 미등록 시에만 브라우저 직접 저장으로 폴백.
 */
export function downloadExcelWithPledge(args: {
  data: Uint8Array | ArrayBuffer | Blob
  fileName: string
  tableKorName?: string
}): void {
  const fileName = String(args.fileName ?? '').trim() || 'download.xlsx'
  const tableKorName =
    String(args.tableKorName ?? '').trim() ||
    fileName.replace(/\.(xlsx|xls|csv)$/i, '') ||
    '엑셀'

  const run = (bytes: Uint8Array) => {
    if (requestExcelPledge({ fileName, tableKorName, bytes })) return
    // Host 미등록(청크 분리·HMR 등) — 조용히 직접 저장하지 않고 안내
    console.warn(
      '[downloadExcelWithPledge] SecurityPledgeExcelHost 미등록 — 서약 없이 저장하지 않음'
    )
    window.alert(
      '보안서약 화면을 열 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
    )
  }

  const converted = toUint8(args.data)
  if (converted instanceof Promise) {
    void converted.then(run).catch((e) => {
      console.error('[downloadExcelWithPledge]', e)
      window.alert('엑셀 준비에 실패했습니다.')
    })
    return
  }
  run(converted)
}

/** Workbook → 바이트 후 서약 다운로드 (xlsx / xlsx-js-style 공통) */
export function writeExcelWorkbookWithPledge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: { write: (wb: any, opts: { type: 'array'; bookType: 'xlsx' }) => ArrayBuffer | Uint8Array },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb: any,
  fileName: string,
  tableKorName?: string
): void {
  const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  downloadExcelWithPledge({ data: bytes, fileName, tableKorName })
}
