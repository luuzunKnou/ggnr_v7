'use client'

import { useEffect, useRef } from 'react'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import { Style, Stroke, Fill } from 'ol/style'
import { useSearchParams } from 'next/navigation'
import { call } from '@/lib/api'
import {
  occupationFillRgba,
  occupationStrokeRgba,
} from '@/lib/occupationLayerStyle'
import { useMapContext } from '../../_mapComponents/MapContext'
import { getUseFeeWmsLayerId } from './useFeeLayerId'

/**
 * 목록·상세 선택 시 도형 강조.
 * 점사용료 WMS가 많이 겹치면 점용과 같은 옅은 빨강만으로는 잘 안 보여
 * 흰 외곽 + 진한 테두리·채우기로 구분.
 */
const USE_FEE_GEOM_STYLE = [
  new Style({
    stroke: new Stroke({ color: 'rgba(255,255,255,0.95)', width: 5 }),
  }),
  new Style({
    stroke: new Stroke({ color: occupationStrokeRgba('parentActive', 1), width: 3 }),
    fill: new Fill({ color: occupationFillRgba('parentActive', 0.32) }),
  }),
]

/** 상세 선택 — 점사용료 geom 활성 표시 */
export function useUseFeeGeomHighlight(
  detailId: string | null,
  active: boolean,
  serEng?: string | null
) {
  const mapContext = useMapContext()
  const searchParams = useSearchParams()
  const system = String(searchParams.get('system') ?? '').trim()
  const feeTable = getUseFeeWmsLayerId({ system: system || 'river', serEng })
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      style: USE_FEE_GEOM_STYLE,
      zIndex: 960,
    })
    layer.set('useFeeGeomHighlight', true)
    map.addLayer(layer)
    layerRef.current = layer

    return () => {
      map.removeLayer(layer)
      layerRef.current = null
    }
  }, [mapContext?.mapInstanceRef])

  useEffect(() => {
    const source = layerRef.current?.getSource()
    if (!source) return

    source.clear()

    const key = String(detailId ?? '').trim()
    if (!active || !key) return

    let cancelled = false
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'layerRowService',
          action: 'getTableRowGeomGeoJson3857',
          params: {
            table: feeTable,
            schema: 'layer',
            keyField: 'id',
            keyValue: key,
          },
        })
        if (cancelled) return
        const data = res?.data ?? res
        const geometry = data?.geometry
        if (!geometry || typeof geometry !== 'object') return

        const format = new GeoJSON()
        const features = format.readFeatures(
          { type: 'Feature', geometry, properties: {} },
          { dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' }
        )
        if (cancelled || features.length === 0) return
        source.clear()
        source.addFeatures(features)
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [active, detailId, feeTable])
}
