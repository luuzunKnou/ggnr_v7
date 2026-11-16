'use client'

import { useEffect, useRef } from 'react'
import '../../_mapComponents/config/projections'
import type { MapBrowserEvent } from 'ol'
import { transform } from 'ol/proj'
import { unByKey } from 'ol/Observable'
import { useMapContext } from '../../_mapComponents/MapContext'
import { SMALL_PUBLIC_DATA_PROJECTION } from './smallPublicConfig'

/** 지도 클릭 한 번으로 위치 받기 — 켜져 있는 동안 커서가 십자로 바뀌고, 찍은 좌표(EPSG:5187)를 넘긴다 */
export function useSmallPublicMapPick(active: boolean, onPick: (coord: [number, number]) => void) {
  const mapContext = useMapContext()
  const mapInstanceRef = mapContext?.mapInstanceRef
  const mapReady = mapContext?.mapReady ?? false
  const onPickRef = useRef(onPick)

  useEffect(() => {
    onPickRef.current = onPick
  }, [onPick])

  useEffect(() => {
    const map = mapInstanceRef?.current
    if (!active || !mapReady || !map) return
    const target = map.getTargetElement()
    const prevCursor = target?.style.cursor ?? ''
    if (target) target.style.cursor = 'crosshair'
    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      evt.stopPropagation()
      const viewProj = map.getView().getProjection().getCode()
      const [x, y] = transform(evt.coordinate, viewProj, SMALL_PUBLIC_DATA_PROJECTION)
      onPickRef.current([Math.round(x! * 100) / 100, Math.round(y! * 100) / 100])
    }
    const key = map.on('singleclick', onClick as never)
    return () => {
      unByKey(key)
      if (target) target.style.cursor = prevCursor
    }
  }, [active, mapReady, mapInstanceRef])
}

/** EPSG:5187 좌표 → 자료와 같은 «북위 37° 0' 31" 동경 129° 17' 9"» 글자 */
export function smallPublicCoordToDms(coord: [number, number]): string {
  const [lon, lat] = transform(coord, SMALL_PUBLIC_DATA_PROJECTION, 'EPSG:4326') as [number, number]
  const dms = (v: number) => {
    const d = Math.floor(v)
    const mFloat = (v - d) * 60
    const m = Math.floor(mFloat)
    const s = Math.round((mFloat - m) * 60)
    return s === 60 ? `${d}° ${m + 1}' 0"` : `${d}° ${m}' ${s}"`
  }
  return `북위 ${dms(lat)} 동경 ${dms(lon)}`
}
