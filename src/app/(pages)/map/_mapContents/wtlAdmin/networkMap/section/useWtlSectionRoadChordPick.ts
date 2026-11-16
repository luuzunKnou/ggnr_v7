'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type Map from 'ol/Map'
import type { MapBrowserEvent } from 'ol'
import type { Coordinate } from 'ol/coordinate'
import type { EventsKey } from 'ol/events'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import LineString from 'ol/geom/LineString'
import MultiPoint from 'ol/geom/MultiPoint'
import type Geometry from 'ol/geom/Geometry'
import Polygon from 'ol/geom/Polygon'
import MultiPolygon from 'ol/geom/MultiPolygon'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { unByKey } from 'ol/Observable'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import { call } from '@/lib/api'
import {
  collectSegments,
  shortestChordAt,
  snapInside,
  toAreaGeometry,
  type Chord,
} from '../../../privateLandAnalysis/privateLandAnalysisGeom'

const LAYER_TABLE = 'tl_sprd_rw'
const CLICK_HOVER_TOL_PX = 28
const ACCENT = 'rgba(37, 99, 235, 1)'

const LAYER_BASE_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(217, 119, 6, 0.95)', width: 1.5 }),
  fill: new Fill({ color: 'rgba(253, 224, 71, 0.45)' }),
  zIndex: 1,
})

const CHORD_PREVIEW_STYLE = [
  new Style({
    stroke: new Stroke({ color: ACCENT, width: 3, lineDash: [8, 6] }),
    zIndex: 5,
  }),
  new Style({
    zIndex: 5,
    geometry: (f) => {
      const g = f.getGeometry()
      return g instanceof LineString
        ? new MultiPoint([g.getFirstCoordinate(), g.getLastCoordinate()])
        : undefined
    },
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: ACCENT }),
      stroke: new Stroke({ color: '#fff', width: 1.5 }),
    }),
  }),
]

function chordGeometry(chord: Chord): LineString {
  return new LineString(chord.path ?? [chord[0], chord[1]])
}

function readGeometry3857(raw: unknown): Geometry | null {
  if (!raw || typeof raw !== 'object') return null
  try {
    return new GeoJSON().readGeometry(raw, {
      dataProjection: 'EPSG:3857',
      featureProjection: 'EPSG:3857',
    }) as Geometry
  } catch {
    return null
  }
}

type LayerView = {
  geom: Polygon | MultiPolygon
  segs: ReturnType<typeof collectSegments>
}

type Props = {
  mapRef: RefObject<Map | null> | null | undefined
  mapReady: boolean
  active: boolean
  onComplete: (coords3857: [number, number][]) => void
  onFlash?: (message: string) => void
  /** 찍은 뒤 이어지는 singleclick 레이어 선택·identify 차단 */
  suppressMapIdentifyUntilRef?: RefObject<number> | null
}

/**
 * 실폭도로 한 번 찍기 — 사유지분석 «선 찍기»와 동일하게 가로지르는 절단선 1개.
 * 여러 선으로 범위를 닫지 않는다.
 */
