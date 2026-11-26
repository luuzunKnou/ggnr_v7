'use client'

import { Map, View } from 'ol'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import type XYZ from 'ol/source/XYZ'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'
import type { FeatureLike } from 'ol/Feature'
import { defaults as defaultControls } from 'ol/control'
import { fromLonLat } from 'ol/proj'
import { fromString } from 'ol/transform'
import type MapType from 'ol/Map'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import '../../../_mapComponents/config/projections'
import { RESOLUTIONS_3857 } from '../../../_mapComponents/config/mapDefaults'
import { SCALE_BAR_PX } from '../../../_mapComponents/hooks/mapScale'
import { WORKSPACE } from '../../../_mapComponents/layerFactory/serviceLayerFactory'
import { createPrintCaptureBackgroundLayer } from '../../mapPrint/mapPrintCapture'

/** A4 세로 보고서용 — 인쇄 선명도 */
const CAPTURE_W = 960
const CAPTURE_H = 540
/** 구역 캡처 목표 축척막대(m) — git 기존 밴드(30~40, 목표 35) */
const ZONE_TARGET_SCALE_M = 35
const ZONE_MIN_SCALE_M = 30
const ZONE_MAX_SCALE_M = 40
/** 벡터 겹침 시 확대 하한(축척막대 m) — 이보다 더 확대하지 않음 */
const ZONE_CAPTURE_OVERLAP_MIN_SCALE_M = 15
/** 번호 마커 원 반지름(px) — 겹침·화면 안 판정 */
const METER_MARKER_RADIUS_PX = 12
const MARKER_EDGE_PAD_PX = METER_MARKER_RADIUS_PX + 8

const CAPTURE_BUILDING_LAYERS = [
  { tableName: 'tl_sgco_rnadr_mst', zIndex: 8 },
  { tableName: 'tl_sgco_rnadr_dong', zIndex: 9 },
] as const

export type MeterZoneCapturePoint = {
  label: string
  point4326: [number, number]
  pnu?: string | null
  /** 보고서 표 번호(1부터) — 지도 벡터 마커에 표시 */
  index: number
}

function meterIndexStyle(feature: FeatureLike): Style {
  const idx = String(feature.get('index') ?? '')
  return new Style({
    image: new CircleStyle({
      radius: 12,
      fill: new Fill({ color: '#2563eb' }),
      stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
    }),
    text: new Text({
      text: idx,
      font: 'bold 12px "Malgun Gothic","Apple SD Gothic Neo",sans-serif',
      fill: new Fill({ color: '#ffffff' }),
      textAlign: 'center',
      textBaseline: 'middle',
    }),
    zIndex: 30,
  })
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

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
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
    map.renderSync()
    window.setTimeout(finish, timeoutMs)
  })
}

type ArmedWait = {
  promise: Promise<void>
  /** 뷰·파라미터 갱신·render 직후 호출. 타일 요청이 큐에 잡힐 여유를 둔다. */
  arm: () => void
}

/**
 * XYZ 타일 대기.
 * arm 직후 바로 통과하지 않고, OL이 타일 요청을 걸 여유(grace)를 둔 뒤
 * pending==0일 때만 통과 — 미로드 격자(뿌연 칸) 캡처 방지.
 */
function watchTiles(source: XYZ, timeoutMs: number, graceMs = 280): ArmedWait {
  let pending = 0
  let settled = false
  let armed = false
  let idleTimer: number | null = null
  let graceTimer: number | null = null
  let capTimer: number | null = null
  let resolveFn: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve
  })
  const finish = () => {
    if (settled) return
    settled = true
    if (idleTimer != null) window.clearTimeout(idleTimer)
    if (graceTimer != null) window.clearTimeout(graceTimer)
    if (capTimer != null) window.clearTimeout(capTimer)
    source.un('tileloadstart', onStart)
    source.un('tileloadend', onEnd)
    source.un('tileloaderror', onEnd)
    resolveFn()
  }
  const scheduleIdle = () => {
    if (!armed || settled || pending > 0) return
    if (idleTimer != null) window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      if (pending === 0) finish()
    }, 120)
  }
  const onStart = () => {
    pending += 1
    if (idleTimer != null) window.clearTimeout(idleTimer)
    if (graceTimer != null) {
      window.clearTimeout(graceTimer)
      graceTimer = null
    }
  }
  const onEnd = () => {
    pending = Math.max(0, pending - 1)
    if (pending === 0) scheduleIdle()
  }
  source.on('tileloadstart', onStart)
  source.on('tileloadend', onEnd)
  source.on('tileloaderror', onEnd)
  capTimer = window.setTimeout(finish, timeoutMs)
  return {
    promise,
    arm() {
      armed = true
      if (graceTimer != null) window.clearTimeout(graceTimer)
      // 뷰 변경 직후 타일 요청이 오기 전에 idle로 통과하지 않도록 유예
      graceTimer = window.setTimeout(() => {
        graceTimer = null
        if (pending === 0) scheduleIdle()
      }, graceMs)
    },
  }
}

