'use client'

import { useCallback, useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import type { FeatureLike } from 'ol/Feature'
import type { MapBrowserEvent } from 'ol'
import { boundingExtent, intersects, type Extent } from 'ol/extent'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import VectorLayer from 'ol/layer/Vector'
import { unByKey } from 'ol/Observable'
import { transform } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import '../../_mapComponents/config/projections'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import {
  DETAIL_WONDO_FOOTPRINT_COLOR,
  DETAIL_WONDO_PICK_COLOR,
  DETAIL_WONDO_SRS,
  detailWondoLabel,
  type DetailWondoCoord,
  type DetailWondoItem,
} from './detailWondoConfig'

const LAYER_PROP = 'detailWondoFootprintLayer'
/** 이 해상도(m/px) 이하에서만 원도 이름 라벨 */
const LABEL_MAX_RESOLUTION = 4

function to3857(c: DetailWondoCoord): [number, number] {
  const [x, y] = transform(c, DETAIL_WONDO_SRS, 'EPSG:3857')
  return [x, y]
}

export function detailWondoCorners3857(item: DetailWondoItem): [number, number][] {
  return [item.topLeft, item.topRight, item.bottomRight, item.bottomLeft].map(to3857)
}

function createStyle(getPicked: () => Set<string>, getShown: () => Set<string>) {
  return (feature: FeatureLike, resolution: number) => {
    if (feature.get('pickPoint')) {
      return new Style({
        image: new Circle({
          radius: 6,
          fill: new Fill({ color: DETAIL_WONDO_PICK_COLOR }),
          stroke: new Stroke({ color: '#ffffff', width: 2 }),
        }),
        zIndex: 10,
      })
    }
    const id = String(feature.get('wondoId') ?? '')
    const picked = getPicked().has(id)
    const shown = getShown().has(id)
    const color = picked ? DETAIL_WONDO_PICK_COLOR : DETAIL_WONDO_FOOTPRINT_COLOR
    const styles = [
      new Style({
        stroke: new Stroke({
          color,
          width: picked ? 2.5 : shown ? 2 : 1.2,
          lineDash: shown || picked ? undefined : [6, 4],
        }),
        fill: new Fill({ color: 'rgba(0,0,0,0)' }),
        zIndex: picked ? 3 : shown ? 2 : 1,
      }),
    ]
    if (resolution <= LABEL_MAX_RESOLUTION) {
      styles.push(
        new Style({
          text: new Text({
            text: String(feature.get('label') ?? ''),
            font: '600 12px "Pretendard", sans-serif',
            fill: new Fill({ color }),
            stroke: new Stroke({ color: '#ffffff', width: 3 }),
            overflow: true,
          }),
          zIndex: 4,
        })
      )
    }
    return styles
  }
}

type Options = {
  items: DetailWondoItem[]
  pickedIds: string[]
  shownIds: string[]
  pickCoord: [number, number] | null
  onPick: (ids: string[], coord3857: [number, number]) => void
  /** false면 지도 클릭으로 원도를 고르지 않는다 (다른 업무 클릭과 겹치지 않게) */
  pickEnabled: boolean
}

/** 세부원도 도곽 경계 — 지도 클릭 시 그 위치를 포함하는 원도 찾기 */
export function useDetailWondoFootprintLayer({
  items,
  pickedIds,
  shownIds,
  pickCoord,
  onPick,
  pickEnabled,
}: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const sourceRef = useRef<VectorSource | null>(null)
  const pickedRef = useRef<Set<string>>(new Set(pickedIds))
  const shownRef = useRef<Set<string>>(new Set(shownIds))
  const onPickRef = useRef(onPick)
  const blockClickRef = useRef(false)
  const cursorSetRef = useRef(false)
  const blockClick = Boolean(
    !pickEnabled ||
    mapContext?.spatialDrawRequest ||
      mapContext?.mapMeasureTool ||
      mapContext?.mapDrawInputSuspended ||
      mapContext?.layerRowGeomEdit
  )

  useEffect(() => {
    onPickRef.current = onPick
    blockClickRef.current = blockClick
    if (blockClick && cursorSetRef.current && map) {
      const el = map.getTargetElement()
      if (el?.style.cursor === 'pointer') el.style.cursor = ''
      cursorSetRef.current = false
    }
  }, [onPick, blockClick, map])

  useEffect(() => {
    if (!mapReady || !map) return
    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      declutter: true,
      zIndex: 70,
      style: createStyle(
        () => pickedRef.current,
        () => shownRef.current
      ),
    })
    layer.set(LAYER_PROP, true)
    map.addLayer(layer)
    sourceRef.current = source

    const handleClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (blockClickRef.current) return
      const coord = evt.coordinate as [number, number]
      const ids = source
        .getFeaturesAtCoordinate(coord)
        .map((f) => String(f.get('wondoId') ?? ''))
        .filter(Boolean)
      onPickRef.current(ids, [coord[0], coord[1]])
    }
    const setCursor = (on: boolean) => {
      if (on === cursorSetRef.current) return
      const el = map.getTargetElement()
      if (!el) return
      if (on) el.style.cursor = 'pointer'
      else if (el.style.cursor === 'pointer') el.style.cursor = ''
      cursorSetRef.current = on
    }
    const handleMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (evt.dragging) return
      setCursor(!blockClickRef.current && source.getFeaturesAtCoordinate(evt.coordinate).length > 0)
    }
    const keys = [map.on('singleclick', handleClick as never), map.on('pointermove', handleMove as never)]

    return () => {
      unByKey(keys)
      setCursor(false)
      map.removeLayer(layer)
      sourceRef.current = null
    }
  }, [map, mapReady])

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return
    source.clear()
    source.addFeatures(
      items.map((item) => {
        const ring = detailWondoCorners3857(item)
        const f = new Feature({ geometry: new Polygon([[...ring, ring[0]]]) })
        f.set('wondoId', item.id)
        f.set('label', detailWondoLabel(item))
        return f
      })
    )
    if (pickCoord) {
      const f = new Feature({ geometry: new Point(pickCoord) })
      f.set('pickPoint', true)
      source.addFeature(f)
    }
  }, [items, pickCoord, map, mapReady])

  useEffect(() => {
    pickedRef.current = new Set(pickedIds)
    shownRef.current = new Set(shownIds)
    sourceRef.current?.changed()
  }, [pickedIds, shownIds])

  const fitToItems = useCallback(
    (targets: DetailWondoItem[]) => {
      if (!map || targets.length === 0) return
      const extent: Extent = boundingExtent(targets.flatMap(detailWondoCorners3857))
      scheduleFitMapToExtent3857(map, extent, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      })
    },
    [map, mapContext?.applyMapViewPaddingRef]
  )

  /** 지금 화면에 원도가 하나도 걸치지 않을 때만 전체 원도 범위로 이동 */
  const fitIfOutOfView = useCallback(
    (targets: DetailWondoItem[]) => {
      if (!map || targets.length === 0) return
      const size = map.getSize()
      if (!size) return
      const view = map.getView().calculateExtent(size)
      const extent = boundingExtent(targets.flatMap(detailWondoCorners3857))
      if (!intersects(view, extent)) fitToItems(targets)
    },
    [map, fitToItems]
  )

  return { fitToItems, fitIfOutOfView }
}
