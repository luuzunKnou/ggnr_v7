'use client'

import { useEffect, useMemo, useState } from 'react'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { SMALL_PUBLIC_CLASS_COLOR, type SmallPublicFacType } from '../smallPublicConfig'
import type {
  SmallPublicCandidateEval,
  SmallPublicFacility,
  SmallPublicInspection,
  SmallPublicSafetyDoc,
} from '../smallPublicMock'
import {
  candidateEvalsOfFacility,
  inspectionsOfFacility,
  latestInspectionOf,
  safetyDocsOfFacility,
  smallPublicActions,
  useSmallPublicStore,
} from '../smallPublicStore'
import { useSmallPublicFacilityLayer } from '../useSmallPublicFacilityLayer'
import { SmallPublicInspectionFormModal } from '../inspection/SmallPublicInspectionForm'
import { SmallPublicInspectionViewModal } from '../inspection/SmallPublicInspectionModal'
import { SmallPublicCandidateDetailPanel } from './SmallPublicCandidateDetailPanel'
import { SmallPublicCandidateEvalFormModal } from './SmallPublicCandidateEvalFormModal'
import { SmallPublicClassEvalFormModal } from './SmallPublicClassEvalFormModal'
import { SmallPublicClassEvalModal } from './SmallPublicClassEvalModal'
import { SmallPublicCandidateForm } from './SmallPublicCandidateForm'
import { SmallPublicCandidateListPanel, type SmallPublicCandidateFilter } from './SmallPublicCandidateListPanel'
import { SmallPublicSafetyDocFormModal } from './SmallPublicSafetyDocFormModal'

const LIST_DEFAULT_WIDTH = 440
const LIST_MIN_WIDTH = 380
const LIST_MAX_WIDTH = 640
const DETAIL_DEFAULT_WIDTH = 440
const DETAIL_MIN_WIDTH = 380
const DETAIL_MAX_WIDTH = 680

/** 후보지 등록 중 지도에 미리 보여 주는 위치 */
const DRAFT_FACILITY_ID = '__draft__'

type FacilityDraft = { coords: SmallPublicFacility['coords']; type: SmallPublicFacType; picking: boolean }

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

function classColor(f: SmallPublicFacility): string {
  return f.id === DRAFT_FACILITY_ID ? SMALL_PUBLIC_CLASS_COLOR.제외 : SMALL_PUBLIC_CLASS_COLOR[f.candidate]
}

