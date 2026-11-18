'use client'

import { useEffect, useState } from 'react'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { ODOR_ALERT_SER_ENG } from './odorAlertConfig'
import { OdorAlertHistoryPanel } from './OdorAlertHistoryPanel'
import { OdorAlertListPanel } from './OdorAlertListPanel'
import { useOdorAlertStore } from './odorAlertStore'

export const ODOR_ALERT_LIST_DEFAULT_WIDTH = 440
export const ODOR_ALERT_LIST_MIN_WIDTH = 360
export const ODOR_ALERT_LIST_MAX_WIDTH = 640
export const ODOR_ALERT_HISTORY_DEFAULT_WIDTH = 360
export const ODOR_ALERT_HISTORY_MIN_WIDTH = 300
export const ODOR_ALERT_HISTORY_MAX_WIDTH = 520

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function OdorAlertShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const { history } = useOdorAlertStore()
  const [listWidth, setListWidth] = useState(ODOR_ALERT_LIST_DEFAULT_WIDTH)
  const [historyWidth, setHistoryWidth] = useState(ODOR_ALERT_HISTORY_DEFAULT_WIDTH)
  const [historyOpen, setHistoryOpen] = useState(false)

  const total = listWidth + (historyOpen ? historyWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => () => onTotalWidthChange(0), [onTotalWidthChange])

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={ODOR_ALERT_LIST_MIN_WIDTH}
          maxWidth={ODOR_ALERT_LIST_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
          contentClassName="overflow-hidden"
          serEng={ODOR_ALERT_SER_ENG}
        >
          <OdorAlertListPanel
            onClose={onClose}
            historyOpen={historyOpen}
            onOpenHistory={() => setHistoryOpen((v) => !v)}
          />
        </MapSideListPanel>
      </div>
      {historyOpen && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={historyWidth}
            minWidth={ODOR_ALERT_HISTORY_MIN_WIDTH}
            maxWidth={ODOR_ALERT_HISTORY_MAX_WIDTH}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setHistoryWidth}
            contentClassName="overflow-hidden"
            serEng={ODOR_ALERT_SER_ENG}
          >
            <OdorAlertHistoryPanel rows={history} onClose={() => setHistoryOpen(false)} />
          </MapSideListPanel>
        </div>
      )}
    </>
  )
}
