'use client'

/**
 * odor-index 전용 — 미인지 경보를 내 정보 알림 목록에 목업 시드
 */

import {
  getProtoNotifs,
  setProtoNotifs,
  type ProtoNotifItem,
} from '@/app/(pages)/map/_mapContents/bizNotif/bizNotifStore'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  ODOR_ALERT_SER_ENG,
  type OdorAlertGrade,
} from '@/app/(pages)/map/_mapContents/odorAlertV2/odorAlertConfig'
import { createOdorAlertMockRows } from '@/app/(pages)/map/_mapContents/odorAlertV2/odorAlertMock'

const SEED_PREFIX = 'odor-alert-notif-'
let seeded = false

function alertToNotif(alert: ReturnType<typeof createOdorAlertMockRows>[number]): ProtoNotifItem {
  const kindLabel = ODOR_ALERT_KIND_LABEL[alert.kind]
  const gradeLabel =
    alert.grade != null ? ODOR_ALERT_GRADE_LABEL[alert.grade as OdorAlertGrade] : '등급없음'
  return {
    id: `${SEED_PREFIX}${alert.id}`,
    category: '경보',
    title: `${alert.sensorLabel} ${kindLabel}`,
    name: `${alert.agency} ${alert.emdNm}`,
    listKey: gradeLabel,
    read: false,
    important: alert.grade != null && alert.grade >= 4,
    target: 'ledger',
    targetId: alert.id,
    notifKey: `odor-alert:${alert.id}`,
    systemScope: 'odorAdmin',
    serEng: ODOR_ALERT_SER_ENG,
  }
}

/** 세션당 1회 — 기존 알림에 경보 목업을 병합 */
export function seedOdorIndexAlertNotifs(max = 5): void {
  if (typeof window === 'undefined' || seeded) return
  seeded = true

  const existing = getProtoNotifs().filter((n) => !n.id.startsWith(SEED_PREFIX))
  const unacked = createOdorAlertMockRows()
    .filter((a) => !a.acked)
    .slice(0, max)
    .map(alertToNotif)

  setProtoNotifs([...unacked, ...existing])
}

export function isOdorAlertNotif(item: ProtoNotifItem): boolean {
  return item.category === '경보' || item.id.startsWith(SEED_PREFIX)
}
