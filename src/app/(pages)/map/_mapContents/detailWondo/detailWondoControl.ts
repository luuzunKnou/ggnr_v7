'use client'

import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { call } from '@/lib/api'
import type { MapControlGroup } from '../../_mapComponents/mapControlPanel/mapControlPanel'

/** 우측 지도 컨트롤 버튼 id */
export const DETAIL_WONDO_CONTROL_ID = 'detail-wondo'

const ANCHOR_CONTROL_ID = 'background-map'

/** 원도 폴더가 있을 때만 배경지도 그룹에 «세부원도» 버튼을 끼운다 (드론영상 다음) */
export function withDetailWondoControl(groups: MapControlGroup[], enabled: boolean): MapControlGroup[] {
  if (!enabled) return groups
  return groups.map((g) => {
    if (!g.items.some((it) => it.id === ANCHOR_CONTROL_ID)) return g
    return {
      ...g,
      items: [...g.items, { id: DETAIL_WONDO_CONTROL_ID, icon: ScrollText, label: '세부원도' }],
    }
  })
}

let cachedAvailable: boolean | null = null

/** 서버에 원도 폴더가 있는지 — 세션당 한 번만 묻는다 */
export function useDetailWondoAvailable(): boolean {
  const [available, setAvailable] = useState(cachedAvailable ?? false)

  useEffect(() => {
    if (cachedAvailable != null) return
    let cancelled = false
    void call('', 'POST', { service: 'detailWondoService', action: 'available', params: {} })
      .then((res) => {
        const data = (res?.data ?? res) as { available?: boolean } | undefined
        cachedAvailable = Boolean(res?.success && data?.available)
        if (!cancelled) setAvailable(cachedAvailable)
      })
      .catch(() => {
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}
