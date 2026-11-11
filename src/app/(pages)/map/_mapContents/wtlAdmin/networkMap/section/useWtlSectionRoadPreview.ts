'use client'

import { useEffect, type RefObject } from 'react'
import type Map from 'ol/Map'
import ImageLayer from 'ol/layer/Image'
import ImageWMS from 'ol/source/ImageWMS'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { WORKSPACE } from '../../../../_mapComponents/layerFactory/serviceLayerFactory'

export type SectionRoadPreviewTable = 'tl_sprd_rw' | 'tl_sprd_manage' | null

const PREVIEW_Z = 420
const TABLE_LABEL: Record<Exclude<SectionRoadPreviewTable, null>, string> = {
  tl_sprd_rw: '실폭도로',
  tl_sprd_manage: '도로구간',
}

/**
 * 단면도 스냅 모드용 임시 건물·도로 WMS.
 * 건물·도로 패널 state와 분리 — sync가 덮어쓰지 않음.
 */
export function useWtlSectionRoadPreview(
  mapRef: RefObject<Map | null> | null | undefined,
  mapReady: boolean,
  tableName: SectionRoadPreviewTable
) {
  useEffect(() => {
    const map = mapRef?.current
    if (!map || !mapReady) return
    if (!tableName) return

    const geoServerBase = getGeoServerBase()
    const layer = new ImageLayer({
      visible: true,
      zIndex: PREVIEW_Z,
      source: new ImageWMS({
        url: `${geoServerBase}/${WORKSPACE}/wms`,
        params: {
          LAYERS: `${WORKSPACE}:${tableName}`,
          STYLES: tableName,
        },
        serverType: 'geoserver',
        ratio: 1.5,
      }),
    })
    layer.set('name', TABLE_LABEL[tableName])
    layer.set('wtlNetworkSectionRoadPreview', true)
    layer.set('layerTableName', tableName)
    layer.set('mapSplitNoMirror', true)
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
    }
  }, [mapRef, mapReady, tableName])
}
