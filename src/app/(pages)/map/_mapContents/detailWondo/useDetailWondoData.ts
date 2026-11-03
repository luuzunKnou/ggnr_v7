'use client'

import { useEffect, useRef, useState } from 'react'
import { call } from '@/lib/api'
import type { DetailWondoItem } from './detailWondoConfig'

type ListRes = {
  scannedAt?: string
  items?: DetailWondoItem[]
}

/** 세부원도 목록 — enabled가 처음 true가 될 때 한 번 불러온다 */
export function useDetailWondoData(enabled: boolean) {
  const [items, setItems] = useState<DetailWondoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestedRef = useRef(false)

  useEffect(() => {
    if (!enabled || requestedRef.current) return
    requestedRef.current = true
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await call('', 'POST', {
          service: 'detailWondoService',
          action: 'list',
          params: {},
        })
        if (cancelled) return
        if (!res?.success) {
          setError(String((res as { error?: string })?.error ?? '목록을 불러오지 못했습니다.'))
          return
        }
        const data = (res.data ?? res) as ListRes
        setItems(Array.isArray(data.items) ? data.items : [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      requestedRef.current = false
    }
  }, [enabled])

  return { items, loading, error }
}
