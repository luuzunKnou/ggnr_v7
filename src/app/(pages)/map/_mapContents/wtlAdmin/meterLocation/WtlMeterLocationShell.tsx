'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { PreferRegion } from '../../../_mapComponents/addressSearch/vworldAddressSearch'
import { clusterMeterZones } from './clusterMeterZones'
import {
  locateMeterInputs,
  type MeterLocateResult,
} from './locateMeterAddresses'
import { MeterNumberSuggestInput } from './MeterNumberSuggestInput'
import { useMeterParcelLayer } from './useMeterParcelLayer'
import { useWtlMeterWmsLayer } from './useWtlMeterWmsLayer'

const DEFAULT_WIDTH = 420
const MIN_WIDTH = 320
const MAX_WIDTH = 720

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

function statusLabel(status: MeterLocateResult['status']): string {
  if (status === 'shown') return '표시됨'
  if (status === 'point') return '위치만'
  return '못 찾음'
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
  const [zoneRowIds, setZoneRowIds] = useState<string[] | null>(null)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const regionRef = useRef<PreferRegion | undefined>(undefined)
  const runRef = useRef(0)

  useMeterParcelLayer(rows, focusId, zoneFocusKey, zoneRowIds)
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
    const shown = rows.filter((row) => row.status === 'shown').length
    const point = rows.filter((row) => row.status === 'point').length
    return { shown, point, miss: rows.length - shown - point }
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
      if (added.status !== 'miss') {
        setFocusId(added.id)
        setZoneFocusKey(null)
        setZoneRowIds(null)
      } else {
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
    setZoneRowIds(null)
    setNotice('')
    setRunning(false)
  }

  const handleZoneClick = (zoneId: string, navigable: boolean, ids: string[]) => {
    if (!navigable || ids.length === 0) return
    setFocusId(null)
    setZoneRowIds(ids)
    setZoneFocusKey(`${zoneId}-${Date.now()}`)
  }

  const handleMeterClick = (row: MeterLocateResult) => {
    if (row.status === 'miss') return
    setZoneFocusKey(null)
    setZoneRowIds(null)
    setFocusId(row.id)
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
        <div className="flex h-full min-h-0 flex-col bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2.5">
            <h2 className="text-sm font-semibold text-slate-800">계량기위치</h2>
            <button
              type="button"
              className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="닫기"
              title="닫기"
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <p className="text-xs text-slate-500">
              목록에 추가할 계량기 번호를 입력해주세요
            </p>
            <div className="flex items-center gap-1.5">
              <MeterNumberSuggestInput
                value={input}
                onChange={setInput}
                onSubmit={() => void handleAdd()}
                disabled={running}
                className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs text-slate-800 outline-none focus:border-slate-400 disabled:opacity-50"
                placeholder="계량기 번호 또는 주소"
              />
              <button
                type="button"
                disabled={running}
                title="추가"
                onClick={() => void handleAdd()}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded border border-primary bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {running ? '조회 중' : '추가'}
              </button>
              <button
                type="button"
                title="지우기"
                onClick={handleClear}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                지우기
              </button>
            </div>
            {notice && <p className="text-xs text-slate-600">{notice}</p>}
            {rows.length > 0 && (
              <p className="text-xs text-slate-600">
                필지 {counts.shown}
                {counts.point > 0 ? ` · 위치만 ${counts.point}` : ''}
                {counts.miss > 0 ? ` · 못 찾음 ${counts.miss}` : ''}
                {zones.filter((z) => z.navigable).length > 0
                  ? ` · 구역 ${zones.filter((z) => z.navigable).length}`
                  : ''}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="w-16 px-2 py-1.5 font-medium">구역</th>
                    <th className="px-2 py-1.5 font-medium">계량기 목록</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={2}
                        className="px-2 py-6 text-center text-slate-400"
                      >
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
                              'border-b border-slate-100 last:border-b-0',
                              selectedMeter && 'bg-slate-100'
                            )}
                          >
                            {idx === 0 ? (
                              <td
                                rowSpan={zone.rowIds.length}
                                className={cn(
                                  'align-top border-r border-slate-100 px-2 py-1.5 font-medium text-slate-700',
                                  zone.navigable &&
                                    'cursor-pointer hover:bg-slate-50 hover:text-primary'
                                )}
                              >
                                {zone.navigable ? (
                                  <button
                                    type="button"
                                    title={zone.label}
                                    className="cursor-pointer text-left text-xs font-medium text-inherit"
                                    onClick={() =>
                                      handleZoneClick(
                                        zone.zoneId,
                                        zone.navigable,
                                        zone.rowIds
                                      )
                                    }
                                  >
                                    {zone.label}
                                  </button>
                                ) : (
                                  <span className="text-slate-400">{zone.label}</span>
                                )}
                              </td>
                            ) : null}
                            <td className="px-0 py-0">
                              <button
                                type="button"
                                disabled={row.status === 'miss'}
                                title={row.input}
                                onClick={() => handleMeterClick(row)}
                                className={cn(
                                  'flex w-full items-start justify-between gap-2 px-2 py-1.5 text-left',
                                  row.status !== 'miss' &&
                                    'cursor-pointer hover:bg-slate-50',
                                  row.status === 'miss' && 'cursor-default'
                                )}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-xs text-slate-800">
                                    {row.input}
                                  </span>
                                  <span className="block truncate text-[11px] text-slate-500">
                                    {row.detail}
                                  </span>
                                </span>
                                <span
                                  className={cn(
                                    'shrink-0 text-[11px]',
                                    row.status === 'miss'
                                      ? 'text-slate-400'
                                      : 'text-blue-700'
                                  )}
                                >
                                  {statusLabel(row.status)}
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
    </div>
  )
}
