'use client'

import { useEffect, useMemo, useRef } from 'react'
import type Map from 'ol/Map'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import Polygon from 'ol/geom/Polygon'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { WORKSPACE } from '../../../_mapComponents/layerFactory/serviceLayerFactory'
import {
  prepareMapForPanelAwareNavigation,
  scheduleFitMapToExtent3857,
} from '../../../_mapComponents/config/mapAutoNavigation'
import { SCALE_BAR_PX } from '../../../_mapComponents/hooks/mapScale'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { MeterZone } from './clusterMeterZones'
import type { MeterLocateResult } from './locateMeterAddresses'

/** 구역 이동 시 목표 축척막대(m) — 한 구역 = 35m 화면 */
const ZONE_TARGET_SCALE_M = 35
const ZONE_MIN_SCALE_M = 30
const ZONE_MAX_SCALE_M = 40

function labelText(label: string, offsetY: number): Text {
  return new Text({
    text: label,
    font: '12px sans-serif',
    fill: new Fill({ color: '#0f172a' }),
    stroke: new Stroke({ color: '#ffffff', width: 3 }),
    overflow: true,
    offsetY,
  })
}

const zonePolygonStyle = new Style({
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.95)', width: 2 }),
  fill: new Fill({ color: 'rgba(37, 99, 235, 0)' }),
})

function pointStyle(label: string, dimmed = false): Style {
  return new Style({
    image: new Circle({
      radius: dimmed ? 5 : 7,
      fill: new Fill({
        color: dimmed ? 'rgba(50, 118, 195, 0.22)' : 'rgba(50, 118, 195, 0.9)',
      }),
      stroke: new Stroke({
        color: dimmed ? 'rgba(255,255,255,0.45)' : '#ffffff',
        width: dimmed ? 1 : 2,
      }),
    }),
    text: dimmed
      ? new Text({
          text: label,
          font: '11px sans-serif',
          fill: new Fill({ color: 'rgba(15, 23, 42, 0.35)' }),
          stroke: new Stroke({ color: 'rgba(255,255,255,0.5)', width: 2 }),
          overflow: true,
          offsetY: -14,
        })
      : labelText(label, -16),
  })
}

function normalizeZoneExtent(extent: number[]): [number, number, number, number] | null {
  if (extent.length !== 4 || !extent.every((v) => Number.isFinite(v))) return null
  let [xmin, ymin, xmax, ymax] = extent as [number, number, number, number]
  if (xmax < xmin) [xmin, xmax] = [xmax, xmin]
  if (ymax < ymin) [ymin, ymax] = [ymax, ymin]
  const w = xmax - xmin
  const h = ymax - ymin
  if (w < 2 && h < 2) {
    const cx = (xmin + xmax) / 2
    const cy = (ymin + ymax) / 2
    const pad = 40
    return [cx - pad, cy - pad, cx + pad, cy + pad]
  }
  return [xmin, ymin, xmax, ymax]
}

function fitZoneExtentWithScaleBand(
  map: Map,
  extentRaw: number[],
  applyMapViewPadding?: (() => void) | null
): void {
  const extent = normalizeZoneExtent(extentRaw)
  if (!extent) return
  prepareMapForPanelAwareNavigation(map, applyMapViewPadding)
  const view = map.getView()
  const size = map.getSize()
  if (!size || size[0] <= 0 || size[1] <= 0) return

  const fitPadding: [number, number, number, number] = [80, 80, 80, 80]
  const availW = Math.max(1, size[0] - fitPadding[1] - fitPadding[3])
  const availH = Math.max(1, size[1] - fitPadding[0] - fitPadding[2])
  let resolution = view.getResolutionForExtent(extent, [availW, availH])
  if (!Number.isFinite(resolution) || resolution <= 0) {
    resolution = ZONE_TARGET_SCALE_M / SCALE_BAR_PX
  }

  const scaleAtFit = resolution * SCALE_BAR_PX
  const maxRes = ZONE_MAX_SCALE_M / SCALE_BAR_PX
  const minRes = ZONE_MIN_SCALE_M / SCALE_BAR_PX
  const targetRes = ZONE_TARGET_SCALE_M / SCALE_BAR_PX

  if (scaleAtFit > ZONE_MAX_SCALE_M) {
    // fit 유지
  } else if (scaleAtFit < ZONE_MIN_SCALE_M) {
    resolution = targetRes
  } else {
    resolution = Math.min(maxRes, Math.max(minRes, resolution))
  }

  const cx = (extent[0] + extent[2]) / 2
  const cy = (extent[1] + extent[3]) / 2
  view.animate({
    center: [cx, cy],
    resolution,
    duration: 500,
  })
}

function buildJijukPnuCql(pnus: string[]): string | undefined {
  const unique = [...new Set(pnus.map((p) => p.replace(/\D/g, '').slice(0, 19)).filter(Boolean))]
  if (unique.length === 0) return undefined
  // GeoServer CQL — 기존 jijuk 스타일 유지, PNU만 필터
  const list = unique.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
  return `pnu IN (${list})`
}

/**
 * 계량기 점(벡터) + 필지(jijuk) — 목록만, 구역 선택 시 구역 외는 숨김.
 */
