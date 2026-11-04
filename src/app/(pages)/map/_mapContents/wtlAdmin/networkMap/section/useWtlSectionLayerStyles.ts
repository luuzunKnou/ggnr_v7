'use client'

import { useEffect, useMemo, useState } from 'react'
import { call } from '@/lib/api'
import { getGeoServerBase, getGeoServerPublicBase } from '@/lib/geoserverUrl'
import {
  parseSldConditionalSymbols,
  resolveSymbolPreviewUrl,
  type StyleProps,
} from '@/lib/geoserverStyleUtils'
import type { SectionFeatureMark } from './wtlNetworkSectionSvg'

export type WtlSectionLayerStyle = {
  layerKey: string
  strokeColor: string
  strokeWidth: number
  strokeOpacity: number
  fillColor: string
  markSize: number
  /** Chart.js pointStyle용 (로드 성공 시) — 레이어 기본 */
  symbolImg: HTMLImageElement | null
  /** HTML 범례 img src — 레이어 기본 */
  legendSrc: string
  /** ftr_cde 등 코드 → 심볼 (SLD 조건 Rule) */
  symbolByCode: Record<
    string,
    { symbolImg: HTMLImageElement | null; legendSrc: string }
  >
}

type StylePayload = {
  success?: boolean
  styleProps?: StyleProps
  body?: string
  format?: string
}

const styleCache = new Map<
  string,
  { props: StyleProps; body: string; format: string }
>()
const styleInflight = new Map<
  string,
  Promise<{ props: StyleProps; body: string; format: string }>
>()
const imageCache = new Map<string, HTMLImageElement | null>()
const imageInflight = new Map<string, Promise<HTMLImageElement | null>>()

function unwrapStylePayload(res: { data?: unknown } | null | undefined): StylePayload | null {
  const outer = res?.data as
    | { data?: StylePayload; success?: boolean; styleProps?: StyleProps; body?: string; format?: string }
    | undefined
  if (!outer || typeof outer !== 'object') return null
  if ('data' in outer && outer.data && typeof outer.data === 'object') return outer.data
  return outer
}

function emptyProps(): StyleProps {
  return {}
}

async function fetchStyleBundle(layerKey: string): Promise<{
  props: StyleProps
  body: string
  format: string
}> {
  const key = layerKey.toLowerCase()
  const cached = styleCache.get(key)
  if (cached) return cached
  const pending = styleInflight.get(key)
  if (pending) return pending

  const p = (async () => {
    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getGeoServerStyle',
        params: { url: getGeoServerBase(), name: layerKey },
      })
      const data = unwrapStylePayload(res)
      const bundle = {
        props: data?.styleProps ?? emptyProps(),
        body: String(data?.body ?? ''),
        format: String(data?.format ?? 'sld').toLowerCase(),
      }
      styleCache.set(key, bundle)
      return bundle
    } catch {
      const bundle = { props: emptyProps(), body: '', format: 'sld' }
      styleCache.set(key, bundle)
      return bundle
    } finally {
      styleInflight.delete(key)
    }
  })()
  styleInflight.set(key, p)
  return p
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = imageInflight.get(url)
  if (pending) return pending

  const p = new Promise<HTMLImageElement | null>((resolve) => {
    if (typeof Image === 'undefined') {
      imageCache.set(url, null)
      resolve(null)
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageCache.set(url, img)
      imageInflight.delete(url)
      resolve(img)
    }
    img.onerror = () => {
      imageCache.set(url, null)
      imageInflight.delete(url)
      resolve(null)
    }
    img.src = url
  })
  imageInflight.set(url, p)
  return p
}

function clampStrokeWidth(n: number | undefined): number {
  if (!Number.isFinite(n) || !n || n <= 0) return 2
  return Math.min(4, Math.max(1, n))
}

