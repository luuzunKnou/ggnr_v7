/**
 * =============================================================================
 * [공사대장 · 관련시설 아이콘 의도 — 임의로 바꾸지 말 것]
 * =============================================================================
 *
 * - 스타일 조회 키 = 레이어명(layerKey). 예: wtl_valv_ps, wtl_fire_ps
 * - 심볼 URL = 그 레이어 GeoServer SLD에 적힌 ExternalGraphic만
 *   · SLD에 ftr_cde/saa_cde 조건이 있으면 styleCode로 고름
 *   · 조건에 없거나 코드가 없으면 해당 스타일 기본 심볼
 *
 * 금지:
 * - ftr_cde로 `{layer}_{code}.svg` / `wtl_valv_ps_sa202` 스타일명을 임의 조립
 *   (코드마다 아이콘·전용 스타일이 있는 게 아님. WMS/SLD가 진실)
 * - SA202 등 특정 코드 하드코딩
 *
 * 목록·맵무브 의도: WtlConsRelatedTabs / useWtlConsMapLayer 상단 주석.
 * =============================================================================
 */
'use client'

import { Circle as CircleStyle, Fill, Icon, Stroke, Style } from 'ol/style'

import { call } from '@/lib/api'
import {
  parseSldConditionalSymbols,
  parseSldEnvStyle,
  parseSimpleStyleFromCss,
  resolveSymbolPreviewUrl,
  type GeometryType,
  type StyleProps,
} from '@/lib/geoserverStyleUtils'
import { getGeoServerBase, getGeoServerPublicBase } from '@/lib/geoserverUrl'

type StyleBundle = {
  styleProps: StyleProps
  geometryType: GeometryType
  /** ftr_cde 등 → 절대/공개 심볼 URL */
  symbolByCode: Record<string, string>
  /** ftr_cde 등 → 해당 Rule SLD Size(픽셀) */
  sizeByCode: Record<string, number>
  defaultSymbolUrl: string | null
}

const bundleCache = new Map<string, StyleBundle | null>()
const bundleInflight = new Map<string, Promise<StyleBundle | null>>()
const okIconUrls = new Set<string>()
const missingIconUrls = new Set<string>()
/** 로드된 심볼 원본 픽셀 — WMS Size와 맞추려면 scale = size / max(w,h) */
const iconNaturalSize = new Map<string, { w: number; h: number }>()
const styleInstanceCache = new Map<string, Style>()

/** SLD·심볼 파일 변경 반영용. invalidate 시 증가 → URL ?v= */
let symbolCacheEpoch = 1

const RELATED_STROKE = '#0f766e'
const RELATED_FILL = 'rgba(13, 148, 136, 0.22)'

/** 메모리 캐시 전부 비움. 다음 prefetch가 GeoServer·이미지를 다시 읽음 */
export function invalidateRelatedFacilityStyleCache(): void {
  symbolCacheEpoch += 1
  bundleCache.clear()
  bundleInflight.clear()
  okIconUrls.clear()
  missingIconUrls.clear()
  iconNaturalSize.clear()
  styleInstanceCache.clear()
}

function withCacheBust(url: string): string {
  const base = url.split('#')[0] ?? url
  const hash = url.includes('#') ? `#${url.split('#').slice(1).join('#')}` : ''
  const cleaned = base.replace(/([?&])v=\d+/g, '$1').replace(/[?&]$/, '')
  const sep = cleaned.includes('?') ? '&' : '?'
  return `${cleaned}${sep}v=${symbolCacheEpoch}${hash}`
}

function unwrapPayload<T>(res: { data?: unknown }): T | null {
  const outer = res.data as { data?: T; success?: boolean } | T | undefined
  if (outer && typeof outer === 'object' && 'data' in (outer as object) && 'success' in (outer as object)) {
    return (outer as { data: T }).data ?? null
  }
  return (outer as T) ?? null
}

function resolveHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  return (
    resolveSymbolPreviewUrl(trimmed, getGeoServerPublicBase()) ??
    resolveSymbolPreviewUrl(trimmed, getGeoServerBase()) ??
    trimmed
  )
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`icon load fail: ${src}`))
    img.src = src
  })
}

async function ensureIcon(src: string): Promise<boolean> {
  if (okIconUrls.has(src) && iconNaturalSize.has(src)) return true
  if (missingIconUrls.has(src)) return false
  try {
    const img = await loadImage(src)
    const w = img.naturalWidth || img.width || 0
    const h = img.naturalHeight || img.height || 0
    if (w > 0 && h > 0) iconNaturalSize.set(src, { w, h })
    okIconUrls.add(src)
    return true
  } catch {
    missingIconUrls.add(src)
    return false
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return `rgba(128,128,128,${alpha})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`
}

async function fetchStyleBundle(styleName: string): Promise<StyleBundle | null> {
  const key = styleName.toLowerCase()
  if (bundleCache.has(key)) return bundleCache.get(key) ?? null
  const pending = bundleInflight.get(key)
  if (pending) return pending

  const p = (async (): Promise<StyleBundle | null> => {
    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getGeoServerStyle',
        params: { url: getGeoServerBase(), name: styleName },
      })
      const data = unwrapPayload<{
        success?: boolean
        body?: string
        format?: string
        styleProps?: StyleProps
        geometryType?: GeometryType
      }>(res)
      if (!data || data.success === false) {
        bundleCache.set(key, null)
        return null
      }

      const body = String(data.body ?? '')
      const format = String(data.format ?? 'sld').toLowerCase()
      let styleProps = data.styleProps ?? {}
      let geometryType = data.geometryType

      if ((!data.styleProps || !geometryType) && body) {
        if (format === 'css') {
          const parsed = parseSimpleStyleFromCss(body)
          styleProps = parsed.styleProps
          geometryType = parsed.geometryType
        } else {
          const parsed = parseSldEnvStyle(body, styleName)
          if (parsed) {
            styleProps = parsed.styleProps
            geometryType = parsed.geometryType
          }
        }
      }
      if (!geometryType) geometryType = 'POINT'

      const symbolByCode: Record<string, string> = {}
      const sizeByCode: Record<string, number> = {}
      if (format !== 'css' && body) {
        for (const c of parseSldConditionalSymbols(body)) {
          const href = resolveHref(c.symbolUrl)
          if (!href) continue
          const code = c.value.toUpperCase()
          symbolByCode[code] = withCacheBust(href)
          if (c.size != null && c.size > 0) sizeByCode[code] = c.size
        }
      }

      let defaultSymbolUrl: string | null = null
      const rawDefault = styleProps.symbolUrl?.trim()
      if (rawDefault) {
        const href = resolveHref(rawDefault)
        if (href) defaultSymbolUrl = withCacheBust(href)
      }
      if (!defaultSymbolUrl) {
        const first = Object.values(symbolByCode)[0]
        if (first) defaultSymbolUrl = first
      }
      if (defaultSymbolUrl) {
        styleProps = { ...styleProps, symbolUrl: defaultSymbolUrl }
      }

      const bundle: StyleBundle = {
        styleProps,
        geometryType,
        symbolByCode,
        sizeByCode,
        defaultSymbolUrl,
      }
      bundleCache.set(key, bundle)
      return bundle
    } catch {
      bundleCache.set(key, null)
      return null
    } finally {
      bundleInflight.delete(key)
    }
  })()

  bundleInflight.set(key, p)
  return p
}

/**
 * 아이콘 URL은 SLD에 적힌 것만 사용.
 * - 조건 심볼(symbolByCode)에 styleCode가 있으면 그 ExternalGraphic
 * - 없으면 스타일 기본 심볼
 * ftr_cde로 `{layer}_{code}.svg` 를 임의 조합하지 않음(파일/스타일이 코드마다 있는 건 아님).
 */
