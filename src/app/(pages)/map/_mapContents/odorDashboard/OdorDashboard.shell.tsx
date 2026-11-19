'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, X } from 'lucide-react'
import { IndexPageOdorPh } from '@/app/(pages)/(index)/odorPh/IndexPageOdorPh'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { withBasePath } from '@/lib/basePath'
import { cn } from '@/lib/utils'
import { ODOR_DASHBOARD_SER_ENG } from './odorDashboardConfig'

const MIN_WIDTH = 720

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

/**
 * 하수악취 대시보드 — 지도 영역 풀패널 (콘솔 사이드바 없음).
 */
export function OdorDashboardShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  onOpenAlertList,
}: Props) {
  const viewport = useViewportWidth()
  const isClient = useIsClient()
  const width = Math.max(MIN_WIDTH, viewport - leftOffsetPx)
  const [sensors, setSensors] = useState<OdorSensorListItem[]>([])
  const [queriedAt, setQueriedAt] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onTotalWidthChange(width)
  }, [width, onTotalWidthChange])

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

  if (!isClient) return null

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-y-0 right-0 z-[55] flex min-h-0 flex-col border-l border-border bg-background shadow-lg"
      style={{ left: leftOffsetPx }}
      data-ser-eng={ODOR_DASHBOARD_SER_ENG}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[12px] font-semibold">대시보드</span>
        <div className="ml-auto flex items-center gap-1.5">
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
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        {error ? (
          <p className="mb-2 shrink-0 text-[11px] text-destructive">{error}</p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          <IndexPageOdorPh
            sensors={sensors}
            onGoMenu={(menuId) => {
              if (menuId === 'alertList') onOpenAlertList?.()
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
