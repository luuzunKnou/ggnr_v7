'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import Feature from 'ol/Feature'
import WKT from 'ol/format/WKT'
import type Geometry from 'ol/geom/Geometry'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style, Text } from 'ol/style'
import { dongMapFeaturesClient } from '@/lib/realTransactionPriceClient'
import '../../_mapComponents/config/projections'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../_mapComponents/MapContext'
import {
  formatMapPriceLabel,
  priceFillRgba,
  type DongMapFeature,
} from './realTransactionPriceConfig'

type Props = {
  dealYmd: string
  enabled: boolean
  selectedUmd: string | null
  onSelectUmd: (umdNm: string) => void
  /** 목록에서 선택해 지도만 맞출 때 true */
  fitSelected: boolean
  onFitDone?: () => void
}

function featureStyle(feature: Feature<Geometry>, selectedUmd: string | null, min: number, max: number): Style {
  const umdNm = String(feature.get('umdNm') ?? '')
  const avg = feature.get('avgPerSqm') as number | null
  const selected = Boolean(selectedUmd && umdNm === selectedUmd)
  const priceLabel = formatMapPriceLabel(avg)
  const label = priceLabel ? `${umdNm}\n${priceLabel}` : umdNm
  return new Style({
    fill: new Fill({ color: priceFillRgba(avg, min, max, selected) }),
    stroke: new Stroke({
      color: selected ? '#9a3412' : 'rgba(154, 52, 18, 0.65)',
      width: selected ? 2.5 : 1.2,
    }),
    text: new Text({
      text: label,
      font: selected ? '600 11px sans-serif' : '500 10px sans-serif',
      fill: new Fill({ color: '#431407' }),
      stroke: new Stroke({ color: 'rgba(255,255,255,0.9)', width: 3 }),
      textAlign: 'center',
      textBaseline: 'middle',
      overflow: true,
    }),
  })
}

/** 동별 평균 실거래가 색칠·가격 라벨 + 클릭 선택 + 선택 시 화면 맞춤 */
export function useRealTransactionPriceLayer({
  dealYmd,
  enabled,
  selectedUmd,
  onSelectUmd,
  fitSelected,
  onFitDone,
}: Props) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const onSelectRef = useRef(onSelectUmd)
  onSelectRef.current = onSelectUmd
  const selectedRef = useRef(selectedUmd)
  selectedRef.current = selectedUmd
  const rangeRef = useRef({ min: 0, max: 0 })
  const mapReady = Boolean(mapContext?.mapReady)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapReady || !enabled) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: (f) => {
        const feat = f as Feature<Geometry>
        const { min, max } = rangeRef.current
        return featureStyle(feat, selectedRef.current, min, max)
      },
      zIndex: 885,
    })
    layer.set('realTransactionPriceDong', true)
    layerRef.current = layer
    map.addLayer(layer)

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      const hit = map.forEachFeatureAtPixel(
        evt.pixel,
        (feat, lyr) => (lyr === layer ? feat : undefined),
        { hitTolerance: 2 }
      )
      if (!hit) return
      const umdNm = String((hit as Feature).get('umdNm') ?? '').trim()
      if (umdNm) onSelectRef.current(umdNm)
    }
    const clickKey = map.on('singleclick', onClick as never)

    return () => {
      unByKey(clickKey)
      sourceRef.current = null
      layerRef.current = null
      map.removeLayer(layer)
    }
  }, [enabled, mapContext?.mapInstanceRef, mapReady])

  useEffect(() => {
    const source = sourceRef.current
    const layer = layerRef.current
    // 새로고침·첫 진입 시 mapReady 전에 돌면 source가 없어 스킵됨 → mapReady 후 재실행
    if (!enabled || !mapReady || !source || !layer) return

    let cancelled = false
    source.clear()
    const ymd = dealYmd.replace(/\D/g, '')
    if (!/^\d{6}$/.test(ymd)) return

    void (async () => {
      try {
        const data = await dongMapFeaturesClient({ dealYmd: ymd })
        if (cancelled) return
        const features = Array.isArray(data.features)
          ? (data.features as DongMapFeature[])
          : []
        const prices = features
          .map((f) => f.avgPerSqm)
          .filter((n): n is number => n != null && Number.isFinite(n))
        rangeRef.current = {
          min: prices.length ? Math.min(...prices) : 0,
          max: prices.length ? Math.max(...prices) : 0,
        }

        const olFeatures: Feature<Geometry>[] = []
        for (const row of features) {
          try {
            const feature = new WKT().readFeature(row.wkt, {
              dataProjection: 'EPSG:5181',
              featureProjection: 'EPSG:3857',
            }) as Feature<Geometry>
            if (!feature) continue
            feature.setId(row.umdNm)
            feature.set('umdNm', row.umdNm)
            feature.set('emdCd', row.emdCd)
            feature.set('avgPerSqm', row.avgPerSqm)
            feature.set('count', row.count)
            olFeatures.push(feature)
          } catch {
            /* skip bad wkt */
          }
        }
        if (cancelled) return
        source.clear()
        source.addFeatures(olFeatures)
        layer.changed()
      } catch {
        if (!cancelled) source.clear()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [dealYmd, enabled, mapReady])

  useEffect(() => {
    layerRef.current?.changed()
  }, [selectedUmd])

  useEffect(() => {
    if (!fitSelected || !selectedUmd) return
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source) {
      onFitDone?.()
      return
    }
    const feature = source.getFeatureById(selectedUmd)
    if (!feature) {
      onFitDone?.()
      return
    }
    const geom = feature.getGeometry()
    if (!geom) {
      onFitDone?.()
      return
    }
    const extent = geom.getExtent()
    if (extent.every((v) => Number.isFinite(v))) {
      scheduleFitMapToExtent3857(map, extent, {
        maxZoom: 15,
        fitPadding: [80, 80, 80, 80],
        applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
      })
    }
    onFitDone?.()
  }, [
    fitSelected,
    selectedUmd,
    onFitDone,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapInstanceRef,
  ])
}