function normalizeHex(color: string | undefined, fallback: string): string {
  const v = String(color ?? '').trim()
  if (!v) return fallback
  const withHash = v.startsWith('#') ? v : `#${v}`
  if (!/^#[0-9A-Fa-f]{6}$/.test(withHash)) return fallback
  return withHash.toUpperCase()
}

function withAlpha(hex: string, alphaHex: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex
  return `${hex}${alphaHex}`
}

/** 관로 bubble 반투명 채움 */
export function strokeFillAlpha(hex: string): string {
  return withAlpha(hex, '99')
}

export function pointRadiusFromMarkSize(markSize: number | undefined): number {
  const n = Number.isFinite(markSize) && (markSize as number) > 0 ? (markSize as number) : 18
  return Math.min(12, Math.max(6, Math.round(n * 0.45)))
}

async function resolveSymbolPair(symbolRaw: string): Promise<{
  symbolImg: HTMLImageElement | null
  legendSrc: string
}> {
  const href = resolveSymbolPreviewUrl(symbolRaw, getGeoServerPublicBase())
  if (!href) return { symbolImg: null, legendSrc: '' }
  const symbolImg = await loadImage(href)
  return {
    symbolImg,
    legendSrc: symbolImg ? href : '',
  }
}

/**
 * 단면도 차트용 레이어 스타일(선 색·굵기, 점 심볼 Image).
 * SLD 조건 Rule(ftr_cde 등)별 ExternalGraphic 도 로드.
 */
export function useWtlSectionLayerStyles(
  features: SectionFeatureMark[]
): {
  stylesByKey: Record<string, WtlSectionLayerStyle>
  revision: number
} {
  const layerKeys = useMemo(() => {
    const set = new Set<string>()
    for (const f of features) {
      const k = String(f.layerKey ?? '').trim().toLowerCase()
      if (k && /^wtl_[a-z0-9_]+$/i.test(k)) set.add(k)
    }
    return [...set].sort()
  }, [features])

  const keysSig = layerKeys.join('|')
  const [stylesByKey, setStylesByKey] = useState<Record<string, WtlSectionLayerStyle>>({})
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!layerKeys.length) {
      setStylesByKey({})
      setRevision((n) => n + 1)
      return
    }
    let cancelled = false

    void (async () => {
      const next: Record<string, WtlSectionLayerStyle> = {}
      await Promise.all(
        layerKeys.map(async (layerKey) => {
          const { props, body, format } = await fetchStyleBundle(layerKey)
          const fallbackColor = '#7A7A7A'
          const strokeColor = normalizeHex(
            props.strokeColor || props.fillColor,
            fallbackColor
          )
          const fillColor = normalizeHex(props.fillColor || props.strokeColor, strokeColor)
          const strokeWidth = clampStrokeWidth(props.strokeWidth)
          const strokeOpacity =
            Number.isFinite(props.strokeOpacity) && (props.strokeOpacity as number) > 0
              ? Math.min(1, props.strokeOpacity as number)
              : 1
          const markSize =
            Number.isFinite(props.markSize) && (props.markSize as number) > 0
              ? (props.markSize as number)
              : 18

          const symbolByCode: WtlSectionLayerStyle['symbolByCode'] = {}
          if (format !== 'css' && body) {
            const cases = parseSldConditionalSymbols(body)
            await Promise.all(
              cases.map(async (c) => {
                const pair = await resolveSymbolPair(c.symbolUrl)
                if (!pair.legendSrc && !pair.symbolImg) return
                symbolByCode[c.value] = pair
              })
            )
          }

          // 레이어 기본 심볼 (단일 ExternalGraphic / styleProps.symbolUrl)
          let symbolImg: HTMLImageElement | null = null
          let legendSrc = ''
          const symbolRaw = String(props.symbolUrl ?? '').trim()
          if (symbolRaw) {
            const pair = await resolveSymbolPair(symbolRaw)
            symbolImg = pair.symbolImg
            legendSrc = pair.legendSrc
          } else {
            // 조건 심볼만 있으면 첫 코드를 기본으로
            const first = Object.values(symbolByCode)[0]
            if (first) {
              symbolImg = first.symbolImg
              legendSrc = first.legendSrc
            }
          }

          next[layerKey] = {
            layerKey,
            strokeColor,
            strokeWidth,
            strokeOpacity,
            fillColor,
            markSize,
            symbolImg,
            legendSrc,
            symbolByCode,
          }
        })
      )
      if (cancelled) return
      setStylesByKey(next)
      setRevision((n) => n + 1)
    })()

    return () => {
      cancelled = true
    }
  }, [keysSig, layerKeys])

  return { stylesByKey, revision }
}

/** 레이어 기본 + styleCode(ftr_cde) 조건 심볼 반영 */
export function styleForFeature(
  stylesByKey: Record<string, WtlSectionLayerStyle>,
  f: SectionFeatureMark
): WtlSectionLayerStyle | undefined {
  const k = String(f.layerKey ?? '').trim().toLowerCase()
  if (!k) return undefined
  const base = stylesByKey[k]
  if (!base) return undefined
  const code = String(f.styleCode ?? '').trim().toUpperCase()
  if (code && base.symbolByCode[code]) {
    const hit = base.symbolByCode[code]!
    return {
      ...base,
      symbolImg: hit.symbolImg,
      legendSrc: hit.legendSrc || base.legendSrc,
    }
  }
  return base
}
