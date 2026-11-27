/** 실시간 통합 현황 라이트 크롬 비교 (A 수정전 / B 수정후) */

export type OdorLightChromeId = 'a' | 'b'

export const ODOR_LIGHT_CHROME_STORAGE_KEY = 'odor-light-chrome'
export const ODOR_LIGHT_CHROME_ATTR = 'data-odor-light-chrome'

export const ODOR_LIGHT_CHROME_OPTIONS: Array<{
  id: OdorLightChromeId
  label: string
  title: string
}> = [
  { id: 'a', label: 'A', title: 'A · 수정전 (기존 라이트)' },
  { id: 'b', label: 'B', title: 'B · 수정후 (면 분리·테두리)' },
]

export function readOdorLightChrome(): OdorLightChromeId {
  try {
    const v = localStorage.getItem(ODOR_LIGHT_CHROME_STORAGE_KEY)
    if (v === 'a' || v === 'b') return v
  } catch {
    /* ignore */
  }
  return 'b'
}

export function applyOdorLightChrome(id: OdorLightChromeId) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute(ODOR_LIGHT_CHROME_ATTR, id)
  try {
    localStorage.setItem(ODOR_LIGHT_CHROME_STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}

export function clearOdorLightChromeAttr() {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute(ODOR_LIGHT_CHROME_ATTR)
}
