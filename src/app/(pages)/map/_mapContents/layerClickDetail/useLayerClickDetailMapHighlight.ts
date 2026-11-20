'use client'

import { useEffect } from 'react'
import {
  clearMapLayerClickDetailHighlight,
  setMapLayerClickDetailHighlight,
} from '@/lib/mapLayerClickDetailHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import type { LayerClickHit } from './useLayerClickDetail'

const GEOM_KEYS = ['geom', 'wkb_geometry', 'shape', 'the_geom', 'geometry']

export function pickLayerClickHitGeom(
  data: Record<string, unknown> | null | undefined
): unknown {
  if (!data || typeof data !== 'object') return null
  for (const k of GEOM_KEYS) {
    if (data[k] != null) return data[k]
  }
  for (const [k, v] of Object.entries(data)) {
    if (v != null && GEOM_KEYS.includes(k.toLowerCase())) return v
  }
  return null
}

/** 레이어 클릭 상세 — 공통 선택자 레이어(layerClickDetailHighlight) */
export function useLayerClickDetailMapHighlight(selected: LayerClickHit | null) {
  const mapContext = useMapContext()

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const geom = pickLayerClickHitGeom(selected?.data)
    if (geom == null) {
      clearMapLayerClickDetailHighlight(map, 'layerClickDetail')
      return
    }
    setMapLayerClickDetailHighlight(map, 'layerClickDetail', geom)
    return () => {
      clearMapLayerClickDetailHighlight(map, 'layerClickDetail')
    }
  }, [selected, mapContext?.mapInstanceRef, mapContext?.mapReady])
}