export function useMeterParcelLayer(
  rows: MeterLocateResult[],
  focusId: string | null,
  zoneFocusKey: string | null,
  zoneExtent3857: [number, number, number, number] | null,
  selectedZoneId: string | null,
  zones: MeterZone[]
) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)
  const zoneSourceRef = useRef<VectorSource | null>(null)
  const jijukLayerRef = useRef<ImageLayer<ImageWMS> | null>(null)

  const zoneRowIds = useMemo(() => {
    if (!selectedZoneId) return null
    const zone = zones.find((z) => z.zoneId === selectedZoneId)
    return new Set(zone?.rowIds ?? [])
  }, [selectedZoneId, zones])

  const pnuList = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) {
      if (zoneRowIds && !zoneRowIds.has(row.id)) continue
      const pnu = String(row.pnu ?? '').replace(/\D/g, '').slice(0, 19)
      if (pnu) set.add(pnu)
    }
    return [...set]
  }, [rows, zoneRowIds])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return

    const source = new VectorSource()
    sourceRef.current = source
    const pointLayer = new VectorLayer({ source, declutter: true, zIndex: 870 })
    pointLayer.set('wtlMeterParcels', true)
    map.addLayer(pointLayer)

    const zoneSource = new VectorSource()
    zoneSourceRef.current = zoneSource
    const zoneLayer = new VectorLayer({
      source: zoneSource,
      style: zonePolygonStyle,
      zIndex: 865,
    })
    zoneLayer.set('wtlMeterZones', true)
    map.addLayer(zoneLayer)

    const geoServerBase = getGeoServerBase()
    const jijukLayer = new ImageLayer({
      minZoom: 16,
      source: new ImageWMS({
        url: `${geoServerBase}/${WORKSPACE}/wms`,
        params: {
          LAYERS: `${WORKSPACE}:jijuk`,
          STYLES: 'jijuk',
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
        imageLoadFunction: geoserverWmsImageLoadFunction,
      }),
      zIndex: 860,
      visible: false,
    })
    jijukLayer.set('wtlMeterJijuk', true)
    jijukLayer.set('layerTableName', 'jijuk')
    jijukLayerRef.current = jijukLayer
    map.addLayer(jijukLayer)

    return () => {
      sourceRef.current = null
      zoneSourceRef.current = null
      jijukLayerRef.current = null
      map.removeLayer(pointLayer)
      map.removeLayer(zoneLayer)
      map.removeLayer(jijukLayer)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    const source = zoneSourceRef.current
    if (!source) return
    source.clear()
    for (const zone of zones) {
      const extent = zone.extent3857
      if (!zone.navigable || !extent) continue
      const [xmin, ymin, xmax, ymax] = extent
      const feature = new Feature({
        geometry: new Polygon([
          [
            [xmin, ymin],
            [xmax, ymin],
            [xmax, ymax],
            [xmin, ymax],
            [xmin, ymin],
          ],
        ]),
      })
      feature.setId(zone.zoneId)
      source.addFeature(feature)
    }
  }, [zones, mapContext?.mapReady])

  // 목록 점 — 구역 선택 시 구역 외 숨김
  useEffect(() => {
    const source = sourceRef.current
    if (!source) return
    source.clear()
    const drawn = rows.filter((row) => {
      if (row.status === 'miss' || !row.point4326) return false
      if (zoneRowIds && !zoneRowIds.has(row.id)) return false
      return true
    })
    if (drawn.length === 0) return
    try {
      const features = new GeoJSON().readFeatures(
        {
          type: 'FeatureCollection',
          features: drawn.map((row) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: row.point4326 },
            properties: { label: row.input, rowId: row.id },
          })),
        },
        { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
      )
      for (const feature of features) {
        const rowId = String(feature.get('rowId') ?? '')
        const label = String(feature.get('label') ?? '')
        feature.setId(rowId)
        feature.setStyle(pointStyle(label, false))
      }
      source.addFeatures(features)
    } catch {
      source.clear()
    }
  }, [rows, zoneRowIds])

  useEffect(() => {
    const layer = jijukLayerRef.current
    const source = layer?.getSource()
    if (!layer || !source) return
    const cql = buildJijukPnuCql(pnuList)
    if (!cql) {
      layer.setVisible(false)
      source.updateParams({ CQL_FILTER: 'INCLUDE' })
      return
    }
    layer.setVisible(true)
    source.setImageLoadFunction(geoserverWmsImageLoadFunction)
    source.updateParams({
      LAYERS: `${WORKSPACE}:jijuk`,
      STYLES: 'jijuk',
      CQL_FILTER: cql,
      _ts: Date.now(),
    })
  }, [pnuList])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source || !focusId) return
    const extent = source.getFeatureById(focusId)?.getGeometry()?.getExtent()
    if (!extent || !extent.every((value) => Number.isFinite(value))) return
    scheduleFitMapToExtent3857(map, extent, {
      maxZoom: 19,
      applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
    })
  }, [focusId, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef])

  useEffect(() => {
    if (!zoneFocusKey || !zoneExtent3857) return
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return
    const extent = [...zoneExtent3857]

    const run = () => {
      fitZoneExtentWithScaleBand(map, extent, mapContext?.applyMapViewPaddingRef?.current)
    }
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(run)
      })
    })
  }, [
    zoneFocusKey,
    zoneExtent3857,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapInstanceRef,
  ])
}
