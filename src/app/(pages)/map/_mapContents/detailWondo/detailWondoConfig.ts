/** .fitimage 좌표계 — Bessel 동부원점 50만 */
export const DETAIL_WONDO_SRS = 'EPSG:5176'

export const DETAIL_WONDO_DEFAULT_OPACITY = 0.8

/** 도곽 경계 색 */
export const DETAIL_WONDO_FOOTPRINT_COLOR = '#b45309'
/** 지도 클릭 위치 원도 강조 색 */
export const DETAIL_WONDO_PICK_COLOR = '#dc2626'

export type DetailWondoCategory = '지적' | '임야' | ''

/** [x(동), y(북)] — EPSG:5176 */
export type DetailWondoCoord = [number, number]

export type DetailWondoItem = {
  id: string
  name: string
  title: string
  eupmyeon: string
  dong: string
  sheetNo: string
  area: string
  category: DetailWondoCategory
  pnu: string
  topLeft: DetailWondoCoord
  topRight: DetailWondoCoord
  bottomRight: DetailWondoCoord
  bottomLeft: DetailWondoCoord
}

export type DetailWondoShown = {
  id: string
  opacity: number
}

/** 읍면·동 선택 (빈 문자열 = 전체) */
export type DetailWondoArea = { eupmyeon: string; dong: string }

export function filterDetailWondoByArea(items: DetailWondoItem[], area: DetailWondoArea): DetailWondoItem[] {
  if (!area.eupmyeon && !area.dong) return items
  return items.filter(
    (it) => (!area.eupmyeon || it.eupmyeon === area.eupmyeon) && (!area.dong || it.dong === area.dong)
  )
}

export function detailWondoLabel(item: Pick<DetailWondoItem, 'dong' | 'sheetNo' | 'name'>): string {
  const label = [item.dong, item.sheetNo].filter(Boolean).join(' ')
  return label || item.name
}
