'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { fromLonLat } from 'ol/proj'
import { History, X } from 'lucide-react'
import type { OdorAlertItem } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { cn } from '@/lib/utils'
import { MapFloatResizableFrame } from '../../_mapComponents/MapFloatResizableFrame'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../_mapComponents/MapContext'
import { MAP_LAYER_PANEL_SURFACE_CLASS } from '../../_mapComponents/mapControlPanel/mapLayerPanelLayout'
import {
  ODOR_MAP_FLOAT_SURFACE_OPACITY_RESET_CLASS,
  odorMapFloatBodyOpacityStyle,
  odorMapFloatHeaderOpacityStyle,
} from '../odorMapFloatOpacity'
import { OdorAlertDetailBottomSheet } from '../odorDashboard2/OdorAlertDetailBottomSheet'
import { ODOR_DASHBOARD2_FLOAT_RIGHT_INSET } from '../odorDashboard2/odorDashboard2Config'
import { useOdorMapPointRadarHighlight } from '../odorDashboard2/useOdorMapPointRadarHighlight'
import type { OdorAckHistoryRow, OdorAlertRow } from '../odorAlert/odorAlertMock'
import { useOdorAlertStore } from '../odorAlert/odorAlertStore'
import { OdorAlertView2HistoryModal } from './OdorAlertView2HistoryModal'
import { OdorAlertView2HistoryPanel } from './OdorAlertView2HistoryPanel'
import { OdorAlertView2ListPanel } from './OdorAlertView2ListPanel'
import { odorAlertRowToViewItem } from './odorAlertView2Map'
import {
  ODOR_ALERT_VIEW2_DETAIL_BOTTOM,
  ODOR_ALERT_VIEW2_DETAIL_GAP,
  ODOR_ALERT_VIEW2_DETAIL_HEIGHT_VH,
  ODOR_ALERT_VIEW2_FLOAT_HISTORY_DETAIL_GAP,
  ODOR_ALERT_VIEW2_FLOAT_HISTORY_GAP,
  ODOR_ALERT_VIEW2_FLOAT_HISTORY_WIDTH,
  ODOR_ALERT_VIEW2_FLOAT_LEFT_INSET,
  ODOR_ALERT_VIEW2_FLOAT_MAX_WIDTH,
  ODOR_ALERT_VIEW2_FLOAT_MIN_WIDTH,
  ODOR_ALERT_VIEW2_FLOAT_TOP,
  ODOR_ALERT_VIEW2_FLOAT_WIDTH,
  ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH,
  ODOR_ALERT_VIEW2_LIST_MAX_WIDTH,
  ODOR_ALERT_VIEW2_LIST_MIN_WIDTH,
  ODOR_ALERT_VIEW2_SER_ENG,
  ODOR_ALERT_VIEW2_UI_MODE_OPTIONS,
  ODOR_ALERT_VIEW2_UI_MODE_STORAGE_KEY,
  type OdorAlertView2UiMode,
} from './odorAlertView2Config'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

function readStoredUiMode(): OdorAlertView2UiMode {
  if (typeof window === 'undefined') return 'floating'
  try {
    const raw = window.localStorage.getItem(ODOR_ALERT_VIEW2_UI_MODE_STORAGE_KEY)
    if (raw === 'legacy' || raw === 'floating') return raw
  } catch {
    /* ignore */
  }
  return 'floating'
}

