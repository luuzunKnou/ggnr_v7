'use client'

import { useEffect, useState } from 'react'
import { call } from '@/lib/api'
import { isUavSystemEnabledInList } from './shootingRequestUiFlag'

/** 이 프로젝트에 UAV 시스템이 켜져 있을 때만 촬영요청 UI 노출 */
export function useShootingRequestUiEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void call('', 'POST', {
      service: 'configService',
      action: 'getSystemList',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as { systems?: { sys_key?: string }[] }
        setEnabled(isUavSystemEnabledInList(data?.systems))
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return enabled
}