/** WMS 한 장. arm 후 요청이 없으면 캐시로 보고 통과(유예 후). */
function watchImageWms(source: ImageWMS, timeoutMs: number, graceMs = 320): ArmedWait {
  let settled = false
  let armed = false
  let started = false
  let loaded = false
  let capTimer: number | null = null
  let idleTimer: number | null = null
  let resolveFn: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve
  })
  const finish = () => {
    if (settled) return
    settled = true
    if (capTimer != null) window.clearTimeout(capTimer)
    if (idleTimer != null) window.clearTimeout(idleTimer)
    source.un('imageloadstart', onStart)
    source.un('imageloadend', onDone)
    source.un('imageloaderror', onDone)
    resolveFn()
  }
  const onStart = () => {
    started = true
    if (idleTimer != null) window.clearTimeout(idleTimer)
  }
  const onDone = () => {
    loaded = true
    if (armed) finish()
  }
  source.on('imageloadstart', onStart)
  source.on('imageloadend', onDone)
  source.on('imageloaderror', onDone)
  capTimer = window.setTimeout(finish, timeoutMs)
  return {
    promise,
    arm() {
      armed = true
      if (loaded) {
        finish()
        return
      }
      if (idleTimer != null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        if (!started) finish()
      }, graceMs)
    },
  }
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

  // 작은 구역도 35m 근처로 — fit만 쓰면 과도 확대됨 (git 기존 로직)
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

