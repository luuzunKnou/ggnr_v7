'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import ImageLayer from 'ol/layer/Image'
import XYZ from 'ol/source/XYZ'
import ImageWMS from 'ol/source/ImageWMS'
import GeoJSON from 'ol/format/GeoJSON'
import { Crosshair } from 'lucide-react'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import { PARCEL_ANALYSIS_VWORLD_SATELLITE_URL } from '../parcelAnalysis/parcelAnalysis.mapStyle'
import { WORKSPACE } from '../../_mapComponents/layerFactory/serviceLayerFactory'
import type { LayerClickHit } from './useLayerClickDetail'

function escapeCqlString(value: string): string {
  return value.replace(/'/g, "''")
}

function isFidKeyField(tableName: string, keyField: string): boolean {
  const layer = tableName.trim().toLowerCase()
  const field = keyField.trim().toLowerCase()
  if (!field) return false
  return (
    field === 'ogc_fid' ||
    field === 'fid' ||
    field === 'gid' ||
    (Boolean(layer) && field === `${layer}_key`)
  )
}

/**
 * 단건 CQL.
 * - define_field_name 이 `FTR_IDN`처럼 대문자여도 GeoServer 속성은 소문자 → 필드명 소문자화
 * - ftr_idn 은 관망 WMS와 동일 `strToLowerCase(...)`
 * - ogc_fid 등 PK는 `IN ('layer.fid')`
 */
export function buildLayerClickFeatureCql(
  tableName: string,
  keyField: string | null,
  keyValue: string | null
): string | null {
  const layer = String(tableName ?? '')
    .trim()
    .replace(/^.*\./, '')
    .toLowerCase()
  const field = String(keyField ?? '')
    .trim()
    .toLowerCase()
  const value = String(keyValue ?? '').trim()
  if (!field || !value) return null
  if (isFidKeyField(layer, field)) {
    if (!layer) return null
    return `IN ('${escapeCqlString(`${layer}.${value}`)}')`
  }
  const v = escapeCqlString(value)
  // 가압장(wtl_pres_ps) 등 — 관망 연관 탭과 동일
  if (field === 'ftr_idn') {
    return `strToLowerCase(ftr_idn)=strToLowerCase('${v}')`
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return `${field}=${value}`
  }
  return `strToLowerCase(${field})=strToLowerCase('${v}')`
}

/** 점(가압장)처럼 면적 0인 extent는 fit이 실패하므로 패딩 */
function expandExtentForFit(
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

async function fetchExtentViaWfs(
  tableName: string,
  cql: string
): Promise<[number, number, number, number] | null> {
  const layer = String(tableName ?? '')
    .trim()
    .replace(/^.*\./, '')
  if (!layer || !cql) return null
  const geoServerBase = getGeoServerBase()
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.1.0',
    request: 'GetFeature',
    typeName: `${WORKSPACE}:${layer}`,
    outputFormat: 'application/json',
    srsName: 'EPSG:3857',
    maxFeatures: '1',
    CQL_FILTER: cql,
  })
  try {
    const res = await fetch(`${geoServerBase}/${WORKSPACE}/wfs?${params.toString()}`)
    if (!res.ok) return null
    const json = (await res.json()) as {
      features?: Array<{ geometry?: unknown }>
    }
    const geom = json?.features?.[0]?.geometry
    if (!geom) return null
    const olGeom = new GeoJSON().readGeometry(geom as object, {
      dataProjection: 'EPSG:3857',
      featureProjection: 'EPSG:3857',
    })
    const extent = olGeom?.getExtent()
    if (!extent || extent.length !== 4 || extent.some((n) => !Number.isFinite(n))) {
      return null
    }
    return expandExtentForFit([extent[0]!, extent[1]!, extent[2]!, extent[3]!])
  } catch {
    return null
  }
}

type Props = {
  hit: LayerClickHit
  keyField: string | null
  keyValue: string | null
  /** 열 때 계산해 둔 3857 extent (geom 미저장 대비) */
  extent3857?: [number, number, number, number] | null
}

/**
 * blank 상세 「지도」탭 —
 * VWorld 항공 + GeoServer ImageWMS(STYLES=테이블명, 단건 CQL).
 * 벡터로 피처를 그리지 않음.
 */
