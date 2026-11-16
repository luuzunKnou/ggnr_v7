'use client'

import { useEffect, type MutableRefObject } from 'react'
import Feature from 'ol/Feature'
import { LineString, Point } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { locate, to3857, to4326 } from '../leak/WtlLeakResultEdit'
import { lineLen, makeCoverTest, netPath, projectOnNet, sliceFrom, sliceTo, type EditNet, type Pt } from './wtlOutageEditNet'
import {
  BRANCH_COVERED_COST,
  BRANCH_SNAP_PX,
  buffersOf,
  END_JOIN_M,
  MIN_KEEP_M,
  setPanActive,
  START_ON_NET_M,
  type Line3857,
  type OutageEditRefs,
} from './wtlOutageEditShared'
import { OUTAGE_ZONE_BUFFER_DEFAULT_M } from './wtlOutageSample'

/**
 * 단수구역 «선 편집» — 결과선 끝 핸들을 잡고 관로를 따라 끌어 늘이기·줄이기,
 * 선 중간(+)을 잡고 옆 관로로 끌어 새 분기 추가. 결과 반영은 refs.recomputeRef로.
 */
export function useOutageLineEdit({
  active,
  hasResult,
  refs,
  netRef,
  refreshHandlesRef,
}: {
  active: boolean
  hasResult: boolean
  refs: OutageEditRefs
  /** 화면 범위 관망 그래프(도구모음 컴포넌트가 로드) */
  netRef: MutableRefObject<EditNet | null>
  /** 모드·결과가 바뀔 때 끝점 핸들 다시 그리기 — 이 훅이 채움 */
  refreshHandlesRef: MutableRefObject<() => void>
}) {
  const mapContext = useMapContext()
  const { modeRef, resultRef, onNoticeRef, recomputeRef, draggingRef, cancelDragsRef } = refs

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active || !resultRef.current) return

    const handleSource = new VectorSource()
    const handleLayer = new VectorLayer({
      source: handleSource,
      zIndex: 982,
      style: (feature) =>
        String(feature.get('role')) === 'branch'
          ? new Style({
              image: new Circle({
                radius: 8,
                fill: new Fill({ color: '#0f766e' }),
                stroke: new Stroke({ color: '#ffffff', width: 2 }),
              }),
              text: new Text({
                text: '+',
                font: 'bold 13px sans-serif',
                fill: new Fill({ color: '#ffffff' }),
                offsetY: 1,
              }),
            })
          : new Style({
              image: new Circle({
                radius: feature.get('hover') ? 9 : 7,
                fill: new Fill({ color: '#ffffff' }),
                stroke: new Stroke({ color: '#0f766e', width: 3 }),
              }),
            }),
    })
    const previewSource = new VectorSource()
    const previewLayer = new VectorLayer({
      source: previewSource,
      zIndex: 981,
      style: (feature) =>
        String(feature.get('role')) === 'cut'
          ? new Style({ stroke: new Stroke({ color: '#dc2626', width: 4, lineDash: [6, 6], lineCap: 'round' }) })
          : new Style({ stroke: new Stroke({ color: '#0f766e', width: 6, lineCap: 'round' }) }),
    })
    map.addLayer(previewLayer)
    map.addLayer(handleLayer)

    const linesOf = (): Line3857[] =>
      (resultRef.current?.pipes ?? []).filter((line) => line.length >= 2).map((line) => line.map(to3857))

    /** 다른 결과선 끝점과 맞물린 끝(분기 접합)만 빼고 모든 끝점에 핸들 */
    let branchF: Feature<Point> | null = null
    const refreshHandles = () => {
      handleSource.clear()
      branchF = null
      if (modeRef.current !== 'line') return
      const lines = linesOf()
      const ends: { p: Pt; index: number; atStart: boolean }[] = []
      lines.forEach((line, index) => {
        ends.push({ p: line[0], index, atStart: true })
        ends.push({ p: line[line.length - 1], index, atStart: false })
      })
      for (const end of ends) {
        const joined = ends.some(
          (o) => o.index !== end.index && Math.hypot(o.p[0] - end.p[0], o.p[1] - end.p[1]) <= END_JOIN_M
        )
        if (joined) continue
        const f = new Feature({ geometry: new Point(end.p) })
        f.set('role', 'end')
        f.set('index', end.index)
        f.set('atStart', end.atStart)
        handleSource.addFeature(f)
      }
    }
    refreshHandlesRef.current = refreshHandles
    refreshHandles()

    const tolOf = () => Math.max(4, (map.getView().getResolution() ?? 1) * 10)

    const handleAt = (evt: PointerEvent) =>
      map.forEachFeatureAtPixel(
        map.getEventPixel(evt),
        (f) => (f.get('role') === 'end' ? (f as Feature<Point>) : undefined),
        { layerFilter: (l) => l === handleLayer, hitTolerance: 8 }
      )

    /** 핸들이 아닌 단수선 위 지점(새 분기 시작점) */
    const lineSnapAt = (evt: PointerEvent): { index: number; point: Pt } | null => {
      const coord = map.getCoordinateFromPixel(map.getEventPixel(evt)) as Pt
      const tol = (map.getView().getResolution() ?? 1) * BRANCH_SNAP_PX
      let best: { index: number; point: Pt; d: number } | null = null
      linesOf().forEach((line, index) => {
        const hit = locate(coord[0], coord[1], line)
        if (hit.dist <= tol && (!best || hit.dist < best.d)) {
          best = { index, point: hit.point as Pt, d: hit.dist }
        }
      })
      return best
    }

    type Drag = {
      index: number
      feature: Feature<Point>
      /** 핸들이 끝(마지막 점)에 오도록 정렬한 원래 선. 분기면 [시작점] */
      line: Line3857
      reversed: boolean
      total: number
      isCovered: (a: Pt, b: Pt) => boolean
      /** 단수선 중간에서 새 분기를 내는 중 */
      branch: boolean
      kind: 'none' | 'shrink' | 'extend' | 'add'
      next: Line3857
    }
    let drag: Drag | null = null
    let raf = 0
    let pending: Pt | null = null

    const paint = (keep: Line3857, cut: Line3857 | null) => {
      previewSource.clear()
      if (keep.length >= 2) previewSource.addFeature(new Feature({ geometry: new LineString(keep) }))
      if (cut && cut.length >= 2) {
        const f = new Feature({ geometry: new LineString(cut) })
        f.set('role', 'cut')
        previewSource.addFeature(f)
      }
    }

    const update = (coord: Pt) => {
      const d = drag
      if (!d) return
      const tol = tolOf()
      if (d.branch) {
        updateBranch(d, coord, tol)
        return
      }
      const own = locate(coord[0], coord[1], d.line)
      // 선 위로 되돌리면 줄이기
      if (own.dist <= tol && own.along < d.total - 0.3) {
        d.kind = 'shrink'
        d.next = sliceTo(d.line, own.along)
        paint(d.next, sliceFrom(d.line, own.along))
        d.feature.setGeometry(new Point(own.point as Pt))
        return
      }
      // 관로를 따라 늘이기 (선 끝 → 커서 최단 경로, 기존 단수선은 되짚지 않음)
      const net = netRef.current
      const end = d.line[d.line.length - 1]
      const from = net ? projectOnNet(net, end, START_ON_NET_M) : null
      const to = net ? projectOnNet(net, coord, tol) : null
      const path = net && from && to ? netPath(net, from, to, d.isCovered) : null
      if (!path || path.length < 2) {
        d.kind = 'none'
        d.next = d.line
        paint(d.line, null)
        d.feature.setGeometry(new Point(end))
        return
      }
      const ext = [end, ...path.slice(1)]
      if (lineLen(ext) < 0.3) {
        d.kind = 'none'
        d.next = d.line
        paint(d.line, null)
        d.feature.setGeometry(new Point(end))
        return
      }
      d.kind = 'extend'
      d.next = [...d.line, ...path.slice(1)]
      paint(d.next, null)
      d.feature.setGeometry(new Point(ext[ext.length - 1]))
    }

    /**
     * 새 분기: 시작점 → 커서 최단 경로. 접합점까지는 기존 단수선을 비싸게 따라가고,
     * 기존 선을 벗어나는 지점부터 새 선으로 만든다.
     */
    const updateBranch = (d: Drag, coord: Pt, tol: number) => {
      const start = d.line[0]
      const net = netRef.current
      const from = net ? projectOnNet(net, start, START_ON_NET_M) : null
      const to = net ? projectOnNet(net, coord, tol) : null
      const path = net && from && to ? netPath(net, from, to, d.isCovered, BRANCH_COVERED_COST) : null
      let added: Line3857 = []
      if (path && path.length >= 2) {
        const leave = path.findIndex((p, i) => i < path.length - 1 && !d.isCovered(p, path[i + 1]))
        if (leave >= 0) added = path.slice(leave)
      }
      if (added.length < 2 || lineLen(added) < 0.3) {
        d.kind = 'none'
        d.next = d.line
        previewSource.clear()
        d.feature.setGeometry(new Point(start))
        return
      }
      d.kind = 'add'
      d.next = added
      paint(added, null)
      d.feature.setGeometry(new Point(added[added.length - 1]))
    }

    const onWindowMove = (evt: PointerEvent) => {
      if (!drag) return
      pending = map.getCoordinateFromPixel(map.getEventPixel(evt)) as Pt
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (pending) update(pending)
      })
    }

    const finish = () => {
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowCancel)
      window.removeEventListener('blur', onWindowCancel)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      setPanActive(map, true)
      previewSource.clear()
      draggingRef.current = false
      const d = drag
      drag = null
      refreshHandles()
      return d
    }

    function onWindowCancel() {
      if (drag) finish()
    }
    const cancels = cancelDragsRef.current
    cancels.add(onWindowCancel)

    function onWindowUp(evt: PointerEvent) {
      if (drag) update(map!.getCoordinateFromPixel(map!.getEventPixel(evt)) as Pt)
      const d = finish()
      const current = resultRef.current
      if (!d || !current || d.kind === 'none') return
      const lines = linesOf()
      if (!lines[d.index]) return
      const buffers = buffersOf(current)
      const nextLines = lines.slice()
      const nextBuffers = buffers.slice()
      if (d.kind === 'add') {
        // 새 분기는 갈라져 나온 선의 버퍼를 물려받음
        nextLines.push(d.next)
        nextBuffers.push(buffers[d.index] ?? current.bufferM ?? OUTAGE_ZONE_BUFFER_DEFAULT_M)
        recomputeRef.current(nextLines.map((line) => line.map(to4326)), nextBuffers, '분기 추가')
        return
      }
      if (d.kind === 'shrink' && (d.next.length < 2 || lineLen(d.next) < MIN_KEEP_M)) {
        if (lines.length <= 1) {
          onNoticeRef.current('남은 단수 관로가 없어 지울 수 없습니다.')
          return
        }
        nextLines.splice(d.index, 1)
        nextBuffers.splice(d.index, 1)
      } else {
        nextLines[d.index] = d.reversed ? d.next.slice().reverse() : d.next
      }
      recomputeRef.current(
        nextLines.map((line) => line.map(to4326)),
        nextBuffers,
        d.kind === 'shrink' ? '선 줄임' : '선 늘임'
      )
    }

    const onDown = (evt: PointerEvent) => {
      if (modeRef.current !== 'line' || evt.button !== 0) return
      const hit = handleAt(evt)
      if (!hit) {
        startBranch(evt)
        return
      }
      const index = Number(hit.get('index'))
      const lines = linesOf()
      const base = lines[index]
      if (!base) return
      const reversed = Boolean(hit.get('atStart'))
      const line = reversed ? base.slice().reverse() : base
      evt.stopPropagation()
      draggingRef.current = true
      drag = {
        index,
        feature: hit,
        line,
        reversed,
        total: lineLen(line),
        // 모든 단수선(자기 선 포함) 위는 경로에서 제외 → 늘일 때 선을 되짚지 않음
        isCovered: makeCoverTest(lines),
        branch: false,
        kind: 'none',
        next: line,
      }
      if (!netRef.current) onNoticeRef.current('관로를 불러오는 중입니다. 잠시 후 다시 끌어 주세요.')
      setPanActive(map, false)
      window.addEventListener('pointermove', onWindowMove)
      window.addEventListener('pointerup', onWindowUp)
      window.addEventListener('pointercancel', onWindowCancel)
      window.addEventListener('blur', onWindowCancel)
    }

    /** 단수선 중간을 잡으면 그 지점에서 옆 관로로 새 분기를 끈다 */
    const startBranch = (evt: PointerEvent) => {
      const snap = lineSnapAt(evt)
      if (!snap) return
      evt.stopPropagation()
      const lines = linesOf()
      const feature = new Feature({ geometry: new Point(snap.point) })
      feature.set('role', 'end')
      handleSource.addFeature(feature)
      if (branchF) {
        handleSource.removeFeature(branchF)
        branchF = null
      }
      draggingRef.current = true
      drag = {
        index: snap.index,
        feature,
        line: [snap.point],
        reversed: false,
        total: 0,
        isCovered: makeCoverTest(lines),
        branch: true,
        kind: 'none',
        next: [snap.point],
      }
      if (!netRef.current) onNoticeRef.current('관로를 불러오는 중입니다. 잠시 후 다시 끌어 주세요.')
      setPanActive(map, false)
      window.addEventListener('pointermove', onWindowMove)
      window.addEventListener('pointerup', onWindowUp)
      window.addEventListener('pointercancel', onWindowCancel)
      window.addEventListener('blur', onWindowCancel)
    }

    let hovered: Feature<Point> | null = null
    const el = map.getTargetElement()
    const onHover = (evt: PointerEvent) => {
      if (drag || modeRef.current !== 'line') return
      const hit = handleAt(evt) ?? null
      if (hit !== hovered) {
        hovered?.set('hover', false)
        hit?.set('hover', true)
        hovered = hit
      }
      // 핸들이 아니면 단수선 위에 «+» 분기 표시
      const snap = hit ? null : lineSnapAt(evt)
      if (snap) {
        if (!branchF) {
          branchF = new Feature({ geometry: new Point(snap.point) })
          branchF.set('role', 'branch')
          handleSource.addFeature(branchF)
        } else branchF.setGeometry(new Point(snap.point))
      } else if (branchF) {
        handleSource.removeFeature(branchF)
        branchF = null
      }
      if (el) el.style.cursor = hit ? 'grab' : snap ? 'copy' : ''
    }

    const viewport = map.getViewport()
    viewport.addEventListener('pointerdown', onDown, true)
    viewport.addEventListener('pointermove', onHover)
    return () => {
      cancels.delete(onWindowCancel)
      if (drag) finish()
      viewport.removeEventListener('pointerdown', onDown, true)
      viewport.removeEventListener('pointermove', onHover)
      if (el) el.style.cursor = ''
      refreshHandlesRef.current = () => undefined
      map.removeLayer(previewLayer)
      map.removeLayer(handleLayer)
    }
    // refs(…Ref)는 도구모음 컴포넌트의 useRef라 렌더 간 같은 객체 — 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasResult, mapContext?.mapReady, mapContext?.mapInstanceRef])
}
