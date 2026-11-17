'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import DragPan from 'ol/interaction/DragPan'
import { LineString, Point } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style } from 'ol/style'
import { unByKey } from 'ol/Observable'
import type { MapBrowserEvent } from 'ol'
import { transform } from 'ol/proj'
import { call } from '@/lib/api'
import '../../../_mapComponents/config/projections'
import { useMapContext } from '../../../_mapComponents/MapContext'

export type TraceStrokePipe = { srcTable: string; ftrIdn: string }

type NetPipe = TraceStrokePipe & { coords: [number, number][]; joinFrom?: string }
type NetValve = { x: number; y: number }

function samePipe(a: TraceStrokePipe, b: TraceStrokePipe) {
  return a.srcTable === b.srcTable && a.ftrIdn === b.ftrIdn
}

function pipeKey(pipe: TraceStrokePipe) {
  return `${pipe.srcTable}:${pipe.ftrIdn}`
}

function to3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

function meanDist(line: [number, number][], pipe: [number, number][]) {
  const step = Math.max(1, Math.floor((line.length - 1) / 5))
  let sum = 0
  let n = 0
  for (let i = 0; i < line.length; i += step) {
    sum += closestOnLine(line[i][0], line[i][1], pipe).d
    n += 1
  }
  const last = line[line.length - 1]
  if (last) {
    sum += closestOnLine(last[0], last[1], pipe).d
    n += 1
  }
  return n === 0 ? Infinity : sum / n
}

type BaseHit = { lineIndex: number; pipe: NetPipe }

function closestOnLine(px: number, py: number, coords: [number, number][]) {
  let best = Infinity
  let x = px
  let y = py
  for (let i = 1; i < coords.length; i += 1) {
    const ax = coords[i - 1][0]
    const ay = coords[i - 1][1]
    const bx = coords[i][0]
    const by = coords[i][1]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const cx = ax + t * dx
    const cy = ay + t * dy
    const d = Math.hypot(px - cx, py - cy)
    if (d < best) {
      best = d
      x = cx
      y = cy
    }
  }
  return { d: best, x, y }
}

