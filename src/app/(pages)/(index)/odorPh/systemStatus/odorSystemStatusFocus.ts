/** 지도 대시보드2로 지점 포커스 전달 (세션 동안) */

const STORAGE_KEY = 'odor_system_status_focus_sensor'

export function setPendingOdorStationFocus(sensorKey: number): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(sensorKey))
  } catch {
    /* ignore */
  }
}

export function consumePendingOdorStationFocus(): string | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY)
    if (!v) return null
    window.sessionStorage.removeItem(STORAGE_KEY)
    return v
  } catch {
    return null
  }
}
