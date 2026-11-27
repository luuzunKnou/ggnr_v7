'use client'

import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideDetailScroll } from '../../../_mapComponents/MapSideDetailScroll'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { smallPublicBtnPrimary } from '../smallPublicConfig'
import type {
  SmallPublicCandidateEval,
  SmallPublicFacility,
  SmallPublicFile,
  SmallPublicInspection,
} from '../smallPublicMock'
import { smallPublicInspectionFiles } from '../smallPublicMock'
import { SmallPublicInspectionPeekModal } from './SmallPublicInspectionPeekModal'
import { deleteSmallPublicFile, uploadSmallPublicFiles } from '../smallPublicAttachmentApi'
import { smallPublicActions, useSmallPublicStore } from '../smallPublicStore'
import {
  SmallPublicAttrTable,
  SmallPublicCandidateResultBadge,
  SmallPublicClassBadge,
  SmallPublicCrudBar,
  SmallPublicFileRow,
  SmallPublicGradeBadge,
  SmallPublicInlineFilePreview,
  SmallPublicPanelHeader,
  smallPublicFacilityAttrEntries,
  smallPublicSelectedRowClass,
  useSmallPublicFilePreview,
} from '../smallPublicUi'
import type { SmallPublicModalOverlay } from '../inspection/SmallPublicInspectionModal'

type Tab = 'candidate' | 'safety' | 'annex' | 'files'

type Props = SmallPublicModalOverlay & {
  facility: SmallPublicFacility
  inspections: SmallPublicInspection[]
  candidateEvals: SmallPublicCandidateEval[]
  /** defineLayer show_detail — 등급 필드는 제외(점검만) */
  defineDetailFields?: Array<{ define_field_name?: string; define_field_kor_name?: string }>
  /** 부속시설물 목록에서 지도 강조 중인 id */
  annexLocateId?: string | null
  onLocateAnnex?: (f: SmallPublicFacility) => void
  onAddCandidateEval: () => void
  onEditCandidateEval: (ev: SmallPublicCandidateEval) => void
  onEdit: () => void
  onDeleted: () => void
  onClose: () => void
}

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
                <td className="px-1.5 py-1 tabular-nums text-foreground/80">{e.date || '—'}</td>
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

