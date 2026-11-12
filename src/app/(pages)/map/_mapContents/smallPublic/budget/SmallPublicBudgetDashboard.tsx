'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip, type ChartOptions } from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { Bar } from 'react-chartjs-2'
import { cn } from '@/lib/utils'
import { planRate, planSheetCells, sumPlanSheetCells, type PlanRanked } from '../plan/smallPublicPlanCalc'
import type { PlanUnit } from '../plan/smallPublicPlanTypes'
import { budgetAllocWon, budgetExecWon, budgetYearStats, budgetYears, millionText } from './smallPublicBudgetCalc'
import { useSmallPublicBudgetStore } from './smallPublicBudgetStore'
import { CONSTRUCTION_STATUS_LABEL } from './smallPublicBudgetTypes'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, ChartDataLabels)
ChartJS.defaults.font.family = '"S-Core Dream", sans-serif'
ChartJS.defaults.font.weight = 'normal'

const toMillionNum = (won: number) => Math.round(won / 100_000) / 10

/** 대비가 큰 막대 색 */
const COLOR = {
  budget: '#64748b',
  alloc: '#0ea5e9',
  exec: '#1d4ed8',
  emd: ['#1d4ed8', '#0369a1', '#0e7490', '#0f766e', '#15803d', '#a16207', '#c2410c'],
  type: '#0f766e',
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : 0)
const rateText = (r: number | null) => (r == null ? '—' : `${r.toFixed(1)}%`)

export type BudgetListTab = 'budget' | 'construction'

