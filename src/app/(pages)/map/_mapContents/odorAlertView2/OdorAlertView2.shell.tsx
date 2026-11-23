'use client'

import { useEffect, useState } from 'react'
import { fromLonLat } from 'ol/proj'
import type { OdorAlertItem } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../_mapComponents/MapContext'
import { OdorAlertDetailBottomSheet } from '../odorDashboard2/OdorAlertDetailBottomSheet'
import { ODOR_DASHBOARD2_FLOAT_RIGHT_INSET } from '../odorDashboard2/odorDashboard2Config'
import type { OdorAlertRow } from '../odorAlert/odorAlertMock'
import { OdorAlertView2HistoryModal } from './OdorAlertView2HistoryModal'
import { OdorAlertView2ListPanel } from './OdorAlertView2ListPanel'
import {
  ODOR_ALERT_VIEW2_DETAIL_BOTTOM,
  ODOR_ALERT_VIEW2_DETAIL_GAP,
  ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH,
  ODOR_ALERT_VIEW2_LIST_MAX_WIDTH,
  ODOR_ALERT_VIEW2_LIST_MIN_WIDTH,
  ODOR_ALERT_VIEW2_SER_ENG,
} from './odorAlertView2Config'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

/**
 * 경보목록2 — 기존 standard 표·플로팅 상세/이력 UI + P21(odorAlertStore)
 */
export function OdorAlertView2Shell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
}: Props) {
  const mapContext = useMapContext()
  const [listWidth, setListWidth] = useState(ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailAlert, setDetailAlert] = useState<OdorAlertItem | null>(null)

  /** 상수 변경·HMR 시에도 기본 너비가 반영되도록 동기화 */
  useEffect(() => {
    setListWidth(ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH)
  }, [ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH])

  useEffect(() => {
    onTotalWidthChange(listWidth)
  }, [listWidth, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const handleSelectAlert = (alert: OdorAlertItem, source: OdorAlertRow) => {
    setDetailAlert(alert)
    const lon = source.lon
    const lat = source.lat
    const map = mapContext?.mapInstanceRef?.current
    if (!map || lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      return
    }
    const center = fromLonLat([lon, lat]) as [number, number]
    const zoom = Math.max(map.getView().getZoom() ?? 14, 15)
    scheduleAnimateMapToCenter3857(map, center, zoom, {
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    })
  }

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={ODOR_ALERT_VIEW2_LIST_MIN_WIDTH}
          maxWidth={ODOR_ALERT_VIEW2_LIST_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
          contentClassName="overflow-hidden"
          serEng={ODOR_ALERT_VIEW2_SER_ENG}
        >
          <OdorAlertView2ListPanel
            onClose={onClose}
            historyOpen={historyOpen}
            onToggleHistory={() => setHistoryOpen((v) => !v)}
            selectedAlertId={detailAlert?.id ?? null}
            onSelectAlert={handleSelectAlert}
          />
        </MapSideListPanel>
      </div>

      <OdorAlertDetailBottomSheet
        alert={detailAlert}
        leftPx={leftOffsetPx + listWidth + ODOR_ALERT_VIEW2_DETAIL_GAP}
        rightPx={ODOR_DASHBOARD2_FLOAT_RIGHT_INSET}
        bottomPx={ODOR_ALERT_VIEW2_DETAIL_BOTTOM}
        onClose={() => setDetailAlert(null)}
      />

      <OdorAlertView2HistoryModal
        open={historyOpen}
        leftPx={leftOffsetPx + listWidth}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  )
}
