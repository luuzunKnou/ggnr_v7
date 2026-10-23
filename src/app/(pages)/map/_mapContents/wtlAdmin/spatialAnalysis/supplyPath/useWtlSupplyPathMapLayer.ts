'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import { LineString, Point, Polygon } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import Overlay from 'ol/Overlay'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { transform } from 'ol/proj'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import type { WtlOutageResult } from '../outage/wtlOutageSample'
import type { WtlSupplyGate, WtlSupplyPathResult } from './wtlSupplySample'

const FLOW = '#0284c7'
const SOURCE = '#0369a1'
const OUTAGE_PIPE = '#ea580c'
const OUTAGE_ZONE = 'rgba(220, 38, 38, 0.22)'
const VIEW_ZOOM = 15

function to3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

type GateControl = {
  overlay: Overlay
  root: HTMLDivElement
  openBtn: HTMLButtonElement
  lockBtn: HTMLButtonElement
  gateId: string
}

function paintRadio(control: GateControl, locked: boolean) {
  const base = 'px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-colors'
  control.openBtn.className = locked
    ? `${base} rounded-l border border-slate-300 bg-white text-slate-500 hover:bg-slate-50`
    : `${base} rounded-l border border-emerald-600 bg-emerald-600 text-white`
  control.lockBtn.className = locked
    ? `${base} rounded-r border border-red-600 bg-red-600 text-white`
    : `${base} rounded-r border border-slate-300 bg-white text-slate-500 hover:bg-slate-50`
  control.openBtn.setAttribute('aria-checked', locked ? 'false' : 'true')
  control.lockBtn.setAttribute('aria-checked', locked ? 'true' : 'false')
}

type Props = {
  active: boolean
  result: WtlSupplyPathResult | null
  playing: boolean
  replayToken: number
  lockedGateIds: string[]
  selectedGateId: string | null
  outagePreview: WtlOutageResult | null
  onSelectGate: (gate: WtlSupplyGate) => void
  onLockGate: (gateId: string) => void
  onUnlockGate: (gateId: string) => void
}

