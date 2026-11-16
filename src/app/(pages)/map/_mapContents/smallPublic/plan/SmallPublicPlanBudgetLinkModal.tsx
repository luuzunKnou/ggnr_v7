'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { smallPublicBtnGhost, smallPublicBtnPrimary } from '../smallPublicConfig'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'
import { budgetAllocWon, millionText, wonText } from '../budget/smallPublicBudgetCalc'
import { newBudgetId, smallPublicBudgetActions, useSmallPublicBudgetStore } from '../budget/smallPublicBudgetStore'
import { FUND_SOURCE_LABEL, FUND_SOURCES, type BudgetItem, type FundSource } from '../budget/smallPublicBudgetTypes'
import { WonInput, budgetFieldClass } from '../budget/smallPublicBudgetUi'
import { PlanChoice } from './smallPublicPlanUi'
import type { PlanRanked } from './smallPublicPlanCalc'

export type PlanBudgetLinkRow = {
  ranked: PlanRanked
  /** 기본 배정액(원) — 계획 사업비 */
  defaultAmountWon: number
}

type TargetMode = 'existing' | 'new'

/**
 * 정비계획에서 고른 확정 시설을 기존·신규 예산에 배정한다.
 * 기존 예산에 이미 있는 시설은 건너뛴다.
 */
