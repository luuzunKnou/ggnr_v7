'use client'

import { useEffect, useState } from 'react'
import { OdorDashboardShell } from '@/app/(pages)/map/_mapContents/odorDashboardV2/OdorDashboard.shell'
import {
  ODOR_DASHBOARD_V2_OPENED_KEY,
} from '@/app/(pages)/map/_mapContents/odorDashboardV2/odorDashboardConfig'
import { OdorControlMapShell } from '@/app/(pages)/map/_mapContents/odorControlMapV2/OdorControlMap.shell'
import { ODOR_CONTROL_MAP_V2_OPENED_KEY } from '@/app/(pages)/map/_mapContents/odorControlMapV2/odorControlMapConfig'
import { OdorAlertShell } from '@/app/(pages)/map/_mapContents/odorAlertV2/OdorAlert.shell'
import { ODOR_ALERT_V2_OPENED_KEY } from '@/app/(pages)/map/_mapContents/odorAlertV2/odorAlertConfig'
import { OdorComplaintShell } from '@/app/(pages)/map/_mapContents/odorComplaintV2/OdorComplaint.shell'
import { ODOR_COMPLAINT_V2_OPENED_KEY } from '@/app/(pages)/map/_mapContents/odorComplaintV2/odorComplaintConfig'

type Props = {
  openedWindows: string[]
  setOpened: (keys: string[]) => void
  leftOffsetPx: number
  /** 사이드 패널 합산 폭(풀오버레이는 0) — 지도 패딩용 */
  onTotalWidthChange: (width: number) => void
}

/**
 * 하수악취 통합관리시스템 V2 — 패널 호스트.
 * 프로토타입 UI는 odor*V2 / odorPhV2 에서만 수정해 V1과 merge 충돌을 피한다.
 */
export function OdorAdminV2Host({
  openedWindows,
  setOpened,
  leftOffsetPx,
  onTotalWidthChange,
}: Props) {
  const dashboardOpen = openedWindows.includes(ODOR_DASHBOARD_V2_OPENED_KEY)
  const controlMapOpen = openedWindows.includes(ODOR_CONTROL_MAP_V2_OPENED_KEY)
  const alertOpen = openedWindows.includes(ODOR_ALERT_V2_OPENED_KEY)
  const complaintOpen = openedWindows.includes(ODOR_COMPLAINT_V2_OPENED_KEY)

  const [dashboardW, setDashboardW] = useState(0)
  const [controlMapW, setControlMapW] = useState(0)
  const [alertW, setAlertW] = useState(0)
  const [complaintW, setComplaintW] = useState(0)
  const [controlMapFocusKey, setControlMapFocusKey] = useState<string | null>(null)

  useEffect(() => {
    if (!dashboardOpen) setDashboardW(0)
  }, [dashboardOpen])
  useEffect(() => {
    if (!controlMapOpen) setControlMapW(0)
  }, [controlMapOpen])
  useEffect(() => {
    if (!alertOpen) setAlertW(0)
  }, [alertOpen])
  useEffect(() => {
    if (!complaintOpen) setComplaintW(0)
  }, [complaintOpen])

  const total =
    (dashboardOpen ? dashboardW : 0) +
    (controlMapOpen ? controlMapW : 0) +
    (alertOpen ? alertW : 0) +
    (complaintOpen ? complaintW : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const dashboardLeft = leftOffsetPx
  const controlMapLeft = dashboardLeft + (dashboardOpen ? dashboardW : 0)
  const alertLeft = controlMapLeft + (controlMapOpen ? controlMapW : 0)
  const complaintLeft = alertLeft + (alertOpen ? alertW : 0)

  return (
    <>
      {dashboardOpen ? (
        <OdorDashboardShell
          leftOffsetPx={dashboardLeft}
          onTotalWidthChange={setDashboardW}
          onClose={() =>
            setOpened(openedWindows.filter((w) => w !== ODOR_DASHBOARD_V2_OPENED_KEY))
          }
          onOpenAlertList={() => setOpened([ODOR_ALERT_V2_OPENED_KEY])}
          onOpenControlMap={(sensorKey) => {
            setControlMapFocusKey(sensorKey?.trim() ? sensorKey.trim() : null)
            setOpened([ODOR_CONTROL_MAP_V2_OPENED_KEY])
          }}
          onOpenComplaint={() => setOpened([ODOR_COMPLAINT_V2_OPENED_KEY])}
        />
      ) : null}

      {controlMapOpen ? (
        <OdorControlMapShell
          leftOffsetPx={controlMapLeft}
          onTotalWidthChange={setControlMapW}
          onClose={() => {
            setControlMapFocusKey(null)
            setOpened(
              openedWindows.filter((w) => w !== ODOR_CONTROL_MAP_V2_OPENED_KEY)
            )
          }}
          onOpenAlert={() => setOpened([ODOR_ALERT_V2_OPENED_KEY])}
          initialFocusKey={controlMapFocusKey}
          onConsumeInitialFocus={() => setControlMapFocusKey(null)}
        />
      ) : null}

      {alertOpen ? (
        <OdorAlertShell
          leftOffsetPx={alertLeft}
          onTotalWidthChange={setAlertW}
          onClose={() =>
            setOpened(openedWindows.filter((w) => w !== ODOR_ALERT_V2_OPENED_KEY))
          }
          onOpenControlMap={() => {
            setControlMapFocusKey(null)
            setOpened([ODOR_CONTROL_MAP_V2_OPENED_KEY])
          }}
        />
      ) : null}

      {complaintOpen ? (
        <OdorComplaintShell
          leftOffsetPx={complaintLeft}
          onTotalWidthChange={setComplaintW}
          onClose={() =>
            setOpened(
              openedWindows.filter((w) => w !== ODOR_COMPLAINT_V2_OPENED_KEY)
            )
          }
          onOpenActionHistory={() => setOpened([ODOR_ALERT_V2_OPENED_KEY])}
        />
      ) : null}
    </>
  )
}