function pickSymbolUrl(
  bundle: StyleBundle,
  styleCode?: string | null,
  _styleName?: string
): string | null {
  void _styleName
  const code = String(styleCode ?? '')
    .trim()
    .toUpperCase()
  if (code && bundle.symbolByCode[code]) return bundle.symbolByCode[code]
  return bundle.defaultSymbolUrl
}

function fallbackStyle(geomType: string | undefined): Style | Style[] {
  if (geomType === 'Point' || geomType === 'MultiPoint') {
    return new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: RELATED_FILL }),
        stroke: new Stroke({ color: RELATED_STROKE, width: 2 }),
      }),
      zIndex: 2,
    })
  }
  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    return [
      new Style({
        stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.85)', width: 5 }),
        zIndex: 1,
      }),
      new Style({
        stroke: new Stroke({ color: RELATED_STROKE, width: 2.5 }),
        zIndex: 2,
      }),
    ]
  }
  return new Style({
    fill: new Fill({ color: RELATED_FILL }),
    stroke: new Stroke({ color: RELATED_STROKE, width: 1.5 }),
    zIndex: 1,
  })
}

/**
 * GeoServer SLD `<Size>` — 지도에 그릴 목표 픽셀(기본 18, 지하시설물 ignore_scale=1과 동일).
 */
function iconPixelSize(markSize: number | undefined): number {
  const n = Number.isFinite(markSize) && (markSize as number) > 0 ? (markSize as number) : 18
  return Math.max(1, Math.round(n))
}

function pickMarkSize(bundle: StyleBundle, styleCode?: string | null): number {
  const code = String(styleCode ?? '')
    .trim()
    .toUpperCase()
  if (code && bundle.sizeByCode[code] > 0) return iconPixelSize(bundle.sizeByCode[code])
  return iconPixelSize(bundle.styleProps.markSize)
}

/**
 * WMS는 Size=N이면 N픽셀로 그림. OL은 SVG 원본이 크면 width/height만으로 어긋날 수 있어
 * scale = Size / 원본픽셀 로 맞춘다. (변동이력·누수와 같은 계열)
 */
function iconScaleForSrc(src: string, markPx: number): number {
  const nat = iconNaturalSize.get(src)
  const dim = Math.max(nat?.w ?? 0, nat?.h ?? 0)
  if (dim > 0) return markPx / dim
  return markPx / 24
}

function buildStyle(
  styleName: string,
  bundle: StyleBundle,
  geomType: string | undefined,
  iconSrc: string | null,
  styleCode?: string | null
): Style {
  const p = bundle.styleProps
  const iconPx = pickMarkSize(bundle, styleCode)
  const strokeHex = p.strokeColor ?? p.fillColor ?? RELATED_STROKE
  const fillHex = p.fillColor ?? RELATED_STROKE
  const strokeW = Math.max(1, p.strokeWidth ?? 2)
  const g = String(geomType ?? '')
  const kind =
    g === 'Point' || g === 'MultiPoint'
      ? 'point'
      : g === 'LineString' || g === 'MultiLineString'
        ? 'line'
        : g === 'Polygon' || g === 'MultiPolygon'
          ? 'polygon'
          : bundle.geometryType === 'POINT'
            ? 'point'
            : bundle.geometryType === 'LINE'
              ? 'line'
              : 'polygon'

  const scale = iconSrc ? iconScaleForSrc(iconSrc, iconPx) : 1
  const cacheKey = `${styleName}|${kind}|${iconSrc ?? ''}|${styleCode ?? ''}|${strokeHex}|${iconPx}|${scale.toFixed(4)}`
  const cached = styleInstanceCache.get(cacheKey)
  if (cached) return cached

  let style: Style
  if (kind === 'point') {
    if (iconSrc) {
      style = new Style({
        zIndex: 2,
        image: new Icon({
          src: iconSrc,
          scale,
          anchor: [0.5, 0.5],
          opacity: 1,
        }),
      })
    } else {
      style = new Style({
        zIndex: 2,
        image: new CircleStyle({
          radius: Math.max(5, iconPx / 2.5),
          fill: new Fill({ color: hexToRgba(fillHex, 0.85) }),
          stroke: new Stroke({ color: strokeHex, width: 1.5 }),
        }),
      })
    }
  } else if (kind === 'line') {
    style = new Style({
      zIndex: 2,
      stroke: new Stroke({ color: hexToRgba(strokeHex, 0.95), width: Math.max(strokeW, 2) }),
    })
  } else {
    style = new Style({
      zIndex: 1,
      fill: new Fill({ color: hexToRgba(fillHex, p.opacity ?? 0.35) }),
      stroke: new Stroke({ color: hexToRgba(strokeHex, 0.95), width: strokeW }),
    })
  }
  styleInstanceCache.set(cacheKey, style)
  return style
}

