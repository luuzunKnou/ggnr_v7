"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { call } from "@/lib/api"
import { cn } from "@/lib/utils"

const GEOSERVER_DEFAULT_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8080/geoserver`
    : "http://localhost:8080/geoserver"

type GeoStatus = {
  success: boolean
  status?: number | null
  statusText?: string
  version?: string | null
  error?: string
}

type DbStatus = {
  success: boolean
  error?: string
  featureTypes?: unknown[]
}

type DiffRow = {
  key: string
  tablesJson: { kor: string; eng: string } | null
  parentsLayer: string | null
  divQuery: string | null
  layerSchema: string | null
  geoserver: string | null
  style: string | null
  excludeFromMismatch?: boolean
}

const EXCLUDED_STYLE_NAMES = new Set(["generic", "line", "point", "polygon", "raster"])

export function GeoserverManagerContent() {
  const [geoserverUrl] = useState(GEOSERVER_DEFAULT_URL)

  const [geoStatus, setGeoStatus] = useState<GeoStatus | null>(null)
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)
  const [layerCount, setLayerCount] = useState<number | null>(null)
  const [styleCount, setStyleCount] = useState<number | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [diffRows, setDiffRows] = useState<DiffRow[]>([])

  const [geoStartLoading, setGeoStartLoading] = useState(false)
  const [geoStopLoading, setGeoStopLoading] = useState(false)
  const [dbSetupLoading, setDbSetupLoading] = useState(false)
  const [styleAutoLoading, setStyleAutoLoading] = useState(false)
  const [layerAutoCreateLoading, setLayerAutoCreateLoading] = useState(false)
  const logScrollRef = useRef<HTMLDivElement>(null)

  const fetchGeoStatus = useCallback(async () => {
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "testGeoServer",
        params: { url: geoserverUrl },
      })
      const d = res?.data ?? res
      setGeoStatus({
        success: !!d?.success,
        status: d?.status ?? null,
        statusText: d?.statusText ?? "",
        version: d?.version ?? null,
        error: d?.error ?? undefined,
      })
    } catch {
      setGeoStatus({ success: false, error: "요청 실패" })
    }
  }, [geoserverUrl])

  const fetchDbStatus = useCallback(async () => {
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "verifyGeoServerDbConnection",
        params: { url: geoserverUrl },
      })
      const d = res?.data ?? res
      setDbStatus({
        success: !!d?.success,
        error: d?.error,
        featureTypes: d?.featureTypes ?? [],
      })
    } catch {
      setDbStatus({ success: false, error: "요청 실패" })
    }
  }, [geoserverUrl])

  const fetchCounts = useCallback(async () => {
    if (!geoStatus?.success) return
    try {
      const [layerRes, styleRes] = await Promise.all([
        call("", "POST", {
          service: "devTestService",
          action: "getGeoServerLayerList",
          params: { url: geoserverUrl },
        }),
        call("", "POST", {
          service: "devTestService",
          action: "getGeoServerStyleList",
          params: { url: geoserverUrl },
        }),
      ])
      const layerData = layerRes?.data ?? layerRes
      const styleData = styleRes?.data ?? styleRes
      const filteredStyles = Array.isArray(styleData?.styles)
        ? styleData.styles.filter(
            (s: { name?: string }) => !EXCLUDED_STYLE_NAMES.has(String(s?.name ?? "").toLowerCase())
          )
        : []
      setLayerCount(Array.isArray(layerData?.layers) ? layerData.layers.length : 0)
      setStyleCount(filteredStyles.length)
    } catch {
      setLayerCount(0)
      setStyleCount(0)
    }
  }, [geoserverUrl, geoStatus?.success])

  const fetchLog = useCallback(async () => {
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "getGeoServerLog",
        params: { maxLines: 200 },
      })
      const d = res?.data ?? res
      setLogLines(Array.isArray(d?.lines) ? d.lines : [])
    } catch {
      setLogLines([])
    }
  }, [])

  const fetchDiff = useCallback(async () => {
    try {
      const [defineRes, layerRes, geoRes, styleRes] = await Promise.all([
        call("", "POST", { service: "devTestService", action: "getDefineLayerTables", params: {} }),
        call("", "POST", { service: "devTestService", action: "getLayerTableList", params: {} }),
        call("", "POST", {
          service: "devTestService",
          action: "getGeoServerLayerList",
          params: { url: geoserverUrl },
        }),
        call("", "POST", {
          service: "devTestService",
          action: "getGeoServerStyleList",
          params: { url: geoserverUrl },
        }),
      ])

      const defineTables = (defineRes?.data?.tables ?? []) as Array<{
        define_table_name?: string
        define_table_kor_name?: string
        define_table_parents_layer?: string
        define_table_div_query?: string
      }>
      const layerTables = (layerRes?.data?.tables ?? []) as Array<{ schema: string; table: string }>
      const geoLayers = (geoRes?.data?.layers ?? []) as string[]
      const styleList = ((styleRes?.data?.styles ?? []) as Array<{ name: string }>).filter(
        (s) => !EXCLUDED_STYLE_NAMES.has(String(s?.name ?? "").toLowerCase())
      )

      const defineMap = new Map<string, { kor: string; eng: string; parentsLayer: string; divQuery: string }>()
      defineTables.forEach((t) => {
        const eng = String(t.define_table_name ?? "").trim()
        if (eng) {
          defineMap.set(eng, {
            kor: String(t.define_table_kor_name ?? "").trim(),
            eng,
            parentsLayer: String(t.define_table_parents_layer ?? "").trim(),
            divQuery: String(t.define_table_div_query ?? "").trim(),
          })
        }
      })

      const layerSchemaSet = new Set(
        layerTables
          .filter((t) => t.schema === "layer" || t.schema === "public_layer")
          .map((t) => t.table)
      )
      const geoSet = new Set(geoLayers)
      const styleSet = new Set(styleList.map((s) => s.name))
      const splitParents = new Set(
        Array.from(defineMap.values())
          .filter((v) => !!v.parentsLayer && !!v.divQuery)
          .map((v) => v.parentsLayer)
      )

      const allKeys = new Set<string>([
        ...defineMap.keys(),
        ...layerSchemaSet,
        ...geoSet,
        ...styleSet,
      ])
      const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b, "ko"))

      const rows: DiffRow[] = sortedKeys.map((key) => {
        const defineRow = defineMap.get(key) ?? null
        const parentsLayer = defineRow?.parentsLayer || null
        const divQuery = defineRow?.divQuery || null
        const isSplitLayer = !!parentsLayer && !!divQuery
        const dbMatched = isSplitLayer
          ? layerSchemaSet.has(parentsLayer)
          : layerSchemaSet.has(key)
        const layerSchema = dbMatched
          ? isSplitLayer
            ? `${parentsLayer}  -  ${divQuery}`
            : key
          : null

        return {
          key,
          tablesJson: defineRow ? { kor: defineRow.kor, eng: defineRow.eng } : null,
          parentsLayer,
          divQuery,
          layerSchema,
          geoserver: geoSet.has(key) ? key : null,
          style: styleSet.has(key) ? key : null,
          excludeFromMismatch: splitParents.has(key),
        }
      })
      setDiffRows(rows)
    } catch {
      setDiffRows([])
    }
  }, [geoserverUrl])

  useEffect(() => {
    fetchGeoStatus()
    const t1 = setInterval(fetchGeoStatus, 1000)
    return () => clearInterval(t1)
  }, [fetchGeoStatus])

  useEffect(() => {
    fetchDbStatus()
    const t2 = setInterval(fetchDbStatus, 1000)
    return () => clearInterval(t2)
  }, [fetchDbStatus])

  useEffect(() => {
    if (geoStatus?.success) fetchCounts()
    const t3 = setInterval(() => {
      if (geoStatus?.success) fetchCounts()
    }, 1000)
    return () => clearInterval(t3)
  }, [geoStatus?.success, fetchCounts])

  useEffect(() => {
    fetchLog()
    const t4 = setInterval(fetchLog, 1000)
    return () => clearInterval(t4)
  }, [fetchLog])

  useEffect(() => {
    if (logLines.length > 0 && logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
    }
  }, [logLines])

  useEffect(() => {
    fetchDiff()
  }, [fetchDiff])

  const startGeoServer = async () => {
    setGeoStartLoading(true)
    try {
      await call("", "POST", { service: "devTestService", action: "startGeoServer", params: {} })
      await fetchGeoStatus()
    } finally {
      setGeoStartLoading(false)
    }
  }

  const stopGeoServer = async () => {
    setGeoStopLoading(true)
    try {
      await call("", "POST", { service: "devTestService", action: "stopGeoServer", params: {} })
      await fetchGeoStatus()
    } finally {
      setGeoStopLoading(false)
    }
  }

  const setupDb = async () => {
    setDbSetupLoading(true)
    try {
      await call("", "POST", {
        service: "devTestService",
        action: "setupGeoServerDb",
        params: { url: geoserverUrl },
      })
      await fetchDbStatus()
    } finally {
      setDbSetupLoading(false)
    }
  }

  const autoApplyStyles = async () => {
    setStyleAutoLoading(true)
    try {
      await call("", "POST", {
        service: "devTestService",
        action: "applyAllDefaultStyles",
        params: { url: geoserverUrl },
      })
      await Promise.all([fetchCounts(), fetchDiff()])
    } finally {
      setStyleAutoLoading(false)
    }
  }

  const autoCreateLayers = async () => {
    setLayerAutoCreateLoading(true)
    try {
      await call("", "POST", {
        service: "devTestService",
        action: "createGeoServerLayers",
        params: { url: geoserverUrl },
      })
      await Promise.all([fetchCounts(), fetchDiff()])
    } finally {
      setLayerAutoCreateLoading(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* 상단: GeoServer 상태 (콘텐츠 높이만 사용, 여백은 diff로) */}
      <section className="shrink-0 border-b pb-2 mb-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="rounded border bg-muted/30 p-2 space-y-1.5">
            <div className="text-sm font-medium flex items-center gap-2">
              <span
                className={cn(
                  "inline-block w-2.5 h-2.5 rounded-full shrink-0",
                  geoStatus == null && "bg-amber-500 animate-pulse",
                  geoStatus?.success && "bg-green-500",
                  geoStatus != null && !geoStatus.success && "bg-red-500"
                )}
                title={geoStatus == null ? "확인 중" : geoStatus.success ? "연결됨" : "연결 실패"}
              />
              GeoServer 연결
            </div>
            <div
              className={cn(
                "text-xs font-mono",
                geoStatus?.success && "text-green-600 dark:text-green-400",
                geoStatus != null && !geoStatus.success && "text-red-600 dark:text-red-400"
              )}
            >
              {geoStatus == null
                ? "확인 중..."
                : geoStatus.success
                  ? `OK ${geoStatus.version ?? ""} (${geoStatus.status})`
                  : `실패: ${geoStatus.error ?? geoStatus.statusText ?? "연결 불가"}`}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={startGeoServer} disabled={geoStartLoading}>
                {geoStartLoading ? "실행 중..." : "실행"}
              </Button>
              <Button size="sm" variant="outline" onClick={stopGeoServer} disabled={geoStopLoading}>
                {geoStopLoading ? "종료 중..." : "종료"}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={geoserverUrl} target="_blank" rel="noopener noreferrer" title="GeoServer 웹 UI 새 탭에서 열기">
                  접속
                </a>
              </Button>
            </div>
          </div>
          <div className="rounded border bg-muted/30 p-2 space-y-1.5">
            <div className="text-sm font-medium flex items-center gap-2">
              <span
                className={cn(
                  "inline-block w-2.5 h-2.5 rounded-full shrink-0",
                  dbStatus == null && "bg-amber-500 animate-pulse",
                  dbStatus?.success && "bg-green-500",
                  dbStatus != null && !dbStatus.success && "bg-red-500"
                )}
                title={dbStatus == null ? "확인 중" : dbStatus.success ? "연결됨" : "연결 실패"}
              />
              GeoServer DB 연결
            </div>
            <div
              className={cn(
                "text-xs font-mono",
                dbStatus?.success && "text-green-600 dark:text-green-400",
                dbStatus != null && !dbStatus.success && "text-red-600 dark:text-red-400"
              )}
            >
              {dbStatus == null
                ? "확인 중..."
                : dbStatus.success
                  ? `OK (Feature types: ${dbStatus.featureTypes?.length ?? 0}개)`
                  : `실패: ${dbStatus.error ?? "연결 불가"}`}
            </div>
            <Button size="sm" variant="outline" onClick={setupDb} disabled={dbSetupLoading}>
              {dbSetupLoading ? "설정 중..." : "작업공간, 저장소 자동설정"}
            </Button>
          </div>
          <div className="rounded border bg-muted/30 p-2 space-y-1.5">
            <div className="text-sm font-medium">레이어 / 스타일</div>
            <div className="text-xs font-mono">
              레이어: {layerCount ?? "-"}개 · 스타일: {styleCount ?? "-"}개
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={autoCreateLayers} disabled={layerAutoCreateLoading}>
                {layerAutoCreateLoading ? "생성 중..." : "레이어 자동생성"}
              </Button>
              <Button size="sm" variant="outline" onClick={autoApplyStyles} disabled={styleAutoLoading}>
                {styleAutoLoading ? "적용 중..." : "스타일 자동설정"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 중앙: 레이어 diff 테이블 */}
      <section className="flex-1 min-h-0 overflow-hidden border-b pb-3 mb-3 flex flex-col">
        <div className="shrink-0 text-sm font-medium mb-2 flex items-center gap-2 flex-wrap">
          레이어 목록 diff (tables.json · Database · GeoServer · Style)
          {diffRows.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              일치 <span className="font-semibold text-green-600 dark:text-green-400">
                {diffRows.filter((r) => {
                  const isMatch =
                    r.tablesJson != null &&
                    r.layerSchema != null &&
                    r.geoserver != null &&
                    r.style != null
                  return isMatch || r.excludeFromMismatch
                }).length}
              </span>
              {" / "}
              불일치 <span className="font-semibold text-red-600 dark:text-red-400">
                {diffRows.filter((r) => {
                  const isMatch =
                    r.tablesJson != null &&
                    r.layerSchema != null &&
                    r.geoserver != null &&
                    r.style != null
                  return !isMatch && !r.excludeFromMismatch
                }).length}
              </span>
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b leading-none">
                <th className="sticky top-0 z-10 text-left py-1.5 px-2 w-[25%] bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
                  tables.json (한글명 / 영문명)
                </th>
                <th className="sticky top-0 z-10 text-left py-1.5 px-2 w-[25%] bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
                  Database
                </th>
                <th className="sticky top-0 z-10 text-left py-1.5 px-2 w-[25%] bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
                  GeoServer 레이어
                </th>
                <th className="sticky top-0 z-10 text-left py-1.5 px-2 w-[25%] bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
                  Style
                </th>
              </tr>
            </thead>
            <tbody>
              {diffRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-1.5 px-2 text-muted-foreground text-center">
                    데이터 로딩 중이거나 없습니다.
                  </td>
                </tr>
              ) : (
                diffRows.map((row) => {
                  const isMatch =
                    row.tablesJson != null &&
                    row.layerSchema != null &&
                    row.geoserver != null &&
                    row.style != null
                  const rowBg = row.excludeFromMismatch
                    ? "bg-slate-50/80 dark:bg-slate-900/30"
                    : isMatch
                      ? "bg-green-50/80 dark:bg-green-950/30"
                      : "bg-red-50/80 dark:bg-red-950/30"
                  return (
                  <tr
                    key={row.key}
                    className={cn(
                      "border-b border-border/50 leading-none",
                      rowBg
                    )}
                  >
                    <td className="py-1.5 px-2 font-mono">
                      {row.tablesJson
                        ? `${row.tablesJson.kor || "-"} / ${row.tablesJson.eng}`
                        : ""}
                    </td>
                    <td className="py-1.5 px-2 font-mono">
                      {row.layerSchema ? (
                        <span className="block truncate" title={row.layerSchema}>
                          {row.layerSchema}
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="py-1.5 px-2 font-mono">{row.geoserver ?? ""}</td>
                    <td className="py-1.5 px-2 font-mono">{row.style ?? ""}</td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 하단 1/4: GeoServer 로그 */}
      <section className="shrink-0 h-[25%] min-h-[120px] flex flex-col min-h-0">
        <div className="text-sm font-medium mb-1 shrink-0">GeoServer 로그</div>
        <div
          ref={logScrollRef}
          className="min-h-0 flex-1 overflow-y-scroll overflow-x-hidden rounded border bg-muted/30 p-2 font-mono text-[11px] leading-tight whitespace-pre-wrap break-words scrollbar-hide"
          style={{ minHeight: 0 }}
        >
          {logLines.length === 0 ? (
            <span className="text-muted-foreground">로그가 없거나 파일을 찾을 수 없습니다.</span>
          ) : (
            logLines.map((line, i) => (
              <div key={i} className="leading-tight">
                {line}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
