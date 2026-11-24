'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronsRight, RefreshCw, X } from 'lucide-react'
import { OdorGradeDistributionPanel } from './panels/OdorGradeDistributionPanel'
import { OdorDeviceStatusPanel } from './panels/OdorDeviceStatusPanel'
import { OdorRecentAlertList } from './panels/OdorRecentAlertList'
import { OdorCautionAlertList } from './panels/OdorCautionAlertList'
import {
  buildDashboardGradeMock,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { OdorAlertDetailBottomSheet } from './OdorAlertDetailBottomSheet'
import { OdorDashboard2FullPanel } from './OdorDashboard2FullPanel'
import {
  buildOdorStationRows,
  stationRowToAlertItem,
  type OdorStationRow,
} from './odorDashboard2StationRows'
import { useOdorDashboard2GradeLayer } from './useOdorDashboard2GradeLayer'
import { consumePendingOdorStationFocus } from '@/app/(pages)/(index)/odorPh/systemStatus/odorSystemStatusFocus'
import { withBasePath } from '@/lib/basePath'
import { cn } from '@/lib/utils'
import { MapFloatResizableFrame } from '../../_mapComponents/MapFloatResizableFrame'
import { MAP_LAYER_PANEL_SURFACE_CLASS } from '../../_mapComponents/mapControlPanel/mapLayerPanelLayout'
import {
  ODOR_MAP_FLOAT_SURFACE_OPACITY_RESET_CLASS,
  odorMapFloatBodyOpacityStyle,
  odorMapFloatHeaderOpacityStyle,
} from '../odorMapFloatOpacity'
import {
  ODOR_DASHBOARD2_DETAIL_LEFT_GAP,
  ODOR_DASHBOARD2_FLOAT_ALERT_MAX_WIDTH,
  ODOR_DASHBOARD2_FLOAT_ALERT_MIN_WIDTH,
  ODOR_DASHBOARD2_FLOAT_ALERT_WIDTH,
  ODOR_DASHBOARD2_FLOAT_RIGHT_INSET,
  ODOR_DASHBOARD2_FLOAT_STATS_MAX_WIDTH,
  ODOR_DASHBOARD2_FLOAT_STATS_MIN_WIDTH,
  ODOR_DASHBOARD2_FLOAT_STATS_WIDTH,
  ODOR_DASHBOARD2_SER_ENG,
  ODOR_DASHBOARD2_UI_MODE_OPTIONS,
  ODOR_DASHBOARD2_UI_MODE_STORAGE_KEY,
  type OdorDashboard2UiMode,
} from './odorDashboard2Config'

const MIN_WIDTH = 720

type FloatPanelKey = 'grade' | 'device' | 'recent' | 'caution'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  /** 경보 목록 메뉴로 전환 (사이드바 «경보 보기») */
  onOpenAlertList?: () => void
}

function subscribeResize(cb: () => void) {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1600)
}

const noopSubscribe = () => () => undefined

function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

function formatQueryBaseTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
}

function readStoredUiMode(): OdorDashboard2UiMode {
  if (typeof window === 'undefined') return 'floating'
  try {
    const raw = window.localStorage.getItem(ODOR_DASHBOARD2_UI_MODE_STORAGE_KEY)
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
  value: OdorDashboard2UiMode
  onChange: (v: OdorDashboard2UiMode) => void
  className?: string
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        대시보드 UI
      </label>
      <select
        id={id}
        title="대시보드 UI"
        value={value}
        onChange={(e) => onChange(e.target.value as OdorDashboard2UiMode)}
        className={cn(
          'h-7 max-w-[9.5rem] cursor-pointer rounded border px-1.5 text-[11px]',
          className
        )}
      >
        {ODOR_DASHBOARD2_UI_MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </>
  )
}

function FloatCollapsiblePanel({
  title,
  open,
  onToggle,
  headerRight,
  children,
  className,
  bodyClassName,
  style,
}: {
  title: string
  open: boolean
  onToggle: () => void
  headerRight?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={cn(
        'pointer-events-auto flex min-h-0 flex-col overflow-hidden',
        MAP_LAYER_PANEL_SURFACE_CLASS,
        ODOR_MAP_FLOAT_SURFACE_OPACITY_RESET_CLASS,
        className
      )}
      style={style}
    >
      <div
        className="standard-map-float-header shrink-0 border-b border-slate-200 dark:border-white/10"
        style={odorMapFloatHeaderOpacityStyle()}
        title={`${title} — 더블클릭으로 접기/펼치기`}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button, select, input, a')) return
          onToggle()
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            className="inline-flex shrink-0 cursor-pointer items-center"
            title={open ? `${title} 접기` : `${title} 펼치기`}
            onClick={onToggle}
          >
            <ChevronLeft
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-white/70',
                !open && '-rotate-90'
              )}
              aria-hidden
            />
          </button>
          <span className="standard-map-float-header-title">{title}</span>
        </div>
        {headerRight ? (
          <div
            className="flex min-w-0 shrink-0 items-center gap-1"
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {headerRight}
          </div>
        ) : null}
      </div>

      {open ? (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            bodyClassName
          )}
          style={odorMapFloatBodyOpacityStyle()}
        >
          {children}
        </div>
      ) : (
        <button
          type="button"
          className="flex cursor-pointer items-center justify-center gap-1 px-2 py-2 text-[11px] text-muted-foreground hover:bg-muted/40"
          title={`${title} 펼치기`}
          onClick={onToggle}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          {title} 펼치기
        </button>
      )}
    </div>
  )
}

