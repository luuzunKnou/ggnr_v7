'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, RotateCcw, Spline, Undo2, type LucideIcon } from 'lucide-react'
import Feature from 'ol/Feature'
import { LineString } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Stroke, Style } from 'ol/style'
import { unByKey } from 'ol/Observable'
import { transform } from 'ol/proj'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { mapToolbarTopPx } from '../../../../_mapComponents/mapTopHintLayout'
import { useMapToolbarDrag } from '../useMapToolbarDrag'
import { buildEditNet, lineLen, sliceFrom, sliceTo, type EditNet, type Pt } from '../outage/wtlOutageEditNet'
import { useLeakLineDragEdit } from './useLeakLineDragEdit'
import {
  lonLatToView,
  mercatorToView,
  useMapViewProjection,
  viewExtentToMercator,
  viewToLonLat,
} from '../topology/topoMapProjection'
import type { WtlLeakGate, WtlLeakResult } from './wtlLeakSample'

/** line=클릭 추가·Alt 제외 / follow=끝점·분기 드래그(이전 따라 그리기) */
export type LeakEditMode = 'line' | 'follow' | null

/** 클릭으로 고를 때 관로 스냅 거리(px) */
const PIPE_SNAP_PX = 10
/** 미포함 구간·제수변 분할 구간 최소 길이(m) */
const UNCOVERED_MIN_M = 0.3
/** 관로 길이 방향 포함 판정 샘플 간격(m) */
const COVER_SAMPLE_M = 0.5
/** 결과선이 같은 관로 위에 있다고 볼 횡방향 거리(m) */
const ON_PIPE_TOL_M = 0.75
/**
 * 결과선이 이 관로를 «따라» 칠해졌다고 볼 최소 along 길이(m).
 * T자·제수변에서 다른 관 끝점만 스치는 경우는 span≈0이라 덮지 않는다.
 */
const ALONG_COVER_MIN_SPAN_M = 0.8
/** 미포함 구간 사이 이보다 짧은 덮임 구멍은 이어 붙임(틈 방지) */
const UNCOVERED_HOLE_MERGE_M = 0.6
/** 추가 선을 기존 결과 끝에 붙일 때 끝점 허용 거리(m) */
const APPEND_JOIN_M = 1.2
/** 되돌리기 최대 단계 */
const UNDO_MAX = 50

export type NetPipe = { srcTable: string; ftrIdn: string; coords: [number, number][] }
export type NetValve = {
  ftrIdn: string
  x: number
  y: number
  ogcFid?: number
  lon?: number
  lat?: number
  diameter?: string
  address?: string
}

export const VALVE_ON_M = 3
/** 선 제외 시 남은 선 끝·제외 구간 끝의 기존 제수변 유지 거리(m) */
const GATE_CUT_KEEP_M = 1.5

function nearestLine(
  coord: Pt,
  lines: Pt[][],
  tol: number
): { index: number; dist: number; point: Pt } | null {
  let best: { index: number; dist: number; point: Pt } | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line || line.length < 2) continue
    const loc = locate(coord[0], coord[1], line)
    if (loc.dist > tol) continue
    if (!best || loc.dist < best.dist) {
      best = { index: i, dist: loc.dist, point: loc.point as Pt }
    }
  }
  return best
}

/** 결과선 샘플 중 이 관로 위에 있는 along 값들 */
function alongHitsOnPipe(pipe: Pt[], line: Pt[]): number[] {
  if (line.length < 2) return []
  const hits: number[] = []
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]
    const b = line[i]
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.ceil(seg / COVER_SAMPLE_M))
    for (let k = 0; k <= n; k += 1) {
      const t = k / n
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const loc = locate(p[0], p[1], pipe)
      if (loc.dist <= ON_PIPE_TOL_M) hits.push(loc.along)
    }
  }
  return hits
}

/**
 * 물리 관로 중 결과에 아직 안 올라간 연속 구간.
 * 결과선이 이 관로를 따라 일정 길이 이상일 때만 덮인 것으로 본다.
 * (제수변·T자에서 다른 관 끝점만 스치면 span≈0 → 잔여 스텁을 막지 않음)
 */
function uncoveredRuns(pipe: Pt[], against: Pt[][], minKeepM = UNCOVERED_MIN_M): Pt[][] {
  if (pipe.length < 2) return []
  if (against.length === 0) return [pipe]

  const total = lineLen(pipe)
  if (total < minKeepM) return []

  const bins = Math.max(1, Math.ceil(total / COVER_SAMPLE_M))
  const covered = new Array<boolean>(bins + 1).fill(false)
  const markRange = (from: number, to: number) => {
    const a0 = Math.max(0, Math.min(from, to))
    const a1 = Math.min(total, Math.max(from, to))
    if (a1 - a0 < 1e-6) return
    const i0 = Math.floor((a0 / total) * bins)
    const i1 = Math.ceil((a1 / total) * bins)
    for (let i = i0; i <= i1; i += 1) covered[i] = true
  }

  for (const line of against) {
    const hits = alongHitsOnPipe(pipe, line)
    if (hits.length === 0) continue
    let minA = hits[0]
    let maxA = hits[0]
    for (const a of hits) {
      if (a < minA) minA = a
      if (a > maxA) maxA = a
    }
    // 끝점만 스치는 결과선(수직관·옆 관)은 제외
    if (maxA - minA < ALONG_COVER_MIN_SPAN_M) continue
    markRange(minA, maxA)
  }

  const intervals: [number, number][] = []
  let start: number | null = null
  for (let i = 0; i <= bins; i += 1) {
    const along = (i / bins) * total
    if (!covered[i]) {
      if (start == null) start = along
      continue
    }
    if (start != null) {
      intervals.push([start, along])
      start = null
    }
  }
  if (start != null) intervals.push([start, total])

  // 짧은 덮임 구멍(스텁·샘플 오차)은 이어서 한 구간으로 — 제수변~T자 사이 틈 방지
  const merged: [number, number][] = []
  for (const iv of intervals) {
    const last = merged[merged.length - 1]
    if (last && iv[0] - last[1] <= UNCOVERED_HOLE_MERGE_M) {
      last[1] = iv[1]
    } else {
      merged.push([iv[0], iv[1]])
    }
  }

  return merged
    .filter(([a, b]) => b - a >= minKeepM)
    .map(([a, b]) => sliceFrom(sliceTo(pipe, b), a))
    .filter((run) => run.length >= 2 && lineLen(run) >= minKeepM)
}

