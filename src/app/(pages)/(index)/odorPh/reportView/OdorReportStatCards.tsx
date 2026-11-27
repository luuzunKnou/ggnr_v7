'use client'

import { cn } from '@/lib/utils'
import type { ReportStatCard } from './odorReportViewMock'

type Props = {
  cards: ReportStatCard[]
  className?: string
}

/** 대시보드2 등급 카드와 동일 톤 — 좌측 액센트 바 + 큰 수치 */
export function OdorReportStatCards({ cards, className }: Props) {
  return (
    <div className={cn('grid shrink-0 grid-cols-2 gap-1.5', className)}>
      {cards.map((c) => (
        <div
          key={c.key}
          title={`${c.title} ${c.value}${c.sub ? ` ${c.sub}` : ''}`}
          className="flex items-center justify-between gap-1.5 rounded-[5px] border border-border bg-card px-2.5 py-2"
          style={{ borderLeftWidth: '4px', borderLeftColor: c.accent }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] font-medium tracking-wide text-muted-foreground/55">
              {c.title}
              {c.sub ? (
                <span className="ml-1 font-normal normal-case opacity-80">({c.sub})</span>
              ) : null}
            </div>
            <span className="text-xl font-bold leading-none tabular-nums text-foreground">
              {c.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
