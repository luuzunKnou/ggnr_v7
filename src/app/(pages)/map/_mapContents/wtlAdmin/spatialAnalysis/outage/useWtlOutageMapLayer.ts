'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import Feature from 'ol/Feature'
import { LineString, Point, Polygon } from 'ol/geom'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import Overlay from 'ol/Overlay'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { transform } from 'ol/proj'
import { call } from '@/lib/api'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import type { WtlOutageGate, WtlOutageResult } from './wtlOutageSample'

const WORKSPACE = 'ggnr'
const GATE = '#0f766e'
const OUTAGE_PIPE = '#ea580c'
const OUTAGE_ZONE = 'rgba(220, 38, 38, 0.22)'
/** 화면 범위 제수변 버튼 (서비스 상한과 맞춤) */
const VISIBLE_GATE_LIMIT = 800

function to3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

function clearOutageGraphics(source: VectorSource) {
  source
    .getFeatures()
    .filter((feature) => {
      const role = String(feature.get('role') ?? '')
      return role === 'zone' || role === 'pipe' || role === 'gate'
    })
    .forEach((feature) => source.removeFeature(feature))
}

function paintOutageResult(source: VectorSource, result: WtlOutageResult, options?: { hideZone?: boolean }) {
  if (!options?.hideZone && result.ring.length >= 3) {
    const ring = result.ring.map(to3857)
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first)
    const zone = new Feature({ geometry: new Polygon([ring]) })
    zone.setId(`zone-${result.gateId}`)
    zone.set('role', 'zone')
    source.addFeature(zone)
  }
  result.pipes.forEach((line, index) => {
    if (line.length < 2) return
    const pipe = new Feature({ geometry: new LineString(line.map(to3857)) })
    pipe.setId(`pipe-${result.gateId}-${index}`)
    pipe.set('role', 'pipe')
    source.addFeature(pipe)
  })
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
  pickMode: boolean
  lockedGateIds: string[]
  selectedGateId: string | null
  result: WtlOutageResult | null
  /** 도형편집 중이면 단수 면은 편집 레이어만 표시 */
  hideZone?: boolean
  onVisibleGates: (gates: WtlOutageGate[]) => void
  onSelectGate: (gate: WtlOutageGate) => void
  onLockGate: (gateId: string) => void
  onUnlockGate: (gateId: string) => void
}

