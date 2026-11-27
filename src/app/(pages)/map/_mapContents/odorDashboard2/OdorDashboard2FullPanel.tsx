'use client'

import { useMemo, useState } from 'react'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import {
  buildDashboardGradeMock,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { OdorGradeDistributionPanel } from './panels/OdorGradeDistributionPanel'
import { OdorDeviceStatusPanel } from './panels/OdorDeviceStatusPanel'
import { OdorCautionAlertList } from './panels/OdorCautionAlertList'
import { OdorRecentAlertList } from './panels/OdorRecentAlertList'
import type { OdorStationRow } from './odorDashboard2StationRows'

type Props = {
  sensors: OdorSensorListItem[]
  /** «경보목록» 클릭 — 경보 모달 열기 */
  onOpenAlertModal?: () => void
  onSelectStation?: (row: OdorStationRow | null) => void
  onSelectAlert?: (alert: OdorAlertItem) => void
  selectedSensorKey?: string | null
  selectedAlertId?: string | null
}

/** 대시보드2 풀패널 — Index 구성과 동일 격자, 지점 목록은 대시보드2 전용 */
export function OdorDashboard2FullPanel({
  sensors,
  onOpenAlertModal,
  onSelectStation,
  onSelectAlert,
  selectedSensorKey = null,
  selectedAlertId = null,
}: Props) {
  const { gradeCounts, points, emdStatuses } = useMemo(
    () => buildDashboardGradeMock(sensors),
    [sensors]
  )
  const [highlight, setHighlight] = useState<string | null>(selectedSensorKey)

  const selected = selectedSensorKey ?? highlight

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-hidden lg:grid-cols-[minmax(0,0.95fr)_minmax(280px,1.15fr)]">
      <OdorGradeDistributionPanel
        counts={gradeCounts}
        points={points}
        emdStatuses={emdStatuses}
        sensors={sensors}
        highlightSensorKey={selected}
        belowCards={
          <OdorDeviceStatusPanel
            sensors={sensors}
            points={points}
            selectedSensorKey={selected}
            onSelectStation={(row) => {
              setHighlight(row?.id ?? null)
              onSelectStation?.(row)
            }}
          />
        }
      />
      <div className="grid min-h-0 grid-rows-2 gap-2 overflow-hidden">
        <OdorRecentAlertList
          onGoAlertList={onOpenAlertModal}
          onSelectAlert={onSelectAlert}
          selectedAlertId={selectedAlertId}
        />
        <OdorCautionAlertList
          onGoAlertList={onOpenAlertModal}
          onSelectAlert={onSelectAlert}
          selectedAlertId={selectedAlertId}
        />
      </div>
    </div>
  )
}
