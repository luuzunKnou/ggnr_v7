'use client'

import { useEffect } from 'react'
import ImageLayer from 'ol/layer/Image'
import ImageWMS from 'ol/source/ImageWMS'
import { useMapContext } from '../../../_mapComponents/MapContext'

const WMS_URL = 'http://192.168.127.32:8090/geoserver/water_uiseong/wms'
const WMS_LAYER = 'water_uiseong:wtl_meta_ps'
const WMS_STYLE = 'wtl_meta_ps'

/** 계량기위치 메뉴가 열려 있는 동안 의성 계량기 WMS를 지도에 올린다. */
export function useWtlMeterWmsLayer() {
  const mapContext = useMapContext()

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return

    const layer = new ImageLayer({
      source: new ImageWMS({
        url: WMS_URL,
        params: {
          LAYERS: WMS_LAYER,
          STYLES: WMS_STYLE,
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
      }),
      zIndex: 920,
    })
    layer.set('wtlMeterWms', true)
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])
}
