'use client'

import { useEffect, useState } from 'react'
import { fromLonLat } from 'ol/proj'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../_mapComponents/MapContext'
import { OdorSystemStatusExpandPanel } from '@/app/(pages)/(index)/odorPh/systemStatus/OdorSystemStatusExpandPanel'
import { OdorSystemStatusPanelView } from '@/app/(pages)/(index)/odorPh/systemStatus/OdorSystemStatusPanel'
import { setPendingOdorStationFocus } from '@/app/(pages)/(index)/odorPh/systemStatus/odorSystemStatusFocus'
import { useOdorSystemStatusModel } from '@/app/(pages)/(index)/odorPh/systemStatus/useOdorSystemStatusModel'
import type { OdorCommNodeView } from '@/app/(pages)/(index)/odorPh/systemStatus/odorSystemStatusTypes'
import {
  ODOR_SYSTEM_STATUS_DEFAULT_WIDTH,
  ODOR_SYSTEM_STATUS_EXPAND_DEFAULT_WIDTH,
  ODOR_SYSTEM_STATUS_EXPAND_MAX_WIDTH,
  ODOR_SYSTEM_STATUS_EXPAND_MIN_WIDTH,
  ODOR_SYSTEM_STATUS_MAX_WIDTH,
  ODOR_SYSTEM_STATUS_MIN_WIDTH,
  ODOR_SYSTEM_STATUS_SER_ENG,
} from './odorSystemStatusConfig'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  onOpenDashboardWithStation?: (sensorKey: number) => void
}

export function OdorSystemStatusShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  onOpenDashboardWithStation,
}: Props) {
  const mapContext = useMapContext()
  const model = useOdorSystemStatusModel()
  const [listWidth, setListWidth] = useState(ODOR_SYSTEM_STATUS_DEFAULT_WIDTH)
  const [expandWidth, setExpandWidth] = useState(ODOR_SYSTEM_STATUS_EXPAND_DEFAULT_WIDTH)

  const total = listWidth + (model.expandOpen ? expandWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  const handleGoToStation = (node: OdorCommNodeView) => {
    if (node.sensorKey == null) return
    setPendingOdorStationFocus(node.sensorKey)

    const map = mapContext?.mapInstanceRef?.current
    if (map && node.lon != null && node.lat != null) {
      const center = fromLonLat([node.lon, node.lat]) as [number, number]
      const zoom = Math.max(map.getView().getZoom() ?? 14, 15)
      scheduleAnimateMapToCenter3857(map, center, zoom, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      })
    }

    if (onOpenDashboardWithStation) {
      onOpenDashboardWithStation(node.sensorKey)
    }
  }

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={ODOR_SYSTEM_STATUS_MIN_WIDTH}
          maxWidth={ODOR_SYSTEM_STATUS_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
          contentClassName="overflow-hidden"
          serEng={ODOR_SYSTEM_STATUS_SER_ENG}
        >
          <OdorSystemStatusPanelView
            variant="map"
            model={model}
            onClose={onClose}
            onGoToStation={handleGoToStation}
            expandMode="none"
          />
        </MapSideListPanel>
      </div>
      {model.expandOpen && model.selected ? (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={expandWidth}
            minWidth={ODOR_SYSTEM_STATUS_EXPAND_MIN_WIDTH}
            maxWidth={ODOR_SYSTEM_STATUS_EXPAND_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setExpandWidth}
            contentClassName="overflow-hidden"
            serEng={ODOR_SYSTEM_STATUS_SER_ENG}
          >
            <OdorSystemStatusExpandPanel
              node={model.selected}
              sensorDetail={model.sensorDetail}
              agencySensors={model.agencySensors}
              onSelectSensor={(s) => model.setSensorDetailId(s.id)}
              onBackToAgencyList={() => model.setSensorDetailId(null)}
              onGoToStation={handleGoToStation}
              onClose={model.closeExpand}
              className="h-full w-full"
            />
          </MapSideListPanel>
        </div>
      ) : null}
    </>
  )
}
