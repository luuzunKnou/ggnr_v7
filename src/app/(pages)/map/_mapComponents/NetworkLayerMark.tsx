'use client'

import { useEffect, useState } from 'react'
import { getLegendGraphicUrl } from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory'
import { call } from '@/lib/api'
import { getGeoServerBase } from '@/lib/geoserverUrl'

export type NetworkLayerGeomKind = 'line' | 'point' | 'area'

const DEFAULT_LINE_STROKE = '#64748b'
const strokeCache = new Map<string, string>()
const strokeInflight = new Map<string, Promise<string>>()

function unwrapStylePayload(res: { data?: unknown } | null | undefined): {
  success?: boolean
  styleProps?: { strokeColor?: string }
} | null {
  const outer = res?.data as
    | {
        data?: { success?: boolean; styleProps?: { strokeColor?: string } }
        success?: boolean
        styleProps?: { strokeColor?: string }
      }
    | undefined
  if (!outer || typeof outer !== 'object') return null
  if ('data' in outer && outer.data && typeof outer.data === 'object') return outer.data
  return outer
}

async function fetchLineStroke(styleName: string): Promise<string> {
  const key = styleName.toLowerCase()
  const cached = strokeCache.get(key)
  if (cached) return cached
  const pending = strokeInflight.get(key)
  if (pending) return pending

  const p = (async () => {
    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getGeoServerStyle',
        params: { url: getGeoServerBase(), name: styleName },
      })
      const data = unwrapStylePayload(res)
      const stroke = String(data?.styleProps?.strokeColor ?? '').trim()
      const color = stroke || DEFAULT_LINE_STROKE
      strokeCache.set(key, color)
      return color
    } catch {
      strokeCache.set(key, DEFAULT_LINE_STROKE)
      return DEFAULT_LINE_STROKE
    } finally {
      strokeInflight.delete(key)
    }
  })()
  strokeInflight.set(key, p)
  return p
}

function FallbackMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <circle cx="7" cy="7" r="3" fill="#94a3b8" />
    </svg>
  )
}

/** LINE 범례 — GeoServer 대각선 대신 가로선(흰 테두리 + 메인색) */
function HorizontalLineMark({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="7"
        x2="13"
        y2="7"
        stroke="#ffffff"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="1"
        y1="7"
        x2="13"
        y2="7"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 관망조회 분류 버튼 공통 범례.
 * 선: 가로 SVG / 점·면: GetLegendGraphic
 */
export function NetworkLayerMark({
  styleName,
  geomKind,
}: {
  styleName: string
  geomKind: NetworkLayerGeomKind
}) {
  const isLine = geomKind === 'line'
  const wms = String(styleName ?? '').trim()
  const [failed, setFailed] = useState(false)
  const [lineColor, setLineColor] = useState(
    () => (wms ? strokeCache.get(wms.toLowerCase()) : undefined) ?? ''
  )
  const src = !isLine && wms ? getLegendGraphicUrl(wms, wms) : ''

  useEffect(() => {
    if (!isLine || !wms) return
    let cancelled = false
    const cached = strokeCache.get(wms.toLowerCase())
    if (cached) {
      setLineColor(cached)
      return
    }
    void fetchLineStroke(wms).then((color) => {
      if (!cancelled) setLineColor(color)
    })
    return () => {
      cancelled = true
    }
  }, [isLine, wms])

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (isLine) {
    return <HorizontalLineMark color={lineColor || DEFAULT_LINE_STROKE} />
  }

  if (!src || failed) return <FallbackMark />

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={14}
      height={14}
      className="h-3.5 w-3.5 shrink-0 object-contain"
      onLoad={(e) => {
        const img = e.currentTarget
        if (img.naturalWidth <= 2 && img.naturalHeight <= 2) setFailed(true)
      }}
      onError={() => setFailed(true)}
    />
  )
}
