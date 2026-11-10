'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { WtlConstructionLedgerShell } from './constructionLedger/WtlConstructionLedgerShell'
import { WtlEquipmentShell } from './equipment/WtlEquipmentShell'
import { WtlFacilityShell } from './facility/WtlFacilityShell'
import { WtlMeterLocationShell } from './meterLocation/WtlMeterLocationShell'
import { WtlNetworkMapShell } from './networkMap/WtlNetworkMapShell'
import { WtlSpatialAnalysisShell } from './spatialAnalysis/WtlSpatialAnalysisShell'
import {
  getWtlAdminEmptyBinding,
  type WtlAdminEmptySerEng,
} from './wtlAdminBinding'

export const WTL_ADMIN_EMPTY_DEFAULT_WIDTH = 420
export const WTL_ADMIN_EMPTY_MIN_WIDTH = 320
export const WTL_ADMIN_EMPTY_MAX_WIDTH = 720

type Props = {
  serEng: WtlAdminEmptySerEng
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function WtlAdminEmptyShell(props: Props) {
  if (props.serEng === 'wtlMeterLocation') {
    return (
      <WtlMeterLocationShell
        leftOffsetPx={props.leftOffsetPx}
        onTotalWidthChange={props.onTotalWidthChange}
        onClose={props.onClose}
      />
    )
  }
  if (props.serEng === 'wtlNetworkMap') {
    return (
      <WtlNetworkMapShell
        leftOffsetPx={props.leftOffsetPx}
        onTotalWidthChange={props.onTotalWidthChange}
        onClose={props.onClose}
      />
    )
  }
  if (props.serEng === 'wtlFacility') {
    return (
      <WtlFacilityShell
        leftOffsetPx={props.leftOffsetPx}
        onTotalWidthChange={props.onTotalWidthChange}
        onClose={props.onClose}
      />
    )
  }
  if (props.serEng === 'wtlEquipment') {
    return (
      <WtlEquipmentShell
        leftOffsetPx={props.leftOffsetPx}
        onTotalWidthChange={props.onTotalWidthChange}
        onClose={props.onClose}
      />
    )
  }
  if (props.serEng === 'wtlSpatialAnalysis') {
    return (
      <WtlSpatialAnalysisShell
        leftOffsetPx={props.leftOffsetPx}
        onTotalWidthChange={props.onTotalWidthChange}
        onClose={props.onClose}
      />
    )
  }
  if (props.serEng === 'wtlConstructionLedger') {
    return (
      <WtlConstructionLedgerShell
        leftOffsetPx={props.leftOffsetPx}
        onTotalWidthChange={props.onTotalWidthChange}
        onClose={props.onClose}
      />
    )
  }
  return <WtlAdminEmptyBody {...props} />
}

function WtlAdminEmptyBody({
  serEng,
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
}: Props) {
  const [width, setWidth] = useState(WTL_ADMIN_EMPTY_DEFAULT_WIDTH)
  const { title } = getWtlAdminEmptyBinding(serEng)

  useEffect(() => {
    onTotalWidthChange(width)
  }, [width, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  return (
    <div className="pointer-events-auto shrink-0">
      <MapSideListPanel
        width={width}
        minWidth={WTL_ADMIN_EMPTY_MIN_WIDTH}
        maxWidth={WTL_ADMIN_EMPTY_MAX_WIDTH}
        leftOffsetPx={leftOffsetPx}
        onWidthChange={setWidth}
      >
        <div className="flex h-full min-h-0 flex-col bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2.5">
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="닫기"
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 bg-slate-50" />
        </div>
      </MapSideListPanel>
    </div>
  )
}
