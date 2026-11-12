'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SMALL_PUBLIC_FAC_TYPES,
  smallPublicBtnGhost,
  smallPublicBtnPrimary,
  type SmallPublicCandidate,
  type SmallPublicFacType,
} from '../smallPublicConfig'
import { SmallPublicClassBadge, smallPublicSelectedRowClass } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from './SmallPublicInspectionModal'

export type SmallPublicPlanTransferRow = {
  facilityId: string
  name: string
  type: string
  emd?: string
  ri?: string
  prevClass: SmallPublicCandidate
  date: string
  /** 이미 정비계획에 있음 */
  alreadyInPlan: boolean
}

/**
 * 안전점검 → 정비계획 이관 — 좁은 패널 위에서도 표가 잘리지 않게 가로 스크롤·짧은 열.
 */
export function SmallPublicPlanTransferModal({
  rows,
  onCancel,
  onConfirm,
  ...overlay
}: SmallPublicModalOverlay & {
  rows: SmallPublicPlanTransferRow[]
  onCancel: () => void
  onConfirm: (facilityIds: string[]) => void
}) {
  const [type, setType] = useState<SmallPublicFacType | ''>('')
  const [keyword, setKeyword] = useState('')
  const selectableIds = useMemo(() => rows.filter((r) => !r.alreadyInPlan).map((r) => r.facilityId), [rows])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectableIds))

  const shown = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return rows
      .filter((r) => !type || r.type === type)
      .filter(
        (r) =>
          !q ||
          [r.name, r.type, r.emd, r.ri, r.prevClass].filter(Boolean).join(' ').toLowerCase().includes(q)
      )
  }, [rows, type, keyword])

  const shownSelectable = shown.filter((r) => !r.alreadyInPlan)
  const allShownSelected =
    shownSelectable.length > 0 && shownSelectable.every((r) => selected.has(r.facilityId))

  const toggle = (id: string, locked: boolean) => {
    if (locked) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllShown = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allShownSelected) {
        for (const r of shownSelectable) next.delete(r.facilityId)
      } else {
        for (const r of shownSelectable) next.add(r.facilityId)
      }
      return next
    })
  }

  const count = selected.size

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title="정비계획 이관"
      subtitle="위험으로 바뀐 시설을 고른 뒤 «이관»을 누르면 정비계획 분석을 이어서 작성합니다."
      showHeaderClose
      onClose={onCancel}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      footer={
        <div className="flex w-full items-center gap-2.5">
          <span className="mr-auto text-[12px] text-muted-foreground">
            {count > 0 ? `${count}곳 선택` : '이관할 시설을 고르세요.'}
          </span>
          <button
            type="button"
            className={smallPublicBtnPrimary}
            disabled={count === 0}
            onClick={() => onConfirm([...selected])}
          >
            이관
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </div>
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <select
          className="standard-filter-select h-8 w-[6.5rem] max-w-none text-[12px]"
          value={type}
          onChange={(e) => setType(e.target.value as SmallPublicFacType | '')}
          aria-label="시설 유형"
        >
          <option value="">전체 유형</option>
          {SMALL_PUBLIC_FAC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="시설명·읍면·리명"
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5 scrollbar-thin">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[28rem] border-collapse text-left text-[12px]">
            <thead className="sticky top-0 z-[1] bg-muted">
              <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-[11px] [&>th]:font-medium [&>th]:text-muted-foreground">
                <th className="w-9 text-center">
                  <input
                    type="checkbox"
                    className="align-middle"
                    checked={allShownSelected}
                    disabled={shownSelectable.length === 0}
                    onChange={toggleAllShown}
                    title="표시 중 전체 선택"
                    aria-label="표시 중 전체 선택"
                  />
                </th>
                <th className="min-w-[7rem]">시설명</th>
                <th className="w-[3.75rem]">유형</th>
                <th className="min-w-[9.5rem]">구분 변경</th>
                <th className="w-[5.75rem] whitespace-nowrap">점검일</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-8 text-center text-muted-foreground">
                    {keyword.trim() || type ? '검색 결과가 없습니다.' : '이관할 시설이 없습니다.'}
                  </td>
                </tr>
              ) : (
                shown.map((r) => {
                  const on = !r.alreadyInPlan && selected.has(r.facilityId)
                  return (
                    <tr
                      key={r.facilityId}
                      className={cn(
                        'border-b border-border last:border-b-0',
                        r.alreadyInPlan
                          ? 'bg-muted/20 text-muted-foreground'
                          : on
                            ? smallPublicSelectedRowClass
                            : 'cursor-pointer hover:bg-muted/50'
                      )}
                      onClick={() => toggle(r.facilityId, r.alreadyInPlan)}
                    >
                      <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={r.alreadyInPlan}
                          onChange={() => toggle(r.facilityId, r.alreadyInPlan)}
                          aria-label={`${r.name} 선택`}
                        />
                      </td>
                      <td className="max-w-[10rem] truncate px-2 py-1.5 font-medium text-foreground" title={r.name}>
                        {r.name}
                        {r.alreadyInPlan ? (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">(포함됨)</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-foreground/80">{r.type}</td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <SmallPublicClassBadge candidate={r.prevClass} />
                          <span className="text-muted-foreground" aria-hidden>
                            →
                          </span>
                          <SmallPublicClassBadge candidate="위험" />
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground/80">{r.date}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </SmallPublicModalShell>
  )
}
