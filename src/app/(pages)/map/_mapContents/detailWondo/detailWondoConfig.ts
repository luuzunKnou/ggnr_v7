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
  world?: [number, number, number, number, number, number]
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

export function detailWondoLabel(item: Pick<DetailWondoItem, 'dong' | 'sheetNo'>): string {
  return [item.dong, item.sheetNo].filter(Boolean).join(' ') || '원도'
}

const EUPMYEON_RE = /(읍|면)$/
const DONG_RE = /(동|리|가)$/
const FOLDER_JUNK_RE = /^(리사이즈|resize|attributes|of에|좌표없어서|나중에|묻기)$/i

/**
 * 폴더명에서 읍면·동만 뽑는다.
 * «… 천전동(경상북도 안동군 예안면 천전동)_리사이즈(0)» → 예안면 / 천전동
 * 괄호 안이 현재 행정구역이면 그 값을 쓰고, 없으면 괄호 밖 이름만 쓴다.
 */
export function parseDetailWondoFolderName(raw: string): { eupmyeon: string; dong: string } {
  let s = String(raw ?? '')
  s = s.replace(/_리사이즈.*$/u, '').replace(/_resize.*$/i, '')
  const inners = [...s.matchAll(/\(([^()]*)\)/g)]
    .map((m) => m[1].trim())
    .filter((t) => t && !/^\d+$/.test(t) && /(읍|면|동|리)/.test(t))
  const source = inners.length > 0 ? inners[inners.length - 1] : s.replace(/\([^()]*\)/g, '')
  const parts = source
    .replace(/[()]/g, ' ')
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !FOLDER_JUNK_RE.test(p) && !/^\d+$/.test(p))
  let dong = ''
  let eupmyeon = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!dong && DONG_RE.test(parts[i])) dong = parts[i]
    else if (!eupmyeon && EUPMYEON_RE.test(parts[i])) eupmyeon = parts[i]
    if (dong && eupmyeon) break
  }
  if (!dong) dong = parts[parts.length - 1] ?? ''
  return { eupmyeon, dong }
}

/** 목록 id(상대 경로)의 원도 폴더명에서 읍면·동을 다시 읽는다 */
export function placeFromDetailWondoId(id: string): { eupmyeon: string; dong: string } {
  const segs = id.replace(/\\/g, '/').split('/').filter(Boolean)
  segs.pop()
  const folder = segs.pop() ?? ''
  const parsed = parseDetailWondoFolderName(folder)
  const dirEup = [...segs].reverse().find((s) => EUPMYEON_RE.test(s)) ?? ''
  return { eupmyeon: parsed.eupmyeon || dirEup, dong: parsed.dong }
}

export function withDetailWondoDisplayNumbers(items: DetailWondoItem[]): DetailWondoItem[] {
  const sorted = [...items]
    .map((it) => {
      const place = placeFromDetailWondoId(it.id)
      return {
        ...it,
        dong: place.dong || it.dong.replace(/[()]/g, '').trim(),
        eupmyeon: place.eupmyeon || it.eupmyeon.replace(/[()]/g, '').trim(),
      }
    })
    .sort(
    (a, b) =>
      a.category.localeCompare(b.category, 'ko') ||
      a.eupmyeon.localeCompare(b.eupmyeon, 'ko') ||
      a.dong.localeCompare(b.dong, 'ko') ||
      a.id.localeCompare(b.id, 'ko')
  )
  let key = '\0'
  let n = 0
  return sorted.map((it) => {
    const k = `${it.category}\0${it.eupmyeon}\0${it.dong}`
    if (k !== key) {
      key = k
      n = 0
    }
    n += 1
    return { ...it, sheetNo: String(n), title: it.dong ? `${it.dong} ${n}` : String(n) }
  })
}
