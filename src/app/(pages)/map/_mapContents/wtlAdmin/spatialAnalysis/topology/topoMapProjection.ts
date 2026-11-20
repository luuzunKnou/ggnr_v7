'use client'

import { useEffect, useState } from 'react'
import type { Map as OlMap } from 'ol'
import { unByKey } from 'ol/Observable'
import { transform, transformExtent } from 'ol/proj'
import '../../../../_mapComponents/config/projections'

/**
 * 공간분석(위상검증·단수·누수) 지도 좌표 변환.
 * 서버와는 경위도(EPSG:4326)로 주고받고, 지도에는 «현재 지도 좌표계»로 그린다.
 * 지도 좌표계는 기본 EPSG:3857이지만 카카오 배경이면 EPSG:5181로 바뀐다(updateViewProjection).
 */
export const TOPO_DATA_PROJECTION = 'EPSG:4326'
const FALLBACK_VIEW_PROJECTION = 'EPSG:3857'

export function getViewProjectionCode(map: OlMap | null | undefined): string {
  return map?.getView().getProjection()?.getCode() ?? FALLBACK_VIEW_PROJECTION
}

/** 경위도 → 지도 좌표 */
export function lonLatToView(coord: [number, number], viewProjection: string): [number, number] {
  const [x, y] = transform(coord, TOPO_DATA_PROJECTION, viewProjection)
  return [x, y]
}

/** 지도 좌표 → 경위도 */
export function viewToLonLat(coord: number[], viewProjection: string): [number, number] {
  const [lon, lat] = transform(coord, viewProjection, TOPO_DATA_PROJECTION)
  return [lon, lat]
}

/**
 * 웹 메르카토르(EPSG:3857) — 단수·누수 서버 API 일부가 화면 범위·클릭·관로 좌표를 이 좌표계로 주고받는다.
 * 지도 좌표계가 3857이면 변환 없이 그대로 돌려준다.
 */
export const MERCATOR_PROJECTION = 'EPSG:3857'

/** 3857 → 지도 좌표 */
export function mercatorToView(coord: number[], viewProjection: string): [number, number] {
  if (viewProjection === MERCATOR_PROJECTION) return [coord[0], coord[1]]
  const [x, y] = transform(coord, MERCATOR_PROJECTION, viewProjection)
  return [x, y]
}

/** 지도 좌표 → 3857 */
export function viewToMercator(coord: number[], viewProjection: string): [number, number] {
  if (viewProjection === MERCATOR_PROJECTION) return [coord[0], coord[1]]
  const [x, y] = transform(coord, viewProjection, MERCATOR_PROJECTION)
  return [x, y]
}

/** 지도 범위 [minX, minY, maxX, maxY] → 3857 범위 */
export function viewExtentToMercator(extent: number[], viewProjection: string): [number, number, number, number] {
  if (viewProjection === MERCATOR_PROJECTION) return [extent[0], extent[1], extent[2], extent[3]]
  const [minX, minY, maxX, maxY] = transformExtent(extent, viewProjection, MERCATOR_PROJECTION)
  return [minX, minY, maxX, maxY]
}

/**
 * 그 지점에서 3857 길이 1이 지도 좌표 길이로 얼마인지.
 * 서버가 3857 단위(m)로 계산하는 버퍼·허용거리를 지도 좌표 거리와 비교할 때 곱한다(3857이면 1).
 */
export function viewUnitsPerMercator(viewCoord: number[], viewProjection: string): number {
  if (viewProjection === MERCATOR_PROJECTION) return 1
  const [mx, my] = viewToMercator(viewCoord, viewProjection)
  const [x2, y2] = mercatorToView([mx + 1, my], viewProjection)
  const k = Math.hypot(x2 - viewCoord[0], y2 - viewCoord[1])
  return Number.isFinite(k) && k > 0 ? k : 1
}

/**
 * 현재 지도 좌표계 코드 — 배경 전환으로 View가 바뀌면(change:view) 새 값으로 갱신된다.
 * 이 값을 그리기 effect 의존성에 넣으면 좌표계가 바뀔 때 도형을 다시 그린다.
 */
export function useMapViewProjection(
  mapRef: { current: OlMap | null } | null | undefined,
  mapReady: boolean | undefined
): string {
  const [code, setCode] = useState(FALLBACK_VIEW_PROJECTION)
  useEffect(() => {
    const map = mapRef?.current
    if (!map || !mapReady) return
    const sync = () => setCode(getViewProjectionCode(map))
    sync()
    const key = map.on('change:view', sync)
    return () => unByKey(key)
  }, [mapRef, mapReady])
  return code
}
