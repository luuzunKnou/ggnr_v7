'use client'

import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import type { SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'
import {
  budgetAllocWon,
  budgetExecWon,
  budgetYears,
  execRate,
  millionText,
} from './smallPublicBudgetCalc'
import { smallPublicBudgetActions, useSmallPublicBudgetStore } from './smallPublicBudgetStore'
import { FUND_SOURCE_LABEL, FUND_SOURCES, type BudgetItem, type FundSource } from './smallPublicBudgetTypes'
import { BUDGET_LIST_COLS, budgetListScrollGutterClass, budgetListTableClass, type PlanRef } from './smallPublicBudgetUi'
import {
  SmallPublicAllocModal,
  SmallPublicBudgetDetailModal,
  SmallPublicBudgetFormModal,
  SmallPublicExecModal,
} from './SmallPublicBudgetModals'

type ModalState =
  | { kind: 'detail'; budgetId: string }
  | { kind: 'form'; budget: BudgetItem | null }
  | { kind: 'alloc'; budgetId: string }
  | { kind: 'exec'; budgetId: string; allocId: string | null }

const rateText = (r: number | null) => (r == null ? '—' : `${r.toFixed(1)}%`)

/** 예산 관리 — 목록만 두고, 행을 누르면 상세·등록은 모달로 연다 */
export function SmallPublicBudgetListPanel({ overlay, planById }: { overlay: SmallPublicModalOverlay; planById: Map<string, PlanRef> }) {
  const { budgets } = useSmallPublicBudgetStore()
  const [year, setYear] = useState<number | ''>(() => new Date().getFullYear())
  const [fund, setFund] = useState<FundSource | ''>('')
  const [keyword, setKeyword] = useState('')
  const [modal, setModal] = useState<ModalState | null>(null)
  const plans = useMemo(() => [...planById.values()], [planById])

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return budgets
      .filter((b) => year === '' || b.fiscalYear === year)
      .filter((b) => !fund || b.fundSource === fund)
      .filter((b) => !q || b.title.toLowerCase().includes(q))
      .sort((a, b) => b.fiscalYear - a.fiscalYear || a.title.localeCompare(b.title, 'ko'))
  }, [budgets, year, fund, keyword])
  const total = rows.reduce(
    (a, b) => ({ amount: a.amount + b.amountWon, alloc: a.alloc + budgetAllocWon(b), exec: a.exec + budgetExecWon(b) }),
    { amount: 0, alloc: 0, exec: 0 }
  )
  const modalBudget =
    modal && 'budgetId' in modal ? (budgets.find((b) => b.id === modal.budgetId) ?? null) : modal?.kind === 'form' ? modal.budget : null
  const openId = modal && 'budgetId' in modal ? modal.budgetId : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <select
          className="standard-filter-select h-8 w-[6.5rem] max-w-none text-[12px]"
          value={year}
          onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')}
          aria-label="연도"
        >
          <option value="">전체 연도</option>
          {budgetYears(budgets).map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <select
          className="standard-filter-select h-8 w-[6.5rem] max-w-none text-[12px]"
          value={fund}
          onChange={(e) => setFund(e.target.value as FundSource | '')}
          aria-label="재원"
        >
          <option value="">전체 재원</option>
          {FUND_SOURCES.map((f) => (
            <option key={f} value={f}>
              {FUND_SOURCE_LABEL[f]}
            </option>
          ))}
        </select>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="사업명 검색"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <LayerRowPanelButton onClick={() => setModal({ kind: 'form', budget: null })}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            예산 등록
          </LayerRowPanelButton>
        </div>
      </div>
      {/* 제목·계는 스크롤 없음, 중간 행만 스크롤 */}
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          <div className={cn('shrink-0', budgetListScrollGutterClass)}>
            <table className={budgetListTableClass}>
              {BUDGET_LIST_COLS}
              <thead>
                <tr>
                  <th className="text-center">연도</th>
                  <th className="text-center">재원</th>
                  <th>사업명</th>
                  <th className="text-right">예산액</th>
                  <th className="text-right">배정액</th>
                  <th className="text-right">집행액</th>
                  <th className="text-right">잔액</th>
                  <th className="text-right">집행률</th>
                </tr>
              </thead>
            </table>
          </div>
          <div className={cn('min-h-0 flex-1 scrollbar-thin', budgetListScrollGutterClass)}>
            <table className={budgetListTableClass}>
              {BUDGET_LIST_COLS}
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="border-b-0 border-r-0 py-10 text-center text-muted-foreground">
                      조건에 맞는 예산이 없습니다.
                    </td>
                  </tr>
                ) : (
                  rows.map((b) => {
                    const exec = budgetExecWon(b)
                    const on = b.id === openId
                    return (
                      <tr
                        key={b.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setModal({ kind: 'detail', budgetId: b.id })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setModal({ kind: 'detail', budgetId: b.id })
                          }
                        }}
                        className={cn('cursor-pointer transition-colors', on ? 'bg-primary/10' : 'hover:bg-primary/5')}
                        title="상세 보기"
                      >
                        <td className="text-center tabular-nums">{b.fiscalYear}</td>
                        <td className="text-center">{FUND_SOURCE_LABEL[b.fundSource]}</td>
                        <td className={cn('truncate', on && 'text-primary')}>{b.title}</td>
                        <td className="num">{millionText(b.amountWon)}</td>
                        <td className="num">{millionText(budgetAllocWon(b))}</td>
                        <td className="num">{millionText(exec)}</td>
                        <td className="num">{millionText(b.amountWon - exec)}</td>
                        <td className="num">{rateText(execRate(exec, b.amountWon))}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {rows.length > 0 ? (
            <div className={cn('shrink-0 border-t border-border bg-slate-100 dark:bg-slate-800', budgetListScrollGutterClass)}>
              <table className={budgetListTableClass}>
                {BUDGET_LIST_COLS}
                <tbody>
                  <tr className="font-medium [&>td]:border-b-0 [&>td]:bg-transparent">
                    <td />
                    <td />
                    <td className="text-center">계 ({rows.length}건)</td>
                    <td className="num">{millionText(total.amount)}</td>
                    <td className="num">{millionText(total.alloc)}</td>
                    <td className="num">{millionText(total.exec)}</td>
                    <td className="num">{millionText(total.amount - total.exec)}</td>
                    <td className="num">{rateText(execRate(total.exec, total.amount))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>단위: 백만원</span>
        <span>잔액 = 예산액 − 집행액 · 집행률 = 집행액 ÷ 예산액</span>
      </div>

      {modal?.kind === 'detail' && modalBudget ? (
        <SmallPublicBudgetDetailModal
          key={modalBudget.id}
          {...overlay}
          budget={modalBudget}
          planById={planById}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ kind: 'form', budget: modalBudget })}
          onDelete={() => {
            const msg = modalBudget.allocs.length
              ? `«${modalBudget.title}» 예산과 배정 ${modalBudget.allocs.length}건·집행 내역을 모두 지웁니다. 삭제할까요?`
              : `«${modalBudget.title}» 예산을 삭제할까요?`
            if (!window.confirm(msg)) return
            smallPublicBudgetActions.deleteBudget(modalBudget.id)
            setModal(null)
          }}
          onAlloc={() => setModal({ kind: 'alloc', budgetId: modalBudget.id })}
          onExec={(allocId) => setModal({ kind: 'exec', budgetId: modalBudget.id, allocId })}
        />
      ) : null}
      {modal?.kind === 'form' ? (
        <SmallPublicBudgetFormModal
          {...overlay}
          initial={modal.budget}
          budgets={budgets}
          onCancel={() => setModal(modal.budget ? { kind: 'detail', budgetId: modal.budget.id } : null)}
          onSaved={(id) => setModal({ kind: 'detail', budgetId: id })}
        />
      ) : null}
      {modal?.kind === 'alloc' && modalBudget ? (
        <SmallPublicAllocModal
          {...overlay}
          budget={modalBudget}
          budgets={budgets}
          plans={plans}
          onCancel={() => setModal({ kind: 'detail', budgetId: modalBudget.id })}
          onSaved={() => setModal({ kind: 'detail', budgetId: modalBudget.id })}
        />
      ) : null}
      {modal?.kind === 'exec' && modalBudget ? (
        <SmallPublicExecModal
          {...overlay}
          budget={modalBudget}
          planById={planById}
          initialAllocId={modal.allocId}
          onCancel={() => setModal({ kind: 'detail', budgetId: modalBudget.id })}
          onSaved={() => setModal({ kind: 'detail', budgetId: modalBudget.id })}
        />
      ) : null}
    </div>
  )
}
