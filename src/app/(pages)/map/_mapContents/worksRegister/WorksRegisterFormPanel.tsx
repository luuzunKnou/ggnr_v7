'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  LoaderCircle,
  MapPinned,
  PencilRuler,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/app/shadcnComponents/ui/button'
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll'
import {
  createEmptyWorksRegisterRecord,
  formatAmountComma,
  normalizeAmountInput,
  resolveWorksRegisterStageStatus,
  syncRecordListFields,
  WORKS_REGISTER_NEW_ID,
  WORKS_REGISTER_STATUS_LABEL,
  type WorksRegisterContractInfo,
  type WorksRegisterDetailDesign,
  type WorksRegisterDesignDocument,
  type WorksRegisterProjectDesign,
  type WorksRegisterRecord,
  type WorksRegisterScope,
  type WorksRegisterStageId,
  type WorksRegisterStageStatus,
  type WorksRegisterWarranty,
} from './worksRegisterMock'
import {
  formatLandPriceStatLines,
  formatLocationLabel,
  formatOwnershipStatLines,
  formatZoneStatLines,
} from './worksRegisterScopeSummary'

type Props = {
  record: WorksRegisterRecord | null
  /** shell의 확정 구역 — 폼 draft.scope와 동기화 */
  confirmedScope?: WorksRegisterScope | null
  scopeSummaryLoading?: boolean
  onClose: () => void
  onSave: (record: WorksRegisterRecord) => void
  onStartZoneDraw: () => void
  onOpenLocationAnalysis: () => void
  onOpenScopeDetail?: (scope: WorksRegisterScope) => void
  drawingActive?: boolean
  onScopeCleared?: () => void
}

type TabId = WorksRegisterStageId

const TABS: { id: TabId; label: string }[] = [
  { id: 'projectDesign', label: '사업설계' },
  { id: 'detailDesign', label: '상세설계' },
  { id: 'contract', label: '발주·계약' },
  { id: 'construction', label: '착공·시공' },
  { id: 'completion', label: '준공' },
  { id: 'warranty', label: '하자보수' },
]

const SECTION_OPEN_BY_TAB: Record<TabId, Set<string>> = {
  projectDesign: new Set(['projectDesign', 'scope']),
  detailDesign: new Set(['detailDesign', 'designDocs']),
  contract: new Set(['contract', 'joint', 'sub']),
  construction: new Set(['start', 'change', 'payment']),
  completion: new Set(['completion']),
  warranty: new Set(['warranty']),
}

const STATUS_LABEL = WORKS_REGISTER_STATUS_LABEL

function ScopeStatBlock({
  label,
  lines,
  loading,
}: {
  label: string
  lines: string[]
  loading?: boolean
}) {
  return (
    <>
      <dt className="pt-0.5 font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-800">
        {lines.length > 0 ? (
          <ul className="space-y-1">
            {lines.map((line) => (
              <li key={`${label}-${line}`} className="break-words leading-snug text-slate-800">
                {line}
              </li>
            ))}
          </ul>
        ) : loading ? (
          <span className="text-sky-600">조회 중…</span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </dd>
    </>
  )
}

function StageStatusIcon({
  status,
  activeTab,
  className,
}: {
  status: WorksRegisterStageStatus
  activeTab?: boolean
  className?: string
}) {
  const label = STATUS_LABEL[status]
  if (status === 'done') {
    return (
      <CheckCircle2
        className={cn(
          'h-3 w-3 shrink-0',
          activeTab ? 'text-emerald-300' : 'text-emerald-600',
          className
        )}
        aria-label={label}
        title={label}
      />
    )
  }
  if (status === 'active') {
    return (
      <LoaderCircle
        className={cn(
          'h-3 w-3 shrink-0',
          activeTab ? 'text-amber-200' : 'text-amber-500',
          className
        )}
        aria-label={label}
        title={label}
      />
    )
  }
  return (
    <Circle
      className={cn(
        'h-3 w-3 shrink-0',
        activeTab ? 'text-slate-400' : 'text-slate-300',
        className
      )}
      aria-label={label}
      title={label}
    />
  )
}

const inputCls =
  'w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200'

function Section({
  id,
  title,
  openIds,
  onToggle,
  children,
  action,
}: {
  id: string
  title: string
  openIds: Set<string>
  onToggle: (id: string) => void
  children: ReactNode
  action?: ReactNode
}) {
  const isOpen = openIds.has(id)
  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left hover:bg-slate-50"
        >
          <span className="text-[11px] font-semibold tracking-wide text-slate-700">{title}</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
            {isOpen ? '접기' : '펼치기'}
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
          </span>
        </button>
        {action}
      </div>
      {isOpen && <div>{children}</div>}
    </section>
  )
}

function FieldInput({
  label,
  value,
  onChange,
  span,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  span?: boolean
  type?: string
}) {
  return (
    <label
      className={cn(
        'grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2 px-2.5 py-1.5',
        span && 'col-span-2'
      )}
    >
      <span className="shrink-0 overflow-hidden whitespace-nowrap font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </label>
  )
}

function AmountField({
  label,
  value,
  onChange,
  span,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  span?: boolean
}) {
  return (
    <label
      className={cn(
        'grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2 px-2.5 py-1.5',
        span && 'col-span-2'
      )}
    >
      <span className="shrink-0 overflow-hidden whitespace-nowrap font-medium text-slate-600">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(normalizeAmountInput(e.target.value))}
        className={cn(inputCls, 'tabular-nums text-right')}
      />
    </label>
  )
}

