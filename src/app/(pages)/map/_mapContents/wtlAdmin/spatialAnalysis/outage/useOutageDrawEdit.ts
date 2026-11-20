'use client'

import { useEffect, useRef, type MutableRefObject } from 'react'
import Feature, { type FeatureLike } from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import { Polygon } from 'ol/geom'
import Draw, { type DrawEvent } from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom'
import { shiftKeyOnly } from 'ol/events/condition'
import { Circle, Fill, Stroke, Style } from 'ol/style'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import { call } from '@/lib/api'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { getViewProjectionCode, viewExtentToMercator, viewToLonLat } from '../topology/topoMapProjection'
import type { OutageEditMode } from './wtlOutageEditShared'
import { outagePolygonsOf, type WtlOutageResult } from './wtlOutageSample'

/** 건물군을 그릴 최대 해상도(m/px) — 이보다 축소되면 너무 많아 안 그림(약 1:5,000) */
const BUILDING_MAX_RES = 1.5
/** 지도 이동 후 건물군 다시 불러오기 지연(ms) */
const BUILDING_LOAD_DELAY_MS = 200

/** 건물군 레이어 스타일(GeoServer tl_sgco_rnadr_mst.sld: 채움 #C8C8C8 20%, 흰 테두리) */
const buildingStyle = new Style({
  fill: new Fill({ color: 'rgba(200, 200, 200, 0.2)' }),
  stroke: new Stroke({ color: '#ffffff', width: 1 }),
})
/** 이미 단수 면에 들어 있는 건물군 — 흐리게 */
const buildingCoveredStyle = new Style({
  fill: new Fill({ color: 'rgba(200, 200, 200, 0.06)' }),
  stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.35)', width: 1 }),
})
/** Alt+마우스 올림 — 뺄 건물군(빨간 점선) */
const buildingRemoveHoverStyle = new Style({
  fill: new Fill({ color: 'rgba(0, 0, 0, 0.25)' }),
  stroke: new Stroke({ color: '#ffffff', width: 3, lineDash: [6, 4] }),
})
/** 고르는 중(마우스 올림) — 빨간 단수 면 위에서도 보이게 굵은 흰 테두리 */
const buildingHoverStyle = new Style({
  fill: new Fill({ color: 'rgba(255, 255, 255, 0.35)' }),
  stroke: new Stroke({ color: '#ffffff', width: 3 }),
})

export type OutageZoneEditOp = 'union' | 'difference'
export type OutageZoneEditOptions = {
  /** difference일 때 되살릴 단수 관로(그 1m 띠가 잘리지 않게) */
  keepPipes?: [number, number][][]
  /** keepPipes를 되살리지 않을 영역(뺀 건물군 면) */
  keepExclude?: [number, number][]
}

export type OutageDrawEditRefs = {
  resultRef: MutableRefObject<WtlOutageResult | null>
  onNoticeRef: MutableRefObject<(msg: string) => void>
  /** 그리는 중이면 true — 되돌리기를 막음 */
  draggingRef: MutableRefObject<boolean>
  /** ESC로 그리던 도형을 버리는 함수들 */
  cancelDragsRef: MutableRefObject<Set<() => void>>
  /** 그린 도형(4326 바깥 고리)을 단수 면에 합치거나 빼기 + 재조회(되돌리기 스택 포함) */
  applyShapeRef: MutableRefObject<
    (op: OutageZoneEditOp, shape: [number, number][], label: string, opts?: OutageZoneEditOptions) => void
  >
}

function drawStyle(op: OutageZoneEditOp): Style {
  const color = op === 'union' ? '#16a34a' : '#dc2626'
  return new Style({
    fill: new Fill({ color: op === 'union' ? 'rgba(22, 163, 74, 0.18)' : 'rgba(220, 38, 38, 0.12)' }),
    stroke: new Stroke({ color, width: 2, lineDash: op === 'union' ? undefined : [8, 6] }),
    image: new Circle({
      radius: 4,
      fill: new Fill({ color: '#ffffff' }),
      stroke: new Stroke({ color, width: 2 }),
    }),
  })
}

/**
 * 단수 면 그리기·지우기·건물 합치기
 * - draw: 다각형을 그리면(클릭으로 점, 더블클릭으로 끝 · Shift+끌기는 자유곡선) 그만큼 단수 면에 합침
 * - erase: 그린 만큼 단수 면에서 뺌(가운데를 빼면 구멍)
 * - building: 화면 범위 건물군을 그리고, 마우스를 올려 고른 건물군을 클릭하면 그 면을 합침.
 *   Alt+클릭은 그 건물군(과 관로까지 연결 띠)을 단수 면에서 뺌
 */
