/** 하수악취 관제 다크 팔레트 비교용 (A~C) */

export type OdorScadaPaletteId = 'b' | 'c'

export const ODOR_SCADA_PALETTE_STORAGE_KEY = 'odor-scada-palette'
export const ODOR_SCADA_PALETTE_ATTR = 'data-odor-scada-palette'

export const ODOR_SCADA_PALETTE_OPTIONS: Array<{
  id: OdorScadaPaletteId
  label: string
  title: string
}> = [
  { id: 'b', label: 'A', title: 'A · 콜드 SCADA' },
  { id: 'c', label: 'B', title: 'B · 미드나잇 운영' },
]

export function readOdorScadaPalette(): OdorScadaPaletteId {
  try {
    const v = localStorage.getItem(ODOR_SCADA_PALETTE_STORAGE_KEY)
    if (v === 'b' || v === 'c') return v
  } catch {
    /* ignore */
  }
  return 'c'
}

/** html.dark_v2 에 팔레트 data 속성 반영 (사이드바·패널 CSS 변수 공유) */
export function applyOdorScadaPalette(id: OdorScadaPaletteId) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute(ODOR_SCADA_PALETTE_ATTR, id)
  try {
    localStorage.setItem(ODOR_SCADA_PALETTE_STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}

export function clearOdorScadaPaletteAttr() {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute(ODOR_SCADA_PALETTE_ATTR)
}
