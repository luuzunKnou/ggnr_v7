'use client'

import { useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import { LineString } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Stroke, Style } from 'ol/style'
import { transform } from 'ol/proj'
import { call } from '@/lib/api'
import '../../../_mapComponents/config/projections'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { useTraceCaseDraw } from './useTraceCaseDraw'

export type WtlTraceCaseFeature = '단수' | '누수'

type CaseRow = {
  requestId: number
  status: string
  memo: string
  ruleLabel: string
  pipes: string
  valves: string
  requestUser: string
}

type Review = {
  savedValves: string
  currentValves: string
  same: boolean
}

type Props = {
  feature: WtlTraceCaseFeature
  baseLines: [number, number][][]
  lineColor?: string
  origin?: [number, number] | null
  originCrs?: '3857' | '4326'
  originKey?: string
  onHiddenLines: (indexes: number[]) => void
  onClose: () => void
  onNotice: (msg: string) => void
}

function to3857(coord: [number, number], crs: '3857' | '4326'): [number, number] {
  if (crs === '3857') return coord
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

export function TraceCaseCapture({
  feature,
  baseLines,
  lineColor = '#ea580c',
  origin = null,
  originCrs = '3857',
  originKey = '',
  onHiddenLines,
  onClose,
  onNotice,
}: Props) {
  const mapContext = useMapContext()
  const reviewLayer = useRef<VectorLayer<VectorSource> | null>(null)
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<CaseRow[]>([])
  const [canReview, setCanReview] = useState(false)
  const [ruleDraft, setRuleDraft] = useState<Record<number, string>>({})
  const [review, setReview] = useState<Review | null>(null)
  const draw = useTraceCaseDraw(true, baseLines, lineColor, onHiddenLines)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 970,
      style: (line) =>
        new Style({
          stroke: new Stroke({
            color: String(line.get('role')) === 'saved' ? '#0f766e' : '#ea580c',
            width: String(line.get('role')) === 'saved' ? 6 : 3,
            lineDash: String(line.get('role')) === 'saved' ? undefined : [8, 6],
          }),
        }),
    })
    map.addLayer(layer)
    reviewLayer.current = layer
    return () => {
      map.removeLayer(layer)
      reviewLayer.current = null
      onHiddenLines([])
    }
  }, [mapContext?.mapReady, mapContext?.mapInstanceRef, onHiddenLines])

  const reload = async () => {
    const res = await call('', 'POST', {
      service: 'wtlRequestService',
      action: 'listWtlTraceCases',
      params: { feature },
    })
    const body = (res?.data ?? res) as {
      rows?: CaseRow[]
      canExecute?: boolean
      error?: string
    }
    if (body.error) {
      onNotice(body.error)
      return
    }
    setRows(body.rows ?? [])
    setCanReview(Boolean(body.canExecute))
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature])

  const submit = async () => {
    const payload = draw.casePayload()
    if (payload.error || !payload.pipes) {
      onNotice(payload.error ?? '칠해진 관로에서 선을 더 그리세요.')
      return
    }
    if (!origin) {
      onNotice('탐색 시작 지점이 없습니다.')
      return
    }
    const [originX, originY] = to3857(origin, originCrs)
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlRequestService',
        action: 'submitWtlTraceCase',
        params: {
          feature,
          editKind: '탐색케이스',
          pipes: payload.pipes,
          originX,
          originY,
          originKey,
          memo: memo.trim(),
        },
      })
      const body = (res?.data ?? res) as { error?: string; pipeCount?: number }
      if (body.error) {
        onNotice(body.error)
        return
      }
      onNotice(`케이스를 저장했습니다. 관로 ${body.pipeCount ?? payload.pipes.length}개`)
      setMemo('')
      draw.clearStroke()
      await reload()
    } catch {
      onNotice('케이스 저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const assignRule = async (requestId: number, newRule: boolean) => {
    const ruleLabel = (ruleDraft[requestId] ?? '').trim()
    if (!newRule && !ruleLabel) {
      onNotice('규칙 이름을 입력하세요.')
      return
    }
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlRequestService',
        action: 'assignWtlTraceCaseRule',
        params: { requestId, ruleLabel, newRule },
      })
      const body = (res?.data ?? res) as { error?: string }
      if (body.error) {
        onNotice(body.error)
        return
      }
      onNotice(newRule ? '이 지점의 다음 탐색에 저장한 구간이 더해집니다.' : '규칙 이름을 붙였습니다.')
      await reload()
    } catch {
      onNotice('규칙 지정에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const paintReview = (saved: [number, number][][], current: [number, number][][], at: [number, number]) => {
    const source = reviewLayer.current?.getSource()
    const map = mapContext?.mapInstanceRef?.current
    if (!source || !map) return
    source.clear()
    const add = (lines: [number, number][][], role: string) => {
      for (const line of lines) {
        if (line.length < 2) continue
        const feature = new Feature({ geometry: new LineString(line.map((coord) => to3857(coord, '4326'))) })
        feature.set('role', role)
        source.addFeature(feature)
      }
    }
    add(saved, 'saved')
    add(current, 'current')
    map.getView().animate({ center: at, zoom: Math.max(map.getView().getZoom() ?? 16, 17), duration: 400 })
  }

  const openCase = async (requestId: number) => {
    setBusy(true)
    try {
      const res = await call('', 'POST', {
        service: 'wtlRequestService',
        action: 'previewWtlTraceCase',
        params: { requestId },
      })
      const body = (res?.data ?? res) as {
        error?: string
        originX?: number
        originY?: number
        savedValves?: string
        currentValves?: string
        savedPipes?: [number, number][][]
        currentPipes?: [number, number][][]
        same?: boolean
      }
      if (body.error || body.originX == null || body.originY == null) {
        onNotice(body.error ?? '케이스를 열지 못했습니다.')
        return
      }
      setReview({
        savedValves: body.savedValves ?? '',
        currentValves: body.currentValves ?? '',
        same: Boolean(body.same),
      })
      paintReview(body.savedPipes ?? [], body.currentPipes ?? [], [body.originX, body.originY])
    } catch {
      onNotice('케이스를 열지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const hint =
    '맞는 선이 되도록 칠해진 관로에서 이어 그립니다. 새 규칙은 그 지점의 기존 탐색에 이어 그린 구간만 더합니다.'

  return (
    <div className="mt-2 rounded border border-[#99d4c8] bg-[#f3fbf8] p-2 text-[11px] text-[#134e48]">
      <div className="mb-1.5 flex items-center gap-1">
        <span className="font-semibold">케이스 수집 · {feature}</span>
        <button type="button" className="ml-auto text-[#64748b]" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="mb-1.5 text-[10px] leading-snug">{hint}</p>
      <p className="mb-1.5 text-[10px]">
        현재 {draw.pipeCount}개 · 처음 {draw.baseCount}개
      </p>
      <input
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="메모"
        className="mb-1.5 w-full rounded border border-[#cbd5e1] bg-white px-2 py-1"
      />
      <div className="flex gap-1">
        <button type="button" className="rounded bg-white px-2 py-1" onClick={draw.clearStroke}>
          처음 선으로
        </button>
        <button
          type="button"
          disabled={busy || draw.pipeCount === 0}
          className="rounded bg-[#0f766e] px-2 py-1 font-semibold text-white disabled:opacity-40"
          onClick={() => void submit()}
        >
          케이스 저장
        </button>
      </div>
      {review && (
        <p className="mt-2 text-[10px] leading-snug">
          {review.same ? '현재 탐색과 같습니다.' : '현재 탐색과 다릅니다.'} 초록이 저장, 주황이 현재입니다.
          <br />
          저장 제수변 {review.savedValves || '없음'} · 현재 {review.currentValves || '없음'}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1.5 overflow-auto">
          {rows.map((row) => (
            <li key={row.requestId} className="rounded bg-white/70 px-1.5 py-1">
              <p className="truncate">
                {row.status === '규칙' ? '규칙' : row.ruleLabel || '미정'} · {row.pipes}
                {row.valves ? ` · 제수변 ${row.valves}` : ''}
                {row.memo ? ` · ${row.memo}` : ''}
              </p>
              <button
                type="button"
                disabled={busy}
                className="mt-1 rounded bg-white px-1.5 py-0.5"
                onClick={() => void openCase(row.requestId)}
              >
                열기
              </button>
              {canReview && (
                <div className="mt-1 flex gap-1">
                  <input
                    value={ruleDraft[row.requestId] ?? ''}
                    onChange={(e) => setRuleDraft((prev) => ({ ...prev, [row.requestId]: e.target.value }))}
                    placeholder="규칙 이름"
                    className="min-w-0 flex-1 rounded border border-[#cbd5e1] bg-white px-1.5 py-0.5"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="shrink-0 rounded bg-[#134e48] px-1.5 py-0.5 text-white"
                    onClick={() => void assignRule(row.requestId, false)}
                  >
                    지정
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="shrink-0 rounded bg-white px-1.5 py-0.5"
                    onClick={() => void assignRule(row.requestId, true)}
                  >
                    새 규칙
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
