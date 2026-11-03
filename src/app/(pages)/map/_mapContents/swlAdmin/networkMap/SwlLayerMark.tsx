'use client'

import { NetworkLayerMark } from '@/app/(pages)/map/_mapComponents/NetworkLayerMark'
import { getSwlNetLayerDef, swlNetStyleName } from './swlNetworkLayerCatalog'

/** 하수 관망조회 분류 버튼 범례 — 공용 NetworkLayerMark */
export function SwlLayerMark({ layerKey }: { layerKey: string }) {
  const def = getSwlNetLayerDef(layerKey)
  const styleName = def ? swlNetStyleName(def) : ''
  const geomKind = def?.geomKind ?? 'point'
  return <NetworkLayerMark styleName={styleName} geomKind={geomKind} />
}
