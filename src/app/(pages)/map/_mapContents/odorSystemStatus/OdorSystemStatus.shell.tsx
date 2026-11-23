'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fromLonLat } from 'ol/proj'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../_mapComponents/MapContext'
import { MAP_LAYER_PANEL_SURFACE_CLASS } from '../../_mapComponents/mapControlPanel/mapLayerPanelLayout'
import { OdorSystemStatusExpandPanel } from '@/app/(pages)/(index)/odorPh/systemStatus/OdorSystemStatusExpandPanel'
import { OdorSystemStatusPanelView } from '@/app/(pages)/(index)/odorPh/systemStatus/OdorSystemStatusPanel'
import { useOdorSystemStatusModel } from '@/app/(pages)/(index)/odorPh/systemStatus/useOdorSystemStatusModel'
import type { OdorCommNodeView } from '@/app/(pages)/(index)/odorPh/systemStatus/odorSystemStatusTypes'
import { cn } from '@/lib/utils'
import {
  ODOR_SYSTEM_STATUS_DEFAULT_WIDTH,
  ODOR_SYSTEM_STATUS_EXPAND_DEFAULT_WIDTH,
  ODOR_SYSTEM_STATUS_EXPAND_MAX_WIDTH,
  ODOR_SYSTEM_STATUS_EXPAND_MIN_WIDTH,
  ODOR_SYSTEM_STATUS_FLOAT_EXPAND_WIDTH,
  ODOR_SYSTEM_STATUS_FLOAT_GAP,
  ODOR_SYSTEM_STATUS_FLOAT_LEFT_INSET,
  ODOR_SYSTEM_STATUS_FLOAT_WIDTH,
  ODOR_SYSTEM_STATUS_MAX_WIDTH,
  ODOR_SYSTEM_STATUS_MIN_WIDTH,
  ODOR_SYSTEM_STATUS_SER_ENG,
  ODOR_SYSTEM_STATUS_UI_MODE_OPTIONS,
  ODOR_SYSTEM_STATUS_UI_MODE_STORAGE_KEY,
  type OdorSystemStatusUiMode,
} from './odorSystemStatusConfig'
import { useOdorSystemStatusMapLayer } from './useOdorSystemStatusMapLayer'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

