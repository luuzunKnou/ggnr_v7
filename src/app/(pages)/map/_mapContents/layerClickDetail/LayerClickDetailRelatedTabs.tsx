'use client'

import { useCallback, useMemo, type ReactNode, type RefObject } from 'react'
import type { DefineFieldLike } from '../../_mapComponents/standard/defineLayerRowUtils'
import {
  WtlNetworkDetailRelatedTabs,
  type WtlNetworkDetailRelatedOverlay,
} from '../wtlAdmin/networkMap/WtlNetworkDetailRelatedTabs'
import { layerClickHitToNetworkRow } from './layerClickHitToNetworkRow'
import type { LayerClickHit } from './useLayerClickDetail'

type Props = {
  hit: LayerClickHit
  fields: DefineFieldLike[]
  onHistoryReverted?: () => void
  bodyHeightPx?: number
  /** blank 상세 등 — 맨 앞 「지도」탭 */
  mapTabContent?: ReactNode
  /** 현황 목록 행 클릭 시 상세를 창 안 모달로 (지도 기본·새 창 공통) */
  relatedChildAsModal?: boolean
  /** 지도 기본 모달 루트 — 자식 상세 좌측·위 배치 기준 */
  relatedModalAnchorHostRef?: RefObject<HTMLElement | null>
  /** 데이터 이력관리 조회 서비스명 */
  serviceName?: string | null
}

/**
 * 지도 기본 모달 상세 — 첨부·연관·데이터이력 탭.
 * 관망 상세 탭 UI를 재사용한다.
 */
export function LayerClickDetailRelatedTabs({
  hit,
  fields,
  onHistoryReverted,
  bodyHeightPx = 200,
  mapTabContent,
  relatedChildAsModal = false,
  relatedModalAnchorHostRef,
  serviceName,
}: Props) {
  const item = useMemo(() => layerClickHitToNetworkRow(hit), [hit])
  const onRelatedMapLayer = useCallback((_next: WtlNetworkDetailRelatedOverlay) => {
    /* 지도 클릭 모달은 관망 오버레이 레이어를 쓰지 않음 — 행 하이라이트만 탭 내부에서 처리 */
  }, [])

  return (
    <WtlNetworkDetailRelatedTabs
      item={item}
      fields={fields}
      onRelatedMapLayer={onRelatedMapLayer}
      onHistoryReverted={onHistoryReverted}
      bodyHeightPx={bodyHeightPx}
      mapTabContent={mapTabContent}
      relatedChildAsModal={relatedChildAsModal}
      relatedModalAnchorHostRef={relatedModalAnchorHostRef}
      serviceName={serviceName}
    />
  )
}
