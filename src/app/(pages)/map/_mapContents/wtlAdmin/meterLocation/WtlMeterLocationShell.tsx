'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Printer, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
import { useResolvedThemeSafe } from '@/app/(pages)/(index)/theme-provider'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { PreferRegion } from '../../../_mapComponents/addressSearch/vworldAddressSearch'
import { clusterMeterZones } from './clusterMeterZones'
import {
  locateMeterInputs,
  locateMetersFromKnown,
  type MeterLocateResult,
} from './locateMeterAddresses'
import {
  MeterBulkAddModal,
  type MeterBulkCandidate,
} from './MeterBulkAddModal'
import { MeterNumberSuggestInput } from './MeterNumberSuggestInput'
import { buildMeterLocationReportHtml } from './meterLocationReport'
import { createMeterZoneCaptureSession } from './meterLocationZoneCapture'
import { useMeterParcelLayer } from './useMeterParcelLayer'
import { useWtlMeterWmsLayer } from './useWtlMeterWmsLayer'

const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
const btnGhost =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50'

const DEFAULT_WIDTH = 420
const MIN_WIDTH = 320
const MAX_WIDTH = 720

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

function inputKey(value: string): string {
  return value.replace(/\u00a0/g, ' ').trim().replace(/\s+/g, '')
}

