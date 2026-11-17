'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import { call } from '@/lib/api'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { WtlFacilityListRow } from './WtlFacilityListView'

type SourceRef = {
  tableName: string
  schema: string
} | null

type Props = {
  source: SourceRef
  onSelect: (row: WtlFacilityListRow) => void
}

/**
 * 현재 레이어 그룹 테이블 지도 클릭 → 상세.
 * 거리·면적·고도 측정·공간그리기·도형편집 중에는 무시.
 */
export function useWtlFacilityMapClick({ source, onSelect }: Props) {
  const mapContext = useMapContext()
  const onSelectRef = useRef(onSelect)
  const sourceRef = useRef(source)
  const drawBlocksClickRef = useRef(false)

  onSelectRef.current = onSelect
  sourceRef.current = source
  drawBlocksClickRef.current = Boolean(
    mapContext?.spatialDrawRequest ||
      mapContext?.mapMeasureTool ||
      mapContext?.measurementActive ||
      mapContext?.mapDrawInputSuspended ||
      mapContext?.layerRowGeomEdit
  )

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (drawBlocksClickRef.current) return
      const src = sourceRef.current
      if (!src?.tableName) return
      try {
        const res = await call('', 'POST', {
          service: 'wtlFacilityService',
          action: 'getFacilityAtPoint',
          params: {
            x: evt.coordinate[0],
            y: evt.coordinate[1],
            table: src.tableName,
            schema: src.schema,
            tolerance: 12,
          },
        })
        const row = (res?.data ?? res)?.row as WtlFacilityListRow | null | undefined
        if (row) onSelectRef.current(row)
      } catch {
        /* ignore */
      }
    }

    const clickKey = map.on('singleclick', handleClick as never)
    return () => {
      unByKey(clickKey)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])
}
