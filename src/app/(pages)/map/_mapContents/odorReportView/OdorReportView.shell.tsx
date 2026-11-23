'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import {
  OdorReportUiModeSelect,
  OdorReportViewPanel,
} from '@/app/(pages)/(index)/odorPh/reportView/OdorReportViewPanel'
import {
  ODOR_REPORT_VIEW_UI_MODE_STORAGE_KEY,
  type OdorReportViewUiMode,
} from '@/app/(pages)/(index)/odorPh/reportView/odorReportViewConfig'
import { cn } from '@/lib/utils'
import { MAP_UI_Z_CLASS } from '@/lib/mapUiZIndex'
import {
  ODOR_REPORT_VIEW_FLOAT_LEFT_INSET,
  ODOR_REPORT_VIEW_FLOAT_RIGHT_INSET,
  ODOR_REPORT_VIEW_LEGACY_MIN_WIDTH,
  ODOR_REPORT_VIEW_SER_ENG,
} from './odorReportViewMapConfig'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
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
 * 지도 보고서 조회 — UI select는 셸 헤더에만. 패널 내부 select 없음.
 * 모드 전환 시 동일 포털·패널을 유지해 깜빡임을 줄인다.
 */
export function OdorReportViewShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
}: Props) {
  const viewport = useViewportWidth()
  const isClient = useIsClient()
  const [uiMode, setUiMode] = useState<OdorReportViewUiMode>('floating')
  const [hydrated, setHydrated] = useState(false)
  const isFloating = uiMode === 'floating'
  const legacyWidth = Math.max(ODOR_REPORT_VIEW_LEGACY_MIN_WIDTH, viewport - leftOffsetPx)

  useEffect(() => {
    setUiMode(readStoredUiMode())
    setHydrated(true)
  }, [])

  const handleUiModeChange = (next: OdorReportViewUiMode) => {
    setUiMode(next)
    writeStoredUiMode(next)
  }

  useEffect(() => {
    if (!hydrated) return
    onTotalWidthChange(isFloating ? 0 : legacyWidth)
  }, [hydrated, isFloating, legacyWidth, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  if (!isClient || !hydrated) return null

  return createPortal(
    <div
      className={cn(
        'pointer-events-auto fixed flex min-h-0 flex-col border-border bg-background shadow-lg',
        MAP_UI_Z_CLASS.viewportFloating,
        isFloating ? 'rounded border' : 'inset-y-0 right-0 border-l'
      )}
      style={
        isFloating
          ? {
              left: leftOffsetPx + ODOR_REPORT_VIEW_FLOAT_LEFT_INSET,
              top: 60,
              right: ODOR_REPORT_VIEW_FLOAT_RIGHT_INSET,
              bottom: 12,
            }
          : { left: leftOffsetPx, top: 0, right: 0, bottom: 0 }
      }
      data-ser-eng={ODOR_REPORT_VIEW_SER_ENG}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <span className="text-[12px] font-semibold text-foreground">보고서 조회</span>
        <div className="ml-auto flex items-center gap-1.5">
          <OdorReportUiModeSelect
            id="odor-report-map-ui-mode"
            value={uiMode}
            onChange={handleUiModeChange}
            className="border-border bg-background text-foreground"
          />
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
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', !isFloating && 'p-2')}>
        <OdorReportViewPanel
          uiMode={uiMode}
          onUiModeChange={handleUiModeChange}
          showUiModeSelect={false}
        />
      </div>
    </div>,
    document.body
  )
}
