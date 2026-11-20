'use client'

import { useEffect } from 'react'
import {
  clearMapLayerClickDetailHighlight,
  setMapLayerClickDetailHighlight,
} from '@/lib/mapLayerClickDetailHighlight'
import '../../../_mapComponents/config/projections'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { WtlFacilityListRow } from './WtlFacilityListView'

/** 시설·설비 목록 선택 — 공통 선택자 레이어(layerClickDetailHighlight) */
export function useWtlFacilityMapHighlight(selected: WtlFacilityListRow | null) {
  const mapContext = useMapContext()

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const geom = selected?.geom ?? null
    if (geom == null) {
      clearMapLayerClickDetailHighlight(map, 'wtlFacility')
      return
    }
    setMapLayerClickDetailHighlight(map, 'wtlFacility', geom)
    return () => {
      clearMapLayerClickDetailHighlight(map, 'wtlFacility')
    }
  }, [selected, mapContext?.mapInstanceRef, mapContext?.mapReady])
}
