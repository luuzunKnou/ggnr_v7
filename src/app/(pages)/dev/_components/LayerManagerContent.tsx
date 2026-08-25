"use client"

import { useState, useCallback, useEffect } from "react"
import { cn } from "@/lib/utils"
import { call } from "@/lib/api"
import { Upload, FileSpreadsheet, BadgeAlert } from "lucide-react"
import { LayerManagerListTab } from "./layerManager/LayerManagerListTab"
import { ShpHistoryTab } from "./shp/ShpHistoryTab"
import { ExlHistoryTab } from "./exl/ExlHistoryTab"
import { LayerManagerAutoSetupTab } from "./layerManager/LayerManagerAutoSetupTab"
import {
  LayerManagerUploadDialogs,
  type LayerUploadDialogKind,
} from "./layerManager/LayerManagerUploadDialogs"
import { registerLayerManagerUploadOpener, requestLayerManagerAfterUploadRefresh } from "./layerManager/layerManagerUploadBridge"
import { LayerInfoManager } from "./LayerInfoManager"
import { LayerAttrManager } from "./LayerAttrManager"
import { LayerCodeManager } from "./LayerCodeManager"
import { LayerExtraManager } from "./LayerExtraManager"
import { getGeoServerBase } from "@/lib/geoserverUrl"

const GEOSERVER_DEFAULT_URL = getGeoServerBase()

const MAIN_TABS = [
  { id: "list", label: "레이어 목록" },
  { id: "historyShp", label: "SHP 업데이트 이력" },
  { id: "historyExcel", label: "Excel 업데이트 이력" },
  { id: "defineLayer", label: "레이어 설정 (Layer)" },
  { id: "defineField", label: "레이어 설정 (Field)" },
  { id: "defineCode", label: "레이어 설정 (Code)" },
  { id: "defineExtra", label: "레이어 설정 (Extra)" },
  { id: "autoSetup", label: "오류수정" },
] as const

type MainTabId = (typeof MAIN_TABS)[number]["id"]

export function LayerManagerContent() {
  const [activeTab, setActiveTab] = useState<MainTabId>("list")
  const [visitedTabs, setVisitedTabs] = useState<Set<MainTabId>>(() => new Set(["list"]))
  const [autoSetupIssueCount, setAutoSetupIssueCount] = useState<number | null>(null)
  const [uploadDialog, setUploadDialog] = useState<LayerUploadDialogKind>(null)

  const selectTab = useCallback((id: MainTabId) => {
    setActiveTab(id)
    setVisitedTabs((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const refreshAutoSetupIssueCount = useCallback(async () => {
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "scanLayerSetupIssues",
        params: { url: GEOSERVER_DEFAULT_URL },
      })
      const data = res?.data ?? res
      if (data?.success) {
        setAutoSetupIssueCount(Number(data.issueCount ?? data.layers?.length ?? 0))
      }
    } catch {
      // 탭 배지용 — 실패 시 기존 값 유지
    }
  }, [])

  useEffect(() => {
    if (visitedTabs.has("autoSetup")) return
    const timer = window.setTimeout(() => {
      void refreshAutoSetupIssueCount()
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [visitedTabs, refreshAutoSetupIssueCount])

  const handleAutoSetupIssueCountChange = useCallback((count: number) => {
    setAutoSetupIssueCount(count)
  }, [])

  const handleUploadSuccess = useCallback(
    (kind: Exclude<LayerUploadDialogKind, null>) => {
      if (kind === "shp") {
        selectTab("historyShp")
      } else {
        selectTab("historyExcel")
      }
      void refreshAutoSetupIssueCount()
      requestLayerManagerAfterUploadRefresh(kind)
    },
    [refreshAutoSetupIssueCount, selectTab]
  )

  useEffect(() => {
    return registerLayerManagerUploadOpener(setUploadDialog)
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="shrink-0 flex border-b bg-muted/30 overflow-x-auto">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap inline-flex items-center",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
            onClick={() => selectTab(tab.id)}
          >
            {tab.id === "autoSetup" && autoSetupIssueCount != null && autoSetupIssueCount > 0 ? (
              <BadgeAlert className="mr-1.5 h-4 w-4 shrink-0 text-rose-500 dark:text-rose-400" aria-hidden />
            ) : null}
            {tab.label}
            {tab.id === "autoSetup" && autoSetupIssueCount != null && autoSetupIssueCount > 0 ? (
              <span className="ml-1 text-rose-500 dark:text-rose-400">({autoSetupIssueCount})</span>
            ) : null}
          </button>
        ))}
      </div>

      <LayerManagerUploadDialogs
        kind={uploadDialog}
        onClose={() => setUploadDialog(null)}
        onSuccess={handleUploadSuccess}
      />

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          className="absolute inset-0 flex flex-col"
          style={{ display: activeTab === "list" ? "flex" : "none" }}
        >
          <LayerManagerListTab />
        </div>
        {visitedTabs.has("historyShp") ? (
          <div
            className="absolute inset-0 flex flex-col"
            style={{ display: activeTab === "historyShp" ? "flex" : "none" }}
          >
            <ShpHistoryTab embedded active={activeTab === "historyShp"} />
          </div>
        ) : null}
        {visitedTabs.has("historyExcel") ? (
          <div
            className="absolute inset-0 flex flex-col"
            style={{ display: activeTab === "historyExcel" ? "flex" : "none" }}
          >
            <ExlHistoryTab embedded />
          </div>
        ) : null}
        {visitedTabs.has("defineLayer") ? (
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{ display: activeTab === "defineLayer" ? "flex" : "none" }}
          >
            <LayerInfoManager />
          </div>
        ) : null}
        {visitedTabs.has("defineField") ? (
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{ display: activeTab === "defineField" ? "flex" : "none" }}
          >
            <LayerAttrManager />
          </div>
        ) : null}
        {visitedTabs.has("defineCode") ? (
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{ display: activeTab === "defineCode" ? "flex" : "none" }}
          >
            <LayerCodeManager />
          </div>
        ) : null}
        {visitedTabs.has("defineExtra") ? (
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{ display: activeTab === "defineExtra" ? "flex" : "none" }}
          >
            <LayerExtraManager />
          </div>
        ) : null}
        {visitedTabs.has("autoSetup") ? (
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{ display: activeTab === "autoSetup" ? "flex" : "none" }}
          >
            <LayerManagerAutoSetupTab onIssueCountChange={handleAutoSetupIssueCountChange} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
