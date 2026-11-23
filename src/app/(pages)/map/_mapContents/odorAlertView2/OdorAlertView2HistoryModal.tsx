'use client'

import { useState } from 'react'
import { MapDetailFloatingPanel } from '../../_mapComponents/MapDetailFloatingPanel'
import { useSearchBarOffset } from '../../searchBarOffsetContext'
import type { OdorAckHistoryRow } from '../odorAlert/odorAlertMock'
import { OdorAlertView2HistoryPanel } from './OdorAlertView2HistoryPanel'

type Props = {
  open: boolean
  leftPx: number
  onClose: () => void
  selectedAlertId?: string | null
  onSelectHistory?: (row: OdorAckHistoryRow) => void
}

const PANEL_WIDTH = 'min(400px, calc(100vw - 2rem))'
const PANEL_MAX_HEIGHT = 'min(640px, 70vh)'
const LEFT_GAP = 8

/**
 * 경보목록2 풀패널 — 해제(인지) 이력 플로팅 모달
 */
export function OdorAlertView2HistoryModal({
  open,
  leftPx,
  onClose,
  selectedAlertId = null,
  onSelectHistory,
}: Props) {
  const { topPx: addressTopPx } = useSearchBarOffset()
  const [minimized, setMinimized] = useState(false)

  if (!open) return null

  const top = addressTopPx
  const left = Math.max(8, leftPx + LEFT_GAP)

  return (
    <MapDetailFloatingPanel
      layer="경보목록2"
      title="해제(인지) 이력"
      onClose={onClose}
      minimized={minimized}
      onMinimizedChange={setMinimized}
      width={PANEL_WIDTH}
      maxHeight={PANEL_MAX_HEIGHT}
      defaultPosition={{ top, left }}
      variant="default"
      zLayer="detailFloating"
    >
      <OdorAlertView2HistoryPanel
        onClose={onClose}
        variant="panel"
        selectedAlertId={selectedAlertId}
        onSelectHistory={onSelectHistory}
      />
    </MapDetailFloatingPanel>
  )
}
