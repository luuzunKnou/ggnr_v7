'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit/LayerRowPanelButton'
import { SMALL_PUBLIC_GRADE_COLOR } from '../smallPublicConfig'
import { SmallPublicPanelHeader } from '../smallPublicUi'
import type { SmallPublicFacility, SmallPublicInspection } from '../smallPublicMock'
import { inspectionsOfFacility, smallPublicActions, useSmallPublicStore } from '../smallPublicStore'
import { smallPublicPlanActions, useSmallPublicPlanStore } from '../plan/smallPublicPlanStore'
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
import {
  exportSmallPublicReportExcel,
  prevYearSmallPublicReport,
  smallPublicReportRowOf,
  type SmallPublicInspectionReport,
} from './smallPublicInspectionReport'

/** 목록·상세를 한 패널에서 전환 — 가로 공간 절약 */
const PANEL_DEFAULT_WIDTH = 460
const PANEL_MIN_WIDTH = 380
const PANEL_MAX_WIDTH = 640

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  /** 정비계획 패널을 연다(이관 후) */
  onOpenPlan: () => void
}

/** 이 보고서에서 한 시설 점검(보고서당 1건) */
function inspectionOfReport(
  inspections: SmallPublicInspection[],
  facilityId: string,
  reportId: string
): SmallPublicInspection | null {
  return inspectionsOfFacility(inspections, facilityId).find((i) => i.reportId === reportId) ?? null
}

/**
 * 안전점검 — 한 패널에서 보고서 목록 ⇄ 상세(점검 대상).
 * 미점검은 바로 등록, 점검 완료는 메타·첨부 모달.
 */