function UiModeSelect({
  id,
  value,
  onChange,
  className,
}: {
  id: string
  value: OdorAlertView2UiMode
  onChange: (v: OdorAlertView2UiMode) => void
  className?: string
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        경보목록2 UI
      </label>
      <select
        id={id}
        title="경보목록2 UI"
        value={value}
        onChange={(e) => onChange(e.target.value as OdorAlertView2UiMode)}
        className={cn(
          'h-7 max-w-[9.5rem] cursor-pointer rounded border px-1.5 text-[11px]',
          className
        )}
      >
        {ODOR_ALERT_VIEW2_UI_MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </>
  )
}

/**
 * 경보목록2 — 풀패널 / 플로팅 UI select 전환 + P21(odorAlertStore)
 * 해제 이력: 풀패널=플로팅 모달, 플로팅UI=목록 옆 사이드 패널
 */
export function OdorAlertView2Shell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
}: Props) {
  const mapContext = useMapContext()
  const { alerts } = useOdorAlertStore()
  const [uiMode, setUiMode] = useState<OdorAlertView2UiMode>('floating')
  const [listWidth, setListWidth] = useState(ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH)
  const [floatWidth, setFloatWidth] = useState(ODOR_ALERT_VIEW2_FLOAT_WIDTH)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailAlert, setDetailAlert] = useState<OdorAlertItem | null>(null)
  const [focusAlertId, setFocusAlertId] = useState<string | null>(null)
  /** 해제이력→목록 단방향 선택. 목록 클릭 시에는 비움 */
  const [historySelectedId, setHistorySelectedId] = useState<string | null>(null)

  const isFloating = uiMode === 'floating'

  useEffect(() => {
    setUiMode(readStoredUiMode())
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(ODOR_ALERT_VIEW2_UI_MODE_STORAGE_KEY, uiMode)
    } catch {
      /* ignore */
    }
  }, [uiMode])

  useEffect(() => {
    setListWidth(ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH)
  }, [ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH])

  useEffect(() => {
    onTotalWidthChange(isFloating ? 0 : listWidth)
  }, [isFloating, listWidth, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const flyToRow = (source: OdorAlertRow) => {
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

  const handleSelectAlert = (alert: OdorAlertItem, source: OdorAlertRow) => {
    setHistorySelectedId(null)
    if (detailAlert?.id === alert.id) {
      setDetailAlert(null)
      setFocusAlertId(null)
      return
    }
    setDetailAlert(alert)
    setFocusAlertId(alert.id)
    flyToRow(source)
  }

  const handleSelectHistory = (hist: OdorAckHistoryRow) => {
    if (historySelectedId === hist.id) {
      setHistorySelectedId(null)
      setDetailAlert(null)
      setFocusAlertId(null)
      return
    }
    const source = alerts.find((a) => a.id === hist.alertId)
    if (!source) return
    const alert = odorAlertRowToViewItem(source)
    setHistorySelectedId(hist.id)
    setDetailAlert(alert)
    setFocusAlertId(source.id)
    flyToRow(source)
  }

  const floatLeft = leftOffsetPx + ODOR_ALERT_VIEW2_FLOAT_LEFT_INSET
  const panelLeft = isFloating ? floatLeft : leftOffsetPx
  const panelWidth = isFloating ? floatWidth : listWidth
  const detailOpen = detailAlert != null
  /** 상세 열림 시 이력은 상세(48vh) 위까지만 — 하단 침범 방지 */
  const floatHistoryMaxHeight = detailOpen
    ? `calc(100vh - ${ODOR_ALERT_VIEW2_FLOAT_TOP}px - ${ODOR_ALERT_VIEW2_DETAIL_HEIGHT_VH}vh - ${ODOR_ALERT_VIEW2_DETAIL_BOTTOM}px - ${ODOR_ALERT_VIEW2_FLOAT_HISTORY_DETAIL_GAP}px)`
    : `calc(100vh - ${ODOR_ALERT_VIEW2_FLOAT_TOP + 10}px)`

  const selectedAlertId = detailAlert?.id ?? null

  const selectedSource = useMemo(() => {
    if (!selectedAlertId) return null
    return alerts.find((a) => a.id === selectedAlertId) ?? null
  }, [alerts, selectedAlertId])

  useOdorMapPointRadarHighlight({
    enabled: true,
    lon: selectedSource?.lon,
    lat: selectedSource?.lat,
    color: 'red',
    layerName: 'odorAlertView2RadarHighlight',
    flyTo: false,
  })

  const listPanel = (
    <OdorAlertView2ListPanel
      onClose={onClose}
      historyOpen={historyOpen}
      onToggleHistory={() => setHistoryOpen((v) => !v)}
      selectedAlertId={selectedAlertId}
      focusAlertId={focusAlertId}
      onSelectAlert={handleSelectAlert}
      hideClose={isFloating}
      headerExtra={
        <UiModeSelect
          id={isFloating ? 'odor-alert-view2-ui-float' : 'odor-alert-view2-ui-legacy'}
          value={uiMode}
          onChange={setUiMode}
          className={
            isFloating
              ? 'border-slate-200 bg-white text-slate-800 dark:border-white/20 dark:bg-black/40 dark:text-white/90'
              : 'border-border bg-background text-foreground'
          }
        />
      }
    />
  )

  const detailSheet = (
    <OdorAlertDetailBottomSheet
      alert={detailAlert}
      leftPx={panelLeft + panelWidth + ODOR_ALERT_VIEW2_DETAIL_GAP}
      rightPx={ODOR_DASHBOARD2_FLOAT_RIGHT_INSET}
      bottomPx={ODOR_ALERT_VIEW2_DETAIL_BOTTOM}
      onClose={() => {
        setDetailAlert(null)
        setFocusAlertId(null)
        setHistorySelectedId(null)
      }}
    />
  )

  if (isFloating) {
    if (typeof document === 'undefined') return null
    return (
      <>
        {createPortal(
          <div
            className="pointer-events-none fixed inset-0 z-30"
            data-ser-eng={ODOR_ALERT_VIEW2_SER_ENG}
          >
            <div
              className="pointer-events-none absolute flex items-start gap-2"
              style={{
                left: floatLeft,
                top: ODOR_ALERT_VIEW2_FLOAT_TOP,
                maxHeight: `calc(100vh - ${ODOR_ALERT_VIEW2_FLOAT_TOP + 10}px)`,
                height: `calc(100vh - ${ODOR_ALERT_VIEW2_FLOAT_TOP + 10}px)`,
              }}
            >
              <MapFloatResizableFrame
                width={floatWidth}
                minWidth={ODOR_ALERT_VIEW2_FLOAT_MIN_WIDTH}
                maxWidth={ODOR_ALERT_VIEW2_FLOAT_MAX_WIDTH}
                onWidthChange={setFloatWidth}
                resizeEdge="right"
                className={cn(
                  'pointer-events-auto h-full',
                  MAP_LAYER_PANEL_SURFACE_CLASS,
                  ODOR_MAP_FLOAT_SURFACE_OPACITY_RESET_CLASS
                )}
              >
                <div
                  className="standard-map-float-header shrink-0 border-b border-slate-200 dark:border-white/10"
                  style={odorMapFloatHeaderOpacityStyle()}
                >
                  <span className="standard-map-float-header-title">경보목록2</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <UiModeSelect
                      id="odor-alert-view2-ui-float-hdr"
                      value={uiMode}
                      onChange={setUiMode}
                      className="border-slate-200 bg-white text-slate-800 dark:border-white/20 dark:bg-black/40 dark:text-white/90"
                    />
                    <button
                      type="button"
                      title={historyOpen ? '해제 이력 접기' : '해제(인지) 이력'}
                      onClick={() => setHistoryOpen((v) => !v)}
                      className={cn(
                        'standard-detail-hdr-btn cursor-pointer',
                        historyOpen && 'border-primary bg-primary/10 text-foreground'
                      )}
                    >
                      <History className="h-3.5 w-3.5" aria-hidden />
                      해제 이력
                    </button>
                    <button
                      type="button"
                      className="standard-map-float-header-close inline-flex h-7 w-7 items-center justify-center"
                      onClick={onClose}
                      title="닫기"
                      aria-label="닫기"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  style={odorMapFloatBodyOpacityStyle()}
                >
                  <OdorAlertView2ListPanel
                    onClose={onClose}
                    historyOpen={historyOpen}
                    onToggleHistory={() => setHistoryOpen((v) => !v)}
                    selectedAlertId={selectedAlertId}
                    focusAlertId={focusAlertId}
                    onSelectAlert={handleSelectAlert}
                    hideClose
                    hideHeader
                  />
                </div>
              </MapFloatResizableFrame>

              {historyOpen ? (
                <div
                  className={cn(
                    'pointer-events-auto flex min-h-0 flex-col overflow-hidden',
                    MAP_LAYER_PANEL_SURFACE_CLASS,
                    ODOR_MAP_FLOAT_SURFACE_OPACITY_RESET_CLASS
                  )}
                  style={{
                    width: ODOR_ALERT_VIEW2_FLOAT_HISTORY_WIDTH,
                    marginLeft: ODOR_ALERT_VIEW2_FLOAT_HISTORY_GAP - 8,
                    maxHeight: floatHistoryMaxHeight,
                    height: floatHistoryMaxHeight,
                  }}
                >
                  <OdorAlertView2HistoryPanel
                    onClose={() => setHistoryOpen(false)}
                    variant="float"
                    className="h-full"
                    selectedHistoryId={historySelectedId}
                    onSelectHistory={handleSelectHistory}
                  />
                </div>
              ) : null}
            </div>
          </div>,
          document.body
        )}
        {detailSheet}
      </>
    )
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
          {listPanel}
        </MapSideListPanel>
      </div>
      {detailSheet}
      <OdorAlertView2HistoryModal
        open={historyOpen}
        leftPx={panelLeft + panelWidth}
        onClose={() => setHistoryOpen(false)}
        selectedHistoryId={historySelectedId}
        onSelectHistory={handleSelectHistory}
      />
    </>
  )
}
