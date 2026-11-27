/**
 * 하수악취 시스템별 기본 opened.
 * V1은 git 기본(자동 오픈 없음). V2 프로토타입만 기본 대시보드.
 */
const DEFAULT_OPENED_BY_SYSTEM: Record<string, string> = {
  odorAdminV2: 'odorDashboardV2',
}

export function applyOdorSystemDefaultOpened(
  params: URLSearchParams,
  systemKey: string
): void {
  const defaultOpened = DEFAULT_OPENED_BY_SYSTEM[systemKey]
  if (!defaultOpened) return
  const opened = (params.get('opened') ?? '').split(',').filter(Boolean)
  if (opened.length > 0) return
  params.set('opened', defaultOpened)
}

export const ODOR_SYSTEM_KEYS = Object.keys(DEFAULT_OPENED_BY_SYSTEM)
