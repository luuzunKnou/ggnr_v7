'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import type { EventsKey } from 'ol/events'
import type { OdorComplaintLinkMock } from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { useMapContext } from '@/app/(pages)/map/_mapComponents/MapContext'

type Props = {
  items: OdorComplaintLinkMock[]
  focusId: string | null
  onSelect?: (id: string | null) => void
}

const LAYER_ID = 'odor-complaint-points'

/**
 * 민원 관리 — 저장된 민원 위치를 본지도에 표시.
 */
export function OdorComplaintPointsLayer({ items, focusId, onSelect }: Props) {
  const mapContext = useMapContext()
  const mapRef = mapContext?.mapInstanceRef
  const itemsRef = useRef(items)
  const focusRef = useRef(focusId)
  const onSelectRef = useRef(onSelect)
  itemsRef.current = items
  focusRef.current = focusId
  onSelectRef.current = onSelect

  useEffect(() => {
    let cancelled = false
    let layer: import('ol/layer/Vector').default | null = null
    let clickKey: EventsKey | undefined
    let moveKey: EventsKey | undefined
    let unByKeyFn: ((key: EventsKey) => void) | null = null
    let rafWait = 0

    const teardown = () => {
      if (unByKeyFn) {
        if (clickKey) unByKeyFn(clickKey)
        if (moveKey) unByKeyFn(moveKey)
      }
      const map = mapRef?.current
      if (map && layer) map.removeLayer(layer)
      const target = map?.getTargetElement()
      if (target) target.style.cursor = ''
      layer = null
    }

    const boot = async () => {
      const map = mapRef?.current
      if (!map) {
        rafWait = requestAnimationFrame(() => {
          if (!cancelled) void boot()
        })
        return
      }
      const [{ default: Feature }, { default: Point }, { default: VectorLayer }, { default: VectorSource }, { fromLonLat }, { Style, Circle: CircleStyle, Fill, Stroke }, { unByKey }] =
        await Promise.all([
          import('ol/Feature'),
          import('ol/geom/Point'),
          import('ol/layer/Vector'),
          import('ol/source/Vector'),
          import('ol/proj'),
          import('ol/style'),
          import('ol/Observable'),
        ])
      if (cancelled) return
      unByKeyFn = unByKey

      const source = new VectorSource()
      layer = new VectorLayer({
        source,
        properties: { id: LAYER_ID },
        zIndex: 620,
        style: (f) => {
          const focused = String(f.get('complaintId') ?? '') === focusRef.current
          return new Style({
            image: new CircleStyle({
              radius: focused ? 9 : 7,
              fill: new Fill({ color: focused ? '#f97316' : '#38bdf8' }),
              stroke: new Stroke({ color: '#fff', width: focused ? 2.5 : 2 }),
            }),
          })
        },
      })
      map.addLayer(layer)

      const sync = () => {
        if (!layer) return
        const src = layer.getSource()
        if (!src) return
        src.clear()
        for (const c of itemsRef.current) {
          const lon = Number(c.lon)
          const lat = Number(c.lat)
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
          const feat = new Feature({
            geometry: new Point(fromLonLat([lon, lat])),
            complaintId: c.id,
            label: c.title,
          })
          feat.setId(c.id)
          src.addFeature(feat)
        }
        layer.changed()
      }
      sync()

      clickKey = map.on('singleclick', (evt: MapBrowserEvent<PointerEvent>) => {
        const hit = map.forEachFeatureAtPixel(evt.pixel, (f, lyr) =>
          lyr === layer ? f : undefined
        )
        if (!hit) {
          onSelectRef.current?.(null)
          return
        }
        const id = String(hit.get('complaintId') ?? '').trim()
        onSelectRef.current?.(id || null)
      })
      moveKey = map.on('pointermove', (evt: MapBrowserEvent<PointerEvent>) => {
        const target = map.getTargetElement()
        if (!target || evt.dragging) return
        const hit = map.forEachFeatureAtPixel(evt.pixel, (f, lyr) =>
          lyr === layer ? f : undefined
        )
        target.style.cursor = hit ? 'pointer' : ''
      })

      /** items/focus 변경 시 재동기화용 */
      ;(layer as unknown as { __odorComplaintSync?: () => void }).__odorComplaintSync = sync
    }

    void boot()
    return () => {
      cancelled = true
      if (rafWait) cancelAnimationFrame(rafWait)
      teardown()
    }
  }, [mapRef])

  useEffect(() => {
    const map = mapRef?.current
    if (!map) return
    const layers = map.getLayers().getArray()
    const layer = layers.find((l) => l.get('id') === LAYER_ID) as
      | (import('ol/layer/Vector').default & { __odorComplaintSync?: () => void })
      | undefined
    layer?.__odorComplaintSync?.()
    layer?.changed()
  }, [items, focusId, mapRef])

  return null
}
