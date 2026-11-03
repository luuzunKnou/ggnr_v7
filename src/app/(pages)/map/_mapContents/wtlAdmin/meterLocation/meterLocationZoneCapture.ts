'use client'

import { Map, View } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import type XYZ from 'ol/source/XYZ'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { defaults as defaultControls } from 'ol/control'
import { fromString } from 'ol/transform'
import type MapType from 'ol/Map'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import '../../../_mapComponents/config/projections'
import { RESOLUTIONS_3857 } from '../../../_mapComponents/config/mapDefaults'
import { SCALE_BAR_PX } from '../../../_mapComponents/hooks/mapScale'
import { WORKSPACE } from '../../../_mapComponents/layerFactory/serviceLayerFactory'
import { createPrintCaptureBackgroundLayer } from '../../mapPrint/mapPrintCapture'

const CAPTURE_W = 720
const CAPTURE_H = 420
const ZONE_TARGET_SCALE_M = 90

export type MeterZoneCapturePoint = {
  label: string
  point4326: [number, number]
  pnu?: string | null
}

export type MeterZoneCaptureResult = {
  dataUrl: string | null
  status: 'ok' | 'failed'
  reason: string
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function waitRenderComplete(map: MapType, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    map.once('rendercomplete', finish)
    map.render()
    window.setTimeout(finish, timeoutMs)
  })
}

function waitTilesLoaded(source: XYZ, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let pending = 0
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      source.un('tileloadstart', onStart)
      source.un('tileloadend', onEnd)
      source.un('tileloaderror', onEnd)
      resolve()
    }
    const onStart = () => {
      pending += 1
    }
    const onEnd = () => {
      pending = Math.max(0, pending - 1)
      if (pending === 0) window.setTimeout(finish, 80)
    }
    source.on('tileloadstart', onStart)
    source.on('tileloadend', onEnd)
    source.on('tileloaderror', onEnd)
    window.setTimeout(finish, timeoutMs)
  })
}

