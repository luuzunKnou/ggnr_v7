'use client'

import { Fragment, useMemo } from 'react'
import { FileSpreadsheet, FlaskConical, Link2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { SYSTEM_PARAMS } from './smallPublicPlanMaster'
import {
  planRate,
  planSheetCells,
  planSheetMid,
  sumPlanSheetCells,
  toMillion,
  type PlanRanked,
  type PlanSheetCells,
} from './smallPublicPlanCalc'
import {
  PLAN_STATUS_LABEL,
  PLAN_STATUSES,
  canLinkToBudget,
  isPlanInAnalysis,
  type PlanStatus,
} from './smallPublicPlanTypes'
import { PlanStatusBadge } from './smallPublicPlanUi'

export type SmallPublicPlanFilter = { keyword: string; emd: string; status: PlanStatus | '' }

type Props = {
  filter: SmallPublicPlanFilter
  onFilterChange: (patch: Partial<SmallPublicPlanFilter>) => void
  emdOptions: string[]
  startYear: number
  onStartYearChange: (year: number) => void
  /** 필터를 건 순위 목록(우선순위 순) */
  rows: PlanRanked[]
  /** 요약 집계용 전체 */
  all: PlanRanked[]
  /** 정비계획에 없는 위험시설 수(분석 필요) */
  needAnalysis: number
  /** 예산 계획용 선택(입력 완료 추정·확정, 검토·미완료 추정 제외) */
  selectedIds: Set<string>
  onToggleSelect: (unitId: string) => void
  onToggleSelectAllShown: () => void
  onOpenBudgetLink: () => void
  onOpen: (unitId: string) => void
  onAnalyze: () => void
  onExport: () => void
  onClose: () => void
}

const qtyText = (n: number) => (n ? Math.round(n).toLocaleString('ko-KR') : '')
const costText = (won: number) => (won ? toMillion(won) : '')
const rateText = (r: number | null) => (r == null || r === 0 ? '' : r.toFixed(1))
const numText = (n: number, digits = 0) => (n ? n.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '')

/** 머리·본문 동일 열 — 제목·계와 행 너비 맞춤 */
const planSheetCols = (
  <colgroup>
    <col className="w-9" />
    <col className="w-[150px]" />
    <col className="w-[110px]" />
    {Array.from({ length: 23 }, (_, i) => (
      <col key={i} />
    ))}
    <col className="w-[44px]" />
  </colgroup>
)

const planSheetTableClass = cn(
  'w-full table-fixed border-separate border-spacing-0 text-[11px]',
  '[&_th]:border-b [&_th]:border-r [&_th]:border-border [&_th]:bg-muted [&_th]:px-1 [&_th]:py-1 [&_th]:text-center [&_th]:font-semibold [&_th]:text-foreground/90',
  '[&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1.5',
  '[&_td.num]:text-right [&_td.num]:tabular-nums'
)

function Cells({ c }: { c: PlanSheetCells }) {
  const mid = planSheetMid(c)
  return (
    <>
      <td className="num">{qtyText(c.totalQty)}</td>
      <td className="num">{costText(c.totalCost)}</td>
      <td className="num">{qtyText(c.doneQty)}</td>
      <td className="num">{costText(c.doneCost)}</td>
      <td className="num">{rateText(planRate(c.doneQty, c.totalQty))}</td>
      <td className="num">{qtyText(mid.qty)}</td>
      <td className="num">{costText(mid.cost)}</td>
      <td className="num">{rateText(planRate(mid.qty, c.totalQty))}</td>
      {c.years.map((y, i) => (
        <Fragment key={i}>
          <td className="num">{qtyText(y.qty)}</td>
          <td className="num">{costText(y.cost)}</td>
        </Fragment>
      ))}
      <td className="num">{numText(c.people)}</td>
      <td className="num">{numText(c.farmHa, 1)}</td>
      <td className="num">{numText(c.buildings)}</td>
      <td className="num">{qtyText(c.afterQty)}</td>
      <td className="num">{costText(c.afterCost)}</td>
    </>
  )
}

/**
 * 중기 정비계획 명세서(별지 제3호 형태) — 단위 m, 백만원, %.
 * 제목·계는 스크롤 밖(세로), 시설 행만 세로 스크롤. 가로는 표 전체 공유. 추정·검토는 분석, 확정은 개요·결과.
 * 예산 계획은 입력이 끝난 추정·확정만.
 */
export function SmallPublicPlanSheet({
  filter,
  onFilterChange,
  emdOptions,
  startYear,
  onStartYearChange,
  rows,
  all,
  needAnalysis,
  selectedIds,
  onToggleSelect,
  onToggleSelectAllShown,
  onOpenBudgetLink,
  onOpen,
  onAnalyze,
  onExport,
  onClose,
}: Props) {
  const cells = useMemo(() => rows.map((r) => ({ r, c: planSheetCells(r) })), [rows])
  const total = useMemo(() => sumPlanSheetCells(cells.map((x) => x.c)), [cells])
  const years = Array.from({ length: SYSTEM_PARAMS.PLAN_PERIOD_YEARS }, (_, i) => startYear + i)
  const thisYear = new Date().getFullYear()
  const linkableRows = useMemo(() => rows.filter((r) => canLinkToBudget(r)), [rows])
  const allLinkableSelected =
    linkableRows.length > 0 && linkableRows.every((r) => selectedIds.has(r.unit.id))
  const kpi = useMemo(() => {
    const sum = (list: PlanRanked[]) => list.reduce((n, r) => n + r.summary.cost.total, 0)
    return {
      count: all.length,
      total: sum(all),
      phase1: sum(all.filter((r) => r.phase === 1)),
      phase2: sum(all.filter((r) => r.phase === 2)),
      analyzing: all.filter((r) => isPlanInAnalysis(r.version)).length,
    }
  }, [all])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[12px] font-semibold">정비계획</span>
        <span className="text-[11px] text-muted-foreground">중기 정비계획 명세서 (단위: m, 백만원, %)</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onAnalyze}
            title={needAnalysis > 0 ? `정비계획에 없는 위험시설 ${needAnalysis}곳 분석` : '분석할 시설 고르기'}
            className="inline-flex items-center gap-1 rounded border border-primary bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <FlaskConical className="h-3 w-3 shrink-0" aria-hidden />
            분석
            {needAnalysis > 0 ? (
              <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold leading-4 text-amber-950 tabular-nums">
                {needAnalysis}
              </span>
            ) : null}
          </button>
          <LayerRowPanelButton
            onClick={onOpenBudgetLink}
            disabled={selectedIds.size === 0}
            title={
              selectedIds.size > 0
                ? `선택한 ${selectedIds.size}곳을 예산에 배정`
                : '입력 완료된 추정·확정 시설을 선택한 뒤 예산 계획'
            }
          >
            <Link2 className="h-3 w-3 shrink-0" aria-hidden />
            예산 계획
            {selectedIds.size > 0 ? (
              <span className="rounded-full bg-sky-500/15 px-1.5 text-[10px] font-semibold leading-4 text-sky-800 tabular-nums dark:text-sky-200">
                {selectedIds.size}
              </span>
            ) : null}
          </LayerRowPanelButton>
          <LayerRowPanelButton onClick={onExport}>
            <FileSpreadsheet className="h-3 w-3 shrink-0" aria-hidden />
            엑셀
          </LayerRowPanelButton>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
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
        <select
          className="standard-filter-select h-8 w-[5.5rem] max-w-none text-[11px]"
          value={filter.status}
          onChange={(e) => onFilterChange({ status: e.target.value as PlanStatus | '' })}
          aria-label="상태"
        >
          <option value="">전체 상태</option>
          {PLAN_STATUSES.filter((s) => s !== 'REVIEW').map((s) => (
            <option key={s} value={s}>
              {PLAN_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="standard-filter-select h-8 w-[7.5rem] max-w-none text-[11px]"
          value={startYear}
          onChange={(e) => onStartYearChange(Number(e.target.value))}
          aria-label="중기계획 연도"
        >
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}~{y + SYSTEM_PARAMS.PLAN_PERIOD_YEARS - 1}년
            </option>
          ))}
        </select>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={filter.keyword}
            onChange={(e) => onFilterChange({ keyword: e.target.value })}
            placeholder="시설명·리명 검색"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-x-4 text-[12px] text-muted-foreground">
          <span>
            대상 <span className="text-foreground">{kpi.count}곳</span>
          </span>
          <span>
            총사업비 <span className="tabular-nums text-foreground">{toMillion(kpi.total)}</span>
          </span>
          <span>
            1단계 <span className="tabular-nums text-foreground">{toMillion(kpi.phase1)}</span>
          </span>
          <span>
            2단계 <span className="tabular-nums text-foreground">{toMillion(kpi.phase2)}</span>
          </span>
          <span>
            분석 중 <span className="text-foreground">{kpi.analyzing}곳</span>
          </span>
        </div>
      </div>

      {/* 가로 스크롤은 공유, 세로 스크롤은 시설 행만 — 제목·계는 스크롤 범위 밖 */}
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full min-w-[1400px] flex-col">
              <div className="shrink-0 border-b border-border">
                <table className={planSheetTableClass}>
                  {planSheetCols}
                  <thead>
                    <tr>
                      <th rowSpan={3}>
                        <input
                          type="checkbox"
                          className="align-middle"
                          checked={allLinkableSelected}
                          disabled={linkableRows.length === 0}
                          onChange={onToggleSelectAllShown}
                          title="표시 중 입력 완료 추정·확정 시설 전체 선택"
                          aria-label="표시 중 입력 완료 추정·확정 시설 전체 선택"
                        />
                      </th>
                      <th rowSpan={3}>시설명칭</th>
                      <th rowSpan={3}>위치</th>
                      <th colSpan={2} rowSpan={2}>
                        전체 정비계획
                      </th>
                      <th colSpan={3} rowSpan={2}>
                        정비된 부분
                      </th>
                      <th colSpan={3 + years.length * 2 + 3}>중기 정비계획</th>
                      <th colSpan={2} rowSpan={2}>
                        5개년 후 정비대상
                      </th>
                      <th rowSpan={3}>
                        우선
                        <br />
                        순위
                      </th>
                    </tr>
                    <tr>
                      <th colSpan={3}>계</th>
                      {years.map((y) => (
                        <th key={y} colSpan={2}>
                          {y}년
                        </th>
                      ))}
                      <th colSpan={3}>사업효과</th>
                    </tr>
                    <tr>
                      <th>사업량</th>
                      <th>사업비</th>
                      <th>사업량</th>
                      <th>사업비</th>
                      <th>정비율</th>
                      <th>사업량</th>
                      <th>사업비</th>
                      <th>정비율</th>
                      {years.map((y) => (
                        <Fragment key={y}>
                          <th>사업량</th>
                          <th>사업비</th>
                        </Fragment>
                      ))}
                      <th>
                        수혜자
                        <br />
                        (명)
                      </th>
                      <th>
                        농경지
                        <br />
                        (ha)
                      </th>
                      <th>
                        건물
                        <br />
                        (동)
                      </th>
                      <th>사업량</th>
                      <th>사업비</th>
                    </tr>
                    <tr className="font-semibold [&>td]:border-b-0 [&>td]:bg-slate-100 dark:[&>td]:bg-slate-800">
                      <td />
                      <td className="text-center">계</td>
                      <td className="text-center font-normal text-muted-foreground">{rows.length}곳</td>
                      <Cells c={total} />
                      <td />
                    </tr>
                  </thead>
                </table>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
                <table className={planSheetTableClass}>
                  {planSheetCols}
                  <tbody>
                    {cells.length === 0 ? (
                      <tr>
                        <td colSpan={27} className="border-b-0 border-r-0 py-10 text-center text-muted-foreground">
                          조건에 맞는 정비계획이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      cells.map(({ r, c }) => {
                        const analyzing = isPlanInAnalysis(r.version)
                        const linkable = canLinkToBudget(r)
                        const selected = selectedIds.has(r.unit.id)
                        const linkBlockedTitle =
                          r.version.status === 'REVIEW'
                            ? '검토 중인 시설은 예산 계획할 수 없습니다'
                            : r.version.status === 'DRAFT'
                              ? '입력이 완료된 추정만 예산 계획할 수 있습니다'
                              : '예산 계획할 수 없습니다'
                        return (
                          <tr
                            key={r.unit.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpen(r.unit.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onOpen(r.unit.id)
                              }
                            }}
                            className={cn(
                              'cursor-pointer transition-colors hover:bg-primary/5',
                              analyzing && 'bg-amber-50/60 dark:bg-amber-950/20',
                              selected && linkable && 'bg-primary/10'
                            )}
                            title={analyzing ? '분석 화면 열기' : '개요·결과 보기'}
                          >
                            <td
                              className={cn('text-center', linkable && 'cursor-pointer')}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (linkable) onToggleSelect(r.unit.id)
                              }}
                              title={linkable ? '예산 계획 선택' : linkBlockedTitle}
                            >
                              <input
                                type="checkbox"
                                className="pointer-events-none align-middle"
                                checked={selected}
                                disabled={!linkable}
                                readOnly
                                tabIndex={-1}
                                aria-label={`${r.unit.unitName} 선택`}
                              />
                            </td>
                            <td>
                              <div className="flex items-center gap-1">
                                <span className="min-w-0 truncate">{r.unit.unitName}</span>
                                {analyzing ? <PlanStatusBadge status={r.version.status} /> : null}
                              </div>
                            </td>
                            <td className="truncate text-muted-foreground">
                              {r.unit.emd} {r.unit.ri}
                            </td>
                            <Cells c={c} />
                            <td className="text-center tabular-nums">{r.finalRank}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>총 {rows.length}건</span>
        {selectedIds.size > 0 ? <span className="text-foreground">예산 계획 선택 {selectedIds.size}곳</span> : null}
        <span>정비율 = 사업량 ÷ 전체 정비계획 사업량</span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-100 align-middle" />
          분석 중(추정·검토) — 누르면 분석 화면, 그 밖에는 개요·결과 · 입력 완료 추정·확정 선택 후 «예산 계획»
        </span>
      </div>
    </div>
  )
}
