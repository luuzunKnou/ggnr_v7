'use client'

import { useEffect, useRef, useState } from 'react'
import { call } from '@/lib/api'
import { withDetailWondoDisplayNumbers, type DetailWondoItem } from './detailWondoConfig'

type ListRes = {
  scannedAt?: string
  items?: DetailWondoItem[]
}

export type DetailWondoScanPhase = 'idle' | 'load' | 'walk' | 'read' | 'save'

export type DetailWondoScanProgress = {
  scanning: boolean
  phase: DetailWondoScanPhase
  current: number
  total: number
  found: number
  pct: number
}

const POLL_MS = 400

type ScanProgressRes = Partial<DetailWondoScanProgress>

function asProgress(raw: ScanProgressRes | undefined): DetailWondoScanProgress | null {
  if (!raw || typeof raw.phase !== 'string') return null
  return {
    scanning: Boolean(raw.scanning),
    phase: raw.phase,
    current: Number(raw.current) || 0,
    total: Number(raw.total) || 0,
    found: Number(raw.found) || 0,
    pct: Math.max(0, Math.min(100, Number(raw.pct) || 0)),
  }
}

/** 세부원도 목록 — enabled가 처음 true가 될 때 한 번 불러온다 */
export function useDetailWondoData(enabled: boolean) {
  const [items, setItems] = useState<DetailWondoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<DetailWondoScanProgress | null>(null)
  const requestedRef = useRef(false)

  useEffect(() => {
    if (!enabled || requestedRef.current) return
    requestedRef.current = true
    let cancelled = false
    let stopPoll = false

    const poll = async () => {
      while (!cancelled && !stopPoll) {
        try {
          const res = await call('', 'POST', {
            service: 'detailWondoService',
            action: 'scanProgress',
            params: {},
          })
          if (cancelled || stopPoll) return
          if (res?.success) {
            const next = asProgress((res.data ?? res) as ScanProgressRes)
            if (next) setProgress(next)
          }
        } catch {
          /* 진행 조회 실패는 목록 요청과 별개 */
        }
        if (cancelled || stopPoll) return
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
    }

    const load = async () => {
      setLoading(true)
      setError(null)
      void poll()
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
        setItems(withDetailWondoDisplayNumbers(Array.isArray(data.items) ? data.items : []))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.')
      } finally {
        stopPoll = true
        if (!cancelled) {
          setLoading(false)
          setProgress(null)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      stopPoll = true
      requestedRef.current = false
    }
  }, [enabled])

  return { items, loading, error, progress }
}