export function useWtlSupplyPathMapLayer({
  active,
  result,
  playing,
  replayToken,
  lockedGateIds,
  selectedGateId,
  outagePreview,
  onSelectGate,
  onLockGate,
  onUnlockGate,
}: Props) {
  const mapContext = useMapContext()
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const controlsRef = useRef<Map<string, GateControl>>(new Map())
  const gateCacheRef = useRef<Map<string, WtlSupplyGate>>(new Map())
  const offsetRef = useRef(0)
  const rafRef = useRef(0)
  const playingRef = useRef(playing)
  const lockedRef = useRef(new Set(lockedGateIds))
  const onSelectRef = useRef(onSelectGate)
  const onLockRef = useRef(onLockGate)
  const onUnlockRef = useRef(onUnlockGate)
  playingRef.current = playing
  lockedRef.current = new Set(lockedGateIds)
  onSelectRef.current = onSelectGate
  onLockRef.current = onLockGate
  onUnlockRef.current = onUnlockGate

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 930,
      style: (feature) => {
        const role = String(feature.get('role') ?? '')
        if (role === 'source') {
          return new Style({
            image: new Circle({
              radius: 10,
              fill: new Fill({ color: SOURCE }),
              stroke: new Stroke({ color: '#ffffff', width: 2 }),
            }),
            text: new Text({
              text: String(feature.get('label') ?? ''),
              offsetY: -16,
              font: '12px sans-serif',
              fill: new Fill({ color: '#0c4a6e' }),
              stroke: new Stroke({ color: '#ffffff', width: 3 }),
            }),
          })
        }
        if (role === 'zone') {
          return new Style({
            fill: new Fill({ color: OUTAGE_ZONE }),
            stroke: new Stroke({ color: '#dc2626', width: 1.5 }),
          })
        }
        if (role === 'outagePipe') {
          return new Style({
            stroke: new Stroke({ color: OUTAGE_PIPE, width: 6, lineCap: 'round' }),
          })
        }
        if (role === 'gate') {
          return new Style({
            image: new Circle({
              radius: 7,
              fill: new Fill({ color: '#0f766e' }),
              stroke: new Stroke({ color: '#ffffff', width: 2 }),
            }),
            text: new Text({
              text: String(feature.get('label') ?? ''),
              offsetY: 14,
              font: '10px sans-serif',
              fill: new Fill({ color: '#134e4a' }),
              stroke: new Stroke({ color: '#ffffff', width: 3 }),
            }),
          })
        }
        // supply pipe flow
        return [
          new Style({
            stroke: new Stroke({ color: 'rgba(2,132,199,0.35)', width: 8, lineCap: 'round' }),
          }),
          new Style({
            stroke: new Stroke({
              color: FLOW,
              width: 4,
              lineCap: 'round',
              lineDash: [14, 18],
              lineDashOffset: -offsetRef.current,
            }),
          }),
        ]
      },
    })
    layer.set('wtlSupplyPath', true)
    map.addLayer(layer)
    layerRef.current = layer

    const tick = () => {
      if (playingRef.current) {
        offsetRef.current = (offsetRef.current + 1.2) % 64
        layer.changed()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      for (const control of controlsRef.current.values()) {
        map.removeOverlay(control.overlay)
      }
      controlsRef.current.clear()
      map.removeLayer(layer)
      layerRef.current = null
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  /** 송수 관로·시설 표시 + 경로 제수변 열림/잠금 오버레이 */
  useEffect(() => {
    const layer = layerRef.current
    const source = layer?.getSource()
    const map = mapContext?.mapInstanceRef?.current
    if (!source || !map) return

    source.clear()
    offsetRef.current = 0

    for (const control of controlsRef.current.values()) {
      map.removeOverlay(control.overlay)
    }
    controlsRef.current.clear()
    gateCacheRef.current.clear()

    if (!result) {
      layer?.changed()
      return
    }

    const center = to3857(result.source.point)
    const srcFeat = new Feature({ geometry: new Point(center) })
    srcFeat.set('role', 'source')
    srcFeat.set('label', result.source.name)
    source.addFeature(srcFeat)

    for (let i = 0; i < result.pipes.length; i++) {
      const line = result.pipes[i]!
      if (line.length < 2) continue
      const f = new Feature({ geometry: new LineString(line.map(to3857)) })
      f.setId(`supply-pipe-${i}`)
      f.set('role', 'pipe')
      source.addFeature(f)
    }

    for (const gate of result.gates) {
      gateCacheRef.current.set(gate.id, gate)

      const root = document.createElement('div')
      root.setAttribute('role', 'radiogroup')
      root.setAttribute('aria-label', `${gate.name} 개폐`)
      root.className = 'flex overflow-hidden rounded shadow-md'
      root.style.pointerEvents = 'auto'

      const openBtn = document.createElement('button')
      openBtn.type = 'button'
      openBtn.setAttribute('role', 'radio')
      openBtn.textContent = '열림'

      const lockBtn = document.createElement('button')
      lockBtn.type = 'button'
      lockBtn.setAttribute('role', 'radio')
      lockBtn.textContent = '잠금'

      openBtn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const current = gateCacheRef.current.get(gate.id)
        if (!current) return
        onSelectRef.current(current)
        if (lockedRef.current.has(gate.id)) onUnlockRef.current(gate.id)
      })
      lockBtn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const current = gateCacheRef.current.get(gate.id)
        if (!current) return
        onSelectRef.current(current)
        onLockRef.current(gate.id)
      })

      root.append(openBtn, lockBtn)
      const overlay = new Overlay({
        element: root,
        positioning: 'bottom-center',
        offset: [0, -14],
        stopEvent: true,
      })
      overlay.setPosition(to3857(gate.point))
      map.addOverlay(overlay)
      const control: GateControl = { overlay, root, openBtn, lockBtn, gateId: gate.id }
      paintRadio(control, lockedRef.current.has(gate.id))
      controlsRef.current.set(gate.id, control)
    }

    map.getView().animate({
      center,
      zoom: VIEW_ZOOM,
      duration: 450,
    })
    layer?.changed()
  }, [result, mapContext?.mapInstanceRef])

  /** 잠금 상태·단수 미리보기·선택 마커 */
  useEffect(() => {
    const source = layerRef.current?.getSource()
    if (!source) return

    for (const [id, control] of controlsRef.current.entries()) {
      paintRadio(control, lockedGateIds.includes(id))
    }

    // 단수 미리보기·게이트 마커만 교체 (송수 관로·시설 유지)
    source
      .getFeatures()
      .filter((f) => {
        const role = String(f.get('role') ?? '')
        return role === 'zone' || role === 'outagePipe' || role === 'gate'
      })
      .forEach((f) => source.removeFeature(f))

    if (outagePreview) {
      if (outagePreview.ring.length >= 3) {
        const ring = outagePreview.ring.map(to3857)
        const first = ring[0]
        const last = ring[ring.length - 1]
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first)
        const zone = new Feature({ geometry: new Polygon([ring]) })
        zone.set('role', 'zone')
        source.addFeature(zone)
      }
      outagePreview.pipes.forEach((line, index) => {
        if (line.length < 2) return
        const pipe = new Feature({ geometry: new LineString(line.map(to3857)) })
        pipe.setId(`outage-pipe-${index}`)
        pipe.set('role', 'outagePipe')
        source.addFeature(pipe)
      })
    }

    const markerIds = new Set<string>([
      ...lockedGateIds,
      ...(selectedGateId ? [selectedGateId] : []),
    ])
    for (const id of markerIds) {
      const gate = gateCacheRef.current.get(id)
      if (!gate) continue
      const feature = new Feature({ geometry: new Point(to3857(gate.point)) })
      feature.setId(`marker-${gate.id}`)
      feature.set('role', 'gate')
      feature.set('label', gate.name)
      source.addFeature(feature)
    }

    layerRef.current?.changed()
  }, [lockedGateIds, selectedGateId, outagePreview])

  useEffect(() => {
    offsetRef.current = 0
    layerRef.current?.changed()
  }, [replayToken])
}
