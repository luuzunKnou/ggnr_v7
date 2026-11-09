'use client'

import { useMemo, useRef } from 'react'
import { Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { SMALL_PUBLIC_GRADES, type SmallPublicFacType, type SmallPublicGrade } from '../smallPublicConfig'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'
import {
  SmallPublicChips,
  SmallPublicGradeBadge,
  SmallPublicPanelHeader,
  SmallPublicSortTh,
  SmallPublicTypeTabs,
  smallPublicSelectedRowClass,
  smallPublicSortRows,
  useSmallPublicScrollSelectedIntoView,
  useSmallPublicSort,
} from '../smallPublicUi'

type SortKey = 'name' | 'emd' | 'date' | 'grade'
const initialSortDir = (key: SortKey) => (key === 'date' ? 'desc' : 'asc')

export type SmallPublicGradeFilter = SmallPublicGrade | ''

export type SmallPublicInspectionListRow = {
  facility: SmallPublicFacility
  latest: SmallPublicInspection | null
}

type Props = {
  type: SmallPublicFacType
  onTypeChange: (type: SmallPublicFacType) => void
  grade: SmallPublicGradeFilter
  onGradeChange: (grade: SmallPublicGradeFilter) => void
  keyword: string
  onKeywordChange: (keyword: string) => void
  rows: SmallPublicInspectionListRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** 후보지에서 점검 대상 시설 골라 넣기 */
  onRegisterFacility: () => void
  onClose: () => void
}

export function SmallPublicInspectionListPanel({
  type,
  onTypeChange,
  grade,
  onGradeChange,
  keyword,
  onKeywordChange,
  rows,
  selectedId,
  onSelect,
  onRegisterFacility,
  onClose,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useSmallPublicScrollSelectedIntoView(scrollRef, selectedId)
  const sort = useSmallPublicSort<SortKey>(initialSortDir)
  const sortedRows = useMemo(
    () =>
      smallPublicSortRows(rows, sort.sorts, ({ facility: f, latest }, key) => {
        if (key === 'name') return f.name
        if (key === 'emd') return f.emd
        if (key === 'date') return latest?.date
        return latest ? SMALL_PUBLIC_GRADES.indexOf(latest.grade) : null
      }),
    [rows, sort.sorts]
  )
  const thisYear = String(new Date().getFullYear())
  const inspectedThisYear = rows.filter((r) => r.latest?.date.startsWith(thisYear)).length

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SmallPublicPanelHeader
        title="안전점검"
        onClose={onClose}
        actions={
          <LayerRowPanelButton onClick={onRegisterFacility}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            시설 등록
          </LayerRowPanelButton>
        }
      />
      <SmallPublicTypeTabs value={type} onChange={onTypeChange} />

      <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2">
        <SmallPublicChips
          ariaLabel="최근 등급"
          value={grade}
          onChange={onGradeChange}
          options={[
            { value: '', label: '전체' },
            { value: '양호', label: '양호' },
            { value: '보통', label: '보통' },
            { value: '불량', label: '불량' },
          ]}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="시설명·리명·점검일 검색"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <table className="w-full table-fixed border-collapse text-left text-xs">
          <colgroup>
            <col />
            <col className="w-[64px]" />
            <col className="w-[84px]" />
            <col className="w-[52px]" />
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-muted">
            <tr className="[&>th]:whitespace-nowrap [&>th]:px-1.5 [&>th]:py-1 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:text-foreground/90 [&>th]:[box-shadow:inset_0_-2px_0_0_var(--border)]">
              <SmallPublicSortTh sort={sort} sortKey="name" label="시설명" className="pl-3" />
              <SmallPublicSortTh sort={sort} sortKey="emd" label="읍면" />
              <SmallPublicSortTh sort={sort} sortKey="date" label="최근 점검일" />
              <SmallPublicSortTh sort={sort} sortKey="grade" label="등급" align="center" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  조건에 맞는 시설이 없습니다.
                </td>
              </tr>
            ) : (
              sortedRows.map(({ facility: f, latest }) => {
                const active = selectedId === f.id
                return (
                  <tr
                    key={f.id}
                    data-row-id={f.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onClick={() => onSelect(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(f.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border transition-colors',
                      active ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                    )}
                  >
                    <td
                      className={cn('truncate py-1.5 pl-3 pr-1.5 font-medium', active ? 'text-primary' : 'text-foreground')}
                      title={f.name}
                    >
                      {f.name}
                    </td>
                    <td className="truncate px-1.5 py-1.5 text-[11px] text-muted-foreground">{f.emd}</td>
                    <td className="truncate px-1.5 py-1.5 text-[11px] tabular-nums text-muted-foreground">
                      {latest?.date ?? '—'}
                    </td>
                    <td className="px-1.5 py-1.5 text-center">
                      <SmallPublicGradeBadge grade={latest?.grade} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="standard-list-footer">
        총 {rows.length}건 · 올해 점검 {inspectedThisYear}건
      </div>
    </div>
  )
}
