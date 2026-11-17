'use client'

import { useEffect, useState } from 'react'
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel'
import { SerWriteAccessProvider } from '@/hooks/useSerWriteAccess'
import { MemoListPanel } from '../memo/MemoListPanel'
import { WaterComplaintListPanel } from './WaterComplaintListPanel'
import type { WaterPlaceFocus } from './waterComplaintMapFly'
import type { WaterAdminMenu } from './waterAdminMemoComplaint'

const MEMO_WIDTH = 420
const COMPLAINT_WIDTH = 480
const MIN_WIDTH = 320
const MAX_WIDTH = 900

type Props = {
  menu: WaterAdminMenu
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  memoDetailId: string | null
  onSelectMemoDetailId: (id: string | null) => void
  memoRefreshKey: number
  onAddMemo: (tableName: string) => void
  complaintRefreshKey: number
  complaintSelectedKey: number | null
  onSelectComplaintKey: (key: number | null, fly: boolean, focus?: WaterPlaceFocus | null) => void
  onAddComplaint: () => void
}

export function WaterAdminShell({
  menu,
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  memoDetailId,
  onSelectMemoDetailId,
  memoRefreshKey,
  onAddMemo,
  complaintRefreshKey,
  complaintSelectedKey,
  onSelectComplaintKey,
  onAddComplaint,
}: Props) {
  const isMemo = menu.kind === 'memo'
  const [width, setWidth] = useState(isMemo ? MEMO_WIDTH : COMPLAINT_WIDTH)
  const tableName = menu.tables[0]?.tableName ?? ''
  const mapLayers = menu.mapLayers?.length ? menu.mapLayers : menu.tables.map((table) => table.tableName)

  useEffect(() => {
    setWidth(isMemo ? MEMO_WIDTH : COMPLAINT_WIDTH)
  }, [isMemo, menu.serEng])

  useEffect(() => {
    onTotalWidthChange(width)
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange, width])

  return (
    <div className="pointer-events-auto shrink-0">
      <MapSideListPanel
        width={width}
        minWidth={MIN_WIDTH}
        maxWidth={MAX_WIDTH}
        leftOffsetPx={leftOffsetPx}
        onWidthChange={setWidth}
        serEng={menu.serEng}
      >
        {isMemo ? (
          <MemoListPanel
            title={menu.label}
            fixedTables={menu.tables}
            onClose={onClose}
            selectedDetailId={memoDetailId}
            onSelectDetailId={onSelectMemoDetailId}
            refreshKey={memoRefreshKey}
            onAdd={onAddMemo}
          />
        ) : (
          <SerWriteAccessProvider serEng={menu.serEng}>
            <WaterComplaintListPanel
              title={menu.label}
              tableName={tableName}
              mapLayers={mapLayers}
              refreshKey={complaintRefreshKey}
              selectedKey={complaintSelectedKey}
              onSelectKey={onSelectComplaintKey}
              onRequestAdd={onAddComplaint}
              onClose={onClose}
            />
          </SerWriteAccessProvider>
        )}
      </MapSideListPanel>
    </div>
  )
}