function readStoredUiMode(): OdorSystemStatusUiMode {
  if (typeof window === 'undefined') return 'floating'
  try {
    const raw = window.localStorage.getItem(ODOR_SYSTEM_STATUS_UI_MODE_STORAGE_KEY)
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
  value: OdorSystemStatusUiMode
  onChange: (v: OdorSystemStatusUiMode) => void
  className?: string
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        시스템 상태•통신 UI
      </label>
      <select
        id={id}
        title="시스템 상태•통신 UI"
        value={value}
        onChange={(e) => onChange(e.target.value as OdorSystemStatusUiMode)}
        className={cn(
          'h-7 max-w-[9.5rem] cursor-pointer rounded border px-1.5 text-[11px]',
          className
        )}
      >
        {ODOR_SYSTEM_STATUS_UI_MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </>
  )
}

export function OdorSystemStatusShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
}: Props) {
  const mapContext = useMapContext()
  const model = useOdorSystemStatusModel()
  const [uiMode, setUiMode] = useState<OdorSystemStatusUiMode>('floating')
  const [listWidth, setListWidth] = useState(ODOR_SYSTEM_STATUS_DEFAULT_WIDTH)
  const [expandWidth, setExpandWidth] = useState(ODOR_SYSTEM_STATUS_EXPAND_DEFAULT_WIDTH)

  const isFloating = uiMode === 'floating'
  const legacyTotal = listWidth + (model.expandOpen ? expandWidth : 0)
  const highlightId = model.sensorDetail?.id ?? model.selectedId

  useOdorSystemStatusMapLayer({ enabled: true, highlightId })

  useEffect(() => {
    setUiMode(readStoredUiMode())
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(ODOR_SYSTEM_STATUS_UI_MODE_STORAGE_KEY, uiMode)
    } catch {
      /* ignore */
    }
  }, [uiMode])

  useEffect(() => {
    onTotalWidthChange(isFloating ? 0 : legacyTotal)
  }, [isFloating, legacyTotal, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  /** 서비스 내 지도 이동만 — 대시보드 등 다른 창으로 전환하지 않음 */
  const handleGoToStation = (node: OdorCommNodeView) => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || node.lon == null || node.lat == null) return
    const center = fromLonLat([node.lon, node.lat]) as [number, number]
    const zoom = Math.max(map.getView().getZoom() ?? 14, 15)
    scheduleAnimateMapToCenter3857(map, center, zoom, {
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    })
  }

  const uiSelectClass = isFloating
    ? 'border-slate-200 bg-white text-slate-800 dark:border-white/20 dark:bg-black/40 dark:text-white/90'
    : 'border-border bg-background text-foreground'

  const headerExtra = (
    <UiModeSelect
      id={isFloating ? 'odor-system-status-ui-float' : 'odor-system-status-ui-legacy'}
      value={uiMode}
      onChange={setUiMode}
      className={uiSelectClass}
    />
  )

  if (isFloating) {
    if (typeof document === 'undefined') return null
    const floatLeft = leftOffsetPx + ODOR_SYSTEM_STATUS_FLOAT_LEFT_INSET
    return createPortal(
      <div
        className="pointer-events-none fixed inset-0 map-ui-z-viewport"
        data-ser-eng={ODOR_SYSTEM_STATUS_SER_ENG}
      >
        <div
          className="pointer-events-none absolute flex items-stretch gap-2"
          style={{
            left: floatLeft,
            top: 60,
            maxHeight: 'calc(100vh - 70px)',
            height: 'calc(100vh - 70px)',
          }}
        >
          <div
            className={cn(
              'pointer-events-auto flex min-h-0 flex-col overflow-hidden',
              MAP_LAYER_PANEL_SURFACE_CLASS
            )}
            style={{ width: ODOR_SYSTEM_STATUS_FLOAT_WIDTH }}
          >
            <OdorSystemStatusPanelView
              variant="map"
              model={model}
              onClose={onClose}
              onGoToStation={handleGoToStation}
              expandMode="none"
              headerExtra={headerExtra}
              className="h-full"
            />
          </div>
          {model.expandOpen && model.selected ? (
            <div
              className={cn(
                'pointer-events-auto flex min-h-0 flex-col overflow-hidden',
                MAP_LAYER_PANEL_SURFACE_CLASS
              )}
              style={{
                width: ODOR_SYSTEM_STATUS_FLOAT_EXPAND_WIDTH,
                marginLeft: ODOR_SYSTEM_STATUS_FLOAT_GAP - 8,
              }}
            >
              <OdorSystemStatusExpandPanel
                node={model.selected}
                sensorDetail={model.sensorDetail}
                agencySensors={model.agencySensors}
                selectedSensorId={model.sensorDetail?.id ?? null}
                onSelectSensor={(s) => {
                  const same = model.sensorDetail?.id === s.id
                  model.selectSensor(s.id)
                  if (!same) handleGoToStation(s)
                }}
                onBackToAgencyList={() => model.setSensorDetailId(null)}
                onGoToStation={handleGoToStation}
                onClose={model.closeExpand}
                className="h-full w-full"
              />
            </div>
          ) : null}
        </div>
      </div>,
      document.body
    )
  }

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={ODOR_SYSTEM_STATUS_MIN_WIDTH}
          maxWidth={ODOR_SYSTEM_STATUS_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
          contentClassName="overflow-hidden"
          serEng={ODOR_SYSTEM_STATUS_SER_ENG}
        >
          <OdorSystemStatusPanelView
            variant="map"
            model={model}
            onClose={onClose}
            onGoToStation={handleGoToStation}
            expandMode="none"
            headerExtra={headerExtra}
          />
        </MapSideListPanel>
      </div>
      {model.expandOpen && model.selected ? (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={expandWidth}
            minWidth={ODOR_SYSTEM_STATUS_EXPAND_MIN_WIDTH}
            maxWidth={ODOR_SYSTEM_STATUS_EXPAND_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setExpandWidth}
            contentClassName="overflow-hidden"
            serEng={ODOR_SYSTEM_STATUS_SER_ENG}
          >
            <OdorSystemStatusExpandPanel
              node={model.selected}
              sensorDetail={model.sensorDetail}
              agencySensors={model.agencySensors}
              selectedSensorId={model.sensorDetail?.id ?? null}
              onSelectSensor={(s) => {
                const same = model.sensorDetail?.id === s.id
                model.selectSensor(s.id)
                if (!same) handleGoToStation(s)
              }}
              onBackToAgencyList={() => model.setSensorDetailId(null)}
              onGoToStation={handleGoToStation}
              onClose={model.closeExpand}
              className="h-full w-full"
            />
          </MapSideListPanel>
        </div>
      ) : null}
    </>
  )
}
