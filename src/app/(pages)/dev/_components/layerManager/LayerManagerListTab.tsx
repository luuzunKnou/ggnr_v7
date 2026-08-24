"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Input } from "@/app/shadcnComponents/ui/input"
import { Button } from "@/app/shadcnComponents/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { call } from "@/lib/api"
import { Check, X, Download, FileSpreadsheet, History, Loader2 } from "lucide-react"
import type { LayerManagerRow } from "./types"
import { SchemaBadge, SourceBadge } from "./defineBadges"
import { downloadLayerCsvFromDb, downloadLayerExcel, downloadLayerShp } from "./layerListDownload"
import { LayerManagerRowHistoryDialog } from "./LayerManagerRowHistoryDialog"
import { registerLayerManagerListRefresh, requestLayerManagerDefineRefresh } from "./layerManagerUploadBridge"
import { StyleLegendThumb } from "./StylePreviewSwatch"
import { parseSimpleStyleFromCss, type GeometryType, type StyleProps } from "@/lib/geoserverStyleUtils"
import { fetchDefineLayerTables, fetchLayerDbTableList } from "./layerManagerListCache"

const GEOSERVER_DEFAULT_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8080/geoserver`
    : "http://localhost:8080/geoserver"

const GEOSERVER_WORKSPACE = "ggnr"

const SHARE_OPTIONS = [
  { label: "전체", value: "P" },
  { label: "부서", value: "G" },
  { label: "개인", value: "O" },
] as const

const TABLE_SOURCE_LABEL: Record<string, string> = {
  shp: "SHP",
  excel: "Excel",
}

type TableColumnDef =
  | {
      id: string
      label: string
      width: string
      kind: "field"
      alignCenter?: boolean
      fieldKey: keyof LayerManagerRow
    }
  | { id: string; label: string; width: string; kind: "infra_status"; infraKey: "table" | "layer" | "style" }
  | { id: string; label: string; width: string; kind: "style_legend" }
  | { id: string; label: string; width: string; kind: "updated_at" }
  | { id: string; label: string; width: string; kind: "row_actions" }

type StyleInfo = {
  published: boolean
  hasCssStyle: boolean
  styleName?: string
}

type ExcelMeta = {
  lastSourcePath: string | null
  lastCreateDate: string | null
}

const TABLE_COLUMNS: TableColumnDef[] = [
  { id: "define_table_schema", label: "스키마", width: "92px", kind: "field", alignCenter: true, fieldKey: "define_table_schema" },
  { id: "define_table_source", label: "출처", width: "64px", kind: "field", alignCenter: true, fieldKey: "define_table_source" },
  { id: "define_table_group", label: "그룹", width: "130px", kind: "field", alignCenter: true, fieldKey: "define_table_group" },
  { id: "define_table_name", label: "테이블명", width: "flex", kind: "field", fieldKey: "define_table_name" },
  { id: "define_table_kor_name", label: "한글명", width: "flex", kind: "field", fieldKey: "define_table_kor_name" },
  { id: "__updated_at", label: "갱신일", width: "130px", kind: "updated_at" },
  { id: "__style_legend", label: "스타일", width: "80px", kind: "style_legend" },
  { id: "define_table_idx", label: "순서", width: "50px", kind: "field", alignCenter: true, fieldKey: "define_table_idx" },
  { id: "define_table_shp_type", label: "도형", width: "120px", kind: "field", fieldKey: "define_table_shp_type" },
  { id: "define_table_read_share", label: "읽기", width: "70px", kind: "field", alignCenter: true, fieldKey: "define_table_read_share" },
  { id: "define_table_write_share", label: "쓰기", width: "70px", kind: "field", alignCenter: true, fieldKey: "define_table_write_share" },
  { id: "__infra_table", label: "테이블", width: "52px", kind: "infra_status", infraKey: "table" },
  { id: "__infra_layer", label: "레이어", width: "52px", kind: "infra_status", infraKey: "layer" },
  { id: "__infra_style", label: "스타일", width: "52px", kind: "infra_status", infraKey: "style" },
  { id: "__row_actions", label: "", width: "88px", kind: "row_actions" },
]

function getColumnStyle(col: Pick<TableColumnDef, "id" | "width">): React.CSSProperties {
  if (col.width === "flex") {
    return { flex: 1, minWidth: 0, flexShrink: 1 }
  }
  return { width: col.width, flexShrink: 0 }
}

function formatUpdatedAt(raw: string | null | undefined): string {
  if (!raw) return "—"
  const isoDate = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDate) {
    const yy = isoDate[1].slice(-2)
    return `${yy}.${isoDate[2]}.${isoDate[3]}`
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yy}.${mm}.${dd}`
}

