'use client'

import { useEffect, useRef } from 'react'
import { call } from '@/lib/api'
import { prepareMapForPanelAwareNavigation } from '../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../_mapComponents/MapContext'

/**
 * 메뉴 마운트 시 지도 중심이 sgg 밖이면
 * SERVICE_COORDINATE(5181) 또는 sgg 중심으로 이동.
 * 관망조회·시설관리·설비관리 공통.
 */
export function useEnsureMapCenterInSggOnMount() {
  const mapContext = useMapContext()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    ranRef.current = true

    const center = map.getView().getCenter()
    if (!center || center.length < 2) return
    const x3857 = Number(center[0])
    const y3857 = Number(center[1])
    if (!Number.isFinite(x3857) || !Number.isFinite(y3857)) return

    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'configService',
          action: 'resolveServiceMapFocus',
          params: { x3857, y3857 },
        })
        const data = (res?.data ?? res) as {
          move?: boolean
          center3857?: [number, number]
        } | null
        if (!data?.move || !Array.isArray(data.center3857)) return
        const cx = Number(data.center3857[0])
        const cy = Number(data.center3857[1])
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return
        const applyPad = () => mapContext?.applyMapViewPaddingRef?.current?.()
        queueMicrotask(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              prepareMapForPanelAwareNavigation(map, applyPad)
              map.getView().animate({ center: [cx, cy], duration: 450 })
            })
          })
        })
      } catch {
        /* ignore */
      }
    })()
  }, [mapContext?.mapReady, mapContext?.mapInstanceRef, mapContext?.applyMapViewPaddingRef])
}
