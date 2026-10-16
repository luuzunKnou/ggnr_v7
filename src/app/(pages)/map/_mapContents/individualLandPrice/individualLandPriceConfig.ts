/** serviceList.ser_eng / systemList 메뉴 키와 동일 */
export const INDIVIDUAL_LAND_PRICE_OPENED_KEY = 'individualLandPrice'
export const INDIVIDUAL_LAND_PRICE_SERVICE = 'individualLandPriceService'

export const INDIVIDUAL_LAND_PRICE_PANEL_DEFAULT_WIDTH = 300
export const INDIVIDUAL_LAND_PRICE_PANEL_MIN_WIDTH = 280
export const INDIVIDUAL_LAND_PRICE_PANEL_MAX_WIDTH = 900
export const INDIVIDUAL_LAND_PRICE_DETAIL_DEFAULT_WIDTH = 420
export const INDIVIDUAL_LAND_PRICE_DETAIL_MIN_WIDTH = 360
export const INDIVIDUAL_LAND_PRICE_DETAIL_MAX_WIDTH = 760

/** 상세 필지로 이동할 때 이보다 축소돼 있으면 필지까지 확대한다(m/px) */
export const LAND_PRICE_FOCUS_MAX_RESOLUTION = 2

export type LandPriceSortKey = 'pnu' | 'price'

export type LandPriceYear = { year: string; count: number }

export type LandPriceEmd = { emdCd: string; emdName: string; count: number }

export type LandPriceRow = {
  pnu: string
  location: string
  lot: string
  price: number | null
  standardYn: string
  announceDate: string
}

export type LandPriceHistoryRow = {
  year: string
  baseMonth: string
  price: number | null
  changeRate: number | null
  announceDate: string
  note: string
}

export type LandPriceParcelDetail = {
  pnu: string
  location: string
  lot: string
  jimok: string
  areaSqm: number | null
  standardYn: string
  geometry: unknown
  extent: [number, number, number, number] | null
  history: LandPriceHistoryRow[]
  historySource: 'koreps' | 'file' | 'vworld'
  historyMessage: string
}

export type LandPriceMemo = {
  memoKey: number
  contents: string
  createDate: string
  createUser: string
  mine: boolean
}

export function formatWon(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('ko-KR')
}

export function formatRate(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export function rateClassName(n: number | null | undefined): string {
  if (n == null || n === 0) return 'text-muted-foreground'
  return n > 0 ? 'text-red-600' : 'text-blue-600'
}

/** «20260430» → «2026-04-30» */
export function formatYmd(s: string): string {
  const d = s.replace(/\D/g, '')
  if (d.length !== 8) return s || '—'
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

export function isStandardYn(s: string): boolean {
  const v = s.trim().toUpperCase()
  return v === 'Y' || v === '1'
}

export function formatStandardYn(s: string): string {
  const v = s.trim().toUpperCase()
  if (isStandardYn(v)) return '표준지'
  if (v === 'N' || v === '0' || v === '') return '아니오'
  return s
}

export function parcelAddress(row: { location: string; lot: string }): string {
  return [row.location, row.lot].filter(Boolean).join(' ')
}