/**
 * 결과선에서 mask 구간과 겹치는 along 범위를 뺀 나머지.
 * (이어 붙인 긴 결과에서 제수변 한 구간만 Alt+클릭으로 빼기 위함)
 * bin 확장을 쓰지 않고 mask 양 끝의 투영 along만 잘라, 제수변 반대쪽이 같이 잘리지 않게 한다.
 */
function subtractOverlap(
  line: Pt[],
  mask: Pt[],
  minKeepM = UNCOVERED_MIN_M,
  /** 탐색선·관망 좌표 어긋남 허용(기본 ON_PIPE_TOL_M) */
  endTolM = ON_PIPE_TOL_M
): {
  kept: Pt[][]
  removed: Pt[] | null
} {
  if (line.length < 2) return { kept: [], removed: null }
  if (mask.length < 2) return { kept: [line], removed: null }

  const total = lineLen(line)
  // mask 양 끝만 결과선에 투영 — 샘플/bin으로 범위를 넓히면 제수변 반대쪽까지 잘림
  const a0 = locate(mask[0]![0], mask[0]![1], line)
  const a1 = locate(mask[mask.length - 1]![0], mask[mask.length - 1]![1], line)
  if (a0.dist > endTolM || a1.dist > endTolM) {
    return { kept: [line], removed: null }
  }
  const minA = Math.min(a0.along, a1.along)
  const maxA = Math.max(a0.along, a1.along)
  if (maxA - minA < 1e-6) return { kept: [line], removed: null }

  const kept: Pt[][] = []
  if (minA >= minKeepM) {
    const left = sliceTo(line, minA)
    if (left.length >= 2 && lineLen(left) >= minKeepM) kept.push(left)
  }
  if (total - maxA >= minKeepM) {
    const right = sliceFrom(line, maxA)
    if (right.length >= 2 && lineLen(right) >= minKeepM) kept.push(right)
  }
  const removed = sliceFrom(sliceTo(line, maxA), minA)
  return {
    kept,
    removed: removed.length >= 2 ? removed : mask,
  }
}

/** 제수변이 올라앉은 위치에서 관로를 잘라 클릭 단위 구간으로 만든다 */
function splitPipeAtValves(pipe: Pt[], valves: Pt[], cutTol = VALVE_ON_M): Pt[][] {
  if (pipe.length < 2) return []
  const total = lineLen(pipe)
  if (total < UNCOVERED_MIN_M) return [pipe]

  const alongs = [0, total]
  for (const v of valves) {
    const loc = locate(v[0], v[1], pipe)
    if (loc.dist <= cutTol) alongs.push(loc.along)
  }
  alongs.sort((a, b) => a - b)
  const uniq: number[] = []
  for (const a of alongs) {
    const prev = uniq[uniq.length - 1]
    if (prev == null || a - prev >= UNCOVERED_MIN_M) uniq.push(a)
    else if (Math.abs(a - total) < 1e-6) uniq[uniq.length - 1] = total
  }
  if (uniq[0] !== 0) uniq.unshift(0)
  if (uniq[uniq.length - 1] !== total) uniq.push(total)

  const segs: Pt[][] = []
  for (let i = 1; i < uniq.length; i += 1) {
    const a = uniq[i - 1]!
    const b = uniq[i]!
    if (b - a < UNCOVERED_MIN_M) continue
    const run = sliceFrom(sliceTo(pipe, b), a)
    if (run.length >= 2) segs.push(run)
  }
  return segs.length > 0 ? segs : [pipe]
}

/** 끝점이 맞닿으면 기존 결과선에 이어 붙이고, 아니면 새 구간으로 추가 */
function appendMerged(lines: Pt[][], addition: Pt[], joinM = APPEND_JOIN_M): Pt[][] {
  if (addition.length < 2) return lines
  const a0 = addition[0]!
  const a1 = addition[addition.length - 1]!
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= joinM
  const next = lines.map((line) => line.slice())
  for (let i = 0; i < next.length; i += 1) {
    const line = next[i]!
    if (line.length < 2) continue
    const e0 = line[0]!
    const e1 = line[line.length - 1]!
    if (near(e1, a0)) {
      next[i] = [...line, ...addition.slice(1)]
      return next
    }
    if (near(e1, a1)) {
      next[i] = [...line, ...addition.slice().reverse().slice(1)]
      return next
    }
    if (near(e0, a1)) {
      next[i] = [...addition, ...line.slice(1)]
      return next
    }
    if (near(e0, a0)) {
      next[i] = [...addition.slice().reverse(), ...line.slice(1)]
      return next
    }
  }
  return [...next, addition]
}

