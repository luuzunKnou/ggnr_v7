'use client'

import { useEffect, useMemo } from 'react'
import {
  clearMapLayerClickDetailHighlight,
  setMapLayerClickDetailHighlight,
} from '@/lib/mapLayerClickDetailHighlight'
import '../../../_mapComponents/config/projections'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { MeterLocateResult } from './locateMeterAddresses'

/** 필지 면 우선, 없으면 점 — 지도 기본 모달 선택자와 동일 레이어 */
function geomForHighlight(row: MeterLocateResult | null): unknown {
  if (!row || row.status === 'miss') return null
  if (row.geometry4326) return row.geometry4326
  if (row.point4326 && row.point4326.length >= 2) {
    return { type: 'Point', coordinates: row.point4326 }
  }
  return null
}

/** 계량기 목록 선택 — 공통 선택자 레이어(layerClickDetailHighlight) */
export function useWtlMeterLocationHighlight(selected: MeterLocateResult | null) {
  const mapContext = useMapContext()
  const geom = useMemo(() => geomForHighlight(selected), [selected])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    if (geom == null) {
      clearMapLayerClickDetailHighlight(map, 'wtlMeterLocation')
      return
    }
    setMapLayerClickDetailHighlight(map, 'wtlMeterLocation', geom)
    return () => {
      clearMapLayerClickDetailHighlight(map, 'wtlMeterLocation')
    }
  }, [geom, mapContext?.mapInstanceRef, mapContext?.mapReady])
}
