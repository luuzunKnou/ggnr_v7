'use client'

import { useEffect } from 'react'
import {
  clearMapLayerClickDetailHighlight,
  setMapLayerClickDetailHighlight,
} from '@/lib/mapLayerClickDetailHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import type { LayerClickHit } from './useLayerClickDetail'
import { peekLayerClickDetailRetain } from './useLayerClickDetail'

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
      // 메뉴 전환으로 플로팅이 잠깐 언마운트돼도 retain이 있으면 하이라이트 유지
      if (peekLayerClickDetailRetain()?.hits.length) return
      clearMapLayerClickDetailHighlight(map, 'layerClickDetail')
      return
    }
    setMapLayerClickDetailHighlight(map, 'layerClickDetail', geom)
  }, [selected, mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    // cleanup 시점에 ref.current가 새 지도로 바뀌어도, 이 effect가 붙였던 옛 인스턴스만 지운다
    const map = mapContext?.mapInstanceRef?.current ?? null
    return () => {
      // X로 닫힌 경우(retain 없음)만 하이라이트 제거
      if (peekLayerClickDetailRetain()?.hits.length) return
      if (map) clearMapLayerClickDetailHighlight(map, 'layerClickDetail')
    }
  }, [mapContext?.mapInstanceRef])
}