export function useOutageDrawEdit({
  active,
  hasResult,
  mode,
  refs,
  zoneKey,
}: {
  active: boolean
  hasResult: boolean
  mode: OutageEditMode
  refs: OutageDrawEditRefs
  /** 단수 면 식별(바뀌면 건물군 포함 여부 다시 계산) */
  zoneKey?: unknown
}) {
  const mapContext = useMapContext()
  const { resultRef, onNoticeRef, draggingRef, cancelDragsRef, applyShapeRef } = refs
  /** 단수 면이 바뀌면 건물군 포함 여부(흐리게)를 다시 계산 */
  const reloadBuildingsRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    reloadBuildingsRef.current()
  }, [zoneKey])

  // 그리기·지우기
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active || !hasResult) return
    if (mode !== 'draw' && mode !== 'erase') return
    const op: OutageZoneEditOp = mode === 'draw' ? 'union' : 'difference'

    const draw = new Draw({
      type: 'Polygon',
      style: drawStyle(op),
      freehandCondition: shiftKeyOnly,
      stopClick: true,
    })
    draw.on('drawstart', () => {
      draggingRef.current = true
    })
    draw.on('drawabort', () => {
      draggingRef.current = false
    })
    draw.on('drawend', (e: DrawEvent) => {
      draggingRef.current = false
      const geom = e.feature.getGeometry()
      if (!(geom instanceof Polygon)) return
      // 그린 좌표는 현재 지도 좌표계(3857, 카카오 배경이면 5181)
      const viewProj = getViewProjectionCode(map)
      const ring = (geom.getCoordinates()[0] ?? []).map((c) => viewToLonLat(c, viewProj))
      if (ring.length < 4) {
        onNoticeRef.current('점을 3개 이상 찍어 주세요.')
        return
      }
      applyShapeRef.current(op, ring, op === 'union' ? '그린 영역 합침' : '그린 영역 지움')
    })
    map.addInteraction(draw)

    // 더블클릭으로 끝낼 때 지도가 확대되지 않게
    const dblZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined
    const dblWasActive = dblZoom?.getActive() ?? false
    dblZoom?.setActive(false)
    const el = map.getTargetElement()
    if (el) el.style.cursor = 'crosshair'

    const cancel = () => {
      draw.abortDrawing()
      draggingRef.current = false
    }
    const cancels = cancelDragsRef.current
    cancels.add(cancel)
    // 배경 전환으로 지도 좌표계가 바뀌면 그리던 도형은 이전 좌표계라 버린다
    const viewKey = map.on('change:view', cancel)
    return () => {
      unByKey(viewKey)
      cancels.delete(cancel)
      draw.abortDrawing()
      draggingRef.current = false
      map.removeInteraction(draw)
      if (dblWasActive) dblZoom?.setActive(true)
      if (el) el.style.cursor = ''
    }
    // refs(…Ref)는 도구모음 컴포넌트의 useRef라 렌더 간 같은 객체 — 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasResult, mode, mapContext?.mapReady, mapContext?.mapInstanceRef])

  // 건물 — 건물군 레이어를 그리고 골라서 합치기
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active || !hasResult || mode !== 'building') return
    let disposed = false
    let loadSeq = 0
    let pickSeq = 0
    let loadTimer: ReturnType<typeof setTimeout> | null = null
    let hovered: FeatureLike | null = null
    /** Alt 누름 — 뺄 건물군 강조 */
    let altDown = false
    let tooFarNoticed = false

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 940,
      style: (f) =>
        f === hovered && altDown
          ? buildingRemoveHoverStyle
          : f === hovered && !f.get('covered')
            ? buildingHoverStyle
            : f.get('covered')
              ? buildingCoveredStyle
              : buildingStyle,
    })
    layer.set('wtlOutageBuildingPick', true)
    map.addLayer(layer)
    const format = new GeoJSON()
    const el = map.getTargetElement()

    const load = async () => {
      const res = map.getView().getResolution() ?? Infinity
      if (res > BUILDING_MAX_RES) {
        source.clear()
        if (!tooFarNoticed) {
          tooFarNoticed = true
          onNoticeRef.current('건물군을 보려면 지도를 더 확대해 주세요.')
        }
        return
      }
      tooFarNoticed = false
      const size = map.getSize()
      if (!size) return
      const viewProj = getViewProjectionCode(map)
      // 서버는 3857 bbox를 받는다
      const bbox = viewExtentToMercator(map.getView().calculateExtent(size), viewProj)
      const my = ++loadSeq
      try {
        const out = await call('', 'POST', {
          service: 'wtlOutageService',
          action: 'listWtlOutageBuildingsInView',
          params: { bbox, polygons: outagePolygonsOf(resultRef.current) },
        })
        if (disposed || my !== loadSeq) return
        const body = (out?.data ?? out) as {
          rows?: { id: number; geom: unknown; covered?: boolean }[]
          truncated?: boolean
          error?: string
        }
        if (body.error) {
          onNoticeRef.current(body.error)
          return
        }
        source.clear()
        for (const row of body.rows ?? []) {
          try {
            const geom = format.readGeometry(row.geom, { dataProjection: 'EPSG:4326', featureProjection: viewProj })
            const f = new Feature({ geometry: geom })
            f.set('bldId', row.id)
            f.set('covered', row.covered === true)
            source.addFeature(f)
          } catch {
            /* 잘못된 도형은 건너뜀 */
          }
        }
        if (body.truncated) onNoticeRef.current('건물군이 많아 일부만 표시했습니다. 더 확대해 주세요.')
      } catch {
        if (!disposed && my === loadSeq) onNoticeRef.current('건물군을 불러오지 못했습니다.')
      }
    }
    const scheduleLoad = () => {
      if (loadTimer) clearTimeout(loadTimer)
      loadTimer = setTimeout(() => void load(), BUILDING_LOAD_DELAY_MS)
    }
    const moveKey = map.on('moveend', scheduleLoad)
    reloadBuildingsRef.current = scheduleLoad
    void load()

    const featureAt = (pixel: number[]): FeatureLike | null =>
      map.forEachFeatureAtPixel(pixel, (f) => f, { layerFilter: (l) => l === layer, hitTolerance: 2 }) ?? null

    const paintCursor = () => {
      // 이미 포함된 건물군은 합칠 대상이 아니므로 손가락 커서는 Alt(빼기)일 때만
      if (el) el.style.cursor = hovered && (altDown || !hovered.get('covered')) ? 'pointer' : ''
    }
    const onHover = (evt: MapBrowserEvent<PointerEvent>) => {
      if (evt.dragging) return
      const alt = evt.originalEvent.altKey
      const f = featureAt(evt.pixel)
      if (f === hovered && alt === altDown) return
      hovered = f
      altDown = alt
      layer.changed()
      paintCursor()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || e.altKey === altDown) return
      altDown = e.type === 'keydown'
      layer.changed()
      paintCursor()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    const hoverKey = map.on('pointermove', onHover as never)

    const onClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      const f = featureAt(evt.pixel)
      const id = Number(f?.get('bldId'))
      if (!f || !Number.isFinite(id)) return
      evt.stopPropagation()
      const remove = evt.originalEvent.altKey
      const my = ++pickSeq
      try {
        const res = await call('', 'POST', {
          service: 'wtlOutageService',
          action: 'getWtlOutageBuildingAt',
          params: remove
            ? {
                id,
                polygons: outagePolygonsOf(resultRef.current),
                purpose: 'remove',
                pipes: resultRef.current?.pipes ?? [],
              }
            : { id, polygons: outagePolygonsOf(resultRef.current) },
        })
        if (disposed || my !== pickSeq) return
        const body = (res?.data ?? res) as {
          ring?: [number, number][]
          face?: [number, number][]
          covered?: number
          connected?: boolean
          error?: string
        }
        if (body.error) {
          onNoticeRef.current(body.error)
          return
        }
        if (!body.ring || body.ring.length < 4) {
          onNoticeRef.current('건물군 면을 불러오지 못했습니다.')
          return
        }
        if (remove) {
          if ((body.covered ?? 0) < 0.01) {
            onNoticeRef.current('단수 면에 없는 건물군입니다.')
            return
          }
          // 건물군 밖을 지나는 단수 관로 띠는 남겨 면이 끊기지 않게(건물군 안쪽 급수관은 함께 뺌)
          applyShapeRef.current('difference', body.ring, '건물군 뺌', {
            keepPipes: resultRef.current?.pipes ?? [],
            keepExclude: body.face,
          })
          return
        }
        if ((body.covered ?? 0) >= 0.99) {
          onNoticeRef.current('이미 단수 면에 들어 있는 건물군입니다.')
          return
        }
        applyShapeRef.current('union', body.ring, body.connected ? '건물군 합침(단수 면과 연결)' : '건물군 합침')
      } catch {
        if (!disposed && my === pickSeq) onNoticeRef.current('건물군을 불러오지 못했습니다.')
      }
    }
    const clickKey = map.on('singleclick', onClick as never)

    return () => {
      disposed = true
      reloadBuildingsRef.current = () => undefined
      if (loadTimer) clearTimeout(loadTimer)
      unByKey(moveKey)
      unByKey(hoverKey)
      unByKey(clickKey)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      map.removeLayer(layer)
      if (el) el.style.cursor = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasResult, mode, mapContext?.mapReady, mapContext?.mapInstanceRef])
}