export function useWtlSectionRoadChordPick({
  mapRef,
  mapReady,
  active,
  onComplete,
  onFlash,
  suppressMapIdentifyUntilRef,
}: Props) {
  const onCompleteRef = useRef(onComplete)
  const onFlashRef = useRef(onFlash)
  const suppressRef = useRef(suppressMapIdentifyUntilRef)
  onCompleteRef.current = onComplete
  onFlashRef.current = onFlash
  suppressRef.current = suppressMapIdentifyUntilRef

  const blockFollowingClick = () => {
    const ref = suppressRef.current
    if (ref) ref.current = Date.now() + 500
  }

  useEffect(() => {
    const map = mapRef?.current
    if (!map || !mapReady || !active) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 920,
      style: (f) => {
        const kind = f.get('kind')
        if (kind === 'layerBase') return LAYER_BASE_STYLE
        if (kind === 'chordPreview') return CHORD_PREVIEW_STYLE
        return undefined
      },
    })
    layer.set('wtlNetworkSectionRoadChord', true)
    layer.set('mapSplitNoMirror', true)
    map.addLayer(layer)

    const layerViewRef: { current: LayerView | null } = { current: null }
    const viewTooLargeRef = { current: false }
    let loadSeq = 0
    let loadTimer = 0
    let raf = 0
    let lastCoord: Coordinate | null = null
    let hover: { coord: Coordinate; chord: Chord } | null = null
    let down: { at: number; x: number; y: number } | null = null
    let ownCursor: string | null = null
    const target = map.getTargetElement()

    const setCursor = (value: string) => {
      if (!target) return
      target.style.cursor = value
      ownCursor = value
    }
    const clearCursor = () => {
      if (target && ownCursor !== null && target.style.cursor === ownCursor) {
        target.style.cursor = ''
      }
      ownCursor = null
    }

    const setFeatures = (kind: string, geom: Geometry | null) => {
      for (const f of [...source.getFeatures()]) {
        if (f.get('kind') === kind) source.removeFeature(f)
      }
      if (!geom) return
      const feat = new Feature({ geometry: geom })
      feat.set('kind', kind)
      source.addFeature(feat)
    }

    const chordAt = (coord: Coordinate): Chord | null => {
      const view = layerViewRef.current
      if (!view?.geom || view.segs.length === 0) return null
      const res = map.getView().getResolution() ?? 1
      const p = snapInside(view.geom, coord, 2 * res)
      return p ? shortestChordAt(view.geom, view.segs, p) : null
    }

    const loadView = async () => {
      const mine = ++loadSeq
      const view = map.getView()
      const bbox = view.calculateExtent(map.getSize())
      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'getPrivateLandAnalysisLayerView',
          params: {
            layer: LAYER_TABLE,
            bbox,
            tolerance: view.getResolution() ?? 1,
          },
        })
        if (mine !== loadSeq) return
        const data = res?.data ?? res
        const geom = toAreaGeometry(readGeometry3857(data?.geometry3857))
        const usable = !data?.tooLarge && !data?.error && geom
        viewTooLargeRef.current = data?.tooLarge === true
        layerViewRef.current = usable
          ? { geom: geom!, segs: collectSegments(geom!) }
          : null
        setFeatures('layerBase', usable ? geom : null)
      } catch {
        if (mine !== loadSeq) return
        layerViewRef.current = null
        setFeatures('layerBase', null)
      }
    }

    void loadView()
    const onMoveEnd = () => {
      window.clearTimeout(loadTimer)
      loadTimer = window.setTimeout(() => void loadView(), 200)
    }
    map.on('moveend', onMoveEnd)

    const hoverNear = (pixel: number[]): typeof hover => {
      if (!hover) return null
      const hp = map.getPixelFromCoordinate(hover.coord)
      if (!hp) return null
      return Math.hypot(hp[0] - pixel[0], hp[1] - pixel[1]) <= CLICK_HOVER_TOL_PX
        ? hover
        : null
    }

    const commitChord = (chord: Chord) => {
      const a = chord[0]
      const b = chord[1]
      if (!a || !b) return
      onCompleteRef.current([
        [a[0], a[1]],
        [b[0], b[1]],
      ])
    }

    const onMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (evt.dragging) return
      lastCoord = evt.coordinate
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        if (!lastCoord) return
        if (!layerViewRef.current) {
          clearCursor()
          setFeatures('chordPreview', null)
          hover = null
          return
        }
        const chord = chordAt(lastCoord)
        hover = chord ? { coord: lastCoord, chord } : null
        setCursor(chord ? 'crosshair' : 'not-allowed')
        setFeatures('chordPreview', chord ? chordGeometry(chord) : null)
      })
    }

    const onPointerDown = (evt: MapBrowserEvent<PointerEvent>) => {
      if (evt.originalEvent.button !== 0) return
      down = {
        at: Date.now(),
        x: evt.pixel[0],
        y: evt.pixel[1],
      }
    }

    const onPointerUp = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!down || evt.originalEvent.button !== 0) return
      const dx = evt.pixel[0] - down.x
      const dy = evt.pixel[1] - down.y
      const dt = Date.now() - down.at
      down = null
      if (dt > 500 || Math.hypot(dx, dy) > 6) return

      // 이어지는 singleclick 레이어 선택·identify 차단
      blockFollowingClick()
      evt.stopPropagation()
      evt.preventDefault()

      if (!layerViewRef.current) {
        onFlashRef.current?.(
          viewTooLargeRef.current
            ? '지도를 더 확대한 뒤 찍으세요.'
            : '실폭도로를 불러오는 중입니다.'
        )
        return
      }

      let chord = chordAt(evt.coordinate)
      if (!chord) {
        const near = hoverNear(evt.pixel)
        chord = near?.chord ?? null
      }
      if (!chord) {
        onFlashRef.current?.('실폭도로 위를 찍으세요.')
        return
      }
      commitChord(chord)
    }

    const moveKey = map.on('pointermove', onMove as never) as EventsKey
    // OL Map 타입에 pointerdown/up 미포함 — 브라우저 포인터 이벤트로 사용
    const downKey = map.on('pointerdown' as 'pointermove', onPointerDown as never) as EventsKey
    const upKey = map.on('pointerup' as 'pointermove', onPointerUp as never) as EventsKey

    return () => {
      loadSeq += 1
      window.clearTimeout(loadTimer)
      if (raf) cancelAnimationFrame(raf)
      map.un('moveend', onMoveEnd)
      unByKey(moveKey)
      unByKey(downKey)
      unByKey(upKey)
      clearCursor()
      map.removeLayer(layer)
      source.clear()
    }
  }, [mapRef, mapReady, active])
}
