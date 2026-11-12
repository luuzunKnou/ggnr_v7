'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { smallPublicBtnDanger, smallPublicBtnGhost, smallPublicBtnPrimary, smallPublicFieldClass } from '../smallPublicConfig'
import type {
  SmallPublicCandidateEval,
  SmallPublicDamageEvent,
  SmallPublicFacility,
  SmallPublicFile,
  SmallPublicInspection,
  SmallPublicSafetyDoc,
} from '../smallPublicMock'
import { smallPublicActions, smallPublicFileFromUpload } from '../smallPublicStore'
import {
  SmallPublicAttrTable,
  SmallPublicCandidateResultBadge,
  SmallPublicCrudBar,
  SmallPublicFileRow,
  SmallPublicInlineFilePreview,
  SmallPublicPanelHeader,
  smallPublicFacilityAttrEntries,
  smallPublicSelectedRowClass,
  useSmallPublicFilePreview,
} from '../smallPublicUi'
import { SmallPublicModalShell, type SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'
import { DAMAGE_GROUPS, DAMAGE_ITEMS } from '../plan/smallPublicPlanMaster'

type Tab = 'candidate' | 'safety' | 'damage' | 'files'

type Props = SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  inspections: SmallPublicInspection[]
  candidateEvals: SmallPublicCandidateEval[]
  safetyDocs: SmallPublicSafetyDoc[]
  onAddCandidateEval: () => void
  onAddSafetyDoc: () => void
  onEditCandidateEval: (ev: SmallPublicCandidateEval) => void
  onEditSafetyDoc: (doc: SmallPublicSafetyDoc) => void
  onEdit: () => void
  onDeleted: () => void
  onClose: () => void
}

const activeDamageItems = DAMAGE_ITEMS.filter((d) => d.active)

