'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapSideListPanel } from '@/app/(pages)/map/_mapComponents/MapSideListPanel'
import { useMapContext } from '@/app/(pages)/map/_mapComponents/MapContext'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { withBasePath } from '@/lib/basePath'
import {
  buildDashboardGradeMock,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { OdorControlMapPanel } from './OdorControlMapPanel'
import { OdorControlMapPointsLayer } from './OdorControlMapPointsLayer'
import { OdorControlMapPointPopup } from './OdorControlMapPointPopup'
import type { OdorControlMapPointInfo } from './odorControlMapPointTypes'
import {
  ODOR_CONTROL_MAP_PANEL_DEFAULT_WIDTH,
  ODOR_CONTROL_MAP_PANEL_MAX_WIDTH,
  ODOR_CONTROL_MAP_PANEL_MIN_WIDTH,
  ODOR_CONTROL_MAP_SER_ENG,
} from './odorControlMapConfig'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  onOpenAlert?: () => void
  /** 통합현황 등에서 넘어온 지점 — 진입 시 포커스·팝업 */
  initialFocusKey?: string | null
  /** 외부(레이아웃)에 남긴 진입 포커스 키를 비울 때 */
  onConsumeInitialFocus?: () => void
}

/**
 * 관제 지도 — 좌측 사이드 패널 + 본지도(투명 사이드바 아래 전체 지도).
 * 풀패널 오버레이를 쓰지 않고 경보 보기와 같은 MapSideListPanel 패턴.
 */
export function OdorControlMapShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  onOpenAlert,
  initialFocusKey = null,
  onConsumeInitialFocus,
}: Props) {
  const mapContext = useMapContext()
  const [panelWidth, setPanelWidth] = useState(ODOR_CONTROL_MAP_PANEL_DEFAULT_WIDTH)
  const [sensors, setSensors] = useState<OdorSensorListItem[]>([])
  const [focusKey, setFocusKey] = useState<string | null>(
    () => initialFocusKey?.trim() || null
  )
  const [alertOnly, setAlertOnly] = useState(false)
  const [showPoints, setShowPoints] = useState(true)
  const [selectedPoint, setSelectedPoint] = useState<OdorControlMapPointInfo | null>(null)
  const appliedInitialFocusRef = useRef<string | null>(null)
  const onConsumeInitialFocusRef = useRef(onConsumeInitialFocus)
  onConsumeInitialFocusRef.current = onConsumeInitialFocus

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

  const clearFocus = useCallback(() => {
    setFocusKey(null)
    setSelectedPoint(null)
    appliedInitialFocusRef.current = null
    onConsumeInitialFocusRef.current?.()
  }, [])

  useEffect(() => {
    if (!showPoints) clearFocus()
  }, [showPoints, clearFocus])

  const handleFocusKeyChange = useCallback(
    (key: string | null) => {
      /** 같은 행 재클릭 → 포커스 해제 */
      if (key && key === focusKey) {
        clearFocus()
        return
      }
      if (!key) {
        clearFocus()
        return
      }
      setFocusKey(key)
      const p = points.find((x) => {
        const k = x.id.startsWith('pt-') ? x.id.slice(3) : x.id
        return k === key
      })
      if (!p) {
        setSelectedPoint(null)
        return
      }
      setSelectedPoint({
        sensorKey: key,
        label: p.label,
        grade: p.grade,
        emdNm: p.emdNm,
        agency: p.agency,
        lon: p.lon,
        lat: p.lat,
      })
    },
    [points, focusKey, clearFocus]
  )

  /** 대시보드 미니맵에서 넘어온 지점 — 센서·포인트 준비 후 1회 포커스·팝업 */
  useEffect(() => {
    const key = initialFocusKey?.trim() || null
    if (!key || points.length === 0) return
    if (appliedInitialFocusRef.current === key) return
    appliedInitialFocusRef.current = key
    setFocusKey(key)
    const p = points.find((x) => {
      const k = x.id.startsWith('pt-') ? x.id.slice(3) : x.id
      return k === key
    })
    if (p) {
      setSelectedPoint({
        sensorKey: key,
        label: p.label,
        grade: p.grade,
        emdNm: p.emdNm,
        agency: p.agency,
        lon: p.lon,
        lat: p.lat,
      })
    }
    /** 레이아웃 키는 소비해 재진입 시 자동 포커스 방지 */
    onConsumeInitialFocusRef.current?.()
  }, [initialFocusKey, points])

  const handlePointSelect = useCallback(
    (point: OdorControlMapPointInfo | null) => {
      if (!point) {
        clearFocus()
        return
      }
      /** 같은 지점 재클릭 → 해제 */
      if (point.sensorKey === focusKey) {
        clearFocus()
        return
      }
      setSelectedPoint(point)
      setFocusKey(point.sensorKey)
    },
    [clearFocus, focusKey]
  )

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={panelWidth}
          minWidth={ODOR_CONTROL_MAP_PANEL_MIN_WIDTH}
          maxWidth={ODOR_CONTROL_MAP_PANEL_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setPanelWidth}
          contentClassName="overflow-hidden"
          serEng={ODOR_CONTROL_MAP_SER_ENG}
        >
          <OdorControlMapPanel
            sensors={sensors}
            focusKey={focusKey}
            onFocusKeyChange={handleFocusKeyChange}
            alertOnly={alertOnly}
            onAlertOnlyChange={setAlertOnly}
            showPoints={showPoints}
            onShowPointsChange={setShowPoints}
            onClose={onClose}
            onOpenAlert={onOpenAlert}
          />
        </MapSideListPanel>
      </div>
      <OdorControlMapPointsLayer
        sensors={sensors}
        showPoints={showPoints}
        alertOnly={alertOnly}
        focusKey={focusKey}
        onPointSelect={handlePointSelect}
      />
      {selectedPoint ? (
        <OdorControlMapPointPopup
          map={mapContext?.mapInstanceRef?.current ?? null}
          point={selectedPoint}
          onClose={clearFocus}
        />
      ) : null}
    </>
  )
}
