'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { planWorkloadM, type PlanRanked } from '../plan/smallPublicPlanCalc'
import { canLinkToBudget, isPlanInAnalysis } from '../plan/smallPublicPlanTypes'
import { CONSTRUCTION_STATUS_LABEL, type ConstructionStatus } from './smallPublicBudgetTypes'

/** 예산·공사 화면에서 쓰는 정비계획 시설 요약 */
export type PlanRef = {
  id: string
  name: string
  type: string
  emd: string
  ri: string
  rank: number
  /** 1~5차년, null = 5개년 이후, undefined = 분석 중(검토 후 배분) */
  yearNo: number | null | undefined
  qty: number
  costWon: number
  inAnalysis: boolean
  /** 입력 완료 추정·확정 true, 미완료 추정·검토 false */
  canLinkBudget: boolean
}

export function toPlanRefs(ranked: PlanRanked[]): Map<string, PlanRef> {
  return new Map(
    ranked.map((r) => [
      r.unit.id,
      {
        id: r.unit.id,
        name: r.unit.unitName,
        type: r.unit.type,
        emd: r.unit.emd,
        ri: r.unit.ri,
        rank: r.finalRank,
        yearNo: r.yearNo,
        qty: planWorkloadM(r.version),
        costWon: r.summary.cost.total,
        inAnalysis: isPlanInAnalysis(r.version),
        canLinkBudget: canLinkToBudget(r),
      },
    ])
  )
}

const STATUS_BADGE: Record<ConstructionStatus, string> = {
  PLANNED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  ONGOING: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  DONE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  CANCELED: 'bg-muted text-muted-foreground line-through',
}

export function ConstructionStatusBadge({ status }: { status: ConstructionStatus }) {
  return (
    <span className={cn('inline-flex shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', STATUS_BADGE[status])}>
      {CONSTRUCTION_STATUS_LABEL[status]}
    </span>
  )
}

/** 금액(원) 입력 — 천 단위 쉼표, 빈칸 = null */
export function WonInput({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  className?: string
  placeholder?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <input
        type="text"
        inputMode="numeric"
        className={cn(budgetFieldClass, 'pr-7 text-right tabular-nums')}
        value={value == null ? '' : value.toLocaleString('ko-KR')}
        placeholder={placeholder}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, '')
          onChange(digits ? Number(digits) : null)
        }}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">원</span>
    </div>
  )
}

/** 입력 줄 — 위 이름, 아래 입력(등록 모달용) */
export function BudgetFormRow({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-medium text-foreground/80">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/** 등록·상세 모달 안 구획 카드 */
export function BudgetFormSection({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      {title || actions ? (
        <div className="mb-3 flex items-center gap-2">
          {title ? <h4 className="text-[13px] font-semibold">{title}</h4> : null}
          {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export const budgetFieldClass =
  'h-9 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20'

/** 목록 표 — 12px. 세로칸 구분·금액은 오른쪽 붙임. table-fixed로 머리·본문·계 열 맞춤 */
export const budgetListTableClass =
  'w-full table-fixed border-separate border-spacing-0 text-left text-[12px] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-2 [&_th]:font-semibold [&_th]:text-foreground/80 [&_th:last-child]:border-r-0 [&_th.text-right]:pr-1.5 [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:px-2 [&_td]:py-2 [&_td:last-child]:border-r-0 [&_td.num]:pr-1.5 [&_td.num]:text-right [&_td.num]:tabular-nums'

/** 예산 목록 열 — 머리·본문·계 동일 */
export const BUDGET_LIST_COLS = (
  <colgroup>
    <col className="w-[8%]" />
    <col className="w-[8%]" />
    <col className="w-[28%]" />
    <col className="w-[12%]" />
    <col className="w-[12%]" />
    <col className="w-[12%]" />
    <col className="w-[12%]" />
    <col className="w-[8%]" />
  </colgroup>
)

/** 공사 목록 열 — 머리·본문·계 동일 */
export const CONSTRUCTION_LIST_COLS = (
  <colgroup>
    <col className="w-[22%]" />
    <col className="w-[8%]" />
    <col className="w-[12%]" />
    <col className="w-[12%]" />
    <col className="w-[16%]" />
    <col className="w-[8%]" />
    <col className="w-[10%]" />
    <col className="w-[12%]" />
  </colgroup>
)

/**
 * 머리·계는 overflow-y-auto + gutter만 두고(스크롤 생기지 않음),
 * 본문은 overflow-y-auto로 행이 많을 때만 스크롤. 열 너비를 맞춘다.
 */
export const budgetListScrollGutterClass = 'overflow-y-auto [scrollbar-gutter:stable]'

/** 상세 모달 구획 — 발주계획·계약 기본정보처럼 제목+속성표 */
export function BudgetDetailSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>
        {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
      </div>
      <div className="p-0">{children}</div>
    </section>
  )
}

export type BudgetAttrCell = { label: string; value: ReactNode }
/** pair = 한 줄에 좌·우 두 칸, full = 라벨+값 전체 너비(소재지·계약사유 등) */
export type BudgetAttrRow =
  | { kind: 'pair'; left: BudgetAttrCell; right?: BudgetAttrCell }
  | { kind: 'full'; label: string; value: ReactNode }

const thClass =
  'w-[7.5rem] shrink-0 border border-border bg-slate-100 px-2.5 py-2 text-left align-middle text-[12px] font-medium text-muted-foreground dark:bg-slate-900/50'
const tdClass = 'min-w-0 border border-border bg-background px-2.5 py-2 align-middle text-[12px] break-keep [overflow-wrap:anywhere]'

/** 계약·발주계획 기본정보형 속성표 */
export function BudgetAttrTable({ rows }: { rows: BudgetAttrRow[] }) {
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col className="w-[7.5rem]" />
        <col />
        <col className="w-[7.5rem]" />
        <col />
      </colgroup>
      <tbody>
        {rows.map((r, i) =>
          r.kind === 'full' ? (
            <tr key={`f-${r.label}-${i}`}>
              <th className={thClass}>{r.label}</th>
              <td className={tdClass} colSpan={3}>
                {r.value || '—'}
              </td>
            </tr>
          ) : (
            <tr key={`p-${r.left.label}-${i}`}>
              <th className={thClass}>{r.left.label}</th>
              <td className={cn(tdClass, 'tabular-nums')}>{r.left.value || '—'}</td>
              <th className={thClass}>{r.right?.label ?? ''}</th>
              <td className={cn(tdClass, 'tabular-nums')}>{r.right ? r.right.value || '—' : ''}</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  )
}

/** 단순 라벨·값 목록 → 두 칸씩 묶어 속성표로 (짧은 목록용) */
export function BudgetAttrGrid({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  const paired: BudgetAttrRow[] = []
  for (let i = 0; i < rows.length; i += 2) {
    const left = rows[i]!
    const right = rows[i + 1]
    paired.push({
      kind: 'pair',
      left: { label: left.label, value: left.value },
      right: right ? { label: right.label, value: right.value } : undefined,
    })
  }
  return <BudgetAttrTable rows={paired} />
}

export function yearNoText(yearNo: number | null | undefined): string {
  if (yearNo === undefined) return '분석 중'
  if (yearNo == null) return '5개년 이후'
  return `${yearNo}차년`
}
