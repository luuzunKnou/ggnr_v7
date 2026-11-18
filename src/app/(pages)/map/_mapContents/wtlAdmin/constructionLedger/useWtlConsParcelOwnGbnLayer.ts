'use client'

import { useEffect, useRef } from 'react'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style } from 'ol/style'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { LAYER_GEOM_STACK_SKIP_KEY } from '@/lib/mapLayerGeometryOrder'
import {
  hexToRgba,
  ownGbnColor,
} from '../../privateLandAnalysis/privateLandAnalysisFormat'

export type WtlConsOwnGbnParcel = {
  pnu: string
  address: string
  ownGbn?: string
  geometry3857?: Record<string, unknown> | null
}

/** 사유지분석 parcelStyle과 동일 팔레트(ownGbnColor) — 공유 색만 의존 */
function parcelOwnGbnStyle(ownGbn: string, picked: boolean): Style | Style[] {
  const color = ownGbnColor(ownGbn)
  if (picked) {
    return [
      new Style({ stroke: new Stroke({ color: '#fff', width: 6 }), zIndex: 1 }),
      new Style({
        stroke: new Stroke({ color: '#111827', width: 2.5 }),
        fill: new Fill({ color: hexToRgba(color, 0.65) }),
        zIndex: 2,
      }),
    ]
  }
  return new Style({
    stroke: new Stroke({ color, width: 1.2 }),
    fill: new Fill({ color: hexToRgba(color, 0.35) }),
  })
}

/**
 * 공사대장 필지 탭 — 교차 필지 전체를 소유구분 색으로 표시.
 * 색은 사유지분석 `ownGbnColor`와 연동. 선택 행은 더 진하게.
 */
export function useWtlConsParcelOwnGbnLayer(input: {
  active: boolean
  parcels: WtlConsOwnGbnParcel[]
  selectedIdx: number | null
}) {
  const mapContext = useMapContext()
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const sourceRef = useRef<VectorSource | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: (feature) => {
        const ownGbn = String(feature.get('ownGbn') ?? '미상')
        const picked = Boolean(feature.get('picked'))
        return parcelOwnGbnStyle(ownGbn, picked)
      },
      zIndex: 915,
    })
    layer.set('wtlConsParcelOwnGbn', true)
    layer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    layerRef.current = layer
    map.addLayer(layer)

    return () => {
      sourceRef.current = null
      layerRef.current = null
      map.removeLayer(layer)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    const source = sourceRef.current
    const layer = layerRef.current
    if (!source || !layer) return
    source.clear()
    if (!input.active) {
      layer.setVisible(false)
      return
    }
    layer.setVisible(true)
    const format = new GeoJSON()
    input.parcels.forEach((row, index) => {
      if (!row.geometry3857) return
      try {
        const features = format.readFeatures(
          {
            type: 'Feature',
            geometry: row.geometry3857,
            properties: {},
          },
          {
            dataProjection: 'EPSG:3857',
            featureProjection: 'EPSG:3857',
          }
        )
        for (const feature of features) {
          feature.setId(`cons-parcel-${row.pnu || index}`)
          feature.set('ownGbn', String(row.ownGbn ?? '').trim() || '미상')
          feature.set('picked', input.selectedIdx === index)
          source.addFeature(feature)
        }
      } catch {
        /* skip bad geom */
      }
    })
  }, [input.active, input.parcels, input.selectedIdx])
}