/** 부서업무 안전점검에서 쌓인 연도별 결과 — 조회만 */
function InspectionYearList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: SmallPublicInspection[]
  selectedId: string | null
  /** 선택하면 아래 미리보기와 점검 결과 작은 창(조회 전용)이 함께 나온다 */
  onSelect: (row: SmallPublicInspection) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
        안전점검 이력이 없습니다. 부서업무 «안전점검»에서 등록합니다.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      <table className="w-full table-fixed border-collapse text-left text-[11px] leading-snug">
        <colgroup>
          <col className="w-[5.75rem]" />
          <col />
          <col className="w-[3.5rem]" />
          <col className="w-[4rem]" />
        </colgroup>
        <thead className="bg-muted">
          <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-normal [&>th]:text-muted-foreground">
            <th>점검일</th>
            <th>점검자</th>
            <th className="pr-3 text-center">등급</th>
            <th className="pr-3 text-center">구분</th>
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
                <td className="truncate px-1.5 py-1 text-foreground/80" title={d.inspector}>
                  {d.inspector || '—'}
                </td>
                <td className="px-1.5 py-1 pr-3 text-center">
                  <SmallPublicGradeBadge grade={d.grade} />
                </td>
                <td className="px-1.5 py-1 pr-3 text-center">
                  <SmallPublicClassBadge candidate={d.classResult} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AnnexTab({
  facility,
  locateId,
  onLocate,
}: {
  facility: SmallPublicFacility
  locateId?: string | null
  onLocate?: (f: SmallPublicFacility) => void
}) {
  const { relatedByFacilityId, facilities } = useSmallPublicStore()
  const related = (relatedByFacilityId[facility.id] ?? [])
    .map((r) => facilities.find((f) => f.id === r.id) ?? r)
    .sort((a, b) => {
      const t = a.type.localeCompare(b.type, 'ko')
      return t !== 0 ? t : a.name.localeCompare(b.name, 'ko')
    })
  const relationLabel = facility.type === '세천' ? '부속' : '상위'
  const emptyHint =
    facility.type === '세천'
      ? '연결된 소교량·낙차공이 없습니다.'
      : facility.type === '소교량' || facility.type === '낙차공'
        ? '연결된 세천이 없습니다.'
        : '부속시설물이 없습니다.'

  if (related.length === 0) {
    return (
      <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
        {emptyHint}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[5px] border border-border">
      <table className="w-full table-fixed border-collapse text-left text-[11px] leading-snug">
        <colgroup>
          <col />
          <col className="w-[4.5rem]" />
          <col className="w-[5rem]" />
          <col className="w-[3.5rem]" />
        </colgroup>
        <thead className="bg-muted">
          <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-normal [&>th]:text-muted-foreground">
            <th>시설명</th>
            <th>유형</th>
            <th>위치</th>
            <th className="text-center">관계</th>
          </tr>
        </thead>
        <tbody>
          {related.map((c) => {
            const active = locateId === c.id
            const canLocate = Boolean(c.coords && onLocate)
            return (
              <tr
                key={c.id}
                className={cn(
                  'border-b border-border last:border-b-0',
                  canLocate && 'cursor-pointer hover:bg-muted/60',
                  active && smallPublicSelectedRowClass
                )}
                title={canLocate ? '지도에서 위치 보기' : c.coords ? undefined : '좌표 없음'}
                onClick={() => {
                  if (canLocate) onLocate?.(c)
                }}
              >
                <td className="truncate px-1.5 py-1 text-foreground/80" title={c.name}>
                  {c.name}
                </td>
                <td className="px-1.5 py-1 text-foreground/80">{c.type}</td>
                <td className="truncate px-1.5 py-1 text-foreground/80" title={`${c.emd} ${c.ri}`}>
                  {c.emd} {c.ri}
                </td>
                <td className="px-1.5 py-1 text-center text-foreground/80">{relationLabel}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SmallPublicCandidateDetailPanel({
  facility: f,
  inspections,
  candidateEvals,
  defineDetailFields,
  annexLocateId = null,
  onLocateAnnex,
  overlayLeftPx,
  overlayWidthPx,
  onAddCandidateEval,
  onEditCandidateEval,
  onEdit,
  onDeleted,
  onClose,
}: Props) {
  const [attrsOpen, setAttrsOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('candidate')
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [selectedInspId, setSelectedInspId] = useState<string | null>(null)
  const [viewInspId, setViewInspId] = useState<string | null>(null)
  const planInputRef = useRef<HTMLInputElement>(null)
  const preview = useSmallPublicFilePreview()
  const latest = inspections[0] ?? null

  const selectedEval = candidateEvals.find((e) => e.id === selectedEvalId) ?? candidateEvals[0] ?? null
  const selectedInsp = inspections.find((d) => d.id === selectedInspId) ?? inspections[0] ?? null
  const viewInsp = viewInspId ? (inspections.find((d) => d.id === viewInspId) ?? null) : null
  /** 미리보기 — 위험도 평가를 먼저, 없으면 첫 첨부 */
  const inspFiles = smallPublicInspectionFiles(selectedInsp)
  const inspPreviewFile = selectedInsp?.file ?? inspFiles[0] ?? null

  const remove = () => {
    if (!window.confirm(`«${f.name}»을 삭제할까요? 점검·후보지 평가 이력도 함께 지워집니다.`)) return
    void smallPublicActions.deleteFacility(f.id).then((res) => {
      if (!res.success) {
        window.alert(res.error)
        return
      }
      onDeleted()
    })
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'candidate', label: '후보지 평가' },
    { id: 'safety', label: '안전점검' },
    { id: 'annex', label: '부속시설물' },
    { id: 'files', label: '첨부파일' },
  ]

  const otherFiles = f.planFiles.filter((p) => p.kind === 'other' || !p.kind)
  const selectedFile = otherFiles.find((p) => p.id === selectedFileId) ?? otherFiles[0] ?? null
  const listPreviewLayout = tab === 'candidate' || tab === 'safety' || tab === 'files'
  /** 관리번호 없으면 첨부·후보지평가 폴더/이력 매핑 불가 */
  const hasConsCode = Boolean(String(f.mngNo ?? '').trim()) && !String(f.mngNo).startsWith('excl:')

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
            <SmallPublicAttrTable
              entries={smallPublicFacilityAttrEntries(f, latest, undefined, defineDetailFields)}
            />
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
              !hasConsCode ? (
                <p className="py-10 text-center text-[12px] leading-relaxed text-muted-foreground">
                  관리번호가 없어 후보지 평가를 매핑할 수 없습니다.
                  <br />
                  <span className="text-[11px]">없음</span>
                </p>
              ) : (
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
                        if (!window.confirm(`«${ev.date || '첨부 기준'}» 후보지 평가를 삭제할까요? 그 연도의 후보지 첨부도 함께 삭제됩니다.`)) return
                        void (async () => {
                          /** 평가 이력이 없는 첨부 전용 건은 파일만 지운다 */
                          if (!/^\d+$/.test(ev.id) && ev.file) {
                            try {
                              await deleteSmallPublicFile(String(f.mngNo ?? ''), ev.file)
                            } catch (e) {
                              window.alert(e instanceof Error ? e.message : '첨부 삭제에 실패했습니다.')
                              return
                            }
                          }
                          const r = await smallPublicActions.deleteCandidateEval(ev.id)
                          if (!r.success) return window.alert(r.error)
                          if (selectedEvalId === ev.id) setSelectedEvalId(null)
                        })()
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
              )
            ) : tab === 'safety' ? (
              <>
                <div className="max-h-[42%] shrink-0 overflow-y-auto scrollbar-hide">
                  <InspectionYearList
                    rows={inspections}
                    selectedId={selectedInsp?.id ?? null}
                    onSelect={(d) => {
                      setSelectedInspId(d.id)
                      setViewInspId(d.id)
                    }}
                  />
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                  <SmallPublicInlineFilePreview
                    file={inspPreviewFile}
                    emptyText="목록에서 점검을 선택하면 아래에 미리보기가 나타납니다."
                    onOpenFull={
                      inspPreviewFile
                        ? (page) => preview.open(inspPreviewFile, inspFiles, { page })
                        : undefined
                    }
                  />
                </div>
              </>
            ) : !hasConsCode ? (
              <p className="py-10 text-center text-[12px] leading-relaxed text-muted-foreground">
                관리번호가 없어 첨부파일을 매핑할 수 없습니다.
                <br />
                <span className="text-[11px]">없음</span>
              </p>
            ) : (
              <>
                <div className="mb-1.5 flex shrink-0 justify-end">
                  <button type="button" className={smallPublicBtnPrimary} onClick={() => planInputRef.current?.click()}>
                    <Paperclip className="h-3 w-3" />
                    첨부
                  </button>
                </div>
                <div className="max-h-[42%] shrink-0 overflow-y-auto scrollbar-hide">
                  {otherFiles.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-muted-foreground">첨부파일이 없습니다.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {otherFiles.map((p) => (
                        <div
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedFileId(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedFileId(p.id)
                            }
                          }}
                          className={cn(
                            'rounded border transition-colors',
                            selectedFile?.id === p.id ? 'border-primary/40 bg-primary/5' : 'border-transparent'
                          )}
                        >
                          <SmallPublicFileRow
                            file={p}
                            facilityName={f.name}
                            onSelect={() => setSelectedFileId(p.id)}
                            onPreview={() => {
                              setSelectedFileId(p.id)
                              preview.open(p, otherFiles)
                            }}
                            onDownload={() => preview.download(p)}
                            onRemove={() => {
                              if (!window.confirm(`«${p.name}»을 삭제할까요?`)) return
                              void deleteSmallPublicFile(String(f.mngNo ?? ''), p)
                                .then(() => smallPublicActions.removePlanFile(f.id, p.id))
                                .catch((e: unknown) => window.alert(e instanceof Error ? e.message : '첨부 삭제에 실패했습니다.'))
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                  <SmallPublicInlineFilePreview
                    file={selectedFile}
                    emptyText="목록에서 첨부를 선택하면 아래에 미리보기가 나타납니다."
                  />
                </div>
                <input
                  ref={planInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    /** 시설 공통 첨부 — 관리번호 폴더 바로 아래에 저장 */
                    if (files.length > 0)
                      void uploadSmallPublicFiles({ mngNo: String(f.mngNo ?? ''), scope: 'common', year: '', files, kind: 'other' })
                        .then((up) => smallPublicActions.addPlanFiles(f.id, up))
                        .catch((err: unknown) => window.alert(err instanceof Error ? err.message : '첨부 업로드에 실패했습니다.'))
                    e.target.value = ''
                  }}
                />
              </>
            )}
          </div>
        ) : (
          <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
            <AnnexTab facility={f} locateId={annexLocateId} onLocate={onLocateAnnex} />
          </MapSideDetailScroll>
        )}
      </div>

      <SmallPublicCrudBar onEdit={onEdit} onDelete={remove} />
      {viewInsp ? (
        <SmallPublicInspectionPeekModal
          facility={f}
          inspection={viewInsp}
          overlayLeftPx={overlayLeftPx}
          overlayWidthPx={overlayWidthPx}
          onClose={() => setViewInspId(null)}
        />
      ) : null}
      {preview.element}
    </div>
  )
}
