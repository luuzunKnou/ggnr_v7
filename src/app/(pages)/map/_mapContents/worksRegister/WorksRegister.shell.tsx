'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { useAnalysisAreaLayer } from '../../_mapComponents/analysisArea'
import { WorksRegisterFormPanel } from './WorksRegisterFormPanel'
import { WorksRegisterDrawHost } from './WorksRegisterDrawHost'
import { WorksRegisterLocationModal } from './WorksRegisterLocationModal'
import {
  WORKS_REGISTER_FORM_DEFAULT_WIDTH,
  WORKS_REGISTER_FORM_MAX_WIDTH,
  WORKS_REGISTER_FORM_MIN_WIDTH,
  WORKS_REGISTER_PANEL_DEFAULT_WIDTH,
  WORKS_REGISTER_PANEL_MAX_WIDTH,
  WORKS_REGISTER_PANEL_MIN_WIDTH,
  WorksRegisterPanel,
} from './WorksRegisterPanel'
import {
  createEmptyWorksRegisterRecord,
  getInitialWorksRegisterRows,
  nextWorksRegisterId,
  WORKS_REGISTER_NEW_ID,
  type WorksRegisterRecord,
  type WorksRegisterScope,
} from './worksRegisterMock'
import {
  useWorksRegisterDrawSession,
  type WorksRegisterScopeArea,
} from './useWorksRegisterDrawSession'
import { useWorksRegisterParcelDetail } from './useWorksRegisterParcelDetail'
import {
  buildScopeSummaryFromLocationCandidate,
  fetchWorksRegisterScopeSummary,
  mergeScopeSummary,
} from './worksRegisterScopeSummary'

