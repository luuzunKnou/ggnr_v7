'use client'

import { NetworkLayerMark } from '@/app/(pages)/map/_mapComponents/NetworkLayerMark'
import { getWtlNetLayerDef } from './wtlNetworkLayerCatalog'

function wtlLegendGeomKind(name: string): 'line' | 'area' | 'point' {
  const def = getWtlNetLayerDef(name)
  if (def?.geomKind) return def.geomKind
  if (name.includes('관로') || name.includes('심도')) return 'line'
  if (name.includes('구역') || name.includes('분구') || name.includes('블록') || name.includes('제한')) {
    return 'area'
  }
  return 'point'
}

function wtlLegendStyleName(name: string): string {
  return /^wtl_[a-z0-9_]+$/i.test(name) ? name.toLowerCase() : ''
}

/** 상수 관망조회 분류 버튼 범례 — 공용 NetworkLayerMark */
export function WtlLayerMark({ layerKey }: { layerKey: string }) {
  return (
    <NetworkLayerMark
      styleName={wtlLegendStyleName(layerKey)}
      geomKind={wtlLegendGeomKind(layerKey)}
    />
  )
}
