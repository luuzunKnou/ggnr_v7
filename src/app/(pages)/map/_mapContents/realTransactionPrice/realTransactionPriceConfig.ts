/** serviceList.ser_eng / systemList 메뉴 키와 동일 */
export const REAL_TRANSACTION_PRICE_OPENED_KEY = 'realTransactionPrice'
export const REAL_TRANSACTION_PRICE_SERVICE = 'realTransactionPriceService'

export const REAL_TRANSACTION_PRICE_PANEL_DEFAULT_WIDTH = 350
export const REAL_TRANSACTION_PRICE_PANEL_MIN_WIDTH = 300
export const REAL_TRANSACTION_PRICE_PANEL_MAX_WIDTH = 900
export const REAL_TRANSACTION_PRICE_DETAIL_DEFAULT_WIDTH = 420
export const REAL_TRANSACTION_PRICE_DETAIL_MIN_WIDTH = 360
export const REAL_TRANSACTION_PRICE_DETAIL_MAX_WIDTH = 760

export type DongSortKey = 'umdNm' | 'count' | 'avgPerSqm'

export type DongSummaryRow = {
  umdNm: string
  emdCd: string | null
  count: number
  medianPerSqm: number | null
  avgPerSqm: number | null
  totalAmountMan: number
}

export type LandTradeRow = {
  umdNm: string
  jibun: string
  jimok: string
  landUse: string
  dealArea: number | null
  dealAmountMan: number | null
  perSqm: number | null
  dealDate: string
  dealingGbn: string
  shareDealingType: string
}

export type DongMapFeature = DongSummaryRow & {
  wkt: string
  center: { x: number; y: number } | null
}

export function formatWon(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('ko-KR')
}

/** 지도 라벨용 — 1250000 → «1,250,000원/m²» */
export function formatMapPriceLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return ''
  return `${formatWon(Math.round(n))}원/m²`
}

/** 만원 단위 → «1억 2,000만» 짧은 표기 */
export function formatManWon(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const won = Math.round(n)
  if (won >= 10_000) {
    const eok = Math.floor(won / 10_000)
    const man = won % 10_000
    if (man === 0) return `${eok.toLocaleString('ko-KR')}억`
    return `${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만`
  }
  return `${won.toLocaleString('ko-KR')}만`
}

export function formatArea(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}㎡`
}

export function defaultDealYmd(now = new Date()): string {
  // 신고 시차 고려 — 기본은 전월
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}${m}`
}

export function dealYmdParts(dealYmd: string): { year: string; month: string } {
  const d = dealYmd.replace(/\D/g, '')
  if (d.length !== 6) return { year: '', month: '' }
  return { year: d.slice(0, 4), month: d.slice(4, 6) }
}

export function dealYmdLabel(dealYmd: string): string {
  const { year, month } = dealYmdParts(dealYmd)
  if (!year || !month) return ''
  return `${year}.${month}`
}

export function yearOptions(now = new Date()): string[] {
  const y = now.getFullYear()
  const out: string[] = []
  for (let i = 0; i < 8; i++) out.push(String(y - i))
  return out
}

export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, '0')
)

/** 중간가 상대값 → 채우기 색 (낮음=노랑, 높음=주황빨강) */
export function priceFillRgba(value: number | null, min: number, max: number, selected: boolean): string {
  const alpha = selected ? 0.55 : 0.38
  if (value == null || !Number.isFinite(value) || max <= min) {
    return `rgba(251, 146, 60, ${alpha})`
  }
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
  // #fde68a → #ea580c
  const r = Math.round(253 + (234 - 253) * t)
  const g = Math.round(230 + (88 - 230) * t)
  const b = Math.round(138 + (12 - 138) * t)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