function pickLatestDate(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null
  let bestTime = -Infinity
  for (const v of values) {
    if (!v) continue
    const t = new Date(v).getTime()
    if (!Number.isNaN(t) && t > bestTime) {
      bestTime = t
      best = v
    }
  }
  return best
}

function getLegendGraphicUrl(layerName: string, styleName?: string, version?: number): string {
  // GeoServer 레이어·스타일은 항상 소문자로 생성되므로 원본 대소문자와 무관하게 소문자로 조회
  const layerKey = layerName.toLowerCase()
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetLegendGraphic",
    VERSION: "1.0.0",
    LAYER: `${GEOSERVER_WORKSPACE}:${layerKey}`,
    STYLE: styleName?.trim() || layerKey,
    FORMAT: "image/png",
    WIDTH: "32",
    HEIGHT: "32",
    ...(version != null ? { _v: String(version) } : {}),
  })
  return `${GEOSERVER_DEFAULT_URL}/wms?${params.toString()}`
}

function shareLabel(value: string): string {
  if (!value) return "—"
  const opt = SHARE_OPTIONS.find((o) => o.value === value)
  return opt?.label ?? value
}

function sourceLabel(value: string): string {
  const key = value.toLowerCase()
  return TABLE_SOURCE_LABEL[key] ?? (value || "—")
}

type EditableNameField = "define_table_group" | "define_table_kor_name"

function isEditableNameField(key: keyof LayerManagerRow): key is EditableNameField {
  return key === "define_table_group" || key === "define_table_kor_name"
}

function fieldDisplayText(col: TableColumnDef & { kind: "field" }, row: LayerManagerRow): string {
  const raw = String(row[col.fieldKey] ?? "").trim()
  if (!raw) return "—"
  if (col.fieldKey === "define_table_read_share" || col.fieldKey === "define_table_write_share") {
    return shareLabel(raw)
  }
  if (col.fieldKey === "define_table_source") return sourceLabel(raw)
  return raw
}

function OkIcon({ ok, loading }: { ok: boolean; loading?: boolean }) {
  if (loading) return <span className="text-xs text-muted-foreground mx-auto">…</span>
  return ok ? (
    <Check className="w-3.5 h-3.5 text-green-600 mx-auto" />
  ) : (
    <X className="w-3.5 h-3.5 text-red-400 mx-auto" />
  )
}

function rowHasInfraError(tableName: string, styleInfoMap: Record<string, StyleInfo>): boolean {
  // GeoServer·정의명 대소문자와 DB 테이블명이 달라도 동일 키로 조회 (오류수정 탭과 동일)
  const info = tableName ? styleInfoMap[tableName.toLowerCase()] : undefined
  const published = info?.published ?? false
  const hasCssStyle = info?.hasCssStyle ?? false
  return !published || !hasCssStyle
}

const PAGE_SIZE = 50
const SCROLL_LOAD_THRESHOLD = 200

type FilterMode = "all" | "public_layer" | "layer" | "error"

const FILTER_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "public_layer", label: "public_layer" },
  { value: "layer", label: "layer" },
  { value: "error", label: "오류" },
]

