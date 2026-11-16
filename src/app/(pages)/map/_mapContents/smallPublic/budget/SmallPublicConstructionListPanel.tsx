'use client'

import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import type { SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'
import { constructionYear, millionText } from './smallPublicBudgetCalc'
import { smallPublicBudgetActions, useSmallPublicBudgetStore } from './smallPublicBudgetStore'
import {
  CONSTRUCTION_STATUS_LABEL,
  CONSTRUCTION_STATUSES,
  FUND_SOURCE_LABEL,
  type Construction,
  type ConstructionStatus,
} from './smallPublicBudgetTypes'
import {
  CONSTRUCTION_LIST_COLS,
  budgetListScrollGutterClass,
  budgetListTableClass,
  ConstructionStatusBadge,
  type PlanRef,
} from './smallPublicBudgetUi'
import {
  SmallPublicConstructionCompleteModal,
  SmallPublicConstructionDetailModal,
  SmallPublicConstructionFormModal,
} from './SmallPublicConstructionModals'

type ModalState =
  | { kind: 'detail'; constructionId: string }
  | { kind: 'form'; construction: Construction | null }
  | { kind: 'complete'; constructionId: string }

const periodText = (c: Construction) => (c.startDate || c.endDate ? `${c.startDate || '—'} ~ ${c.endDate || '—'}` : '—')

/** 공사대장 — 목록만 두고, 행을 누르면 상세·등록은 모달로 연다 */
export function SmallPublicConstructionListPanel({
  overlay,
  planById,
}: {
  overlay: SmallPublicModalOverlay
  planById: Map<string, PlanRef>
}) {
  const { budgets, constructions } = useSmallPublicBudgetStore()
  const [year, setYear] = useState<number | ''>('')
  const [status, setStatus] = useState<ConstructionStatus | ''>('')
  const [keyword, setKeyword] = useState('')
  const [modal, setModal] = useState<ModalState | null>(null)

  const years = useMemo(
    () =>
      [...new Set(constructions.map((c) => constructionYear(c, budgets)).filter((y): y is number => y != null))].sort((a, b) => b - a),
    [constructions, budgets]
  )
  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return constructions
      .filter((c) => year === '' || constructionYear(c, budgets) === year)
      .filter((c) => !status || c.status === status)
      .filter(
        (c) =>
          !q ||
          [c.name, c.contractor, ...c.facilities.map((f) => planById.get(f.planUnitId)?.name ?? '')].join(' ').toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          (constructionYear(b, budgets) ?? 0) - (constructionYear(a, budgets) ?? 0) ||
          CONSTRUCTION_STATUSES.indexOf(a.status) - CONSTRUCTION_STATUSES.indexOf(b.status) ||
          a.name.localeCompare(b.name, 'ko')
      )
  }, [constructions, budgets, year, status, keyword, planById])

  const modalConstruction =
    modal && 'constructionId' in modal
      ? (constructions.find((c) => c.id === modal.constructionId) ?? null)
      : modal?.kind === 'form'
        ? modal.construction
        : null
  const openId = modal && 'constructionId' in modal ? modal.constructionId : null
  const contractTotal = rows.reduce((n, c) => n + (c.totalContractWon ?? c.contractWon ?? 0), 0)
  const facilityTotal = rows.reduce((n, c) => n + c.facilities.length, 0)

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
          {years.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <select
          className="standard-filter-select h-8 w-[6.5rem] max-w-none text-[12px]"
          value={status}
          onChange={(e) => setStatus(e.target.value as ConstructionStatus | '')}
          aria-label="상태"
        >
          <option value="">전체 상태</option>
          {CONSTRUCTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONSTRUCTION_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="relative w-60">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="공사명·업체·시설명 검색"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <LayerRowPanelButton onClick={() => setModal({ kind: 'form', construction: null })}>
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            공사 등록
          </LayerRowPanelButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          <div className={cn('shrink-0', budgetListScrollGutterClass)}>
            <table className={budgetListTableClass}>
              {CONSTRUCTION_LIST_COLS}
              <thead>
                <tr>
                  <th>공사명</th>
                  <th className="text-center">상태</th>
                  <th>시공업체</th>
                  <th className="text-right">계약금액</th>
                  <th>공사기간</th>
                  <th className="text-center">대상 시설</th>
                  <th>준공일</th>
                  <th>예산</th>
                </tr>
              </thead>
            </table>
          </div>
          <div className={cn('min-h-0 flex-1 scrollbar-thin', budgetListScrollGutterClass)}>
            <table className={budgetListTableClass}>
              {CONSTRUCTION_LIST_COLS}
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="border-b-0 border-r-0 py-10 text-center text-muted-foreground">
                      조건에 맞는 공사가 없습니다.
                    </td>
                  </tr>
                ) : (
                  rows.map((c) => {
                    const on = c.id === openId
                    const b = budgets.find((x) => x.id === c.budgetId)
                    return (
                      <tr
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setModal({ kind: 'detail', constructionId: c.id })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setModal({ kind: 'detail', constructionId: c.id })
                          }
                        }}
                        className={cn('cursor-pointer transition-colors', on ? 'bg-primary/10' : 'hover:bg-primary/5')}
                        title="상세 보기"
                      >
                        <td className={cn('truncate', on && 'text-primary')}>{c.name}</td>
                        <td className="text-center">
                          <ConstructionStatusBadge status={c.status} />
                        </td>
                        <td className="truncate">{c.contractor || '—'}</td>
                        <td className="num">{c.contractWon ? millionText(c.contractWon) : '—'}</td>
                        <td className="truncate tabular-nums text-muted-foreground">{periodText(c)}</td>
                        <td className="text-center tabular-nums">{c.facilities.length}곳</td>
                        <td className="tabular-nums">{c.completedOn || '—'}</td>
                        <td className="truncate text-muted-foreground">
                          {b ? `${b.fiscalYear} ${FUND_SOURCE_LABEL[b.fundSource]}` : '—'}
                        </td>
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
                {CONSTRUCTION_LIST_COLS}
                <tbody>
                  <tr className="font-medium [&>td]:border-b-0 [&>td]:bg-transparent">
                    <td className="text-center">계 ({rows.length}건)</td>
                    <td />
                    <td />
                    <td className="num">{millionText(contractTotal)}</td>
                    <td />
                    <td className="text-center tabular-nums">{facilityTotal}곳</td>
                    <td />
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>계약금액 단위: 백만원</span>
      </div>

      {modal?.kind === 'detail' && modalConstruction ? (
        <SmallPublicConstructionDetailModal
          key={modalConstruction.id}
          {...overlay}
          construction={modalConstruction}
          budgets={budgets}
          planById={planById}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ kind: 'form', construction: modalConstruction })}
          onComplete={() => setModal({ kind: 'complete', constructionId: modalConstruction.id })}
          onDelete={() => {
            if (!window.confirm(`«${modalConstruction.name}» 공사를 삭제할까요?`)) return
            smallPublicBudgetActions.deleteConstruction(modalConstruction.id)
            setModal(null)
          }}
        />
      ) : null}
      {modal?.kind === 'form' ? (
        <SmallPublicConstructionFormModal
          {...overlay}
          initial={modal.construction}
          budgets={budgets}
          planById={planById}
          onCancel={() => setModal(modal.construction ? { kind: 'detail', constructionId: modal.construction.id } : null)}
          onSaved={(id) => setModal({ kind: 'detail', constructionId: id })}
        />
      ) : null}
      {modal?.kind === 'complete' && modalConstruction ? (
        <SmallPublicConstructionCompleteModal
          {...overlay}
          construction={modalConstruction}
          planById={planById}
          onCancel={() => setModal({ kind: 'detail', constructionId: modalConstruction.id })}
          onSaved={() => setModal({ kind: 'detail', constructionId: modalConstruction.id })}
        />
      ) : null}
    </div>
  )
}
