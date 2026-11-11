'use client'

import { listStoredConsAlerts, saveConsAlertSettings } from './WtlConsAlertSettingsDialog'

export const CONS_ALERT_OPEN_EVENT = 'ggnr-cons-alert-open'
const MIGRATED_KEY = 'wtl-cons-alert-migrated'

type LedgerKind = 'wtl' | 'swl'
type PendingOpen = { kind: LedgerKind; consCode: string }

let pendingOpen: PendingOpen | null = null
let migratePromise: Promise<void> | null = null

export function parseConsAlertNotifKey(
  notifKey: string
): { kind: LedgerKind; consCode: string } | null {
  const parts = notifKey.split(':')
  if (parts[0] !== 'cons-alert') return null
  const kind = parts[1] === 'swl' ? 'swl' : parts[1] === 'wtl' ? 'wtl' : null
  const consCode = String(parts[2] ?? '').trim()
  if (!kind || !consCode) return null
  return { kind, consCode }
}

/** 공사대장 화면이 아직 없으면, 열린 뒤에 이 값을 읽어 해당 공사를 선택한다 */
export function requestOpenConsFromAlert(kind: LedgerKind, consCode: string) {
  pendingOpen = { kind, consCode }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(CONS_ALERT_OPEN_EVENT, { detail: { kind, consCode } })
    )
  }
}

export function peekPendingConsAlert(kind: LedgerKind): string | null {
  if (!pendingOpen || pendingOpen.kind !== kind) return null
  return pendingOpen.consCode
}

export function clearPendingConsAlert(kind: LedgerKind) {
  if (pendingOpen?.kind === kind) pendingOpen = null
}

/** 이 브라우저에만 있던 알림설정을 서버로 한 번 옮긴다 */
export function migrateLocalConsAlertsOnce(): Promise<void> {
  if (typeof localStorage === 'undefined') return Promise.resolve()
  if (localStorage.getItem(MIGRATED_KEY) === '1') return Promise.resolve()
  if (migratePromise) return migratePromise
  migratePromise = (async () => {
    const stored = listStoredConsAlerts()
    for (const item of stored) {
      await saveConsAlertSettings(item.workId, item.settings, item.settings.kind, { notify: false })
    }
    localStorage.setItem(MIGRATED_KEY, '1')
  })().catch((e) => {
    migratePromise = null
    throw e
  })
  return migratePromise
}
