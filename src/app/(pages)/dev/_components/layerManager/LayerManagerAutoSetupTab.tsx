"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { call } from "@/lib/api"
import { RotateCcw, Wrench } from "lucide-react"
import { SchemaBadge, SourceBadge } from "./defineBadges"
import { LayerManagerAutofixHistoryPanel } from "./LayerManagerAutofixHistoryPanel"
import {
  LAYER_SETUP_ISSUE_LABELS,
  LAYER_SETUP_ISSUE_ORDER,
} from "./layerSetupIssues"
import type { LayerSetupIssueRow, LayerSetupIssueType } from "@/service/devTestService"

const GEOSERVER_DEFAULT_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8080/geoserver`
    : "http://localhost:8080/geoserver"

type LayerManagerAutoSetupTabProps = {
  onIssueCountChange?: (count: number) => void
}

export function LayerManagerAutoSetupTab({ onIssueCountChange }: LayerManagerAutoSetupTabProps) {
  const [layers, setLayers] = useState<LayerSetupIssueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showPublicLayer, setShowPublicLayer] = useState(true)
  const [fixingKey, setFixingKey] = useState<string | null>(null)
  const [bulkFixing, setBulkFixing] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0)

  const bumpHistory = useCallback(() => {
    setHistoryRefreshToken((n) => n + 1)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const loadIssues = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "scanLayerSetupIssues",
        params: { url: GEOSERVER_DEFAULT_URL },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setError(data?.error ?? "오류 목록을 불러올 수 없습니다.")
        setLayers([])
        onIssueCountChange?.(0)
        return
      }
      const next = Array.isArray(data.layers) ? (data.layers as LayerSetupIssueRow[]) : []
      setLayers(next)
      onIssueCountChange?.(next.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류 목록을 불러올 수 없습니다.")
      setLayers([])
      onIssueCountChange?.(0)
    } finally {
      setLoading(false)
    }
  }, [onIssueCountChange])

  useEffect(() => {
    void loadIssues()
  }, [loadIssues])

  const filteredLayers = useMemo(() => {
    let list = layers
    if (!showPublicLayer) {
      list = list.filter((r) => r.schema !== "public_layer")
    }
    const q = debouncedSearch.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.group.toLowerCase().includes(q) ||
          r.tableName.toLowerCase().includes(q) ||
          r.korName.toLowerCase().includes(q)
      )
    }
    return list
  }, [layers, showPublicLayer, debouncedSearch])

  const fixOne = useCallback(
    async (row: LayerSetupIssueRow) => {
      setFixingKey(row.rowKey)
      setError(null)
      setSuccessMsg(null)
      try {
        const res = await call("", "POST", {
          service: "devTestService",
          action: "fixLayerSetupIssues",
          params: {
            tableName: row.tableName,
            schema: row.schema,
            issues: row.issues,
            missingCodeFields: row.missingCodeFields,
            url: GEOSERVER_DEFAULT_URL,
            geometryType: row.shpType || undefined,
            group: row.group || undefined,
            defineSchema: row.defineSchema,
            schemaMismatchAction: row.schemaMismatchAction,
          },
        })
        const data = res?.data ?? res
        if (!data?.success) {
          setError(
            data?.error
              ? `${data.error}${data.logPath ? ` (로그: ${data.logPath})` : ""}`
              : `"${row.tableName}" 자동 수정 실패`
          )
          bumpHistory()
          return
        }
        const isRemnantDrop =
          row.issues.includes("temp_sync_table") ||
          (row.issues.includes("schema_mismatch") && row.schemaMismatchAction === "drop")
        const logHint = data.logPath ? ` · ${data.logPath}` : ""
        setSuccessMsg(
          isRemnantDrop
            ? `"${row.tableName}" 잔여 테이블 삭제 완료${logHint}`
            : `"${row.tableName}" 자동 수정 완료${logHint}`
        )
        bumpHistory()
        await loadIssues()
      } catch (e) {
        setError(e instanceof Error ? e.message : "자동 수정 실패")
      } finally {
        setFixingKey(null)
      }
    },
    [bumpHistory, loadIssues]
  )

  const fixAll = useCallback(async () => {
    if (filteredLayers.length === 0) return
    setBulkFixing(true)
    setError(null)
    setSuccessMsg(null)
    let ok = 0
    let fail = 0
    let lastLogPath: string | null = null
    try {
      for (const row of filteredLayers) {
        setFixingKey(row.rowKey)
        const res = await call("", "POST", {
          service: "devTestService",
          action: "fixLayerSetupIssues",
          params: {
            tableName: row.tableName,
            schema: row.schema,
            issues: row.issues,
            missingCodeFields: row.missingCodeFields,
            url: GEOSERVER_DEFAULT_URL,
            geometryType: row.shpType || undefined,
            group: row.group || undefined,
            defineSchema: row.defineSchema,
            schemaMismatchAction: row.schemaMismatchAction,
          },
        })
        const data = res?.data ?? res
        if (typeof data?.logPath === "string" && data.logPath) lastLogPath = data.logPath
        if (data?.success) ok += 1
        else fail += 1
      }
      const logHint = lastLogPath ? ` · 최근 로그 ${lastLogPath}` : ""
      setSuccessMsg(
        `전체 자동 수정 완료 (성공 ${ok}건${fail > 0 ? `, 실패 ${fail}건` : ""})${logHint}`
      )
      bumpHistory()
      await loadIssues()
    } catch (e) {
      setError(e instanceof Error ? e.message : "전체 자동 수정 실패")
    } finally {
      setFixingKey(null)
      setBulkFixing(false)
    }
  }, [bumpHistory, filteredLayers, loadIssues])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-2">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex items-center gap-3 flex-wrap shrink-0">
          <Input
            placeholder="그룹명·테이블명·한글명 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-56 rounded-md text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showPublicLayer}
              onChange={(e) => setShowPublicLayer(e.target.checked)}
              className="rounded border-input"
            />
            public_layer
          </label>
          <span className="text-sm text-muted-foreground">
            {loading && layers.length === 0 ? "스캔 중…" : `${filteredLayers.length} / ${layers.length}`}
          </span>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {successMsg && (
              <span className="text-sm text-green-600 dark:text-green-400">{successMsg}</span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={() => {
                setSearchQuery("")
                setDebouncedSearch("")
                void loadIssues()
                bumpHistory()
              }}
              disabled={loading || bulkFixing}
            >
              <RotateCcw className="w-4 h-4 mr-1.5 opacity-70" />
              새로고침
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="rounded-md"
              onClick={() => void fixAll()}
              disabled={bulkFixing || filteredLayers.length === 0}
            >
              <Wrench className="w-4 h-4 mr-1.5 opacity-70" />
              {bulkFixing ? "수정 중..." : "전체 자동 수정"}
            </Button>
          </div>
        </div>

        {error && <span className="text-sm text-destructive shrink-0">{error}</span>}

        <div className="flex-1 min-h-0 overflow-auto border rounded-none bg-muted/20">
          {loading && layers.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">오류 목록 스캔 중…</p>
          ) : filteredLayers.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {layers.length === 0
                ? "설정 오류가 있는 레이어가 없습니다."
                : "표시할 레이어가 없습니다."}
            </p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-muted border-b">
                <tr>
                  <th className="py-1 px-2 text-left text-xs font-medium border-r w-[92px]">스키마</th>
                  <th className="py-1 px-2 text-left text-xs font-medium border-r w-[64px]">출처</th>
                  <th className="py-1 px-2 text-left text-xs font-medium border-r w-[130px]">그룹</th>
                  <th className="py-1 px-2 text-left text-xs font-medium border-r">테이블명</th>
                  <th className="py-1 px-2 text-left text-xs font-medium border-r">한글명</th>
                  <th className="py-1 px-2 text-left text-xs font-medium border-r">오류</th>
                  <th className="py-1 px-2 text-center text-xs font-medium w-[88px]">수정</th>
                </tr>
              </thead>
              <tbody>
                {filteredLayers.map((row) => (
                  <tr
                    key={row.rowKey}
                    className="border-b hover:bg-green-50/30 dark:hover:bg-green-950/10"
                  >
                    <td className="py-1 px-2 border-r text-center">
                      <SchemaBadge value={row.schema} />
                    </td>
                    <td className="py-1 px-2 border-r text-center">
                      <SourceBadge value={row.source} />
                    </td>
                    <td className="py-1 px-2 border-r truncate max-w-[130px]" title={row.group}>
                      {row.group || "—"}
                    </td>
                    <td className="py-1 px-2 border-r font-mono truncate" title={row.tableName}>
                      {row.tableName}
                    </td>
                    <td className="py-1 px-2 border-r truncate" title={row.korName}>
                      {row.korName || "—"}
                    </td>
                    <td className="py-1 px-2 border-r">
                      <div className="flex flex-wrap gap-1">
                        {LAYER_SETUP_ISSUE_ORDER.filter((k) => row.issues.includes(k)).map((issue) => (
                          <IssueBadge
                            key={issue}
                            issue={issue}
                            detail={
                              issue === "define_field" && row.missingFields.length > 0
                                ? row.missingFields.join(", ")
                                : issue === "define_code" && row.missingCodeFields.length > 0
                                  ? row.missingCodeFields.join(", ")
                                  : issue === "schema_mismatch" && row.defineSchema
                                    ? row.schemaMismatchAction === "drop"
                                      ? `잘못된 스키마 잔여 삭제 (${row.schema}, 정의=${row.defineSchema})`
                                      : `${row.schema} → ${row.defineSchema}`
                                    : undefined
                            }
                          />
                        ))}
                      </div>
                    </td>
                    <td className="py-1 px-2 text-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={fixingKey === row.rowKey || bulkFixing}
                        onClick={() => void fixOne(row)}
                      >
                        {fixingKey === row.rowKey
                          ? row.issues.includes("temp_sync_table") ||
                            row.schemaMismatchAction === "drop"
                            ? "삭제 중"
                            : "수정 중"
                          : row.issues.includes("temp_sync_table") ||
                              row.schemaMismatchAction === "drop"
                            ? "삭제"
                            : "자동 수정"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex h-[280px] shrink-0 flex-col overflow-hidden border-t pt-2">
        <LayerManagerAutofixHistoryPanel refreshToken={historyRefreshToken} />
      </div>
    </div>
  )
}

function IssueBadge({ issue, detail }: { issue: LayerSetupIssueType; detail?: string }) {
  const label = LAYER_SETUP_ISSUE_LABELS[issue]
  return (
    <span
      className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300"
      title={detail ? `${label}: ${detail}` : label}
    >
      {label}
    </span>
  )
}
