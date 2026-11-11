'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import Feature from 'ol/Feature'
import { LineString, Point } from 'ol/geom'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { transform } from 'ol/proj'
import { call } from '@/lib/api'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import type { WtlLeakGate, WtlLeakResult, WtlLeakSnap } from './wtlLeakSample'

const WORKSPACE = 'ggnr'
const LEAK = '#dc2626'
const GATE = '#b91c1c'
const PIPE = '#ea580c'

function to3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

type Props = {
  active: boolean
  pickMode: boolean
  result: WtlLeakResult | null
  selectedGateId: string | null
  onSnap: (snap: WtlLeakSnap, result: WtlLeakResult) => void
  onSnapError: (msg: string) => void
  onSelectGate: (gate: WtlLeakGate) => void
  onBusy?: (busy: boolean) => void
}

export function useWtlLeakMapLayer({
  active,
  pickMode,
  result,
  selectedGateId,
  onSnap,
  onSnapError,
  onSelectGate,
  onBusy,
}: Props) {
  const mapContext = useMapContext()
  const wmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const pickRef = useRef(pickMode)
  const selectedRef = useRef(selectedGateId)
  const onSnapRef = useRef(onSnap)
  const onErrRef = useRef(onSnapError)
  const onSelectRef = useRef(onSelectGate)
  const onBusyRef = useRef(onBusy)
  const busyRef = useRef(false)
  pickRef.current = pickMode
  selectedRef.current = selectedGateId
  onSnapRef.current = onSnap
  onErrRef.current = onSnapError
  onSelectRef.current = onSelectGate
  onBusyRef.current = onBusy

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
    wms.set('wtlLeakWms', true)
    map.addLayer(wms)
    wmsRef.current = wms

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 920,
      style: (feature) => {
        const role = String(feature.get('role') ?? '')
        if (role === 'pipe') {
          return new Style({
            stroke: new Stroke({ color: PIPE, width: 6, lineCap: 'round' }),
          })
        }
        if (role === 'leak') {
          return new Style({
            image: new Circle({
              radius: 9,
              fill: new Fill({ color: LEAK }),
              stroke: new Stroke({ color: '#ffffff', width: 2 }),
            }),
            text: new Text({
              text: '누수',
              offsetY: -14,
              font: '11px sans-serif',
              fill: new Fill({ color: '#7f1d1d' }),
              stroke: new Stroke({ color: '#ffffff', width: 3 }),
            }),
          })
        }
        const id = String(feature.get('gateId') ?? '')
        const selected = id === selectedRef.current
        return new Style({
          image: new Circle({
            radius: selected ? 10 : 8,
            fill: new Fill({ color: selected ? '#ea580c' : GATE }),
            stroke: new Stroke({ color: '#ffffff', width: 2 }),
          }),
          text: new Text({
            text: String(feature.get('label') ?? ''),
            offsetY: 16,
            font: '11px sans-serif',
            fill: new Fill({ color: '#7f1d1d' }),
            stroke: new Stroke({ color: '#ffffff', width: 3 }),
          }),
        })
      },
    })
    layer.set('wtlLeak', true)
    map.addLayer(layer)
    layerRef.current = layer

    const onClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (!pickRef.current || busyRef.current) return
      // 제수변 피처 클릭이면 선택만
      const hit = map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
        layerFilter: (l) => l === layer,
      })
      if (hit && String(hit.get('role')) === 'gate') {
        const gateId = String(hit.get('gateId') ?? '')
        const gate = (hit.get('gate') as WtlLeakGate | undefined) ?? null
        if (gate) onSelectRef.current(gate)
        else if (gateId) onSelectRef.current({ id: gateId, name: gateId, diameter: '—', address: '—', point: [0, 0] })
        evt.stopPropagation()
        return
      }

      busyRef.current = true
      onBusyRef.current?.(true)
      try {
        const res = await call('', 'POST', {
          service: 'wtlLeakService',
          action: 'analyzeWtlLeak',
          params: {
            x: evt.coordinate[0],
            y: evt.coordinate[1],
            tolerance: 30,
          },
        })
        const body = (res?.data ?? res) as {
          result?: WtlLeakResult | null
          error?: string
        }
        if (body.error || !body.result) {
          onErrRef.current(body.error || '누수 분석에 실패했습니다.')
          return
        }
        onSnapRef.current(body.result.snap, body.result)
        evt.stopPropagation()
      } catch {
        onErrRef.current('누수 분석 요청에 실패했습니다.')
      } finally {
        busyRef.current = false
        onBusyRef.current?.(false)
      }
    }

    const clickKey = map.on('singleclick', onClick as never)
    const el = map.getTargetElement()
    if (el) el.style.cursor = pickMode ? 'crosshair' : ''

    return () => {
      unByKey(clickKey)
      if (el) el.style.cursor = ''
      map.removeLayer(layer)
      map.removeLayer(wms)
      layerRef.current = null
      wmsRef.current = null
    }
  }, [active, pickMode, mapContext?.mapReady, mapContext?.mapInstanceRef])

  useEffect(() => {
    const source = layerRef.current?.getSource()
    if (!source) return
    source.clear()
    if (!result) return

    const leak = new Feature({
      geometry: new Point([result.snap.x, result.snap.y]),
    })
    leak.set('role', 'leak')
    source.addFeature(leak)

    result.pipes.forEach((line, index) => {
      if (line.length < 2) return
      const f = new Feature({ geometry: new LineString(line.map(to3857)) })
      f.setId(`leak-pipe-${index}`)
      f.set('role', 'pipe')
      source.addFeature(f)
    })

    for (const gate of result.gates) {
      const f = new Feature({ geometry: new Point(to3857(gate.point)) })
      f.setId(gate.id)
      f.set('role', 'gate')
      f.set('gateId', gate.id)
      f.set('label', gate.name)
      f.set('gate', gate)
      source.addFeature(f)
    }
    layerRef.current?.changed()
  }, [result, selectedGateId])
}
