'use client'

import { useEffect, useRef } from 'react'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { MeterLocateResult } from './locateMeterAddresses'

function labelText(label: string, offsetY: number): Text {
  return new Text({
    text: label,
    font: '12px sans-serif',
    fill: new Fill({ color: '#0f172a' }),
    stroke: new Stroke({ color: '#ffffff', width: 3 }),
    overflow: true,
    offsetY,
  })
}

function parcelStyle(label: string): Style {
  return new Style({
    fill: new Fill({ color: 'rgba(50, 118, 195, 0.35)' }),
    stroke: new Stroke({ color: '#1d4ed8', width: 2 }),
    text: labelText(label, 0),
  })
}

function pointStyle(label: string): Style {
  return new Style({
    image: new Circle({
      radius: 7,
      fill: new Fill({ color: 'rgba(50, 118, 195, 0.9)' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
    text: labelText(label, -16),
  })
}

export function useMeterParcelLayer(rows: MeterLocateResult[], focusId: string | null) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({ source, declutter: true, zIndex: 860 })
    layer.set('wtlMeterParcels', true)
    map.addLayer(layer)

    const drawn = rows.filter(
      (row) =>
        (row.status === 'shown' && row.geometry4326) ||
        (row.status === 'point' && row.point4326)
    )
    if (drawn.length > 0) {
      try {
        const features = new GeoJSON().readFeatures(
          {
            type: 'FeatureCollection',
            features: drawn.map((row) => ({
              type: 'Feature',
              geometry:
                row.geometry4326 ??
                (row.point4326
                  ? { type: 'Point', coordinates: row.point4326 }
                  : null),
              properties: { label: row.input, rowId: row.id, kind: row.status },
            })),
          },
          { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
        )
        for (const feature of features) {
          const rowId = String(feature.get('rowId') ?? '')
          const label = String(feature.get('label') ?? '')
          feature.setId(rowId)
          feature.setStyle(
            feature.get('kind') === 'point' ? pointStyle(label) : parcelStyle(label)
          )
        }
        source.addFeatures(features)
        const extent = source.getExtent()
        if (extent.every((value) => Number.isFinite(value))) {
          scheduleFitMapToExtent3857(map, extent, {
            maxZoom: 18,
            applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
          })
        }
      } catch {
        source.clear()
      }
    }

    return () => {
      sourceRef.current = null
      map.removeLayer(layer)
    }
  }, [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef, mapContext?.mapReady, rows])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source || !focusId) return
    const extent = source.getFeatureById(focusId)?.getGeometry()?.getExtent()
    if (!extent || !extent.every((value) => Number.isFinite(value))) return
    scheduleFitMapToExtent3857(map, extent, {
      maxZoom: 19,
      applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
    })
  }, [focusId, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef])
}