/** OL StyleFunction용. 캐시 미스·아이콘 로딩 중이면 폴백 후 onReady */
export function resolveRelatedFacilityOlStyle(
  styleName: string,
  styleCode: string | null | undefined,
  geomType: string | undefined,
  onReady: () => void
): Style | Style[] {
  const name = styleName.trim()
  if (!name) return fallbackStyle(geomType)

  const key = name.toLowerCase()
  const bundle = bundleCache.get(key)
  if (bundle === null) return fallbackStyle(geomType)
  if (!bundle) {
    void fetchStyleBundle(name).then(() => onReady())
    return fallbackStyle(geomType)
  }

  const isPoint = geomType === 'Point' || geomType === 'MultiPoint' || bundle.geometryType === 'POINT'
  const symbolUrl = isPoint ? pickSymbolUrl(bundle, styleCode, name) : null

  if (symbolUrl && isPoint) {
    if (missingIconUrls.has(symbolUrl)) {
      return buildStyle(key, bundle, geomType, null, styleCode)
    }
    if (okIconUrls.has(symbolUrl)) {
      return buildStyle(key, bundle, geomType, symbolUrl, styleCode)
    }
    void ensureIcon(symbolUrl).then(() => onReady())
    return buildStyle(key, bundle, geomType, null, styleCode)
  }

  return buildStyle(key, bundle, geomType, null, styleCode)
}

/** 선택 강조용 — 로드된 심볼 URL·SLD Size 기준 scale (없으면 null) */
export function peekRelatedFacilityIcon(
  styleName: string,
  styleCode?: string | null
): { src: string; size: number; scale: number } | null {
  const name = styleName.trim()
  const bundle = bundleCache.get(name.toLowerCase())
  if (!bundle) return null
  const url = pickSymbolUrl(bundle, styleCode, name)
  if (!url || missingIconUrls.has(url) || !okIconUrls.has(url)) return null
  const size = pickMarkSize(bundle, styleCode)
  return { src: url, size, scale: iconScaleForSrc(url, size) }
}

/**
 * @param refresh true면 SLD·심볼을 다시 조회(캐시 무효 + URL ?v=).
 * 관련시설 목록이 바뀌거나 공사대장을 다시 열 때 true.
 */
export async function prefetchRelatedFacilityStyles(
  entries: Array<{ styleName: string; styleCode?: string | null }>,
  opts?: { refresh?: boolean }
): Promise<void> {
  if (opts?.refresh) invalidateRelatedFacilityStyleCache()
  const names = [...new Set(entries.map((e) => e.styleName.trim()).filter(Boolean))]
  if (names.length === 0) return
  await Promise.all(names.map((n) => fetchStyleBundle(n)))
  const urls = new Set<string>()
  for (const e of entries) {
    const name = e.styleName.trim()
    const bundle = bundleCache.get(name.toLowerCase())
    if (!bundle) continue
    const url = pickSymbolUrl(bundle, e.styleCode, name)
    if (url) urls.add(url)
  }
  await Promise.all([...urls].map((u) => ensureIcon(u)))
}
