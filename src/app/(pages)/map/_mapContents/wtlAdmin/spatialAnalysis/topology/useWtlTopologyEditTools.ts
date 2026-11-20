'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import { LineString, Point } from 'ol/geom'
import Draw from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, RegularShape, Stroke, Style } from 'ol/style'
import GeoJSON from 'ol/format/GeoJSON'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { lonLatToView, TOPO_DATA_PROJECTION, useMapViewProjection } from './topoMapProjection'

export type WtlTopoEditTool = 'idle' | 'modify' | 'draw_line' | 'draw_point'

type Props = {
  active: boolean
  tool: WtlTopoEditTool
  /** 도형 수정 대상(선 또는 점). 그리기(관로·시설 추가)에는 필요 없다 */
  target: { line?: [number, number][]; point?: [number, number] } | null
  onDraftChange: (geojson: object | null) => void
  /** 그린 관로를 반대 방향으로 저장할 예정이면 true — 지도 화살표도 반대로 그린다 */
  reverseLine?: boolean
  /** 그리는 선 색 (관로 추가 시 고른 종류의 레이어 색). 없으면 기본 편집색 */
  lineColor?: string
}

const EDIT_COLOR = '#2563eb'

/** 그리는 중·그린 관로 방향(시작→끝) 화살표. reverse면 끝→시작 */
function draftStyles(feature: Feature, reverse: boolean, color = EDIT_COLOR): Style[] {
  const styles: Style[] = [
    // 흰 후광을 깔아 배경·주변 관로 위에서도 그린 선이 보이게 한다
    new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,0.9)', width: 6 }) }),
    new Style({
      stroke: new Stroke({ color, width: 3 }),
      image: new Circle({
        radius: 7,
        fill: new Fill({ color: 'rgba(37,99,235,0.15)' }),
        stroke: new Stroke({ color, width: 1.5 }),
      }),
    }),
  ]
  const geom = feature.getGeometry()
  if (!(geom instanceof LineString) || geom.getLength() <= 0) return styles
  for (const t of [0.5, 1]) {
    const at = reverse ? 1 - t : t
    const c = geom.getCoordinateAt(at)
    const a = geom.getCoordinateAt(Math.max(0, at - 0.02))
    const b = geom.getCoordinateAt(Math.min(1, at + 0.02))
    let rot = Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!)
    if (reverse) rot += Math.PI
    styles.push(
      new Style({
        geometry: new Point(c),
        image: new RegularShape({
          points: 3,
          radius: 9,
          rotation: -rot + Math.PI / 2,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
        }),
      })
    )
  }
  return styles
}


