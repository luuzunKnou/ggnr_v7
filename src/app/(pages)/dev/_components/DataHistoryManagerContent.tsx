"use client"

/**
 * 데이터관리 → 데이터 이력관리 (목업 UI)
 */
import { LayerManageHistoryTab } from "./layerManager/LayerManageHistoryTab"

export function DataHistoryManagerContent() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <LayerManageHistoryTab />
    </div>
  )
}
