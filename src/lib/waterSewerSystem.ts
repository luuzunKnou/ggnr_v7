/** 상·하수도(상하수) 시스템 sys_key — 수용가·검침 등 상하수 전용 UI 노출 판단 */
const WATER_SEWER_SYSTEM_KEYS = new Set(["wtl", "swl", "water"]);

export function isWaterSewerSystem(systemKey: string | null | undefined): boolean {
  const key = String(systemKey ?? "").trim().toLowerCase();
  return key.length > 0 && WATER_SEWER_SYSTEM_KEYS.has(key);
}