function normalizeExtent(
  extent: [number, number, number, number]
): [number, number, number, number] {
  let [xmin, ymin, xmax, ymax] = extent
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

function buildJijukPnuCql(pnus: string[]): string | undefined {
  const unique = [
    ...new Set(pnus.map((p) => p.replace(/\D/g, '').slice(0, 19)).filter(Boolean)),
  ]
  if (unique.length === 0) return undefined
  const list = unique.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
  return `pnu IN (${list})`
}

function pointStyle(label: string): Style {
  return new Style({
    image: new Circle({
      radius: 6,
      fill: new Fill({ color: 'rgba(50, 118, 195, 0.95)' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
    text: new Text({
      text: label,
      font: '11px sans-serif',
      fill: new Fill({ color: '#0f172a' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
      overflow: true,
      offsetY: -14,
    }),
  })
}

/** 숨김 지도 레이어만 합성 — CORS 오염 레이어 없음 */
function compositeOffscreenToCanvas(map: MapType, target: HTMLCanvasElement): boolean {
  const size = map.getSize()
  if (!size) return false
  const [width, height] = size
  target.width = width
  target.height = height
  const ctx = target.getContext('2d')
  if (!ctx) return false
  const layersRoot = map.getViewport().querySelector('.ol-layers')
  if (!layersRoot) return false
  ctx.fillStyle = '#e8eef2'
  ctx.fillRect(0, 0, width, height)
  let drew = false
  for (const container of layersRoot.children) {
    const element = container as HTMLElement
    const canvas = (element.firstElementChild ?? element) as HTMLCanvasElement
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) continue
    const opacity = element.style.opacity || canvas.style.opacity
    ctx.globalAlpha = opacity === '' ? 1 : Number(opacity)
    const transform = canvas.style.transform
    if (transform) {
      const matrix = fromString(transform)
      if (matrix.length === 6) {
        ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5])
      }
    } else {
      const w = parseFloat(canvas.style.width) / canvas.width
      const h = parseFloat(canvas.style.height) / canvas.height
      ctx.setTransform(
        Number.isFinite(w) && w > 0 ? w : 1,
        0,
        0,
        Number.isFinite(h) && h > 0 ? h : 1,
        0,
        0
      )
    }
    try {
      ctx.drawImage(canvas, 0, 0)
      drew = true
    } catch {
      /* tainted */
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  return drew
}

/**
 * 메인 지도를 움직이지 않고 화면 밖 숨김 OL 지도로 구역 캡처.
 * 배경 타일·지적·점은 클라이언트에서 로드 (폐쇄망: 자체정사·내부 GeoServer).
 */
export async function captureZoneMapDataUrl(
  extent3857: [number, number, number, number],
  points: MeterZoneCapturePoint[],
  backgroundId = 'aerial-vworld'
): Promise<MeterZoneCaptureResult> {
  const host = document.createElement('div')
  // opacity:0 은 타일 미렌더 원인이 되므로 화면 밖으로만 이동
  host.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:0',
    `width:${CAPTURE_W}px`,
    `height:${CAPTURE_H}px`,
    'opacity:1',
    'pointer-events:none',
    'visibility:visible',
    'z-index:-1',
  ].join(';')
  document.body.appendChild(host)

  let map: Map | null = null
  try {
    const extent = normalizeExtent(extent3857)
    const bg = createPrintCaptureBackgroundLayer(backgroundId?.trim() || 'aerial-vworld')
    bg.set('name', 'background')
    const tileSource = bg.getSource()

    const pnus = points
      .map((p) => String(p.pnu ?? '').replace(/\D/g, '').slice(0, 19))
      .filter(Boolean)
    const cql = buildJijukPnuCql(pnus)
    const geoServerBase = getGeoServerBase()
    const jijukLayer = new ImageLayer({
      source: new ImageWMS({
        url: `${geoServerBase}/${WORKSPACE}/wms`,
        params: {
          LAYERS: `${WORKSPACE}:jijuk`,
          STYLES: 'jijuk',
          TRANSPARENT: true,
          FORMAT: 'image/png',
          ...(cql ? { CQL_FILTER: cql } : {}),
        },
        serverType: 'geoserver',
        ratio: 1,
        imageLoadFunction: geoserverWmsImageLoadFunction,
        crossOrigin: 'anonymous',
      }),
      zIndex: 10,
      visible: Boolean(cql),
    })

    const vectorSource = new VectorSource()
    if (points.length > 0) {
      try {
        const features = new GeoJSON().readFeatures(
          {
            type: 'FeatureCollection',
            features: points.map((p) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: p.point4326 },
              properties: { label: p.label },
            })),
          },
          { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
        )
        for (const feature of features) {
          feature.setStyle(pointStyle(String(feature.get('label') ?? '')))
        }
        vectorSource.addFeatures(features)
      } catch {
        /* ignore */
      }
    }
    const pointLayer = new VectorLayer({
      source: vectorSource,
      declutter: true,
      zIndex: 20,
    })

    const view = new View({
      resolutions: RESOLUTIONS_3857,
      minZoom: 0,
      maxZoom: RESOLUTIONS_3857.length - 1,
      constrainResolution: true,
    })
    const fitPadding: [number, number, number, number] = [36, 36, 36, 36]
    const availW = Math.max(1, CAPTURE_W - fitPadding[1] - fitPadding[3])
    const availH = Math.max(1, CAPTURE_H - fitPadding[0] - fitPadding[2])
    let resolution = view.getResolutionForExtent(extent, [availW, availH])
    if (!Number.isFinite(resolution) || resolution <= 0) {
      resolution = ZONE_TARGET_SCALE_M / SCALE_BAR_PX
    }
    view.setCenter([(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2])
    view.setResolution(resolution)

    map = new Map({
      target: host,
      layers: [bg, jijukLayer, pointLayer],
      view,
      controls: defaultControls({ attribution: false, zoom: false }),
      interactions: [],
    })
    map.setSize([CAPTURE_W, CAPTURE_H])
    map.updateSize()
    map.renderSync()
    await waitMs(50)

    if (tileSource) await waitTilesLoaded(tileSource, 8000)
    await waitRenderComplete(map, 4000)
    await waitMs(500)
    await waitRenderComplete(map, 3000)
    await waitMs(150)

    const canvas = document.createElement('canvas')
    if (!compositeOffscreenToCanvas(map, canvas) || canvas.width < 2) {
      const reason = '숨김 지도 레이어 합성 실패(타일 미로드·WebGL)'
      console.warn('[meterLocation capture]', reason, { extent, backgroundId })
      return { dataUrl: null, status: 'failed', reason }
    }

    let dataUrl = ''
    try {
      dataUrl = canvas.toDataURL('image/png')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const reason = /taint|security|cross-origin/i.test(msg)
        ? `PNG 변환 실패(캔버스 오염) — ${msg}`
        : `PNG 변환 실패 — ${msg}`
      console.warn('[meterLocation capture]', reason)
      return { dataUrl: null, status: 'failed', reason }
    }
    if (!dataUrl || dataUrl.length < 64) {
      return { dataUrl: null, status: 'failed', reason: '빈 PNG' }
    }
    return { dataUrl, status: 'ok', reason: '' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : '캡처 예외'
    console.warn('[meterLocation capture]', reason, err)
    return { dataUrl: null, status: 'failed', reason }
  } finally {
    map?.setTarget(undefined)
    host.remove()
  }
}