function AmountCell({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      className={cn(inputCls, 'tabular-nums text-right')}
      value={value}
      onChange={(e) => onChange(normalizeAmountInput(e.target.value))}
    />
  )
}

function withCommaAmounts(record: WorksRegisterRecord): WorksRegisterRecord {
  const detailDesign = record.detailDesign ?? {
    designType: '실시설계',
    designNo: '',
    designAmount: '',
    startDate: '',
    endDate: '',
    designer: '',
    representative: '',
    approver: '',
    approveDate: '',
    summary: '',
    remark: '',
    documents: [],
  }
  return {
    ...record,
    scope: record.scope ? { ...record.scope } : null,
    projectDesign: {
      ...record.projectDesign,
      designAmount: formatAmountComma(record.projectDesign?.designAmount ?? ''),
    },
    detailDesign: {
      ...detailDesign,
      designAmount: formatAmountComma(detailDesign.designAmount ?? ''),
      documents: (detailDesign.documents ?? []).map((d) => ({ ...d })),
    },
    contract: {
      ...record.contract,
      plannedAmount: formatAmountComma(record.contract.plannedAmount),
      firstContractAmount: formatAmountComma(record.contract.firstContractAmount),
      contractAmount: formatAmountComma(record.contract.contractAmount),
    },
    payments: record.payments.map((p) => ({ ...p, amount: formatAmountComma(p.amount) })),
    paymentTotal: formatAmountComma(record.paymentTotal),
    balance: formatAmountComma(record.balance),
    designChanges: record.designChanges.map((c) => ({
      ...c,
      delta: formatAmountComma(c.delta),
      changedAmount: formatAmountComma(c.changedAmount),
    })),
    jointContracts: record.jointContracts.map((j) => ({
      ...j,
      amount: formatAmountComma(j.amount),
    })),
    subcontracts: record.subcontracts.map((s) => ({
      ...s,
      amount: formatAmountComma(s.amount),
    })),
    warranty: { ...(record.warranty ?? { period: '', startDate: '', endDate: '', content: '', remark: '' }) },
  }
}

