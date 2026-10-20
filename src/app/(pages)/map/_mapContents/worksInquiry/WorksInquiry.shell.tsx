'use client'

import { useEffect, useState } from 'react'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { WorksInquiryDetailPanel } from './WorksInquiryDetailPanel'
import { WorksInquiryListPanel } from './WorksInquiryListPanel'
import type { WorksInquirySerEng } from './worksInquiryBinding'

export const WORKS_INQUIRY_LIST_DEFAULT_WIDTH = 640
export const WORKS_INQUIRY_LIST_MIN_WIDTH = 480
export const WORKS_INQUIRY_LIST_MAX_WIDTH = 900
export const WORKS_INQUIRY_DETAIL_DEFAULT_WIDTH = 400
export const WORKS_INQUIRY_DETAIL_MIN_WIDTH = 320
export const WORKS_INQUIRY_DETAIL_MAX_WIDTH = 640

type Props = {
  serEng: WorksInquirySerEng
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function WorksInquiryShell({ serEng, leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const [listWidth, setListWidth] = useState(WORKS_INQUIRY_LIST_DEFAULT_WIDTH)
  const [detailWidth, setDetailWidth] = useState(WORKS_INQUIRY_DETAIL_DEFAULT_WIDTH)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    setDetailId(null)
  }, [serEng])

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
          minWidth={WORKS_INQUIRY_LIST_MIN_WIDTH}
          maxWidth={WORKS_INQUIRY_LIST_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
        >
          <WorksInquiryListPanel
            serEng={serEng}
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
            minWidth={WORKS_INQUIRY_DETAIL_MIN_WIDTH}
            maxWidth={WORKS_INQUIRY_DETAIL_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            <WorksInquiryDetailPanel
              serEng={serEng}
              detailId={detailId}
              onClose={() => setDetailId(null)}
            />
          </MapSideListPanel>
        </div>
      )}
    </>
  )
}