export function useTraceCaseDraw(
  active: boolean,
  baseLines: [number, number][][],
  lineColor: string,
  onHiddenLines: (indexes: number[]) => void
) {
  const mapContext = useMapContext()
  const [pipeCount, setPipeCount] = useState(0)
  const [baseCount, setBaseCount] = useState(0)
  const [valveNear, setValveNear] = useState(false)
  const pipesRef = useRef<NetPipe[]>([])
  const valvesRef = useRef<NetValve[]>([])
  const strokeRef = useRef<NetPipe[]>([])
  const baseHitsRef = useRef<BaseHit[]>([])
  const startRef = useRef<[number, number] | null>(null)
  const sourceRef = useRef<VectorSource | null>(null)
  const drawingRef = useRef(false)
  const userEditedRef = useRef(false)
  const hiddenKeyRef = useRef('')
  const baseRef = useRef(baseLines)
  const onHiddenRef = useRef(onHiddenLines)
  const colorRef = useRef(lineColor)
  const reseedRef = useRef<() => void>(() => {})
  baseRef.current = baseLines
  onHiddenRef.current = onHiddenLines
  colorRef.current = lineColor

  const publishHidden = useCallback(() => {
    const kept = new Set(strokeRef.current.map(pipeKey))
    const hidden = baseHitsRef.current
      .filter((hit) => !kept.has(pipeKey(hit.pipe)))
      .map((hit) => hit.lineIndex)
    const key = hidden.join(',')
    if (key === hiddenKeyRef.current) return
    hiddenKeyRef.current = key
    onHiddenRef.current(hidden)
  }, [])

  const paint = useCallback((cursor?: [number, number]) => {
    const source = sourceRef.current
    if (!source) return
    source.clear()
    const kept = new Set(baseHitsRef.current.map((hit) => pipeKey(hit.pipe)))
    for (const pipe of strokeRef.current) {
      if (kept.has(pipeKey(pipe))) continue
      if (pipe.coords.length < 2) continue
      const line = new Feature({ geometry: new LineString(pipe.coords) })
      line.set('role', 'stroke')
      source.addFeature(line)
    }
    if (cursor) {
      const mark = new Feature({ geometry: new Point(cursor) })
      mark.set('role', 'cursor')
      source.addFeature(mark)
    }
  }, [])

  const clearStroke = useCallback(() => {
    userEditedRef.current = false
    reseedRef.current()
  }, [])

  const snap = useCallback((coord: [number, number], tol: number) => {
    let best: { pipe: NetPipe; x: number; y: number; d: number } | null = null
    for (const pipe of pipesRef.current) {
      const hit = closestOnLine(coord[0], coord[1], pipe.coords)
      if (hit.d > tol) continue
      if (!best || hit.d < best.d) best = { pipe, x: hit.x, y: hit.y, d: hit.d }
    }
    return best
  }, [])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 960,
      style: (feature) => {
        if (String(feature.get('role')) === 'cursor') {
          return new Style({
            image: new Circle({
              radius: 6,
              fill: new Fill({ color: '#0f766e' }),
              stroke: new Stroke({ color: '#ffffff', width: 2 }),
            }),
          })
        }
        return new Style({
          stroke: new Stroke({ color: colorRef.current, width: 7, lineCap: 'round' }),
        })
      },
    })
    map.addLayer(layer)
    sourceRef.current = source

    const panInteractions = () =>
      map
        .getInteractions()
        .getArray()
        .filter((item) => item instanceof DragPan || item.constructor?.name === 'DragPan')

    const setPan = (enabled: boolean) => {
      for (const pan of panInteractions()) pan.setActive(enabled)
    }

    const tolOf = () => (map.getView().getResolution() ?? 1) * 10

    const strokeIndex = (pipe: NetPipe) => strokeRef.current.findIndex((item) => samePipe(item, pipe))

    const viewport = map.getViewport()
    const holdPan = (evt: PointerEvent) => {
      if (evt.button !== 0) return
      const coord = map.getCoordinateFromPixel(map.getEventPixel(evt)) as [number, number]
      if (!snap(coord, tolOf())) return
      setPan(false)
    }
    viewport.addEventListener('pointerdown', holdPan, true)

    const load = async () => {
      const size = map.getSize()
      if (!size) return
      const [minX, minY, maxX, maxY] = map.getView().calculateExtent(size)
      const res = await call('', 'POST', {
        service: 'wtlRequestService',
        action: 'listWtlTraceDrawContext',
        params: { minX, minY, maxX, maxY },
      })
      const body = (res?.data ?? res) as { pipes?: NetPipe[]; valves?: NetValve[] }
      pipesRef.current = body.pipes ?? []
      valvesRef.current = body.valves ?? []
      if (!userEditedRef.current) reseedRef.current()
    }

    const nearValve = (pt: [number, number]) =>
      valvesRef.current.some((valve) => Math.hypot(valve.x - pt[0], valve.y - pt[1]) <= 40)

    let editMode: 'extend' | null = null
    let anchorKey: string | null = null
    let lastHitKey: string | null = null
    let gestureAdded: string[] = []

    const syncCount = () => {
      setPipeCount(strokeRef.current.length)
      const last = strokeRef.current[strokeRef.current.length - 1]
      const end = last?.coords[last.coords.length - 1]
      setValveNear(end ? nearValve(end) : false)
      publishHidden()
    }

    const reseed = () => {
      const hits: BaseHit[] = []
      const stroke: NetPipe[] = []
      const seen = new Set<string>()
      baseRef.current.forEach((line, lineIndex) => {
        if (line.length < 2) return
        const coords = line.map(to3857)
        let best: NetPipe | null = null
        let bestD = 25
        for (const pipe of pipesRef.current) {
          const dist = meanDist(coords, pipe.coords)
          if (dist < bestD) {
            bestD = dist
            best = pipe
          }
        }
        if (!best) return
        hits.push({ lineIndex, pipe: best })
        const key = pipeKey(best)
        if (seen.has(key)) return
        seen.add(key)
        stroke.push(best)
      })
      baseHitsRef.current = hits
      strokeRef.current = stroke
      userEditedRef.current = false
      const first = stroke[0]?.coords[0]
      startRef.current = first ? [first[0], first[1]] : null
      setPipeCount(stroke.length)
      setBaseCount(stroke.length)
      setValveNear(first ? nearValve(first) : false)
      publishHidden()
      paint()
    }
    reseedRef.current = reseed

    const dropGesture = (keys: Set<string>) => {
      if (keys.size === 0) return
      strokeRef.current = strokeRef.current.filter((pipe) => !keys.has(pipeKey(pipe)))
      gestureAdded = gestureAdded.filter((key) => !keys.has(key))
      userEditedRef.current = true
      syncCount()
    }

    const beginEdit = (hit: { pipe: NetPipe; x: number; y: number }) => {
      const idx = strokeIndex(hit.pipe)
      if (idx < 0) return
      anchorKey = pipeKey(hit.pipe)
      lastHitKey = anchorKey
      gestureAdded = []
      editMode = 'extend'
    }

    const follow = (hit: { pipe: NetPipe; x: number; y: number }) => {
      const key = pipeKey(hit.pipe)
      if (strokeIndex(hit.pipe) >= 0) {
        const at = gestureAdded.indexOf(key)
        if (at >= 0) {
          dropGesture(new Set(gestureAdded.slice(at + 1)))
        } else if (key === anchorKey && gestureAdded.length > 0) {
          dropGesture(new Set(gestureAdded))
        }
        lastHitKey = key
        editMode = 'extend'
        return
      }
      if (editMode !== 'extend' || !lastHitKey) return
      strokeRef.current = [...strokeRef.current, { ...hit.pipe, joinFrom: lastHitKey }]
      gestureAdded = [...gestureAdded, key]
      lastHitKey = key
      userEditedRef.current = true
      syncCount()
    }

    const onDown = (evt: MapBrowserEvent<PointerEvent>) => {
      if (evt.originalEvent.button !== 0) return
      const hit = snap(evt.coordinate as [number, number], tolOf())
      if (!hit) return
      drawingRef.current = true
      setPan(false)
      beginEdit(hit)
      paint([hit.x, hit.y])
    }
    const onMove = (evt: MapBrowserEvent<PointerEvent>) => {
      const coord = evt.coordinate as [number, number]
      if (!drawingRef.current) {
        const hit = snap(coord, tolOf())
        paint(hit ? [hit.x, hit.y] : undefined)
        const el = map.getTargetElement()
        if (el) el.style.cursor = hit ? 'crosshair' : ''
        return
      }
      setPan(false)
      const hit = snap(coord, tolOf())
      if (!hit) {
        paint()
        return
      }
      follow(hit)
      paint([hit.x, hit.y])
    }
    const onUp = () => {
      drawingRef.current = false
      editMode = null
      anchorKey = null
      gestureAdded = []
      setPan(true)
    }

    // OL Map 타입에 pointerdown/up 미포함 — 브라우저 포인터 이벤트로 사용
    const downKey = map.on('pointerdown' as 'pointermove', onDown as never)
    const moveKey = map.on('pointermove', onMove as never)
    const upKey = map.on('pointerup' as 'pointermove', onUp as never)
    const moveEndKey = map.on('moveend', () => {
      void load()
    })
    void load()

    return () => {
      drawingRef.current = false
      setPan(true)
      viewport.removeEventListener('pointerdown', holdPan, true)
      unByKey(downKey)
      unByKey(moveKey)
      unByKey(upKey)
      unByKey(moveEndKey)
      map.removeLayer(layer)
      sourceRef.current = null
      const el = map.getTargetElement()
      if (el) el.style.cursor = ''
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef, paint, publishHidden, snap])

  const editPayload = (
    kind: '연결' | '제수변절단'
  ): { pipes?: TraceStrokePipe[]; start?: [number, number] | null; error?: string } => {
    const basePipes: TraceStrokePipe[] = []
    const seen = new Set<string>()
    for (const hit of baseHitsRef.current) {
      const key = pipeKey(hit.pipe)
      if (seen.has(key)) continue
      seen.add(key)
      basePipes.push({ srcTable: hit.pipe.srcTable, ftrIdn: hit.pipe.ftrIdn })
    }
    const current = strokeRef.current
    const baseSet = new Set(basePipes.map(pipeKey))
    const currentSet = new Set(current.map(pipeKey))
    if (kind === '연결') {
      const added = current.filter((pipe) => !baseSet.has(pipeKey(pipe)))
      if (added.length === 0) return { error: '칠해진 관로에서 선을 더 그리세요.' }
      const last = [...current].reverse().find((pipe) => !baseSet.has(pipeKey(pipe)))
      const chain: NetPipe[] = []
      const seen = new Set<string>()
      let cursor: NetPipe | undefined = last
      while (cursor && !seen.has(pipeKey(cursor))) {
        seen.add(pipeKey(cursor))
        chain.unshift(cursor)
        const from = cursor.joinFrom
        if (!from) break
        cursor = current.find((pipe) => pipeKey(pipe) === from)
      }
      if (chain.length < 2) return { error: '칠해진 관로에서 선을 더 그리세요.' }
      return {
        pipes: chain.map((pipe) => ({ srcTable: pipe.srcTable, ftrIdn: pipe.ftrIdn })),
      }
    }
    const removed = basePipes.filter((pipe) => !currentSet.has(pipeKey(pipe)))
    if (removed.length === 0) return { error: '탐색된 선을 앞쪽으로 줄이세요.' }
    const last = current[current.length - 1]
    const end = last?.coords[last.coords.length - 1]
    return { pipes: removed, start: end ? ([end[0], end[1]] as [number, number]) : null }
  }

  const casePayload = (): { pipes?: TraceStrokePipe[]; error?: string } => {
    const baseSet = new Set(baseHitsRef.current.map((hit) => pipeKey(hit.pipe)))
    const seen = new Set<string>()
    const pipes: TraceStrokePipe[] = []
    for (const pipe of strokeRef.current) {
      const key = pipeKey(pipe)
      if (baseSet.has(key) || seen.has(key)) continue
      seen.add(key)
      pipes.push({ srcTable: pipe.srcTable, ftrIdn: pipe.ftrIdn })
    }
    if (pipes.length === 0) return { error: '칠해진 관로에서 선을 더 그리세요.' }
    return { pipes }
  }

  return {
    pipeCount,
    baseCount,
    valveNear,
    clearStroke,
    editPayload,
    casePayload,
  }
}