export function WorksRegisterFormPanel({
  record,
  confirmedScope = null,
  scopeSummaryLoading = false,
  onClose,
  onSave,
  onStartZoneDraw,
  onOpenLocationAnalysis,
  onOpenScopeDetail,
  drawingActive = false,
  onScopeCleared,
}: Props) {
  const [draft, setDraft] = useState<WorksRegisterRecord>(() =>
    withCommaAmounts(record ? structuredClone(record) : createEmptyWorksRegisterRecord())
  )
  const [tab, setTab] = useState<TabId>('projectDesign')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(SECTION_OPEN_BY_TAB.projectDesign))
  const confirmedScopeRef = useRef(confirmedScope)
  confirmedScopeRef.current = confirmedScope

  useEffect(() => {
    const base = withCommaAmounts(
      record ? structuredClone(record) : createEmptyWorksRegisterRecord()
    )
    setDraft({
      ...base,
      scope: confirmedScopeRef.current ?? base.scope,
    })
    setTab('projectDesign')
    setOpenIds(new Set(SECTION_OPEN_BY_TAB.projectDesign))
  }, [record])

  useEffect(() => {
    setDraft((prev) => {
      if (prev.scope === confirmedScope) return prev
      return { ...prev, scope: confirmedScope }
    })
  }, [confirmedScope])

  const isNew = draft.id === WORKS_REGISTER_NEW_ID
  const title = isNew ? '발주 등록' : draft.contract.summary || draft.contractName || '발주 상세'

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleTabChange = (next: TabId) => {
    setTab(next)
    setOpenIds(new Set(SECTION_OPEN_BY_TAB[next]))
  }

  const setContract = <K extends keyof WorksRegisterContractInfo>(key: K, value: string) => {
    setDraft((prev) => ({
      ...prev,
      contract: { ...prev.contract, [key]: value },
    }))
  }

  const setProjectDesign = <K extends keyof WorksRegisterProjectDesign>(key: K, value: string) => {
    setDraft((prev) => ({
      ...prev,
      projectDesign: { ...prev.projectDesign, [key]: value },
    }))
  }

  const setDetailDesign = <K extends keyof Omit<WorksRegisterDetailDesign, 'documents'>>(
    key: K,
    value: string
  ) => {
    setDraft((prev) => ({
      ...prev,
      detailDesign: {
        designType: '실시설계',
        designNo: '',
        designAmount: '',
        startDate: '',
        endDate: '',
        designer: '',
        representative: '',
        approver: '',
        approveDate: '',
        summary: '',
        remark: '',
        documents: [],
        ...prev.detailDesign,
        [key]: value,
      },
    }))
  }

  const setWarranty = <K extends keyof WorksRegisterWarranty>(key: K, value: string) => {
    setDraft((prev) => ({
      ...prev,
      warranty: { ...prev.warranty, [key]: value },
    }))
  }

  const handleSave = () => {
    onSave(withCommaAmounts(syncRecordListFields(draft)))
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1">
        <span className="truncate text-sm font-semibold text-slate-800">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 overflow-x-auto border-b border-slate-200 px-2">
        <div className="flex min-w-max gap-0.5 py-1" role="tablist" aria-label="발주 단계">
          {TABS.map((t) => {
            const active = tab === t.id
            const stageStatus = resolveWorksRegisterStageStatus(draft, t.id)
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => handleTabChange(t.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <StageStatusIcon status={stageStatus} activeTab={active} />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2 text-xs">
        {tab === 'projectDesign' && (
          <>
            <Section id="projectDesign" title="사업설계" openIds={openIds} onToggle={toggle}>
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 bg-slate-50/50">
                <FieldInput
                  label="사업명"
                  value={draft.projectDesign.projectName}
                  onChange={(v) => setProjectDesign('projectName', v)}
                  span
                />
                <FieldInput
                  label="설계번호"
                  value={draft.projectDesign.designNo}
                  onChange={(v) => setProjectDesign('designNo', v)}
                />
                <AmountField
                  label="설계금액"
                  value={draft.projectDesign.designAmount}
                  onChange={(v) => setProjectDesign('designAmount', v)}
                />
                <FieldInput
                  label="설계시작일"
                  value={draft.projectDesign.startDate}
                  onChange={(v) => setProjectDesign('startDate', v)}
                  type="date"
                />
                <FieldInput
                  label="설계종료일"
                  value={draft.projectDesign.endDate}
                  onChange={(v) => setProjectDesign('endDate', v)}
                  type="date"
                />
                <FieldInput
                  label="설계업체"
                  value={draft.projectDesign.designer}
                  onChange={(v) => setProjectDesign('designer', v)}
                />
                <FieldInput
                  label="대표자"
                  value={draft.projectDesign.representative}
                  onChange={(v) => setProjectDesign('representative', v)}
                />
                <FieldInput
                  label="설계개요"
                  value={draft.projectDesign.summary}
                  onChange={(v) => setProjectDesign('summary', v)}
                  span
                />
                <FieldInput
                  label="비고"
                  value={draft.projectDesign.remark}
                  onChange={(v) => setProjectDesign('remark', v)}
                  span
                />
              </div>
            </Section>

            <Section id="scope" title="사업구역" openIds={openIds} onToggle={toggle}>
              <div className="space-y-2 p-2.5">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={onStartZoneDraw}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] font-semibold transition-colors',
                      drawingActive
                        ? 'border-slate-800 bg-slate-800 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <PencilRuler className="h-3.5 w-3.5 shrink-0" />
                    구역 그리기
                  </button>
                  <button
                    type="button"
                    onClick={onOpenLocationAnalysis}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <MapPinned className="h-3.5 w-3.5 shrink-0" />
                    입지분석
                  </button>
                </div>
                {draft.scope ? (
                  <div className="space-y-2.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-sky-800">
                        사업구역 공간분석
                        {scopeSummaryLoading ? (
                          <span className="ml-1 font-normal text-sky-600">· 요약 조회 중…</span>
                        ) : null}
                      </p>
                      <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-sky-700 hover:bg-sky-100"
                        onClick={() => {
                          setDraft((prev) => ({ ...prev, scope: null }))
                          onScopeCleared?.()
                        }}
                      >
                        해제
                      </button>
                    </div>
                    <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2.5 gap-y-2 text-xs">
                      <dt className="font-medium text-slate-500">위치</dt>
                      <dd className="break-words text-slate-800">
                        {draft.scope.locationLabel ||
                          (draft.scope.parcelCount != null && draft.scope.parcelCount > 0
                            ? formatLocationLabel('', draft.scope.parcelCount)
                            : null) ||
                          (scopeSummaryLoading ? (
                            <span className="text-sky-600">조회 중…</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          ))}
                      </dd>
                      <dt className="font-medium text-slate-500">면적</dt>
                      <dd className="tabular-nums text-slate-800">
                        {draft.scope.areaSqm > 0
                          ? `약 ${draft.scope.areaSqm.toLocaleString('ko-KR')}㎡`
                          : '—'}
                        {draft.scope.parcelCount != null && draft.scope.parcelCount > 0
                          ? ` · ${draft.scope.parcelCount.toLocaleString('ko-KR')}필지`
                          : ''}
                      </dd>
                      <ScopeStatBlock
                        label="공시지가"
                        lines={formatLandPriceStatLines(draft.scope.landPriceByOwner)}
                        loading={scopeSummaryLoading}
                      />
                      <ScopeStatBlock
                        label="소유구분"
                        lines={formatOwnershipStatLines(draft.scope.ownershipStats)}
                        loading={scopeSummaryLoading}
                      />
                      <ScopeStatBlock
                        label="용도지역"
                        lines={formatZoneStatLines(draft.scope.zoneStats)}
                        loading={scopeSummaryLoading}
                      />
                    </dl>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 w-full border-sky-300 bg-white text-xs font-medium text-sky-900 hover:bg-sky-100"
                      onClick={() => {
                        if (draft.scope) onOpenScopeDetail?.(draft.scope)
                      }}
                    >
                      상세보기
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    지도에 그리거나, 입지분석으로 추천 구역을 선택하세요.
                  </p>
                )}
              </div>
            </Section>
          </>
        )}

        {tab === 'detailDesign' && (
          <>
            <Section id="detailDesign" title="상세설계" openIds={openIds} onToggle={toggle}>
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 bg-slate-50/50">
                <FieldInput
                  label="설계구분"
                  value={draft.detailDesign?.designType ?? '실시설계'}
                  onChange={(v) => setDetailDesign('designType', v)}
                />
                <FieldInput
                  label="설계번호"
                  value={draft.detailDesign?.designNo ?? ''}
                  onChange={(v) => setDetailDesign('designNo', v)}
                />
                <AmountField
                  label="설계금액"
                  value={draft.detailDesign?.designAmount ?? ''}
                  onChange={(v) => setDetailDesign('designAmount', v)}
                />
                <FieldInput
                  label="설계시작일"
                  value={draft.detailDesign?.startDate ?? ''}
                  onChange={(v) => setDetailDesign('startDate', v)}
                  type="date"
                />
                <FieldInput
                  label="설계종료일"
                  value={draft.detailDesign?.endDate ?? ''}
                  onChange={(v) => setDetailDesign('endDate', v)}
                  type="date"
                />
                <FieldInput
                  label="설계업체"
                  value={draft.detailDesign?.designer ?? ''}
                  onChange={(v) => setDetailDesign('designer', v)}
                />
                <FieldInput
                  label="대표자"
                  value={draft.detailDesign?.representative ?? ''}
                  onChange={(v) => setDetailDesign('representative', v)}
                />
                <FieldInput
                  label="승인자"
                  value={draft.detailDesign?.approver ?? ''}
                  onChange={(v) => setDetailDesign('approver', v)}
                />
                <FieldInput
                  label="승인일"
                  value={draft.detailDesign?.approveDate ?? ''}
                  onChange={(v) => setDetailDesign('approveDate', v)}
                  type="date"
                />
                <FieldInput
                  label="설계개요"
                  value={draft.detailDesign?.summary ?? ''}
                  onChange={(v) => setDetailDesign('summary', v)}
                  span
                />
                <FieldInput
                  label="비고"
                  value={draft.detailDesign?.remark ?? ''}
                  onChange={(v) => setDetailDesign('remark', v)}
                  span
                />
              </div>
            </Section>

            <Section
              id="designDocs"
              title="설계도서"
              openIds={openIds}
              onToggle={toggle}
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() =>
                    setDraft((prev) => {
                      const docs = prev.detailDesign?.documents ?? []
                      const next: WorksRegisterDesignDocument = {
                        seq: docs.length + 1,
                        kind: '',
                        title: '',
                        drawNo: '',
                        date: '',
                        fileName: '',
                        remark: '',
                      }
                      return {
                        ...prev,
                        detailDesign: {
                          designType: '실시설계',
                          designNo: '',
                          designAmount: '',
                          startDate: '',
                          endDate: '',
                          designer: '',
                          representative: '',
                          approver: '',
                          approveDate: '',
                          summary: '',
                          remark: '',
                          ...prev.detailDesign,
                          documents: [...docs, next],
                        },
                      }
                    })
                  }
                >
                  <Plus className="h-3 w-3" />
                  행추가
                </button>
              }
            >
              {(draft.detailDesign?.documents ?? []).length === 0 ? (
                <div className="px-3 py-6 text-center text-slate-500">
                  위치도·평면도·내역서 등 설계도서를 추가하세요.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-500">
                        <th className="px-2 py-1.5 font-medium">구분</th>
                        <th className="px-2 py-1.5 font-medium">도서명</th>
                        <th className="px-2 py-1.5 font-medium">도면번호</th>
                        <th className="px-2 py-1.5 font-medium">작성일</th>
                        <th className="px-2 py-1.5 font-medium">파일명</th>
                        <th className="px-2 py-1.5 font-medium">비고</th>
                        <th className="w-8 px-1 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {(draft.detailDesign?.documents ?? []).map((d, idx) => (
                        <tr key={`doc-${idx}`} className="border-b border-slate-100">
                          <td className="px-1 py-0.5">
                            <input
                              className={inputCls}
                              placeholder="위치도"
                              value={d.kind}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const docs = [...(prev.detailDesign?.documents ?? [])]
                                  docs[idx] = { ...docs[idx], kind: e.target.value }
                                  return {
                                    ...prev,
                                    detailDesign: { ...prev.detailDesign!, documents: docs },
                                  }
                                })
                              }
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <input
                              className={inputCls}
                              value={d.title}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const docs = [...(prev.detailDesign?.documents ?? [])]
                                  docs[idx] = { ...docs[idx], title: e.target.value }
                                  return {
                                    ...prev,
                                    detailDesign: { ...prev.detailDesign!, documents: docs },
                                  }
                                })
                              }
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <input
                              className={inputCls}
                              value={d.drawNo}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const docs = [...(prev.detailDesign?.documents ?? [])]
                                  docs[idx] = { ...docs[idx], drawNo: e.target.value }
                                  return {
                                    ...prev,
                                    detailDesign: { ...prev.detailDesign!, documents: docs },
                                  }
                                })
                              }
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <input
                              type="date"
                              className={inputCls}
                              value={d.date}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const docs = [...(prev.detailDesign?.documents ?? [])]
                                  docs[idx] = { ...docs[idx], date: e.target.value }
                                  return {
                                    ...prev,
                                    detailDesign: { ...prev.detailDesign!, documents: docs },
                                  }
                                })
                              }
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <input
                              className={inputCls}
                              placeholder="파일명"
                              value={d.fileName}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const docs = [...(prev.detailDesign?.documents ?? [])]
                                  docs[idx] = { ...docs[idx], fileName: e.target.value }
                                  return {
                                    ...prev,
                                    detailDesign: { ...prev.detailDesign!, documents: docs },
                                  }
                                })
                              }
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <input
                              className={inputCls}
                              value={d.remark}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const docs = [...(prev.detailDesign?.documents ?? [])]
                                  docs[idx] = { ...docs[idx], remark: e.target.value }
                                  return {
                                    ...prev,
                                    detailDesign: { ...prev.detailDesign!, documents: docs },
                                  }
                                })
                              }
                            />
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              onClick={() =>
                                setDraft((prev) => {
                                  const docs = (prev.detailDesign?.documents ?? [])
                                    .filter((_, i) => i !== idx)
                                    .map((row, i) => ({ ...row, seq: i + 1 }))
                                  return {
                                    ...prev,
                                    detailDesign: { ...prev.detailDesign!, documents: docs },
                                  }
                                })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </>
        )}

        {tab === 'contract' && (
          <>
            <Section id="contract" title="계약정보" openIds={openIds} onToggle={toggle}>
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 bg-slate-50/50">
                <FieldInput label="계약구분" value={draft.contract.type} onChange={(v) => setContract('type', v)} />
                <FieldInput
                  label="경쟁방법"
                  value={draft.contract.competition}
                  onChange={(v) => setContract('competition', v)}
                />
                <AmountField
                  label="예정금액"
                  value={draft.contract.plannedAmount}
                  onChange={(v) => setContract('plannedAmount', v)}
                />
                <AmountField
                  label="최초계약금액"
                  value={draft.contract.firstContractAmount}
                  onChange={(v) => setContract('firstContractAmount', v)}
                />
                <FieldInput
                  label="낙찰율"
                  value={draft.contract.bidRate}
                  onChange={(v) => setContract('bidRate', v)}
                />
                <AmountField
                  label="계약금액"
                  value={draft.contract.contractAmount}
                  onChange={(v) => setContract('contractAmount', v)}
                />
                <FieldInput
                  label="계약일자"
                  value={draft.contract.contractDate}
                  onChange={(v) => setContract('contractDate', v)}
                  type="date"
                />
                <div />
                <FieldInput
                  label="도급업체"
                  value={draft.contract.contractor}
                  onChange={(v) => setContract('contractor', v)}
                />
                <FieldInput
                  label="대표자"
                  value={draft.contract.representative}
                  onChange={(v) => setContract('representative', v)}
                />
                <FieldInput
                  label="도급업체주소"
                  value={draft.contract.contractorAddress}
                  onChange={(v) => setContract('contractorAddress', v)}
                  span
                />
                <FieldInput
                  label="계약사유"
                  value={draft.contract.reason}
                  onChange={(v) => setContract('reason', v)}
                  span
                />
                <FieldInput
                  label="사업개요"
                  value={draft.contract.summary}
                  onChange={(v) => setContract('summary', v)}
                  span
                />
                <FieldInput
                  label="계약관서"
                  value={draft.contract.contractOffice}
                  onChange={(v) => setContract('contractOffice', v)}
                />
                <FieldInput
                  label="계약부서"
                  value={draft.contract.contractDept}
                  onChange={(v) => setContract('contractDept', v)}
                />
                <FieldInput
                  label="감독부서"
                  value={draft.contract.superviseDept}
                  onChange={(v) => setContract('superviseDept', v)}
                />
                <FieldInput
                  label="감독관"
                  value={draft.contract.supervisor}
                  onChange={(v) => setContract('supervisor', v)}
                />
              </div>
            </Section>

            <Section
              id="joint"
              title="공동도급"
              openIds={openIds}
              onToggle={toggle}
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      jointContracts: [
                        ...prev.jointContracts,
                        {
                          seq: prev.jointContracts.length + 1,
                          company: '',
                          representative: '',
                          ratio: '',
                          shareType: '',
                          amount: '',
                          remark: '',
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="h-3 w-3" />
                  행추가
                </button>
              }
            >
              {draft.jointContracts.length === 0 ? (
                <div className="px-3 py-6 text-center text-slate-500">자료가 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">순번</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">업체명</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">대표자</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">비율</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">분담유형</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">공동계약금액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">비고</th>
                        <th className="w-8 px-1 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.jointContracts.map((j, idx) => (
                        <tr key={`joint-${idx}`} className="border-t border-slate-100">
                          <td className="px-2 py-1 tabular-nums text-slate-700">{idx + 1}</td>
                          {(['company', 'representative', 'ratio', 'shareType'] as const).map((key) => (
                            <td key={key} className="px-1 py-1">
                              <input
                                className={inputCls}
                                value={j[key]}
                                onChange={(e) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    jointContracts: prev.jointContracts.map((row, i) =>
                                      i === idx ? { ...row, [key]: e.target.value } : row
                                    ),
                                  }))
                                }
                              />
                            </td>
                          ))}
                          <td className="px-1 py-1">
                            <AmountCell
                              value={j.amount}
                              onChange={(v) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  jointContracts: prev.jointContracts.map((row, i) =>
                                    i === idx ? { ...row, amount: v } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              className={inputCls}
                              value={j.remark}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  jointContracts: prev.jointContracts.map((row, i) =>
                                    i === idx ? { ...row, remark: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                              title="삭제"
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  jointContracts: prev.jointContracts
                                    .filter((_, i) => i !== idx)
                                    .map((row, i) => ({ ...row, seq: i + 1 })),
                                }))
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section
              id="sub"
              title="하도급"
              openIds={openIds}
              onToggle={toggle}
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      subcontracts: [
                        ...prev.subcontracts,
                        {
                          seq: prev.subcontracts.length + 1,
                          industry: '',
                          company: '',
                          representative: '',
                          date: '',
                          amount: '',
                          rate: '',
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="h-3 w-3" />
                  행추가
                </button>
              }
            >
              {draft.subcontracts.length === 0 ? (
                <div className="px-3 py-6 text-center text-slate-500">자료가 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">순번</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">업종</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">업체명</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">대표자</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">계약일</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">하도급액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">하도급율</th>
                        <th className="w-8 px-1 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.subcontracts.map((s, idx) => (
                        <tr key={`sub-${idx}`} className="border-t border-slate-100">
                          <td className="px-2 py-1 tabular-nums text-slate-700">{idx + 1}</td>
                          {(['industry', 'company', 'representative'] as const).map((key) => (
                            <td key={key} className="px-1 py-1">
                              <input
                                className={inputCls}
                                value={s[key]}
                                onChange={(e) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    subcontracts: prev.subcontracts.map((row, i) =>
                                      i === idx ? { ...row, [key]: e.target.value } : row
                                    ),
                                  }))
                                }
                              />
                            </td>
                          ))}
                          <td className="px-1 py-1">
                            <input
                              type="date"
                              className={inputCls}
                              value={s.date}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  subcontracts: prev.subcontracts.map((row, i) =>
                                    i === idx ? { ...row, date: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <AmountCell
                              value={s.amount}
                              onChange={(v) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  subcontracts: prev.subcontracts.map((row, i) =>
                                    i === idx ? { ...row, amount: v } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              className={inputCls}
                              value={s.rate}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  subcontracts: prev.subcontracts.map((row, i) =>
                                    i === idx ? { ...row, rate: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                              title="삭제"
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  subcontracts: prev.subcontracts
                                    .filter((_, i) => i !== idx)
                                    .map((row, i) => ({ ...row, seq: i + 1 })),
                                }))
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </>
        )}

        {tab === 'construction' && (
          <>
            <Section id="start" title="착공정보" openIds={openIds} onToggle={toggle}>
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 bg-slate-50/50">
                <FieldInput
                  label="착공일"
                  value={draft.contract.startDate}
                  onChange={(v) => setContract('startDate', v)}
                  type="date"
                />
                <FieldInput
                  label="감독관"
                  value={draft.contract.supervisor}
                  onChange={(v) => setContract('supervisor', v)}
                />
                <FieldInput
                  label="감독부서"
                  value={draft.contract.superviseDept}
                  onChange={(v) => setContract('superviseDept', v)}
                  span
                />
              </div>
            </Section>

            <Section
              id="change"
              title="설계변경"
              openIds={openIds}
              onToggle={toggle}
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      designChanges: [
                        ...prev.designChanges,
                        {
                          round: `${prev.designChanges.length + 1}차`,
                          date: '',
                          delta: '',
                          changedAmount: '',
                          reason: '',
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="h-3 w-3" />
                  행추가
                </button>
              }
            >
              {draft.designChanges.length === 0 ? (
                <div className="px-3 py-6 text-center text-slate-500">자료가 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">회차</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">변경일시</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">증감액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">변경금액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">변경사유</th>
                        <th className="w-8 px-1 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.designChanges.map((c, idx) => (
                        <tr key={`chg-${idx}`} className="border-t border-slate-100">
                          <td className="px-1 py-1">
                            <input
                              className={inputCls}
                              value={c.round}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  designChanges: prev.designChanges.map((row, i) =>
                                    i === idx ? { ...row, round: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="date"
                              className={inputCls}
                              value={c.date}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  designChanges: prev.designChanges.map((row, i) =>
                                    i === idx ? { ...row, date: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <AmountCell
                              value={c.delta}
                              onChange={(v) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  designChanges: prev.designChanges.map((row, i) =>
                                    i === idx ? { ...row, delta: v } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <AmountCell
                              value={c.changedAmount}
                              onChange={(v) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  designChanges: prev.designChanges.map((row, i) =>
                                    i === idx ? { ...row, changedAmount: v } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              className={inputCls}
                              value={c.reason}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  designChanges: prev.designChanges.map((row, i) =>
                                    i === idx ? { ...row, reason: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                              title="삭제"
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  designChanges: prev.designChanges.filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section
              id="payment"
              title="대금지급"
              openIds={openIds}
              onToggle={toggle}
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      payments: [
                        ...prev.payments,
                        {
                          seq: prev.payments.length + 1,
                          kind: '부분금',
                          date: '',
                          amount: '',
                          remark: '',
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="h-3 w-3" />
                  행추가
                </button>
              }
            >
              {draft.payments.length === 0 ? (
                <div className="px-3 py-6 text-center text-slate-500">자료가 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">순번</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">구분</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">지급일자</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">지급금액</th>
                        <th className="px-2 py-1.5 font-semibold text-slate-600">비고</th>
                        <th className="w-8 px-1 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.payments.map((p, idx) => (
                        <tr key={`pay-${idx}`} className="border-t border-slate-100">
                          <td className="px-2 py-1 tabular-nums text-slate-700">{idx + 1}</td>
                          <td className="px-1 py-1">
                            <input
                              className={inputCls}
                              value={p.kind}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  payments: prev.payments.map((row, i) =>
                                    i === idx ? { ...row, kind: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="date"
                              className={inputCls}
                              value={p.date}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  payments: prev.payments.map((row, i) =>
                                    i === idx ? { ...row, date: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <AmountCell
                              value={p.amount}
                              onChange={(v) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  payments: prev.payments.map((row, i) =>
                                    i === idx ? { ...row, amount: v } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              className={inputCls}
                              value={p.remark}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  payments: prev.payments.map((row, i) =>
                                    i === idx ? { ...row, remark: e.target.value } : row
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="px-1 py-1">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                              title="삭제"
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  payments: prev.payments
                                    .filter((_, i) => i !== idx)
                                    .map((row, i) => ({ ...row, seq: i + 1 })),
                                }))
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <label className="flex items-center gap-2">
                      <span className="shrink-0 font-medium text-slate-600">합계</span>
                      <AmountCell
                        value={draft.paymentTotal}
                        onChange={(v) => setDraft((prev) => ({ ...prev, paymentTotal: v }))}
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="shrink-0 font-medium text-slate-600">잔금</span>
                      <AmountCell
                        value={draft.balance}
                        onChange={(v) => setDraft((prev) => ({ ...prev, balance: v }))}
                      />
                    </label>
                  </div>
                </div>
              )}
            </Section>
          </>
        )}

        {tab === 'completion' && (
          <Section id="completion" title="준공정보" openIds={openIds} onToggle={toggle}>
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 bg-slate-50/50">
              <FieldInput
                label="준공일"
                value={draft.contract.endDate}
                onChange={(v) => setContract('endDate', v)}
                type="date"
              />
              <AmountField
                label="계약금액"
                value={draft.contract.contractAmount}
                onChange={(v) => setContract('contractAmount', v)}
              />
              <AmountField
                label="지급합계"
                value={draft.paymentTotal}
                onChange={(v) => setDraft((prev) => ({ ...prev, paymentTotal: v }))}
              />
              <AmountField
                label="잔금"
                value={draft.balance}
                onChange={(v) => setDraft((prev) => ({ ...prev, balance: v }))}
              />
              <FieldInput
                label="사업개요"
                value={draft.contract.summary}
                onChange={(v) => setContract('summary', v)}
                span
              />
            </div>
          </Section>
        )}

        {tab === 'warranty' && (
          <Section id="warranty" title="하자보수" openIds={openIds} onToggle={toggle}>
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 bg-slate-50/50">
              <FieldInput
                label="보증기간"
                value={draft.warranty.period}
                onChange={(v) => setWarranty('period', v)}
              />
              <div />
              <FieldInput
                label="시작일"
                value={draft.warranty.startDate}
                onChange={(v) => setWarranty('startDate', v)}
                type="date"
              />
              <FieldInput
                label="종료일"
                value={draft.warranty.endDate}
                onChange={(v) => setWarranty('endDate', v)}
                type="date"
              />
              <FieldInput
                label="보수내용"
                value={draft.warranty.content}
                onChange={(v) => setWarranty('content', v)}
                span
              />
              <FieldInput
                label="비고"
                value={draft.warranty.remark}
                onChange={(v) => setWarranty('remark', v)}
                span
              />
            </div>
          </Section>
        )}
      </MapSideDetailScroll>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-3 py-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button type="button" size="sm" onClick={handleSave}>
          저장
        </Button>
      </div>
    </div>
  )
}
