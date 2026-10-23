'use client'

import { useEffect, useState } from 'react'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { SmallPublicFacDetailPanel } from './SmallPublicFacDetailPanel'
import { SmallPublicFacListPanel } from './SmallPublicFacListPanel'

export const SMALL_PUBLIC_FAC_OPENED_KEY = 'rdcSmallPublicFac'

export const SMALL_PUBLIC_FAC_LIST_DEFAULT_WIDTH = 720
export const SMALL_PUBLIC_FAC_LIST_MIN_WIDTH = 560
export const SMALL_PUBLIC_FAC_LIST_MAX_WIDTH = 960
export const SMALL_PUBLIC_FAC_DETAIL_DEFAULT_WIDTH = 560
export const SMALL_PUBLIC_FAC_DETAIL_MIN_WIDTH = 420
export const SMALL_PUBLIC_FAC_DETAIL_MAX_WIDTH = 760

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function SmallPublicFacShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const [listWidth, setListWidth] = useState(SMALL_PUBLIC_FAC_LIST_DEFAULT_WIDTH)
  const [detailWidth, setDetailWidth] = useState(SMALL_PUBLIC_FAC_DETAIL_DEFAULT_WIDTH)
  const [detailId, setDetailId] = useState<string | null>(null)

  const total = listWidth + (detailId ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={SMALL_PUBLIC_FAC_LIST_MIN_WIDTH}
          maxWidth={SMALL_PUBLIC_FAC_LIST_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
        >
          <SmallPublicFacListPanel
            onClose={onClose}
            selectedDetailId={detailId}
            onSelectDetailId={setDetailId}
          />
        </MapSideListPanel>
      </div>
      {detailId && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={detailWidth}
            minWidth={SMALL_PUBLIC_FAC_DETAIL_MIN_WIDTH}
            maxWidth={SMALL_PUBLIC_FAC_DETAIL_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            <SmallPublicFacDetailPanel detailId={detailId} onClose={() => setDetailId(null)} />
          </MapSideListPanel>
        </div>
      )}
    </>
  )
}
