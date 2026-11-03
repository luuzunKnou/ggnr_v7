'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Printer, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'
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
import { captureZoneMapDataUrl } from './meterLocationZoneCapture'
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
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [input, setInput] = useState('')
  const [rows, setRows] = useState<MeterLocateResult[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [zoneFocusKey, setZoneFocusKey] = useState<string | null>(null)
  const [zoneExtent3857, setZoneExtent3857] = useState<
    [number, number, number, number] | null
  >(null)
  const [running, setRunning] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportHtml, setReportHtml] = useState('')
  const [notice, setNotice] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const regionRef = useRef<PreferRegion | undefined>(undefined)
  const runRef = useRef(0)
  const reportIframeRef = useRef<HTMLIFrameElement>(null)

  useMeterParcelLayer(rows, focusId, zoneFocusKey, zoneExtent3857)
  useWtlMeterWmsLayer()

  useEffect(() => {
    onTotalWidthChange(width)
  }, [onTotalWidthChange, width])

  useEffect(() => {
    return () => onTotalWidthChange(0)
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
    setZoneFocusKey(null)
    setZoneExtent3857(null)
    setNotice('')
    setRunning(false)
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
    setRunning(true)
    setNotice(`일괄 추가 중… (${selected.length}건)`)
    try {
      // 일괄 목록에 이미 좌표가 있으므로 번호 IN 재조회 없이 필지만 보강
      const next = await locateMetersFromKnown({
        meters: selected,
        apiKey,
        onProgress: (done, total) => {
          if (runRef.current !== runId) return
          setNotice(`일괄 추가 중… (${done} / ${total})`)
        },
      })
      if (runRef.current !== runId) return
      setRows((prev) => [...prev, ...next])
      // 추가 후 지도 자동 이동 없음
      const pnuSet = new Set<string>()
      for (const row of next) {
        const pnu = String(row.pnu ?? '').replace(/\D/g, '').slice(0, 19)
        if (pnu) pnuSet.add(pnu)
      }
      const point = next.filter((row) => row.status === 'point').length
      const miss = next.filter((row) => row.status === 'miss').length
      setNotice(
        `일괄 추가 ${next.length}건 · 필지 ${pnuSet.size}` +
          (point > 0 ? ` · 위치만 ${point}` : '') +
          (miss > 0 ? ` · 못 찾음 ${miss}` : '')
      )
    } finally {
      if (runRef.current === runId) setRunning(false)
    }
  }

  const handleZoneClick = (
    zoneId: string,
    navigable: boolean,
    extent3857: [number, number, number, number] | null
  ) => {
    if (!navigable || !extent3857) return
    setFocusId(null)
    setZoneExtent3857([...extent3857] as [number, number, number, number])
    setZoneFocusKey(`${zoneId}-${Date.now()}`)
  }

  const handleMeterClick = (row: MeterLocateResult) => {
    if (row.status === 'miss') return
    setZoneFocusKey(null)
    setZoneExtent3857(null)
    setFocusId(row.id)
  }

  const handlePrintReport = async () => {
    const navigableZones = zones.filter((z) => z.navigable && z.extent3857)
    if (navigableZones.length === 0) {
      setNotice('인쇄할 구역이 없습니다.')
      return
    }
    setPrinting(true)
    setNotice('보고서 지도 캡처 중…')
    const backgroundId =
      mapContext?.mapBackgroundMapIdRef?.current?.trim() || 'aerial-vworld'
    try {
      const reportZones = []
      let failCount = 0
      for (let i = 0; i < navigableZones.length; i++) {
        const zone = navigableZones[i]!
        setNotice(
          `보고서 지도 캡처 중… (${i + 1} / ${navigableZones.length})`
        )
        const zoneRows = zone.rowIds
          .map((id) => rowById.get(id))
          .filter((r): r is MeterLocateResult => Boolean(r))
        const meters = zoneRows.map((r) => r.input)
        const points = zoneRows
          .filter((r) => r.point4326)
          .map((r) => ({
            label: r.input,
            point4326: r.point4326 as [number, number],
            pnu: r.pnu,
          }))
        const captured = zone.extent3857
          ? await captureZoneMapDataUrl(zone.extent3857, points, backgroundId)
          : {
              dataUrl: null as string | null,
              status: 'failed' as const,
              reason: '구역 범위 없음',
            }
        if (captured.status !== 'ok') failCount += 1
        reportZones.push({
          zoneLabel: zone.label,
          meters,
          mapDataUrl: captured.dataUrl,
          mapCaptureStatus: captured.status,
          mapCaptureReason: captured.reason,
        })
      }
      const html = buildMeterLocationReportHtml({
        zones: reportZones,
        parcelCount: counts.parcels,
        meterCount: rows.filter((r) => r.status !== 'miss').length,
      })
      setReportHtml(html)
      setReportOpen(true)
      setNotice(
        failCount > 0
          ? `보고서 준비됨 · 지도 캡처 실패 ${failCount}건 (콘솔·보고서 확인)`
          : ''
      )
    } catch {
      setNotice('보고서 인쇄에 실패했습니다.')
    } finally {
      setPrinting(false)
    }
  }

  const printReportFromModal = () => {
    const win = reportIframeRef.current?.contentWindow
    if (!win) {
      setNotice('보고서 미리보기를 불러오는 중입니다. 잠시 후 다시 시도하세요.')
      return
    }
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
                      : zones.filter((z) => z.navigable).length === 0
                        ? '인쇄할 목록이 없습니다'
                        : '보고서 인쇄'
                }
                disabled={
                  running ||
                  printing ||
                  zones.filter((z) => z.navigable).length === 0
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
                disabled={running}
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
                disabled={running}
                className="standard-detail-input h-7 min-w-0 flex-1 disabled:opacity-50"
                placeholder="계량기 번호 또는 주소"
              />
              <button
                type="button"
                disabled={running}
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
            {notice ? <p className="standard-detail-hint !text-[11px]">{notice}</p> : null}
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
                <thead className="standard-table-thead">
                  <tr>
                    <th className="standard-table-th standard-table-th-left w-20 !max-w-none whitespace-nowrap">
                      구역
                    </th>
                    <th className="standard-table-th standard-table-th-left">
                      계량기 목록
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="standard-table-empty">
                        표시 결과가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    zones.flatMap((zone) =>
                      zone.rowIds.map((rowId, idx) => {
                        const row = rowById.get(rowId)
                        if (!row) return null
                        const selectedMeter = focusId === row.id
                        return (
                          <tr
                            key={`${zone.zoneId}-${row.id}`}
                            className={cn(
                              'standard-list-row',
                              selectedMeter && 'standard-list-row-selected',
                              row.status === 'miss' && 'cursor-default opacity-70'
                            )}
                          >
                            {idx === 0 ? (
                              <td
                                rowSpan={zone.rowIds.length}
                                title={
                                  zone.navigable
                                    ? `${zone.label}로 이동`
                                    : zone.label
                                }
                                className={cn(
                                  'standard-table-td-text align-top font-medium',
                                  zone.navigable
                                    ? 'cursor-pointer hover:text-primary'
                                    : 'text-muted-foreground'
                                )}
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
                            ) : null}
                            <td className="p-0">
                              <button
                                type="button"
                                disabled={row.status === 'miss'}
                                title={row.input}
                                onClick={() => handleMeterClick(row)}
                                className={cn(
                                  'flex w-full flex-col items-start px-2 py-1.5 text-left',
                                  row.status !== 'miss' && 'cursor-pointer',
                                  row.status === 'miss' && 'cursor-default'
                                )}
                              >
                                <span className="block w-full truncate text-xs text-foreground">
                                  {row.input}
                                </span>
                                <span className="block w-full truncate text-[11px] text-muted-foreground">
                                  {row.detail}
                                </span>
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
          setReportOpen(open)
          if (!open) setReportHtml('')
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,900px)] w-[min(56rem,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:rounded-lg">
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
            <DialogTitle className="text-base font-semibold text-foreground">
              계량기위치 보고서
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-muted">
            {reportHtml ? (
              <iframe
                ref={reportIframeRef}
                title="계량기위치 보고서 미리보기"
                className="h-[min(70vh,720px)] w-full border-0 bg-background"
                srcDoc={reportHtml}
              />
            ) : null}
          </div>
          <DialogFooter className="gap-1 border-t border-border px-4 py-2.5 sm:space-x-0">
            <button
              type="button"
              title="닫기"
              className={cn(btnGhost, 'cursor-pointer')}
              onClick={() => setReportOpen(false)}
            >
              닫기
            </button>
            <button
              type="button"
              title="인쇄 / PDF 저장"
              className={cn(btnPrimary, 'cursor-pointer')}
              onClick={printReportFromModal}
            >
              <Printer className="h-3 w-3" aria-hidden />
              인쇄 / PDF 저장
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
