import GeoJSON from 'ol/format/GeoJSON'
import { withBasePathNav } from '@/lib/basePath'
import {
  extractDefineRowKeyValue,
  findDefineKeyFieldName,
  getRowValueByField,
  type DefineFieldLike,
} from '../../_mapComponents/standard/defineLayerRowUtils'
import type { LayerClickHit } from './useLayerClickDetail'

const STORAGE_PREFIX = 'ggnr.layerClickDetail.blank.'
/** 1시간 지난 페이로드 정리 */
const PAYLOAD_TTL_MS = 60 * 60 * 1000
const GEOM_KEYS = new Set([
  'geom',
  'wkb_geometry',
  'shape',
  'the_geom',
  'geometry',
])

export type LayerClickDetailBlankPayload = {
  hit: LayerClickHit
  keyField: string | null
  keyValue: string | null
  /** 지도 fit용 (geom 전체 저장 대신 작은 bbox) */
  extent3857: [number, number, number, number] | null
  createdAt: number
}

function newSid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `sid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function storageKey(sid: string): string {
  return `${STORAGE_PREFIX}${sid}`
}

function isGeomValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as { type?: unknown; coordinates?: unknown }
  return o.type != null && o.coordinates != null
}

/** localStorage 용량·직렬화 실패 방지 — geom·초대형 값 제외 */
function slimHitData(
  data: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!data || typeof data !== 'object') return out
  for (const [k, v] of Object.entries(data)) {
    if (GEOM_KEYS.has(k.toLowerCase())) continue
    if (isGeomValue(v)) continue
    if (typeof v === 'string' && v.length > 20_000) continue
    if (typeof v === 'object' && v != null) {
      try {
        if (JSON.stringify(v).length > 20_000) continue
      } catch {
        continue
      }
    }
    out[k] = v
  }
  return out
}

function pickRawGeom(
  data: Record<string, unknown> | null | undefined
): unknown | null {
  if (!data || typeof data !== 'object') return null
  for (const k of GEOM_KEYS) {
    if (data[k] != null) return data[k]
  }
  for (const [k, v] of Object.entries(data)) {
    if (GEOM_KEYS.has(k.toLowerCase()) || isGeomValue(v)) return v
  }
  return null
}

/** 점 레이어(가압장 등) 면적 0 extent → fit용 패딩 */
function expandPointExtent(
  extent: [number, number, number, number],
  padMeters = 80
): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = extent
  const w = maxX - minX
  const h = maxY - minY
  if (w < padMeters * 2 || h < padMeters * 2) {
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const half = Math.max(padMeters, w / 2, h / 2)
    return [cx - half, cy - half, cx + half, cy + half]
  }
  return extent
}

/** geom → EPSG:3857 extent (숫자 4개만 저장) */
export function extent3857FromGeom(
  geom: unknown
): [number, number, number, number] | null {
  let geo: unknown = geom
  if (typeof geo === 'string') {
    try {
      geo = JSON.parse(geo)
    } catch {
      return null
    }
  }
  if (!geo || typeof geo !== 'object') return null
  try {
    const olGeom = new GeoJSON().readGeometry(geo as object, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    })
    const extent = olGeom?.getExtent()
    if (!extent || extent.length !== 4 || extent.some((n) => !Number.isFinite(n))) {
      return null
    }
    return expandPointExtent([extent[0]!, extent[1]!, extent[2]!, extent[3]!])
  } catch {
    return null
  }
}

function purgeExpiredBlankPayloads() {
  try {
    const now = Date.now()
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as { createdAt?: number }
        const at = Number(parsed?.createdAt ?? 0)
        if (!Number.isFinite(at) || now - at > PAYLOAD_TTL_MS) {
          window.localStorage.removeItem(key)
        }
      } catch {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    /* ignore */
  }
}

function parsePayload(raw: string | null): LayerClickDetailBlankPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as LayerClickDetailBlankPayload
    if (!parsed?.hit || typeof parsed.hit !== 'object') return null
    const at = Number(parsed.createdAt ?? 0)
    if (Number.isFinite(at) && Date.now() - at > PAYLOAD_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function persistPayload(sid: string, payload: LayerClickDetailBlankPayload): boolean {
  const raw = JSON.stringify(payload)
  try {
    window.localStorage.setItem(storageKey(sid), raw)
    return window.localStorage.getItem(storageKey(sid)) === raw
  } catch {
    return false
  }
}

/**
 * localStorage에서 읽기.
 * Strict Mode remount 대비 — 읽은 직후 삭제하지 않음(TTL로 정리).
 */
export function readLayerClickDetailBlankPayload(
  sid: string
): LayerClickDetailBlankPayload | null {
  if (typeof window === 'undefined') return null
  const key = String(sid ?? '').trim()
  if (!key) return null
  try {
    return parsePayload(window.localStorage.getItem(storageKey(key)))
  } catch {
    return null
  }
}

/** 지도 기본 모달(약 520×640)과 비슷한 팝업 크기 */
function popupFeatures(): string {
  const width = 540
  const height = 680
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number }
  const left = Math.max(
    0,
    Math.round(((screen?.availWidth ?? width) - width) / 2) + (screen?.availLeft ?? 0)
  )
  const top = Math.max(
    0,
    Math.round(((screen?.availHeight ?? height) - height) / 2) + (screen?.availTop ?? 0)
  )
  return [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'menubar=no',
    'toolbar=no',
    'location=yes',
    'status=yes',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',')
}

/** fields 없거나 is_key 없을 때 hit.data에서 키 추정 */
function guessKeyFromHit(hit: LayerClickHit): {
  keyField: string | null
  keyValue: string | null
} {
  for (const f of ['ftr_idn', 'ogc_fid', 'gid', 'id'] as const) {
    const v = getRowValueByField(hit.data, f)
    if (v != null && String(v).trim()) {
      return { keyField: f, keyValue: String(v).trim() }
    }
  }
  return { keyField: null, keyValue: null }
}

function resolveBlankKeys(
  hit: LayerClickHit,
  fields?: ReadonlyArray<DefineFieldLike> | null
): { keyField: string | null; keyValue: string | null } {
  // GeoServer 속성명은 소문자 — define 의 FTR_IDN 등도 소문자로 맞춤
  const keyFieldRaw = findDefineKeyFieldName(fields)
  const keyField = keyFieldRaw ? keyFieldRaw.trim().toLowerCase() : null
  if (keyField) {
    const keyValue = extractDefineRowKeyValue(hit.data, keyField)
    if (keyValue) return { keyField, keyValue }
  }
  return guessKeyFromHit(hit)
}

function buildPayload(
  hit: LayerClickHit,
  keyField: string | null,
  keyValue: string | null
): LayerClickDetailBlankPayload {
  const extent3857 = extent3857FromGeom(pickRawGeom(hit.data))
  return {
    hit: {
      ...hit,
      data: slimHitData(hit.data),
    },
    keyField,
    keyValue,
    extent3857,
    createdAt: Date.now(),
  }
}

/** define 필드가 있으면 키를 채우고, 없으면 hit 추정 키로 연다. */
export function openLayerClickDetailBlank(
  hit: LayerClickHit,
  fields?: ReadonlyArray<DefineFieldLike> | null
): Window | null {
  if (typeof window === 'undefined') return null
  const { keyField, keyValue } = resolveBlankKeys(hit, fields)

  purgeExpiredBlankPayloads()
  const sid = newSid()
  const payload = buildPayload(hit, keyField, keyValue)
  if (!persistPayload(sid, payload)) {
    console.warn('[layerClickDetailBlank] localStorage 저장 실패')
    return null
  }

  const url = withBasePathNav(
    `/map/layer-click-detail?sid=${encodeURIComponent(sid)}`
  )
  return window.open(url, `ggnrLayerClickDetail_${sid}`, popupFeatures())
}