/** 내용만 있는 목록 표 — 미리보기는 아래 칸 */
function CandidateEvalList({
  rows,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
}: {
  rows: SmallPublicCandidateEval[]
  selectedId: string | null
  onSelect: (ev: SmallPublicCandidateEval) => void
  onEdit: (ev: SmallPublicCandidateEval) => void
  onDelete: (ev: SmallPublicCandidateEval) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
        후보지 평가 이력이 없습니다.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      <table className="w-full table-fixed border-collapse text-left text-[11px] leading-snug">
        <colgroup>
          <col className="w-[5.75rem]" />
          <col />
          <col className="w-[4.25rem]" />
          <col className="w-[3.5rem]" />
        </colgroup>
        <thead className="bg-muted">
          <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-normal [&>th]:text-muted-foreground">
            <th>평가일</th>
            <th>평가자</th>
            <th className="text-center">선정여부</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const active = selectedId === e.id
            return (
              <tr
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(e)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    onSelect(e)
                  }
                }}
                className={cn(
                  'cursor-pointer border-b border-border transition-colors last:border-b-0',
                  active ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                )}
              >
                <td className="px-1.5 py-1 tabular-nums text-foreground/80">{e.date}</td>
                <td className="truncate px-1.5 py-1 text-foreground/80" title={e.evaluator}>
                  {e.evaluator || '—'}
                </td>
                <td className="px-1.5 py-1 text-center">
                  <SmallPublicCandidateResultBadge result={e.result} />
                </td>
                <td className="px-0.5 py-1 text-right" onClick={(ev) => ev.stopPropagation()}>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="수정"
                    aria-label="수정"
                    onClick={() => onEdit(e)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-destructive hover:bg-destructive/10"
                    title="삭제"
                    aria-label="삭제"
                    onClick={() => onDelete(e)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 안전점검 목록 — 한 행이 묶음 자료(위험도·현장조사·일반·관리) */
function SafetyDocList({
  rows,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
}: {
  rows: SmallPublicSafetyDoc[]
  selectedId: string | null
  onSelect: (doc: SmallPublicSafetyDoc) => void
  onEdit: (doc: SmallPublicSafetyDoc) => void
  onDelete: (doc: SmallPublicSafetyDoc) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
        안전점검 이력이 없습니다.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      <table className="w-full table-fixed border-collapse text-left text-[11px] leading-snug">
        <colgroup>
          <col className="w-[5.75rem]" />
          <col />
          <col className="w-[4.5rem]" />
          <col className="w-[3.5rem]" />
        </colgroup>
        <thead className="bg-muted">
          <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-normal [&>th]:text-muted-foreground">
            <th>일자</th>
            <th>작성</th>
            <th className="text-center">첨부</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const active = selectedId === d.id
            return (
              <tr
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(d)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(d)
                  }
                }}
                className={cn(
                  'cursor-pointer border-b border-border transition-colors last:border-b-0',
                  active ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                )}
              >
                <td className="px-1.5 py-1 tabular-nums text-foreground/80">{d.date}</td>
                <td className="truncate px-1.5 py-1 text-foreground/80" title={d.person}>
                  {d.person || '—'}
                </td>
                <td className="px-1.5 py-1 text-center tabular-nums text-foreground/80">
                  {d.files.length > 0 ? `PDF ${d.files.length}장` : '—'}
                </td>
                <td className="px-0.5 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="수정"
                    aria-label="수정"
                    onClick={() => onEdit(d)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-destructive hover:bg-destructive/10"
                    title="삭제"
                    aria-label="삭제"
                    onClick={() => onDelete(d)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DamageItemPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (code: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = activeDamageItems.find((d) => d.code === value) ?? null

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={rootRef} className="flex min-w-0 flex-1 flex-col gap-1">
      <button
        type="button"
        className={cn(smallPublicFieldClass, 'flex items-center justify-between gap-1 text-left')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
          {selected ? `${selected.name} (${selected.unit})` : '피해 항목 선택'}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="max-h-40 min-w-0 overflow-y-auto rounded border border-border bg-background py-0.5">
          <button
            type="button"
            className="flex w-full px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted/60"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
          >
            피해 항목 선택
          </button>
          {DAMAGE_GROUPS.map((g) => {
            const items = activeDamageItems.filter((d) => d.group === g.code)
            if (items.length === 0) return null
            return (
              <div key={g.code}>
                <p className="sticky top-0 bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{g.name}</p>
                {items.map((d) => (
                  <button
                    key={d.code}
                    type="button"
                    className={cn(
                      'flex w-full px-2 py-1.5 text-left text-[11px] hover:bg-muted/60',
                      value === d.code ? 'bg-primary/10 text-foreground' : 'text-foreground/85'
                    )}
                    onClick={() => {
                      onChange(d.code)
                      setOpen(false)
                    }}
                  >
                    <span className="min-w-0 truncate">
                      {d.name} ({d.unit})
                    </span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function DamageFormFields({
  form,
  setForm,
}: {
  form: SmallPublicDamageEvent
  setForm: (next: SmallPublicDamageEvent) => void
}) {
  const formItem = DAMAGE_ITEMS.find((d) => d.code === form.itemCode)
  const formUnit = formItem?.unit ?? null
  return (
    <SmallPublicAttrTable
      entries={[
        {
          key: 'occurredOn',
          label: '발생일',
          value: (
            <input
              type="date"
              className={smallPublicFieldClass}
              value={form.occurredOn}
              onChange={(e) => setForm({ ...form, occurredOn: e.target.value })}
            />
          ),
        },
        {
          key: 'item',
          label: '항목',
          full: true,
          value: <DamageItemPicker value={form.itemCode} onChange={(itemCode) => setForm({ ...form, itemCode })} />,
        },
        {
          key: 'qty',
          label: '물량',
          value: (
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                type="number"
                min={0}
                step={1}
                className={cn(smallPublicFieldClass, 'min-w-0 flex-1')}
                value={form.qty ?? ''}
                onChange={(e) => setForm({ ...form, qty: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder={formUnit ? `${formUnit} 수` : '항목을 먼저 고르세요'}
              />
              {formUnit ? (
                <span className="shrink-0 rounded border border-border bg-background px-1.5 py-1 text-[11px] font-medium text-foreground">
                  {formUnit}
                </span>
              ) : null}
            </div>
          ),
        },
        {
          key: 'note',
          label: '비고',
          full: true,
          value: (
            <input
              type="text"
              className={smallPublicFieldClass}
              value={form.note ?? ''}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="선택"
            />
          ),
        },
      ]}
    />
  )
}

function blankDamage(): SmallPublicDamageEvent {
  return {
    id: `de-${Date.now()}`,
    occurredOn: '',
    itemCode: null,
    qty: null,
    overrideSupportIndex: null,
    note: '',
  }
}

function validateDamage(draft: SmallPublicDamageEvent): string | null {
  if (!draft.occurredOn) return '발생일을 넣으세요.'
  if (!draft.itemCode) return '피해 항목을 고르세요.'
  if (draft.qty == null || !Number.isFinite(draft.qty)) return '물량을 넣으세요.'
  return null
}

function DamageEditModal({
  facility,
  initial,
  onClose,
  ...overlay
}: SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  initial: SmallPublicDamageEvent | null
  onClose: () => void
}) {
  const [draft, setDraft] = useState<SmallPublicDamageEvent>(() => (initial ? { ...initial } : blankDamage()))
  const [error, setError] = useState<string | null>(null)
  const isEdit = !!initial
  const save = () => {
    const msg = validateDamage(draft)
    if (msg) return setError(msg)
    smallPublicActions.saveDamageEvent(facility.id, draft)
    onClose()
  }
  return (
    <SmallPublicModalShell
      {...overlay}
      size="md"
      title={`${isEdit ? '피해 수정' : '피해 등록'} · ${facility.name}`}
      subtitle="발생일·피해 항목·물량을 입력합니다."
      onClose={onClose}
      footer={
        <div className="flex w-full items-center gap-2.5">
          {error ? <span className="mr-auto text-[11px] text-destructive">{error}</span> : <span className="mr-auto" />}
          {isEdit ? (
            <button
              type="button"
              className={smallPublicBtnDanger}
              onClick={() => {
                if (!window.confirm('이 피해이력을 삭제할까요?')) return
                smallPublicActions.deleteDamageEvent(facility.id, draft.id)
                onClose()
              }}
            >
              삭제
            </button>
          ) : null}
          <button type="button" className={smallPublicBtnPrimary} onClick={save}>
            저장
          </button>
          <button type="button" className={smallPublicBtnGhost} onClick={onClose}>
            취소
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <DamageFormFields form={draft} setForm={setDraft} />
      </div>
    </SmallPublicModalShell>
  )
}

function DamageTab({
  facility,
  overlay,
}: {
  facility: SmallPublicFacility
  overlay: SmallPublicModalOverlay
}) {
  const [editing, setEditing] = useState<SmallPublicDamageEvent | null | 'new'>(null)

  const rows = [...facility.damageEvents].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))

  return (
    <>
      <div className="mb-1.5 flex justify-end">
        <LayerRowPanelButton onClick={() => setEditing('new')}>
          <Plus className="h-3 w-3 shrink-0" aria-hidden />
          피해 등록
        </LayerRowPanelButton>
      </div>
      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
          피해이력이 없습니다.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[5px] border border-border">
          <table className="w-full table-fixed border-collapse text-left text-[11px] leading-snug">
            <colgroup>
              <col className="w-[5.5rem]" />
              <col />
              <col className="w-[4.5rem]" />
              <col className="w-[2.75rem]" />
            </colgroup>
            <thead className="bg-muted">
              <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-normal [&>th]:text-muted-foreground">
                <th>발생일</th>
                <th>피해 내용</th>
                <th className="text-right">물량</th>
                <th className="text-center">단위</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const item = DAMAGE_ITEMS.find((d) => d.code === e.itemCode)
                const open = editing !== 'new' && editing?.id === e.id
                return (
                  <tr
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditing({ ...e })}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        setEditing({ ...e })
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border last:border-b-0 transition-colors',
                      open ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                    )}
                  >
                    <td className="px-1.5 py-1 tabular-nums text-foreground/80">{e.occurredOn || '—'}</td>
                    <td className="truncate px-1.5 py-1 text-foreground/80" title={item?.name ?? e.note}>
                      {item?.name ?? e.note ?? '—'}
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums text-foreground/80">{e.qty ?? '—'}</td>
                    <td className="px-1.5 py-1 text-center text-foreground/80">{item?.unit ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing != null ? (
        <DamageEditModal
          facility={facility}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          {...overlay}
        />
      ) : null}
    </>
  )
}

export function SmallPublicCandidateDetailPanel({
  facility: f,
  inspections,
  candidateEvals,
  safetyDocs,
  onAddCandidateEval,
  onAddSafetyDoc,
  onEditCandidateEval,
  onEditSafetyDoc,
  onEdit,
  onDeleted,
  onClose,
  overlayLeftPx,
  overlayWidthPx,
}: Props) {
  const [attrsOpen, setAttrsOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('candidate')
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null)
  const [selectedSafetyId, setSelectedSafetyId] = useState<string | null>(null)
  const planInputRef = useRef<HTMLInputElement>(null)
  const preview = useSmallPublicFilePreview()
  const latest = inspections[0] ?? null

  const selectedEval =
    candidateEvals.find((e) => e.id === selectedEvalId) ?? candidateEvals[0] ?? null
  const selectedSafety =
    safetyDocs.find((d) => d.id === selectedSafetyId) ?? safetyDocs[0] ?? null
  const safetyFiles = selectedSafety?.files ?? []
  const selectedSafetyFile = safetyFiles[0] ?? null

  const remove = () => {
    if (!window.confirm(`«${f.name}»을 삭제할까요? 점검·후보지 평가 이력도 함께 지워집니다.`)) return
    smallPublicActions.deleteFacility(f.id)
    onDeleted()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'candidate', label: '후보지 평가' },
    { id: 'safety', label: '안전점검' },
    { id: 'damage', label: '피해이력' },
    { id: 'files', label: '첨부파일' },
  ]

  const otherFiles = f.planFiles.filter((p) => p.kind === 'other' || !p.kind)
  const listPreviewLayout = tab === 'candidate' || tab === 'safety'

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <SmallPublicPanelHeader
        title={f.name}
        onClose={onClose}
        badge={
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground/80">
            {f.type}
          </span>
        }
      />

      <section className="shrink-0 border-b border-border">
        <button
          type="button"
          onClick={() => setAttrsOpen((o) => !o)}
          className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs font-semibold text-foreground/90"
        >
          {attrsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          속성정보
        </button>
        {attrsOpen ? (
          <div className="max-h-[40vh] overflow-y-auto px-3 pb-2.5 scrollbar-hide">
            <SmallPublicAttrTable entries={smallPublicFacilityAttrEntries(f, latest)} />
          </div>
        ) : null}
      </section>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-3 pt-2" role="tablist" aria-label="이력·첨부파일">
          <div className="flex gap-0.5 overflow-x-auto rounded-lg bg-muted p-1 scrollbar-hide">
            {tabs.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'h-7 flex-auto shrink-0 whitespace-nowrap rounded px-2 text-center text-[11px] transition-colors',
                    active
                      ? 'bg-background text-primary shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {listPreviewLayout ? (
          <div className="flex min-h-0 flex-1 flex-col px-3 py-2 text-xs">
            {tab === 'candidate' ? (
              <>
                <div className="mb-1.5 flex shrink-0 justify-end">
                  <LayerRowPanelButton onClick={onAddCandidateEval}>
                    <Plus className="h-3 w-3 shrink-0" aria-hidden />
                    평가 등록
                  </LayerRowPanelButton>
                </div>
                <div className="max-h-[42%] shrink-0 overflow-y-auto scrollbar-hide">
                  <CandidateEvalList
                    rows={candidateEvals}
                    selectedId={selectedEval?.id ?? null}
                    onSelect={(ev) => setSelectedEvalId(ev.id)}
                    onEdit={onEditCandidateEval}
                    onDelete={(ev) => {
                      if (!window.confirm(`«${ev.date}» 후보지 평가를 삭제할까요?`)) return
                      smallPublicActions.deleteCandidateEval(ev.id)
                      if (selectedEvalId === ev.id) setSelectedEvalId(null)
                    }}
                  />
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                  <SmallPublicInlineFilePreview
                    file={selectedEval?.file}
                    emptyText="목록에서 평가를 선택하면 아래에 미리보기가 나타납니다."
                    onOpenFull={
                      selectedEval?.file
                        ? (page) =>
                            preview.open(
                              selectedEval.file!,
                              candidateEvals.map((x) => x.file).filter((x): x is SmallPublicFile => !!x),
                              { page }
                            )
                        : undefined
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="mb-1.5 flex shrink-0 justify-end">
                  <LayerRowPanelButton onClick={onAddSafetyDoc}>
                    <Plus className="h-3 w-3 shrink-0" aria-hidden />
                    안전점검 등록
                  </LayerRowPanelButton>
                </div>
                <div className="max-h-[42%] shrink-0 overflow-y-auto scrollbar-hide">
                  <SafetyDocList
                    rows={safetyDocs}
                    selectedId={selectedSafety?.id ?? null}
                    onSelect={(d) => setSelectedSafetyId(d.id)}
                    onEdit={onEditSafetyDoc}
                    onDelete={(d) => {
                      if (!window.confirm(`«${d.date}» 안전점검을 삭제할까요?`)) return
                      smallPublicActions.deleteSafetyDoc(d.id)
                      if (selectedSafetyId === d.id) setSelectedSafetyId(null)
                    }}
                  />
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                  <SmallPublicInlineFilePreview
                    file={selectedSafetyFile}
                    emptyText="목록에서 안전점검을 선택하면 아래에 미리보기가 나타납니다."
                    onOpenFull={
                      selectedSafetyFile
                        ? (page) =>
                            preview.open(
                              selectedSafetyFile,
                              safetyFiles.length > 0 ? safetyFiles : [selectedSafetyFile],
                              { page }
                            )
                        : undefined
                    }
                  />
                </div>
              </>
            )}
          </div>
        ) : (
          <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
            {tab === 'damage' ? (
              <DamageTab facility={f} overlay={{ overlayLeftPx, overlayWidthPx }} />
            ) : (
              <>
                <div className="mb-1.5 flex justify-end">
                  <button type="button" className={smallPublicBtnPrimary} onClick={() => planInputRef.current?.click()}>
                    <Paperclip className="h-3 w-3" />
                    첨부
                  </button>
                </div>
                {otherFiles.length === 0 ? (
                  <p className="py-6 text-center text-[11px] text-muted-foreground">첨부파일이 없습니다.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {otherFiles.map((p) => (
                      <SmallPublicFileRow
                        key={p.id}
                        file={p}
                        facilityName={f.name}
                        onPreview={() => preview.open(p, otherFiles)}
                        onDownload={() => preview.download(p)}
                        onRemove={() => {
                          if (window.confirm(`«${p.name}»을 삭제할까요?`)) smallPublicActions.removePlanFile(f.id, p.id)
                        }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
            <input
              ref={planInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length > 0) smallPublicActions.addPlanFiles(f.id, files.map((x) => smallPublicFileFromUpload(x, 'other')))
                e.target.value = ''
              }}
            />
          </MapSideDetailScroll>
        )}
      </div>

      <SmallPublicCrudBar onEdit={onEdit} onDelete={remove} />
      {preview.element}
    </div>
  )
}
