'use client'

import { useMemo, useRef } from 'react'
import { Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import {
  SMALL_PUBLIC_CANDIDATES,
  SMALL_PUBLIC_GRADES,
  type SmallPublicCandidate,
  type SmallPublicFacType,
} from '../smallPublicConfig'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'
import {
  SmallPublicChips,
  SmallPublicClassBadge,
  SmallPublicGradeBadge,
  SmallPublicPanelHeader,
  SmallPublicSortTh,
  SmallPublicTypeTabs,
  smallPublicSelectedRowClass,
  smallPublicSortRows,
  useSmallPublicScrollSelectedIntoView,
  useSmallPublicSort,
} from '../smallPublicUi'

type SortKey = 'name' | 'emd' | 'candidate' | 'grade'
const initialSortDir = () => 'asc' as const

export type SmallPublicCandidateFilter = {
  /** '' = 전체 유형 */
  type: SmallPublicFacType | ''
  candidate: SmallPublicCandidate | ''
  emd: string
  keyword: string
}

type Props = {
  filter: SmallPublicCandidateFilter
  onFilterChange: (patch: Partial<SmallPublicCandidateFilter>) => void
  emdOptions: string[]
  rows: SmallPublicFacility[]
  latestOf: (facilityId: string) => SmallPublicInspection | null
  selectedId: string | null
  onSelect: (id: string) => void
  /** 새 후보지 등록 */
  onRegister: () => void
  onClose: () => void
}

export function SmallPublicCandidateListPanel({
  filter,
  onFilterChange,
  emdOptions,
  rows,
  latestOf,
  selectedId,
  onSelect,
  onRegister,
  onClose,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useSmallPublicScrollSelectedIntoView(scrollRef, selectedId)
  const sort = useSmallPublicSort<SortKey>(initialSortDir)
  const sortedRows = useMemo(
    () =>
      smallPublicSortRows(rows, sort.sorts, (f, key) => {
        if (key === 'name') return f.name
        if (key === 'emd') return f.emd
        if (key === 'candidate') return SMALL_PUBLIC_CANDIDATES.indexOf(f.candidate)
        if (f.candidate === '제외') return null
        const g = latestOf(f.id)?.grade ?? f.riskRank
        const idx = SMALL_PUBLIC_GRADES.indexOf(g as (typeof SMALL_PUBLIC_GRADES)[number])
        return idx >= 0 ? idx : g
      }),
    [rows, sort.sorts, latestOf]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SmallPublicPanelHeader
        title="후보지"
        onClose={onClose}
        actions={
          <LayerRowPanelButton onClick={onRegister}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            후보지 등록
          </LayerRowPanelButton>
        }
      />
      <SmallPublicTypeTabs value={filter.type} onChange={(type) => onFilterChange({ type })} />

      <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2">
        <SmallPublicChips
          ariaLabel="후보지 구분"
          value={filter.candidate}
          onChange={(candidate) => onFilterChange({ candidate })}
          options={[
            { value: '', label: '전체' },
            { value: '일반', label: '일반' },
            { value: '관리', label: '관리' },
            { value: '위험', label: '위험' },
            { value: '제외', label: '제외' },
          ]}
        />
        <div className="flex items-center gap-1.5">
          <select
            className="standard-filter-select h-8 w-[6.5rem] max-w-none text-[11px]"
            value={filter.emd}
            onChange={(e) => onFilterChange({ emd: e.target.value })}
            aria-label="읍면"
          >
            <option value="">전체 읍면</option>
            {emdOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={filter.keyword}
              onChange={(e) => onFilterChange({ keyword: e.target.value })}
              placeholder="시설명·리명 검색"
              className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <table className="w-full table-fixed border-collapse text-left text-xs">
          <colgroup>
            <col />
            <col className="w-[64px]" />
            <col className="w-[64px]" />
            <col className="w-[52px]" />
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-muted">
            <tr className="[&>th]:whitespace-nowrap [&>th]:px-1.5 [&>th]:py-1 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:text-foreground/90 [&>th]:[box-shadow:inset_0_-2px_0_0_var(--border)]">
              <SmallPublicSortTh sort={sort} sortKey="name" label="시설명" className="pl-3" />
              <SmallPublicSortTh sort={sort} sortKey="emd" label="읍면" />
              <SmallPublicSortTh sort={sort} sortKey="candidate" label="구분" align="center" />
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
              sortedRows.map((f) => {
                const active = selectedId === f.id
                const grade = latestOf(f.id)?.grade ?? f.riskRank
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
                      className={cn('truncate py-1.5 pl-3 pr-1.5', active ? 'text-primary' : 'text-foreground')}
                      title={f.name}
                    >
                      {f.name}
                    </td>
                    <td className="truncate px-1.5 py-1.5 text-[11px] text-muted-foreground">{f.emd}</td>
                    <td className="px-1.5 py-1.5 text-center">
                      <SmallPublicClassBadge candidate={f.candidate} />
                    </td>
                    <td className="px-1.5 py-1.5 text-center">
                      {f.candidate !== '제외' ? <SmallPublicGradeBadge grade={grade} /> : null}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="standard-list-footer">총 {rows.length}건</div>
    </div>
  )
}
