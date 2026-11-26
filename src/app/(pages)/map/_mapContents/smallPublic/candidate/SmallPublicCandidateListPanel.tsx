'use client'

import { useMemo, useRef } from 'react'
import { Loader2, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ListPaginationBar } from '../../../_mapComponents/ListPaginationBar'
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
  /** 서버에서 받은 현재 페이지 행 */
  rows: SmallPublicFacility[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  /** 최근 안전점검 — 목록 구분·등급 표시 */
  latestOf: (facilityId: string) => SmallPublicInspection | null
  selectedId: string | null
  onSelect: (id: string) => void
  /** 새 후보지 등록 */
  onRegister: () => void
  onClose: () => void
  /** 목록 로딩 중 */
  loading?: boolean
  /** defineLayer 한글 라벨 (시설명·읍면·구분). 등급은 점검 전용 고정 */
  columnLabels?: { name?: string; emd?: string; candidate?: string }
  /** 레이어설정 show_search 기준 검색 안내 */
  searchPlaceholder?: string
}

export function SmallPublicCandidateListPanel({
  filter,
  onFilterChange,
  emdOptions,
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  latestOf,
  selectedId,
  onSelect,
  onRegister,
  onClose,
  loading = false,
  columnLabels,
  searchPlaceholder = '시설명·관리번호 검색',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sort = useSmallPublicSort<SortKey>(initialSortDir)
  const nameLabel = columnLabels?.name?.trim() || '시설명'
  const emdLabel = columnLabels?.emd?.trim() || '읍면'
  const candidateLabel = columnLabels?.candidate?.trim() || '구분'
  const sortedRows = useMemo(
    () =>
      smallPublicSortRows(
        rows,
        sort.sorts,
        (f, key) => {
          if (key === 'name') return f.name
          if (key === 'emd') return f.emd
          const latest = latestOf(f.id)
          if (key === 'candidate') {
            const cls = latest?.classResult ?? f.candidate
            return SMALL_PUBLIC_CANDIDATES.indexOf(cls)
          }
          if (key === 'grade') {
            if (f.candidate === '제외' && !latest) return null
            const g = latest?.grade
            if (!g) return null
            const idx = SMALL_PUBLIC_GRADES.indexOf(g as (typeof SMALL_PUBLIC_GRADES)[number])
            return idx >= 0 ? idx : g
          }
          return null
        },
        { excludeLast: (f) => f.candidate === '제외' }
      ),
    [rows, sort.sorts, latestOf]
  )
  useSmallPublicScrollSelectedIntoView(scrollRef, selectedId, sortedRows)

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)

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
            aria-label="읍면동"
          >
            <option value="">전체 읍면동</option>
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
              placeholder={searchPlaceholder}
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
              <SmallPublicSortTh sort={sort} sortKey="name" label={nameLabel} className="pl-3" />
              <SmallPublicSortTh sort={sort} sortKey="emd" label={emdLabel} />
              <SmallPublicSortTh sort={sort} sortKey="candidate" label={candidateLabel} align="center" />
              <SmallPublicSortTh sort={sort} sortKey="grade" label="등급" align="center" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-2 text-[12px]">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    목록을 불러오는 중…
                  </span>
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  조건에 맞는 시설이 없습니다.
                </td>
              </tr>
            ) : (
              sortedRows.map((f) => {
                const active = selectedId === f.id
                const latest = latestOf(f.id)
                const cls = latest?.classResult ?? f.candidate
                const grade = latest?.grade
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
                      <SmallPublicClassBadge candidate={cls} />
                    </td>
                    <td className="px-1.5 py-1.5 text-center">
                      {grade ? <SmallPublicGradeBadge grade={grade} /> : null}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-2">
        <span className="pl-1 text-[11px] text-muted-foreground">총 {total}건</span>
        <ListPaginationBar
          page={safePage}
          pageCount={pageCount}
          loading={loading}
          onPageChange={onPageChange}
          className="border-0 px-0"
        />
      </div>
    </div>
  )
}
