'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import type { Geometry } from 'ol/geom'
import Draw, { createBox, type DrawEvent } from 'ol/interaction/Draw'
import Modify, { type ModifyEvent } from 'ol/interaction/Modify'
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style } from 'ol/style'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { unByKey } from 'ol/Observable'
import { getViewProjectionCode } from '../topology/topoMapProjection'
import { geomToRing4326, ringToViewPolygon, type LonLat } from './wtlOutageGeom'

const EDIT_STYLE = new Style({
  fill: new Fill({ color: 'rgba(234, 88, 12, 0.22)' }),
  stroke: new Stroke({ color: '#ea580c', width: 2.5 }),
})

export type OutageGeomEditMode = 'modify' | 'draw' | null

type Props = {
  mode: OutageGeomEditMode
  /** 기존 단수 면 (4326). modify 시 시드 */
  ring: LonLat[] | null
  /** 편집 중·완료 시 현재 링 통지 (적용 전 미리보기에도 사용) */
  onRingChange: (ring: LonLat[] | null) => void
}

/**
 * 단수구역 도형 — 기존 수정(Modify) / 직접그리기(Draw→Modify)
 */
export function useWtlOutageGeomEdit({ mode, ring, onRingChange }: Props) {
  const mapContext = useMapContext()
  const onRingRef = useRef(onRingChange)
  onRingRef.current = onRingChange
  const ringRef = useRef(ring)
  ringRef.current = ring
  const sourceRef = useRef<VectorSource | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !mode) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: EDIT_STYLE,
      zIndex: 930,
    })
    layer.set('wtlOutageGeomEdit', true)
    map.addLayer(layer)

    // 도형은 현재 지도 좌표계로 그린다. 배경 전환으로 좌표계가 바뀌면 편집 중 도형을 새 좌표계로 옮긴다
    let viewProj = getViewProjectionCode(map)
    const viewKey = map.on('change:view', () => {
      const next = getViewProjectionCode(map)
      if (next === viewProj) return
      draw?.abortDrawing()
      for (const f of source.getFeatures()) f.getGeometry()?.transform(viewProj, next)
      viewProj = next
    })

    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined
    dblClickZoom?.setActive(false)

    let draw: Draw | null = null
    let modify: Modify | null = null

    const detachDraw = () => {
      if (draw) {
        map.removeInteraction(draw)
        draw.dispose()
        draw = null
      }
    }
    const detachModify = () => {
      if (modify) {
        map.removeInteraction(modify)
        modify.dispose()
        modify = null
      }
    }

    const emitFromSource = () => {
      const geom = source.getFeatures()[0]?.getGeometry()
      if (!geom) {
        onRingRef.current(null)
        return
      }
      const next = geomToRing4326(geom, viewProj)
      onRingRef.current(next.length >= 3 ? next : null)
    }

    const attachModify = () => {
      detachDraw()
      detachModify()
      modify = new Modify({ source })
      modify.on('modifyend', (_e: ModifyEvent) => emitFromSource())
      map.addInteraction(modify)
    }

    const attachDraw = () => {
      detachDraw()
      detachModify()
      source.clear()
      onRingRef.current(null)
      draw = new Draw({ source, type: 'Polygon', stopClick: true })
      draw.on('drawstart', () => source.clear())
      draw.on('drawend', (e: DrawEvent) => {
        const geom = e.feature?.getGeometry()?.clone() as Geometry | undefined
        if (!geom) return
        queueMicrotask(() => {
          attachModify()
          emitFromSource()
        })
      })
      map.addInteraction(draw)
    }

    if (mode === 'modify') {
      const poly = ringRef.current ? ringToViewPolygon(ringRef.current, viewProj) : null
      if (poly) {
        source.addFeature(new Feature({ geometry: poly }))
        emitFromSource()
      }
      attachModify()
    } else if (mode === 'draw') {
      // rectangle helper kept available via createBox if needed later
      void createBox
      attachDraw()
    }

    return () => {
      unByKey(viewKey)
      detachDraw()
      detachModify()
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
      dblClickZoom?.setActive(true)
    }
  }, [mode, mapContext?.mapReady, mapContext?.mapInstanceRef])
}
