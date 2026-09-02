/** runtime ENABLED_SYSTEMS·getSystemList 기준 UAV(sys_key=uav) 노출 여부 */
export function isUavSystemEnabledInList(
  systems: { sys_key?: string }[] | null | undefined
): boolean {
  if (!Array.isArray(systems)) return false
  return systems.some((s) => String(s.sys_key ?? '').trim().toLowerCase() === 'uav')
}
