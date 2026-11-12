'use client'

import { useMemo, useState } from 'react'
import { Search, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { smallPublicBtnDanger, smallPublicBtnGhost, smallPublicBtnPrimary } from '../smallPublicConfig'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'
import { SmallPublicFileRow, useSmallPublicFilePreview } from '../smallPublicUi'
import { PlanChoice, PlanNumInput } from '../plan/smallPublicPlanUi'
import { todayYmd } from '../plan/smallPublicPlanCalc'
import { millionText, wonText } from './smallPublicBudgetCalc'
import { newBudgetId, smallPublicBudgetActions } from './smallPublicBudgetStore'
import {
  CONSTRUCTION_FILE_KINDS,
  CONSTRUCTION_FILE_LABEL,
  CONSTRUCTION_STATUS_LABEL,
  FUND_SOURCE_LABEL,
  type BudgetItem,
  type Construction,
  type ConstructionFacility,
  type ConstructionFileKind,
  type ConstructionStatus,
} from './smallPublicBudgetTypes'
import {
  BudgetAttrTable,
  BudgetDetailSection,
  BudgetFormRow,
  BudgetFormSection,
  budgetFieldClass,
  budgetListTableClass,
  WonInput,
  type PlanRef,
} from './smallPublicBudgetUi'

function ModalError({ text }: { text: string }) {
  return text ? <span className="mr-auto text-[12px] text-destructive">{text}</span> : <span className="mr-auto" />
}

const EDITABLE_STATUSES: ConstructionStatus[] = ['PLANNED', 'ONGOING', 'CANCELED']
const periodText = (c: Construction) => (c.startDate || c.endDate ? `${c.startDate || '—'} ~ ${c.endDate || '—'}` : '—')

/* ── 공사 등록·수정 ─────────────────────────────────── */

export function SmallPublicConstructionFormModal({
  initial,
  budgets,
  planById,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  initial: Construction | null
  budgets: BudgetItem[]
  planById: Map<string, PlanRef>
  onCancel: () => void
  onSaved: (id: string) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [budgetId, setBudgetId] = useState(initial?.budgetId ?? '')
  const [contractor, setContractor] = useState(initial?.contractor ?? '')
  const [contractorRep, setContractorRep] = useState(initial?.contractorRep ?? '')
  const [designWon, setDesignWon] = useState<number | null>(initial?.designWon ?? null)
  const [contractWon, setContractWon] = useState<number | null>(initial?.contractWon ?? null)
  const [estimatedWon, setEstimatedWon] = useState<number | null>(initial?.estimatedWon ?? null)
  const [contractDate, setContractDate] = useState(initial?.contractDate ?? '')
  const [contractMethod, setContractMethod] = useState(initial?.contractMethod ?? '수의1인견적')
  const [office, setOffice] = useState(initial?.office ?? '본청')
  const [orderDept, setOrderDept] = useState(initial?.orderDept ?? '건설과')
  const [superviseDept, setSuperviseDept] = useState(initial?.superviseDept ?? '건설과')
  const [supervisor, setSupervisor] = useState(initial?.supervisor ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [contractReason, setContractReason] = useState(initial?.contractReason ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [status, setStatus] = useState<ConstructionStatus>(initial?.status ?? 'PLANNED')
  const [unitIds, setUnitIds] = useState<string[]>(initial?.facilities.map((f) => f.planUnitId) ?? [])
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState('')

  const budget = budgets.find((b) => b.id === budgetId) ?? null
  const candidates = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const all = [...planById.values()].filter((p) => p.canLinkBudget)
    const list = q
      ? all.filter((p) => [p.name, p.emd, p.ri, p.type].join(' ').toLowerCase().includes(q))
      : (budget?.allocs ?? []).flatMap((a) => planById.get(a.planUnitId) ?? [])
    return list.sort((a, b) => a.rank - b.rank).slice(0, 100)
  }, [keyword, planById, budget])
  const toggle = (id: string) => setUnitIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const save = () => {
    if (!name.trim()) return setError('공사명을 넣어 주세요.')
    if (unitIds.length === 0) return setError('대상 시설을 한 곳 이상 고르세요.')
    if (startDate && endDate && endDate < startDate) return setError('준공 예정일이 착공일보다 빠릅니다.')
    const id = initial?.id ?? newBudgetId('con')
    const prev = new Map(initial?.facilities.map((f) => [f.planUnitId, f]) ?? [])
    const facilities: ConstructionFacility[] = unitIds.map((u) => prev.get(u) ?? { planUnitId: u, doneQty: null, actualCostWon: null })
    smallPublicBudgetActions.saveConstruction({
      id,
      name: name.trim(),
      budgetId: budgetId || null,
      contractor: contractor.trim(),
      contractWon,
      designWon,
      startDate,
      endDate,
      completedOn: initial?.completedOn ?? '',
      status,
      office: office.trim(),
      orderDept: orderDept.trim(),
      estimatedWon,
      initialContractWon: contractWon,
      bidRate: estimatedWon && contractWon && estimatedWon > 0 ? Math.round((contractWon / estimatedWon) * 1000) / 10 : null,
      totalContractWon: contractWon,
      contractDate,
      contractMethod: contractMethod.trim(),
      contractorRep: contractorRep.trim(),
      location: location.trim(),
      contractReason: contractReason.trim(),
      superviseDept: superviseDept.trim(),
      supervisor: supervisor.trim(),
      facilities,
    })
    onSaved(id)
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title={initial ? '공사 수정' : '공사 등록'}
      subtitle={initial ? CONSTRUCTION_STATUS_LABEL[initial.status] : '공사 정보와 대상 시설을 넣고 저장하세요.'}
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
              <BudgetFormRow label="계약명(공사명)" required>
                <input className={budgetFieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: ○○리 세천 정비공사" />
              </BudgetFormRow>
            </div>
            <BudgetFormRow label="관서">
              <input className={budgetFieldClass} value={office} onChange={(e) => setOffice(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="발주부서">
              <input className={budgetFieldClass} value={orderDept} onChange={(e) => setOrderDept(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="예산">
              <select className={budgetFieldClass} value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                <option value="">연결 안 함</option>
                {budgets
                  .slice()
                  .sort((a, b) => b.fiscalYear - a.fiscalYear)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.fiscalYear}년 {FUND_SOURCE_LABEL[b.fundSource]} · {b.title}
                    </option>
                  ))}
              </select>
            </BudgetFormRow>
            <BudgetFormRow label="계약방법">
              <input className={budgetFieldClass} value={contractMethod} onChange={(e) => setContractMethod(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="계약상대업체">
              <input className={budgetFieldClass} value={contractor} onChange={(e) => setContractor(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="대표자">
              <input className={budgetFieldClass} value={contractorRep} onChange={(e) => setContractorRep(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="계약일자">
              <input type="date" className={budgetFieldClass} value={contractDate} onChange={(e) => setContractDate(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="상태" required>
              <PlanChoice
                options={EDITABLE_STATUSES.map((s) => ({ value: s, label: CONSTRUCTION_STATUS_LABEL[s] }))}
                value={status}
                onChange={setStatus}
              />
            </BudgetFormRow>
            <BudgetFormRow label="예정가격">
              <WonInput value={estimatedWon} onChange={setEstimatedWon} />
            </BudgetFormRow>
            <BudgetFormRow label="계약금액">
              <WonInput value={contractWon} onChange={setContractWon} />
            </BudgetFormRow>
            <BudgetFormRow label="설계금액">
              <WonInput value={designWon} onChange={setDesignWon} />
            </BudgetFormRow>
            <BudgetFormRow label="착공일자">
              <input type="date" className={budgetFieldClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="준공예정일">
              <input type="date" className={budgetFieldClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="감독부서">
              <input className={budgetFieldClass} value={superviseDept} onChange={(e) => setSuperviseDept(e.target.value)} />
            </BudgetFormRow>
            <BudgetFormRow label="감리원">
              <input className={budgetFieldClass} value={supervisor} onChange={(e) => setSupervisor(e.target.value)} />
            </BudgetFormRow>
            <div className="sm:col-span-2">
              <BudgetFormRow label="소재지">
                <input className={budgetFieldClass} value={location} onChange={(e) => setLocation(e.target.value)} />
              </BudgetFormRow>
            </div>
            <div className="sm:col-span-2">
              <BudgetFormRow label="계약사유">
                <textarea
                  className={cn(budgetFieldClass, 'h-16 resize-y py-2')}
                  value={contractReason}
                  onChange={(e) => setContractReason(e.target.value)}
                />
              </BudgetFormRow>
            </div>
          </div>
        </BudgetFormSection>

        <BudgetFormSection
          title={`대상 시설 (${unitIds.length}곳)`}
          actions={<span className="text-[11px] font-normal text-muted-foreground">한 곳 이상 필수</span>}
        >
          {unitIds.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {unitIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[12px] text-primary"
                >
                  {planById.get(id)?.name ?? id}
                  <button type="button" onClick={() => toggle(id)} aria-label="빼기" className="rounded-full hover:bg-primary/20">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={budget ? '시설명·읍면·리명 검색 (비우면 이 예산에 배정한 시설)' : '시설명·읍면·리명 검색'}
              className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="max-h-[220px] overflow-auto rounded-md border border-border scrollbar-thin">
            <table className={budgetListTableClass}>
              <thead>
                <tr>
                  <th className="w-10" />
                  <th className="w-14 text-center">순위</th>
                  <th>시설명</th>
                  <th>위치</th>
                  <th className="text-right">계획 사업량(m)</th>
                  <th className="text-right">계획 사업비(백만원)</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      {keyword.trim()
                        ? '검색 결과가 없습니다.'
                        : budget
                          ? '이 예산에 배정한 시설이 없습니다. 검색으로 찾으세요.'
                          : '시설명을 검색하세요.'}
                    </td>
                  </tr>
                ) : (
                  candidates.map((p) => {
                    const on = unitIds.includes(p.id)
                    return (
                      <tr key={p.id} onClick={() => toggle(p.id)} className={cn('cursor-pointer', on ? 'bg-primary/10' : 'hover:bg-muted/50')}>
                        <td>
                          <input type="checkbox" checked={on} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} aria-label={p.name} />
                        </td>
                        <td className="text-center tabular-nums">{p.rank}</td>
                        <td className={cn('whitespace-nowrap', on && 'text-primary')}>{p.name}</td>
                        <td className="whitespace-nowrap text-muted-foreground">{[p.emd, p.ri].filter(Boolean).join(' ')}</td>
                        <td className="num">{p.qty ? p.qty.toLocaleString('ko-KR') : '—'}</td>
                        <td className="num">{millionText(p.costWon)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </BudgetFormSection>
      </div>
    </SmallPublicModalShell>
  )
}

/* ── 공사 상세 ─────────────────────────────────────── */

export function SmallPublicConstructionDetailModal({
  construction: c,
  budgets,
  planById,
  onClose,
  onEdit,
  onComplete,
  onDelete,
  ...overlay
}: SmallPublicModalOverlay & {
  construction: Construction
  budgets: BudgetItem[]
  planById: Map<string, PlanRef>
  onClose: () => void
  onEdit: () => void
  onComplete: () => void
  onDelete: () => void
}) {
  const preview = useSmallPublicFilePreview()
  const b = budgets.find((x) => x.id === c.budgetId)
  const done = c.status === 'DONE'
  const canComplete = c.status === 'PLANNED' || c.status === 'ONGOING'
  const sumActual = c.facilities.reduce((n, f) => n + (f.actualCostWon ?? 0), 0)

  const upload = (kind: ConstructionFileKind, list: FileList | null) => {
    if (!list?.length) return
    smallPublicBudgetActions.addConstructionFiles(
      c.id,
      [...list].map((f) => ({ id: newBudgetId('cf'), name: f.name, url: URL.createObjectURL(f), kind, uploadedAt: todayYmd() }))
    )
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title={c.name}
      subtitle={`${CONSTRUCTION_STATUS_LABEL[c.status]} · ${done ? `준공 ${c.completedOn}` : periodText(c)}`}
      onClose={onClose}
      showHeaderClose
      footer={
        <div className="ml-auto flex items-center gap-2.5">
          {!done ? (
            <button type="button" className={smallPublicBtnGhost} onClick={onEdit}>
              수정
            </button>
          ) : null}
          {canComplete ? (
            <button type="button" className={smallPublicBtnPrimary} onClick={onComplete}>
              준공 처리
            </button>
          ) : null}
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
              { kind: 'full', label: '계약명', value: c.name },
              {
                kind: 'pair',
                left: { label: '관서', value: c.office },
                right: { label: '발주부서', value: c.orderDept },
              },
              {
                kind: 'pair',
                left: { label: '계약금액', value: wonText(c.contractWon) },
                right: { label: '계약기간', value: periodText(c) },
              },
              {
                kind: 'pair',
                left: { label: '예정가격', value: wonText(c.estimatedWon) },
                right: { label: '최초계약금액', value: wonText(c.initialContractWon) },
              },
              {
                kind: 'pair',
                left: { label: '낙찰률', value: c.bidRate != null ? `${c.bidRate}%` : '' },
                right: { label: '총괄계약금액', value: wonText(c.totalContractWon) },
              },
              {
                kind: 'pair',
                left: { label: '계약일자', value: c.contractDate },
                right: { label: '착공일자', value: c.startDate },
              },
              {
                kind: 'pair',
                left: { label: '계약방법', value: c.contractMethod },
                right: { label: '준공일자', value: c.completedOn || c.endDate },
              },
              {
                kind: 'pair',
                left: { label: '계약상대업체', value: c.contractor },
                right: { label: '대표자', value: c.contractorRep },
              },
              { kind: 'full', label: '소재지', value: c.location },
              { kind: 'full', label: '계약사유', value: c.contractReason },
              {
                kind: 'pair',
                left: { label: '감독부서', value: c.superviseDept },
                right: { label: '감리원', value: c.supervisor },
              },
              {
                kind: 'pair',
                left: { label: '설계금액', value: wonText(c.designWon) },
                right: { label: '실제 공사비', value: done ? wonText(sumActual) : '' },
              },
              {
                kind: 'pair',
                left: {
                  label: '연결 예산',
                  value: b ? `${b.fiscalYear}년 ${FUND_SOURCE_LABEL[b.fundSource]} · ${b.title}` : '',
                },
                right: { label: '상태', value: CONSTRUCTION_STATUS_LABEL[c.status] },
              },
            ]}
          />
        </BudgetDetailSection>

        <BudgetDetailSection title={`대상 시설 (${c.facilities.length}곳)`}>
          <div className="space-y-1.5 p-3">
            <table className={budgetListTableClass}>
              <thead>
                <tr>
                  <th>시설명</th>
                  <th className="text-right">계획량</th>
                  <th className="text-right">시공량</th>
                  <th className="text-right">계획 사업비</th>
                  <th className="text-right">실제 공사비</th>
                </tr>
              </thead>
              <tbody>
                {c.facilities.map((f) => {
                  const p = planById.get(f.planUnitId)
                  return (
                    <tr key={f.planUnitId}>
                      <td className="whitespace-nowrap">
                        {p?.name ?? f.planUnitId}
                        {p ? <span className="ml-1 text-[11px] text-muted-foreground">{p.rank}위</span> : null}
                      </td>
                      <td className="num">{p?.qty ? p.qty.toLocaleString('ko-KR') : '—'}</td>
                      <td className="num">{f.doneQty != null ? f.doneQty.toLocaleString('ko-KR') : '—'}</td>
                      <td className="num">{p ? millionText(p.costWon) : '—'}</td>
                      <td className="num">{f.actualCostWon != null ? millionText(f.actualCostWon) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground">사업량 m · 금액 백만원 · 시공량·실제 공사비는 준공 처리 때 넣습니다.</p>
          </div>
        </BudgetDetailSection>

        <BudgetDetailSection title={`첨부 (${c.files.length}건)`}>
          <div className="grid gap-3 p-3 sm:grid-cols-2">
            {CONSTRUCTION_FILE_KINDS.map((kind) => {
              const files = c.files.filter((f) => f.kind === kind)
              return (
                <div key={kind} className="rounded-md border border-border p-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[12px] font-medium text-foreground/80">{CONSTRUCTION_FILE_LABEL[kind]}</span>
                    <label className="ml-auto inline-flex h-6 cursor-pointer items-center gap-1 rounded border border-border px-1.5 text-[11px] text-muted-foreground hover:bg-muted/50">
                      <Upload className="h-3 w-3" aria-hidden />
                      올리기
                      <input
                        type="file"
                        multiple
                        accept={kind === 'PHOTO' ? 'image/*' : undefined}
                        className="hidden"
                        onChange={(e) => {
                          upload(kind, e.target.files)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                  {files.length === 0 ? (
                    <p className="rounded border border-dashed border-border px-2 py-2 text-center text-[11px] text-muted-foreground">없음</p>
                  ) : (
                    <div className="space-y-1">
                      {files.map((f) => (
                        <SmallPublicFileRow
                          key={f.id}
                          file={f}
                          onPreview={() => preview.open(f, files)}
                          onDownload={() => preview.download(f)}
                          onRemove={() => {
                            if (window.confirm(`«${f.name}» 첨부를 지울까요?`)) smallPublicBudgetActions.removeConstructionFile(c.id, f.id)
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </BudgetDetailSection>
      </div>
      {preview.element}
    </SmallPublicModalShell>
  )
}

/* ── 준공 처리 ─────────────────────────────────────── */

function defaultCosts(c: Construction, planById: Map<string, PlanRef>): Map<string, number> {
  const plans = c.facilities.map((f) => ({ id: f.planUnitId, cost: planById.get(f.planUnitId)?.costWon ?? 0 }))
  const sum = plans.reduce((n, p) => n + p.cost, 0)
  return new Map(
    plans.map((p) => [p.id, c.contractWon && sum > 0 ? Math.round((c.contractWon * p.cost) / sum / 1000) * 1000 : p.cost])
  )
}

export function SmallPublicConstructionCompleteModal({
  construction,
  planById,
  onCancel,
  onSaved,
  ...overlay
}: SmallPublicModalOverlay & {
  construction: Construction
  planById: Map<string, PlanRef>
  onCancel: () => void
  onSaved: () => void
}) {
  const [completedOn, setCompletedOn] = useState(construction.endDate && construction.endDate <= todayYmd() ? construction.endDate : todayYmd())
  const [rows, setRows] = useState<ConstructionFacility[]>(() => {
    const costs = defaultCosts(construction, planById)
    return construction.facilities.map((f) => ({
      planUnitId: f.planUnitId,
      doneQty: f.doneQty ?? (planById.get(f.planUnitId)?.qty || null),
      actualCostWon: f.actualCostWon ?? costs.get(f.planUnitId) ?? null,
    }))
  })
  const [error, setError] = useState('')
  const patch = (id: string, p: Partial<ConstructionFacility>) =>
    setRows((prev) => prev.map((r) => (r.planUnitId === id ? { ...r, ...p } : r)))
  const sumCost = rows.reduce((n, r) => n + (r.actualCostWon ?? 0), 0)

  const save = () => {
    if (!completedOn) return setError('준공일을 넣어 주세요.')
    if (rows.some((r) => r.actualCostWon == null)) return setError('시설마다 실제 공사비를 넣어 주세요.')
    smallPublicBudgetActions.completeConstruction(construction.id, completedOn, rows)
    onSaved()
  }

  return (
    <SmallPublicModalShell
      {...overlay}
      size="lg"
      title="준공 처리"
      subtitle={`«${construction.name}» — 시공 사업량·실제 공사비는 정비계획 명세서의 «정비된 부분»에 합쳐집니다.`}
      onClose={onCancel}
      footer={
        <>
          <ModalError text={error} />
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            준공 처리
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onCancel}>
            취소
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <BudgetFormSection title="준공일">
          <BudgetFormRow label="준공일" required>
            <input type="date" className={cn(budgetFieldClass, 'w-44')} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />
          </BudgetFormRow>
        </BudgetFormSection>
        <BudgetFormSection title="시설별 실적">
          <table className={budgetListTableClass}>
            <thead>
              <tr>
                <th>시설명</th>
                <th className="text-right">계획 사업량(m)</th>
                <th className="w-36 text-right">시공 사업량(m)</th>
                <th className="text-right">계획 사업비(백만원)</th>
                <th className="w-48 text-right">실제 공사비</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = planById.get(r.planUnitId)
                return (
                  <tr key={r.planUnitId}>
                    <td className="whitespace-nowrap">{p?.name ?? r.planUnitId}</td>
                    <td className="num">{p?.qty ? p.qty.toLocaleString('ko-KR') : '—'}</td>
                    <td>
                      <PlanNumInput value={r.doneQty} onChange={(v) => patch(r.planUnitId, { doneQty: v })} placeholder="m" />
                    </td>
                    <td className="num">{p ? millionText(p.costWon) : '—'}</td>
                    <td>
                      <WonInput value={r.actualCostWon} onChange={(v) => patch(r.planUnitId, { actualCostWon: v })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted-foreground">
            실제 공사비 합 {sumCost.toLocaleString('ko-KR')}원
            {construction.contractWon ? ` · 계약금액 ${construction.contractWon.toLocaleString('ko-KR')}원` : ''} · 처음 값은 계약금액을 계획
            사업비 비율로 나눈 값입니다.
          </p>
        </BudgetFormSection>
      </div>
    </SmallPublicModalShell>
  )
}
