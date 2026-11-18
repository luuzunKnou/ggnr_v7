'use client'

import { useCallback, useEffect, useState } from 'react'
import { call } from '@/lib/api'
import {
  mapApiItem,
  type CadastralControlPoint,
} from './cadastralControlPointTypes'

type ListRes = {
  items?: Parameters<typeof mapApiItem>[0][]
  total?: number
}

export function useCadastralControlPointData() {
  const [points, setPoints] = useState<CadastralControlPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await call('', 'POST', {
        service: 'cadastralControlPointService',
        action: 'list',
        params: { limit: 20000 },
      })
      if (!res?.success) {
        setError(String((res as { error?: string })?.error ?? '목록을 불러오지 못했습니다.'))
        setPoints([])
        return
      }
      const data = (res.data ?? res) as ListRes
      const items = Array.isArray(data.items) ? data.items : []
      setPoints(items.map(mapApiItem).filter((v): v is CadastralControlPoint => v != null))
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.')
      setPoints([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { points, loading, error, refresh }
}
