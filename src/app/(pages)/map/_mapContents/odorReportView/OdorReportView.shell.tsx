'use client'

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { OdorReportExportButtons } from '@/app/(pages)/(index)/odorPh/reportView/OdorReportExportButtons'
import {
  OdorReportUiModeSelect,
  OdorReportViewPanel,
} from '@/app/(pages)/(index)/odorPh/reportView/OdorReportViewPanel'
import {
  ODOR_REPORT_VIEW_UI_MODE_STORAGE_KEY,
  type OdorReportViewUiMode,
} from '@/app/(pages)/(index)/odorPh/reportView/odorReportViewConfig'
import { cn } from '@/lib/utils'
import { MapFloatResizableFrame } from '../../_mapComponents/MapFloatResizableFrame'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { MAP_LAYER_PANEL_SURFACE_CLASS } from '../../_mapComponents/mapControlPanel/mapLayerPanelLayout'
import {
  ODOR_REPORT_VIEW_FLOAT_LEFT_INSET,
  ODOR_REPORT_VIEW_FLOAT_MAX_WIDTH,
  ODOR_REPORT_VIEW_FLOAT_MIN_WIDTH,
  ODOR_REPORT_VIEW_FLOAT_TOP,
  ODOR_REPORT_VIEW_FLOAT_WIDTH,
  ODOR_REPORT_VIEW_PANEL_DEFAULT_WIDTH,
  ODOR_REPORT_VIEW_PANEL_MAX_WIDTH,
  ODOR_REPORT_VIEW_PANEL_MIN_WIDTH,
  ODOR_REPORT_VIEW_SER_ENG,
} from './odorReportViewMapConfig'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

const noopSubscribe = () => () => undefined

function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

function readStoredUiMode(): OdorReportViewUiMode {
  if (typeof window === 'undefined') return 'floating'
  try {
    const raw = window.localStorage.getItem(ODOR_REPORT_VIEW_UI_MODE_STORAGE_KEY)
    if (raw === 'legacy' || raw === 'floating') return raw
  } catch {
    /* ignore */
  }
  return 'floating'
}