export function LayerClickDetailBlankMapTab({
  hit,
  keyField,
  keyValue,
  extent3857 = null,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const extentRef = useRef<[number, number, number, number] | null>(null)
  const [canGoToFeature, setCanGoToFeature] = useState(false)

  const fitExtent = useCallback(
    (map: Map | null, extent: [number, number, number, number] | null) => {
      if (!map || !extent) return false
      const padded = expandExtentForFit(extent)
      map.getView().fit(padded, {
        padding: [28, 28, 28, 28],
        maxZoom: 18,
        duration: 350,
      })
      return true
    },
    []
  )

  useEffect(() => {
    if (
      Array.isArray(extent3857) &&
      extent3857.length === 4 &&
      extent3857.every((n) => Number.isFinite(n))
    ) {
      extentRef.current = expandExtentForFit(extent3857)
      setCanGoToFeature(true)
    }
  }, [extent3857])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    const tableName = String(hit.tableName ?? '')
      .trim()
      .replace(/^.*\./, '')
    const cql = buildLayerClickFeatureCql(tableName, keyField, keyValue)
    const geoServerBase = getGeoServerBase()
    const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`

    const aerial = new TileLayer({
      source: new XYZ({
        url: PARCEL_ANALYSIS_VWORLD_SATELLITE_URL,
        attributions: '© VWorld',
        crossOrigin: 'anonymous',
        maxZoom: 19,
      }),
      zIndex: 0,
    })

    const layers: Array<TileLayer<XYZ> | ImageLayer<ImageWMS>> = [aerial]

    // 키가 없어도 레이어는 올리고, CQL은 있을 때만 (빈 맵 방지·디버깅)
    if (tableName) {
      const params: Record<string, unknown> = {
        LAYERS: `${WORKSPACE}:${tableName}`,
        STYLES: tableName,
        TRANSPARENT: true,
        FORMAT: 'image/png',
      }
      if (cql) params.CQL_FILTER = cql
      layers.push(
        new ImageLayer({
          source: new ImageWMS({
            url: wmsUrl,
            params,
            serverType: 'geoserver',
            ratio: 1.5,
            imageLoadFunction: geoserverWmsImageLoadFunction,
          }),
          visible: true,
          opacity: 1,
          zIndex: 10,
        })
      )
    }

    const map = new Map({
      target: el,
      layers,
      view: new View({
        center: [14135000, 4510000],
        zoom: 12,
        projection: 'EPSG:3857',
      }),
      controls: [],
    })
    mapRef.current = map

    let cancelled = false
    const applyFit = (extent: [number, number, number, number] | null) => {
      if (cancelled || !extent) return
      const padded = expandExtentForFit(extent)
      extentRef.current = padded
      setCanGoToFeature(true)
      fitExtent(map, padded)
    }

    if (extentRef.current) {
      applyFit(extentRef.current)
    } else if (tableName && cql) {
      void fetchExtentViaWfs(tableName, cql).then((ext) => {
        if (!cancelled) applyFit(ext)
      })
    }

    const ro = new ResizeObserver(() => {
      map.updateSize()
    })
    ro.observe(el)
    requestAnimationFrame(() => {
      map.updateSize()
      requestAnimationFrame(() => {
        map.updateSize()
        // 탭 표시 직후 size 0이었다가 커진 경우 WMS 재요청
        map.getLayers().forEach((ly) => {
          const src = (ly as ImageLayer<ImageWMS>).getSource?.()
          src?.changed?.()
        })
      })
    })

    return () => {
      cancelled = true
      ro.disconnect()
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [hit.tableName, keyField, keyValue, fitExtent])

  return (
    <div className="relative h-full min-h-0 w-full flex-1 overflow-hidden">
      <div
        ref={hostRef}
        className="absolute inset-0"
        title="위치 지도"
        aria-label="위치 지도"
      />
      <button
        type="button"
        title="현재 위치로 이동"
        aria-label="현재 위치로 이동"
        disabled={!canGoToFeature}
        onClick={() => {
          fitExtent(mapRef.current, extentRef.current)
        }}
        className="absolute right-2 top-2 z-[1] inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-border bg-background/95 px-2 text-[11px] font-medium text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Crosshair className="h-3.5 w-3.5 shrink-0" aria-hidden />
        현재 위치로 이동
      </button>
    </div>
  )
}