export function useWtlTopologyEditTools({
  active,
  tool,
  target,
  onDraftChange,
  reverseLine = false,
  lineColor,
}: Props) {
  const mapContext = useMapContext()
  /** 현재 지도 좌표계 — 편집 도형은 이 좌표계로 그리고, 저장할 때 경위도로 바꾼다 */
  const viewProj = useMapViewProjection(mapContext?.mapInstanceRef, mapContext?.mapReady)
  const viewProjRef = useRef(viewProj)
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const sourceRef = useRef<VectorSource | null>(null)
  const drawRef = useRef<Draw | null>(null)
  const modifyRef = useRef<Modify | null>(null)
  const onDraftRef = useRef(onDraftChange)
  const reverseRef = useRef(reverseLine)
  const colorRef = useRef(lineColor)
  const suppressIdentifyRef = useRef(mapContext?.suppressMapIdentifyUntilRef)
  // 최신 값은 렌더가 끝난 뒤 ref에 반영한다 (지도 스타일·이벤트 콜백에서 읽음)
  useEffect(() => {
    onDraftRef.current = onDraftChange
    viewProjRef.current = viewProj
    reverseRef.current = reverseLine
    colorRef.current = lineColor
    suppressIdentifyRef.current = mapContext?.suppressMapIdentifyUntilRef
  })

  const emitDraft = (source: VectorSource) => {
    const features = source.getFeatures()
    if (features.length === 0) {
      onDraftRef.current(null)
      return
    }
    const format = new GeoJSON()
    const geo = format.writeFeaturesObject(features, {
      featureProjection: viewProjRef.current,
      dataProjection: TOPO_DATA_PROJECTION,
    })
    // single geometry preferred
    if (geo.features?.length === 1) {
      onDraftRef.current((geo.features[0]!.geometry as object) ?? null)
    } else {
      onDraftRef.current(geo as object)
    }
  }

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 950,
      style: (feature) => draftStyles(feature as Feature, reverseRef.current, colorRef.current),
    })
    layer.set('wtlTopoEdit', true)
    map.addLayer(layer)
    layerRef.current = layer
    sourceRef.current = source

    // 편집 중 지도 클릭이 지도 식별(시설 정보창)로 새지 않게 막는다
    const suppress = suppressIdentifyRef.current
    const onViewportClick = () => {
      if (suppress) suppress.current = Date.now() + 800
    }
    const viewport = map.getViewport()
    viewport.addEventListener('click', onViewportClick, true)

    return () => {
      viewport.removeEventListener('click', onViewportClick, true)
      if (drawRef.current) {
        map.removeInteraction(drawRef.current)
        drawRef.current = null
      }
      if (modifyRef.current) {
        map.removeInteraction(modifyRef.current)
        modifyRef.current = null
      }
      map.removeLayer(layer)
      layerRef.current = null
      sourceRef.current = null
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source) return

    if (drawRef.current) {
      map.removeInteraction(drawRef.current)
      drawRef.current = null
    }
    if (modifyRef.current) {
      map.removeInteraction(modifyRef.current)
      modifyRef.current = null
    }
    source.clear()
    onDraftRef.current(null)

    if (!active || tool === 'idle') return

    if (tool === 'modify') {
      // 수정은 대상이 정해진 뒤에 시작한다(오류 선택 또는 지도에서 클릭)
      if (!target) return
      if (target.line && target.line.length >= 2) {
        source.addFeature(new Feature({ geometry: new LineString(target.line.map((c) => lonLatToView(c, viewProj))) }))
      } else if (target.point) {
        source.addFeature(new Feature({ geometry: new Point(lonLatToView(target.point, viewProj)) }))
      } else {
        return
      }
      const modify = new Modify({ source })
      modify.on('modifyend', () => emitDraft(source))
      map.addInteraction(modify)
      modifyRef.current = modify
      emitDraft(source)
      return
    }

    const type = tool === 'draw_line' ? 'LineString' : 'Point'
    // 그리는 도중(스케치)도 같은 색·화살표로 보여 준다
    const draw = new Draw({
      source,
      type,
      style: (feature) => {
        const geom = feature.getGeometry()
        if (geom instanceof LineString) return draftStyles(feature as Feature, reverseRef.current, colorRef.current)
        return new Style({
          image: new Circle({
            radius: 5,
            fill: new Fill({ color: colorRef.current ?? EDIT_COLOR }),
            stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
          }),
        })
      },
    })
    // drawend 시점에는 아직 source에 안 들어감 → addfeature 후 draft 반영
    draw.on('drawend', (evt) => {
      const drawn = evt.feature
      source.once('addfeature', () => {
        for (const f of source.getFeatures()) {
          if (f !== drawn) source.removeFeature(f)
        }
        emitDraft(source)
      })
    })
    map.addInteraction(draw)
    drawRef.current = draw
    // 좌표계가 바뀌면(배경 전환) 편집 도형을 새 좌표계로 다시 만든다 — 그리던 도형은 초기화된다
  }, [active, tool, target, viewProj, mapContext?.mapInstanceRef])

  // 방향 반전·관로 종류(색)가 바뀌면 다시 그린다
  useEffect(() => {
    layerRef.current?.changed()
    drawRef.current?.getOverlay().changed()
  }, [reverseLine, lineColor])
}

