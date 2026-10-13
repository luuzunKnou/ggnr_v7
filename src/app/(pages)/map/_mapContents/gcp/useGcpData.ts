'use client'

import { useCallback, useEffect, useState } from 'react'
import { call } from '@/lib/api'
import {
  GCP_CREATE_DRAFT_EVENT,
  clearGcpCreate,
  getGcpCreateDraft,
  type GcpCreateDraft,
} from './gcpCreateDraft'
import type { GcpPoint } from './gcpTypes'

type ListRes = {
  items?: Array<{
    id?: string
    gcpnum?: string
    x?: number
    y?: number
    z?: number
    geom5181?: [number, number]
    placeNote?: string
    txt1?: string
    txt2?: string
  }>
  total?: number
}

function mapItem(row: NonNullable<ListRes['items']>[number]): GcpPoint | null {
  const id = String(row.id ?? '').trim()
  if (!id) return null
  const gx = Number(row.geom5181?.[0])
  const gy = Number(row.geom5181?.[1])
  const x = Number(row.x)
  const y = Number(row.y)
  const z = Number(row.z)
  return {
    id,
    gcpnum: String(row.gcpnum ?? id),
    x: Number.isFinite(x) ? x : Number.isFinite(gx) ? gx : 0,
    y: Number.isFinite(y) ? y : Number.isFinite(gy) ? gy : 0,
    z: Number.isFinite(z) ? z : 0,
    geom5181:
      Number.isFinite(gx) && Number.isFinite(gy)
        ? [gx, gy]
        : [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0],
    placeNote: String(row.placeNote ?? '').trim(),
    txt1: String(row.txt1 ?? '').trim(),
    txt2: String(row.txt2 ?? '').trim(),
  }
}

export function useGcpData() {
  const [points, setPoints] = useState<GcpPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createDraft, setCreateDraft] = useState<GcpCreateDraft | null>(getGcpCreateDraft)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await call('', 'POST', {
        service: 'gcpService',
        action: 'list',
        params: {},
      })
      if (!res?.success) {
        setError(String((res as { error?: string })?.error ?? '목록을 불러오지 못했습니다.'))
        setPoints([])
        return
      }
      const data = (res.data ?? res) as ListRes
      const items = Array.isArray(data.items) ? data.items : []
      setPoints(items.map(mapItem).filter((v): v is GcpPoint => v != null))
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

  useEffect(() => {
    const sync = () => setCreateDraft(getGcpCreateDraft())
    window.addEventListener(GCP_CREATE_DRAFT_EVENT, sync)
    return () => window.removeEventListener(GCP_CREATE_DRAFT_EVENT, sync)
  }, [])

  return {
    points,
    loading,
    error,
    createDraft,
    refresh,
    clearCreate: clearGcpCreate,
  }
}