export { WORKS_REGISTER_OPENED_KEY } from './WorksRegisterPanel'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function WorksRegisterShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const [records, setRecords] = useState<WorksRegisterRecord[]>(() => getInitialWorksRegisterRows())
  const [listWidth, setListWidth] = useState(WORKS_REGISTER_PANEL_DEFAULT_WIDTH)
  const [formWidth, setFormWidth] = useState(WORKS_REGISTER_FORM_DEFAULT_WIDTH)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [displayScope, setDisplayScope] = useState<WorksRegisterScope | null>(null)
  const [scopeSummaryLoading, setScopeSummaryLoading] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const scopeSummaryRunIdRef = useRef(0)

  const formRecord = useMemo(() => {
    if (!selectedId) return null
    if (selectedId === WORKS_REGISTER_NEW_ID) return createEmptyWorksRegisterRecord()
    return records.find((r) => r.id === selectedId) ?? null
  }, [records, selectedId])

  const formOpen = Boolean(formRecord)
  const total = listWidth + (formOpen ? formWidth : 0)
  /** 목록(+상세)만 덮음 — 지도는 제외 (도로대장 속성조회와 동일) */
  const locationOverlayWidth = listWidth + (formOpen ? formWidth : 0)

  const applyConfirmedArea = useCallback((area: WorksRegisterScopeArea) => {
    const fromLocation =
      area.method === 'location'
        ? buildScopeSummaryFromLocationCandidate({
            areaSqm: Number(area.areaSqm) || 0,
            address: area.address,
            ownership: area.ownership,
            zoneLabel: area.zoneLabel,
            landPrice: area.landPrice,
          })
        : null

    const scope: WorksRegisterScope = {
      method: area.method,
      wkt: area.wkt ?? '',
      summaryLabel: area.summaryLabel ?? '',
      areaSqm: Number(area.areaSqm) || 0,
      recommendName: area.recommendName,
      parcelCount: area.parcelCount ?? fromLocation?.parcelCount,
      landPriceByOwner: area.landPriceByOwner ?? fromLocation?.landPriceByOwner,
      ownershipStats: area.ownershipStats ?? fromLocation?.ownershipStats,
      zoneStats: area.zoneStats ?? fromLocation?.zoneStats,
      locationLabel: area.locationLabel || fromLocation?.locationLabel,
    }
    setDisplayScope(scope)

    const wkt = scope.wkt.trim()
    if (wkt) {
      const runId = ++scopeSummaryRunIdRef.current
      setScopeSummaryLoading(true)
      void fetchWorksRegisterScopeSummary(wkt, {
        runId,
        isCancelled: () => runId !== scopeSummaryRunIdRef.current,
        onProgress: (extra) => {
          if (runId !== scopeSummaryRunIdRef.current) return
          setDisplayScope((prev) => {
            if (!prev || prev.wkt !== wkt) return prev
            return mergeScopeSummary(prev, extra)
          })
        },
      })
        .then((extra) => {
          if (runId !== scopeSummaryRunIdRef.current) return
          setDisplayScope((prev) => {
            if (!prev || prev.wkt !== wkt) return prev
            return mergeScopeSummary(prev, extra)
          })
        })
        .finally(() => {
          if (runId === scopeSummaryRunIdRef.current) setScopeSummaryLoading(false)
        })
    } else {
      setScopeSummaryLoading(false)
    }
  }, [])

  const draw = useWorksRegisterDrawSession({ onConfirmArea: applyConfirmedArea })
  const parcelDetail = useWorksRegisterParcelDetail()

  useAnalysisAreaLayer(
    Boolean(displayScope?.wkt) && draw.drawTool == null,
    displayScope?.wkt || null,
    { layerFlag: 'worksRegisterArea' }
  )

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  useEffect(() => {
    draw.clearDrawSession()
    scopeSummaryRunIdRef.current += 1
    setScopeSummaryLoading(false)
    setLocationOpen(false)
    const fromRecord =
      selectedId && selectedId !== WORKS_REGISTER_NEW_ID
        ? records.find((r) => r.id === selectedId)?.scope ?? null
        : null
    setDisplayScope(fromRecord)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 선택 변경 시 구역·그리기 리셋
  }, [selectedId])

  const handleSave = (saved: WorksRegisterRecord) => {
    if (saved.id === WORKS_REGISTER_NEW_ID) {
      const id = nextWorksRegisterId()
      const next = { ...saved, id }
      setRecords((prev) => [next, ...prev])
      setSelectedId(id)
      setDisplayScope(saved.scope)
      return
    }
    setRecords((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))
    setDisplayScope(saved.scope)
  }

  const handleCloseForm = () => {
    draw.clearDrawSession()
    scopeSummaryRunIdRef.current += 1
    setScopeSummaryLoading(false)
    setDisplayScope(null)
    setLocationOpen(false)
    setSelectedId(null)
  }

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={WORKS_REGISTER_PANEL_MIN_WIDTH}
          maxWidth={WORKS_REGISTER_PANEL_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
        >
          <WorksRegisterPanel
            records={records}
            onClose={onClose}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            onAdd={() => setSelectedId(WORKS_REGISTER_NEW_ID)}
          />
        </MapSideListPanel>
      </div>
      {formRecord && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={formWidth}
            minWidth={WORKS_REGISTER_FORM_MIN_WIDTH}
            maxWidth={WORKS_REGISTER_FORM_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setFormWidth}
            contentClassName="overflow-hidden"
          >
            <WorksRegisterFormPanel
              record={formRecord}
              confirmedScope={displayScope}
              scopeSummaryLoading={scopeSummaryLoading}
              onClose={handleCloseForm}
              onSave={handleSave}
              onStartZoneDraw={() => {
                setLocationOpen(false)
                draw.openToolPicker()
              }}
              onOpenLocationAnalysis={() => {
                draw.clearDrawSession()
                draw.closeToolPicker()
                setLocationOpen(true)
              }}
              onOpenScopeDetail={(scope) => {
                void parcelDetail.openDetail(scope)
              }}
              drawingActive={draw.toolPickerOpen || draw.drawTool != null}
              onScopeCleared={() => {
                setScopeSummaryLoading(false)
                setDisplayScope(null)
              }}
            />
          </MapSideListPanel>
        </div>
      )}

      {formOpen && (
        <WorksRegisterDrawHost
          toolPickerOpen={draw.toolPickerOpen}
          drawTool={draw.drawTool}
          drawPhase={draw.drawPhase}
          drawToolbarAnchor={draw.drawToolbarAnchor}
          onCloseToolPicker={draw.closeToolPicker}
          onStartDraw={draw.startDraw}
          onConfirmDraw={draw.confirmDraw}
          onRedrawShape={draw.redrawShape}
          onCancelDraw={draw.cancelDraw}
        />
      )}

      <WorksRegisterLocationModal
        open={locationOpen}
        onOpenChange={setLocationOpen}
        overlayLeftPx={leftOffsetPx}
        overlayWidthPx={locationOverlayWidth}
        projectName={
          formRecord?.projectDesign.projectName ||
          formRecord?.contract.summary ||
          formRecord?.contractName
        }
        orderDept={formRecord?.contract.contractDept || formRecord?.office}
        constructionType={formRecord?.contract.type}
        onApply={(area) => {
          applyConfirmedArea({
            method: 'location',
            wkt: area.wkt,
            summaryLabel: area.summaryLabel,
            areaSqm: area.areaSqm,
            address: area.address,
            ownership: area.ownership,
            zoneLabel: area.zoneLabel,
            landPrice: area.landPrice,
            recommendName: area.recommendName || area.name,
          })
        }}
      />

      {parcelDetail.detailModals}
    </>
  )
}
