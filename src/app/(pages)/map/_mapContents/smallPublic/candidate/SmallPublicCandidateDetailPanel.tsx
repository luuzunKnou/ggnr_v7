'use client'

import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Paperclip, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll'
import {
  SMALL_PUBLIC_CANDIDATES,
  smallPublicBtnGhost,
  smallPublicBtnPrimary,
  smallPublicFieldClass,
  type SmallPublicCandidate,
} from '../smallPublicConfig'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'
import { smallPublicActions, smallPublicFileFromUpload } from '../smallPublicStore'
import {
  SmallPublicAttrTable,
  SmallPublicFileRow,
  SmallPublicInspectionTable,
  SmallPublicPanelHeader,
  smallPublicFacilityAttrEntries,
  useSmallPublicFilePreview,
  type SmallPublicAttrKey,
} from '../smallPublicUi'

/** 직접 고칠 수 있는 항목 — 관리번호·유형과, 최근 점검으로 정해지는 위험도등급·점수·현장조사일자·현장조사자는 제외 */
const EDITABLE_TEXT_KEYS = [
  'name',
  'geomCode',
  'emd',
  'ri',
  'address',
  'startXy',
  'endXy',
  'benefitArea',
  'riskDate',
  'length',
  'width',
  'height',
] as const satisfies readonly SmallPublicAttrKey[]

type Draft = Pick<SmallPublicFacility, (typeof EDITABLE_TEXT_KEYS)[number] | 'candidate'>

function toDraft(f: SmallPublicFacility): Draft {
  const d = { candidate: f.candidate } as Draft
  for (const k of EDITABLE_TEXT_KEYS) d[k] = f[k]
  return d
}

type Props = {
  facility: SmallPublicFacility
  inspections: SmallPublicInspection[]
  onOpenInspection: (inspectionId: string) => void
  onClose: () => void
}

export function SmallPublicCandidateDetailPanel({ facility: f, inspections, onOpenInspection, onClose }: Props) {
  const [attrsOpen, setAttrsOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => toDraft(f))
  const [tab, setTab] = useState<'history' | 'plan'>('history')
  const [shownId, setShownId] = useState(f.id)
  const planInputRef = useRef<HTMLInputElement>(null)
  const preview = useSmallPublicFilePreview()
  const latest = inspections[0] ?? null

  if (shownId !== f.id) {
    setShownId(f.id)
    setEditing(false)
    setDraft(toDraft(f))
  }

  const editFields: Partial<Record<SmallPublicAttrKey, ReactNode>> = {}
  if (editing) {
    for (const k of EDITABLE_TEXT_KEYS) {
      editFields[k] = (
        <input
          className={smallPublicFieldClass}
          value={draft[k]}
          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
        />
      )
    }
    editFields.candidate = (
      <select
        className={smallPublicFieldClass}
        value={draft.candidate}
        onChange={(e) => setDraft((d) => ({ ...d, candidate: e.target.value as SmallPublicCandidate }))}
      >
        {SMALL_PUBLIC_CANDIDATES.map((c) => (
          <option key={c} value={c}>
            {c === '제외' ? '제외' : `${c}시설`}
          </option>
        ))}
      </select>
    )
  }

  const save = () => {
    if (!draft.name.trim()) {
      window.alert('시설명을 넣으세요.')
      return
    }
    smallPublicActions.updateFacility(f.id, { ...draft, name: draft.name.trim() })
    setEditing(false)
  }

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
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setAttrsOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-foreground/90"
          >
            {attrsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            속성정보
          </button>
          {attrsOpen ? (
            editing ? (
              <>
                <button
                  type="button"
                  className={smallPublicBtnGhost}
                  onClick={() => {
                    setEditing(false)
                    setDraft(toDraft(f))
                  }}
                >
                  취소
                </button>
                <button type="button" className={smallPublicBtnPrimary} onClick={save}>
                  저장
                </button>
              </>
            ) : (
              <button type="button" className={smallPublicBtnGhost} onClick={() => setEditing(true)}>
                <Pencil className="h-3 w-3" />
                수정
              </button>
            )
          ) : null}
        </div>
        {attrsOpen ? (
          <div className="max-h-[48vh] overflow-y-auto px-3 pb-2.5 scrollbar-hide">
            <SmallPublicAttrTable entries={smallPublicFacilityAttrEntries(f, latest, editFields)} />
          </div>
        ) : null}
      </section>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-2 pt-1.5"
          role="tablist"
          aria-label="위험도평가 이력·첨부파일"
        >
          <div className="flex min-w-0 flex-1 items-stretch gap-0.5 self-stretch">
            {(
              [
                { id: 'history', label: `위험도평가 이력 (${inspections.length})` },
                { id: 'plan', label: `첨부파일 (${f.planFiles.length})` },
              ] as const
            ).map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'relative flex shrink-0 items-center px-2.5 pb-1.5 text-[11px] font-medium transition-colors',
                    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                  {active ? <span className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-primary" /> : null}
                </button>
              )
            })}
          </div>
          {tab === 'plan' ? (
            <button
              type="button"
              className={cn(smallPublicBtnPrimary, 'mb-1 mr-1')}
              onClick={() => planInputRef.current?.click()}
            >
              <Paperclip className="h-3 w-3" />
              첨부
            </button>
          ) : null}
          <input
            ref={planInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) smallPublicActions.addPlanFiles(f.id, files.map(smallPublicFileFromUpload))
              e.target.value = ''
            }}
          />
        </div>

        <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
          {tab === 'history' ? (
            <SmallPublicInspectionTable
              rows={inspections}
              onRowClick={onOpenInspection}
              emptyText="위험도평가 이력이 없습니다."
            />
          ) : f.planFiles.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              첨부파일이 없습니다. 정비계획·조사 자료를 «첨부»로 올리세요.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {f.planFiles.map((p) => (
                <SmallPublicFileRow
                  key={p.id}
                  file={p}
                  onPreview={() => preview.open(p, f.planFiles)}
                  onDownload={() => preview.download(p)}
                  onRemove={() => {
                    if (window.confirm(`«${p.name}»을 삭제할까요?`)) smallPublicActions.removePlanFile(f.id, p.id)
                  }}
                />
              ))}
            </div>
          )}
        </MapSideDetailScroll>
      </div>
      {preview.element}
    </div>
  )
}