export function LayerManagerListTab() {
  const [rows, setRows] = useState<LayerManagerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [styleInfoMap, setStyleInfoMap] = useState<Record<string, StyleInfo>>({})
  const [styleLoading, setStyleLoading] = useState(false)
  const [styleVersion, setStyleVersion] = useState(0)
  /** WMS 범례(GetLegendGraphic) 실패 시 CSS를 직접 파싱해서 보여주는 미리보기 캐시 — DB 테이블이 없어도 스타일 자체는 볼 수 있게 함 */
  const [cssFallbackMap, setCssFallbackMap] = useState<
    Record<string, "loading" | "error" | (StyleProps & { geometryType: GeometryType })>
  >({})
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [filterMode, setFilterMode] = useState<FilterMode>("all")
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  const [updateDateMap, setUpdateDateMap] = useState<Record<string, string>>({})
  const [excelMetaMap, setExcelMetaMap] = useState<Record<string, ExcelMeta>>({})
  const [metaLoading, setMetaLoading] = useState(false)
  const [downloadingShp, setDownloadingShp] = useState<string | null>(null)
  const [downloadingExcel, setDownloadingExcel] = useState<string | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ tableName: string; korName: string } | null>(
    null
  )
  const [editTarget, setEditTarget] = useState<{
    rowKey: string
    field: EditableNameField
  } | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editSaving, setEditSaving] = useState(false)
  const [dropTarget, setDropTarget] = useState<LayerManagerRow | null>(null)
  const [dropping, setDropping] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dbData, defineRes, geomLayerRes, geomPublicRes] = await Promise.all([
        fetchLayerDbTableList(),
        fetchDefineLayerTables(),
        call("", "POST", {
          service: "devTestService",
          action: "getLayerTableGeometryTypes",
          params: { schema: "layer" },
        }),
        call("", "POST", {
          service: "devTestService",
          action: "getLayerTableGeometryTypes",
          params: { schema: "public_layer" },
        }),
      ])
      if (!dbData?.success) {
        setError(dbData?.error ?? "DB 테이블 목록을 불러올 수 없습니다.")
        setRows([])
        return
      }

      const defineTables: Record<string, unknown>[] =
        defineRes?.success && Array.isArray(defineRes.data) ? defineRes.data : []

      const defineByKey = new Map<string, Record<string, unknown>>()
      const defineByName = new Map<string, Record<string, unknown>>()
      for (const t of defineTables) {
        const name = String(t.define_table_name ?? "").trim()
        if (!name) continue
        const schema = String(t.define_table_schema ?? "layer").trim() || "layer"
        defineByKey.set(`${schema}:${name.toLowerCase()}`, t)
        if (!defineByName.has(name.toLowerCase())) {
          defineByName.set(name.toLowerCase(), t)
        }
      }

      const geomTypes: Record<string, string> = {
        ...((geomLayerRes?.data ?? geomLayerRes)?.types ?? {}),
        ...((geomPublicRes?.data ?? geomPublicRes)?.types ?? {}),
      }

      const dbTables = (dbData.tables ?? []) as Array<{ schema: string; table: string }>
      const nextRows: LayerManagerRow[] = dbTables.map((t) => {
        const schema = t.schema === "public_layer" ? "public_layer" : "layer"
        const tableName = String(t.table ?? "").trim()
        const define =
          defineByKey.get(`${schema}:${tableName.toLowerCase()}`) ??
          defineByName.get(tableName.toLowerCase())
        const shpType =
          String(define?.define_table_shp_type ?? "").trim() ||
          String(geomTypes[tableName] ?? geomTypes[tableName.toLowerCase()] ?? "").trim()

        return {
          rowKey: `${schema}:${tableName}`,
          define_table_schema: schema,
          define_table_source: String(define?.define_table_source ?? ""),
          define_table_group: String(define?.define_table_group ?? ""),
          define_table_name: tableName,
          define_table_kor_name: String(define?.define_table_kor_name ?? ""),
          define_table_idx: define?.define_table_idx != null ? String(define.define_table_idx) : "",
          define_table_shp_type: shpType,
          define_table_read_share: String(define?.define_table_read_share ?? ""),
          define_table_write_share: String(define?.define_table_write_share ?? ""),
        }
      })

      setRows(nextRows)
      setDisplayCount(PAGE_SIZE)
    } catch (e) {
      setError(e instanceof Error ? e.message : "데이터를 불러올 수 없습니다.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStyleInfo = useCallback(async () => {
    setStyleLoading(true)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "getGeoServerLayersWithStyleInfo",
        params: { url: GEOSERVER_DEFAULT_URL },
      })
      const data = res?.data ?? res
      if (data?.success && Array.isArray(data.layers)) {
        const map: Record<string, StyleInfo> = {}
        for (const layer of data.layers) {
          if (layer.name) {
            map[String(layer.name).toLowerCase()] = {
              published: layer.published ?? false,
              hasCssStyle: layer.hasCssStyle ?? false,
              styleName: layer.styleName,
            }
          }
        }
        setStyleInfoMap(map)
        setStyleVersion((v) => v + 1)
      }
    } catch {
      // 스타일 정보 실패해도 목록은 유지
    } finally {
      setStyleLoading(false)
    }
  }, [])

  /** WMS 범례가 실패한 스타일의 CSS를 직접 조회해서 파싱 (DB 테이블 유무와 무관하게 스타일 미리보기 표시) */
  const loadCssFallback = useCallback((key: string, force = false) => {
    setCssFallbackMap((prev) => (prev[key] && !force ? prev : { ...prev, [key]: "loading" }))
    call("", "POST", {
      service: "devTestService",
      action: "getGeoServerStyle",
      params: { url: GEOSERVER_DEFAULT_URL, name: key },
    })
      .then((res) => {
        const data = res?.data ?? res
        if (data?.success && data.format === "css" && data.body) {
          const { styleProps, geometryType } = parseSimpleStyleFromCss(data.body)
          setCssFallbackMap((prev) => ({ ...prev, [key]: { ...styleProps, geometryType } }))
        } else {
          setCssFallbackMap((prev) => ({ ...prev, [key]: "error" }))
        }
      })
      .catch(() => setCssFallbackMap((prev) => ({ ...prev, [key]: "error" })))
  }, [])

  const loadRowMeta = useCallback(async () => {
    setMetaLoading(true)
    try {
      const [layerRes, publicRes, excelRes, histDatesRes] = await Promise.all([
        call("", "POST", {
          service: "shpUploadService",
          action: "getLayerStatusList",
          params: { schema: "layer" },
        }),
        call("", "POST", {
          service: "shpUploadService",
          action: "getLayerStatusList",
          params: { schema: "public_layer" },
        }),
        call("", "POST", {
          service: "excelUploadService",
          action: "getExcelDataStatusList",
          params: {},
        }),
        call("", "POST", {
          service: "layerHistoryService",
          action: "getLatestHistoryDatesByTables",
          params: {},
        }),
      ])

      const dateMap: Record<string, string> = {}
      for (const res of [layerRes, publicRes]) {
        const d = res?.data ?? res
        if (d?.success && Array.isArray(d.rows)) {
          for (const r of d.rows as Array<{ tableName?: string; updatedAt?: string | null }>) {
            const name = String(r.tableName ?? "").toLowerCase()
            if (name && r.updatedAt) dateMap[name] = r.updatedAt
          }
        }
      }

      const excelMap: Record<string, ExcelMeta> = {}
      const exd = excelRes?.data ?? excelRes
      if (exd?.success && Array.isArray(exd.rows)) {
        for (const r of exd.rows as Array<{
          tableName?: string
          lastSourcePath?: string | null
          lastCreateDate?: string | null
        }>) {
          const name = String(r.tableName ?? "").toLowerCase()
          if (!name) continue
          excelMap[name] = {
            lastSourcePath: r.lastSourcePath ?? null,
            lastCreateDate: r.lastCreateDate ?? null,
          }
          if (r.lastCreateDate) {
            dateMap[name] = pickLatestDate(dateMap[name], r.lastCreateDate) ?? r.lastCreateDate
          }
        }
      }

      // SHP·Excel·시스템 UI 통합 최신일 — 모달 최신과 목록 갱신일 맞춤
      const hd = histDatesRes?.data ?? histDatesRes
      if (hd?.success && hd.dates && typeof hd.dates === "object") {
        for (const [name, raw] of Object.entries(hd.dates as Record<string, string>)) {
          const key = String(name).toLowerCase()
          if (!key || !raw) continue
          dateMap[key] = pickLatestDate(dateMap[key], raw) ?? raw
        }
      }

      setUpdateDateMap(dateMap)
      setExcelMetaMap(excelMap)
    } catch {
      // 메타 실패해도 목록은 유지
    } finally {
      setMetaLoading(false)
    }
  }, [])

  const handleExcelDownload = useCallback(async (row: LayerManagerRow) => {
    const tableName = row.define_table_name
    if (!tableName) return
    const schema = row.define_table_schema === "public_layer" ? "public_layer" : "layer"
    const isExcelSource = row.define_table_source.toLowerCase() === "excel"
    const meta = excelMetaMap[tableName.toLowerCase()]
    setDownloadingExcel(tableName)
    try {
      if (isExcelSource) {
        try {
          await downloadLayerExcel(meta?.lastSourcePath ?? null, tableName)
          return
        } catch {
          /* 원본 없으면 DB→CSV */
        }
      }
      await downloadLayerCsvFromDb(tableName, schema)
    } catch (e) {
      alert(e instanceof Error ? e.message : "표 형식 다운로드 실패")
    } finally {
      setDownloadingExcel(null)
    }
  }, [excelMetaMap])

  const cancelEdit = useCallback(() => {
    setEditTarget(null)
    setEditValue("")
  }, [])

  const startEdit = useCallback((row: LayerManagerRow, field: EditableNameField) => {
    setEditTarget({ rowKey: row.rowKey, field })
    setEditValue(String(row[field] ?? ""))
  }, [])

  const saveEdit = useCallback(async () => {
    if (!editTarget) return
    const row = rows.find((r) => r.rowKey === editTarget.rowKey)
    if (!row) {
      cancelEdit()
      return
    }
    const next = editValue.trim()
    const prev = String(row[editTarget.field] ?? "").trim()
    if (next === prev) {
      cancelEdit()
      return
    }
    setEditSaving(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "updateDefineLayerTableMeta",
        params: {
          tableName: row.define_table_name,
          field: editTarget.field,
          value: next,
        },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setError(data?.error ?? "저장에 실패했습니다.")
        return
      }
      setRows((prevRows) =>
        prevRows.map((r) =>
          r.rowKey === editTarget.rowKey ? { ...r, [editTarget.field]: next } : r
        )
      )
      requestLayerManagerDefineRefresh()
      cancelEdit()
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.")
    } finally {
      setEditSaving(false)
    }
  }, [cancelEdit, editTarget, editValue, rows])

  const confirmDropTable = useCallback(async () => {
    if (!dropTarget) return
    const tableName = dropTarget.define_table_name
    const schema = dropTarget.define_table_schema === "public_layer" ? "public_layer" : "layer"
    setDropping(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "dropLayerDbTable",
        params: { tableName, schema },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setError(data?.error ?? "테이블 삭제에 실패했습니다.")
        return
      }
      setDropTarget(null)
      if (historyTarget?.tableName === tableName) setHistoryTarget(null)
      await loadData()
      void loadRowMeta()
    } catch (e) {
      setError(e instanceof Error ? e.message : "테이블 삭제에 실패했습니다.")
    } finally {
      setDropping(false)
    }
  }, [dropTarget, historyTarget, loadData, loadRowMeta])

  const handleShpDownload = useCallback(async (row: LayerManagerRow) => {
    const tableName = row.define_table_name
    if (!tableName) return
    const schema = row.define_table_schema === "public_layer" ? "public_layer" : "layer"
    setDownloadingShp(tableName)
    try {
      await downloadLayerShp(tableName, schema)
    } catch (e) {
      alert(e instanceof Error ? e.message : "SHP 다운로드 실패")
    } finally {
      setDownloadingShp(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadData()
      if (cancelled) return
      void loadStyleInfo()
      void loadRowMeta()
    })()
    return () => {
      cancelled = true
    }
  }, [loadData, loadStyleInfo, loadRowMeta])

  useEffect(() => {
    return registerLayerManagerListRefresh(() => {
      setStyleVersion(Date.now())
      setCssFallbackMap({})
      void loadData()
      void loadRowMeta()
      void loadStyleInfo()
    })
  }, [loadData, loadRowMeta, loadStyleInfo])

  const filteredRows = useMemo(() => {
    let list = rows
    if (filterMode === "public_layer") {
      list = list.filter((r) => r.define_table_schema === "public_layer")
    } else if (filterMode === "layer") {
      list = list.filter((r) => r.define_table_schema !== "public_layer")
      if (!styleLoading) {
        list = list.filter((r) => !rowHasInfraError(r.define_table_name, styleInfoMap))
      }
    } else if (filterMode === "error" && !styleLoading) {
      list = list.filter((r) => rowHasInfraError(r.define_table_name, styleInfoMap))
    }
    const q = debouncedSearch.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.define_table_group.toLowerCase().includes(q) ||
          r.define_table_name.toLowerCase().includes(q) ||
          r.define_table_kor_name.toLowerCase().includes(q)
      )
    }
    // 정렬: layer/SHP → layer/Excel → public_layer/SHP → public_layer/Excel → 그 외
    const sortRank = (r: LayerManagerRow) => {
      const isPublic = r.define_table_schema === "public_layer"
      const source = r.define_table_source.toLowerCase()
      if (!isPublic && source === "shp") return 0
      if (!isPublic && source === "excel") return 1
      if (isPublic && source === "shp") return 2
      if (isPublic && source === "excel") return 3
      return 4
    }
    return [...list].sort((a, b) => sortRank(a) - sortRank(b))
  }, [rows, filterMode, styleLoading, styleInfoMap, debouncedSearch])

  const categoryTotal = useMemo(() => {
    if (filterMode === "public_layer") {
      return rows.filter((r) => r.define_table_schema === "public_layer").length
    }
    if (filterMode === "layer") {
      return rows.filter(
        (r) =>
          r.define_table_schema !== "public_layer" &&
          (styleLoading || !rowHasInfraError(r.define_table_name, styleInfoMap))
      ).length
    }
    if (filterMode === "error") {
      return styleLoading ? 0 : rows.filter((r) => rowHasInfraError(r.define_table_name, styleInfoMap)).length
    }
    return rows.length
  }, [rows, filterMode, styleLoading, styleInfoMap])

  const categoryLabel = FILTER_OPTIONS.find((o) => o.value === filterMode)?.label ?? ""

  const displayedRows = useMemo(
    () => filteredRows.slice(0, displayCount),
    [filteredRows, displayCount]
  )

  const hasMoreDisplay = displayCount < filteredRows.length

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el || !hasMoreDisplay) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight - scrollTop - clientHeight < SCROLL_LOAD_THRESHOLD) {
      setDisplayCount((c) => Math.min(c + PAGE_SIZE, filteredRows.length))
    }
  }, [hasMoreDisplay, filteredRows.length])

  useEffect(() => {
    setDisplayCount(PAGE_SIZE)
  }, [debouncedSearch, filterMode])

  if (loading) return <p className="text-sm text-muted-foreground p-2">로딩 중...</p>
  if (error && rows.length === 0) return <p className="text-sm text-destructive p-2">{error}</p>

  return (
    <div className="flex flex-col gap-3 p-2 min-h-0 h-full">
      <div className="flex items-center gap-3 flex-nowrap shrink-0 overflow-x-auto">
        <Input
          placeholder="그룹명·테이블명·한글명 검색"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 w-56 rounded-md text-sm"
        />
        <div className="flex items-center gap-1 rounded-md border p-0.5">
              {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.value === "error" && styleLoading}
              onClick={() => setFilterMode(opt.value)}
                  className={`h-6 rounded-sm px-2 text-xs leading-none whitespace-nowrap transition-colors disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                filterMode === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          {categoryLabel} 총 {categoryTotal}개 중 {filteredRows.length}개
          {displayCount < filteredRows.length && (
            <span className="text-xs text-muted-foreground ml-1">(표시: {displayedRows.length})</span>
          )}
        </span>
      </div>

      {error && <span className="text-sm text-destructive">{error}</span>}

      {filteredRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">표시할 레이어가 없습니다.</p>
      ) : (
        <div
          ref={parentRef}
          onScroll={handleScroll}
          className="flex-1 min-h-[400px] max-h-[73vh] overflow-auto border rounded-none bg-muted/20"
        >
          <div className="sticky top-0 z-10 bg-muted border-b">
            <div className="flex border-b">
              {TABLE_COLUMNS.map((col, i) => (
                <div
                  key={col.id}
                  className={`py-1 px-1 text-xs font-medium border-r bg-muted flex items-center ${i === TABLE_COLUMNS.length - 1 ? "border-r-0" : ""} ${col.kind === "field" && col.alignCenter ? "justify-center text-center" : ""} ${col.kind === "infra_status" || col.kind === "row_actions" || col.kind === "updated_at" || col.kind === "style_legend" ? "justify-center text-center" : ""} ${col.width === "flex" ? "min-w-0" : "whitespace-nowrap"}`}
                  style={getColumnStyle(col)}
                >
                  {col.label}
                </div>
              ))}
            </div>
          </div>

          <div className="w-full">
            {displayedRows.map((row) => {
              const tableName = row.define_table_name
              const styleKey = tableName.toLowerCase()
              const styleInfo = tableName ? styleInfoMap[styleKey] : undefined
              const published = styleInfo?.published ?? false
              const hasCssStyle = styleInfo?.hasCssStyle ?? false
              const styleName = styleInfo?.styleName
              const canShowLegend = hasCssStyle || published
              const updatedAt = updateDateMap[styleKey] ?? null
              const sourceLower = row.define_table_source.toLowerCase()
              const isExcelSource = sourceLower === "excel"
              const actionBusy = downloadingShp !== null || downloadingExcel !== null

              return (
                <div
                  key={row.rowKey}
                  className="flex border-b hover:bg-green-50/30 dark:hover:bg-green-950/10"
                >
                  {TABLE_COLUMNS.map((col, colIndex) => {
                    const isLast = colIndex === TABLE_COLUMNS.length - 1
                    const cellClass = `py-0 px-1 overflow-hidden border-r flex items-center min-h-[28px] min-w-0 ${isLast ? "border-r-0" : ""}`
                    const cellStyle = getColumnStyle(col)

                    if (col.kind === "infra_status") {
                      const ok =
                        col.infraKey === "table"
                          ? true
                          : col.infraKey === "layer"
                            ? published
                            : hasCssStyle
                      const isTableCol = col.infraKey === "table"
                      return (
                        <div
                          key={col.id}
                          className={`${cellClass} justify-center ${isTableCol ? "cursor-pointer hover:bg-muted/50" : ""}`}
                          style={cellStyle}
                          role={isTableCol ? "button" : undefined}
                          tabIndex={isTableCol ? 0 : undefined}
                          title={
                            isTableCol
                              ? "테이블 삭제"
                              : col.infraKey === "layer"
                                ? published
                                  ? "레이어 있음"
                                  : "레이어 없음"
                                : hasCssStyle
                                  ? "스타일 있음"
                                  : "스타일 없음"
                          }
                          onClick={
                            isTableCol
                              ? () => {
                                  cancelEdit()
                                  setDropTarget(row)
                                }
                              : undefined
                          }
                          onKeyDown={
                            isTableCol
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault()
                                    cancelEdit()
                                    setDropTarget(row)
                                  }
                                }
                              : undefined
                          }
                        >
                          <OkIcon ok={ok} loading={!isTableCol && styleLoading} />
                        </div>
                      )
                    }
                    if (col.kind === "updated_at") {
                      return (
                        <div
                          key={col.id}
                          className={`${cellClass} justify-center`}
                          style={cellStyle}
                          title={updatedAt ?? undefined}
                        >
                          <span className="text-xs text-muted-foreground whitespace-nowrap truncate max-w-full">
                            {metaLoading ? "…" : formatUpdatedAt(updatedAt)}
                          </span>
                        </div>
                      )
                    }
                    if (col.kind === "row_actions") {
                      return (
                        <div
                          key={col.id}
                          className={`${cellClass} justify-center gap-0.5`}
                          style={cellStyle}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={actionBusy}
                            onClick={() => void handleShpDownload(row)}
                            title="SHP 다운로드"
                          >
                            {downloadingShp === tableName ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={actionBusy}
                            onClick={() => void handleExcelDownload(row)}
                            title={
                              isExcelSource
                                ? "Excel 원본 (없으면 CSV)"
                                : "CSV 다운로드 (DB)"
                            }
                          >
                            {downloadingExcel === tableName ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() =>
                              setHistoryTarget({
                                tableName,
                                korName: row.define_table_kor_name,
                              })
                            }
                            title="수정 이력 조회"
                          >
                            <History className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )
                    }
                    if (col.kind === "style_legend") {
                      const legendUrl = tableName
                        ? getLegendGraphicUrl(tableName, styleName ?? undefined, styleVersion)
                        : ""
                      const fallbackKey = (styleName || tableName || "").toLowerCase()
                      const fallbackState = fallbackKey ? cssFallbackMap[fallbackKey] : undefined
                      return (
                        <div key={col.id} className={`${cellClass} justify-center`} style={cellStyle}>
                          <StyleLegendThumb
                            key={`${tableName}-${styleVersion}`}
                            tableName={tableName}
                            shpType={row.define_table_shp_type}
                            legendUrl={legendUrl}
                            canShowLegend={canShowLegend}
                            fallbackState={fallbackState}
                            cacheBust={styleVersion}
                            onNeedCssFallback={() => {
                              if (!fallbackKey) return
                              if (hasCssStyle) loadCssFallback(fallbackKey)
                              else setCssFallbackMap((prev) => ({ ...prev, [fallbackKey]: "error" }))
                            }}
                          />
                        </div>
                      )
                    }

                    if (col.kind !== "field") return null

                    const text = fieldDisplayText(col, row)
                    const isSchema = col.fieldKey === "define_table_schema"
                    const isSource = col.fieldKey === "define_table_source"
                    const editable = isEditableNameField(col.fieldKey)
                    const editing =
                      editable &&
                      editTarget?.rowKey === row.rowKey &&
                      editTarget.field === col.fieldKey
                    return (
                      <div
                        key={col.id}
                        className={`${cellClass} ${col.alignCenter ? "justify-center text-center" : ""} ${isSchema || isSource ? "justify-center" : ""}`}
                        style={cellStyle}
                      >
                        {isSchema ? (
                          <SchemaBadge value={String(row.define_table_schema ?? "")} />
                        ) : isSource ? (
                          <SourceBadge value={String(row.define_table_source ?? "")} />
                        ) : editing ? (
                          <div className="flex items-center gap-0.5 min-w-0 w-full">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="h-6 rounded-none text-sm min-w-0 py-0 px-1"
                              autoFocus
                              disabled={editSaving}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault()
                                  void saveEdit()
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault()
                                  cancelEdit()
                                }
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 shrink-0"
                              disabled={editSaving}
                              title="저장"
                              onClick={() => void saveEdit()}
                            >
                              {editSaving ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-green-600" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 shrink-0"
                              disabled={editSaving}
                              title="취소"
                              onClick={cancelEdit}
                            >
                              <X className="w-3.5 h-3.5 text-muted-foreground" />
                            </Button>
                          </div>
                        ) : editable ? (
                          <button
                            type="button"
                            className={`block min-w-0 w-full truncate text-sm py-1 text-left hover:bg-muted/40 rounded-sm px-0.5 ${col.alignCenter ? "text-center" : ""}`}
                            title={`${text} (클릭하여 수정)`}
                            onClick={() => {
                              if (isEditableNameField(col.fieldKey)) startEdit(row, col.fieldKey)
                            }}
                          >
                            {text}
                          </button>
                        ) : (
                          <span
                            className={`block min-w-0 w-full truncate text-sm py-1 ${col.fieldKey === "define_table_name" ? "font-mono" : ""}`}
                            title={text}
                          >
                            {text}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {hasMoreDisplay && (
            <div className="py-1 text-center text-xs text-muted-foreground border-t">
              아래로 스크롤하면 더 불러옵니다 ({displayedRows.length} / {filteredRows.length})
            </div>
          )}
        </div>
      )}

      <LayerManagerRowHistoryDialog
        open={!!historyTarget}
        tableName={historyTarget?.tableName ?? ""}
        korName={historyTarget?.korName}
        onClose={() => setHistoryTarget(null)}
      />

      <Dialog
        open={!!dropTarget}
        onOpenChange={(open) => {
          if (dropping) return
          if (!open) setDropTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테이블 삭제</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm">해당 테이블을 삭제하시겠습니까?</p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="text-muted-foreground"
              disabled={dropping}
              onClick={() => setDropTarget(null)}
            >
              아니오
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-destructive/90 hover:bg-destructive/10"
              disabled={dropping}
              onClick={() => void confirmDropTable()}
            >
              {dropping ? "삭제 중..." : "예"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
