'use client'

import {
  formatAlertTime,
  gradeDotColor,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { cn } from '@/lib/utils'

type Props = {
  alert: OdorAlertItem
  selected?: boolean
  onSelect?: (alert: OdorAlertItem) => void
}

const BADGE_BLUE =
  'bg-sky-500/15 text-sky-700 dark:bg-sky-400/20 dark:text-sky-300'
const BADGE_RED =
  'bg-red-500/15 text-red-700 dark:bg-red-400/20 dark:text-red-300'

/** 최근·주의 경보 공통 카드 — 상단: 지점·농도·설비·인지 / 하단: 발생 */
export function OdorAlertCardItem({ alert, selected = false, onSelect }: Props) {
  const occurred = formatAlertTime(alert.occurredAt)
  const running = alert.abatementRunning
  const confirmedLabel = alert.confirmed ? '인지' : '미인지'
  const statusColor = gradeDotColor(alert.grade)

  return (
    <button
      type="button"
      title={`${alert.sensorKorNm} 상세`}
      onClick={() => onSelect?.(alert)}
      className={cn(
        'flex w-full cursor-pointer flex-col gap-1.5 rounded-[5px] border-2 bg-card px-2.5 py-2 text-left transition-colors',
        'hover:bg-muted/50',
        selected && 'bg-primary/11 ring-1 ring-inset ring-primary/20 dark:bg-primary/20'
      )}
      style={{ borderColor: statusColor }}
    >
      {/* 상단 — 지점·농도·설비 */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor }}
            title={`${alert.grade}등급`}
            aria-label={`${alert.grade}등급`}
          />
          <p
            className="min-w-0 truncate text-[12px] font-semibold text-foreground"
            title={alert.sensorKorNm}
          >
            {alert.sensorKorNm}
          </p>
        </div>

        <div className="flex min-w-0 items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground">농도</p>
            <p className="text-[18px] font-bold leading-none tabular-nums text-foreground">
              {alert.ppm.toFixed(1)}
              <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">
                ppm
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span
              className={cn(
                'standard-status-badge',
                running ? BADGE_BLUE : BADGE_RED
              )}
              title={running ? '가동' : '정지'}
            >
              {running ? '가동' : '정지'}
            </span>
            <span
              className={cn(
                'standard-status-badge',
                alert.confirmed ? BADGE_BLUE : BADGE_RED
              )}
              title={confirmedLabel}
            >
              {confirmedLabel}
            </span>
          </div>
        </div>
      </div>

      {/* 하단 — 발생·부가 */}
      <div className="flex flex-col gap-1 border-t border-border/60 pt-1.5">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground">발생</p>
          <p className="text-[11px] tabular-nums text-foreground" title={occurred}>
            {occurred}
          </p>
        </div>
        <p
          className="truncate text-[10px] text-muted-foreground"
          title={`${alert.sensorNm} · ${alert.agency}`}
        >
          {alert.sensorNm} · {alert.agency}
        </p>
      </div>
    </button>
  )
}