export function SmallPublicCandidateShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const { facilities, inspections, candidateEvals, safetyDocs } = useSmallPublicStore()
  const [listWidth, setListWidth] = useState(LIST_DEFAULT_WIDTH)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [viewInspectionId, setViewInspectionId] = useState<string | null>(null)
  const [classEvalId, setClassEvalId] = useState<string | null>(null)
  /** 후보지 평가 등록·수정 */
  const [candidateEvalForm, setCandidateEvalForm] = useState<SmallPublicCandidateEval | null | 'new'>(null)
  /** 안전점검 등록·수정 */
  const [safetyDocForm, setSafetyDocForm] = useState<SmallPublicSafetyDoc | null | 'new'>(null)
  /** 일반·관리 평가 등록·수정(그해 점검이 있으면 그 기록) */
  const [classEvalForm, setClassEvalForm] = useState<SmallPublicInspection | null | 'new'>(null)
  /** 위험도 평가 수정 */
  const [riskEvalForm, setRiskEvalForm] = useState<SmallPublicInspection | null>(null)
  /** «후보지 등록» — 상세 자리에 등록 칸 */
  const [creating, setCreating] = useState(false)
  /** «수정» — 상세 자리에 수정 칸(detailId 유지) */
  const [editing, setEditing] = useState(false)
  const [facilityDraft, setFacilityDraft] = useState<FacilityDraft | null>(null)
  const [filter, setFilter] = useState<SmallPublicCandidateFilter>({
    type: '',
    candidate: '',
    emd: '',
    keyword: '',
  })

  const formOpen = creating || editing
  const selected = detailId ? (facilities.find((f) => f.id === detailId) ?? null) : null
  const detail = !formOpen ? selected : null
  const total = listWidth + (formOpen || selected ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const ofType = useMemo(
    () => (filter.type ? facilities.filter((f) => f.type === filter.type) : facilities),
    [facilities, filter.type]
  )

  const emdOptions = useMemo(
    () => [...new Set(facilities.map((f) => f.emd))].sort((a, b) => a.localeCompare(b, 'ko')),
    [facilities]
  )

  const rows = useMemo(() => {
    const q = filter.keyword.trim().toLowerCase()
    return ofType
      .filter((f) => !filter.candidate || f.candidate === filter.candidate)
      .filter((f) => !filter.emd || f.emd === filter.emd)
      .filter((f) => !q || [f.name, f.mngNo, f.ri, f.emd].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [ofType, filter])

  /** 등록·수정 중 위치를 찍었으면 지도에 함께(선택 강조로) 보여 줌 */
  const layerFacilities = useMemo(() => {
    if (!facilityDraft?.coords) return rows
    if (creating) {
      const draft = { id: DRAFT_FACILITY_ID, type: facilityDraft.type, coords: facilityDraft.coords } as SmallPublicFacility
      return [...rows, draft]
    }
    if (editing && detailId) {
      return rows.map((f) =>
        f.id === detailId ? ({ ...f, type: facilityDraft.type, coords: facilityDraft.coords } as SmallPublicFacility) : f
      )
    }
    return rows
  }, [rows, creating, editing, detailId, facilityDraft])

  const { fitTo } = useSmallPublicFacilityLayer({
    facilities: layerFacilities,
    colorOf: classColor,
    selectedId: creating ? DRAFT_FACILITY_ID : detailId,
    pickEnabled: !formOpen,
    onSelect: (id) => setDetailId(id),
  })

  const select = (id: string) => {
    setCreating(false)
    setEditing(false)
    setFacilityDraft(null)
    setDetailId(id)
    const f = facilities.find((x) => x.id === id)
    if (f) fitTo([f])
  }

  const closeForm = () => {
    setCreating(false)
    setEditing(false)
    setFacilityDraft(null)
  }

  const detailInspections = detail ? inspectionsOfFacility(inspections, detail.id) : []
  const viewInspection = viewInspectionId ? (inspections.find((i) => i.id === viewInspectionId) ?? null) : null
  const classEvalInspection = classEvalId ? (inspections.find((i) => i.id === classEvalId) ?? null) : null

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={LIST_MIN_WIDTH}
          maxWidth={LIST_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
        >
          <SmallPublicCandidateListPanel
            filter={filter}
            onFilterChange={(patch) => setFilter((prev) => ({ ...prev, ...patch }))}
            emdOptions={emdOptions}
            rows={rows}
            latestOf={(id) => latestInspectionOf(inspections, id)}
            selectedId={formOpen ? null : detailId}
            onSelect={select}
            onRegister={() => {
              setEditing(false)
              setCreating(true)
              setFacilityDraft(null)
            }}
            onClose={onClose}
          />
        </MapSideListPanel>
      </div>
      {formOpen || detail ? (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={detailWidth}
            minWidth={DETAIL_MIN_WIDTH}
            maxWidth={DETAIL_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            {creating ? (
              <SmallPublicCandidateForm
                initialType={filter.type || '세천'}
                onDraftChange={setFacilityDraft}
                onCancel={closeForm}
                onSaved={(f) => {
                  closeForm()
                  setFilter({ type: f.type, candidate: '', emd: '', keyword: '' })
                  setDetailId(f.id)
                  fitTo([f])
                }}
              />
            ) : editing && selected ? (
              <SmallPublicCandidateForm
                key={selected.id}
                initial={selected}
                initialType={selected.type}
                onDraftChange={setFacilityDraft}
                onCancel={closeForm}
                onSaved={(f) => {
                  closeForm()
                  setFilter((prev) => ({ ...prev, type: prev.type && prev.type !== f.type ? f.type : prev.type }))
                  setDetailId(f.id)
                  fitTo([f])
                }}
              />
            ) : detail ? (
              <SmallPublicCandidateDetailPanel
                facility={detail}
                inspections={detailInspections}
                candidateEvals={candidateEvalsOfFacility(candidateEvals, detail.id)}
                safetyDocs={safetyDocsOfFacility(safetyDocs, detail.id)}
                overlayLeftPx={leftOffsetPx}
                overlayWidthPx={total}
                onAddCandidateEval={() => setCandidateEvalForm('new')}
                onAddSafetyDoc={() => setSafetyDocForm('new')}
                onEditCandidateEval={(ev) => setCandidateEvalForm(ev)}
                onEditSafetyDoc={(doc) => setSafetyDocForm(doc)}
                onEdit={() => {
                  setCreating(false)
                  setEditing(true)
                  setFacilityDraft(null)
                }}
                onDeleted={() => setDetailId(null)}
                onClose={() => setDetailId(null)}
              />
            ) : null}
          </MapSideListPanel>
        </div>
      ) : null}
      {viewInspection && detail && !riskEvalForm ? (
        <SmallPublicInspectionViewModal
          inspection={viewInspection}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onEdit={() => {
            setViewInspectionId(null)
            setRiskEvalForm(viewInspection)
          }}
          onDelete={() => {
            if (!window.confirm(`«${viewInspection.date}» 위험도 평가를 삭제할까요? 같은 기록의 일반·관리 평가도 함께 지워집니다.`)) return
            smallPublicActions.deleteInspection(viewInspection.id)
            setViewInspectionId(null)
          }}
          onClose={() => setViewInspectionId(null)}
        />
      ) : null}
      {classEvalInspection && detail && classEvalForm == null ? (
        <SmallPublicClassEvalModal
          key={classEvalInspection.id}
          inspection={classEvalInspection}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onEdit={() => {
            setClassEvalId(null)
            setClassEvalForm(classEvalInspection)
          }}
          onDelete={() => {
            if (
              !window.confirm(
                `«${classEvalInspection.date.slice(0, 4)}년» 일반·관리 평가를 삭제할까요? 같은 날 위험도 평가 기록도 함께 지워집니다.`
              )
            )
              return
            smallPublicActions.deleteInspection(classEvalInspection.id)
            setClassEvalId(null)
          }}
          onClose={() => setClassEvalId(null)}
        />
      ) : null}
      {candidateEvalForm != null && detail ? (
        <SmallPublicCandidateEvalFormModal
          key={candidateEvalForm === 'new' ? 'new' : candidateEvalForm.id}
          facility={detail}
          initial={candidateEvalForm === 'new' ? null : candidateEvalForm}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onCancel={() => setCandidateEvalForm(null)}
          onSaved={() => setCandidateEvalForm(null)}
        />
      ) : null}
      {safetyDocForm != null && detail ? (
        <SmallPublicSafetyDocFormModal
          key={safetyDocForm === 'new' ? 'new' : safetyDocForm.id}
          facility={detail}
          initial={safetyDocForm === 'new' ? null : safetyDocForm}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onCancel={() => setSafetyDocForm(null)}
          onSaved={() => setSafetyDocForm(null)}
        />
      ) : null}
      {classEvalForm != null && detail ? (
        <SmallPublicClassEvalFormModal
          key={classEvalForm === 'new' ? 'new' : classEvalForm.id}
          facility={detail}
          initial={classEvalForm === 'new' ? null : classEvalForm}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onCancel={() => setClassEvalForm(null)}
          onSaved={() => setClassEvalForm(null)}
        />
      ) : null}
      {riskEvalForm && detail ? (
        <SmallPublicInspectionFormModal
          key={riskEvalForm.id}
          facility={detail}
          initial={riskEvalForm}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onCancel={() => setRiskEvalForm(null)}
          onSaved={() => setRiskEvalForm(null)}
        />
      ) : null}
    </>
  )
}
