'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SMALL_PUBLIC_FAC_TYPES,
  smallPublicBtnGhost,
  type SmallPublicFacType,
} from '../smallPublicConfig'
import type { SmallPublicFacility } from '../smallPublicMock'
import { latestInspectionOf, useSmallPublicStore } from '../smallPublicStore'
import { SmallPublicGradeBadge, smallPublicDateLabel } from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

/** «분석» — 위험시설 중 정비계획에 없는 시설을 고르면 바로 분석을 시작한다 */
export function SmallPublicPlanAnalyzePickModal({
  facilities,
  onCancel,
  onPicked,
  ...overlay
}: SmallPublicModalOverlay & {
  facilities: SmallPublicFacility[]
  onCancel: () => void
  onPicked: (facility: SmallPublicFacility) => void
}) {
  const { inspections } = useSmallPublicStore()
  const [type, setType] = useState<SmallPublicFacType | ''>('')
  const [keyword, setKeyword] = useState('')
  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return facilities
      .filter((f) => !type || f.type === type)
      .filter((f) => !q || [f.name, f.mngNo, f.ri, f.emd].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.emd.localeCompare(b.emd, 'ko') || a.name.localeCompare(b.name, 'ko'))
  }, [facilities, type, keyword])
  /** 8행 이상이면 머리줄+8행 높이에서 안쪽 스크롤 */
  const listScroll = rows.length >= 8

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title="분석할 시설 선택"
      subtitle={`위험시설 중 정비계획에 없는 시설 ${facilities.length}곳입니다. 행을 누르면 바로 분석을 시작합니다.`}
      showHeaderClose
      onClose={onCancel}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      footer={
        <>
          <span className="mr-auto text-[12px] text-muted-foreground">시설을 고르면 바로 시작합니다.</span>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </>
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <select
          className="standard-filter-select h-9 w-[7.5rem] max-w-none text-[13px]"
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
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="시설명·읍면·리명 검색"
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <div className="px-4 py-3">
        <div
          className={cn(
            'overflow-x-hidden overflow-y-auto rounded-md border border-border scrollbar-thin',
            listScroll ? 'max-h-[min(22.5rem,50vh)]' : 'max-h-none'
          )}
        >
          <table className="w-full table-fixed border-collapse text-left text-[12px]">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[4.5rem]" />
              <col className="w-[7rem]" />
              <col className="w-[4.75rem]" />
              <col className="w-[6.75rem]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted">
              <tr className="[&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-border [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-[12px] [&>th]:font-medium [&>th]:text-muted-foreground">
                <th>시설명</th>
                <th>유형</th>
                <th>위치</th>
                <th className="text-center">평가 결과</th>
                <th className="whitespace-nowrap">평가일</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-8 text-center text-muted-foreground">
                    {keyword.trim() || type ? '검색 결과가 없습니다.' : '정비계획에 없는 위험시설이 없습니다.'}
                  </td>
                </tr>
              ) : (
                rows.map((f) => {
                  const latest = latestInspectionOf(inspections, f.id)
                  return (
                    <tr
                      key={f.id}
                      onClick={() => onPicked(f)}
                      className="cursor-pointer border-b border-border last:border-b-0 hover:bg-primary/5 [&>td]:px-2 [&>td]:py-1.5"
                    >
                      <td className="truncate font-medium text-foreground">{f.name}</td>
                      <td className="text-foreground/80">{f.type}</td>
                      <td className="truncate text-muted-foreground">{[f.emd, f.ri].filter(Boolean).join(' ')}</td>
                      <td className="text-center">{latest ? <SmallPublicGradeBadge grade={latest.grade} /> : '—'}</td>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {latest ? smallPublicDateLabel(latest.date) : '—'}
                      </td>
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
