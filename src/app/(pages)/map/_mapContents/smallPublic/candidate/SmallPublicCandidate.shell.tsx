'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { call } from '@/lib/api'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { SMALL_PUBLIC_CLASS_COLOR, type SmallPublicFacType } from '../smallPublicConfig'
import type {
  SmallPublicCandidateEval,
  SmallPublicFacility,
  SmallPublicInspection,
  SmallPublicSafetyDoc,
} from '../smallPublicMock'
import {
  fetchSpfFacDefineFields,
  spfFacDetailFields,
  spfFacSearchPlaceholder,
  type SmallPublicDefineField,
} from '../smallPublicDefineFields'
import {
  candidateEvalsOfFacility,
  inspectionsOfFacility,
  latestInspectionOf,
  loadSmallPublicFacilityDetail,
  mergeSmallPublicListPage,
  smallPublicActions,
  smallPublicFacilitiesFromListRows,
  useSmallPublicStore,
} from '../smallPublicStore'
import { useSmallPublicFacilityLayer } from '../useSmallPublicFacilityLayer'
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
const LIST_PAGE_SIZE = 100

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
  const { facilities, inspections, candidateEvals } = useSmallPublicStore()
  const [defineFields, setDefineFields] = useState<SmallPublicDefineField[]>([])
  const [listRows, setListRows] = useState<SmallPublicFacility[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [listPage, setListPage] = useState(1)
  const [listLoading, setListLoading] = useState(true)
  const [emdOptions, setEmdOptions] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    void fetchSpfFacDefineFields().then((rows) => {
      if (!cancelled) setDefineFields(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const [listWidth, setListWidth] = useState(LIST_DEFAULT_WIDTH)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH)
  const [detailId, setDetailId] = useState<string | null>(null)
  /** 부속시설물 행 클릭 — 상세는 유지하고 지도만 강조 */
  const [annexLocateId, setAnnexLocateId] = useState<string | null>(null)
  const [classEvalId, setClassEvalId] = useState<string | null>(null)
  /** 후보지 평가 등록·수정 */
  const [candidateEvalForm, setCandidateEvalForm] = useState<SmallPublicCandidateEval | null | 'new'>(null)
  /** 안전점검 등록·수정 */
  const [safetyDocForm, setSafetyDocForm] = useState<SmallPublicSafetyDoc | null | 'new'>(null)
  /** 일반·관리 평가 등록·수정(그해 점검이 있으면 그 기록) */
  const [classEvalForm, setClassEvalForm] = useState<SmallPublicInspection | null | 'new'>(null)
  /** 위험도 평가 수정 */
  /** «후보지 등록» — 상세 자리에 등록 칸 */
  const [creating, setCreating] = useState(false)
  /** «수정» — 상세 자리에 수정 칸(detailId 유지) */
  const [editing, setEditing] = useState(false)
  const [facilityDraft, setFacilityDraft] = useState<FacilityDraft | null>(null)
  /** 지도용 — 유형·읍면만 (목록 구분·검색·페이지와 무관) */
  const [mapFacilities, setMapFacilities] = useState<SmallPublicFacility[]>([])
  const [filter, setFilter] = useState<SmallPublicCandidateFilter>({
    type: '',
    candidate: '',
    emd: '',
    keyword: '',
  })

  /** 메모처럼 서버 페이지·필터만 조회 — 전체 목록 JSON 없음 */
  useEffect(() => {
    let cancelled = false
    const handle = window.setTimeout(() => {
      setListLoading(true)
      void call('', 'POST', {
        service: 'smallPublicService',
        action: 'listFacilities',
        params: {
          page: listPage,
          pageSize: LIST_PAGE_SIZE,
          type: filter.type,
          candidate: filter.candidate,
          emd: filter.emd,
          keyword: filter.keyword,
        },
      }).then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          success?: boolean
          rows?: Parameters<typeof smallPublicFacilitiesFromListRows>[0]
          total?: number
          emdOptions?: string[]
        }
        if (data?.success === false || !Array.isArray(data?.rows)) {
          setListRows([])
          setListTotal(0)
          setListLoading(false)
          return
        }
        const expanded = smallPublicFacilitiesFromListRows(data.rows)
        setListRows(expanded.facilities)
        setListTotal(Number(data.total) || 0)
        if (Array.isArray(data.emdOptions)) setEmdOptions(data.emdOptions)
        mergeSmallPublicListPage(data.rows)
        setListLoading(false)
      }).catch(() => {
        if (cancelled) return
        setListRows([])
        setListTotal(0)
        setListLoading(false)
      })
    }, filter.keyword ? 250 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [filter.type, filter.candidate, filter.emd, filter.keyword, listPage])

  /** 지도: 유형·읍면만 — 전체면 전 시설, 세천 등이면 유형(+읍면)만 */
  useEffect(() => {
    let cancelled = false
    void call('', 'POST', {
      service: 'smallPublicService',
      action: 'listMapFacilities',
      params: {
        type: filter.type,
        emd: filter.emd,
      },
    }).then((res) => {
      if (cancelled) return
      const data = (res?.data ?? res) as {
        success?: boolean
        rows?: Parameters<typeof smallPublicFacilitiesFromListRows>[0]
        emdOptions?: string[]
      }
      if (data?.success === false || !Array.isArray(data?.rows)) {
        setMapFacilities([])
        return
      }
      const expanded = smallPublicFacilitiesFromListRows(data.rows)
      setMapFacilities(expanded.facilities)
      if (Array.isArray(data.emdOptions) && data.emdOptions.length) setEmdOptions(data.emdOptions)
    }).catch(() => {
      if (!cancelled) setMapFacilities([])
    })
    return () => {
      cancelled = true
    }
  }, [filter.type, filter.emd])

  /** 지도 선택으로 필터를 풀 때 페이지를 1로 되돌리지 않음 */
  const skipListPageResetRef = useRef(false)
  useEffect(() => {
    if (skipListPageResetRef.current) {
      skipListPageResetRef.current = false
      return
    }
    setListPage(1)
  }, [filter.type, filter.candidate, filter.emd, filter.keyword])

  const formOpen = creating || editing
  const selected = detailId
    ? (facilities.find((f) => f.id === detailId) ??
        mapFacilities.find((f) => f.id === detailId) ??
        listRows.find((f) => f.id === detailId) ??
        null)
    : null
  const detail = !formOpen ? selected : null
  const panelTotal = listWidth + (formOpen || selected ? detailWidth : 0)

  const columnLabels = useMemo(() => {
    const by = (name: string) =>
      defineFields.find((f) => String(f.define_field_name ?? '').trim().toLowerCase() === name)
    return {
      name: String(by('sisul_name')?.define_field_kor_name ?? '').trim() || undefined,
      emd: String(by('emd')?.define_field_kor_name ?? '').trim() || undefined,
      candidate: String(by('candidate')?.define_field_kor_name ?? '').trim() || undefined,
    }
  }, [defineFields])

  const detailDefineFields = useMemo(() => spfFacDetailFields(defineFields), [defineFields])
  const searchPlaceholder = useMemo(() => spfFacSearchPlaceholder(defineFields), [defineFields])

  useEffect(() => {
    onTotalWidthChange(panelTotal)
  }, [panelTotal, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const annexLocateFacility = annexLocateId
    ? (facilities.find((f) => f.id === annexLocateId) ?? null)
    : null

  /** 지도 = 유형·읍면 전체(+선택·부속강조·초안). 구분·검색·목록 페이지는 반영하지 않음 */
  const layerFacilities = useMemo(() => {
    const base = mapFacilities
    let next =
      detailId && !base.some((f) => f.id === detailId)
        ? [...base, ...(selected ? [selected] : [])]
        : base
    if (annexLocateFacility && !next.some((f) => f.id === annexLocateFacility.id)) {
      next = [...next, annexLocateFacility]
    }
    if (!facilityDraft?.coords) return next
    if (creating) {
      const draft = { id: DRAFT_FACILITY_ID, type: facilityDraft.type, coords: facilityDraft.coords } as SmallPublicFacility
      return [...next, draft]
    }
    if (editing && detailId) {
      return next.map((f) =>
        f.id === detailId ? ({ ...f, type: facilityDraft.type, coords: facilityDraft.coords } as SmallPublicFacility) : f
      )
    }
    return next
  }, [mapFacilities, creating, editing, detailId, facilityDraft, selected, annexLocateFacility])

  const fitToRef = useRef<(list: SmallPublicFacility[]) => void>(() => {})
  const filterRef = useRef(filter)
  filterRef.current = filter
  const listPageRef = useRef(listPage)
  listPageRef.current = listPage

  /** 지도·목록에서 선택 — 상세 열고, 목록은 해당 행이 있는 페이지로 맞춤 */
  const select = (id: string) => {
    setCreating(false)
    setEditing(false)
    setFacilityDraft(null)
    setAnnexLocateId(null)
    setDetailId(id)
    const f =
      mapFacilities.find((x) => x.id === id) ?? listRows.find((x) => x.id === id) ?? facilities.find((x) => x.id === id)
    if (f) fitToRef.current([f])
    void loadSmallPublicFacilityDetail(id)

    if (listRows.some((x) => x.id === id)) return

    const jump = (page: number) => {
      if (page !== listPageRef.current) setListPage(page)
    }
    const locate = (filt: SmallPublicCandidateFilter) =>
      call('', 'POST', {
        service: 'smallPublicService',
        action: 'locateFacilityListPage',
        params: {
          facilityId: id,
          pageSize: LIST_PAGE_SIZE,
          type: filt.type,
          candidate: filt.candidate,
          emd: filt.emd,
          keyword: filt.keyword,
        },
      }).then((res) => {
        const data = (res?.data ?? res) as { success?: boolean; page?: number; found?: boolean }
        if (data?.success === false) return { found: false as const, page: 1 }
        return {
          found: Boolean(data?.found),
          page: Math.max(1, Number(data?.page) || 1),
        }
      })

    void locate(filterRef.current).then(async (hit) => {
      if (hit.found) {
        jump(hit.page)
        return
      }
      /** 구분·검색에 가려진 경우 — 유형·읍면만 남기고 다시 찾아 목록 맞춤 */
      const cleared: SmallPublicCandidateFilter = {
        type: filterRef.current.type,
        emd: filterRef.current.emd,
        candidate: '',
        keyword: '',
      }
      const again = await locate(cleared)
      if (!again.found) return
      if (filterRef.current.candidate || filterRef.current.keyword) {
        skipListPageResetRef.current = true
        setFilter(cleared)
      }
      jump(again.page)
    })
  }

  const { fitTo } = useSmallPublicFacilityLayer({
    facilities: layerFacilities,
    colorOf: classColor,
    selectedId: creating ? DRAFT_FACILITY_ID : detailId,
    highlightId: formOpen ? null : annexLocateId,
    pickEnabled: !formOpen,
    onSelect: select,
  })
  fitToRef.current = fitTo

  const closeForm = () => {
    setCreating(false)
    setEditing(false)
    setFacilityDraft(null)
  }

  const detailInspections = detail ? inspectionsOfFacility(inspections, detail.id) : []
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
            rows={listRows}
            total={listTotal}
            page={listPage}
            pageSize={LIST_PAGE_SIZE}
            onPageChange={setListPage}
            latestOf={(id) => latestInspectionOf(inspections, id)}
            selectedId={formOpen ? null : detailId}
            onSelect={select}
            loading={listLoading}
            columnLabels={columnLabels}
            searchPlaceholder={searchPlaceholder}
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
                defineFields={defineFields}
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
                defineFields={defineFields}
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
                defineDetailFields={detailDefineFields}
                overlayLeftPx={leftOffsetPx}
                overlayWidthPx={panelTotal}
                annexLocateId={annexLocateId}
                onLocateAnnex={(f) => {
                  if (!f.coords) return
                  setAnnexLocateId(f.id)
                  fitTo([f])
                }}
                onAddCandidateEval={() => setCandidateEvalForm('new')}
                onEditCandidateEval={(ev) => setCandidateEvalForm(ev)}
                onEdit={() => {
                  setCreating(false)
                  setEditing(true)
                  setFacilityDraft(null)
                  setAnnexLocateId(null)
                }}
                onDeleted={() => {
                  setAnnexLocateId(null)
                  setDetailId(null)
                }}
                onClose={() => {
                  setAnnexLocateId(null)
                  setDetailId(null)
                }}
              />
            ) : null}
          </MapSideListPanel>
        </div>
      ) : null}
      {classEvalInspection && detail && classEvalForm == null ? (
        <SmallPublicClassEvalModal
          key={classEvalInspection.id}
          inspection={classEvalInspection}
          overlayLeftPx={leftOffsetPx}
          overlayWidthPx={panelTotal}
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
            void smallPublicActions.deleteInspection(classEvalInspection.id).then((res) => {
              if (!res.success) {
                window.alert(res.error)
                return
              }
              setClassEvalId(null)
            })
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
          overlayWidthPx={panelTotal}
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
          overlayWidthPx={panelTotal}
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
          overlayWidthPx={panelTotal}
          onCancel={() => setClassEvalForm(null)}
          onSaved={() => setClassEvalForm(null)}
        />
      ) : null}
    </>
  )
}
