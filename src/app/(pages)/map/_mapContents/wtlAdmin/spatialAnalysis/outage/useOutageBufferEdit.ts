'use client'

import { useEffect, type MutableRefObject } from 'react'
import Feature from 'ol/Feature'
import { LineString, MultiLineString, Point } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { call } from '@/lib/api'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { locate, to3857 } from '../leak/WtlLeakResultEdit'
import type { Pt } from './wtlOutageEditNet'
import {
  buffersOf,
  clampBuffer,
  DIM_ZONE_OPACITY,
  lineOwningOutline,
  OUTLINE_SNAP_PX,
  PREVIEW_DELAY_MS,
  ringsToPolygons,
  setPanActive,
  type Line3857,
  type OutageEditRefs,
  type ZoneBody,
} from './wtlOutageEditShared'

/**
 * 단수구역 «버퍼» — 단수 면 외곽선에 스냅해 끌면 그 외곽을 만드는 관로의 버퍼만 조정.
 * 끄는 동안 즉시 미리보기, 멈추면 서버 정확한 면, 놓으면 refs.recomputeRef로 반영.
 */
export function useOutageBufferEdit({
  active,
  hasResult,
  refs,
  refreshOutlineRef,
}: {
  active: boolean
  hasResult: boolean
  refs: OutageEditRefs
  /** 모드·결과가 바뀔 때 외곽선 다시 그리기 — 이 훅이 채움 */
  refreshOutlineRef: MutableRefObject<() => void>
}) {
  const mapContext = useMapContext()
  const { modeRef, resultRef, recomputeRef, draggingRef, cancelDragsRef } = refs

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active || !resultRef.current) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 985,
      style: (feature, resolution) => {
        const role = String(feature.get('role'))
        if (role === 'snap') {
          return new Style({
            image: new Circle({
              radius: 7,
              fill: new Fill({ color: '#ffffff' }),
              stroke: new Stroke({ color: '#0f766e', width: 3 }),
            }),
            // 값 라벨 — 위성지도 위에서도 읽히게 배경 칩
            text: new Text({
              text: String(feature.get('label') ?? ''),
              offsetY: -24,
              font: 'bold 13px sans-serif',
              fill: new Fill({ color: '#ffffff' }),
              backgroundFill: new Fill({ color: feature.get('dragging') ? '#b45309' : '#0f766e' }),
              padding: [3, 6, 3, 6],
            }),
          })
        }
        if (role === 'target') {
          // 조정 대상 외곽 구간 — 흰 테두리 + 초록 굵은 선
          return [
            new Style({ stroke: new Stroke({ color: '#ffffff', width: 7, lineCap: 'round', lineJoin: 'round' }) }),
            new Style({ stroke: new Stroke({ color: '#0f766e', width: 4, lineCap: 'round', lineJoin: 'round' }) }),
          ]
        }
        if (role === 'outline') {
          return new Style({ stroke: new Stroke({ color: 'rgba(15, 118, 110, 0.55)', width: 2 }) })
        }
        if (role === 'live') {
          // 즉시 미리보기: 관로를 «버퍼×2» 두께 둥근 선으로 그리면 그 관로 버퍼 모양과 같다(3857 m 기준)
          const meters = Number(feature.get('bufferM')) || 0
          const px = (meters * 2) / (resolution || 1)
          return [
            new Style({
              stroke: new Stroke({
                color: 'rgba(250, 204, 21, 0.45)',
                width: Math.max(2, px),
                lineCap: 'round',
                lineJoin: 'round',
              }),
            }),
            new Style({ stroke: new Stroke({ color: '#d97706', width: 2, lineDash: [6, 4] }) }),
          ]
        }
        // 정확한 미리보기 면(서버) — 기존 빨간 단수 면과 확실히 구분되게 노란 채움 + 흰 테두리 주황 점선
        return [
          new Style({
            fill: new Fill({ color: 'rgba(250, 204, 21, 0.35)' }),
            stroke: new Stroke({ color: '#ffffff', width: 6 }),
          }),
          new Style({
            stroke: new Stroke({ color: '#d97706', width: 3, lineDash: [10, 6] }),
          }),
        ]
      },
    })
    map.addLayer(layer)

    const linesOf = (): Line3857[] =>
      (resultRef.current?.pipes ?? []).filter((line) => line.length >= 2).map((line) => line.map(to3857))
    const outlinesOf = (): Line3857[] => {
      const current = resultRef.current
      if (!current) return []
      const rings = current.rings && current.rings.length > 0 ? current.rings : [current.ring]
      return rings.filter((r) => r.length >= 3).map((r) => r.map(to3857))
    }

    let snapF: Feature<Point> | null = null
    let targetF: Feature<MultiLineString> | null = null
    /** 외곽선 꼭짓점마다 그 외곽을 만드는 관로 번호(호버마다 다시 계산하지 않게 캐시) */
    let owners: { ring: Line3857; owner: number[] }[] = []

    const computeOwners = () => {
      const current = resultRef.current
      if (!current) {
        owners = []
        return
      }
      const lines = linesOf()
      const buffers = buffersOf(current)
      owners = outlinesOf().map((ring) => ({
        ring,
        owner: ring.map((p) => lineOwningOutline(p, lines, buffers)),
      }))
    }

    /** index 관로가 만드는 외곽선 구간들(경계 꼭짓점까지 포함해 끊김 없이) */
    const outlinePartsOf = (index: number): Line3857[] => {
      const parts: Line3857[] = []
      for (const { ring, owner } of owners) {
        const n = ring.length
        if (n < 2) continue
        const inSeg = (i: number) => owner[i] === index || owner[(i + 1) % n] === index
        // 고리 시작이 구간 중간이면 이어 붙이기 위해, 구간 밖 지점에서 출발
        let startAt = 0
        while (startAt < n - 1 && inSeg(startAt)) startAt += 1
        let run: Line3857 = []
        for (let k = 0; k < n - 1; k += 1) {
          const i = (startAt + k) % (n - 1)
          if (inSeg(i)) {
            if (run.length === 0) run.push(ring[i])
            run.push(ring[(i + 1) % n])
          } else if (run.length > 0) {
            parts.push(run)
            run = []
          }
        }
        if (run.length >= 2) parts.push(run)
      }
      return parts
    }
    const clearRole = (role: string) => {
      for (const f of source.getFeatures()) if (f.get('role') === role) source.removeFeature(f)
    }
    const refreshOutline = () => {
      clearRole('outline')
      if (modeRef.current !== 'buffer') {
        source.clear()
        snapF = null
        targetF = null
        return
      }
      for (const ring of outlinesOf()) {
        const f = new Feature({ geometry: new LineString(ring) })
        f.set('role', 'outline')
        source.addFeature(f)
      }
      computeOwners()
      if (targetF) {
        source.removeFeature(targetF)
        targetF = null
      }
    }
    refreshOutlineRef.current = refreshOutline
    refreshOutline()

    const showSnap = (p: Pt | null, label: string, targetIndex: number | null) => {
      if (!p) {
        if (snapF) source.removeFeature(snapF)
        if (targetF) source.removeFeature(targetF)
        snapF = null
        targetF = null
        return
      }
      if (!snapF) {
        snapF = new Feature({ geometry: new Point(p) })
        snapF.set('role', 'snap')
        source.addFeature(snapF)
      } else snapF.setGeometry(new Point(p))
      snapF.set('label', label)
      if (targetIndex != null && targetIndex >= 0) {
        if (targetF?.get('index') === targetIndex) return
        const geom = new MultiLineString(outlinePartsOf(targetIndex))
        if (!targetF) {
          targetF = new Feature({ geometry: geom })
          targetF.set('role', 'target')
          source.addFeature(targetF)
        } else targetF.setGeometry(geom)
        targetF.set('index', targetIndex)
      }
    }

    /** 커서에서 가장 가까운 외곽선 점(스냅 거리 안) */
    const snapToOutline = (coord: Pt): Pt | null => {
      const tol = (map.getView().getResolution() ?? 1) * OUTLINE_SNAP_PX
      let best: Pt | null = null
      let bestD = Infinity
      for (const ring of outlinesOf()) {
        const hit = locate(coord[0], coord[1], ring)
        if (hit.dist <= tol && hit.dist < bestD) {
          bestD = hit.dist
          best = hit.point as Pt
        }
      }
      return best
    }

    type Drag = { index: number; buffers: number[]; value: number }
    let drag: Drag | null = null
    let previewTimer: ReturnType<typeof setTimeout> | null = null
    let previewSeq = 0
    let liveF: Feature<LineString> | null = null

    /** 끄는 관로만 즉시 그리기(서버 호출 없음) */
    const showLive = (line: Line3857 | null, meters: number) => {
      if (!line) {
        if (liveF) source.removeFeature(liveF)
        liveF = null
        return
      }
      if (!liveF) {
        liveF = new Feature({ geometry: new LineString(line) })
        liveF.set('role', 'live')
        source.addFeature(liveF)
      }
      liveF.set('bufferM', meters)
    }

    /** 끄는 동안 기존 단수 면(빨강)을 흐리게 — 줄어드는 범위가 보이도록 */
    const zoneLayer = () =>
      map
        .getLayers()
        .getArray()
        .find((l) => l.get('wtlOutage') === true)
    const dimZone = (on: boolean) => zoneLayer()?.setOpacity(on ? DIM_ZONE_OPACITY : 1)

    const showZonePreview = (buffers: number[]) => {
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = setTimeout(async () => {
        const seq = ++previewSeq
        try {
          const res = await call('', 'POST', {
            service: 'wtlOutageService',
            action: 'buildWtlOutageZone',
            params: {
              pipes: resultRef.current?.pipes ?? [],
              bufferMs: buffers,
              extraRings: resultRef.current?.buildingRings ?? [],
              withTargets: false,
            },
          })
          if (seq !== previewSeq || !drag) return
          const body = ((res as { data?: ZoneBody })?.data ?? res) as ZoneBody
          // 그새 값이 바뀌었으면 버림(즉시 미리보기가 더 최신)
          if (buffers[drag.index] !== drag.value) return
          clearRole('zone')
          showLive(null, 0)
          for (const poly of ringsToPolygons(body.rings ?? [])) {
            const zone = new Feature({ geometry: poly })
            zone.set('role', 'zone')
            source.addFeature(zone)
          }
        } catch {
          /* 미리보기 실패는 무시 */
        }
      }, PREVIEW_DELAY_MS)
    }

    const coordOf = (evt: PointerEvent) => map.getCoordinateFromPixel(map.getEventPixel(evt)) as Pt
    const el = map.getTargetElement()

    const onHover = (evt: PointerEvent) => {
      if (drag || modeRef.current !== 'buffer' || !resultRef.current) return
      const coord = coordOf(evt)
      const p = snapToOutline(coord)
      if (!p) {
        showSnap(null, '', null)
        if (el) el.style.cursor = ''
        return
      }
      const buffers = buffersOf(resultRef.current)
      const index = lineOwningOutline(p, linesOf(), buffers)
      showSnap(p, `${buffers[index] ?? ''}m`, index)
      if (el) el.style.cursor = 'grab'
    }

    const onWindowMove = (evt: PointerEvent) => {
      const d = drag
      if (!d) return
      const coord = coordOf(evt)
      const line = linesOf()[d.index]
      if (!line) return
      const value = clampBuffer(locate(coord[0], coord[1], line).dist)
      const before = d.buffers[d.index]
      showSnap(coord, value === before ? `${value}m` : `${before}m → ${value}m`, null)
      snapF?.set('dragging', true)
      if (value === d.value) return
      d.value = value
      const buffers = d.buffers.slice()
      buffers[d.index] = value
      // 움직이는 동안: 끄는 관로 버퍼만 즉시 표시, 멈추면 서버 정확한 면으로 교체
      clearRole('zone')
      showLive(line, value)
      showZonePreview(buffers)
    }

    const finish = () => {
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowCancel)
      window.removeEventListener('blur', onWindowCancel)
      if (previewTimer) clearTimeout(previewTimer)
      previewSeq += 1
      setPanActive(map, true)
      draggingRef.current = false
      clearRole('zone')
      showLive(null, 0)
      dimZone(false)
      showSnap(null, '', null)
      if (el) el.style.cursor = ''
      const d = drag
      drag = null
      return d
    }

    function onWindowCancel() {
      if (drag) finish()
    }
    const cancels = cancelDragsRef.current
    cancels.add(onWindowCancel)

    function onWindowUp() {
      const d = finish()
      const current = resultRef.current
      if (!d || !current) return
      if (d.value === d.buffers[d.index]) return
      const buffers = d.buffers.slice()
      buffers[d.index] = d.value
      recomputeRef.current(current.pipes, buffers, '구간 버퍼 조정')
    }

    const onDown = (evt: PointerEvent) => {
      if (modeRef.current !== 'buffer' || evt.button !== 0 || !resultRef.current) return
      const p = snapToOutline(coordOf(evt))
      if (!p) return
      const buffers = buffersOf(resultRef.current)
      const index = lineOwningOutline(p, linesOf(), buffers)
      if (index < 0) return
      evt.stopPropagation()
      drag = { index, buffers, value: buffers[index] }
      draggingRef.current = true
      dimZone(true)
      showLive(linesOf()[index] ?? null, buffers[index])
      setPanActive(map, false)
      if (el) el.style.cursor = 'grabbing'
      window.addEventListener('pointermove', onWindowMove)
      window.addEventListener('pointerup', onWindowUp)
      window.addEventListener('pointercancel', onWindowCancel)
      window.addEventListener('blur', onWindowCancel)
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
      refreshOutlineRef.current = () => undefined
      map.removeLayer(layer)
    }
    // refs(…Ref)는 도구모음 컴포넌트의 useRef라 렌더 간 같은 객체 — 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasResult, mapContext?.mapReady, mapContext?.mapInstanceRef])
}
