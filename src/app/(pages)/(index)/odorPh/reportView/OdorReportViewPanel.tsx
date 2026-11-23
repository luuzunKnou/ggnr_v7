'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ODOR_REPORT_TABS,
  ODOR_REPORT_VIEW_UI_MODE_OPTIONS,
  ODOR_REPORT_VIEW_UI_MODE_STORAGE_KEY,
  type OdorReportTabId,
  type OdorReportViewUiMode,
} from './odorReportViewConfig'
import {
  defaultOdorReportPeriodState,
  OdorReportPeriodBar,
  type OdorReportPeriodState,
} from './OdorReportPeriodBar'
import { OdorReportTabFullBody } from './OdorReportTabBodies'
import { MAP_LAYER_PANEL_SURFACE_CLASS } from '@/app/(pages)/map/_mapComponents/mapControlPanel/mapLayerPanelLayout'

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

export function OdorReportUiModeSelect({
  id,
  value,
  onChange,
  className,
}: {
  id: string
  value: OdorReportViewUiMode
  onChange: (v: OdorReportViewUiMode) => void
  className?: string
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        보고서 UI
      </label>
      <select
        id={id}
        title="보고서 UI"
        value={value}
        onChange={(e) => onChange(e.target.value as OdorReportViewUiMode)}
        className={cn(
          'h-7 max-w-[9.5rem] cursor-pointer rounded border px-1.5 text-[11px]',
          className
        )}
      >
        {ODOR_REPORT_VIEW_UI_MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </>
  )
}

type Props = {
  uiMode?: OdorReportViewUiMode
  onUiModeChange?: (v: OdorReportViewUiMode) => void
  /** false면 select 숨김(셸 헤더에서만 표시). 기본 true */
  showUiModeSelect?: boolean
}

/**
 * 보고서 조회
 * - 탭 → 검색조건(엑셀·PDF) → 본문
 * - 본문: (카드+그래프 flex-col) | 집계표  = flex
 */
export function OdorReportViewPanel({
  uiMode: uiModeProp,
  onUiModeChange,
  showUiModeSelect = true,
}: Props = {}) {
  const controlled = uiModeProp != null
  const [innerMode, setInnerMode] = useState<OdorReportViewUiMode>(() =>
    controlled ? uiModeProp : readStoredUiMode()
  )
  const [tab, setTab] = useState<OdorReportTabId>('abatement')
  const [period, setPeriod] = useState<OdorReportPeriodState>(() =>
    defaultOdorReportPeriodState()
  )

  const uiMode = controlled ? uiModeProp : innerMode
  const isFloating = uiMode === 'floating'

  const setUiMode = (next: OdorReportViewUiMode) => {
    if (!controlled) setInnerMode(next)
    writeStoredUiMode(next)
    onUiModeChange?.(next)
  }

  useEffect(() => {
    if (controlled) return
    writeStoredUiMode(innerMode)
  }, [controlled, innerMode])

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
        isFloating
          ? cn('rounded border border-border bg-background', MAP_LAYER_PANEL_SURFACE_CLASS)
          : 'rounded border border-border bg-card'
      )}
    >
      <div
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2"
        role="tablist"
        aria-label="보고서 종류"
      >
        {ODOR_REPORT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            title={t.label}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'shrink-0 cursor-pointer border-b-2 px-2.5 py-2 text-[11px] font-medium transition-colors',
              tab === t.id
                ? 'border-primary bg-card text-primary'
                : 'border-transparent bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
        {showUiModeSelect ? (
          <div className="ml-auto flex shrink-0 items-center py-1.5 pl-2">
            <OdorReportUiModeSelect
              id="odor-report-ui-mode"
              value={uiMode}
              onChange={setUiMode}
              className="border-border bg-background text-foreground"
            />
          </div>
        ) : null}
      </div>

      <OdorReportPeriodBar
        value={period}
        onChange={setPeriod}
        showEmd={tab === 'abatement'}
        className="shrink-0 bg-card"
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        <OdorReportTabFullBody tab={tab} period={period} />
      </div>
    </div>
  )
}
