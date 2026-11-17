/** 저수조 이력 — his_extra 키 (wtl_tank_ps_solo 참고 DDL과 동일) */
export const TANK_HISTORY_EXTRA_KEYS = [
  'rsr_vol',
  'rsr_cde',
  'rsr_loc',
  'remark_solo',
] as const

export type TankHistoryExtraKey = (typeof TANK_HISTORY_EXTRA_KEYS)[number]

export type TankHistoryExtraFields = Record<TankHistoryExtraKey, string>

export const TANK_HISTORY_EXTRA_LABELS: Record<TankHistoryExtraKey, string> = {
  rsr_vol: '용량(m³)',
  rsr_cde: '재질',
  rsr_loc: '설치위치',
  remark_solo: '비고',
}

/** his_gubun(테이블명)이 저수조 계열인지 */
export function isTankHistoryGubun(hisGubun: string): boolean {
  const g = String(hisGubun ?? '')
    .trim()
    .toLowerCase()
  if (!g) return false
  if (g.includes('tank') || g.includes('rsrv')) return true
  return false
}

export function emptyTankHistoryExtra(): TankHistoryExtraFields {
  return {
    rsr_vol: '',
    rsr_cde: '',
    rsr_loc: '',
    remark_solo: '',
  }
}

export function parseTankHistoryExtra(
  raw: Record<string, unknown> | null | undefined
): TankHistoryExtraFields {
  const base = emptyTankHistoryExtra()
  if (!raw || typeof raw !== 'object') return base
  for (const key of TANK_HISTORY_EXTRA_KEYS) {
    const v = raw[key]
    if (v == null) continue
    base[key] = String(v).trim()
  }
  return base
}

/** 빈 값은 제외. 전부 비면 null */
export function buildTankHistoryExtra(
  fields: TankHistoryExtraFields
): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const key of TANK_HISTORY_EXTRA_KEYS) {
    const v = String(fields[key] ?? '').trim()
    if (v) out[key] = v
  }
  return Object.keys(out).length > 0 ? out : null
}
