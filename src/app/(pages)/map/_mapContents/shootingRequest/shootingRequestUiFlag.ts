/** UAV 조회·관리 시스템 키 판별 (runtime ENABLED_SYSTEMS·사이드바 system 기준) */

export const UAV_VIEW_SYSTEM_KEY = 'uav_view'
export const UAV_ADMIN_SYSTEM_KEY = 'uav'

const UAV_FAMILY_KEYS = new Set([UAV_VIEW_SYSTEM_KEY, UAV_ADMIN_SYSTEM_KEY])

export function normalizeUavSystemKey(key: string | null | undefined): string {
  return String(key ?? '').trim().toLowerCase()
}

/** 조회·관리 중 하나라도 UAV 계열이면 true */
export function isUavFamilySystemKey(key: string | null | undefined): boolean {
  return UAV_FAMILY_KEYS.has(normalizeUavSystemKey(key))
}

/** 관리 시스템만 */
export function isUavAdminSystemKey(key: string | null | undefined): boolean {
  return normalizeUavSystemKey(key) === UAV_ADMIN_SYSTEM_KEY
}

/** runtime·getSystemList 기준 UAV 계열 노출 여부 */
export function isUavSystemEnabledInList(
  systems: { sys_key?: string }[] | null | undefined
): boolean {
  if (!Array.isArray(systems)) return false
  return systems.some((s) => isUavFamilySystemKey(s.sys_key))
}