/**
 * 하수악취 대시보드2 — 풀패널 / 플로팅 UI select 전환.
 */
export function OdorDashboard2Shell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  onOpenAlertList,
}: Props) {
  const viewport = useViewportWidth()
  const isClient = useIsClient()
  const [uiMode, setUiMode] = useState<OdorDashboard2UiMode>('floating')
  const [sensors, setSensors] = useState<OdorSensorListItem[]>([])
  const [queriedAt, setQueriedAt] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlightSensorKey, setHighlightSensorKey] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState<Record<FloatPanelKey, boolean>>({
    grade: true,
    device: true,
    recent: true,
    caution: true,
  })
  const [detailAlert, setDetailAlert] = useState<OdorAlertItem | null>(null)
  const [floatGradeWidth, setFloatGradeWidth] = useState(ODOR_DASHBOARD2_FLOAT_STATS_WIDTH)
  const [floatDeviceWidth, setFloatDeviceWidth] = useState(ODOR_DASHBOARD2_FLOAT_STATS_WIDTH)
  const [floatRecentWidth, setFloatRecentWidth] = useState(ODOR_DASHBOARD2_FLOAT_ALERT_WIDTH)
  const [floatCautionWidth, setFloatCautionWidth] = useState(ODOR_DASHBOARD2_FLOAT_ALERT_WIDTH)

  const isFloating = uiMode === 'floating'
  const floatLeftMaxWidth = Math.max(floatGradeWidth, floatDeviceWidth)
  const legacyWidth = Math.max(MIN_WIDTH, viewport - leftOffsetPx)

  useEffect(() => {
    setUiMode(readStoredUiMode())
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(ODOR_DASHBOARD2_UI_MODE_STORAGE_KEY, uiMode)
    } catch {
      /* ignore */
    }
  }, [uiMode])

  useEffect(() => {
    onTotalWidthChange(isFloating ? 0 : legacyWidth)
  }, [isFloating, legacyWidth, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const loadSensors = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(withBasePath('/api/odor/sensors'), {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const json = (await res.json()) as {
        success?: boolean
        data?: OdorSensorListItem[]
        error?: string
      }
      if (!res.ok || !json.success) {
        throw new Error(json.error || `센서 조회 실패 (${res.status})`)
      }
      setSensors(Array.isArray(json.data) ? json.data : [])
      setQueriedAt(new Date().toISOString())
    } catch (e: unknown) {
      setSensors([])
      setError(e instanceof Error ? e.message : String(e))
      setQueriedAt(new Date().toISOString())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSensors()
  }, [loadSensors])

  const { gradeCounts, points, emdStatuses } = useMemo(
    () => buildDashboardGradeMock(sensors),
    [sensors]
  )

  const stationRows = useMemo(
    () => buildOdorStationRows(sensors, points),
    [sensors, points]
  )

  const [deviceHeaderRight, setDeviceHeaderRight] = useState<ReactNode>(null)

  useOdorDashboard2GradeLayer({
    enabled: isClient,
    rows: stationRows,
    selectedId: highlightSensorKey,
    flyToSelected: true,
  })

  useEffect(() => {
    if (stationRows.length === 0) return
    const pending = consumePendingOdorStationFocus()
    if (!pending) return
    const row = stationRows.find((r) => r.id === pending || String(r.sensorKey) === pending)
    if (!row) return
    setHighlightSensorKey(row.id)
    setDetailAlert(stationRowToAlertItem(row))
  }, [stationRows])

  const handleSelectStation = (row: OdorStationRow | null) => {
    setHighlightSensorKey(row?.id ?? null)
    setDetailAlert(row ? stationRowToAlertItem(row) : null)
  }

  /** 동일 경보 행 재클릭 시 상세 닫기 */
  const handleSelectAlert = (alert: OdorAlertItem) => {
    setDetailAlert((prev) => {
      if (prev?.id === alert.id) {
        setHighlightSensorKey(null)
        return null
      }
      return alert
    })
  }

  const handleCloseDetail = () => {
    setDetailAlert(null)
    setHighlightSensorKey(null)
  }

  const togglePanel = (key: FloatPanelKey) => {
    setPanelOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const headerActions = (
    <>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        조회 기준 시간: {formatQueryBaseTime(queriedAt)}
      </p>
      <button
        type="button"
        title="새로고침"
        onClick={() => void loadSensors()}
        disabled={loading}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
      </button>
    </>
  )

  const alertListBtn = (
    <button
      type="button"
      title="경보목록"
      onClick={() => onOpenAlertList?.()}
      className="inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[11px] font-normal text-slate-500 hover:text-slate-800 dark:text-white/60 dark:hover:text-white"
    >
      경보목록
      <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  )

  if (!isClient) return null

  if (isFloating) {
    const floatLeft = leftOffsetPx + 20

    return (
      <>
        {createPortal(
      <div
        className="pointer-events-none fixed inset-0 z-30"
        data-ser-eng={ODOR_DASHBOARD2_SER_ENG}
      >
        {/* 좌측: 패널별 독립 너비(우측 핸들) */}
        <div
          className="pointer-events-none absolute flex flex-col gap-2 overflow-hidden"
          style={{
            left: floatLeft,
            top: 60,
            maxHeight: 'calc(100vh - 70px)',
            height: 'calc(100vh - 70px)',
          }}
        >
          <MapFloatResizableFrame
            width={floatGradeWidth}
            minWidth={ODOR_DASHBOARD2_FLOAT_STATS_MIN_WIDTH}
            maxWidth={ODOR_DASHBOARD2_FLOAT_STATS_MAX_WIDTH}
            onWidthChange={setFloatGradeWidth}
            resizeEdge="right"
            className="pointer-events-none shrink-0"
          >
            <FloatCollapsiblePanel
              title="악취 등급 분포"
              open={panelOpen.grade}
              onToggle={() => togglePanel('grade')}
              className="shrink-0"
              bodyClassName="!flex-none"
              headerRight={
                <>
                  <UiModeSelect
                    id="odor-dashboard-ui-mode-float"
                    value={uiMode}
                    onChange={setUiMode}
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
                </>
              }
            >
              <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-2 py-1 dark:border-white/10">
                {headerActions}
              </div>
              {error ? (
                <p className="shrink-0 px-2 py-1 text-[11px] text-destructive">{error}</p>
              ) : null}
              <div className="shrink-0 overflow-hidden">
                <OdorGradeDistributionPanel
                  counts={gradeCounts}
                  points={points}
                  emdStatuses={emdStatuses}
                  sensors={sensors}
                  highlightSensorKey={highlightSensorKey}
                  hideMiniMap
                />
              </div>
            </FloatCollapsiblePanel>
          </MapFloatResizableFrame>

          <MapFloatResizableFrame
            width={floatDeviceWidth}
            minWidth={ODOR_DASHBOARD2_FLOAT_STATS_MIN_WIDTH}
            maxWidth={ODOR_DASHBOARD2_FLOAT_STATS_MAX_WIDTH}
            onWidthChange={setFloatDeviceWidth}
            resizeEdge="right"
            className={cn(
              'pointer-events-none',
              panelOpen.device ? 'min-h-0 flex-1' : 'shrink-0'
            )}
          >
            <FloatCollapsiblePanel
              title="지점 목록 및 기기 상태"
              open={panelOpen.device}
              onToggle={() => togglePanel('device')}
              className="h-full min-h-0"
              headerRight={deviceHeaderRight}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <OdorDeviceStatusPanel
                  sensors={sensors}
                  points={points}
                  selectedSensorKey={highlightSensorKey}
                  onSelectStation={handleSelectStation}
                  hideHeader
                  onHeaderRightChange={setDeviceHeaderRight}
                />
              </div>
            </FloatCollapsiblePanel>
          </MapFloatResizableFrame>
        </div>

        {/* 우측: 패널별 독립 너비(좌측 핸들) */}
        <div
          className="pointer-events-none absolute flex flex-col items-end gap-2"
          style={{
            right: ODOR_DASHBOARD2_FLOAT_RIGHT_INSET,
            bottom: 12,
            top: 60,
            height: 'calc(100vh - 72px)',
          }}
        >
          <MapFloatResizableFrame
            width={floatRecentWidth}
            minWidth={ODOR_DASHBOARD2_FLOAT_ALERT_MIN_WIDTH}
            maxWidth={ODOR_DASHBOARD2_FLOAT_ALERT_MAX_WIDTH}
            onWidthChange={setFloatRecentWidth}
            resizeEdge="left"
            className={cn(
              'pointer-events-none',
              panelOpen.recent
                ? panelOpen.caution
                  ? 'min-h-0 flex-1 basis-0'
                  : 'min-h-0 flex-1'
                : 'shrink-0'
            )}
          >
            <FloatCollapsiblePanel
              title="최근 경보"
              open={panelOpen.recent}
              onToggle={() => togglePanel('recent')}
              className="h-full min-h-0"
              headerRight={alertListBtn}
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <OdorRecentAlertList
                  onGoAlertList={onOpenAlertList}
                  hideHeader
                  onSelectAlert={handleSelectAlert}
                  selectedAlertId={detailAlert?.id}
                />
              </div>
            </FloatCollapsiblePanel>
          </MapFloatResizableFrame>

          <MapFloatResizableFrame
            width={floatCautionWidth}
            minWidth={ODOR_DASHBOARD2_FLOAT_ALERT_MIN_WIDTH}
            maxWidth={ODOR_DASHBOARD2_FLOAT_ALERT_MAX_WIDTH}
            onWidthChange={setFloatCautionWidth}
            resizeEdge="left"
            className={cn(
              'pointer-events-none',
              panelOpen.caution
                ? panelOpen.recent
                  ? 'min-h-0 flex-1 basis-0'
                  : 'min-h-0 flex-1'
                : 'shrink-0'
            )}
          >
            <FloatCollapsiblePanel
              title="주의 경보 목록"
              open={panelOpen.caution}
              onToggle={() => togglePanel('caution')}
              className="h-full min-h-0"
              headerRight={alertListBtn}
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <OdorCautionAlertList
                  onGoAlertList={onOpenAlertList}
                  hideHeader
                  onSelectAlert={handleSelectAlert}
                  selectedAlertId={detailAlert?.id}
                />
              </div>
            </FloatCollapsiblePanel>
          </MapFloatResizableFrame>
        </div>

      </div>,
      document.body
        )}
        <OdorAlertDetailBottomSheet
          alert={detailAlert}
          leftPx={floatLeft + floatLeftMaxWidth + ODOR_DASHBOARD2_DETAIL_LEFT_GAP}
          bottomPx={12}
          stations={stationRows}
          onClose={handleCloseDetail}
        />
      </>
    )
  }

  return (
    <>
      {createPortal(
        <div
          className="pointer-events-auto fixed inset-y-0 right-0 z-30 flex min-h-0 flex-col border-l border-border bg-background shadow-lg"
          style={{ left: leftOffsetPx }}
          data-ser-eng={ODOR_DASHBOARD2_SER_ENG}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-[12px] font-semibold">대시보드2</span>
            <div className="ml-auto flex items-center gap-1.5">
              <UiModeSelect
                id="odor-dashboard-ui-mode-legacy"
                value={uiMode}
                onChange={setUiMode}
                className="border-border bg-background text-foreground"
              />
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="닫기"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-2">
            {error ? (
              <p className="mb-2 shrink-0 text-[11px] text-destructive">{error}</p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              <OdorDashboard2FullPanel
                sensors={sensors}
                selectedSensorKey={highlightSensorKey}
                selectedAlertId={detailAlert?.id}
                onSelectStation={handleSelectStation}
                onSelectAlert={handleSelectAlert}
                onOpenAlertModal={onOpenAlertList}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
      <OdorAlertDetailBottomSheet
        alert={detailAlert}
        leftPx={leftOffsetPx + 12}
        rightPx={16}
        bottomPx={12}
        stations={stationRows}
        onClose={handleCloseDetail}
      />
    </>
  )
}
