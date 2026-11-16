'use client'

import { useEffect, useMemo, useState } from 'react'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { SMALL_PUBLIC_CLASS_COLOR, type SmallPublicFacType } from '../smallPublicConfig'
import type { SmallPublicFacility } from '../smallPublicMock'
import { inspectionsOfFacility, latestInspectionOf, useSmallPublicStore } from '../smallPublicStore'
import { useSmallPublicFacilityLayer } from '../useSmallPublicFacilityLayer'
import { SmallPublicInspectionViewModal } from '../inspection/SmallPublicInspectionModal'
import { SmallPublicCandidateDetailPanel } from './SmallPublicCandidateDetailPanel'
import { SmallPublicCandidateForm } from './SmallPublicCandidateForm'
import { SmallPublicCandidateListPanel, type SmallPublicCandidateFilter } from './SmallPublicCandidateListPanel'

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
  const { facilities, inspections } = useSmallPublicStore()
  const [listWidth, setListWidth] = useState(LIST_DEFAULT_WIDTH)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [viewInspectionId, setViewInspectionId] = useState<string | null>(null)
  /** «후보지 등록» — 상세 자리에 등록 칸 */
  const [creating, setCreating] = useState(false)
  const [facilityDraft, setFacilityDraft] = useState<FacilityDraft | null>(null)
  const [filter, setFilter] = useState<SmallPublicCandidateFilter>({
    type: '세천',
    candidate: '',
    emd: '',
    keyword: '',
  })

  const detail = !creating && detailId ? (facilities.find((f) => f.id === detailId) ?? null) : null
  const total = listWidth + (detail || creating ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const ofType = useMemo(() => facilities.filter((f) => f.type === filter.type), [facilities, filter.type])

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

  /** 등록 중인 후보지 위치를 찍었으면 지도에 함께(선택 강조로) 보여 줌 */
  const layerFacilities = useMemo(() => {
    if (!creating || !facilityDraft?.coords) return rows
    const draft = { id: DRAFT_FACILITY_ID, type: facilityDraft.type, coords: facilityDraft.coords } as SmallPublicFacility
    return [...rows, draft]
  }, [rows, creating, facilityDraft])

  const { fitTo } = useSmallPublicFacilityLayer({
    facilities: layerFacilities,
    colorOf: classColor,
    selectedId: creating ? DRAFT_FACILITY_ID : detailId,
    pickEnabled: !creating,
    onSelect: (id) => setDetailId(id),
  })

  const select = (id: string) => {
    setCreating(false)
    setDetailId(id)
    const f = facilities.find((x) => x.id === id)
    if (f) fitTo([f])
  }

  const detailInspections = detail ? inspectionsOfFacility(inspections, detail.id) : []
  const viewInspection = viewInspectionId ? (inspections.find((i) => i.id === viewInspectionId) ?? null) : null

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
            selectedId={creating ? null : detailId}
            onSelect={select}
            onRegister={() => {
              setCreating(true)
              setFacilityDraft(null)
            }}
            onClose={onClose}
          />
        </MapSideListPanel>
      </div>
      {detail || creating ? (
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
                initialType={filter.type}
                onDraftChange={setFacilityDraft}
                onCancel={() => {
                  setCreating(false)
                  setFacilityDraft(null)
                }}
                onSaved={(f) => {
                  setCreating(false)
                  setFacilityDraft(null)
                  setFilter({ type: f.type, candidate: '', emd: '', keyword: '' })
                  setDetailId(f.id)
                  fitTo([f])
                }}
              />
            ) : detail ? (
              <SmallPublicCandidateDetailPanel
                facility={detail}
                inspections={detailInspections}
                onOpenInspection={setViewInspectionId}
                onClose={() => setDetailId(null)}
              />
            ) : null}
          </MapSideListPanel>
        </div>
      ) : null}
      {viewInspection && detail ? (
        <SmallPublicInspectionViewModal
          inspection={viewInspection}
          facility={detail}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onClose={() => setViewInspectionId(null)}
        />
      ) : null}
    </>
  )
}