/**
 * 3857 고정 변환 — 백업 보관 중인 단수 선 편집·버퍼 훅(useOutageLineEdit·useOutageBufferEdit)용.
 * 지도에 그리는 코드는 현재 지도 좌표계를 따르는 topoMapProjection(lonLatToView·viewToLonLat)을 쓴다.
 */
export function to4326(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:3857', 'EPSG:4326')
  return [x, y]
}

export function to3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

export function locate(px: number, py: number, coords: [number, number][]) {
  let walked = 0
  let best = { dist: Infinity, along: 0, point: coords[0] ?? ([px, py] as [number, number]), ux: 1, uy: 0 }
  for (let i = 1; i < coords.length; i += 1) {
    const ax = coords[i - 1][0]
    const ay = coords[i - 1][1]
    const bx = coords[i][0]
    const by = coords[i][1]
    const dx = bx - ax
    const dy = by - ay
    const seg = Math.hypot(dx, dy)
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const cx = ax + t * dx
    const cy = ay + t * dy
    const dist = Math.hypot(px - cx, py - cy)
    const span = seg || 1
    if (dist < best.dist) best = { dist, along: walked + seg * t, point: [cx, cy], ux: dx / span, uy: dy / span }
    walked += seg
  }
  return { ...best, length: walked }
}

export function nearLine(pt: [number, number], line: [number, number][], tol: number) {
  return locate(pt[0], pt[1], line).dist <= tol
}

function toGate(valve: NetValve): WtlLeakGate | null {
  if (valve.ogcFid == null || valve.lon == null || valve.lat == null) return null
  return {
    id: `gate-${valve.ogcFid}`,
    name: String(valve.ogcFid),
    diameter: valve.diameter || '—',
    address: valve.address || '—',
    point: [valve.lon, valve.lat],
  }
}

type Props = {
  active: boolean
  mapLeftPx?: number
  result: WtlLeakResult | null
  mode: LeakEditMode
  onMode: (mode: LeakEditMode) => void
  onChange: (next: WtlLeakResult) => void
  onNotice: (msg: string) => void
}

