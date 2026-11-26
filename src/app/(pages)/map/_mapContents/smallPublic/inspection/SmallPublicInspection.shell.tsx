'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { SMALL_PUBLIC_GRADE_COLOR } from '../smallPublicConfig'
import {
  bridgeGroupCodeOfName,
  bridgeGroupRowId,
  bridgeRiOfName,
  groupCodeOfRowId,
} from '../smallPublicBridgeGroup'
import { SmallPublicPanelHeader } from '../smallPublicUi'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'
import {
  inspectionsOfFacility,
  loadSmallPublicInspectionFiles,
  mergeSmallPublicReportBundle,
  smallPublicActions,
  smallPublicFacilitiesFromListRows,
  useSmallPublicStore,
} from '../smallPublicStore'
import { bumpSmallPublicPlanRefresh } from '../plan/smallPublicPlanRefresh'
import { useSmallPublicFacilityLayer } from '../useSmallPublicFacilityLayer'
import { SmallPublicFacilityInspectionModal } from './SmallPublicFacilityInspectionModal'
import { SmallPublicInspectionFormModal } from './SmallPublicInspectionForm'
import { SmallPublicInspectionListPanel, type SmallPublicReportListRow } from './SmallPublicInspectionListPanel'
import {
  SmallPublicInspectionReportDetailPanel,
  type SmallPublicReportTargetRow,
} from './SmallPublicInspectionReportDetailPanel'
import { SmallPublicInspectionReportForm } from './SmallPublicInspectionReportForm'
import { SmallPublicInspectionReportModal } from './SmallPublicInspectionReportModal'
import { SmallPublicInspectionTargetPickerModal } from './SmallPublicInspectionTargetPicker'
import {
  SmallPublicPlanTransferModal,
  type SmallPublicPlanTransferRow,
} from './SmallPublicPlanTransferModal'
import { exportSmallPublicReportExcel, type SmallPublicInspectionReport } from './smallPublicInspectionReport'

/** 보고서 목록·개요는 넓게, 시설 점검은 후보지처럼 옆에 붙임 */
const LIST_DEFAULT_WIDTH = 454
const LIST_MIN_WIDTH = 440
const LIST_MAX_WIDTH = 760
const DETAIL_DEFAULT_WIDTH = 440
const DETAIL_MIN_WIDTH = 380
const DETAIL_MAX_WIDTH = 680

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  /** 정비계획 패널을 연다(이관 후) */
  onOpenPlan: () => void
}

/**
 * 안전점검 — 보고서 목록(+대상) · 시설 점검 상세/등록은 후보지처럼 옆 패널.
 */