export function WtlMeterLocationShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const mapContext = useMapContext()
  const theme = useResolvedThemeSafe()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [input, setInput] = useState('')
  const [rows, setRows] = useState<MeterLocateResult[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [hoverZoneId, setHoverZoneId] = useState<string | null>(null)
  const [hoverMeterId, setHoverMeterId] = useState<string | null>(null)
  const [zoneFocusKey, setZoneFocusKey] = useState<string | null>(null)
  const [zoneExtent3857, setZoneExtent3857] = useState<
    [number, number, number, number] | null
  >(null)

  /** rowspan 구역 병합용 — standard-list-row 대신 셀 단위 하이라이트 */
  const LIST_HOVER_BG = 'color-mix(in oklab, var(--muted) 55%, transparent)'
  const LIST_SELECTED_BG = 'color-mix(in oklab, var(--primary) 12%, transparent)'
  const [running, setRunning] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportHtml, setReportHtml] = useState('')
  const [reportProgress, setReportProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [notice, setNotice] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const regionRef = useRef<PreferRegion | undefined>(undefined)
  const runRef = useRef(0)
  const reportIframeRef = useRef<HTMLIFrameElement>(null)
  const printAbortRef = useRef<AbortController | null>(null)
  const printSessionRef = useRef<ReturnType<
    typeof createMeterZoneCaptureSession
  > | null>(null)
  const knownReportZonesRef = useRef<Set<string>>(new Set())
  const reportAllRef = useRef<HTMLInputElement>(null)
  const [reportZoneIds, setReportZoneIds] = useState<Set<string>>(new Set())

  /** setState 후 브라우저가 진행률을 그리도록 한 프레임 양보 */
  const yieldToUi = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, 0)
      })
    })

  const cancelPrintCapture = () => {
    printAbortRef.current?.abort()
    printAbortRef.current = null
    printSessionRef.current?.dispose()
    printSessionRef.current = null
  }

  const closeReportModal = () => {
    cancelPrintCapture()
    setReportOpen(false)
    setReportHtml('')
    setReportProgress(null)
    setPrinting(false)
  }

  useEffect(() => {
    onTotalWidthChange(width)
  }, [onTotalWidthChange, width])

  useEffect(() => {
    return () => {
      cancelPrintCapture()
      onTotalWidthChange(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, [onTotalWidthChange])

  useEffect(() => {
    let cancelled = false
    call('', 'POST', {
      service: 'configService',
      action: 'getParcelAnalysisRegionFromFooter',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = (res as { data?: PreferRegion })?.data ?? res
        const sido = String((data as PreferRegion)?.sido ?? '').trim()
        const sigungu = String((data as PreferRegion)?.sigungu ?? '').trim()
        regionRef.current =
          !sido && !sigungu
            ? undefined
            : {
                ...(sido ? { sido } : {}),
                ...(sigungu ? { sigungu } : {}),
              }
      })
      .catch(() => {
        if (!cancelled) regionRef.current = undefined
      })
    return () => {
      cancelled = true
    }
  }, [])

  const zones = useMemo(() => clusterMeterZones(rows), [rows])

  useEffect(() => {
    const ids = zones.filter((z) => z.navigable).map((z) => z.zoneId)
    const known = knownReportZonesRef.current
    const next = new Set<string>()
    for (const id of ids) {
      if (!known.has(id) || reportZoneIds.has(id)) next.add(id)
    }
    knownReportZonesRef.current = new Set(ids)
    setReportZoneIds((prev) => {
      if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })
  }, [zones, reportZoneIds])

  const reportableZoneIds = useMemo(
    () => zones.filter((z) => z.navigable).map((z) => z.zoneId),
    [zones]
  )
  const reportCheckedCount = reportableZoneIds.filter((id) =>
    reportZoneIds.has(id)
  ).length
  const reportAllChecked =
    reportableZoneIds.length > 0 && reportCheckedCount === reportableZoneIds.length
  const reportSomeChecked = reportCheckedCount > 0 && !reportAllChecked

  useEffect(() => {
    if (reportAllRef.current) {
      reportAllRef.current.indeterminate = reportSomeChecked
    }
  }, [reportSomeChecked])

  useMeterParcelLayer(
    rows,
    focusId,
    zoneFocusKey,
    zoneExtent3857,
    selectedZoneId,
    zones
  )
  useWtlMeterWmsLayer(rows, selectedZoneId, zones)

  const rowById = useMemo(() => {
    const map = new Map<string, MeterLocateResult>()
    for (const row of rows) map.set(row.id, row)
    return map
  }, [rows])

  const counts = useMemo(() => {
    const pnuSet = new Set<string>()
    for (const row of rows) {
      const pnu = String(row.pnu ?? '').replace(/\D/g, '').slice(0, 19)
      if (pnu) pnuSet.add(pnu)
    }
    const point = rows.filter((row) => row.status === 'point').length
    const miss = rows.filter((row) => row.status === 'miss').length
    return { parcels: pnuSet.size, point, miss, total: rows.length }
  }, [rows])

  const existingKeys = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) set.add(inputKey(row.input))
    return set
  }, [rows])

  const handleAdd = async () => {
    const line = input.replace(/\u00a0/g, ' ').trim()
    if (!line) {
      setNotice('목록에 추가할 계량기 번호 또는 주소를 입력해주세요.')
      return
    }
    const key = inputKey(line)
    if (rows.some((row) => inputKey(row.input) === key)) {
      setNotice('이미 목록에 있는 항목입니다.')
      return
    }

    const apiKey = mapContext?.vworldApiKey?.trim() ?? ''
    const runId = runRef.current + 1
    runRef.current = runId
    setRunning(true)
    setNotice('')
    try {
      const next = await locateMeterInputs({
        lines: [line],
        apiKey,
        region: regionRef.current,
      })
      if (runRef.current !== runId) return
      const added = next[0]
      if (!added) {
        setNotice('조회 결과가 없습니다.')
        return
      }
      setRows((prev) => [...prev, added])
      setInput('')
      // 추가 후 지도 자동 이동 없음 — 구역/계량기 클릭 시에만 이동
      if (added.status === 'miss') {
        setNotice('위치를 찾지 못했습니다. 목록에는 추가되었습니다.')
      }
    } finally {
      if (runRef.current === runId) setRunning(false)
    }
  }

  const handleClear = () => {
    runRef.current += 1
    setInput('')
    setRows([])
    setFocusId(null)
    setSelectedZoneId(null)
    setHoverZoneId(null)
    setHoverMeterId(null)
    setZoneFocusKey(null)
    setZoneExtent3857(null)
    setNotice('')
    setRunning(false)
    setBulkLoading(false)
  }

  const handleBulkAdd = async (meters: MeterBulkCandidate[]) => {
    const selected = meters
      .map((m) => ({
        meterNo: m.meterNo.trim(),
        address: m.address,
        point: m.point,
      }))
      .filter((m) => m.meterNo && !existingKeys.has(inputKey(m.meterNo)))
    if (selected.length === 0) {
      setNotice('선택한 계량기가 모두 이미 목록에 있습니다.')
      return
    }
    const apiKey = mapContext?.vworldApiKey?.trim() ?? ''
    const runId = runRef.current + 1
    runRef.current = runId
    setBulkLoading(true)
    setNotice('')
    await yieldToUi()
    try {
      // 일괄 목록에 이미 좌표가 있으므로 번호 IN 재조회 없이 필지만 보강
      const next = await locateMetersFromKnown({
        meters: selected,
        apiKey,
        onProgress: async () => {
          if (runRef.current !== runId) return
          await yieldToUi()
        },
      })
      if (runRef.current !== runId) return
      setRows((prev) => [...prev, ...next])
    } finally {
      if (runRef.current === runId) setBulkLoading(false)
    }
  }

  const handleZoneClick = (
    zoneId: string,
    navigable: boolean,
    extent3857: [number, number, number, number] | null
  ) => {
    if (!navigable || !extent3857) return
    setFocusId(null)
    setSelectedZoneId(zoneId)
    setZoneExtent3857([...extent3857] as [number, number, number, number])
    setZoneFocusKey(`${zoneId}-${Date.now()}`)
  }

  const handleMeterClick = (row: MeterLocateResult) => {
    if (row.status === 'miss') return
    setSelectedZoneId(null)
    setZoneFocusKey(null)
    setZoneExtent3857(null)
    setFocusId(row.id)
  }

  const listCellBg = (opts: {
    zoneSelected: boolean
    zoneHovered: boolean
    meterSelected: boolean
    meterHovered: boolean
  }): string | undefined => {
    if (opts.meterSelected || opts.zoneSelected) return LIST_SELECTED_BG
    if (opts.meterHovered || opts.zoneHovered) return LIST_HOVER_BG
    return undefined
  }

  const handlePrintReport = async () => {
    const navigableZones = zones.filter(
      (z) => z.navigable && z.extent3857 && reportZoneIds.has(z.zoneId)
    )
    if (navigableZones.length === 0) {
      setNotice('인쇄할 구역이 없습니다.')
      return
    }
    cancelPrintCapture()
    const abort = new AbortController()
    printAbortRef.current = abort
    const totalZones = navigableZones.length
    setPrinting(true)
    setReportHtml('')
    setReportProgress({ done: 0, total: totalZones })
    setReportOpen(true)
    await yieldToUi()
    if (abort.signal.aborted) return

    const backgroundId =
      mapContext?.mapBackgroundMapIdRef?.current?.trim() || 'aerial-vworld'
    const session = createMeterZoneCaptureSession(backgroundId)
    printSessionRef.current = session
    try {
      const reportZones: Array<{
        zoneLabel: string
        meters: Array<{ meterNo: string; address: string }>
        mapDataUrl: string | null
        mapCaptureStatus: 'ok' | 'failed'
        mapCaptureReason: string
      }> = new Array(totalZones)
      let failCount = 0

      const addressOf = (row: MeterLocateResult): string => {
        const d = String(row.detail ?? '').trim()
        if (
          !d ||
          d === '계량기를 찾지 못했습니다' ||
          d === '위치를 찾지 못했습니다' ||
          d === '조회에 실패했습니다' ||
          d === '필지 경계 없음'
        ) {
          return ''
        }
        return d.replace(/\s*·\s*필지 경계 없음\s*$/, '').trim()
      }

      // 캡처는 숨김 지도에서 해당 구역만 그린다. 목록 선택은 바꾸지 않음.
      for (let i = 0; i < totalZones; i++) {
        if (abort.signal.aborted) return
        const zone = navigableZones[i]!
        if (abort.signal.aborted) return

        const zoneRows = zone.rowIds
          .map((id) => rowById.get(id))
          .filter((r): r is MeterLocateResult => Boolean(r))
        const meters = zoneRows.map((r) => ({
          meterNo: r.input,
          address: addressOf(r),
        }))
        const points = zoneRows
          .filter((r) => r.point4326)
          .map((r) => ({
            label: r.input,
            point4326: r.point4326 as [number, number],
            pnu: r.pnu,
          }))
        const captured = zone.extent3857
          ? await session.captureZone(zone.extent3857, points, abort.signal)
          : {
              dataUrl: null as string | null,
              status: 'failed' as const,
              reason: '구역 범위 없음',
            }
        if (abort.signal.aborted) return
        if (captured.status !== 'ok') failCount += 1
        reportZones[i] = {
          zoneLabel: zone.label,
          meters,
          mapDataUrl: captured.dataUrl,
          mapCaptureStatus: captured.status,
          mapCaptureReason: captured.reason,
        }
        setReportProgress({ done: i + 1, total: totalZones })
        await yieldToUi()
      }

      if (abort.signal.aborted) return

      const reportRows = navigableZones.flatMap((zone) =>
        zone.rowIds
          .map((id) => rowById.get(id))
          .filter((r): r is MeterLocateResult => Boolean(r))
      )
      const parcelSet = new Set<string>()
      for (const row of reportRows) {
        const pnu = String(row.pnu ?? '').replace(/\D/g, '').slice(0, 19)
        if (pnu) parcelSet.add(pnu)
      }
      const html = buildMeterLocationReportHtml({
        zones: reportZones.filter(Boolean),
        parcelCount: parcelSet.size,
        meterCount: reportRows.filter((r) => r.status !== 'miss').length,
      })
      setReportHtml(html)
      setReportProgress(null)
      if (failCount > 0) {
        setNotice(
          `보고서 준비됨 · 지도 캡처 실패 ${failCount}건 (콘솔·보고서 확인)`
        )
      }
    } catch {
      if (abort.signal.aborted) return
      setReportOpen(false)
      setReportProgress(null)
      setNotice('보고서 인쇄에 실패했습니다.')
    } finally {
      if (printSessionRef.current === session) {
        session.dispose()
        printSessionRef.current = null
      }
      if (printAbortRef.current === abort) {
        printAbortRef.current = null
        setPrinting(false)
      }
    }
  }

  useEffect(() => {
    const doc = reportIframeRef.current?.contentDocument
    if (!doc?.documentElement) return
    doc.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme, reportHtml, reportOpen])

  const printReportFromModal = () => {
    if (printing || !reportHtml) return
    const win = reportIframeRef.current?.contentWindow
    if (!win) return
    win.focus()
    win.print()
  }

  return (
    <div className="pointer-events-auto shrink-0">
      <MapSideListPanel
        width={width}
        minWidth={MIN_WIDTH}
        maxWidth={MAX_WIDTH}
        leftOffsetPx={leftOffsetPx}
        onWidthChange={setWidth}
      >
        <div className="standard-panel-root">
          <div className="standard-panel-header">
            <span className="standard-panel-title min-w-0 truncate">계량기위치</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                title={
                  printing
                    ? '캡처 중…'
                    : running
                      ? '조회 중에는 인쇄할 수 없습니다'
                      : reportCheckedCount === 0
                        ? '인쇄할 목록이 없습니다'
                        : '보고서 인쇄'
                }
                disabled={
                  running ||
                  bulkLoading ||
                  printing ||
                  reportCheckedCount === 0
                }
                onClick={() => void handlePrintReport()}
                className="standard-detail-hdr-btn"
              >
                <Printer className="h-3 w-3" aria-hidden />
                {printing ? '캡처 중…' : '보고서 인쇄'}
              </button>
              <button
                type="button"
                className="standard-panel-close cursor-pointer"
                aria-label="닫기"
                title="닫기"
                onClick={onClose}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="standard-filter-section">
            <div className="flex items-center justify-between gap-2">
              <p className="standard-detail-hint min-w-0 flex-1 !text-[11px]">
                목록에 추가할 계량기 번호 또는 주소를 입력해주세요
              </p>
              <button
                type="button"
                disabled={running || bulkLoading}
                title="일괄 입력"
                onClick={() => setBulkOpen(true)}
                className="standard-detail-hdr-btn shrink-0"
              >
                일괄 입력
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <MeterNumberSuggestInput
                value={input}
                onChange={setInput}
                onSubmit={() => void handleAdd()}
                disabled={running || bulkLoading}
                className="standard-detail-input h-7 min-w-0 flex-1 disabled:opacity-50"
                placeholder="계량기 번호 또는 주소"
              />
              <button
                type="button"
                disabled={running || bulkLoading}
                title={running ? '조회 중' : '추가'}
                onClick={() => void handleAdd()}
                className="standard-detail-hdr-btn-save shrink-0"
              >
                {running ? '조회 중' : '추가'}
              </button>
              <button
                type="button"
                title="지우기"
                onClick={handleClear}
                className="standard-detail-hdr-btn shrink-0"
              >
                지우기
              </button>
            </div>
            {notice ? (
              <p className="standard-detail-hint !text-[11px]" aria-live="polite">
                {notice}
              </p>
            ) : null}
          </div>

          {rows.length > 0 ? (
            <div className="standard-list-footer border-b border-t-0">
              필지 {counts.parcels}
              {counts.point > 0 ? ` · 위치만 ${counts.point}` : ''}
              {counts.miss > 0 ? ` · 못 찾음 ${counts.miss}` : ''}
              {zones.filter((z) => z.navigable).length > 0
                ? ` · 구역 ${zones.filter((z) => z.navigable).length}`
                : ''}
            </div>
          ) : null}

          <div className="standard-list-body">
            <div className="standard-list-scroll">
              <table className="standard-list-table">
                <colgroup>
                  <col className="w-[3rem]" />
                  <col className="w-20" />
                  <col />
                </colgroup>
                <thead className="standard-table-thead">
                  <tr>
                    <th className="standard-table-th w-[6.5rem] min-w-[6.5rem] !max-w-none !overflow-visible whitespace-nowrap text-center">
                      <span className="inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap">
                        <input
                          ref={reportAllRef}
                          type="checkbox"
                          title="보고서 전체 선택"
                          checked={reportAllChecked}
                          disabled={reportableZoneIds.length === 0}
                          onChange={(e) => {
                            const on = e.target.checked
                            setReportZoneIds(
                              on ? new Set(reportableZoneIds) : new Set()
                            )
                          }}
                          className="cursor-pointer disabled:cursor-default"
                        />
                        보고서
                      </span>
                    </th>
                    <th className="standard-table-th standard-table-th-left w-20 !max-w-none whitespace-nowrap">
                      구역
                    </th>
                    <th className="standard-table-th standard-table-th-left">
                      계량기 목록
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bulkLoading ? (
                    <tr>
                      <td colSpan={3} className="standard-table-empty">
                        <span className="inline-flex items-center justify-center gap-2">
                          <Loader2
                            className="h-4 w-4 shrink-0 animate-spin text-primary"
                            aria-hidden
                          />
                          일괄 추가 중…
                        </span>
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="standard-table-empty">
                        표시 결과가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    zones.flatMap((zone) =>
                      zone.rowIds.map((rowId, idx) => {
                        const row = rowById.get(rowId)
                        if (!row) return null
                        const zoneSelected = selectedZoneId === zone.zoneId
                        const zoneHovered = hoverZoneId === zone.zoneId
                        const meterSelected = focusId === row.id
                        const meterHovered = hoverMeterId === row.id
                        const zoneCellBg = listCellBg({
                          zoneSelected,
                          zoneHovered,
                          meterSelected: false,
                          meterHovered: false,
                        })
                        const meterCellBg = listCellBg({
                          zoneSelected,
                          zoneHovered,
                          meterSelected,
                          meterHovered,
                        })
                        return (
                          <tr
                            key={`${zone.zoneId}-${row.id}`}
                            className={cn(
                              'border-b border-border',
                              row.status === 'miss' && 'opacity-70'
                            )}
                          >
                            {idx === 0 ? (
                              <>
                                <td
                                  rowSpan={zone.rowIds.length}
                                  className="standard-table-td-text w-[6.5rem] min-w-[6.5rem] !max-w-none !overflow-visible whitespace-nowrap border-r border-border text-center align-top"
                                >
                                  <input
                                    type="checkbox"
                                    title={`${zone.label} 보고서에 포함`}
                                    checked={
                                      zone.navigable && reportZoneIds.has(zone.zoneId)
                                    }
                                    disabled={!zone.navigable}
                                    onChange={(e) => {
                                      const on = e.target.checked
                                      setReportZoneIds((prev) => {
                                        const next = new Set(prev)
                                        if (on) next.add(zone.zoneId)
                                        else next.delete(zone.zoneId)
                                        return next
                                      })
                                    }}
                                    className="cursor-pointer disabled:cursor-default"
                                  />
                                </td>
                                <td
                                  rowSpan={zone.rowIds.length}
                                  title={
                                    zone.navigable
                                      ? `${zone.label}로 이동`
                                      : zone.label
                                  }
                                  className={cn(
                                    'standard-table-td-text align-top font-medium transition-colors border-r border-border',
                                    zone.navigable
                                      ? 'cursor-pointer'
                                      : 'cursor-default text-muted-foreground'
                                  )}
                                  style={
                                    zoneCellBg
                                      ? { backgroundColor: zoneCellBg }
                                      : undefined
                                  }
                                  onMouseEnter={() => {
                                    if (zone.navigable) setHoverZoneId(zone.zoneId)
                                  }}
                                  onMouseLeave={() => setHoverZoneId(null)}
                                  onClick={() =>
                                    handleZoneClick(
                                      zone.zoneId,
                                      zone.navigable,
                                      zone.extent3857
                                    )
                                  }
                                >
                                  {zone.label}
                                </td>
                              </>
                            ) : null}
                            <td
                              className="p-0 transition-colors"
                              style={
                                meterCellBg
                                  ? { backgroundColor: meterCellBg }
                                  : undefined
                              }
                              onMouseEnter={() => {
                                if (row.status !== 'miss') setHoverMeterId(row.id)
                              }}
                              onMouseLeave={() => setHoverMeterId(null)}
                            >
                              <button
                                type="button"
                                disabled={row.status === 'miss'}
                                title={
                                  row.detail
                                    ? `${row.input} ${row.detail}`
                                    : row.input
                                }
                                onClick={() => handleMeterClick(row)}
                                className={cn(
                                  'flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1.5 text-left',
                                  row.status !== 'miss' && 'cursor-pointer',
                                  row.status === 'miss' && 'cursor-default'
                                )}
                              >
                                <span className="shrink-0 truncate text-xs font-medium text-foreground">
                                  {row.input}
                                </span>
                                {row.detail ? (
                                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                                    {row.detail}
                                  </span>
                                ) : null}
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </MapSideListPanel>
      <MeterBulkAddModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onAdd={(meters) => void handleBulkAdd(meters)}
        existingKeys={existingKeys}
      />

      <Dialog
        open={reportOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeReportModal()
            return
          }
          setReportOpen(true)
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,900px)] w-[min(56rem,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden bg-background p-0 text-foreground scheme-light dark:scheme-dark sm:max-w-none sm:rounded-lg">
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
            <DialogTitle className="text-base font-semibold text-foreground">
              계량기위치 보고서
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-background">
            {reportHtml ? (
              <iframe
                ref={reportIframeRef}
                title="계량기위치 보고서 미리보기"
                className="h-[min(70vh,720px)] w-full border-0 bg-background"
                onLoad={(e) => {
                  const doc = e.currentTarget.contentDocument
                  if (!doc?.documentElement) return
                  doc.documentElement.classList.toggle(
                    'dark',
                    document.documentElement.classList.contains('dark')
                  )
                }}
                srcDoc={reportHtml}
              />
            ) : (
              <div
                className="flex h-[min(70vh,720px)] flex-col items-center justify-center gap-3 px-6"
                aria-live="polite"
              >
                <p className="text-sm font-medium text-foreground">
                  {reportProgress
                    ? `지도 캡처 중… (${reportProgress.done} / ${reportProgress.total})`
                    : '보고서 준비 중…'}
                </p>
                {printing ? (
                  <p className="text-xs text-muted-foreground">
                    닫기를 누르면 캡처가 취소됩니다.
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <DialogFooter className="gap-1 border-t border-border px-4 py-2.5 sm:space-x-0">
            <button
              type="button"
              title={printing ? '캡처 취소 후 닫기' : '닫기'}
              className={cn(btnGhost, 'cursor-pointer')}
              onClick={closeReportModal}
            >
              닫기
            </button>
            <button
              type="button"
              title={
                printing || !reportHtml
                  ? '캡처가 끝난 뒤 인쇄할 수 있습니다'
                  : '인쇄 / PDF 저장'
              }
              disabled={printing || !reportHtml}
              className={cn(btnPrimary, 'cursor-pointer disabled:opacity-50')}
              onClick={printReportFromModal}
            >
              <Printer className="h-3 w-3" aria-hidden />
              {printing ? '캡처 중…' : '인쇄 / PDF 저장'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