/** 마커 중심이 화면 가장자리 패딩 안에 있는지 */
function allMarkersInsideFrame(
  map: MapType,
  points: MeterZoneCapturePoint[]
): boolean {
  const pad = MARKER_EDGE_PAD_PX
  for (const p of points) {
    const lon = Number(p.point4326[0])
    const lat = Number(p.point4326[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const pixel = map.getPixelFromCoordinate(fromLonLat([lon, lat]))
    if (!pixel || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) {
      return false
    }
    if (
      pixel[0] < pad ||
      pixel[1] < pad ||
      pixel[0] > CAPTURE_W - pad ||
      pixel[1] > CAPTURE_H - pad
    ) {
      return false
    }
  }
  return true
}

/** 번호 마커 스크린 좌표 기준 원 겹침 여부 */
function meterMarkersOverlap(
  map: MapType,
  points: MeterZoneCapturePoint[]
): boolean {
  const coords: Array<[number, number]> = []
  for (const p of points) {
    const lon = Number(p.point4326[0])
    const lat = Number(p.point4326[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const pixel = map.getPixelFromCoordinate(fromLonLat([lon, lat]))
    if (!pixel || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) continue
    coords.push([pixel[0], pixel[1]])
  }
  const minDist = METER_MARKER_RADIUS_PX * 2
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const dx = coords[i]![0] - coords[j]![0]
      const dy = coords[i]![1] - coords[j]![1]
      if (Math.hypot(dx, dy) < minDist) return true
    }
  }
  return false
}

/** 타일 해상도 1단계 확대(스냅). 15m 미만 금지 */
function zoomInOneResolutionStep(view: View): boolean {
  const current = Number(view.getResolution())
  if (!Number.isFinite(current) || current <= 0) return false
  const floorRes = ZONE_CAPTURE_OVERLAP_MIN_SCALE_M / SCALE_BAR_PX
  if (current <= floorRes + 1e-12) return false

  let next: number | null = null
  const idx = RESOLUTIONS_3857.findIndex((r) => Math.abs(r - current) < r * 1e-6)
  if (idx >= 0 && idx < RESOLUTIONS_3857.length - 1) {
    next = RESOLUTIONS_3857[idx + 1]!
  } else {
    const tighter = RESOLUTIONS_3857.filter((r) => r < current - 1e-12)
    next = tighter.length > 0 ? Math.max(...tighter) : null
  }
  if (next == null || next < floorRes - 1e-12) return false
  if (next >= current - 1e-12) return false
  view.setResolution(next)
  return true
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

  const buildingEntries = CAPTURE_BUILDING_LAYERS.map(({ tableName, zIndex }) => {
    const source = new ImageWMS({
      url: `${geoServerBase}/${WORKSPACE}/wms`,
      params: {
        LAYERS: `${WORKSPACE}:${tableName}`,
        STYLES: tableName,
        TRANSPARENT: true,
        FORMAT: 'image/png',
      },
      serverType: 'geoserver',
      ratio: 1,
      imageLoadFunction: geoserverWmsImageLoadFunction,
      crossOrigin: 'anonymous',
    })
    const layer = new ImageLayer({
      source,
      zIndex,
      visible: true,
    })
    return { source, layer }
  })

  // 보고서 캡처: 계량기 WMS 미사용 — 번호 벡터만 표시
  const indexSource = new VectorSource()
  const indexLayer = new VectorLayer({
    source: indexSource,
    style: meterIndexStyle,
    zIndex: 40,
    visible: true,
  })

  // git 기존: 확대 스냅(constrainResolution)
  const view = new View({
    resolutions: RESOLUTIONS_3857,
    minZoom: 0,
    maxZoom: RESOLUTIONS_3857.length - 1,
    constrainResolution: true,
  })

  const map = new Map({
    target: host,
    layers: [bg, ...buildingEntries.map((e) => e.layer), jijukLayer, indexLayer],
    view,
    controls: defaultControls({ attribution: false, zoom: false }),
    interactions: [],
  })
  map.setSize([CAPTURE_W, CAPTURE_H])
  map.updateSize()

  let disposed = false
  let captureCount = 0

  async function waitLayersReady(signal?: AbortSignal): Promise<void> {
    const tileCap = captureCount === 0 ? 7000 : 5000
    const wmsCap = captureCount === 0 ? 6000 : 4500
    const tileWait = tileSource ? watchTiles(tileSource, tileCap) : null
    const wmsWaits = [
      ...(jijukLayer.getVisible()
        ? [watchImageWms(jijukSource, wmsCap)]
        : []),
      ...buildingEntries
        .filter((e) => e.layer.getVisible())
        .map((e) => watchImageWms(e.source, wmsCap)),
    ]
    map.renderSync()
    tileWait?.arm()
    for (const w of wmsWaits) w.arm()
    throwIfAborted(signal)
    await raceUntil(
      Promise.all([
        tileWait?.promise ?? Promise.resolve(),
        ...wmsWaits.map((w) => w.promise),
      ]).then(() => undefined),
      signal
    )
    throwIfAborted(signal)
    // 타일 그린 뒤 한 프레임 더 안정화 — 미로드·빈 지도 캡처 방지
    await raceUntil(waitRenderComplete(map, 2500), signal)
    await raceUntil(waitMs(220), signal)
    await raceUntil(waitRenderComplete(map, 1800), signal)
  }

  return {
    async captureZone(extent3857, points, signal) {
      if (disposed || signal?.aborted) {
        return { dataUrl: null, status: 'failed', reason: '캡처 취소됨' }
      }
      try {
        // git 기존 맞춤(30~40m 밴드 + 스냅) — 구역 fit 우선
        map.setSize([CAPTURE_W, CAPTURE_H])
        map.updateSize()
        applyViewToExtent(view, extent3857)

        const pnus = points
          .map((p) => String(p.pnu ?? '').replace(/\D/g, '').slice(0, 19))
          .filter(Boolean)
        const jijukCql = buildJijukPnuCql(pnus)

        if (jijukCql) {
          jijukLayer.setVisible(true)
          jijukSource.updateParams({
            LAYERS: `${WORKSPACE}:jijuk`,
            STYLES: 'jijuk',
            CQL_FILTER: jijukCql,
            _: String(Date.now()),
          })
        } else {
          jijukLayer.setVisible(false)
          jijukSource.updateParams({ CQL_FILTER: undefined })
        }

        for (const { source, layer } of buildingEntries) {
          layer.setVisible(true)
          source.updateParams({ _: String(Date.now()) })
        }

        // 계량기 WMS 대신 표 번호 벡터 마커만
        indexSource.clear()
        for (const p of points) {
          const lon = Number(p.point4326[0])
          const lat = Number(p.point4326[1])
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
          const feature = new Feature({
            geometry: new Point(fromLonLat([lon, lat])),
            index: p.index,
          })
          indexSource.addFeature(feature)
        }

        // 타일·WMS 로드 완료 후 캡처 (미로드 격자·빈 지도 방지)
        await waitLayersReady(signal)

        // 옵션: 마커 겹치면 타일 단계 확대. 벡터가 잘리면 그 단계 취소
        let guard = 0
        while (meterMarkersOverlap(map, points) && guard < 8) {
          const before = Number(view.getResolution())
          if (!zoomInOneResolutionStep(view)) break
          guard += 1
          map.renderSync()
          if (!allMarkersInsideFrame(map, points)) {
            if (Number.isFinite(before) && before > 0) {
              view.setResolution(before)
              map.renderSync()
            }
            break
          }
          // 줌 변경 후 타일 재대기 — 미로드 상태로 찍히는 것 방지
          throwIfAborted(signal)
          await waitLayersReady(signal)
        }

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
      indexSource.clear()
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