export function SmallPublicInspectionShell({ leftOffsetPx, onTotalWidthChange, onClose, onOpenPlan }: Props) {
  const { facilities, inspections, reports, reportsVersion } = useSmallPublicStore()
  /** 정비계획 DB에 이미 들어간 관리번호(소교량은 묶음 관리번호) — 이관 창 열 때 조회 */
  const [plannedCodes, setPlannedCodes] = useState<Set<string>>(() => new Set())
  const [listWidth, setListWidth] = useState(LIST_DEFAULT_WIDTH)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH)
  const [keyword, setKeyword] = useState('')
  const [year, setYear] = useState('')
  const [reportId, setReportId] = useState<string | null>(null)
  const [facilityId, setFacilityId] = useState<string | null>(null)
  /** 보고서 추가(initial null)·수정 */
  const [reportForm, setReportForm] = useState<{ initial: SmallPublicInspectionReport | null } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  /** 점검 등록(initial null)·수정 */
  const [inspectionForm, setInspectionForm] = useState<{ initial: SmallPublicInspection | null } | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listRows, setListRows] = useState<SmallPublicReportListRow[]>([])
  const [yearOptions, setYearOptions] = useState<number[]>([])
  const [prevReport, setPrevReport] = useState<SmallPublicInspectionReport | null>(null)
  const [pickable, setPickable] = useState<SmallPublicFacility[]>([])
  /** 보고서 수정·대상 추가 후 선택한 보고서 상세를 다시 읽는 신호 */
  const [detailReloadSeq, setDetailReloadSeq] = useState(0)

  const report = reportId ? (reports.find((r) => r.id === reportId) ?? null) : null
  const facility = facilityId ? (facilities.find((f) => f.id === facilityId) ?? null) : null
  /** 이 보고서의 시설별 점검(보고서당 1건, 최근 조사일 우선) — 행마다 전체 점검을 다시 훑지 않도록 한 번에 만든다 */
  const reportInspByFacility = useMemo(() => {
    const m = new Map<string, SmallPublicInspection>()
    if (!report) return m
    for (const i of inspections) {
      if (i.reportId !== report.id) continue
      const cur = m.get(i.facilityId)
      if (!cur || i.date > cur.date || (i.date === cur.date && i.id > cur.id)) m.set(i.facilityId, i)
    }
    return m
  }, [inspections, report])
  const facilityYearInspection = facility && report ? (reportInspByFacility.get(facility.id) ?? null) : null
  /** 시설 선택 시 옆 패널 — 등록 폼 또는 점검 상세 */
  const showFacilityPanel =
    !!facility &&
    !!report &&
    (inspectionForm != null || !!facilityYearInspection)
  const total = listWidth + (showFacilityPanel ? detailWidth : 0)

  /** 점검 상세를 열 때만 그 점검의 첨부(연도 폴더)를 가져온다 */
  const yearInspForFiles = facilityYearInspection
  useEffect(() => {
    if (yearInspForFiles && !yearInspForFiles.files) void loadSmallPublicInspectionFiles(yearInspForFiles)
  }, [yearInspForFiles])

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  /** 보고서 목록 — 헤더·건수만(전체 시설 seed 없음) */
  useEffect(() => {
    let cancelled = false
    const handle = window.setTimeout(() => {
      setListLoading(true)
      void call('', 'POST', {
        service: 'smallPublicService',
        action: 'listReports',
        params: { year, keyword },
      }).then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          success?: boolean
          reports?: Array<{
            id: string
            year: number
            baseDate: string
            title: string
            agency: string
            author: string
            targetCount: number
            inspected: number
          }>
          yearOptions?: number[]
        }
        if (data?.success === false || !Array.isArray(data?.reports)) {
          setListRows([])
          setListLoading(false)
          return
        }
        setYearOptions(Array.isArray(data.yearOptions) ? data.yearOptions : [])
        setListRows(
          data.reports.map((r) => ({
            report: {
              id: r.id,
              year: r.year,
              baseDate: r.baseDate,
              title: r.title,
              agency: r.agency,
              author: r.author,
              summary: '',
              createdAt: `${r.baseDate}T00:00:00`,
              rows: [],
              sample: false,
            },
            inspected: r.inspected,
            targetCount: r.targetCount,
          }))
        )
        setListLoading(false)
      }).catch(() => {
        if (cancelled) return
        setListRows([])
        setListLoading(false)
      })
    }, keyword ? 250 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [year, keyword, reportsVersion])

  const listRowsRef = useRef(listRows)
  listRowsRef.current = listRows

  /** 보고서 선택 시 대상·점검만 서버에서 로드 */
  useEffect(() => {
    if (!reportId) {
      setPrevReport(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    void call('', 'POST', {
      service: 'smallPublicService',
      action: 'getReportDetail',
      params: { reportId },
    })
      .then(async (res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          success?: boolean
          report?: SmallPublicInspectionReport
          facilities?: SmallPublicFacility[]
          inspections?: SmallPublicInspection[]
        }
        if (data?.success === false || !data.report) {
          setDetailLoading(false)
          return
        }
        mergeSmallPublicReportBundle({
          report: data.report,
          facilities: data.facilities ?? [],
          inspections: data.inspections ?? [],
        })
        /** 목록·지도는 먼저 보여 주고, 전년 비교용 보고서는 뒤에서 가져온다 */
        setDetailLoading(false)
        const prevMeta = listRowsRef.current.find((x) => x.report.year === data.report!.year - 1)
        if (prevMeta) {
          const prevRes = await call('', 'POST', {
            service: 'smallPublicService',
            action: 'getReportDetail',
            params: { reportId: prevMeta.report.id },
          })
          if (cancelled) return
          const prevData = (prevRes?.data ?? prevRes) as {
            success?: boolean
            report?: SmallPublicInspectionReport
          }
          setPrevReport(prevData?.report ?? null)
        } else {
          setPrevReport(null)
        }
      })
      .catch(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reportId, detailReloadSeq])

  const facilityById = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities])

  const targets: SmallPublicReportTargetRow[] = useMemo(
    () => (report ? report.rows.map((row) => ({ row, yearLatest: reportInspByFacility.get(row.facilityId) ?? null })) : []),
    [report, reportInspByFacility]
  )
  const prev = prevReport

  /** 이관·보고서 미리보기 등 — 패널 폭이 아니라 지도 남은 폭 전체 */
  const mapOverlay = useMemo(() => {
    const mapW =
      typeof window !== 'undefined' ? Math.max(total, window.innerWidth - leftOffsetPx) : Math.max(total, 720)
    return { overlayLeftPx: leftOffsetPx, overlayWidthPx: mapW }
  }, [leftOffsetPx, total])
  const transferOverlay = mapOverlay

  /**
   * 점검 완료 + 결과 위험 + 이전 구분 비위험.
   * 소교량은 개별이 아니라 리 묶음 한 줄(members = 묶음 행 id → 소교량 시설 id).
   */
  const { transferRows, bridgeMembers } = useMemo(() => {
    const eligible = targets.filter(
      (t) => t.yearLatest && t.yearLatest.classResult === '위험' && t.row.prevClass !== '위험'
    )
    const rows: SmallPublicPlanTransferRow[] = []
    const members = new Map<string, string[]>()
    const groups = new Map<string, SmallPublicPlanTransferRow>()
    for (const t of eligible) {
      if (t.row.type === '소교량') {
        const code = bridgeGroupCodeOfName(t.row.name)
        const rowId = bridgeGroupRowId(code)
        const date = t.yearLatest!.date
        const g = groups.get(rowId)
        if (g) {
          g.memberCount = (g.memberCount ?? 0) + 1
          if (date > g.date) g.date = date
        } else {
          groups.set(rowId, {
            facilityId: rowId,
            name: code,
            type: t.row.type,
            emd: t.row.emd,
            ri: bridgeRiOfName(t.row.name),
            prevClass: t.row.prevClass,
            date,
            alreadyInPlan: false,
            memberCount: 1,
            groupInPlan: plannedCodes.has(code),
          })
        }
        members.set(rowId, [...(members.get(rowId) ?? []), t.row.facilityId])
        continue
      }
      rows.push({
        facilityId: t.row.facilityId,
        name: t.row.name,
        type: t.row.type,
        emd: t.row.emd,
        ri: t.row.ri,
        prevClass: t.row.prevClass,
        date: t.yearLatest!.date,
        alreadyInPlan: plannedCodes.has(t.row.facilityId),
      })
    }
    rows.push(...groups.values())
    rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    return { transferRows: rows, bridgeMembers: members }
  }, [targets, plannedCodes])

  /** 정비계획 DB에 이미 있는 관리번호를 조회한 뒤 이관 창을 연다 */
  const openTransfer = () => {
    if (transferRows.length === 0) {
      window.alert('이번 보고서에서 위험으로 바뀐 시설이 없습니다.')
      return
    }
    void call('', 'POST', { service: 'smallPublicPlanService', action: 'getPlannedCodes', params: {} })
      .then((res) => {
        const data = (res?.data ?? res) as { success?: boolean; codes?: string[] } | undefined
        setPlannedCodes(new Set(data?.success === false ? [] : (data?.codes ?? [])))
      })
      .catch(() => setPlannedCodes(new Set()))
      .finally(() => setTransferOpen(true))
  }

  const markDanger = (id: string) => {
    const f = facilityById.get(id)
    if (f && f.candidate !== '위험' && f.candidate !== '제외') {
      smallPublicActions.updateFacility(id, { candidate: '위험' })
    }
  }

  /** 이관 — 서버가 시설은 개별, 소교량은 리 묶음으로 정비계획(작성중)에 넣는다 */
  const confirmTransfer = (rowIds: string[]) => {
    setTransferOpen(false)
    if (rowIds.length === 0) return
    /** 묶음 행은 소속 소교량 시설로 풀어서 보낸다 */
    const facilityIds = rowIds.flatMap((id) => (groupCodeOfRowId(id) ? (bridgeMembers.get(id) ?? []) : [id]))
    void call('', 'POST', {
      service: 'smallPublicPlanService',
      action: 'transferToPlan',
      params: { facilityIds },
    })
      .then((res) => {
        const data = (res?.data ?? res) as { success?: boolean; error?: string } | undefined
        if (!data || data.success === false) throw new Error(data?.error ?? 'transfer failed')
        for (const id of facilityIds) markDanger(id)
        bumpSmallPublicPlanRefresh()
        onOpenPlan()
      })
      .catch(() => window.alert('정비계획으로 이관하지 못했습니다. 다시 시도해 주세요.'))
  }

  const layerFacilities = useMemo(
    () => targets.map((t) => facilityById.get(t.row.facilityId)).filter((f): f is SmallPublicFacility => Boolean(f)),
    [targets, facilityById]
  )
  const gradeColorOf = useCallback(
    (f: SmallPublicFacility) => SMALL_PUBLIC_GRADE_COLOR[reportInspByFacility.get(f.id)?.grade || '없음'],
    [reportInspByFacility]
  )

  const fitToRef = useRef<(fs: SmallPublicFacility[]) => void>(() => {})
  /** 미점검 → 옆 패널 등록, 점검 완료 → 옆 패널 상세(등록 폼은 닫음) */
  const openFacility = useCallback(
    (id: string) => {
      setFacilityId(id)
      const f = facilityById.get(id)
      if (f) fitToRef.current([f])
      if (!report) return
      const insp = reportInspByFacility.get(id)
      setInspectionForm(insp ? null : { initial: null })
    },
    [facilityById, report, reportInspByFacility]
  )

  const closeFacilityPanel = useCallback(() => {
    setFacilityId(null)
    setInspectionForm(null)
  }, [])

  const { fitTo } = useSmallPublicFacilityLayer({
    facilities: layerFacilities,
    colorOf: gradeColorOf,
    selectedId: facilityId,
    onSelect: (id) => {
      if (id) openFacility(id)
    },
  })
  fitToRef.current = fitTo

  /** 같은 보고서 재클릭 시 상세 닫기 */
  const selectReport = (id: string) => {
    if (reportId === id) {
      setReportId(null)
      setFacilityId(null)
      setInspectionForm(null)
      setPrevReport(null)
      return
    }
    setReportId(id)
    setFacilityId(null)
    setInspectionForm(null)
  }

  useEffect(() => {
    if (!report?.rows.length) return
    const fs = report.rows
      .map((x) => facilityById.get(x.facilityId))
      .filter((f): f is SmallPublicFacility => Boolean(f))
    if (fs.length) fitTo(fs)
  }, [report?.id, report?.rows, facilityById, fitTo])

  const overlay = { overlayLeftPx: leftOffsetPx, overlayWidthPx: listWidth }
  useEffect(() => {
    if (!picking || !report) {
      setPickable([])
      return
    }
    let cancelled = false
    const exclude = new Set(report.rows.map((r) => r.facilityId))
    void call('', 'POST', {
      service: 'smallPublicService',
      action: 'listFacilities',
      params: { page: 1, pageSize: 200, keyword: '' },
    }).then((res) => {
      if (cancelled) return
      const data = (res?.data ?? res) as {
        success?: boolean
        rows?: Parameters<typeof smallPublicFacilitiesFromListRows>[0]
      }
      if (data?.success === false || !Array.isArray(data?.rows)) {
        setPickable([])
        return
      }
      const expanded = smallPublicFacilitiesFromListRows(data.rows)
      setPickable(expanded.facilities.filter((f) => f.candidate !== '제외' && !exclude.has(f.id)))
    })
    return () => {
      cancelled = true
    }
  }, [picking, report])

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={LIST_MIN_WIDTH}
          maxWidth={LIST_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
          contentClassName="overflow-hidden"
        >
          <div className="flex h-full min-h-0 flex-col bg-background">
            <SmallPublicPanelHeader
              title="안전점검"
              onClose={onClose}
              actions={
                <LayerRowPanelButton onClick={() => setReportForm({ initial: null })}>
                  <Plus className="h-3 w-3 shrink-0" aria-hidden />
                  보고서 추가
                </LayerRowPanelButton>
              }
            />
            {/* 선택 전: 목록 전체 / 선택 후: 약 4행으로 접고 아래 상세 */}
            <div
              className={cn(
                'flex flex-col border-b border-border',
                report ? 'h-[11.5rem] shrink-0' : 'min-h-0 flex-1'
              )}
            >
              <SmallPublicInspectionListPanel
                keyword={keyword}
                onKeywordChange={setKeyword}
                year={year}
                onYearChange={setYear}
                yearOptions={yearOptions}
                rows={listRows}
                selectedId={reportId}
                onSelect={selectReport}
                onAdd={() => setReportForm({ initial: null })}
                onClose={onClose}
                embedded
                loading={listLoading}
              />
            </div>
            {report ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t-2 border-primary/25 bg-muted/25">
                <SmallPublicInspectionReportDetailPanel
                  key={report.id}
                  report={report}
                  prev={prev}
                  targets={targets}
                  selectedFacilityId={facilityId}
                  onOpenFacility={openFacility}
                  onAddFacility={() => setPicking(true)}
                  onOpenReport={() => setPreviewOpen(true)}
                  onExcel={(emd) => {
                    void exportSmallPublicReportExcel(report, prev, emd).catch(() =>
                      window.alert('엑셀 파일을 만들지 못했습니다.')
                    )
                  }}
                  onTransferToPlan={openTransfer}
                  onEdit={() => setReportForm({ initial: report })}
                  onDelete={() => {
                    if (!window.confirm(`«${report.title}» 보고서를 삭제할까요? 점검 결과가 있는 보고서는 삭제되지 않습니다.`)) return
                    void smallPublicActions.deleteReport(report.id).then((res) => {
                      if (!res.success) {
                        window.alert(res.error)
                        return
                      }
                      setReportId(null)
                      setFacilityId(null)
                      setInspectionForm(null)
                    })
                  }}
                  onClose={onClose}
                  embedded
                  loading={detailLoading}
                />
              </div>
            ) : null}
          </div>
        </MapSideListPanel>
      </div>

      {showFacilityPanel && facility && report ? (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={detailWidth}
            minWidth={DETAIL_MIN_WIDTH}
            maxWidth={DETAIL_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            {inspectionForm ? (
              <SmallPublicInspectionFormModal
                key={inspectionForm.initial?.id ?? `new-${facility.id}`}
                facility={facility}
                year={report.year}
                reportId={report.id}
                initial={inspectionForm.initial}
                onCancel={() => {
                  setInspectionForm(null)
                  if (!inspectionForm.initial) setFacilityId(null)
                }}
                onSaved={() => {
                  setInspectionForm(null)
                  // 저장 후 상세로 남김
                }}
              />
            ) : facilityYearInspection ? (
              <SmallPublicFacilityInspectionModal
                key={facilityYearInspection.id}
                facility={facility}
                inspection={facilityYearInspection}
                inspections={inspectionsOfFacility(inspections, facility.id)}
                year={report.year}
                onEdit={(i) => setInspectionForm({ initial: i })}
                onClose={closeFacilityPanel}
              />
            ) : null}
          </MapSideListPanel>
        </div>
      ) : null}

      {reportForm ? (
        <SmallPublicInspectionReportForm
          {...overlay}
          initial={reportForm.initial}
          existingYears={yearOptions}
          onCancel={() => setReportForm(null)}
          onSaved={(r) => {
            setReportForm(null)
            if (r.id === reportId) {
              setDetailReloadSeq((n) => n + 1)
              return
            }
            selectReport(r.id)
          }}
        />
      ) : null}
      {previewOpen && report ? (
        <SmallPublicInspectionReportModal
          {...mapOverlay}
          report={report}
          prev={prev}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {picking && report ? (
        <SmallPublicInspectionTargetPickerModal
          {...overlay}
          facilities={pickable}
          onCancel={() => setPicking(false)}
          onPicked={(f) => {
            void smallPublicActions.addReportRow(report.id, f.id).then((res) => {
              if (!res.success) {
                window.alert(res.error)
                return
              }
              setPicking(false)
              setDetailReloadSeq((n) => n + 1)
              setFacilityId(f.id)
              setInspectionForm({ initial: null })
            })
          }}
        />
      ) : null}
      {transferOpen ? (
        <SmallPublicPlanTransferModal
          {...transferOverlay}
          rows={transferRows}
          onCancel={() => setTransferOpen(false)}
          onConfirm={confirmTransfer}
        />
      ) : null}
    </>
  )
}
