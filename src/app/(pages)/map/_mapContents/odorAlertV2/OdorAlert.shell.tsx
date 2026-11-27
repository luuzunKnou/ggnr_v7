'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapSideListPanel } from '@/app/(pages)/map/_mapComponents/MapSideListPanel'
import { useMapContext } from '@/app/(pages)/map/_mapComponents/MapContext'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { withBasePath } from '@/lib/basePath'
import {
  MOCK_CAUTION_ALERTS,
  MOCK_RECENT_ALERTS,
  buildDashboardGradeMock,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { OdorControlMapPointsLayer } from '@/app/(pages)/map/_mapContents/odorControlMapV2/OdorControlMapPointsLayer'
import { OdorControlMapPointPopup } from '@/app/(pages)/map/_mapContents/odorControlMapV2/OdorControlMapPointPopup'
import type { OdorControlMapPointInfo } from '@/app/(pages)/map/_mapContents/odorControlMapV2/odorControlMapPointTypes'
import {
  ODOR_ALERT_PANEL_DEFAULT_WIDTH,
  ODOR_ALERT_PANEL_MAX_WIDTH,
  ODOR_ALERT_PANEL_MIN_WIDTH,
  ODOR_ALERT_SER_ENG,
  type OdorAlertKind,
} from './odorAlertConfig'
import { OdorAlertWorkPanel, type OdorAlertWorkRow } from './OdorAlertWorkPanel'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  onOpenControlMap?: () => void
}

function toWorkRows(items: OdorAlertItem[]): OdorAlertWorkRow[] {
  return items.map((a, i) => {
    const grade = (a.grade >= 3 ? a.grade : 3) as 3 | 4 | 5
    /** 일부는 장애(통신) 목업 — P21-09 */
    const kind: OdorAlertKind = i % 7 === 0 ? 'fault' : 'odor'
    return {
      id: a.id,
      sensorNm: a.sensorNm,
      sensorKorNm: a.sensorKorNm,
      agency: a.agency,
      grade,
      occurredAt: a.occurredAt,
      ppm: a.ppm,
      abatementRunning: a.abatementRunning,
      emdNm: a.emdNm,
      kind,
      acked: a.confirmed,
      recovered: a.confirmed && a.grade <= 3,
    }
  })
}

/**
 * P21 경보목록 — 좌측 사이드 패널 + 본지도 (관제 지도와 동일 뼈대)
 */
export function OdorAlertShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  onOpenControlMap,
}: Props) {
  const mapContext = useMapContext()
  const [panelWidth, setPanelWidth] = useState(ODOR_ALERT_PANEL_DEFAULT_WIDTH)
  const [sensors, setSensors] = useState<OdorSensorListItem[]>([])
  const [rows, setRows] = useState<OdorAlertWorkRow[]>(() =>
    toWorkRows([...MOCK_RECENT_ALERTS, ...MOCK_CAUTION_ALERTS])
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<OdorControlMapPointInfo | null>(null)

  const { points } = useMemo(() => buildDashboardGradeMock(sensors), [sensors])

  useEffect(() => {
    onTotalWidthChange(panelWidth)
  }, [panelWidth, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const loadSensors = useCallback(async () => {
    try {
      const res = await fetch(withBasePath('/api/odor/sensors'), {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const json = (await res.json()) as {
        success?: boolean
        data?: OdorSensorListItem[]
      }
      if (!res.ok || !json.success) {
        setSensors([])
        return
      }
      setSensors(Array.isArray(json.data) ? json.data : [])
    } catch {
      setSensors([])
    }
  }, [])

  useEffect(() => {
    void loadSensors()
  }, [loadSensors])

  const syncFocusFromAlert = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      if (!id) {
        setFocusKey(null)
        setSelectedPoint(null)
        return
      }
      const row = rows.find((r) => r.id === id)
      if (!row) return
      const key = row.sensorNm
      setFocusKey(key)
      const p = points.find((x) => {
        const k = x.id.startsWith('pt-') ? x.id.slice(3) : x.id
        return k === key || x.label.includes(row.sensorKorNm)
      })
      if (p) {
        const sensorKey = p.id.startsWith('pt-') ? p.id.slice(3) : p.id
        setSelectedPoint({
          sensorKey,
          label: p.label,
          grade: p.grade,
          emdNm: p.emdNm,
          agency: p.agency,
          lon: p.lon,
          lat: p.lat,
        })
        setFocusKey(sensorKey)
      } else {
        setSelectedPoint(null)
      }
    },
    [rows, points]
  )

  const handleAck = useCallback((ids: string[], reason: string) => {
    const at = new Date().toISOString()
    setRows((prev) =>
      prev.map((r) =>
        ids.includes(r.id)
          ? { ...r, acked: true, recovered: r.recovered || r.grade <= 3, ackReason: reason, ackedAt: at }
          : r
      )
    )
  }, [])

  const handlePointSelect = useCallback(
    (point: OdorControlMapPointInfo | null) => {
      setSelectedPoint(point)
      setFocusKey(point?.sensorKey ?? null)
      if (!point) {
        setSelectedId(null)
        return
      }
      const match = rows.find(
        (r) => r.sensorNm === point.sensorKey || r.sensorKorNm === point.label
      )
      setSelectedId(match?.id ?? null)
    },
    [rows]
  )

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={panelWidth}
          minWidth={ODOR_ALERT_PANEL_MIN_WIDTH}
          maxWidth={ODOR_ALERT_PANEL_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setPanelWidth}
          contentClassName="overflow-hidden"
          serEng={ODOR_ALERT_SER_ENG}
        >
          <OdorAlertWorkPanel
            rows={rows}
            selectedId={selectedId}
            onSelectId={syncFocusFromAlert}
            onAck={handleAck}
            onClose={onClose}
            onOpenControlMap={onOpenControlMap}
          />
        </MapSideListPanel>
      </div>
      <OdorControlMapPointsLayer
        sensors={sensors}
        showPoints
        alertOnly
        focusKey={focusKey}
        onPointSelect={handlePointSelect}
      />
      {selectedPoint ? (
        <OdorControlMapPointPopup
          map={mapContext?.mapInstanceRef?.current ?? null}
          point={selectedPoint}
          onClose={() => setSelectedPoint(null)}
        />
      ) : null}
    </>
  )
}