export function useWtlOutageMapLayer({
  active,
  pickMode,
  lockedGateIds,
  selectedGateId,
  result,
  hideZone = false,
  onVisibleGates,
  onSelectGate,
  onLockGate,
  onUnlockGate,
}: Props) {
  const mapContext = useMapContext()
  const wmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  const outageLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const controlsRef = useRef<Map<string, GateControl>>(new Map())
  const visibleGatesRef = useRef<Map<string, WtlOutageGate>>(new Map())
  const gateCacheRef = useRef<Map<string, WtlOutageGate>>(new Map())
  const pickRef = useRef(pickMode)
  const lockedRef = useRef<Set<string>>(new Set(lockedGateIds))
  const selectedRef = useRef(selectedGateId)
  const onVisibleRef = useRef(onVisibleGates)
  const onSelectRef = useRef(onSelectGate)
  const onLockRef = useRef(onLockGate)
  const onUnlockRef = useRef(onUnlockGate)
  const fetchSeqRef = useRef(0)
  pickRef.current = pickMode
  lockedRef.current = new Set(lockedGateIds)
  selectedRef.current = selectedGateId
  onVisibleRef.current = onVisibleGates
  onSelectRef.current = onSelectGate
  onLockRef.current = onLockGate
  onUnlockRef.current = onUnlockGate

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`
    const wms = new ImageLayer({
      source: new ImageWMS({
        url: wmsUrl,
        params: {
          LAYERS: 'wtl_pipe_lm,wtl_valv_ps',
          STYLES: ',',
          CQL_FILTER: `INCLUDE;ftr_cde='SA200'`,
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
      }),
      zIndex: 880,
    })
    wms.set('wtlOutageWms', true)
    map.addLayer(wms)
    wmsRef.current = wms

    const outageSource = new VectorSource()
    const outageLayer = new VectorLayer({
      source: outageSource,
      zIndex: 920,
      style: (feature) => {
        const role = String(feature.get('role') ?? '')
        const id = String(feature.getId() ?? '')
        const gateId = String(feature.get('gateId') ?? id)
        const selected = gateId === selectedRef.current
        const locked = lockedRef.current.has(gateId)
        if (role === 'zone') {
          return new Style({
            fill: new Fill({ color: OUTAGE_ZONE }),
            stroke: new Stroke({ color: '#dc2626', width: 2 }),
          })
        }
        if (role === 'pipe') {
          return new Style({
            stroke: new Stroke({ color: OUTAGE_PIPE, width: 7, lineCap: 'round', lineJoin: 'round' }),
          })
        }
        return new Style({
          image: new Circle({
            radius: locked || selected ? 9 : 7,
            fill: new Fill({ color: locked ? '#b91c1c' : selected ? '#ea580c' : GATE }),
            stroke: new Stroke({ color: '#ffffff', width: 2 }),
          }),
          text: new Text({
            text: String(feature.get('label') ?? ''),
            offsetY: 16,
            font: '11px sans-serif',
            fill: new Fill({ color: locked ? '#7f1d1d' : '#134e4a' }),
            stroke: new Stroke({ color: '#ffffff', width: 3 }),
          }),
        })
      },
    })
    outageLayer.set('wtlOutage', true)
    map.addLayer(outageLayer)
    outageLayerRef.current = outageLayer

    const resolveGate = (gateId: string): WtlOutageGate | null =>
      visibleGatesRef.current.get(gateId) ?? gateCacheRef.current.get(gateId) ?? null

    const rememberGate = (gate: WtlOutageGate) => {
      gateCacheRef.current.set(gate.id, gate)
    }

    const ensureControl = (gate: WtlOutageGate) => {
      rememberGate(gate)
      let control = controlsRef.current.get(gate.id)
      if (control) {
        control.overlay.setPosition(to3857(gate.point))
        return control
      }
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
        const current = resolveGate(gate.id)
        if (!current) return
        onSelectRef.current(current)
        if (lockedRef.current.has(gate.id)) onUnlockRef.current(gate.id)
      })
      lockBtn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const current = resolveGate(gate.id)
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
      control = { overlay, root, openBtn, lockBtn, gateId: gate.id }
      controlsRef.current.set(gate.id, control)
      return control
    }

    const syncVisibleControls = (gates: WtlOutageGate[]) => {
      const nextMap = new Map(gates.map((g) => [g.id, g]))
      visibleGatesRef.current = nextMap
      for (const gate of gates) rememberGate(gate)
      onVisibleRef.current(gates)

      const keep = new Set(gates.map((g) => g.id))
      for (const id of lockedRef.current) keep.add(id)

      for (const gate of gates) {
        const control = ensureControl(gate)
        paintRadio(control, lockedRef.current.has(gate.id))
      }
      for (const id of lockedRef.current) {
        const gate = resolveGate(id)
        if (!gate) continue
        const control = ensureControl(gate)
        paintRadio(control, true)
      }

      for (const [id, control] of [...controlsRef.current.entries()]) {
        if (keep.has(id)) continue
        map.removeOverlay(control.overlay)
        controlsRef.current.delete(id)
      }
    }

    let moveTimer: ReturnType<typeof setTimeout> | null = null
    const fetchVisibleGates = async () => {
      const size = map.getSize()
      const extent = size ? map.getView().calculateExtent(size) : null
      if (!extent || extent.length < 4) {
        syncVisibleControls([])
        return
      }
      // 가장자리 제수변도 버튼이 나오도록 약간 확장
      const pad = Math.max((extent[2] - extent[0]) * 0.02, 20)
      const bbox = [extent[0] - pad, extent[1] - pad, extent[2] + pad, extent[3] + pad]
      const seq = ++fetchSeqRef.current
      try {
        const response = await call('', 'POST', {
          service: 'wtlOutageService',
          action: 'listWtlOutageGates',
          params: {
            bbox,
            limit: VISIBLE_GATE_LIMIT,
          },
        })
        if (seq !== fetchSeqRef.current) return
        const rows = ((response?.data ?? response)?.rows ?? []) as WtlOutageGate[]
        syncVisibleControls(rows.filter((g) => g?.id && Array.isArray(g.point) && g.point.length >= 2))
      } catch {
        if (seq !== fetchSeqRef.current) return
        syncVisibleControls([])
      }
    }

    const onMoveEnd = () => {
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        void fetchVisibleGates()
      }, 200)
    }

    const onClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (!pickRef.current) return
      try {
        const res = await call('', 'POST', {
          service: 'wtlOutageService',
          action: 'getWtlOutageGateAtPoint',
          params: {
            x: evt.coordinate[0],
            y: evt.coordinate[1],
            tolerance: 20,
          },
        })
        const row = (res?.data ?? res)?.row as WtlOutageGate | null | undefined
        if (row) {
          rememberGate(row)
          onSelectRef.current(row)
          evt.stopPropagation()
        }
      } catch {
        /* ignore */
      }
    }

    const moveKey = map.on('moveend', onMoveEnd)
    const clickKey = map.on('singleclick', onClick as never)
    void fetchVisibleGates()

    return () => {
      if (moveTimer) clearTimeout(moveTimer)
      unByKey(moveKey)
      unByKey(clickKey)
      for (const control of controlsRef.current.values()) {
        map.removeOverlay(control.overlay)
      }
      controlsRef.current.clear()
      visibleGatesRef.current.clear()
      map.removeLayer(outageLayer)
      map.removeLayer(wms)
      outageLayerRef.current = null
      wmsRef.current = null
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  // 잠금 상태 버튼 표시 갱신 + 단수 관로/면 표시
  useEffect(() => {
    const source = outageLayerRef.current?.getSource()
    const map = mapContext?.mapInstanceRef?.current
    if (!source || !map) return

    clearOutageGraphics(source)

    for (const [id, control] of controlsRef.current.entries()) {
      paintRadio(control, lockedGateIds.includes(id))
    }

    const markerIds = new Set<string>([
      ...lockedGateIds,
      ...(selectedGateId ? [selectedGateId] : []),
    ])
    for (const id of markerIds) {
      const gate = visibleGatesRef.current.get(id) ?? gateCacheRef.current.get(id)
      if (!gate) continue
      const feature = new Feature({ geometry: new Point(to3857(gate.point)) })
      feature.setId(gate.id)
      feature.set('role', 'gate')
      feature.set('gateId', gate.id)
      feature.set('label', gate.name)
      source.addFeature(feature)
    }

    if (result) paintOutageResult(source, result, { hideZone })
    outageLayerRef.current?.changed()
  }, [result, lockedGateIds, selectedGateId, hideZone, mapContext?.mapInstanceRef])
}
