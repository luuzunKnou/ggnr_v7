'use client'

/**
 * 단수구역도 캡처 — v6 stopWater handleMapCapture 기반
 * (항공영상 + 단수 면 빨강 채움 20%·테두리 40%/2.5px).
 * 주민 안내용 문서라 상수관로는 그리지 않는다.
 * 화면 지도는 건드리지 않도록 숨김 지도를 따로 만들어 그린다.
 */
import { Map, View } from 'ol'
import Feature from 'ol/Feature'
import { Polygon } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import type XYZ from 'ol/source/XYZ'
import { Fill, Stroke, Style } from 'ol/style'
import { transform } from 'ol/proj'
import { fromString } from 'ol/transform'
import '../../../../_mapComponents/config/projections'
import { createPrintCaptureBackgroundLayer } from '../../../mapPrint/mapPrintCapture'

/** v6 단수구역도 원본 크기(HWPX shapeComment 기준) */
const CAPTURE_W = 1728
const CAPTURE_H = 875
const FIT_PADDING = [70, 70, 70, 70]
const WAIT_MS = 8000

function waitTiles(source: XYZ, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let pending = 0
    let done = false
    let idle: number | null = null
    const finish = () => {
      if (done) return
      done = true
      if (idle != null) window.clearTimeout(idle)
      source.un('tileloadstart', onStart)
      source.un('tileloadend', onEnd)
      source.un('tileloaderror', onEnd)
      resolve()
    }
    const scheduleIdle = () => {
      if (idle != null) window.clearTimeout(idle)
      idle = window.setTimeout(() => {
        if (pending === 0) finish()
      }, 120)
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
    scheduleIdle()
    window.setTimeout(finish, timeoutMs)
  })
}

function waitRender(map: Map, timeoutMs: number): Promise<void> {
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

/** 레이어 캔버스 합성 → PNG data URL */
function composite(map: Map): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = CAPTURE_W
  canvas.height = CAPTURE_H
  const ctx = canvas.getContext('2d')
  const root = map.getViewport().querySelector('.ol-layers')
  if (!ctx || !root) return null
  ctx.fillStyle = '#e8eef2'
  ctx.fillRect(0, 0, CAPTURE_W, CAPTURE_H)
  for (const container of root.children) {
    const el = container as HTMLElement
    const layerCanvas = (el.firstElementChild ?? el) as HTMLCanvasElement
    if (!(layerCanvas instanceof HTMLCanvasElement) || !layerCanvas.width || !layerCanvas.height) continue
    const opacity = el.style.opacity || layerCanvas.style.opacity
    ctx.globalAlpha = opacity === '' ? 1 : Number(opacity)
    const t = layerCanvas.style.transform
    const matrix = t ? fromString(t) : null
    if (matrix && matrix.length === 6) {
      ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5])
    } else {
      const sx = parseFloat(layerCanvas.style.width) / layerCanvas.width
      const sy = parseFloat(layerCanvas.style.height) / layerCanvas.height
      ctx.setTransform(Number.isFinite(sx) && sx > 0 ? sx : 1, 0, 0, Number.isFinite(sy) && sy > 0 ? sy : 1, 0, 0)
    }
    try {
      ctx.drawImage(layerCanvas, 0, 0)
    } catch {
      /* CORS 오염 캔버스는 건너뜀 */
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * 단수 면(4326, [바깥 고리, ...구멍])을 화면에 맞춰 캡처한 PNG data URL. 실패 시 null.
 */
export async function captureOutageZoneImage(
  polygons: [number, number][][][],
  backgroundId = 'general-vworld'
): Promise<string | null> {
  const polys = polygons
    .filter((p) => (p[0]?.length ?? 0) >= 3)
    .map((p) => new Polygon(p.map((r) => r.map((c) => transform(c, 'EPSG:4326', 'EPSG:3857')))))
  if (polys.length === 0) return null

  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${CAPTURE_W}px;height:${CAPTURE_H}px;pointer-events:none;z-index:-1`
  document.body.appendChild(host)

  const bg = createPrintCaptureBackgroundLayer(backgroundId)
  const zoneSource = new VectorSource({ features: polys.map((g) => new Feature({ geometry: g })) })
  const map = new Map({
    target: host,
    controls: [],
    interactions: [],
    pixelRatio: 1,
    layers: [
      bg,
      new VectorLayer({
        source: zoneSource,
        zIndex: 20,
        // v6 단수구역 표시 기반 — 채움 0.4 → 0.2, 외곽선도 완화(불투명 4px → 0.4 / 2.5px)
        style: new Style({
          fill: new Fill({ color: 'rgba(255, 0, 0, 0.2)' }),
          stroke: new Stroke({ color: 'rgba(255, 0, 0, 0.4)', width: 2.5 }),
        }),
      }),
    ],
    view: new View({ projection: 'EPSG:3857' }),
  })
  try {
    map.setSize([CAPTURE_W, CAPTURE_H])
    map.getView().fit(zoneSource.getExtent(), { padding: FIT_PADDING, size: [CAPTURE_W, CAPTURE_H] })
    const tileSource = bg.getSource() as XYZ | null
    await Promise.all([
      tileSource ? waitTiles(tileSource, WAIT_MS) : Promise.resolve(),
      waitRender(map, WAIT_MS),
    ])
    await waitRender(map, 1500)
    return composite(map)
  } finally {
    map.setTarget(undefined)
    map.dispose()
    host.remove()
  }
}
