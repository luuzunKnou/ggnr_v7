'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { PreferRegion } from '../../../_mapComponents/addressSearch/vworldAddressSearch'
import {
  locateMeterInputs,
  parseMeterAddressLines,
  type MeterLocateResult,
} from './locateMeterAddresses'
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

export function WtlMeterLocationShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const mapContext = useMapContext()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [text, setText] = useState('')
  const [rows, setRows] = useState<MeterLocateResult[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [notice, setNotice] = useState('')
  const regionRef = useRef<PreferRegion | undefined>(undefined)
  const runRef = useRef(0)

  useMeterParcelLayer(rows, focusId)
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

  const counts = useMemo(() => {
    const shown = rows.filter((row) => row.status === 'shown').length
    const point = rows.filter((row) => row.status === 'point').length
    return { shown, point, miss: rows.length - shown - point }
  }, [rows])

  const handleShow = async () => {
    const lines = parseMeterAddressLines(text)
    if (lines.length === 0) {
      setNotice('주소 또는 계량기번호를 한 줄에 하나씩 입력하세요.')
      return
    }
    const apiKey = mapContext?.vworldApiKey?.trim() ?? ''
    const runId = runRef.current + 1
    runRef.current = runId
    setRunning(true)
    setNotice('')
    setFocusId(null)
    setProgress(`0 / ${lines.length}`)
    try {
      const next = await locateMeterInputs({
        lines,
        apiKey,
        region: regionRef.current,
        onProgress: (done, total) => {
          if (runRef.current !== runId) return
          setProgress(`${done} / ${total}`)
        },
      })
      if (runRef.current !== runId) return
      setRows(next)
      const placed = next.filter((row) => row.status !== 'miss').length
      setNotice(placed === 0 ? '표시할 위치를 찾지 못했습니다.' : '')
    } finally {
      if (runRef.current === runId) {
        setRunning(false)
        setProgress('')
      }
    }
  }

  const handleClear = () => {
    runRef.current += 1
    setText('')
    setRows([])
    setFocusId(null)
    setNotice('')
    setProgress('')
    setRunning(false)
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
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="닫기"
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <p className="text-xs text-slate-500">
              주소 또는 계량기번호를 한 줄에 하나씩 입력합니다. 섞어 넣어도 됩니다.
            </p>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              className="h-40 w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-slate-400"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={running}
                onClick={() => void handleShow()}
                className="inline-flex h-8 items-center rounded border border-primary bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {running ? '조회 중' : '지도에 표시'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex h-8 items-center rounded border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                지우기
              </button>
              {progress && <span className="text-xs text-slate-500">{progress}</span>}
            </div>
            {notice && <p className="text-xs text-slate-600">{notice}</p>}
            {rows.length > 0 && (
              <p className="text-xs text-slate-600">
                필지 {counts.shown}
                {counts.point > 0 ? ` · 위치만 ${counts.point}` : ''}
                {counts.miss > 0 ? ` · 못 찾음 ${counts.miss}` : ''}
              </p>
            )}
            <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
              {rows.length === 0 ? (
                <li className="px-2 py-6 text-center text-xs text-slate-400">표시 결과가 없습니다.</li>
              ) : (
                rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={row.status === 'miss'}
                      onClick={() => setFocusId(row.id)}
                      className={cn(
                        'flex w-full items-start justify-between gap-2 border-b border-slate-100 px-2 py-1.5 text-left last:border-b-0',
                        row.status !== 'miss' && 'hover:bg-slate-50',
                        focusId === row.id && 'bg-slate-100'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-slate-800">{row.input}</span>
                        <span className="block truncate text-[11px] text-slate-500">{row.detail}</span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-[11px]',
                          row.status === 'miss' ? 'text-slate-400' : 'text-blue-700'
                        )}
                      >
                        {statusLabel(row.status)}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </MapSideListPanel>
    </div>
  )
}