function writeStoredUiMode(mode: OdorReportViewUiMode) {
  try {
    window.localStorage.setItem(ODOR_REPORT_VIEW_UI_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

/**
 * 지도 보고서 조회 — 패널 UI는 경보목록2와 동일 MapSideListPanel.
 * 플로팅: 세로 본문 + 엑셀·PDF는 관망조회 도구와 같은 옆 플로팅.
 */
export function OdorReportViewShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
}: Props) {
  const isClient = useIsClient()
  const [uiMode, setUiMode] = useState<OdorReportViewUiMode>('floating')
  const [hydrated, setHydrated] = useState(false)
  const [listWidth, setListWidth] = useState(ODOR_REPORT_VIEW_PANEL_DEFAULT_WIDTH)
  const [floatWidth, setFloatWidth] = useState(ODOR_REPORT_VIEW_FLOAT_WIDTH)
  /** 플로팅 엑셀·PDF — 검색조건 섹션과 가로 정렬용 top */
  const [floatToolsTopPx, setFloatToolsTopPx] = useState(0)
  const floatPanelRef = useRef<HTMLDivElement>(null)
  const isFloating = uiMode === 'floating'

  useEffect(() => {
    setUiMode(readStoredUiMode())
    setHydrated(true)
  }, [])

  useLayoutEffect(() => {
    if (!isFloating || !hydrated) return
    const panel = floatPanelRef.current
    if (!panel) return

    const syncToolsTop = () => {
      const search = panel.querySelector('[data-odor-report-search]')
      if (!(search instanceof HTMLElement)) return
      const top = Math.max(
        0,
        Math.round(search.getBoundingClientRect().top - panel.getBoundingClientRect().top)
      )
      setFloatToolsTopPx(top)
    }

    syncToolsTop()
    const ro = new ResizeObserver(syncToolsTop)
    ro.observe(panel)
    const search = panel.querySelector('[data-odor-report-search]')
    if (search instanceof HTMLElement) ro.observe(search)
    return () => ro.disconnect()
  }, [hydrated, isFloating, uiMode, floatWidth])

  const handleUiModeChange = (next: OdorReportViewUiMode) => {
    setUiMode(next)
    writeStoredUiMode(next)
  }

  useEffect(() => {
    if (!hydrated) return
    onTotalWidthChange(isFloating ? 0 : listWidth)
  }, [hydrated, isFloating, listWidth, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  if (!isClient || !hydrated) return null

  const body = (
    <OdorReportViewPanel
      uiMode={uiMode}
      onUiModeChange={handleUiModeChange}
      showUiModeSelect={false}
      showExport={!isFloating}
    />
  )

  if (isFloating) {
    const floatLeft = leftOffsetPx + ODOR_REPORT_VIEW_FLOAT_LEFT_INSET
    const floatHeight = `calc(100vh - ${ODOR_REPORT_VIEW_FLOAT_TOP + 10}px)`

    return createPortal(
      <div
        className="pointer-events-none fixed inset-0 z-30"
        data-ser-eng={ODOR_REPORT_VIEW_SER_ENG}
      >
        <div
          className="pointer-events-none absolute flex items-start gap-2"
          style={{
            left: floatLeft,
            top: ODOR_REPORT_VIEW_FLOAT_TOP,
            maxHeight: floatHeight,
            height: floatHeight,
          }}
        >
          <div ref={floatPanelRef} className="h-full min-h-0">
            <MapFloatResizableFrame
              width={floatWidth}
              minWidth={ODOR_REPORT_VIEW_FLOAT_MIN_WIDTH}
              maxWidth={ODOR_REPORT_VIEW_FLOAT_MAX_WIDTH}
              onWidthChange={setFloatWidth}
              resizeEdge="right"
              className={cn(
                'pointer-events-auto h-full',
                MAP_LAYER_PANEL_SURFACE_CLASS,
                'opacity-100! bg-white dark:bg-black'
              )}
            >
              <div className="standard-map-float-header shrink-0 border-b border-slate-200 opacity-100 dark:border-white/10 dark:bg-white/20">
                <span className="standard-map-float-header-title">보고서 조회</span>
                <div className="flex shrink-0 items-center gap-1">
                  <OdorReportUiModeSelect
                    id="odor-report-map-ui-float"
                    value={uiMode}
                    onChange={handleUiModeChange}
                    className="border-slate-200 bg-white text-slate-800 dark:border-white/20 dark:bg-black/40 dark:text-white/90"
                  />
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white opacity-100 dark:bg-black">
                {body}
              </div>
            </MapFloatResizableFrame>
          </div>

          {/* 검색조건 섹션과 가로 나열 — 헤더·탭 아래 정렬 */}
          <div
            className={cn(
              'pointer-events-auto shrink-0 overflow-hidden',
              MAP_LAYER_PANEL_SURFACE_CLASS,
              'opacity-100! bg-white dark:bg-black'
            )}
            style={{ marginTop: floatToolsTopPx }}
          >
            <OdorReportExportButtons variant="floatTools" />
          </div>
        </div>
      </div>,
      document.body
    )
  }

  return (
    <div className="pointer-events-auto shrink-0">
      <MapSideListPanel
        width={listWidth}
        minWidth={ODOR_REPORT_VIEW_PANEL_MIN_WIDTH}
        maxWidth={ODOR_REPORT_VIEW_PANEL_MAX_WIDTH}
        leftOffsetPx={leftOffsetPx}
        onWidthChange={setListWidth}
        contentClassName="overflow-hidden"
        serEng={ODOR_REPORT_VIEW_SER_ENG}
      >
        <div className="standard-panel-root">
          <div className="standard-panel-header">
            <span className="standard-panel-title">보고서 조회</span>
            <div className="flex items-center gap-1">
              <OdorReportUiModeSelect
                id="odor-report-map-ui-panel"
                value={uiMode}
                onChange={handleUiModeChange}
                className="border-border bg-background text-foreground"
              />
              <button
                type="button"
                onClick={onClose}
                className="standard-panel-close cursor-pointer"
                title="닫기"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</div>
        </div>
      </MapSideListPanel>
    </div>
  )
}