export function SmallPublicInspectionShell({ leftOffsetPx, onTotalWidthChange, onClose, onOpenPlan }: Props) {
  const { facilities, inspections, reports } = useSmallPublicStore()
  const { units: planUnits } = useSmallPublicPlanStore()
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH)
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

  const report = reportId ? (reports.find((r) => r.id === reportId) ?? null) : null

  useEffect(() => {
    onTotalWidthChange(panelWidth)
  }, [panelWidth, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const facilityById = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities])

  const yearOptions = useMemo(
    () => [...new Set([...reports.map((r) => r.year), Number(year)].filter(Boolean))].sort((a, b) => b - a),
    [reports, year]
  )

  const listRows: SmallPublicReportListRow[] = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return reports
      .filter((r) => !year || r.year === Number(year))
      .filter((r) => !q || [r.title, r.author, r.agency].join(' ').toLowerCase().includes(q))
      .sort((a, b) => b.year - a.year || b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        report: r,
        inspected: r.rows.filter((x) => inspectionOfReport(inspections, x.facilityId, r.id)).length,
      }))
  }, [reports, year, keyword, inspections])

  const targets: SmallPublicReportTargetRow[] = useMemo(
    () => (report ? report.rows.map((row) => ({ row, yearLatest: inspectionOfReport(inspections, row.facilityId, report.id) })) : []),
    [report, inspections]
  )
  const prev = report ? prevYearSmallPublicReport(reports, report.year) : null

  const plannedFacilityIds = useMemo(
    () => new Set(planUnits.map((u) => u.facilityId).filter(Boolean) as string[]),
    [planUnits]
  )

  /** 이관·보고서 미리보기 등 — 패널 폭이 아니라 지도 남은 폭 전체 */
  const mapOverlay = useMemo(() => {
    const mapW =
      typeof window !== 'undefined' ? Math.max(panelWidth, window.innerWidth - leftOffsetPx) : Math.max(panelWidth, 720)
    return { overlayLeftPx: leftOffsetPx, overlayWidthPx: mapW }
  }, [leftOffsetPx, panelWidth])
  const transferOverlay = mapOverlay

  /** 점검 완료 + 결과 위험 + 이전 구분 비위험 */
  const transferRows: SmallPublicPlanTransferRow[] = useMemo(() => {
    return targets
      .filter((t) => t.yearLatest && t.yearLatest.classResult === '위험' && t.row.prevClass !== '위험')
      .map((t) => ({
        facilityId: t.row.facilityId,
        name: t.row.name,
        type: t.row.type,
        emd: t.row.emd,
        ri: t.row.ri,
        prevClass: t.row.prevClass,
        date: t.yearLatest!.date,
        alreadyInPlan: plannedFacilityIds.has(t.row.facilityId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [targets, plannedFacilityIds])

  const openTransfer = () => {
    if (transferRows.length === 0) {
      window.alert('이번 보고서에서 위험으로 바뀐 시설이 없습니다.')
      return
    }
    setTransferOpen(true)
  }

  const confirmTransfer = (facilityIds: string[]) => {
    setTransferOpen(false)
    if (facilityIds.length === 0) return
    for (const id of facilityIds) {
      const f = facilityById.get(id)
      if (f && f.candidate !== '위험' && f.candidate !== '제외') {
        smallPublicActions.updateFacility(id, { candidate: '위험' })
      }
    }
    smallPublicPlanActions.requestAnalyzeMany(facilityIds)
    onOpenPlan()
  }

  const layerFacilities = useMemo(
    () => targets.map((t) => facilityById.get(t.row.facilityId)).filter((f): f is SmallPublicFacility => Boolean(f)),
    [targets, facilityById]
  )
  const gradeColorOf = useCallback(
    (f: SmallPublicFacility) =>
      SMALL_PUBLIC_GRADE_COLOR[(report && inspectionOfReport(inspections, f.id, report.id)?.grade) || '없음'],
    [inspections, report]
  )

  const fitToRef = useRef<(fs: SmallPublicFacility[]) => void>(() => {})
  /** 미점검 → 바로 등록, 점검 완료 → 보기 모달 */
  const openFacility = useCallback(
    (id: string) => {
      setFacilityId(id)
      const f = facilityById.get(id)
      if (f) fitToRef.current([f])
      if (!report) return
      const insp = inspectionOfReport(inspections, id, report.id)
      if (!insp) setInspectionForm({ initial: null })
    },
    [facilityById, report, inspections]
  )

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
      return
    }
    setReportId(id)
    setFacilityId(null)
    setInspectionForm(null)
    const r = reports.find((x) => x.id === id)
    const fs = r ? r.rows.map((x) => facilityById.get(x.facilityId)).filter((f): f is SmallPublicFacility => Boolean(f)) : []
    if (fs.length) fitTo(fs)
  }

  const facility = facilityId ? (facilityById.get(facilityId) ?? null) : null
  const facilityYearInspection = facility && report ? inspectionOfReport(inspections, facility.id, report.id) : null
  const overlay = { overlayLeftPx: leftOffsetPx, overlayWidthPx: panelWidth }
  const pickable = report
    ? facilities.filter((f) => f.candidate !== '제외' && !report.rows.some((x) => x.facilityId === f.id))
    : []

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={panelWidth}
          minWidth={PANEL_MIN_WIDTH}
          maxWidth={PANEL_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setPanelWidth}
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
                  onExcel={() => {
                    void exportSmallPublicReportExcel(report, prev).catch(() =>
                      window.alert('엑셀 파일을 만들지 못했습니다.')
                    )
                  }}
                  onTransferToPlan={openTransfer}
                  onEdit={() => setReportForm({ initial: report })}
                  onDelete={() => {
                    if (!window.confirm(`«${report.title}» 보고서를 삭제할까요? 점검 기록은 그대로 남습니다.`)) return
                    smallPublicActions.deleteReport(report.id)
                    setReportId(null)
                    setFacilityId(null)
                    setInspectionForm(null)
                  }}
                  onClose={onClose}
                  embedded
                />
              </div>
            ) : null}
          </div>
        </MapSideListPanel>
      </div>

      {reportForm ? (
        <SmallPublicInspectionReportForm
          {...overlay}
          initial={reportForm.initial}
          onCancel={() => setReportForm(null)}
          onSaved={(r) => {
            setReportForm(null)
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
            smallPublicActions.addReportRow(report.id, smallPublicReportRowOf(f, inspections, report.baseDate))
            setPicking(false)
            openFacility(f.id)
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
      {facility && report && facilityYearInspection && inspectionForm == null ? (
        <SmallPublicFacilityInspectionModal
          key={facilityYearInspection.id}
          {...overlay}
          facility={facility}
          inspection={facilityYearInspection}
          year={report.year}
          onEdit={(i) => setInspectionForm({ initial: i })}
          onClose={() => setFacilityId(null)}
        />
      ) : null}
      {inspectionForm && facility && report ? (
        <SmallPublicInspectionFormModal
          {...overlay}
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
            setFacilityId(null)
          }}
        />
      ) : null}
    </>
  )
}
