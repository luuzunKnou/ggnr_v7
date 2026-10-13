'use client'

import { useCallback, useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import type { FeatureLike } from 'ol/Feature'
import MultiPolygon from 'ol/geom/MultiPolygon'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import { Fill, Stroke, Style, Text } from 'ol/style'
import { insertLayerBelowServiceLayer } from '@/lib/mapDataQueryMapHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { getResurveyStageGroup, type ResurveyStageGroup } from './cadastralResurveyConfig'
import { getResurveyDistrictById, ringsExtent, type ResurveyDistrict } from './cadastralResurveyMock'

const LAYER_PROP = 'cadastralResurveyDistrictLayer'
/** 이 해상도(m/px) 이하에서만 지구명 라벨 */
const LABEL_MAX_RESOLUTION = 40

function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 지구명 라벨 위치 — 가장 넓은 폴리곤의 대표점(지구당 1개) */
function labelPointOf(feature: FeatureLike) {
  const geom = feature.getGeometry()
  if (!(geom instanceof MultiPolygon)) return geom
  const polys = geom.getPolygons()
  if (polys.length === 0) return geom
  let best = polys[0]
  let bestArea = best.getArea()
  for (const p of polys) {
    const a = p.getArea()
    if (a > bestArea) {
      best = p
      bestArea = a
    }
  }
  return best.getInteriorPoint()
}

function createStyle(getSelectedId: () => string | null) {
  return (feature: FeatureLike, resolution: number) => {
    const stage = feature.get('stage') as ResurveyStageGroup
    const color = getResurveyStageGroup(stage).color
    const selected = feature.get('districtId') === getSelectedId()
    const styles: Style[] = []
    if (selected) {
      styles.push(
        new Style({
          stroke: new Stroke({ color: '#ffffff', width: 6 }),
          zIndex: 1,
        })
      )
    }
    styles.push(
      new Style({
        fill: new Fill({ color: hexToRgba(color, selected ? 0.12 : 0.28) }),
        stroke: new Stroke({
          color,
          width: selected ? 3 : 2,
          lineDash: stage === 'complete' ? undefined : [8, 4],
        }),
        zIndex: selected ? 2 : 0,
      })
    )
    if (resolution <= LABEL_MAX_RESOLUTION) {
      // 지구명 라벨은 지구당 1개만 — 가장 큰 폴리곤의 대표점에만 표시
      styles.push(
        new Style({
          geometry: labelPointOf,
          text: new Text({
            text: String(feature.get('label') ?? ''),
            font: '600 12px "Pretendard", sans-serif',
            fill: new Fill({ color: '#111827' }),
            stroke: new Stroke({ color: '#ffffff', width: 3 }),
            overflow: true,
          }),
          zIndex: selected ? 3 : 1,
        })
      )
    }
    return styles
  }
}

type Options = {
  districts: ResurveyDistrict[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/** 지적재조사 지구 경계 — 목록 필터 결과만 표시, 지도 클릭 시 선택 */
export function useCadastralResurveyDistrictLayer({ districts, selectedId, onSelect }: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const sourceRef = useRef<VectorSource | null>(null)
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const selectedIdRef = useRef<string | null>(selectedId)
  const onSelectRef = useRef(onSelect)
  const blockClickRef = useRef(false)
  const blockClick = Boolean(
    mapContext?.spatialDrawRequest ||
      mapContext?.mapMeasureTool ||
      mapContext?.mapDrawInputSuspended ||
      mapContext?.layerRowGeomEdit
  )

  useEffect(() => {
    onSelectRef.current = onSelect
    blockClickRef.current = blockClick
  }, [onSelect, blockClick])

  useEffect(() => {
    if (!mapReady || !map) return
    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      style: createStyle(() => selectedIdRef.current),
    })
    layer.set(LAYER_PROP, true)
    insertLayerBelowServiceLayer(map, layer)
    sourceRef.current = source
    layerRef.current = layer
    return () => {
      map.removeLayer(layer)
      sourceRef.current = null
      layerRef.current = null
    }
  }, [map, mapReady])

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return
    source.clear()
    source.addFeatures(
      districts.map((d) => {
        const f = new Feature({ geometry: new MultiPolygon(d.rings3857.map((r) => [r])) })
        f.set('districtId', d.id)
        f.set('stage', d.stageGroup)
        f.set('label', d.name)
        return f
      })
    )
  }, [districts, map, mapReady])

  useEffect(() => {
    selectedIdRef.current = selectedId
    sourceRef.current?.changed()
  }, [selectedId])

  useEffect(() => {
    if (!mapReady || !map) return
    const handleClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (blockClickRef.current) return
      const layer = layerRef.current
      if (!layer) return
      let hitId: string | null = null
      evt.map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          hitId = String(feature.get('districtId') ?? '') || null
          return true
        },
        { layerFilter: (l) => l === layer, hitTolerance: 2 }
      )
      if (hitId) onSelectRef.current(hitId)
    }
    const key = map.on('singleclick', handleClick as never)
    return () => unByKey(key)
  }, [map, mapReady])

  const fitToDistrict = useCallback(
    (id: string) => {
      const d = getResurveyDistrictById(id)
      if (!map || !d) return
      scheduleFitMapToExtent3857(map, ringsExtent(d.rings3857), {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      })
    },
    [map, mapContext?.applyMapViewPaddingRef]
  )

  return { fitToDistrict }
}
