'use client'

import { useEffect, useMemo, useRef } from 'react'
import ImageLayer from 'ol/layer/Image'
import ImageWMS from 'ol/source/ImageWMS'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { WORKSPACE } from '../../../_mapComponents/layerFactory/serviceLayerFactory'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { MeterZone } from './clusterMeterZones'
import type { MeterLocateResult } from './locateMeterAddresses'

const WMS_LAYER = `${WORKSPACE}:wtl_meta_ps`
const WMS_STYLE = 'wtl_meta_ps'

function buildMetNumCql(meterNos: string[]): string | undefined {
  const unique = [
    ...new Set(meterNos.map((n) => String(n ?? '').trim()).filter(Boolean)),
  ]
  if (unique.length === 0) return undefined
  const list = unique.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')
  return `met_num IN (${list})`
}

/**
 * 계량기위치 메뉴 — 목록(또는 선택 구역)에 있는 급수전만 WMS로 표시.
 */
export function useWtlMeterWmsLayer(
  rows: MeterLocateResult[],
  selectedZoneId: string | null,
  zones: MeterZone[]
) {
  const mapContext = useMapContext()
  const layerRef = useRef<ImageLayer<ImageWMS> | null>(null)

  const meterNos = useMemo(() => {
    let target = rows.filter((r) => r.status !== 'miss')
    if (selectedZoneId) {
      const zone = zones.find((z) => z.zoneId === selectedZoneId)
      const idSet = new Set(zone?.rowIds ?? [])
      target = target.filter((r) => idSet.has(r.id))
    }
    return target.map((r) => r.input)
  }, [rows, selectedZoneId, zones])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return

    const geoServerBase = getGeoServerBase()
    const layer = new ImageLayer({
      source: new ImageWMS({
        url: `${geoServerBase}/${WORKSPACE}/wms`,
        params: {
          LAYERS: WMS_LAYER,
          STYLES: WMS_STYLE,
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
        imageLoadFunction: geoserverWmsImageLoadFunction,
        crossOrigin: 'anonymous',
      }),
      zIndex: 920,
      visible: false,
    })
    layer.set('wtlMeterWms', true)
    layerRef.current = layer
    map.addLayer(layer)

    return () => {
      layerRef.current = null
      map.removeLayer(layer)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    const layer = layerRef.current
    const source = layer?.getSource()
    if (!layer || !source) return
    const cql = buildMetNumCql(meterNos)
    if (!cql) {
      layer.setVisible(false)
      source.updateParams({ CQL_FILTER: undefined })
      return
    }
    layer.setVisible(true)
    source.setImageLoadFunction(geoserverWmsImageLoadFunction)
    source.updateParams({
      LAYERS: WMS_LAYER,
      STYLES: WMS_STYLE,
      CQL_FILTER: cql,
      _ts: Date.now(),
    })
  }, [meterNos])
}
