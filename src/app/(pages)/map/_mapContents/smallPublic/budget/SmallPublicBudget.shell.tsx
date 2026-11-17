'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { rankPlans, todayYmd } from '../plan/smallPublicPlanCalc'
import { useSmallPublicPlanStore } from '../plan/smallPublicPlanStore'
import { applyConstructionToUnits } from './smallPublicBudgetCalc'
import { useSmallPublicBudgetStore } from './smallPublicBudgetStore'
import { toPlanRefs } from './smallPublicBudgetUi'
import { SmallPublicBudgetDashboard } from './SmallPublicBudgetDashboard'
import { SmallPublicBudgetListPanel } from './SmallPublicBudgetListPanel'
import { SmallPublicConstructionListPanel } from './SmallPublicConstructionListPanel'

const MIN_WIDTH = 720

type ListTab = 'budget' | 'construction'

const LIST_TABS: { key: ListTab; label: string }[] = [
  { key: 'budget', label: '예산 관리' },
  { key: 'construction', label: '공사대장' },
]

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

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

/**
 * 예산·공사 — 위: 현황 대시보드, 아래: 예산 관리·공사대장 목록.
 */
export function SmallPublicBudgetShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const { units } = useSmallPublicPlanStore()
  const { constructions } = useSmallPublicBudgetStore()
  const viewport = useViewportWidth()
  const isClient = useIsClient()
  const width = Math.max(MIN_WIDTH, viewport - leftOffsetPx)
  const [listTab, setListTab] = useState<ListTab>('budget')
  const [baseDate] = useState(todayYmd)

  useEffect(() => {
    onTotalWidthChange(width)
  }, [width, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const applied = useMemo(() => applyConstructionToUnits(units, constructions), [units, constructions])
  const ranked = useMemo(() => rankPlans(applied, baseDate), [applied, baseDate])
  const planById = useMemo(() => toPlanRefs(ranked), [ranked])
  const unitById = useMemo(() => new Map(applied.map((u) => [u.id, u])), [applied])
  const overlay = { overlayLeftPx: leftOffsetPx, overlayWidthPx: width }

  if (!isClient) return null
  return createPortal(
    <div
      className="pointer-events-auto fixed inset-y-0 right-0 z-[55] flex min-h-0 flex-col border-l border-border bg-background shadow-lg"
      style={{ left: leftOffsetPx }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[12px] font-semibold">예산·공사</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 max-h-[52%] shrink overflow-auto border-b border-border scrollbar-thin">
        <SmallPublicBudgetDashboard ranked={ranked} unitById={unitById} onOpenList={setListTab} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-end gap-1 border-b border-border px-3 pt-1" role="tablist" aria-label="목록">
          {LIST_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={listTab === t.key}
              onClick={() => setListTab(t.key)}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-[12px] transition-colors',
                listTab === t.key
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {listTab === 'budget' ? (
            <SmallPublicBudgetListPanel overlay={overlay} planById={planById} />
          ) : (
            <SmallPublicConstructionListPanel overlay={overlay} planById={planById} />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
