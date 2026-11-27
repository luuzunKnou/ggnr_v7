'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, X } from 'lucide-react'
import { OdorLiveStatusDashboard } from '@/app/(pages)/(index)/odorPhV2/OdorLiveStatusDashboard'
import { OdorLightChromeProvider } from '@/app/(pages)/(index)/odorPhV2/OdorLightChromeContext'
import {
  readOdorLightChrome,
  type OdorLightChromeId,
} from '@/app/(pages)/(index)/odorPhV2/odorLightChrome'
import { OdorScadaPaletteSwitch } from '@/app/(pages)/(index)/odorPhV2/OdorScadaPaletteSwitch'
import { ThemeToggle } from '@/app/(pages)/(index)/theme-toggle'
import { useTheme } from '@/app/(pages)/(index)/theme-provider'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { withBasePath } from '@/lib/basePath'
import { cn } from '@/lib/utils'
import { ODOR_DASHBOARD_SER_ENG } from './odorDashboardConfig'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  /** 경보 목록 메뉴로 전환 (사이드바 «경보 보기») */
  onOpenAlertList?: () => void
  /** 관제 지도(좌측 사이드 패널 + 본지도)로 전환. sensorKey 있으면 해당 지점 팝업까지 */
  onOpenControlMap?: (sensorKey?: string) => void
  /** 민원 관리 메뉴로 전환 */
  onOpenComplaint?: () => void
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
 * 하수악취 실시간 통합 현황 (V2) — 좌측 메뉴 유지, 지도 영역 풀패널.
 */
export function OdorDashboardShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  onOpenAlertList,
  onOpenControlMap,
  onOpenComplaint,
}: Props) {
  const isClient = useIsClient()
  const { setTheme } = useTheme()
  const [sensors, setSensors] = useState<OdorSensorListItem[]>([])
  const [queriedAt, setQueriedAt] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightChrome, setLightChrome] = useState<OdorLightChromeId>('b')
  const onLightChromeChange = useCallback((id: OdorLightChromeId) => {
    setLightChrome(id)
  }, [])

  /** 실시간 통합 현황 (V2) 진입 시 다크 기본 — 이후 토글은 유지 */
  useEffect(() => {
    setTheme('dark')
  }, [setTheme])

  useEffect(() => {
    setLightChrome(readOdorLightChrome())
  }, [])

  /**
   * 지도 위를 덮는 풀오버레이 — 사이드 패널 폭으로 잡으면 mapPadding이
   * 거의 화면 전체가 되어 리사이즈·RSC 요청이 폭주한다. 패딩 기여는 0.
   */
  useEffect(() => {
    onTotalWidthChange(0)
  }, [onTotalWidthChange])

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

  const lightB = lightChrome === 'b'

  return createPortal(
    <OdorLightChromeProvider value={lightChrome}>
      <div
        className={cn(
          'pointer-events-auto fixed inset-y-0 right-0 z-[55] flex min-h-0 flex-col border-l text-foreground shadow-lg',
          lightB
            ? 'border-zinc-300 bg-zinc-100 dark:border-border dark:bg-background'
            : 'border-border bg-background'
        )}
        style={{ left: leftOffsetPx }}
        data-ser-eng={ODOR_DASHBOARD_SER_ENG}
        data-odor-light-chrome={lightChrome}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 border-b px-3 py-2',
            lightB
              ? 'border-zinc-300 bg-white dark:border-border dark:bg-background'
              : 'border-border bg-background'
          )}
        >
          <span className="text-[12px] font-medium text-foreground">실시간 통합 현황 (V2)</span>
          <div className="ml-auto flex items-center gap-1.5">
            <OdorScadaPaletteSwitch onLightChromeChange={onLightChromeChange} />
            <ThemeToggle
              variant="mapIcon"
              iconBtnClassName="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            />
            <p className="text-[12px] text-muted-foreground tabular-nums">
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5">
          {error ? (
            <p className="mb-2 shrink-0 text-[12px] text-destructive">{error}</p>
          ) : null}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <OdorLiveStatusDashboard
              sensors={sensors}
              queriedAt={queriedAt}
              onGoMenu={(menuId, opts) => {
                if (menuId === 'alertList') onOpenAlertList?.()
                if (menuId === 'controlMap') onOpenControlMap?.(opts?.sensorKey)
                if (menuId === 'complaintManage') onOpenComplaint?.()
              }}
            />
          </div>
        </div>
      </div>
    </OdorLightChromeProvider>,
    document.body
  )
}
