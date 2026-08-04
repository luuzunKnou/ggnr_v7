/**
 * 지하수 개발허가 상태 — DB 컬럼이 아니라 속성으로 자동 계산.
 * 우선순위(위→아래 첫 일치):
 * 1. 허가취소 = Y → 허가취소
 * 2. 폐공발생일 존재 → 폐공
 * 3. 종료신고일 존재 → 종료
 * 4. 준공처리여부 = N → 준공대기  (만료보다 우선)
 * 5. 허가유효종료일 < 오늘 → 유효기간만료
 * 6. 그 외 → 사용중
 */

export type GroundwaterPermitStatusCode =
  | 'cancelled'
  | 'abandoned'
  | 'ended'
  | 'pendingCompletion'
  | 'expired'
  | 'inUse'

export type GroundwaterPermitStatusLabel =
  | '허가취소'
  | '폐공'
  | '종료'
  | '준공대기'
  | '유효기간만료'
  | '사용중'

export type GroundwaterPermitStatus = {
  code: GroundwaterPermitStatusCode
  label: GroundwaterPermitStatusLabel
}

export type GroundwaterPermitStatusInput = {
  permit_cancel?: string | null
  abandon_date?: string | null
  end_report_date?: string | null
  completion_process_yn?: string | null
  permit_end_date?: string | null
}

function hasText(value: string | null | undefined): boolean {
  const s = String(value ?? '').trim()
  return s.length > 0 && s !== '-'
}

/** 허가취소 = Y (원본에 «허가취소» 문구만 있는 경우 포함) */
function isPermitCancelled(value: string | null | undefined): boolean {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '-') return false
  const s = raw.toUpperCase()
  if (s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1' || raw === '예') return true
  return raw.includes('허가취소')
}

/**
 * 준공처리여부 = N → 준공대기
 * 원본 CSV는 Y/N 대신 «미준공» / «준공» 표기를 쓰는 경우가 많음
 */
function isPendingCompletion(value: string | null | undefined): boolean {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '-') return false
  const s = raw.toUpperCase()
  if (s === 'N' || s === 'NO' || s === 'FALSE' || s === '0' || raw === '아니오') return true
  if (raw.includes('미준공')) return true
  return false
}

/** YYYYMMDD / YYYY-MM-DD → YYYYMMDD, 파싱 실패 시 null */
export function parseYmd(value: string | null | undefined): string | null {
  if (!hasText(value)) return null
  const digits = String(value).replace(/\D/g, '')
  if (digits.length < 8) return null
  const ymd = digits.slice(0, 8)
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(4, 6))
  const d = Number(ymd.slice(6, 8))
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null
  return ymd
}

function todayYmd(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

export function resolveGroundwaterPermitStatus(
  row: GroundwaterPermitStatusInput,
  now: Date = new Date()
): GroundwaterPermitStatus {
  if (isPermitCancelled(row.permit_cancel)) {
    return { code: 'cancelled', label: '허가취소' }
  }
  if (hasText(row.abandon_date)) {
    return { code: 'abandoned', label: '폐공' }
  }
  if (hasText(row.end_report_date)) {
    return { code: 'ended', label: '종료' }
  }
  if (isPendingCompletion(row.completion_process_yn)) {
    return { code: 'pendingCompletion', label: '준공대기' }
  }
  const end = parseYmd(row.permit_end_date)
  if (end && end < todayYmd(now)) {
    return { code: 'expired', label: '유효기간만료' }
  }
  return { code: 'inUse', label: '사용중' }
}

export function groundwaterPermitStatusClass(code: GroundwaterPermitStatusCode): string {
  switch (code) {
    case 'inUse':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    case 'pendingCompletion':
      return 'bg-sky-50 text-sky-700 ring-sky-200'
    case 'expired':
      return 'bg-amber-50 text-amber-800 ring-amber-200'
    case 'ended':
      return 'bg-slate-100 text-slate-600 ring-slate-200'
    case 'abandoned':
      return 'bg-rose-50 text-rose-700 ring-rose-200'
    case 'cancelled':
      return 'bg-orange-50 text-orange-700 ring-orange-200'
    default:
      return 'bg-slate-50 text-slate-600 ring-slate-200'
  }
}

/** 표시용 날짜 YYYY-MM-DD (실패 시 원문 trim) */
export function formatGroundwaterPermitDate(value: string | null | undefined): string {
  const ymd = parseYmd(value)
  if (!ymd) {
    const s = String(value ?? '').trim()
    return s
  }
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}
