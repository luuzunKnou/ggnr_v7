'use client'

import { useMemo, useState } from 'react'
import { MapPin, Plus, X } from 'lucide-react'
import {
  formatAlertTime,
  isOdorComplaintOverdue,
  odorComplaintStatusLabel,
  type OdorComplaintLinkMock,
  type OdorComplaintStatus,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import {
  ODOR_LIVE_SEVERITY_HEX,
  odorLiveSeverityTagStyle,
} from '@/app/(pages)/(index)/odorPhV2/odorLiveStatusColors'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | OdorComplaintStatus | 'overdue'

const STATUS_TONE: Record<OdorComplaintStatus, 'ok' | 'warn' | 'bad'> = {
  접수: 'bad',
  처리중: 'warn',
  완료: 'ok',
}

type Props = {
  items: OdorComplaintLinkMock[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onClose?: () => void
}

/** 좌측 사이드 — 민원 목록만 (등록·수정은 모달) */
export function OdorComplaintListPanel({
  items,
  selectedId,
  onSelect,
  onAdd,
  onClose,
}: Props) {
  const [filter, setFilter] = useState<StatusFilter>('all')

  const counts = useMemo(() => {
    const received = items.filter((c) => c.status === '접수').length
    const processing = items.filter((c) => c.status === '처리중').length
    const done = items.filter((c) => c.status === '완료').length
    const overdue = items.filter((c) => isOdorComplaintOverdue(c)).length
    return { received, processing, done, overdue }
  }, [items])

  const rows = useMemo(() => {
    let list = [...items]
    if (filter === 'overdue') list = list.filter((c) => isOdorComplaintOverdue(c))
    else if (filter !== 'all') list = list.filter((c) => c.status === filter)
    return list.sort((a, b) => {
      const ao = isOdorComplaintOverdue(a) ? 0 : 1
      const bo = isOdorComplaintOverdue(b) ? 0 : 1
      if (ao !== bo) return ao - bo
      return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    })
  }, [items, filter])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold text-foreground">민원 관리</span>
        <button
          type="button"
          onClick={onAdd}
          className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md bg-sky-600 px-2 py-1 text-[12px] font-semibold text-white hover:bg-sky-500"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          등록
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-1.5 border-b border-border/60 p-2">
        {[
          { l: '접수', v: counts.received, tone: 'bad' as const },
          { l: '처리중', v: counts.processing, tone: 'warn' as const },
          { l: '처리완료', v: counts.done, tone: 'ok' as const },
          { l: '지연', v: counts.overdue, tone: 'action' as const },
        ].map((k) => {
          const hex =
            k.tone === 'action' ? '#f97316' : ODOR_LIVE_SEVERITY_HEX[k.tone]
          return (
            <div
              key={k.l}
              className="rounded-md border border-border bg-card px-2 py-1.5"
              style={{
                borderColor:
                  k.v > 0 && k.tone !== 'ok'
                    ? `color-mix(in srgb, ${hex} 45%, transparent)`
                    : undefined,
              }}
            >
              <div className="text-[12px] text-muted-foreground">{k.l}</div>
              <div
                className="text-lg font-extrabold tabular-nums leading-tight"
                style={k.v > 0 && k.tone !== 'ok' ? { color: hex } : undefined}
              >
                {k.v}
              </div>
            </div>
          )
        })}
      </div>

      {counts.overdue > 0 ? (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-amber-700 dark:text-amber-300">
          ⚠ 지연 {counts.overdue}건
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap gap-0.5 border-b border-border/60 px-2 py-1.5">
        {(
          [
            { key: 'all', label: '전체' },
            { key: '접수', label: '접수' },
            { key: '처리중', label: '처리중' },
            { key: '완료', label: '완료' },
            { key: 'overdue', label: '지연' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setFilter(opt.key)}
            className={cn(
              'cursor-pointer rounded px-2 py-1 text-[12px] font-semibold',
              filter === opt.key
                ? 'bg-sky-500/20 text-sky-300'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[12px] text-muted-foreground">
          {rows.length}건
        </span>
      </div>

      <ul className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <li className="px-3 py-8 text-center text-[12px] text-muted-foreground">
            해당 조건의 민원이 없습니다.
          </li>
        ) : (
          rows.map((c) => {
            const overdue = isOdorComplaintOverdue(c)
            const selected = selectedId === c.id
            const hasLoc = c.lon != null && c.lat != null
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-2 border-b border-border/50 px-2.5 py-2 text-left hover:bg-muted/40',
                    selected && 'bg-sky-500/10'
                  )}
                >
                  <span
                    className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[12px] font-semibold"
                    style={odorLiveSeverityTagStyle(STATUS_TONE[c.status])}
                  >
                    {odorComplaintStatusLabel(c.status)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-foreground">
                      {c.title}
                      {hasLoc ? (
                        <MapPin className="ml-1 inline h-3.5 w-3.5 text-sky-400" aria-hidden />
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {c.emdNm}
                      {c.sensorLabel ? ` · ${c.sensorLabel}` : ''}
                      {' · '}
                      {formatAlertTime(c.receivedAt).slice(5)}
                    </div>
                  </div>
                  {overdue ? (
                    <span className="ml-auto shrink-0 self-center text-[12px] font-bold text-amber-500">
                      ⚠지연
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
