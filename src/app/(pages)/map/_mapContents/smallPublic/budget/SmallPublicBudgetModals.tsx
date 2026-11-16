'use client'

import { useMemo, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { smallPublicBtnDanger, smallPublicBtnGhost, smallPublicBtnPrimary } from '../smallPublicConfig'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'
import { PlanChoice } from '../plan/smallPublicPlanUi'
import { todayYmd } from '../plan/smallPublicPlanCalc'
import {
  allocExecWon,
  budgetAllocWon,
  budgetExecWon,
  budgetYears,
  execRate,
  millionText,
  wonText,
} from './smallPublicBudgetCalc'
import { newBudgetId, smallPublicBudgetActions } from './smallPublicBudgetStore'
import {
  FUND_SOURCE_LABEL,
  FUND_SOURCES,
  type BudgetItem,
  type FundSource,
} from './smallPublicBudgetTypes'
import {
  BudgetAttrTable,
  BudgetDetailSection,
  BudgetFormRow,
  BudgetFormSection,
  budgetFieldClass,
  budgetListTableClass,
  WonInput,
  yearNoText,
  type PlanRef,
} from './smallPublicBudgetUi'

function ModalError({ text }: { text: string }) {
  return text ? <span className="mr-auto text-[12px] text-destructive">{text}</span> : <span className="mr-auto" />
}

const rateText = (r: number | null) => (r == null ? '—' : `${r.toFixed(1)}%`)

/* ── 예산 등록·수정 ─────────────────────────────────── */

export function SmallPublicBudgetFormModal({
  initial,
  budgets,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  initial: BudgetItem | null
  budgets: BudgetItem[]
  onCancel: () => void
  onSaved: (id: string) => void
}) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(initial?.fiscalYear ?? thisYear)
  const [fund, setFund] = useState<FundSource>(initial?.fundSource ?? 'COUNTY')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [amount, setAmount] = useState<number | null>(initial?.amountWon ?? null)
  const [orderOrg, setOrderOrg] = useState(initial?.orderOrg ?? '경상북도 울진군')
  const [orderPeriod, setOrderPeriod] = useState(initial?.orderPeriod ?? `${thisYear}/01`)
  const [budgetCode, setBudgetCode] = useState(initial?.budgetCode ?? '')
  const [deptName, setDeptName] = useState(initial?.deptName ?? '건설과')
  const [manager, setManager] = useState(initial?.manager ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [supplyWon, setSupplyWon] = useState<number | null>(initial?.supplyWon ?? null)
  const [materialWon, setMaterialWon] = useState<number | null>(initial?.materialWon ?? null)
  const [otherWon, setOtherWon] = useState<number | null>(initial?.otherWon ?? 0)
  const [error, setError] = useState('')
  const allocated = initial ? budgetAllocWon(initial) : 0
  const years = [...new Set([...budgetYears(budgets), thisYear + 1, year])].sort((a, b) => b - a)
  const scaleSum = (supplyWon ?? 0) + (materialWon ?? 0) + (otherWon ?? 0)

  const save = () => {
    if (!title.trim()) return setError('사업명을 넣어 주세요.')
    if (!amount) return setError('예산액(발주합계)을 넣어 주세요.')
    if (amount < allocated) return setError(`이미 배정한 금액(${wonText(allocated)})보다 적게 할 수 없습니다.`)
    const id = initial?.id ?? newBudgetId('bud')
    smallPublicBudgetActions.saveBudget({
      id,
      fiscalYear: year,
      fundSource: fund,
      title: title.trim(),
      amountWon: amount,
      orderOrg: orderOrg.trim(),
      orderPeriod: orderPeriod.trim(),
      budgetCode: budgetCode.trim(),
      deptName: deptName.trim(),
      manager: manager.trim(),
      phone: phone.trim(),
      supplyWon: supplyWon ?? 0,
      materialWon: materialWon ?? 0,
      otherWon: otherWon ?? 0,
    })
    onSaved(id)
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title={initial ? '예산 수정' : '예산 등록'}
      subtitle={initial ? `${initial.fiscalYear}년 · ${FUND_SOURCE_LABEL[initial.fundSource]}` : '연도·재원·사업명·예산액을 넣고 저장하세요.'}
      onClose={onCancel}
      footer={
        <>
          <ModalError text={error} />
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            저장
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <BudgetFormSection title="기본정보">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <BudgetFormRow label="사업명" required>
                <input className={budgetFieldClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 소규모 공공시설 정비사업" />
              </BudgetFormRow>
            </div>
            <BudgetFormRow label="연도" required>
              <select className={budgetFieldClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </BudgetFormRow>
            <BudgetFormRow label="재원" required>
              <PlanChoice options={FUND_SOURCES.map((f) => ({ value: f, label: FUND_SOURCE_LABEL[f] }))} value={fund} onChange={setFund} />
            </BudgetFormRow>
            <BudgetFormRow label="발주기관">
              <input className={budgetFieldClass} value={orderOrg} onChange={(e) => setOrderOrg(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="발주시기">
              <input className={budgetFieldClass} value={orderPeriod} onChange={(e) => setOrderPeriod(e.target.value)} placeholder="YYYY/MM" />
            </BudgetFormRow>
            <BudgetFormRow label="담당부서">
              <input className={budgetFieldClass} value={deptName} onChange={(e) => setDeptName(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="담당자">
              <input className={budgetFieldClass} value={manager} onChange={(e) => setManager(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="전화번호">
              <input className={budgetFieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="예산코드">
              <input className={budgetFieldClass} value={budgetCode} onChange={(e) => setBudgetCode(e.target.value)} />
            </BudgetFormRow>
          </div>
        </BudgetFormSection>
        <BudgetFormSection title="예산규모">
          <div className="grid gap-3 sm:grid-cols-2">
            <BudgetFormRow label="도급금액">
              <WonInput value={supplyWon} onChange={setSupplyWon} />
            </BudgetFormRow>
            <BudgetFormRow label="관급자재비">
              <WonInput value={materialWon} onChange={setMaterialWon} />
            </BudgetFormRow>
            <BudgetFormRow label="기타금액">
              <WonInput value={otherWon} onChange={setOtherWon} />
            </BudgetFormRow>
            <BudgetFormRow
              label="발주합계금액"
              required
              hint={
                allocated
                  ? `이미 배정 ${wonText(allocated)} · 규모 합계 ${wonText(scaleSum)}`
                  : scaleSum
                    ? `규모 합계 ${wonText(scaleSum)} (참고)`
                    : '배정·집행은 저장 후 상세에서 합니다.'
              }
            >
              <WonInput value={amount} onChange={setAmount} />
            </BudgetFormRow>
          </div>
        </BudgetFormSection>
      </div>
    </SmallPublicModalShell>
  )
}

/* ── 예산 상세 ─────────────────────────────────────── */

export function SmallPublicBudgetDetailModal({
  budget,
  planById,
  onClose,
  onEdit,
  onDelete,
  onAlloc,
  onExec,
  ...overlay
}: SmallPublicModalOverlay & {
  budget: BudgetItem
  planById: Map<string, PlanRef>
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onAlloc: () => void
  onExec: (allocId: string | null) => void
}) {
  const alloc = budgetAllocWon(budget)
  const exec = budgetExecWon(budget)
  const execs = budget.allocs
    .flatMap((a) => a.execs.map((e) => ({ e, a })))
    .sort((x, y) => y.e.execDate.localeCompare(x.e.execDate))
  const nameOf = (unitId: string) => planById.get(unitId)?.name ?? unitId

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title={budget.title}
      subtitle={`${budget.fiscalYear}년 · ${FUND_SOURCE_LABEL[budget.fundSource]}`}
      onClose={onClose}
      showHeaderClose
      footer={
        <div className="ml-auto flex items-center gap-2.5">
          <button type="button" className={smallPublicBtnGhost} onClick={onEdit}>
            수정
          </button>
          <button type="button" className={smallPublicBtnDanger} onClick={onDelete}>
            삭제
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <BudgetDetailSection title="기본정보">
          <BudgetAttrTable
            rows={[
              { kind: 'full', label: '사업명', value: budget.title },
              {
                kind: 'pair',
                left: { label: '연도', value: `${budget.fiscalYear}년` },
                right: { label: '재원', value: FUND_SOURCE_LABEL[budget.fundSource] },
              },
              {
                kind: 'pair',
                left: { label: '발주기관', value: budget.orderOrg },
                right: { label: '발주시기', value: budget.orderPeriod },
              },
              {
                kind: 'pair',
                left: { label: '담당부서', value: budget.deptName },
                right: { label: '담당자', value: budget.manager },
              },
              {
                kind: 'pair',
                left: { label: '전화번호', value: budget.phone },
                right: { label: '예산코드', value: budget.budgetCode },
              },
            ]}
          />
        </BudgetDetailSection>

        <BudgetDetailSection title="예산규모">
          <BudgetAttrTable
            rows={[
              {
                kind: 'pair',
                left: { label: '도급금액', value: wonText(budget.supplyWon) },
                right: { label: '관급자재비', value: wonText(budget.materialWon) },
              },
              {
                kind: 'pair',
                left: { label: '기타금액', value: wonText(budget.otherWon) },
                right: { label: '발주합계금액', value: wonText(budget.amountWon) },
              },
              {
                kind: 'pair',
                left: { label: '배정액', value: wonText(alloc) },
                right: { label: '배정 가능', value: wonText(budget.amountWon - alloc) },
              },
              {
                kind: 'pair',
                left: { label: '집행액', value: wonText(exec) },
                right: { label: '잔액', value: wonText(budget.amountWon - exec) },
              },
              {
                kind: 'pair',
                left: { label: '집행률', value: rateText(execRate(exec, budget.amountWon)) },
                right: { label: '단위', value: '원 · 집행률 %' },
              },
            ]}
          />
        </BudgetDetailSection>

        <BudgetDetailSection
          title={`배정 (${budget.allocs.length}곳)`}
          actions={
            <button type="button" className={smallPublicBtnGhost} onClick={onAlloc} disabled={alloc >= budget.amountWon}>
              <Plus className="h-3 w-3" aria-hidden />
              배정 추가
            </button>
          }
        >
          <div className="space-y-1.5 p-3">
            {budget.allocs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border py-6 text-center text-[12px] text-muted-foreground">
                «배정 추가»로 정비계획 시설에 예산을 나눠 주세요.
              </p>
            ) : (
              <table className={budgetListTableClass}>
                <thead>
                  <tr>
                    <th>시설명</th>
                    <th>연차</th>
                    <th className="text-right">배정액</th>
                    <th className="text-right">집행액</th>
                    <th className="w-[5.5rem]" />
                  </tr>
                </thead>
                <tbody>
                  {budget.allocs.map((a) => {
                    const done = allocExecWon(a)
                    return (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap">{nameOf(a.planUnitId)}</td>
                        <td className="whitespace-nowrap text-muted-foreground">{yearNoText(a.yearNo)}</td>
                        <td className="num">{millionText(a.amountWon)}</td>
                        <td className="num">{millionText(done)}</td>
                        <td className="whitespace-nowrap text-right">
                          <button
                            type="button"
                            className="rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-40"
                            disabled={done >= a.amountWon}
                            onClick={() => onExec(a.id)}
                          >
                            집행
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                            title={a.execs.length ? '집행 내역이 있는 배정은 지울 수 없습니다.' : '배정 삭제'}
                            aria-label="배정 삭제"
                            disabled={a.execs.length > 0}
                            onClick={() => {
                              if (window.confirm(`«${nameOf(a.planUnitId)}» 배정을 지울까요?`)) smallPublicBudgetActions.deleteAlloc(budget.id, a.id)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <p className="text-[11px] text-muted-foreground">단위: 백만원 · 연차는 정비계획 값</p>
          </div>
        </BudgetDetailSection>

        <BudgetDetailSection
          title={`집행 내역 (${execs.length}건)`}
          actions={
            <button type="button" className={smallPublicBtnGhost} onClick={() => onExec(null)} disabled={budget.allocs.length === 0}>
              <Plus className="h-3 w-3" aria-hidden />
              집행 등록
            </button>
          }
        >
          <div className="p-3">
            {execs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border py-6 text-center text-[12px] text-muted-foreground">
                {budget.allocs.length ? '집행 내역이 없습니다.' : '배정을 먼저 추가하세요.'}
              </p>
            ) : (
              <table className={budgetListTableClass}>
                <thead>
                  <tr>
                    <th>집행일</th>
                    <th>시설명</th>
                    <th className="text-right">집행액(원)</th>
                    <th>적요</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {execs.map(({ e, a }) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap tabular-nums">{e.execDate}</td>
                      <td className="whitespace-nowrap">{nameOf(a.planUnitId)}</td>
                      <td className="num">{e.amountWon.toLocaleString('ko-KR')}</td>
                      <td>{e.memo || '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="rounded p-1 text-destructive hover:bg-destructive/10"
                          title="집행 삭제"
                          aria-label="집행 삭제"
                          onClick={() => {
                            if (window.confirm(`${e.execDate} 집행 ${wonText(e.amountWon)}을 지울까요?`))
                              smallPublicBudgetActions.deleteExec(budget.id, a.id, e.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </BudgetDetailSection>
      </div>
    </SmallPublicModalShell>
  )
}

/* ── 배정 추가 ─────────────────────────────────────── */

export function SmallPublicAllocModal({
  budget,
  budgets,
  plans,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  budget: BudgetItem
  budgets: BudgetItem[]
  plans: PlanRef[]
  onCancel: () => void
  onSaved: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const remain = budget.amountWon - budgetAllocWon(budget)

  const allocatedByUnit = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of budgets) for (const a of b.allocs) m.set(a.planUnitId, (m.get(a.planUnitId) ?? 0) + a.amountWon)
    return m
  }, [budgets])
  const inBudget = useMemo(() => new Set(budget.allocs.map((a) => a.planUnitId)), [budget])

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return plans
      .filter((p) => p.canLinkBudget && !inBudget.has(p.id))
      .filter((p) => !q || [p.name, p.emd, p.ri, p.type].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 200)
  }, [plans, inBudget, keyword])

  const pick = (p: PlanRef) => {
    setPickedId(p.id)
    const need = Math.max(0, p.costWon - (allocatedByUnit.get(p.id) ?? 0))
    setAmount(Math.min(need, Math.max(0, remain)) || null)
    setError('')
  }
  const picked = plans.find((p) => p.id === pickedId) ?? null

  const save = () => {
    if (!picked) return setError('배정할 시설을 고르세요.')
    if (!amount) return setError('배정액을 넣어 주세요.')
    if (amount > remain) return setError(`배정 가능한 금액(${wonText(remain)})을 넘습니다.`)
    smallPublicBudgetActions.saveAlloc(budget.id, {
      id: newBudgetId('al'),
      planUnitId: picked.id,
      yearNo: picked.yearNo ?? null,
      amountWon: amount,
    })
    onSaved()
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title="배정 추가"
      subtitle={`${budget.fiscalYear}년 ${FUND_SOURCE_LABEL[budget.fundSource]} «${budget.title}» — 배정 가능 ${wonText(remain)}`}
      onClose={onCancel}
      bodyClassName="flex min-h-0 flex-1 flex-col"
      footer={
        <>
          <ModalError text={error} />
          <span className="text-[13px] text-foreground/80">배정액</span>
          <WonInput className="w-48" value={amount} onChange={setAmount} />
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            배정
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </>
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="시설명·읍면·리명·유형 검색"
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
        <span className="text-[12px] text-muted-foreground">정비계획 추정·확정 시설 · 우선순위 순</span>
      </div>
      <div className="max-h-[380px] min-h-[160px] overflow-auto scrollbar-thin">
        <table className={budgetListTableClass}>
          <thead>
            <tr>
              <th className="w-10" />
              <th className="w-14 text-center">순위</th>
              <th>시설명</th>
              <th>위치</th>
              <th>연차</th>
              <th className="text-right">계획 사업비</th>
              <th className="text-right">이미 배정</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  배정할 시설이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const on = p.id === pickedId
                return (
                  <tr
                    key={p.id}
                    role="radio"
                    aria-checked={on}
                    tabIndex={0}
                    onClick={() => pick(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        pick(p)
                      }
                    }}
                    className={cn('cursor-pointer', on ? 'bg-primary/10' : 'hover:bg-muted/50')}
                  >
                    <td>
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border',
                          on ? 'border-primary' : 'border-muted-foreground/40'
                        )}
                      >
                        {on ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                      </span>
                    </td>
                    <td className="text-center tabular-nums">{p.rank}</td>
                    <td className={cn('whitespace-nowrap', on && 'text-primary')}>{p.name}</td>
                    <td className="whitespace-nowrap text-muted-foreground">{[p.emd, p.ri].filter(Boolean).join(' ')}</td>
                    <td className="whitespace-nowrap">{yearNoText(p.yearNo)}</td>
                    <td className="num">{millionText(p.costWon)}백만원</td>
                    <td className="num text-muted-foreground">
                      {allocatedByUnit.get(p.id) ? `${millionText(allocatedByUnit.get(p.id)!)}백만원` : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </SmallPublicModalShell>
  )
}

/* ── 집행 등록 ─────────────────────────────────────── */

export function SmallPublicExecModal({
  budget,
  planById,
  initialAllocId,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  budget: BudgetItem
  planById: Map<string, PlanRef>
  initialAllocId: string | null
  onCancel: () => void
  onSaved: () => void
}) {
  const [allocId, setAllocId] = useState(
    initialAllocId ?? budget.allocs.find((a) => allocExecWon(a) < a.amountWon)?.id ?? budget.allocs[0]?.id ?? ''
  )
  const [date, setDate] = useState(todayYmd)
  const [amount, setAmount] = useState<number | null>(null)
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const alloc = budget.allocs.find((a) => a.id === allocId) ?? null
  const remain = alloc ? alloc.amountWon - allocExecWon(alloc) : 0

  const save = () => {
    if (!alloc) return setError('배정 시설을 고르세요.')
    if (!date) return setError('집행일을 넣어 주세요.')
    if (!amount) return setError('집행액을 넣어 주세요.')
    if (amount > remain) return setError(`배정 잔액(${wonText(remain)})을 넘습니다.`)
    smallPublicBudgetActions.addExecs([
      { budgetId: budget.id, allocId: alloc.id, exec: { id: newBudgetId('ex'), execDate: date, amountWon: amount, memo: memo.trim() } },
    ])
    onSaved()
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title="집행 등록"
      subtitle={`${budget.fiscalYear}년 «${budget.title}»`}
      onClose={onCancel}
      footer={
        <>
          <ModalError text={error} />
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            저장
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <BudgetFormSection title="집행 정보">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <BudgetFormRow label="배정 시설" required hint={alloc ? `배정 ${wonText(alloc.amountWon)} · 잔액 ${wonText(remain)}` : undefined}>
                <select className={budgetFieldClass} value={allocId} onChange={(e) => setAllocId(e.target.value)}>
                  {budget.allocs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {planById.get(a.planUnitId)?.name ?? a.planUnitId}
                    </option>
                  ))}
                </select>
              </BudgetFormRow>
            </div>
            <BudgetFormRow label="집행일" required>
              <input type="date" className={budgetFieldClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="집행액" required>
              <WonInput value={amount} onChange={setAmount} />
            </BudgetFormRow>
            <div className="sm:col-span-2">
              <BudgetFormRow label="적요">
                <input className={budgetFieldClass} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 선금, 기성금, 준공금" />
              </BudgetFormRow>
            </div>
          </div>
        </BudgetFormSection>
      </div>
    </SmallPublicModalShell>
  )
}