export function WtlLeakResultEdit({ active, mapLeftPx = 0, result, mode, onMode, onChange, onNotice }: Props) {
  const mapContext = useMapContext()
  /** 현재 지도 좌표계(기본 3857, 카카오 배경이면 5181) — 편집 계산·핸들은 이 좌표로 */
  const viewProj = useMapViewProjection(mapContext?.mapInstanceRef, mapContext?.mapReady)
  const modeRef = useRef(mode)
  const resultRef = useRef(result)
  const onChangeRef = useRef(onChange)
  const onNoticeRef = useRef(onNotice)
  const onModeRef = useRef(onMode)
  const barRef = useRef<HTMLDivElement>(null)
  /** 도구모음 위일 때 선 편집 hover 미리보기 지우기 */
  const clearHoverRef = useRef<(() => void) | null>(null)
  /** 화면 범위 관로(지도 좌표) */
  const netPipesRef = useRef<Pt[][]>([])
  /** 제수변으로 가른 클릭 단위 구간 */
  const netSegsRef = useRef<Pt[][]>([])
  const netValvesRef = useRef<NetValve[]>([])
  /** 따라 그리기용 관망 그래프(3857) */
  const editNetRef = useRef<EditNet | null>(null)
  const refreshHandlesRef = useRef<() => void>(() => undefined)
  const draggingRef = useRef(false)
  const cancelDragsRef = useRef(new Set<() => void>())
  const commitPipesRef = useRef<(pipes: [number, number][][], label: string) => void>(() => undefined)
  /** 편집 전 상태 스냅샷(되돌리기용) */
  const undoRef = useRef<WtlLeakResult[]>([])
  /** 분석·이력 불러오기 직후 결과(초기화 기준) */
  const baselineRef = useRef<WtlLeakResult | null>(null)
  /** 이 컴포넌트가 onChange로 내보낸 결과 — 이게 아니면 외부(새 분석·이력)에서 바뀐 것 */
  const emittedRef = useRef<WtlLeakResult | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  /** 선 편집 중 Alt 누름 — 도구모음 안내를 제외 모드로 바꿈 */
  const [altHeld, setAltHeld] = useState(false)
  modeRef.current = mode
  resultRef.current = result
  onChangeRef.current = onChange
  onNoticeRef.current = onNotice
  onModeRef.current = onMode

  useEffect(() => {
    if (!active || mode !== 'line') {
      setAltHeld(false)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return
      // 브라우저 메뉴로 포커스 뺏기면 keyup이 빠져 안내문구가 멈춤
      e.preventDefault()
      setAltHeld(e.type === 'keydown')
    }
    const syncPointer = (e: PointerEvent) => setAltHeld(e.altKey)
    const clear = () => setAltHeld(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('pointermove', syncPointer)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', clear)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('pointermove', syncPointer)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', clear)
    }
  }, [active, mode])

  const emit = (next: WtlLeakResult) => {
    emittedRef.current = next
    resultRef.current = next
    onChangeRef.current(next)
  }

  /** 편집 결과 반영 — 직전 상태를 되돌리기 스택에 쌓는다 */
  const commitRef = useRef<(next: WtlLeakResult) => void>(() => undefined)
  commitRef.current = (next) => {
    const current = resultRef.current
    if (current) {
      const stack = undoRef.current
      stack.push(current)
      if (stack.length > UNDO_MAX) stack.shift()
      setUndoCount(stack.length)
    }
    emit(next)
  }

  /** 따라 그리기(드래그) 결과 관로 반영 — 남은 선 위 제수변만 유지 */
  commitPipesRef.current = (pipes, label) => {
    const current = resultRef.current
    if (!current) return
    const lines3857 = pipes.filter((line) => line.length >= 2).map((line) => line.map(to3857))
    const gates = current.gates.filter((gate) => {
      const [x, y] = to3857(gate.point)
      return lines3857.some((line) => locate(x, y, line).dist <= VALVE_ON_M)
    })
    commitRef.current({ ...current, pipes, gates })
    onNoticeRef.current(`${label} · 제수변 ${gates.length}개 · 관로 ${pipes.length}구간`)
    refreshHandlesRef.current()
  }

  useLeakLineDragEdit({
    active: Boolean(active && result),
    hasResult: Boolean(result),
    refs: {
      modeRef,
      resultRef,
      onNoticeRef,
      commitPipesRef,
      draggingRef,
      cancelDragsRef,
    },
    netRef: editNetRef,
    refreshHandlesRef,
    barRef,
  })

  useEffect(() => {
    refreshHandlesRef.current()
  }, [mode, result])

  const undoFn = useRef<() => void>(() => undefined)
  const resetFn = useRef<() => void>(() => undefined)
  undoFn.current = () => {
    const prev = undoRef.current.pop()
    setUndoCount(undoRef.current.length)
    if (!prev) {
      onNoticeRef.current('되돌릴 편집이 없습니다.')
      return
    }
    emit(prev)
    onNoticeRef.current(`되돌리기 · 제수변 ${prev.gates.length}개 · 관로 ${prev.pipes.length}구간`)
  }
  resetFn.current = () => {
    const base = baselineRef.current
    const current = resultRef.current
    if (!base || !current || current === base) return
    // 초기화도 되돌리기로 취소할 수 있게 현재 상태를 쌓아 둔다
    undoRef.current.push(current)
    setUndoCount(undoRef.current.length)
    emit(base)
    onNoticeRef.current(`초기화 · 제수변 ${base.gates.length}개 · 관로 ${base.pipes.length}구간`)
  }

  // 외부에서 결과가 바뀌면(새 분석·이력 불러오기) 그 결과를 새 기준으로
  useEffect(() => {
    if (result && result === emittedRef.current) return
    baselineRef.current = result
    emittedRef.current = null
    undoRef.current = []
    setUndoCount(0)
  }, [result])

  // 다른 탭으로 나가면 되돌리기 기록을 비우고 현재 결과를 새 초기화 기준으로
  useEffect(() => {
    if (active) return
    baselineRef.current = resultRef.current
    emittedRef.current = null
    undoRef.current = []
    setUndoCount(0)
  }, [active])

  // Ctrl+Z / Cmd+Z 되돌리기 (입력창 포커스 중이면 무시) · ESC 모드 취소
  const hasResult = Boolean(result)
  useEffect(() => {
    if (!active || !hasResult) return
    const onKey = (event: KeyboardEvent) => {
      // ESC: 선 편집 모드 종료
      if (event.key === 'Escape') {
        if (draggingRef.current) {
          event.preventDefault()
          for (const cancel of cancelDragsRef.current) cancel()
          return
        }
        if (!modeRef.current) return
        event.preventDefault()
        onModeRef.current(null)
        onNoticeRef.current('편집 모드를 취소했습니다.')
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (undoRef.current.length === 0) return
      event.preventDefault()
      undoFn.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, hasResult])

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const stop = (event: Event) => event.stopPropagation()
    const onClick = (event: Event) => {
      event.stopPropagation()
      const action = (event.target as HTMLElement).closest('button')?.getAttribute('data-edit')
      if (action === 'done') onModeRef.current(null)
      else if (action === 'undo') undoFn.current()
      else if (action === 'reset') resetFn.current()
      else if (action === 'line' || action === 'follow') {
        const next = modeRef.current === action ? null : (action as LeakEditMode)
        onModeRef.current(next)
        if (next === 'line') {
          onNoticeRef.current('선 편집 · 클릭하면 추가, Alt+클릭하면 제외')
        } else if (next === 'follow') {
          onNoticeRef.current('따라 그리기 · 끝점을 끌어 늘이거나 줄입니다')
        }
      }
    }
    const types = ['pointerdown', 'pointerup', 'pointermove', 'dblclick', 'mousedown', 'mouseup', 'wheel', 'contextmenu']
    for (const type of types) el.addEventListener(type, stop)
    el.addEventListener('click', onClick)
    // stopPropagation으로 지도 hover가 안 와서, 도구모음 진입 시 미리보기를 직접 지움
    const clearHover = () => clearHoverRef.current?.()
    el.addEventListener('pointerenter', clearHover)
    el.addEventListener('pointermove', clearHover)
    return () => {
      for (const type of types) el.removeEventListener(type, stop)
      el.removeEventListener('click', onClick)
      el.removeEventListener('pointerenter', clearHover)
      el.removeEventListener('pointermove', clearHover)
    }
  })

  // 화면 범위 관망 그래프·제수변 로드 (선 편집용)
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active || !resultRef.current) return
    let seq = 0
    const load = async () => {
      const size = map.getSize()
      if (!size) return
      const [vMinX, vMinY, vMaxX, vMaxY] = map.getView().calculateExtent(size)
      const padX = (vMaxX - vMinX) * 0.5
      const padY = (vMaxY - vMinY) * 0.5
      // 서버는 3857 범위를 받고 관로·제수변 좌표도 3857로 돌려준다
      const [minX, minY, maxX, maxY] = viewExtentToMercator(
        [vMinX - padX, vMinY - padY, vMaxX + padX, vMaxY + padY],
        viewProj
      )
      const mySeq = ++seq
      try {
        const res = await call('', 'POST', {
          service: 'wtlRequestService',
          action: 'listWtlTraceDrawContext',
          params: {
            minX,
            minY,
            maxX,
            maxY,
            pipeLimit: 4000,
          },
        })
        if (mySeq !== seq) return
        const body = (res?.data ?? res) as { pipes?: NetPipe[]; valves?: NetValve[] }
        const mercatorPipes = (body.pipes ?? [])
          .map((p) => p.coords as Pt[])
          .filter((line) => line.length >= 2)
        editNetRef.current = buildEditNet(mercatorPipes)
        const pipes = mercatorPipes
          .map((coords) => coords.map((c) => mercatorToView(c, viewProj) as Pt))
          .filter((line) => line.length >= 2)
        const valves = (body.valves ?? []).map((v) => {
          const [x, y] = mercatorToView([v.x, v.y], viewProj)
          return { ...v, x, y }
        })
        netPipesRef.current = pipes
        netValvesRef.current = valves
        const valvePts = valves.map((v) => [v.x, v.y] as Pt)
        netSegsRef.current = pipes.flatMap((pipe) => splitPipeAtValves(pipe, valvePts))
        refreshHandlesRef.current()
      } catch {
        /* 다음 이동 시 재시도 */
      }
    }
    const key = map.on('moveend', () => {
      void load()
    })
    void load()
    return () => {
      unByKey(key)
      netPipesRef.current = []
      netSegsRef.current = []
      netValvesRef.current = []
      editNetRef.current = null
    }
  }, [active, Boolean(result), mapContext?.mapReady, mapContext?.mapInstanceRef, viewProj])

  // 선 편집 — 클릭 추가 / Alt+클릭 제외
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active || !resultRef.current) return

    const previewSource = new VectorSource()
    const previewLayer = new VectorLayer({
      source: previewSource,
      zIndex: 981,
      style: (feature) =>
        // 추가=빨강(탐색선과 동일). 제외=초록 점선 + 아래 결과 빨강을 가리는 바탕
        String(feature.get('role')) === 'cut'
          ? [
              new Style({
                stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.95)', width: 9, lineCap: 'round' }),
              }),
              new Style({
                stroke: new Stroke({ color: '#0f766e', width: 5, lineDash: [6, 6], lineCap: 'round' }),
              }),
            ]
          : new Style({ stroke: new Stroke({ color: '#dc2626', width: 6, lineCap: 'round' }) }),
    })
    map.addLayer(previewLayer)
    const toView = (c: [number, number]) => lonLatToView(c, viewProj)
    const toLonLat = (c: [number, number]) => viewToLonLat(c, viewProj)

    const linesOf = (): Pt[][] =>
      (resultRef.current?.pipes ?? []).filter((line) => line.length >= 2).map((line) => line.map(toView))

    const tolOf = () => Math.max(3, (map.getView().getResolution() ?? 1) * PIPE_SNAP_PX)

    const paintHover = (line: Pt[] | null, role: 'add' | 'cut' | null) => {
      previewSource.clear()
      if (!line || line.length < 2 || !role) return
      const f = new Feature({ geometry: new LineString(line) })
      f.set('role', role === 'cut' ? 'cut' : 'add')
      previewSource.addFeature(f)
    }

    const minDistToLines = (pt: Pt, lines: Pt[][]) => {
      let best = Infinity
      for (const line of lines) {
        if (line.length < 2) continue
        const d = locate(pt[0], pt[1], line).dist
        if (d < best) best = d
      }
      return best
    }

    const nearLineEnd = (pt: Pt, lines: Pt[][], tolM: number) => {
      for (const line of lines) {
        if (line.length < 2) continue
        const a = line[0]!
        const b = line[line.length - 1]!
        if (Math.hypot(pt[0] - a[0], pt[1] - a[1]) <= tolM) return true
        if (Math.hypot(pt[0] - b[0], pt[1] - b[1]) <= tolM) return true
      }
      return false
    }

    /** 가장 가까운 결과선 끝을 점까지 늘려 제수변 틈을 메움 */
    const extendNearestEndTo = (lines: Pt[][], pt: Pt): Pt[][] => {
      let bestI = -1
      let bestAtStart = false
      let bestD = Infinity
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        if (!line || line.length < 2) continue
        const d0 = Math.hypot(pt[0] - line[0]![0], pt[1] - line[0]![1])
        const d1 = Math.hypot(
          pt[0] - line[line.length - 1]![0],
          pt[1] - line[line.length - 1]![1]
        )
        if (d0 < bestD) {
          bestD = d0
          bestI = i
          bestAtStart = true
        }
        if (d1 < bestD) {
          bestD = d1
          bestI = i
          bestAtStart = false
        }
      }
      if (bestI < 0 || bestD <= 1e-6 || bestD > VALVE_ON_M * 5) return lines
      const next = lines.map((line) => line.slice())
      const line = next[bestI]!
      next[bestI] = bestAtStart ? [pt, ...line] : [...line, pt]
      return next
    }

    /**
     * 제외 후 제수변:
     * - 제외한 선 위에만 있으면 제거
     * - 남은 선 위·끝이면 유지 (살짝 떨어지면 끝만 제수변까지 연장, 제외 선 쪽으로는 안 끌어옴)
     * - 잘린 틈(제외 끝↔남은 끝)에 낀 잠금점만 복구
     */
    const preserveCutGates = (
      current: WtlLeakResult,
      nextLines: Pt[][],
      dropNear: Pt[]
    ): { lines: Pt[][]; gates: WtlLeakGate[] } => {
      let lines = nextLines
      const gates: WtlLeakGate[] = []
      for (const gate of current.gates) {
        const pt = toView(gate.point)
        let dKeep = minDistToLines(pt, lines)
        const dDrop = locate(pt[0], pt[1], dropNear).dist
        // 제외한 관로 위에만 있으면 목록에서 뺌
        if (dDrop <= VALVE_ON_M && dKeep > VALVE_ON_M) continue
        // 남은 선에서 조금 떨어진 잠금점 → 끝에만 붙임
        if (dKeep > GATE_CUT_KEEP_M && dKeep <= VALVE_ON_M * 2) {
          lines = extendNearestEndTo(lines, pt)
          dKeep = minDistToLines(pt, lines)
        }
        if (dKeep <= VALVE_ON_M || nearLineEnd(pt, lines, GATE_CUT_KEEP_M)) {
          gates.push(gate)
          continue
        }
        // 틈에 낀 잠금점(제외 끝·남은 끝 양쪽 근처)
        if (
          nearLineEnd(pt, [dropNear], GATE_CUT_KEEP_M) &&
          nearLineEnd(pt, lines, VALVE_ON_M * 2)
        ) {
          lines = extendNearestEndTo(lines, pt)
          gates.push(gate)
        }
      }
      return { lines, gates }
    }

    /**
     * 추가 시 제수변:
     * - 기존 목록은 유지 (추가 직후 거리 판정 실패로 잠금점이 빠지지 않게)
     * - readdOn 위·소유 제수변만 보강
     */
    const syncGates = (
      current: WtlLeakResult,
      nextLines: Pt[][],
      _dropNear: Pt[] | null = null,
      readdOn: Pt[] | null = null
    ): WtlLeakGate[] => {
      const gates = [...current.gates]
      if (!readdOn || readdOn.length < 2) return gates

      const netSegs =
        netSegsRef.current.length > 0 ? netSegsRef.current : netPipesRef.current
      const seen = new Set(gates.map((gate) => gate.id))
      for (const valve of netValvesRef.current) {
        const dThis = locate(valve.x, valve.y, readdOn).dist
        if (dThis > VALVE_ON_M) continue
        let ownedHere = true
        for (const seg of netSegs) {
          const d = locate(valve.x, valve.y, seg).dist
          if (d + 0.05 < dThis) {
            ownedHere = false
            break
          }
        }
        if (!ownedHere) continue
        const gate = toGate(valve)
        if (!gate || seen.has(gate.id)) continue
        seen.add(gate.id)
        gates.push(gate)
      }
      return gates
    }

    const hitTarget = (coord: Pt, alt: boolean) => {
      const tol = tolOf()
      const resultLines = linesOf()
      const netPipes = netPipesRef.current
      const segs = netSegsRef.current.length > 0 ? netSegsRef.current : netPipes
      if (alt) {
        // 빨간 결과선 위면 반드시 제외 후보. 관망 구간은 여러 후보 중 겹치는 것을 고른다.
        const onResult = nearestLine(coord, resultLines, tol)
        if (!onResult) return null
        const line = resultLines[onResult.index]!
        const lineLenM = lineLen(line)
        const endTol = Math.max(ON_PIPE_TOL_M, tol, VALVE_ON_M)
        type Cut = { kept: Pt[][]; removed: Pt[]; removedLen: number }
        let best: Cut | null = null
        for (const seg of segs) {
          if (seg.length < 2) continue
          if (locate(coord[0], coord[1], seg).dist > tol) continue
          const { kept, removed } = subtractOverlap(line, seg, UNCOVERED_MIN_M, endTol)
          if (!removed) continue
          const removedLen = lineLen(removed)
          if (removedLen < UNCOVERED_MIN_M) continue
          const keptLen = kept.reduce((s, r) => s + lineLen(r), 0)
          // 거의 안 잘리면 스침 — 긴 본선 통째 제외는 금지
          if (keptLen >= lineLenM - UNCOVERED_MIN_M * 0.5) {
            if (lineLenM <= lineLen(seg) * 1.35 && resultLines.length > 1) {
              // 짧은 추가 선(다른 결과선이 남아 있음)만 통째 제외 허용
              const whole: Cut = { kept: [], removed: line, removedLen: lineLenM }
              if (!best || whole.removedLen > best.removedLen) best = whole
            }
            continue
          }
          // 이 결과선 구간을 통째로 빼는 것도 허용(다른 선이 남거나, 짧은 추가분)
          if (kept.length === 0) {
            if (resultLines.length > 1 || lineLenM <= lineLen(seg) * 1.5) {
              const whole: Cut = { kept: [], removed, removedLen }
              if (!best || whole.removedLen > best.removedLen) best = whole
            }
            continue
          }
          const cut: Cut = { kept, removed, removedLen }
          if (!best || cut.removedLen > best.removedLen) best = cut
        }
        if (best) {
          return {
            kind: 'remove-partial' as const,
            index: onResult.index,
            kept: best.kept,
            line: best.removed,
          }
        }
        // 관망 구간과 안 맞으면 클릭 지점→가까운 끝만 자름
        const at = locate(coord[0], coord[1], line)
        const cutTowardEnd = at.along >= lineLenM * 0.5
        const keptOne = cutTowardEnd ? sliceTo(line, at.along) : sliceFrom(line, at.along)
        const removedOne = cutTowardEnd ? sliceFrom(line, at.along) : sliceTo(line, at.along)
        if (removedOne.length >= 2 && lineLen(removedOne) >= UNCOVERED_MIN_M) {
          if (keptOne.length >= 2 && lineLen(keptOne) >= UNCOVERED_MIN_M) {
            return {
              kind: 'remove-partial' as const,
              index: onResult.index,
              kept: [keptOne],
              line: removedOne,
            }
          }
          // 클릭 쪽만 남고 반대가 너무 짧으면 이 선 통째 제외(다른 선이 있을 때)
          if (resultLines.length > 1) {
            return {
              kind: 'remove-partial' as const,
              index: onResult.index,
              kept: [] as Pt[][],
              line,
            }
          }
        }
        return null
      }
      // 제수변으로 가른 구간 단위로 고른 뒤, 그 안의 미포함만 추가
      const onSeg = nearestLine(coord, segs, tol)
      if (!onSeg) return null
      const seg = segs[onSeg.index]!
      const runs = uncoveredRuns(seg, resultLines)
      const nearRun = nearestLine(coord, runs, tol)
      if (nearRun) {
        return { kind: 'add' as const, line: runs[nearRun.index]! }
      }
      // 구간 위인데 미포함이 여러 조각이면 가장 긴 잔여를 제안(짧은 스텁만 잡히는 틈 방지)
      if (runs.length > 0) {
        let best = runs[0]!
        for (const run of runs) {
          if (lineLen(run) > lineLen(best)) best = run
        }
        return { kind: 'add' as const, line: best }
      }
      return { kind: 'already' as const, line: seg }
    }

    const el = map.getTargetElement()
    let lastPixel: number[] | null = null
    const paintCursor = (hasTarget: boolean) => {
      if (!el) return
      if (modeRef.current !== 'line') {
        el.style.cursor = ''
        return
      }
      el.style.cursor = hasTarget ? 'pointer' : ''
    }

    const refreshHover = (alt: boolean) => {
      if (modeRef.current !== 'line' || !lastPixel) {
        paintHover(null, null)
        paintCursor(false)
        return
      }
      const coord = map.getCoordinateFromPixel(lastPixel) as Pt
      const hit = hitTarget(coord, alt)
      if (!hit) {
        paintHover(null, null)
        paintCursor(false)
        return
      }
      paintHover(hit.line, hit.kind === 'add' || hit.kind === 'already' ? 'add' : 'cut')
      paintCursor(true)
    }

    const onToolbar = (evt: Event) => {
      const t = evt.target
      return Boolean(t && barRef.current?.contains(t as Node))
    }

    const clearHover = () => {
      lastPixel = null
      paintHover(null, null)
      paintCursor(false)
    }
    clearHoverRef.current = clearHover

    const onHover = (evt: PointerEvent) => {
      // capture로 도구모음 위도 받음 — 그 아래 관로 미리보기 금지
      if (onToolbar(evt)) {
        clearHover()
        return
      }
      lastPixel = map.getEventPixel(evt)
      refreshHover(evt.altKey)
    }

    const onClick = (evt: PointerEvent) => {
      if (modeRef.current !== 'line' || evt.button !== 0) return
      // capture 단계에서 도구모음 클릭이 관로 추가/제외로 새지 않게
      if (onToolbar(evt)) return
      const current = resultRef.current
      if (!current) return
      const coord = map.getCoordinateFromPixel(map.getEventPixel(evt)) as Pt
      const hit = hitTarget(coord, evt.altKey)
      if (!hit) {
        if (netPipesRef.current.length === 0) {
          onNoticeRef.current('관로를 아직 불러오지 못했습니다. 잠시 후 다시 클릭해 주세요.')
        }
        return
      }
      evt.stopPropagation()
      evt.preventDefault()

      if (hit.kind === 'already') {
        onNoticeRef.current('이미 포함된 관로입니다. Alt+클릭으로 제외할 수 있습니다.')
        return
      }

      const lines = linesOf()
      if (hit.kind === 'add') {
        // 제수변 끝과 맞닿으면 기존 구간에 이어 붙여 틈이 안 남게 함
        const nextLines = appendMerged(lines, hit.line)
        // 추가한 관로 위에 있고, 다른 물리 구간보다 이 관에 가까운 제수변만
        const gates = syncGates(current, nextLines, null, hit.line)
        commitRef.current({ ...current, pipes: nextLines.map((line) => line.map(toLonLat)), gates })
        onNoticeRef.current(`관로 추가 · 제수변 ${gates.length}개 · 관로 ${nextLines.length}구간`)
        return
      }

      if (hit.kind === 'remove-partial') {
        const rawNext = [
          ...lines.slice(0, hit.index),
          ...hit.kept,
          ...lines.slice(hit.index + 1),
        ]
        if (rawNext.length === 0) {
          onNoticeRef.current('남은 관로가 없어 제외할 수 없습니다.')
          return
        }
        // 제외 조각에 붙어 있던 잠금 제수변은 남은 선 끝에 붙이고 목록에 유지
        const preserved = preserveCutGates(current, rawNext, hit.line)
        commitRef.current({
          ...current,
          pipes: preserved.lines.map((line) => line.map(toLonLat)),
          gates: preserved.gates,
        })
        onNoticeRef.current(
          `관로 제외 · 제수변 ${preserved.gates.length}개 · 관로 ${preserved.lines.length}구간`
        )
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return
      e.preventDefault()
      refreshHover(e.type === 'keydown')
    }

    const viewport = map.getViewport()
    viewport.addEventListener('click', onClick, true)
    // capture: 도구모음이 bubble을 막아도 위에서 미리보기를 끔
    viewport.addEventListener('pointermove', onHover, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      clearHoverRef.current = null
      viewport.removeEventListener('click', onClick, true)
      viewport.removeEventListener('pointermove', onHover, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      if (el && modeRef.current === 'line') el.style.cursor = ''
      map.removeLayer(previewLayer)
    }
  }, [active, Boolean(result), mapContext?.mapReady, mapContext?.mapInstanceRef, viewProj])

  const map = mapContext?.mapInstanceRef?.current
  const host = map?.getViewport()
  // 패널(메뉴+목록) 오른쪽 끝 — 도구모음이 패널 뒤로 숨지 않게
  const dragMinX = host ? Math.max(0, mapLeftPx - host.getBoundingClientRect().left) : 0
  const toolbarDrag = useMapToolbarDrag(host, barRef, Boolean(active && result && host), dragMinX)
  if (!active || !result || !host) return null
  const hostLeft = host.getBoundingClientRect().left
  const menuRight = Math.max(0, mapLeftPx - hostLeft)
  const center = menuRight + Math.max(0, host.clientWidth - menuRight) / 2
  const toolbarTopPx = mapToolbarTopPx(Boolean(mapContext?.cadastralZoomHintVisible))

  // 필지분석 DrawToolbarActions 와 같은 알약(pill) 톤
  const lineMode = mode === 'line'
  const followMode = mode === 'follow'
  const editHint = lineMode || followMode
  const pillShell =
    'pointer-events-auto absolute z-30 flex -translate-x-1/2 flex-col overflow-hidden rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur'

  const toggleBtn = (
    id: Exclude<LeakEditMode, null>,
    label: string,
    Icon: LucideIcon,
    title: string
  ) => (
    <button
      type="button"
      data-edit={id}
      aria-pressed={mode === id}
      title={title}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition-colors sm:text-sm',
        mode === id
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )

  const changed = Boolean(baselineRef.current && result !== baselineRef.current)

  const iconBtn = (id: 'undo' | 'reset', label: string, Icon: LucideIcon, disabled: boolean) => (
    <button
      type="button"
      data-edit={id}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
    >
      <Icon className="size-3.5" />
    </button>
  )

  return createPortal(
    <div
      ref={barRef}
      className={pillShell}
      style={{
        ...toolbarDrag.barStyle(center),
        ...(toolbarDrag.moved ? {} : { top: toolbarTopPx }),
      }}
    >
      {/* 위쪽 손잡이 띠 — 폭 전체를 잡고 끌어 이동, 더블클릭하면 원위치 */}
      <span
        ref={toolbarDrag.handleRef}
        role="button"
        tabIndex={-1}
        aria-label="도구모음 이동 (끌기 · 더블클릭: 원위치)"
        title="끌어서 이동 · 더블클릭하면 원위치"
        className="group flex h-3 w-full shrink-0 cursor-grab touch-none items-end justify-center"
      >
        <span className="h-1 w-9 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-muted-foreground/70" />
      </span>
      <div
        className={cn(
          'flex items-center justify-center gap-2 px-4 pt-1',
          editHint ? 'pb-1.5' : 'pb-2'
        )}
      >
        {toggleBtn('line', '선 편집', Spline, '선 편집 — 클릭 추가, Alt+클릭 제외')}
        {/* {toggleBtn('follow', '따라 그리기', Spline, '따라 그리기 — 끝점·분기 드래그')} */}
        <span className="h-5 w-px bg-border" aria-hidden />
        {iconBtn('undo', `되돌리기 (Ctrl+Z)${undoCount > 0 ? ` · ${undoCount}단계` : ''}`, Undo2, undoCount === 0)}
        {iconBtn('reset', '초기화 (분석 직후 상태로)', RotateCcw, !changed)}
        <button
          type="button"
          data-edit="done"
          className="flex cursor-pointer items-center gap-1 rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:text-sm"
        >
          <Check className="size-3.5" />
          완료
        </button>
      </div>
      {lineMode && (
        <div
          className={cn(
            'flex items-center justify-center border-t px-4 py-1.5 text-[11px] font-medium leading-tight transition-colors',
            altHeld
              ? 'border-amber-200/80 bg-amber-500/10 text-amber-800'
              : 'border-border/60 bg-muted/30 text-muted-foreground'
          )}
          role="status"
        >
          {altHeld ? 'Alt+클릭으로 제외' : '클릭 추가 · Alt+클릭 제외'}
        </div>
      )}
      {/* {followMode && (
        <div
          className="flex items-center justify-center border-t border-border/60 bg-muted/30 px-4 py-1.5 text-[11px] font-medium leading-tight text-muted-foreground"
          role="status"
        >
          끝점 끌기 · 선 중간에서 분기
        </div>
      )} */}
    </div>,
    host
  )
}
