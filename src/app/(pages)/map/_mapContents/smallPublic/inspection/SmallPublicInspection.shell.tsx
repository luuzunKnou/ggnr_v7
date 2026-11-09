'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { SMALL_PUBLIC_GRADE_COLOR, type SmallPublicFacType } from '../smallPublicConfig'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'
import { inspectionsOfFacility, latestInspectionOf, useSmallPublicStore } from '../smallPublicStore'
import { useSmallPublicFacilityLayer } from '../useSmallPublicFacilityLayer'
import { SmallPublicInspectionDetailPanel } from './SmallPublicInspectionDetailPanel'
import {
  SmallPublicInspectionListPanel,
  type SmallPublicGradeFilter,
  type SmallPublicInspectionListRow,
} from './SmallPublicInspectionListPanel'
import { SmallPublicInspectionFormModal } from './SmallPublicInspectionForm'
import { SmallPublicInspectionViewModal } from './SmallPublicInspectionModal'
import { SmallPublicInspectionTargetPickerModal } from './SmallPublicInspectionTargetPicker'

const LIST_DEFAULT_WIDTH = 420
const LIST_MIN_WIDTH = 360
const LIST_MAX_WIDTH = 620
const DETAIL_DEFAULT_WIDTH = 460
const DETAIL_MIN_WIDTH = 380
const DETAIL_MAX_WIDTH = 720

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function SmallPublicInspectionShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const { facilities, inspections } = useSmallPublicStore()
  const [listWidth, setListWidth] = useState(LIST_DEFAULT_WIDTH)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH)
  const [type, setType] = useState<SmallPublicFacType>('세천')
  const [grade, setGrade] = useState<SmallPublicGradeFilter>('')
  const [keyword, setKeyword] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null)
  /** «시설 등록» 모달 — 후보지에서 점검 대상 고르기 */
  const [registering, setRegistering] = useState(false)
  /** 점검 등록(initial null)·수정 모달 */
  const [inspectionForm, setInspectionForm] = useState<{ initial: SmallPublicInspection | null } | null>(null)
  /** 평가표 전체 보기 모달 */
  const [sheetInspectionId, setSheetInspectionId] = useState<string | null>(null)

  /** 점검 대상 = 후보지에서 안전점검으로 등록한 시설(제외 빼고) */
  const targets = useMemo(
    () => facilities.filter((f) => f.inspectionTarget && f.candidate !== '제외'),
    [facilities]
  )
  const detail = detailId ? (targets.find((f) => f.id === detailId) ?? null) : null
  const total = listWidth + (detail ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const ofType: SmallPublicInspectionListRow[] = useMemo(
    () =>
      targets
        .filter((f) => f.type === type)
        .map((facility) => ({ facility, latest: latestInspectionOf(inspections, facility.id) })),
    [targets, type, inspections]
  )

  /** 최근 점검일 최신 순, 점검 없는 시설은 맨 뒤 */
  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    /** 점검일은 «2025.03»·«20250312» 처럼 구분자 없이 입력해도 맞춤 */
    const qDigits = /^[\d\s.\-/]+$/.test(q) ? q.replace(/\D/g, '') : ''
    return ofType
      .filter((r) => !grade || r.latest?.grade === grade)
      .filter(
        (r) =>
          !q ||
          [r.facility.name, r.facility.mngNo, r.facility.ri, r.facility.emd, r.latest?.date ?? '']
            .join(' ')
            .toLowerCase()
            .includes(q) ||
          (qDigits.length > 0 && (r.latest?.date ?? '').replace(/\D/g, '').includes(qDigits))
      )
      .sort(
        (a, b) =>
          (b.latest?.date ?? '').localeCompare(a.latest?.date ?? '') ||
          a.facility.name.localeCompare(b.facility.name, 'ko')
      )
  }, [ofType, grade, keyword])

  const gradeColorOf = useCallback(
    (f: SmallPublicFacility) => SMALL_PUBLIC_GRADE_COLOR[latestInspectionOf(inspections, f.id)?.grade ?? '없음'],
    [inspections]
  )

  const layerFacilities = useMemo(() => rows.map((r) => r.facility), [rows])
  const { fitTo } = useSmallPublicFacilityLayer({
    facilities: layerFacilities,
    colorOf: gradeColorOf,
    selectedId: detailId,
    onSelect: (id) => {
      setDetailId(id)
      setSelectedInspectionId(latestInspectionOf(inspections, id)?.id ?? null)
    },
  })

  const select = (id: string) => {
    setDetailId(id)
    setSelectedInspectionId(latestInspectionOf(inspections, id)?.id ?? null)
    const f = targets.find((x) => x.id === id)
    if (f) fitTo([f])
  }

  const detailInspections = detail ? inspectionsOfFacility(inspections, detail.id) : []
  const sheetInspection = sheetInspectionId
    ? (detailInspections.find((i) => i.id === sheetInspectionId) ?? null)
    : null

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
          <SmallPublicInspectionListPanel
            type={type}
            onTypeChange={setType}
            grade={grade}
            onGradeChange={setGrade}
            keyword={keyword}
            onKeywordChange={setKeyword}
            rows={rows}
            selectedId={detailId}
            onSelect={select}
            onRegisterFacility={() => setRegistering(true)}
            onClose={onClose}
          />
        </MapSideListPanel>
      </div>
      {detail ? (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={detailWidth}
            minWidth={DETAIL_MIN_WIDTH}
            maxWidth={DETAIL_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            <SmallPublicInspectionDetailPanel
              facility={detail}
              inspections={detailInspections}
              selectedInspectionId={selectedInspectionId}
              onSelectInspection={setSelectedInspectionId}
              onRegisterInspection={() => setInspectionForm({ initial: null })}
              onEditInspection={(i) => setInspectionForm({ initial: i })}
              onOpenInspectionSheet={(i) => setSheetInspectionId(i.id)}
              onClose={() => {
                setDetailId(null)
                setSelectedInspectionId(null)
              }}
            />
          </MapSideListPanel>
        </div>
      ) : null}
      {registering ? (
        <SmallPublicInspectionTargetPickerModal
          facilities={facilities}
          initialType={type}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onCancel={() => setRegistering(false)}
          onPicked={(f) => {
            setRegistering(false)
            setType(f.type)
            setGrade('')
            setKeyword('')
            setDetailId(f.id)
            setSelectedInspectionId(latestInspectionOf(inspections, f.id)?.id ?? null)
            fitTo([f])
            /** 직접 등록 — 고른 시설에 바로 점검 등록 */
            setInspectionForm({ initial: null })
          }}
        />
      ) : null}
      {sheetInspection && detail ? (
        <SmallPublicInspectionViewModal
          inspection={sheetInspection}
          facility={detail}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onClose={() => setSheetInspectionId(null)}
        />
      ) : null}
      {inspectionForm && detail ? (
        <SmallPublicInspectionFormModal
          facility={detail}
          initial={inspectionForm.initial}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={total}
          onCancel={() => setInspectionForm(null)}
          onSaved={(saved) => {
            setInspectionForm(null)
            setSelectedInspectionId(saved.id)
          }}
        />
      ) : null}
    </>
  )
}