export function SmallPublicPlanBudgetLinkModal({
  rows,
  onCancel,
  onDone,
  ...overlay
}: SmallPublicModalOverlay & {
  rows: PlanBudgetLinkRow[]
  onCancel: () => void
  onDone: (budget: BudgetItem, linkedCount: number) => void
}) {
  const { budgets } = useSmallPublicBudgetStore()
  const thisYear = new Date().getFullYear()
  const defaultSum = useMemo(() => rows.reduce((n, r) => n + r.defaultAmountWon, 0), [rows])

  const years = useMemo(() => {
    const set = new Set(budgets.map((b) => b.fiscalYear))
    set.add(thisYear)
    set.add(thisYear + 1)
    return [...set].sort((a, b) => b - a)
  }, [budgets, thisYear])

  const [mode, setMode] = useState<TargetMode>('existing')
  const [year, setYear] = useState(() => years[0] ?? thisYear)
  const yearBudgets = useMemo(
    () => budgets.filter((b) => b.fiscalYear === year).sort((a, b) => a.title.localeCompare(b.title, 'ko')),
    [budgets, year]
  )
  const [budgetId, setBudgetId] = useState(() => yearBudgets[0]?.id ?? '')
  const existing = budgets.find((b) => b.id === budgetId) ?? null

  const [newFund, setNewFund] = useState<FundSource>('COUNTY')
  const [newTitle, setNewTitle] = useState('소규모 공공시설 정비사업')
  const [newAmount, setNewAmount] = useState<number | null>(defaultSum > 0 ? defaultSum : null)

  const [amounts, setAmounts] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(rows.map((r) => [r.ranked.unit.id, r.defaultAmountWon]))
  )
  const [error, setError] = useState('')

  const inBudget = useMemo(
    () => (mode === 'existing' && existing ? new Set(existing.allocs.map((a) => a.planUnitId)) : new Set<string>()),
    [mode, existing]
  )
  const linkable = rows.filter((r) => !inBudget.has(r.ranked.unit.id))
  const sum = linkable.reduce((n, r) => n + (amounts[r.ranked.unit.id] ?? 0), 0)
  const remain =
    mode === 'existing' ? (existing ? existing.amountWon - budgetAllocWon(existing) : 0) : (newAmount ?? 0)
  const canSave = mode === 'existing' ? !!existing && linkable.length > 0 : linkable.length > 0

  const onYearChange = (y: number) => {
    setYear(y)
    const list = budgets.filter((b) => b.fiscalYear === y)
    setBudgetId(list[0]?.id ?? '')
    setError('')
  }

  const setTargetMode = (next: TargetMode) => {
    setMode(next)
    setError('')
    if (next === 'new' && (newAmount == null || newAmount <= 0) && defaultSum > 0) {
      setNewAmount(defaultSum)
    }
  }

  const save = () => {
    if (linkable.length === 0) return setError('새로 배정할 시설이 없습니다. (이미 배정됐거나 선택이 비었습니다)')
    for (const r of linkable) {
      const won = amounts[r.ranked.unit.id]
      if (!won || won <= 0) return setError(`«${r.ranked.unit.unitName}» 배정액을 넣어 주세요.`)
    }

    let budgetIdToUse: string
    let doneBudget: BudgetItem

    if (mode === 'existing') {
      if (!existing) return setError('예산을 고르세요.')
      if (sum > remain) return setError(`배정 합계(${wonText(sum)})가 배정 가능액(${wonText(remain)})을 넘습니다.`)
      budgetIdToUse = existing.id
      doneBudget = existing
    } else {
      if (!newTitle.trim()) return setError('신규 예산 사업명을 넣어 주세요.')
      if (!newAmount || newAmount <= 0) return setError('신규 예산액을 넣어 주세요.')
      if (sum > newAmount) return setError(`배정 합계(${wonText(sum)})가 신규 예산액(${wonText(newAmount)})을 넘습니다.`)
      const id = newBudgetId('bud')
      const draft = {
        id,
        fiscalYear: year,
        fundSource: newFund,
        title: newTitle.trim(),
        amountWon: newAmount,
        orderOrg: '경상북도 울진군',
        orderPeriod: `${year}/01`,
        budgetCode: '',
        deptName: '건설과',
        manager: '',
        phone: '',
        supplyWon: newAmount,
        materialWon: 0,
        otherWon: 0,
      }
      smallPublicBudgetActions.saveBudget(draft)
      budgetIdToUse = id
      doneBudget = { ...draft, allocs: [] }
    }

    for (const r of linkable) {
      smallPublicBudgetActions.saveAlloc(budgetIdToUse, {
        id: newBudgetId('al'),
        planUnitId: r.ranked.unit.id,
        yearNo: r.ranked.yearNo ?? null,
        amountWon: amounts[r.ranked.unit.id]!,
      })
    }
    onDone(doneBudget, linkable.length)
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title="예산 계획"
      subtitle="고른 정비계획 시설을 기존 예산에 넣거나, 신규 예산을 만들어 배정합니다."
      showHeaderClose
      onClose={onCancel}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      footer={
        <>
          {error ? (
            <span className="mr-auto text-[12px] text-destructive">{error}</span>
          ) : (
            <span className="mr-auto text-[12px] text-muted-foreground">
              {canSave
                ? `배정 가능 ${wonText(remain)} · 이번 합계 ${wonText(sum)} · ${linkable.length}곳`
                : mode === 'existing'
                  ? '예산을 고르세요.'
                  : '신규 예산 정보를 넣어 주세요.'}
            </span>
          )}
          <button type="button" className={smallPublicBtnPrimary} onClick={save} disabled={!canSave}>
            {mode === 'new' ? '신규 등록·배정' : '배정'}
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </>
      }
    >
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-2.5">
        <div className="inline-flex w-fit rounded-md border border-border p-0.5">
          {(
            [
              { key: 'existing', label: '기존 예산' },
              { key: 'new', label: '신규 예산' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTargetMode(t.key)}
              className={cn(
                'rounded px-3 py-1.5 text-[12px] font-medium transition-colors',
                mode === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === 'existing' ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 w-[7rem] max-w-none cursor-pointer rounded-md border border-border bg-background px-2 text-[13px] outline-none"
              value={year}
              onChange={(e) => onYearChange(Number(e.target.value))}
              aria-label="예산 연도"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select
              className="h-9 min-w-[14rem] flex-1 max-w-none cursor-pointer rounded-md border border-border bg-background px-2 text-[13px] outline-none"
              value={budgetId}
              onChange={(e) => {
                setBudgetId(e.target.value)
                setError('')
              }}
              aria-label="예산"
            >
              {yearBudgets.length === 0 ? (
                <option value="">이 연도 예산 없음 — 신규 예산으로 등록하세요</option>
              ) : (
                yearBudgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {FUND_SOURCE_LABEL[b.fundSource]} · {b.title} ({millionText(b.amountWon)}백만원)
                  </option>
                ))
              )}
            </select>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              연도
              <select
                className={cn(budgetFieldClass, 'h-9')}
                value={year}
                onChange={(e) => {
                  setYear(Number(e.target.value))
                  setError('')
                }}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              재원
              <div className="pt-0.5">
                <PlanChoice options={FUND_SOURCES.map((f) => ({ value: f, label: FUND_SOURCE_LABEL[f] }))} value={newFund} onChange={setNewFund} />
              </div>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground sm:col-span-2">
              사업명
              <input
                className={cn(budgetFieldClass, 'h-9')}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="예: 소규모 공공시설 정비사업"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground sm:col-span-2">
              예산액
              <WonInput value={newAmount} onChange={setNewAmount} className="w-full max-w-xs" />
            </label>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 scrollbar-thin">
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full table-fixed border-collapse text-left text-[12px]">
            <colgroup>
              <col />
              <col className="w-[7rem]" />
              <col className="w-[5rem]" />
              <col className="w-[7rem]" />
              <col className="w-[11rem]" />
              <col className="w-[5rem]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted">
              <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium [&>th]:text-muted-foreground">
                <th>시설명</th>
                <th>위치</th>
                <th className="text-center">순위</th>
                <th className="text-right">계획 사업비</th>
                <th className="text-right">배정액</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = r.ranked.unit.id
                const locked = inBudget.has(id)
                return (
                  <tr
                    key={id}
                    className={cn(
                      'border-b border-border last:border-b-0 [&>td]:px-2 [&>td]:py-1.5',
                      !locked && 'hover:bg-muted/40'
                    )}
                  >
                    <td className="truncate font-medium" title={r.ranked.unit.unitName}>
                      {r.ranked.unit.unitName}
                    </td>
                    <td className="truncate text-muted-foreground">
                      {[r.ranked.unit.emd, r.ranked.unit.ri].filter(Boolean).join(' ')}
                    </td>
                    <td className="text-center tabular-nums">{r.ranked.finalRank}</td>
                    <td className="text-right tabular-nums text-muted-foreground">{millionText(r.defaultAmountWon)}</td>
                    <td className="text-right">
                      {locked ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <WonInput
                          className="ml-auto w-full"
                          value={amounts[id] ?? null}
                          onChange={(v) => setAmounts((prev) => ({ ...prev, [id]: v }))}
                        />
                      )}
                    </td>
                    <td className="text-[11px] text-muted-foreground">{locked ? '이미 배정' : '배정 가능'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </SmallPublicModalShell>
  )
}
