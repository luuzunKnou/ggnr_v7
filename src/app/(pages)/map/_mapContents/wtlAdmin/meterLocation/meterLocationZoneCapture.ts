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

const CAPTURE_W = 560
const CAPTURE_H = 320
/** 구역 캡처 목표 축척막대(m) — 클러스터·화면 이동과 동일 */
const ZONE_TARGET_SCALE_M = 35
const ZONE_MIN_SCALE_M = 30
const ZONE_MAX_SCALE_M = 40

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

export type MeterZoneCaptureSession = {
  captureZone: (
    extent3857: [number, number, number, number],
    points: MeterZoneCapturePoint[],
    signal?: AbortSignal
  ) => Promise<MeterZoneCaptureResult>
  dispose: () => void
}

function abortError(): Error {
  return Object.assign(new Error('capture-aborted'), { name: 'AbortError' })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

/** abort 시에만 reject — Promise.race 상대용 */
function whenAborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    signal?.addEventListener('abort', () => reject(abortError()), { once: true })
  })
}

function waitAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function raceUntil(
  work: Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) {
    await work
    return
  }
  await Promise.race([work, whenAborted(signal)])
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

/** 타일 대기 — pending이 잠깐 0이면 바로 통과 (캐시 hit 시 빠름) */
function waitTilesLoaded(source: XYZ, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let pending = 0
    let settled = false
    let idleTimer: number | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (idleTimer != null) window.clearTimeout(idleTimer)
      source.un('tileloadstart', onStart)
      source.un('tileloadend', onEnd)
      source.un('tileloaderror', onEnd)
      resolve()
    }
    const scheduleIdle = () => {
      if (idleTimer != null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        if (pending === 0) finish()
      }, 40)
    }
    const onStart = () => {
      pending += 1
    }
    const onEnd = () => {
      pending = Math.max(0, pending - 1)
      if (pending === 0) scheduleIdle()
    }
    source.on('tileloadstart', onStart)
    source.on('tileloadend', onEnd)
    source.on('tileloaderror', onEnd)
    // 이미 캐시만 쓰는 경우 이벤트가 안 올 수 있음
    scheduleIdle()
    window.setTimeout(finish, timeoutMs)
  })
}

function waitImageWms(source: ImageWMS, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      source.un('imageloadend', finish)
      source.un('imageloaderror', finish)
      resolve()
    }
    source.once('imageloadend', finish)
    source.once('imageloaderror', finish)
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

function buildMetNumCql(labels: string[]): string | undefined {
  const unique = [...new Set(labels.map((n) => String(n ?? '').trim()).filter(Boolean))]
  if (unique.length === 0) return undefined
  const list = unique.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')
  return `met_num IN (${list})`
}

