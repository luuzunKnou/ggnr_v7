'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import type Feature from 'ol/Feature'
import type { EventsKey } from 'ol/events'
import type { OdorSensorListItem } from '@/service/odorSensorService'
import { useMapContext } from '@/app/(pages)/map/_mapComponents/MapContext'
import {
  buildDashboardGradeMock,
  type OdorGrade,
  type OdorGradePointMock,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { ODOR_LIVE_GRADE_HEX } from '@/app/(pages)/(index)/odorPhV2/odorLiveStatusColors'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight'
import type { OdorControlMapPointInfo } from './odorControlMapPointTypes'

type Props = {
  sensors: OdorSensorListItem[]
  showPoints: boolean
  alertOnly: boolean
  focusKey: string | null
  onPointSelect?: (point: OdorControlMapPointInfo | null) => void
}

type SyncFn = (pts: OdorGradePointMock[], focus: string | null, fit: boolean) => void

function pointSensorKey(p: OdorGradePointMock): string {
  return p.id.startsWith('pt-') ? p.id.slice(3) : p.id
}

function featureToInfo(f: Feature): OdorControlMapPointInfo | null {
  const sensorKey = String(f.get('sensorKey') ?? '').trim()
  if (!sensorKey) return null
  const gradeNum = Number(f.get('odorGrade') ?? 2)
  const grade = ([1, 2, 3, 4, 5].includes(gradeNum) ? gradeNum : 2) as OdorGrade
  const lon = Number(f.get('lon'))
  const lat = Number(f.get('lat'))
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  return {
    sensorKey,
    label: String(f.get('label') ?? '').trim() || sensorKey,
    grade,
    emdNm: String(f.get('emdNm') ?? '').trim(),
    agency: String(f.get('agency') ?? '').trim(),
    lon,
    lat,
  }
}

/** 관제 지도 — 본지도에 측정지점 + 4·5등급 레이더 펄스 */
export function OdorControlMapPointsLayer({
  sensors,
  showPoints,
  alertOnly,
  focusKey,
  onPointSelect,
}: Props) {
  const mapContext = useMapContext()
  const mapRef = mapContext?.mapInstanceRef
  const onPointSelectRef = useRef(onPointSelect)
  onPointSelectRef.current = onPointSelect

  const { points } = useMemo(() => buildDashboardGradeMock(sensors), [sensors])
  const visiblePoints = useMemo(() => {
    if (!showPoints) return [] as OdorGradePointMock[]
    if (alertOnly) return points.filter((p) => p.grade >= 3)
    return points
  }, [points, showPoints, alertOnly])

  const syncRef = useRef<SyncFn | null>(null)
  const didFitRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let pointLayer: import('ol/layer/Vector').default | null = null
    let pulseLayer: import('ol/layer/Vector').default | null = null
    let stopPulse: (() => void) | null = null
    let rafWait = 0
    let clickKey: EventsKey | undefined
    let moveKey: EventsKey | undefined
    let unByKeyFn: ((key: EventsKey) => void) | null = null

    const teardown = () => {
      stopPulse?.()
      if (unByKeyFn) {
        if (clickKey) unByKeyFn(clickKey)
        if (moveKey) unByKeyFn(moveKey)
      }
      const map = mapRef?.current
      if (map) {
        const target = map.getTargetElement()
        if (target) target.style.cursor = ''
        if (pointLayer) map.removeLayer(pointLayer)
        if (pulseLayer) map.removeLayer(pulseLayer)
      }
      pointLayer = null
      pulseLayer = null
      stopPulse = null
      syncRef.current = null
      clickKey = undefined
      moveKey = undefined
    }

    const init = async () => {
      const map = mapRef?.current
      if (!map) {
        rafWait = requestAnimationFrame(() => {
          if (!cancelled) void init()
        })
        return
      }

      const [
        { default: VectorLayer },
        { default: VectorSource },
        { Style, Fill, Stroke, Circle: CircleStyle, Text },
        { default: FeatureCtor },
        { default: Point },
        { fromLonLat },
        { buffer: bufferExtent, isEmpty: isEmptyExtent },
        { unByKey },
      ] = await Promise.all([
        import('ol/layer/Vector'),
        import('ol/source/Vector'),
        import('ol/style'),
        import('ol/Feature'),
        import('ol/geom/Point'),
        import('ol/proj'),
        import('ol/extent'),
        import('ol/Observable'),
      ])
      if (cancelled || !mapRef?.current) return
      unByKeyFn = unByKey

      const pointSource = new VectorSource()
      const pulseSource = new VectorSource()

      let pulsePhase = 0
      let pulseRaf = 0
      stopPulse = () => {
        if (pulseRaf) {
          cancelAnimationFrame(pulseRaf)
          pulseRaf = 0
        }
      }
      const startPulse = () => {
        if (pulseRaf) return
        const loop = () => {
          pulsePhase += DATA_QUERY_SELECTION_PULSE_STEP
          pulseSource.changed()
          pulseRaf = requestAnimationFrame(loop)
        }
        pulseRaf = requestAnimationFrame(loop)
      }
      const pulseStyle = createDataQuerySelectionRowHighlightStyle(() => pulsePhase)

      pointLayer = new VectorLayer({
        source: pointSource,
        zIndex: 60,
        style: (feature) => {
          const grade = Number(feature.get('odorGrade') ?? 2) as 1 | 2 | 3 | 4 | 5
          const label = String(feature.get('label') ?? '').trim()
          const fill = ODOR_LIVE_GRADE_HEX[grade] ?? '#22c55e'
          return new Style({
            image: new CircleStyle({
              radius: 7,
              fill: new Fill({ color: fill }),
              stroke: new Stroke({ color: '#fff', width: 1.5 }),
            }),
            text: label
              ? new Text({
                  text: label,
                  font: '12px sans-serif',
                  offsetY: -14,
                  fill: new Fill({ color: '#fff' }),
                  stroke: new Stroke({ color: 'rgba(0,0,0,0.75)', width: 3 }),
                })
              : undefined,
          })
        },
      })
      pointLayer.set('name', 'odorControlMapPoints')

      pulseLayer = new VectorLayer({
        source: pulseSource,
        zIndex: 59,
        style: pulseStyle,
      })
      pulseLayer.set('name', 'odorControlMapPulse')

      map.addLayer(pulseLayer)
      map.addLayer(pointLayer)

      const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
        const hit = map.forEachFeatureAtPixel(
          evt.pixel,
          (feat, layer) => (layer === pointLayer ? feat : undefined),
          { hitTolerance: 8 }
        )
        if (!hit) {
          onPointSelectRef.current?.(null)
          return
        }
        const info = featureToInfo(hit as Feature)
        if (info) {
          evt.stopPropagation()
          onPointSelectRef.current?.(info)
        }
      }
      clickKey = map.on('singleclick', onClick as never)

      const onPointerMove = (evt: MapBrowserEvent<PointerEvent>) => {
        if (evt.dragging) return
        const hit = map.forEachFeatureAtPixel(
          evt.pixel,
          (_feat, layer) => layer === pointLayer,
          { hitTolerance: 8 }
        )
        const target = map.getTargetElement()
        if (target) target.style.cursor = hit ? 'pointer' : ''
      }
      moveKey = map.on('pointermove', onPointerMove as never)

      const sync: SyncFn = (pts, focus, fit) => {
        const olMap = mapRef?.current
        if (!olMap) return
        pointSource.clear()
        pulseSource.clear()
        stopPulse?.()
        for (const p of pts) {
          const key = pointSensorKey(p)
          const geom = new Point(fromLonLat([p.lon, p.lat]))
          pointSource.addFeature(
            new FeatureCtor({
              geometry: geom,
              odorGrade: p.grade,
              label: p.label,
              sensorKey: key,
              emdNm: p.emdNm,
              agency: p.agency,
              lon: p.lon,
              lat: p.lat,
            })
          )
          if (p.grade >= 4) {
            pulseSource.addFeature(
              new FeatureCtor({
                geometry: geom.clone(),
                isRadarPoint: true,
              })
            )
          }
        }
        if (focus) {
          const found = pointSource.getFeatures().find((f) => String(f.get('sensorKey')) === focus)
          const geom = found?.getGeometry()
          if (geom && geom.getType() === 'Point') {
            const coords = (geom as InstanceType<typeof Point>).getCoordinates()
            pulseSource.addFeature(
              new FeatureCtor({
                geometry: geom.clone(),
                isRadarPoint: true,
              })
            )
            /** 포커스 시 전체 fit과 겹치면 줌아웃→줌인이 되므로 fit 생략, 즉시 이동 */
            const view = olMap.getView()
            view.setCenter(coords)
            view.setZoom(Math.max(view.getZoom() ?? 15, 15))
          }
        } else if (fit && pts.length > 0) {
          const extent = pointSource.getExtent()
          if (!isEmptyExtent(extent) && extent.every((v) => Number.isFinite(v))) {
            olMap.getView().fit(bufferExtent(extent, 200), {
              padding: [48, 48, 48, 48],
              maxZoom: 15,
              duration: 0,
            })
          }
        }
        if (pulseSource.getFeatures().length > 0) startPulse()
      }

      syncRef.current = sync
      sync(visiblePoints, focusKey, !didFitRef.current)
      if (visiblePoints.length > 0) didFitRef.current = true
    }

    void init()

    return () => {
      cancelled = true
      if (rafWait) cancelAnimationFrame(rafWait)
      teardown()
      didFitRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once
  }, [mapRef])

  useEffect(() => {
    syncRef.current?.(visiblePoints, focusKey, false)
  }, [visiblePoints, focusKey])

  return null
}