function barOptions(horizontal: boolean, legend: boolean): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    layout: { padding: horizontal ? { right: 28 } : { top: 18 } },
    datasets: {
      bar: {
        categoryPercentage: 0.72,
        barPercentage: 0.88,
      },
    },
    plugins: {
      legend: {
        display: legend,
        position: 'bottom',
        labels: { boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label ?? ''} ${Number(ctx.raw).toLocaleString('ko-KR')}백만원`,
        },
      },
      datalabels: {
        display: (ctx) => Number(ctx.dataset.data[ctx.dataIndex]) > 0,
        anchor: horizontal ? 'end' : 'end',
        align: horizontal ? 'end' : 'top',
        offset: horizontal ? 4 : 2,
        clamp: true,
        clip: false,
        color: '#334155',
        font: { size: 11 },
        formatter: (v) => {
          const n = Number(v)
          if (!n) return ''
          return n % 1 === 0 ? n.toLocaleString('ko-KR') : n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
        },
      },
    },
    scales: {
      x: {
        border: { display: false },
        ticks: { font: { size: 11 }, color: '#64748b', maxRotation: 0 },
        grid: { display: horizontal, color: 'rgba(100,116,139,0.18)' },
      },
      y: {
        border: { display: false },
        ticks: { font: { size: 11 }, color: '#64748b' },
        grid: { display: !horizontal, color: 'rgba(100,116,139,0.18)' },
      },
    },
  }
}

function StatCard({
  title,
  aside,
  value,
  bar,
  foot,
  hint,
  onClick,
}: {
  title: string
  aside?: ReactNode
  value: ReactNode
  bar: ReactNode
  foot: ReactNode
  hint?: string
  onClick?: () => void
}) {
  const clickable = !!onClick
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      title={hint}
      className={cn(
        'flex min-w-0 flex-col rounded-md border border-border bg-background px-3 py-2.5 text-left transition-colors',
        clickable && 'cursor-pointer hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !clickable && 'cursor-default'
      )}
    >
      <div className="flex items-baseline gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
        {aside ? <p className="ml-auto truncate text-[10px] tabular-nums text-muted-foreground">{aside}</p> : null}
      </div>
      <p className="mt-1 text-[20px] font-semibold leading-tight tabular-nums">{value}</p>
      <div className="mt-2">{bar}</div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">{foot}</div>
    </button>
  )
}

function Track({ children }: { children: ReactNode }) {
  return <div className="relative flex h-1.5 overflow-hidden rounded-full bg-muted">{children}</div>
}

function Dot({ color, label, value }: { color: string; label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className={cn('h-1.5 w-1.5 rounded-full', color)} />
      {label} <span className="tabular-nums text-foreground">{value}</span>
    </span>
  )
}

function ChartBox({
  title,
  unit,
  children,
  empty,
}: {
  title: string
  unit?: string
  children: ReactNode
  empty?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-md border border-border bg-background p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{title}</p>
        {unit ? <span className="shrink-0 text-[11px] text-muted-foreground">단위: {unit}</span> : null}
      </div>
      <div className="relative h-52">
        {empty ? (
          <p className="flex h-full items-center justify-center text-[12px] text-muted-foreground">집행 내역이 없습니다.</p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

/**
 * 현황 대시보드 — 연도 카드 4개 + 차트 3개.
 * 카드 클릭 시 아래 예산·공사 목록 탭으로 이동한다.
 */
export function SmallPublicBudgetDashboard({
  ranked,
  unitById,
  onOpenList,
}: {
  ranked: PlanRanked[]
  unitById: Map<string, PlanUnit>
  onOpenList?: (tab: BudgetListTab) => void
}) {
  const { budgets, constructions } = useSmallPublicBudgetStore()
  const years = useMemo(() => budgetYears(budgets), [budgets])
  const [year, setYear] = useState(() => new Date().getFullYear())
  const stats = useMemo(() => budgetYearStats(year, budgets, constructions, unitById), [year, budgets, constructions, unitById])

  const trend = useMemo(() => {
    const ys = [...years].sort((a, b) => a - b)
    const sum = (y: number, f: (b: (typeof budgets)[number]) => number) =>
      toMillionNum(budgets.filter((b) => b.fiscalYear === y).reduce((n, b) => n + f(b), 0))
    return {
      labels: ys.map((y) => `${y}년`),
      datasets: [
        {
          label: '예산',
          data: ys.map((y) => sum(y, (b) => b.amountWon)),
          backgroundColor: COLOR.budget,
          borderRadius: 4,
          maxBarThickness: 36,
        },
        {
          label: '배정',
          data: ys.map((y) => sum(y, budgetAllocWon)),
          backgroundColor: COLOR.alloc,
          borderRadius: 4,
          maxBarThickness: 36,
        },
        {
          label: '집행',
          data: ys.map((y) => sum(y, budgetExecWon)),
          backgroundColor: COLOR.exec,
          borderRadius: 4,
          maxBarThickness: 36,
        },
      ],
    }
  }, [years, budgets])

  const plan = useMemo(() => {
    const total = sumPlanSheetCells(ranked.map(planSheetCells))
    return {
      count: ranked.length,
      doneCount: ranked.filter((r) => (r.version.done?.costWon ?? 0) > 0).length,
      total,
      qtyRate: planRate(total.doneQty, total.totalQty),
      costRate: total.totalCost > 0 ? Math.round((total.doneCost / total.totalCost) * 1000) / 10 : null,
    }
  }, [ranked])

  const c = stats.constructions
  const cTotal = c.PLANNED + c.ONGOING + c.DONE
  const yearOptions = years.length > 0 ? years : [year]
  const m = (n: number) => Math.round(n).toLocaleString('ko-KR')

  return (
    <div className="px-3 py-2.5">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <select
          className="h-7 w-[6.25rem] max-w-none cursor-pointer rounded-md border border-border bg-background px-2 text-[12px] outline-none"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="연도"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">금액 단위 백만원</span>
      </div>

      <div className="mb-2.5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={`${year}년 예산 집행률`}
          aside={`${millionText(stats.execWon)} / ${millionText(stats.amountWon)}`}
          value={<span className="text-primary">{rateText(stats.rate)}</span>}
          hint="예산 관리 목록으로 이동 · 집행률 = 집행 ÷ 예산"
          onClick={onOpenList ? () => onOpenList('budget') : undefined}
          bar={
            <Track>
              <div className="absolute inset-y-0 left-0 rounded-full bg-sky-300/70" style={{ width: `${pct(stats.allocWon, stats.amountWon)}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct(stats.execWon, stats.amountWon)}%` }} />
            </Track>
          }
          foot={
            <>
              <Dot color="bg-slate-300" label="예산" value={millionText(stats.amountWon)} />
              <Dot color="bg-sky-300" label="배정" value={millionText(stats.allocWon)} />
              <Dot color="bg-primary" label="집행" value={millionText(stats.execWon)} />
              <span className={cn('whitespace-nowrap', stats.remainWon > 0 && 'text-amber-600 dark:text-amber-400')}>
                잔액 <span className="tabular-nums">{millionText(stats.remainWon)}</span>
              </span>
            </>
          }
        />
        <StatCard
          title={`${year}년 공사`}
          value={`${cTotal}건`}
          hint="공사대장 목록으로 이동"
          onClick={onOpenList ? () => onOpenList('construction') : undefined}
          bar={
            <Track>
              <div className="h-full bg-slate-300" style={{ width: `${pct(c.PLANNED, cTotal)}%` }} />
              <div className="h-full bg-sky-500" style={{ width: `${pct(c.ONGOING, cTotal)}%` }} />
              <div className="h-full bg-emerald-500" style={{ width: `${pct(c.DONE, cTotal)}%` }} />
            </Track>
          }
          foot={
            <>
              <Dot color="bg-slate-300" label={CONSTRUCTION_STATUS_LABEL.PLANNED} value={`${c.PLANNED}건`} />
              <Dot color="bg-sky-500" label={CONSTRUCTION_STATUS_LABEL.ONGOING} value={`${c.ONGOING}건`} />
              <Dot color="bg-emerald-500" label={CONSTRUCTION_STATUS_LABEL.DONE} value={`${c.DONE}건`} />
            </>
          }
        />
        <StatCard
          title="사업량 정비율"
          aside={`정비계획 ${plan.count}곳`}
          value={<span className="text-emerald-600 dark:text-emerald-400">{rateText(plan.qtyRate)}</span>}
          hint="공사대장으로 이동 · 준공 시공 사업량 ÷ 전체 정비계획 사업량"
          onClick={onOpenList ? () => onOpenList('construction') : undefined}
          bar={
            <Track>
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${plan.qtyRate ?? 0}%` }} />
            </Track>
          }
          foot={
            <span className="tabular-nums">
              준공 {m(plan.total.doneQty)}m / 전체 {m(plan.total.totalQty)}m
            </span>
          }
        />
        <StatCard
          title="사업비 정비율"
          aside={`준공 시설 ${plan.doneCount}곳`}
          value={<span className="text-emerald-600 dark:text-emerald-400">{rateText(plan.costRate)}</span>}
          hint="공사대장으로 이동 · 준공 공사비 ÷ 전체 정비계획 사업비"
          onClick={onOpenList ? () => onOpenList('construction') : undefined}
          bar={
            <Track>
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${plan.costRate ?? 0}%` }} />
            </Track>
          }
          foot={
            <span className="tabular-nums">
              준공 {millionText(plan.total.doneCost)} / 전체 {millionText(plan.total.totalCost)}
            </span>
          }
        />
      </div>

      <div className="grid gap-2 xl:grid-cols-3">
        <ChartBox title="연도별 예산·배정·집행" unit="백만원">
          <Bar data={trend} options={barOptions(false, true)} />
        </ChartBox>
        <ChartBox title={`${year}년 읍면별 집행`} unit="백만원" empty={stats.byEmd.length === 0}>
          <Bar
            data={{
              labels: stats.byEmd.map((r) => r.label),
              datasets: [
                {
                  label: '집행',
                  data: stats.byEmd.map((r) => toMillionNum(r.execWon)),
                  backgroundColor: stats.byEmd.map((_, i) => COLOR.emd[i % COLOR.emd.length]!),
                  borderRadius: 4,
                  maxBarThickness: 22,
                },
              ],
            }}
            options={barOptions(true, false)}
          />
        </ChartBox>
        <ChartBox title={`${year}년 유형별 집행`} unit="백만원" empty={stats.byType.length === 0}>
          <Bar
            data={{
              labels: stats.byType.map((r) => (r.label === '마을진입로' ? '진입로' : r.label)),
              datasets: [
                {
                  label: '집행',
                  data: stats.byType.map((r) => toMillionNum(r.execWon)),
                  backgroundColor: COLOR.type,
                  borderRadius: 4,
                  maxBarThickness: 22,
                },
              ],
            }}
            options={barOptions(true, false)}
          />
        </ChartBox>
      </div>
    </div>
  )
}