function pointStyle(label: string): Style {
  return new Style({
    image: new Circle({
      radius: 5,
      fill: new Fill({ color: 'rgba(50, 118, 195, 0.95)' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
    text: new Text({
      text: label,
      font: '10px sans-serif',
      fill: new Fill({ color: '#0f172a' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
      overflow: true,
      offsetY: -12,
    }),
  })
}

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

function applyViewToExtent(
  view: View,
  extentRaw: [number, number, number, number]
): [number, number, number, number] {
  const extent = normalizeExtent(extentRaw)
  const fitPadding: [number, number, number, number] = [28, 28, 28, 28]
  const availW = Math.max(1, CAPTURE_W - fitPadding[1] - fitPadding[3])
  const availH = Math.max(1, CAPTURE_H - fitPadding[0] - fitPadding[2])
  let resolution = view.getResolutionForExtent(extent, [availW, availH])
  if (!Number.isFinite(resolution) || resolution <= 0) {
    resolution = ZONE_TARGET_SCALE_M / SCALE_BAR_PX
  }

  // 작은 구역도 35m 근처로 — fit만 쓰면 과도 확대됨
  const scaleAtFit = resolution * SCALE_BAR_PX
  const targetRes = ZONE_TARGET_SCALE_M / SCALE_BAR_PX
  const maxRes = ZONE_MAX_SCALE_M / SCALE_BAR_PX
  const minRes = ZONE_MIN_SCALE_M / SCALE_BAR_PX
  if (scaleAtFit > ZONE_MAX_SCALE_M) {
    // 구역이 크면 fit 유지(전체 보이게)
  } else if (scaleAtFit < ZONE_MIN_SCALE_M) {
    resolution = targetRes
  } else {
    resolution = Math.min(maxRes, Math.max(minRes, resolution))
  }

  view.setCenter([(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2])
  view.setResolution(resolution)
  return extent
}

function setPointFeatures(
  vectorSource: VectorSource,
  points: MeterZoneCapturePoint[]
): void {
  vectorSource.clear(true)
  if (points.length === 0) return
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

/**
 * 보고서용 숨김 지도 세션 — 구역마다 Map을 새로 만들지 않고 재사용.
 */
export function createMeterZoneCaptureSession(
  backgroundId = 'aerial-vworld'
): MeterZoneCaptureSession {
  const host = document.createElement('div')
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

  const bg = createPrintCaptureBackgroundLayer(backgroundId?.trim() || 'aerial-vworld')
  bg.set('name', 'background')
  const tileSource = bg.getSource()

  const geoServerBase = getGeoServerBase()
  const jijukSource = new ImageWMS({
    url: `${geoServerBase}/${WORKSPACE}/wms`,
    params: {
      LAYERS: `${WORKSPACE}:jijuk`,
      STYLES: 'jijuk',
      TRANSPARENT: true,
      FORMAT: 'image/png',
      CQL_FILTER: 'INCLUDE',
    },
    serverType: 'geoserver',
    ratio: 1,
    imageLoadFunction: geoserverWmsImageLoadFunction,
    crossOrigin: 'anonymous',
  })
  const jijukLayer = new ImageLayer({
    source: jijukSource,
    zIndex: 10,
    visible: false,
  })

  // 구역 선택과 동일 — 해당 구역 급수전만 WMS
  const meterSource = new ImageWMS({
    url: `${geoServerBase}/${WORKSPACE}/wms`,
    params: {
      LAYERS: `${WORKSPACE}:wtl_meta_ps`,
      STYLES: 'wtl_meta_ps',
      TRANSPARENT: true,
      FORMAT: 'image/png',
    },
    serverType: 'geoserver',
    ratio: 1,
    imageLoadFunction: geoserverWmsImageLoadFunction,
    crossOrigin: 'anonymous',
  })
  const meterLayer = new ImageLayer({
    source: meterSource,
    zIndex: 15,
    visible: false,
  })

  const vectorSource = new VectorSource()
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

  const map = new Map({
    target: host,
    layers: [bg, jijukLayer, meterLayer, pointLayer],
    view,
    controls: defaultControls({ attribution: false, zoom: false }),
    interactions: [],
  })
  map.setSize([CAPTURE_W, CAPTURE_H])
  map.updateSize()

  let disposed = false
  let captureCount = 0

  return {
    async captureZone(extent3857, points, signal) {
      if (disposed || signal?.aborted) {
        return { dataUrl: null, status: 'failed', reason: '캡처 취소됨' }
      }
      try {
        // 화면은 35m 기준으로 칸 전체 채움 — 레이어만 해당 구역
        applyViewToExtent(view, extent3857)
        setPointFeatures(vectorSource, points)

        const pnus = points
          .map((p) => String(p.pnu ?? '').replace(/\D/g, '').slice(0, 19))
          .filter(Boolean)
        const jijukCql = buildJijukPnuCql(pnus)
        if (jijukCql) {
          jijukLayer.setVisible(true)
          jijukSource.setImageLoadFunction(geoserverWmsImageLoadFunction)
          jijukSource.updateParams({
            LAYERS: `${WORKSPACE}:jijuk`,
            STYLES: 'jijuk',
            CQL_FILTER: jijukCql,
            _ts: Date.now(),
          })
        } else {
          jijukLayer.setVisible(false)
          jijukSource.updateParams({ CQL_FILTER: undefined })
        }

        const meterCql = buildMetNumCql(points.map((p) => p.label))
        if (meterCql) {
          meterLayer.setVisible(true)
          meterSource.setImageLoadFunction(geoserverWmsImageLoadFunction)
          meterSource.updateParams({
            LAYERS: `${WORKSPACE}:wtl_meta_ps`,
            STYLES: 'wtl_meta_ps',
            CQL_FILTER: meterCql,
            _ts: Date.now(),
          })
        } else {
          meterLayer.setVisible(false)
          meterSource.updateParams({ CQL_FILTER: undefined })
        }

        map.renderSync()
        throwIfAborted(signal)
        // 첫 구역은 타일 워밍, 이후는 캐시 위주라 짧게
        const tileWait = captureCount === 0 ? 2800 : 1200
        if (tileSource) {
          await raceUntil(waitTilesLoaded(tileSource, tileWait), signal)
        }
        throwIfAborted(signal)
        const imgWait = captureCount === 0 ? 1800 : 1200
        if (jijukCql) {
          await raceUntil(waitImageWms(jijukSource, imgWait), signal)
        }
        if (meterCql) {
          await raceUntil(waitImageWms(meterSource, imgWait), signal)
        }
        throwIfAborted(signal)
        await raceUntil(waitRenderComplete(map, 1200), signal)
        await waitAbortable(captureCount === 0 ? 120 : 40, signal)

        const canvas = document.createElement('canvas')
        if (!compositeOffscreenToCanvas(map, canvas) || canvas.width < 2) {
          const reason = '숨김 지도 레이어 합성 실패(타일 미로드·WebGL)'
          console.warn('[meterLocation capture]', reason)
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
          return { dataUrl: null, status: 'failed', reason }
        }
        if (!dataUrl || dataUrl.length < 64) {
          return { dataUrl: null, status: 'failed', reason: '빈 PNG' }
        }
        captureCount += 1
        return { dataUrl, status: 'ok', reason: '' }
      } catch (err) {
        if (
          signal?.aborted ||
          disposed ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return { dataUrl: null, status: 'failed', reason: '캡처 취소됨' }
        }
        const reason = err instanceof Error ? err.message : '캡처 예외'
        console.warn('[meterLocation capture]', reason, err)
        return { dataUrl: null, status: 'failed', reason }
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      map.setTarget(undefined)
      host.remove()
    },
  }
}

/** 단건 캡처 — 세션 생성·폐기 래퍼 */
export async function captureZoneMapDataUrl(
  extent3857: [number, number, number, number],
  points: MeterZoneCapturePoint[],
  backgroundId = 'aerial-vworld'
): Promise<MeterZoneCaptureResult> {
  const session = createMeterZoneCaptureSession(backgroundId)
  try {
    return await session.captureZone(extent3857, points)
  } finally {
    session.dispose()
  }
}
