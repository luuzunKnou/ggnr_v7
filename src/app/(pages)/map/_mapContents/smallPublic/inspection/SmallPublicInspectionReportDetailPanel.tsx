'use client'

import { useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, FileText, FolderInput, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { SMALL_PUBLIC_FAC_TYPES, type SmallPublicFacType } from '../smallPublicConfig'
import type { SmallPublicInspection } from '../smallPublicMock'
import {
  SmallPublicAttrTable,
  SmallPublicClassBadge,
  SmallPublicCrudBar,
  SmallPublicGradeBadge,
  SmallPublicPanelHeader,
  SmallPublicSortTh,
  smallPublicSelectedRowClass,
  smallPublicSortRows,
  useSmallPublicScrollSelectedIntoView,
  useSmallPublicSort,
} from '../smallPublicUi'
import {
  compareSmallPublicReportRows,
  type SmallPublicInspectionReport,
  type SmallPublicReportRow,
} from './smallPublicInspectionReport'

/** 보고서 대상 한 줄 + 보고서 연도의 마지막 점검 */
export type SmallPublicReportTargetRow = { row: SmallPublicReportRow; yearLatest: SmallPublicInspection | null }

type SortKey = 'name' | 'emd' | 'date' | 'grade' | 'class'
const initialSortDir = (key: SortKey) => (key === 'date' ? 'desc' : 'asc')

type DetailTab = 'overview' | 'targets'

type Props = {
  report: SmallPublicInspectionReport
  prev: SmallPublicInspectionReport | null
  targets: SmallPublicReportTargetRow[]
  selectedFacilityId: string | null
  onOpenFacility: (facilityId: string) => void
  onAddFacility: () => void
  onOpenReport: () => void
  onExcel: () => void
  /** 정비계획 이관 — 위험으로 바뀐 시설 선택 모달 */
  onTransferToPlan: () => void
  onEdit: () => void
  onDelete: () => void
  /** 목록·상세 위아래 배치 시 패널 전체 닫기만 */
  onClose: () => void
  /** 상단 패널 헤더를 셸이 그릴 때 true */
  embedded?: boolean
}

function countText(rows: SmallPublicReportRow[], key: (r: SmallPublicReportRow) => string): string {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
  return [...m.entries()].map(([k, n]) => `${k} ${n}`).join(' · ') || '—'
}

/**
 * 선택 보고서의 상세 덩어리 — 제목 띠 + 탭(개요·점검 대상).
 * 개요에 수정·삭제·보고서/엑셀/이관, 점검 대상에 시설 목록.
 */
export function SmallPublicInspectionReportDetailPanel({
  report: r,
  prev,
  targets,
  selectedFacilityId,
  onOpenFacility,
  onAddFacility,
  onOpenReport,
  onExcel,
  onTransferToPlan,
  onEdit,
  onDelete,
  onClose,
  embedded = false,
}: Props) {
  const [tab, setTab] = useState<DetailTab>('targets')
  const [type, setType] = useState<SmallPublicFacType | ''>('')
  const [emd, setEmd] = useState('')
  const emdOptions = useMemo(
    () => [...new Set(r.rows.map((x) => x.emd).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [r.rows]
  )
  const [keyword, setKeyword] = useState('')
  const [done, setDone] = useState<'' | 'done' | 'todo'>('')
  const scrollRef = useRef<HTMLDivElement>(null)
  useSmallPublicScrollSelectedIntoView(scrollRef, selectedFacilityId)
  const sort = useSmallPublicSort<SortKey>(initialSortDir)

  const inspectedCount = targets.filter((t) => t.yearLatest).length
  const pct = r.rows.length ? Math.round((inspectedCount / r.rows.length) * 100) : 0
  const changes = prev ? compareSmallPublicReportRows(r.rows, prev.rows) : null

  const shown = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const filtered = targets
      .filter((t) => !type || t.row.type === type)
      .filter((t) => !emd || t.row.emd === emd)
      .filter((t) => !done || (done === 'done' ? Boolean(t.yearLatest) : !t.yearLatest))
      .filter((t) => !q || [t.row.name, t.row.mngNo, t.row.emd, t.row.ri].join(' ').toLowerCase().includes(q))
    return smallPublicSortRows(filtered, sort.sorts, (t, key) => {
      if (key === 'name') return t.row.name
      if (key === 'emd') return t.row.emd
      if (key === 'date') return t.yearLatest?.date
      if (key === 'grade') return t.yearLatest ? ['양호', '보통', '불량'].indexOf(t.yearLatest.grade) : null
      return t.yearLatest ? t.yearLatest.classResult : t.row.prevClass
    })
  }, [targets, type, emd, done, keyword, sort.sorts])

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'overview', label: '개요' },
    { key: 'targets', label: '점검 대상' },
  ]

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-[12px]">
      {embedded ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground" title={r.title}>
            {r.title}
          </span>
          <span
            className="inline-flex shrink-0 items-center rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary"
            title={`점검 완료 ${inspectedCount}곳 / 전체 ${r.rows.length}곳`}
          >
            {inspectedCount}/{r.rows.length} ({pct}%)
          </span>
        </div>
      ) : (
        <SmallPublicPanelHeader title={r.title} onClose={onClose} />
      )}

      {/* 보고서·엑셀·이관 — 탭과 무관하게 항상 (점검 대상에서도 이관 가능) */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
        {[
          { label: '보고서', icon: FileText, onClick: onOpenReport, title: '보고서 미리보기·인쇄·한글 다운로드' },
          { label: '엑셀', icon: FileSpreadsheet, onClick: onExcel, title: '점검 대상 목록 엑셀' },
          {
            label: '정비계획 이관',
            icon: FolderInput,
            onClick: onTransferToPlan,
            title: '점검 후 위험으로 바뀐 시설을 정비계획으로 넘김',
          },
        ].map(({ label, icon: Icon, onClick, title }) => (
          <button
            key={label}
            type="button"
            title={title}
            onClick={onClick}
            className="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border border-border bg-background px-2 text-[11px] text-foreground transition-colors hover:bg-muted/60"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="shrink-0 border-b border-border px-3 py-1.5" role="tablist" aria-label="보고서 상세">
        <div className="flex gap-0.5 overflow-x-auto rounded-lg bg-muted p-1 scrollbar-hide">
          {tabs.map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  'h-7 min-w-0 flex-1 whitespace-nowrap rounded px-2 text-center text-[12px] transition-colors',
                  active
                    ? 'bg-background font-semibold text-primary shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'overview' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto py-2.5 pl-3 pr-0 scrollbar-thin">
            <SmallPublicAttrTable
              entries={[
                { key: 'year', label: '연도', value: `${r.year}년` },
                { key: 'agency', label: '점검 기관', value: r.agency || '—' },
                { key: 'author', label: '작성자', value: r.author || '—' },
                { key: 'created', label: '작성일', value: r.createdAt.slice(0, 10) },
                {
                  key: 'done',
                  label: '점검 완료',
                  value: `${inspectedCount}곳 / ${r.rows.length}곳 (${pct}%)`,
                },
                { key: 'types', label: '대상(유형별)', value: countText(r.rows, (x) => x.type), full: true },
                { key: 'classes', label: '대상(구분별)', value: countText(r.rows, (x) => x.prevClass), full: true },
                {
                  key: 'diff',
                  label: '전년 대비',
                  value: changes
                    ? `신규 ${changes.added.length} · 제외 ${changes.removed.length} · 구분 변경 ${changes.changed.length} (${prev!.year}년 기준)`
                    : `${r.year - 1}년 보고서 없음`,
                  full: true,
                },
                { key: 'summary', label: '개요', value: r.summary || '—', full: true },
              ]}
            />
          </div>
          <SmallPublicCrudBar onEdit={onEdit} onDelete={onDelete} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="시설명·관리번호·읍면·리명"
                  className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                />
              </div>
              <LayerRowPanelButton onClick={onAddFacility}>
                <Plus className="h-3 w-3 shrink-0" aria-hidden />
                시설 추가
              </LayerRowPanelButton>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                className="standard-filter-select h-7 w-[6.5rem] max-w-none text-[11px]"
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
              <select
                className="standard-filter-select h-7 min-w-[5.5rem] max-w-none flex-1 text-[11px]"
                value={emd}
                onChange={(e) => setEmd(e.target.value)}
                aria-label="읍면"
              >
                <option value="">전체 읍면</option>
                {emdOptions.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <select
                className="standard-filter-select h-7 w-[6.5rem] max-w-none text-[11px]"
                value={done}
                onChange={(e) => setDone(e.target.value as '' | 'done' | 'todo')}
                aria-label="점검 여부"
              >
                <option value="">점검 전체</option>
                <option value="done">점검 완료</option>
                <option value="todo">미점검</option>
              </select>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            <table className="w-full table-fixed border-collapse text-left text-[12px] leading-snug">
              <colgroup>
                <col />
                <col className="w-[4.5rem]" />
                <col className="w-[5.25rem]" />
                <col className="w-[3.5rem]" />
                <col className="w-[4rem]" />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-muted">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-1.5 [&>th]:py-1.5 [&>th]:font-semibold [&>th]:text-foreground/90 [&>th]:[box-shadow:inset_0_-2px_0_0_var(--border)]">
                  <SmallPublicSortTh sort={sort} sortKey="name" label="시설명" className="px-1.5 py-1.5 pl-3" />
                  <SmallPublicSortTh sort={sort} sortKey="emd" label="읍면" className="px-1.5 py-1.5" />
                  <SmallPublicSortTh sort={sort} sortKey="date" label="점검일" className="px-1.5 py-1.5" />
                  <SmallPublicSortTh sort={sort} sortKey="grade" label="등급" align="center" className="px-1.5 py-1.5" />
                  <SmallPublicSortTh sort={sort} sortKey="class" label="구분" align="center" className="px-1.5 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                      조건에 맞는 시설이 없습니다.
                    </td>
                  </tr>
                ) : (
                  shown.map(({ row, yearLatest }) => {
                    const active = selectedFacilityId === row.facilityId
                    return (
                      <tr
                        key={row.facilityId}
                        data-row-id={row.facilityId}
                        role="button"
                        tabIndex={0}
                        aria-pressed={active}
                        onClick={() => onOpenFacility(row.facilityId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onOpenFacility(row.facilityId)
                          }
                        }}
                        className={cn(
                          'cursor-pointer border-b border-border transition-colors',
                          active ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                        )}
                      >
                        <td
                          className={cn('truncate px-1.5 py-1.5 pl-3', active ? 'text-primary' : 'text-foreground')}
                          title={`${row.name} (${row.type})`}
                        >
                          {row.name}
                        </td>
                        <td className="truncate px-1.5 py-1.5 text-muted-foreground">{row.emd}</td>
                        <td className="truncate px-1.5 py-1.5 tabular-nums text-muted-foreground">
                          {yearLatest?.date ?? <span className="text-amber-700">미점검</span>}
                        </td>
                        <td className="px-1.5 py-1.5 text-center">
                          {yearLatest ? <SmallPublicGradeBadge grade={yearLatest.grade} /> : null}
                        </td>
                        <td className="px-1.5 py-1.5 text-center">
                          <SmallPublicClassBadge candidate={yearLatest ? yearLatest.classResult : row.prevClass} />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex shrink-0 items-center border-t border-border px-3 py-1.5 text-[12px] text-muted-foreground">
            {shown.length}곳 표시 · 점검 완료 {inspectedCount}곳
          </div>
        </div>
      )}
    </div>
  )
}
