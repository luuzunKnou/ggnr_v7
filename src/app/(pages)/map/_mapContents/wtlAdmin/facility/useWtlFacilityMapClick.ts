'use client'

import { useEffect, useRef } from 'react'
import { call } from '@/lib/api'
import type { WtlFacilityListRow } from './WtlFacilityListView'

type SourceRef = {
  tableName: string
  schema: string
} | null

type Props = {
  source: SourceRef
  /** 현재 탭 키(영문) — identify 소유 레이어 판별용 */
  tab?: string | null
  onSelect: (row: WtlFacilityListRow) => void
}

export const WTL_FACILITY_IDENTIFY_PICK_EVENT = 'ggnr-wtl-facility-identify-pick'

export type WtlFacilityIdentifyPickDetail = {
  tableName: string
  physicalTable?: string | null
  coordinate: [number, number]
  feature?: Record<string, unknown> | null
}

function normName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
}

/**
 * FeatureIdentify 선택·단건 히트가 현재 레이어 탭과 일치할 때 패널 상세로 연결.
 * (지도 직접 getFacilityAtPoint 클릭은 FeatureIdentify 분기로 대체)
 */
export function useWtlFacilityMapClick({ source, tab, onSelect }: Props) {
  const onSelectRef = useRef(onSelect)
  const sourceRef = useRef(source)
  const tabRef = useRef(tab)

  onSelectRef.current = onSelect
  sourceRef.current = source
  tabRef.current = tab

  useEffect(() => {
    const onPick = (ev: Event) => {
      const detail = (ev as CustomEvent<WtlFacilityIdentifyPickDetail>).detail
      if (!detail?.coordinate || detail.coordinate.length < 2) return
      const src = sourceRef.current
      if (!src?.tableName) return

      const owned = new Set(
        [src.tableName, tabRef.current].map(normName).filter(Boolean)
      )
      const hitNames = [detail.tableName, detail.physicalTable]
        .map(normName)
        .filter(Boolean)
      if (!hitNames.some((n) => owned.has(n))) return

      void (async () => {
        try {
          const res = await call('', 'POST', {
            service: 'wtlFacilityService',
            action: 'getFacilityAtPoint',
            params: {
              x: detail.coordinate[0],
              y: detail.coordinate[1],
              table: src.tableName,
              schema: src.schema,
              tolerance: 12,
            },
          })
          const row = (res?.data ?? res)?.row as WtlFacilityListRow | null | undefined
          if (row) onSelectRef.current(row)
        } catch {
          /* ignore */
        }
      })()
    }

    window.addEventListener(WTL_FACILITY_IDENTIFY_PICK_EVENT, onPick)
    return () => {
      window.removeEventListener(WTL_FACILITY_IDENTIFY_PICK_EVENT, onPick)
    }
  }, [])
}
