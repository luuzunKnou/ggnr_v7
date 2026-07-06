"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { Save, RotateCcw, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { SchemaBadge, SourceBadge } from "./layerManager/defineBadges"
import { call } from "@/lib/api"
import type { GeometryType } from "@/lib/geoserverStyleUtils"
import type { StyleProps } from "@/lib/geoserverStyleUtils"

const GEOSERVER_DEFAULT_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8080/geoserver`
    : "http://localhost:8080/geoserver"

const GEOMETRY_TYPES: { value: GeometryType; label: string }[] = [
  { value: "POINT", label: "POINT" },
  { value: "LINE", label: "LINE" },
  { value: "POLYGON", label: "POLYGON" },
]

const defaultStyleProps: StyleProps = {
  fillColor: "#808080",
  strokeColor: "#000000",
  strokeWidth: 1,
  opacity: 1,
  labelField: "",
  size: 8,
}

type DefineLayerTable = Record<string, unknown> & { fields?: unknown[] }
type DefineLayerConfig = { version?: string; generatedAt?: string; tables: DefineLayerTable[] }

/** 테이블 컬럼 정의: 순서·타이틀·너비 통일 (정보 필드 + 스타일 컬럼) */
type TableColumnDef =
  | {
      id: string
      label: string
      width: string
      kind: "field"
      readonly?: boolean
      alignCenter?: boolean
      shapeType?: boolean
      share?: "read" | "write"
      badge?: "schema" | "source"
    }
  | { id: string; label: string; width: string; kind: "style_legend" }
  | { id: string; label: string; width: string; kind: "layer_delete" }

const GEOSERVER_WORKSPACE = "ggnr"

/** GeoServer WMS GetLegendGraphic URL (범례 이미지) */
function getLegendGraphicUrl(layerName: string, styleName?: string): string {
  const base = GEOSERVER_DEFAULT_URL
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetLegendGraphic",
    VERSION: "1.0.0",
    LAYER: `${GEOSERVER_WORKSPACE}:${layerName}`,
    STYLE: styleName?.trim() || layerName,
    FORMAT: "image/png",
    WIDTH: "32",
    HEIGHT: "32",
  })
  return `${base}/wms?${params.toString()}`
}

const TABLE_COLUMNS: TableColumnDef[] = [
  { id: "define_table_schema", label: "스키마", width: "92px", kind: "field", badge: "schema" },
  { id: "define_table_source", label: "출처", width: "64px", kind: "field", badge: "source" },
  { id: "define_table_group", label: "그룹", width: "130px", kind: "field" },
  { id: "define_table_name", label: "테이블명", width: "flex", kind: "field", readonly: true },
  { id: "define_table_kor_name", label: "한글명", width: "flex", kind: "field" },
  { id: "__style_legend", label: "스타일", width: "80px", kind: "style_legend" },
  { id: "define_table_idx", label: "순서", width: "50px", kind: "field", alignCenter: true },
  { id: "define_table_shp_type", label: "도형", width: "120px", kind: "field", shapeType: true },
  { id: "define_table_read_share", label: "읽기", width: "70px", kind: "field", share: "read" },
  { id: "define_table_write_share", label: "쓰기", width: "70px", kind: "field", share: "write" },
  { id: "__layer_delete", label: "삭제", width: "56px", kind: "layer_delete" },
  //{ id: "define_table_etc", label: "비고", width: "flex", kind: "field" },
]

/** px 컬럼은 고정 너비, "flex"는 남은 공간을 1:1로 채움 */
function getColumnStyle(col: Pick<TableColumnDef, "id" | "width">): React.CSSProperties {
  if (col.width === "flex") {
    return { flex: 1, minWidth: 0, flexShrink: 1 }
  }
  return { width: col.width, flexShrink: 0 }
}

const TABLE_KEYS = TABLE_COLUMNS.filter((c): c is TableColumnDef & { kind: "field" } => c.kind === "field").map(
  (c) => c.id
)

const SHAPE_TYPE_OPTIONS = ["POLYGON", "LINE", "POINT"] as const
const SHARE_OPTIONS = [
  { label: "전체", value: "P" },
  { label: "부서", value: "G" },
  { label: "개인", value: "O" },
] as const

const PAGE_SIZE = 50
const SCROLL_LOAD_THRESHOLD = 200

type LayerInfoManagerProps = {
  embedded?: boolean
  fixedTableKey?: string | null
  fixedSchema?: string | null
}

export function LayerInfoManager({
  embedded = false,
  fixedTableKey = null,
  fixedSchema = null,
}: LayerInfoManagerProps = {}) {
  const [config, setConfig] = useState<DefineLayerConfig | null>(null)
  const [total, setTotal] = useState(0)
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showPublicLayer, setShowPublicLayer] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)

  // 스타일: GeoServer 레이어별 스타일 보유 여부 (테이블명 기준)
  const [styleInfoMap, setStyleInfoMap] = useState<
    Record<string, { tableExists?: boolean; published?: boolean; hasCssStyle: boolean; styleName?: string }>
  >({})
  const [styleLoading, setStyleLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [targetLayerName, setTargetLayerName] = useState<string | null>(null)
  const [targetStyleName, setTargetStyleName] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [layerDefineDeleteOpen, setLayerDefineDeleteOpen] = useState(false)
  const [layerDefineDeleteTarget, setLayerDefineDeleteTarget] = useState<{
    tableName: string
    schema: string
  } | null>(null)
  const [attrDeleteOpen, setAttrDeleteOpen] = useState(false)
  const [attrDeleteTarget, setAttrDeleteTarget] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formGeometryType, setFormGeometryType] = useState<GeometryType>("POLYGON")
  const [formProps, setFormProps] = useState<StyleProps>(defaultStyleProps)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editEditable, setEditEditable] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [autoApplyLoading, setAutoApplyLoading] = useState(false)

  const loadFullList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/config/defineLayer")
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) {
        const text = await res.text()
        setError(res.ok ? "응답이 JSON이 아닙니다." : `요청 실패 (${res.status}): ${text.slice(0, 100)}`)
        return
      }
      const body = await res.json()
      if (body.success && body.data) {
        setConfig({ tables: body.data })
        setTotal(Array.isArray(body.data) ? body.data.length : 0)
        setDisplayCount(PAGE_SIZE)
      } else {
        setError(body.error ?? "설정을 불러올 수 없습니다.")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "설정을 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFullList()
  }, [loadFullList])

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
        const map: Record<string, { tableExists?: boolean; published?: boolean; hasCssStyle: boolean; styleName?: string }> = {}
        for (const layer of data.layers) {
          if (layer.name) {
            map[layer.name] = {
              tableExists: layer.tableExists ?? false,
              published: layer.published ?? false,
              hasCssStyle: layer.hasCssStyle ?? false,
              styleName: layer.styleName,
            }
          }
        }
        setStyleInfoMap(map)
      }
    } catch {
      // 스타일 정보 실패해도 정보 테이블은 유지
    } finally {
      setStyleLoading(false)
    }
  }, [])

  useEffect(() => {
    if (config?.tables?.length) {
      loadStyleInfo()
    }
  }, [config?.tables?.length, loadStyleInfo])

  // 디바운싱: 검색어 입력 후 300ms 대기
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const filteredTables = useMemo(() => {
    if (!config?.tables) return []
    let list = [...config.tables]
    if (embedded && fixedTableKey) {
      const key = fixedTableKey.trim().toLowerCase()
      const schema = fixedSchema?.trim() || null
      return list.filter((t) => {
        const name = String((t as Record<string, unknown>).define_table_name ?? "")
          .trim()
          .toLowerCase()
        const tSchema = String((t as Record<string, unknown>).define_table_schema ?? "layer").trim()
        if (name !== key) return false
        if (schema && tSchema !== schema) return false
        return true
      })
    }
    if (!showPublicLayer) {
      list = list.filter(
        (t) => String((t as Record<string, unknown>).define_table_schema ?? "layer") !== "public_layer"
      )
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase()
      list = list.filter(
        (t) =>
          String((t as Record<string, unknown>).define_table_group ?? "").toLowerCase().includes(q) ||
          String((t as Record<string, unknown>).define_table_name ?? "").toLowerCase().includes(q) ||
          String((t as Record<string, unknown>).define_table_kor_name ?? "").toLowerCase().includes(q)
      )
    }
    return list
  }, [
    config?.tables,
    embedded,
    fixedTableKey,
    fixedSchema,
    debouncedSearch,
    showPublicLayer,
  ])

  const displayedTables = useMemo(
    () => filteredTables.slice(0, displayCount),
    [filteredTables, displayCount]
  )
  const hasMoreDisplay = displayCount < filteredTables.length

  useEffect(() => {
    setDisplayCount(PAGE_SIZE)
  }, [showPublicLayer, debouncedSearch])

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_LOAD_THRESHOLD) {
      setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, filteredTables.length))
    }
  }, [filteredTables.length])

  const updateCell = useCallback(
    (tableIndex: number, key: string, value: string) => {
      if (!config) return
      const next = { ...config, tables: [...config.tables] }
      const row = next.tables[tableIndex] as Record<string, unknown>
      next.tables[tableIndex] = { ...row, [key]: value }
      setConfig(next)
    },
    [config]
  )

  const saveConfig = useCallback(async () => {
    if (!config) return
    setSaving(true)
    setSuccessMsg(null)
    setError(null)
    try {
      const fullRes = await fetch("/api/config/defineLayer")
      const fullBody = await fullRes.json()
      let fullTables: DefineLayerTable[] =
        fullBody.success && Array.isArray(fullBody.data) ? fullBody.data : []
      const byKey = new Map<string, DefineLayerTable>()
      for (const t of config.tables) {
        const key = String((t as Record<string, unknown>).define_table_name ?? "")
        if (key) byKey.set(key, t)
      }
      fullTables = fullTables.map((t) => {
        const key = String((t as Record<string, unknown>).define_table_name ?? "")
        return (byKey.get(key) ?? t) as DefineLayerTable
      })
      // 저장 전 동일 정렬(그룹→순서→이름) 적용해 파일 순서 유지
      fullTables = fullTables.sort((a, b) => {
        const rowA = a as Record<string, unknown>
        const rowB = b as Record<string, unknown>
        const groupA = String(rowA.define_table_group ?? "").toLowerCase()
        const groupB = String(rowB.define_table_group ?? "").toLowerCase()
        if (groupA !== groupB) return groupA.localeCompare(groupB)
        const idxA = parseInt(String(rowA.define_table_idx ?? "999999"), 10)
        const idxB = parseInt(String(rowB.define_table_idx ?? "999999"), 10)
        if (idxA !== idxB) return idxA - idxB
        const nameA = String(rowA.define_table_name ?? "").toLowerCase()
        const nameB = String(rowB.define_table_name ?? "").toLowerCase()
        return nameA.localeCompare(nameB)
      })
      const res = await fetch("/api/config/defineLayer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: fullTables }),
      })
      const body = await res.json()
      if (body.success) setSuccessMsg("저장되었습니다.")
      else setError(body.error ?? "저장에 실패했습니다.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }, [config])

  const openAdd = useCallback((layerName: string, shpType?: string) => {
    setTargetLayerName(layerName)
    setFormName(layerName)
    const geom: GeometryType =
      shpType === "POINT" || shpType === "LINE" || shpType === "POLYGON"
        ? (shpType as GeometryType)
        : "POLYGON"
    setFormGeometryType(geom)
    setFormProps({ ...defaultStyleProps })
    setFormError(null)
    setAddOpen(true)
  }, [])

  const openEdit = useCallback(async (layerName: string, styleName: string) => {
    setTargetLayerName(layerName)
    setTargetStyleName(styleName)
    setFormError(null)
    setEditOpen(true)
    setFormSaving(false)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "getGeoServerStyle",
        params: { url: GEOSERVER_DEFAULT_URL, name: styleName },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setFormError(data?.error ?? "스타일 조회 실패")
        setEditEditable(false)
        return
      }
      setEditEditable(!!data.editable)
      if (data.editable && data.styleProps) {
        setFormProps({ ...defaultStyleProps, ...data.styleProps })
        setFormGeometryType((data.geometryType as GeometryType) ?? "POLYGON")
      }
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "조회 실패")
      setEditEditable(false)
    }
  }, [])

  const openLayerDefineDelete = useCallback((tableName: string, schema: string) => {
    setLayerDefineDeleteTarget({ tableName, schema })
    setLayerDefineDeleteOpen(true)
  }, [])

  const handleLayerDefineDeleteConfirm = useCallback(async () => {
    if (!layerDefineDeleteTarget || !config) return
    const { tableName, schema } = layerDefineDeleteTarget
    setActionLoading(tableName)
    setError(null)
    try {
      const fieldsRes = await fetch(
        `/api/config/defineLayer/fields/${encodeURIComponent(tableName)}`
      )
      const fieldsBody = await fieldsRes.json()
      const fields: Record<string, unknown>[] =
        fieldsBody?.success && Array.isArray(fieldsBody.data) ? fieldsBody.data : []

      for (const f of fields) {
        if (String(f.define_field_type ?? "").toUpperCase() !== "CODE") continue
        const fieldName = String(f.define_field_name ?? "").trim()
        if (!fieldName) continue
        const codeKey = `${tableName}__${fieldName}`
        await fetch(`/api/config/defineLayer/codes/${encodeURIComponent(codeKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: [] }),
        })
      }

      await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(tableName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [] }),
      })

      const nextTables = config.tables.filter((t) => {
        const name = String((t as Record<string, unknown>).define_table_name ?? "").trim()
        const tSchema = String((t as Record<string, unknown>).define_table_schema ?? "layer").trim()
        return !(name === tableName && tSchema === schema)
      })
      const saveRes = await fetch("/api/config/defineLayer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextTables }),
      })
      const saveBody = await saveRes.json()
      if (!saveBody?.success) {
        setError(saveBody?.error ?? "레이어 설정 삭제 실패")
        return
      }

      setConfig({ ...config, tables: nextTables })
      setTotal(nextTables.length)
      setLayerDefineDeleteOpen(false)
      setLayerDefineDeleteTarget(null)
      setSuccessMsg(`"${tableName}" 레이어·필드·코드 정의가 삭제되었습니다.`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "레이어 설정 삭제 실패")
    } finally {
      setActionLoading(null)
    }
  }, [config, layerDefineDeleteTarget])

  const openStyleEditor = useCallback(
    (layerName: string, shpType: string, hasCssStyle: boolean, styleName?: string) => {
      if (hasCssStyle && styleName) {
        void openEdit(layerName, styleName)
      } else {
        openAdd(layerName, shpType || undefined)
      }
    },
    [openAdd, openEdit]
  )

  const openDelete = useCallback((layerName: string) => {
    setDeleteTarget(layerName)
    setDeleteOpen(true)
  }, [])

  const handleAddSubmit = useCallback(async () => {
    const name = formName.trim() || targetLayerName?.trim()
    if (!name) {
      setFormError("스타일 이름이 필요합니다.")
      return
    }
    setFormSaving(true)
    setFormError(null)
    try {
      const createRes = await call("", "POST", {
        service: "devTestService",
        action: "createGeoServerStyle",
        params: {
          url: GEOSERVER_DEFAULT_URL,
          name,
          geometryType: formGeometryType,
          styleProps: formProps,
        },
      })
      const createData = createRes?.data ?? createRes
      if (!createData?.success) {
        setFormError(createData?.error ?? "스타일 생성 실패")
        setFormSaving(false)
        return
      }
      const setRes = await call("", "POST", {
        service: "devTestService",
        action: "setLayerDefaultStyle",
        params: {
          url: GEOSERVER_DEFAULT_URL,
          layerName: targetLayerName,
          styleName: name,
        },
      })
      const setData = setRes?.data ?? setRes
      if (setData?.success) {
        setAddOpen(false)
        setTargetLayerName(null)
        setSuccessMsg(`레이어 "${targetLayerName}"에 스타일이 적용되었습니다.`)
        loadStyleInfo()
      } else {
        setFormError(setData?.error ?? "레이어에 스타일 지정 실패")
      }
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "처리 실패")
    } finally {
      setFormSaving(false)
    }
  }, [formName, formGeometryType, formProps, targetLayerName, loadStyleInfo])

  const handleEditSubmit = useCallback(async () => {
    if (!targetStyleName || !editEditable) return
    setFormSaving(true)
    setFormError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "updateGeoServerStyle",
        params: {
          url: GEOSERVER_DEFAULT_URL,
          name: targetStyleName,
          geometryType: formGeometryType,
          styleProps: formProps,
          preserveExtraRules: true,
        },
      })
      const data = res?.data ?? res
      if (data?.success) {
        setEditOpen(false)
        setTargetStyleName(null)
        setTargetLayerName(null)
        setSuccessMsg(`스타일 "${targetStyleName}"이(가) 수정되었습니다.`)
        loadStyleInfo()
      } else {
        setFormError(data?.error ?? "수정 실패")
      }
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "수정 실패")
    } finally {
      setFormSaving(false)
    }
  }, [targetStyleName, editEditable, formGeometryType, formProps, loadStyleInfo])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setActionLoading(deleteTarget)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "deleteLayerStyle",
        params: { url: GEOSERVER_DEFAULT_URL, layerName: deleteTarget },
      })
      const data = res?.data ?? res
      if (data?.success) {
        setDeleteOpen(false)
        setDeleteTarget(null)
        setSuccessMsg(`"${deleteTarget}" 스타일이 삭제되었습니다.`)
        loadStyleInfo()
      } else {
        setError(data?.error ?? "삭제 실패")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "삭제 실패")
    } finally {
      setActionLoading(null)
    }
  }, [deleteTarget, loadStyleInfo])

  const handleAutoApplyOne = useCallback(async (layerName: string) => {
    setActionLoading(layerName)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "applyDefaultStyleToLayer",
        params: { url: GEOSERVER_DEFAULT_URL, layerName },
      })
      const data = res?.data ?? res
      if (data?.success) {
        setSuccessMsg(`"${layerName}"에 자동 스타일이 적용되었습니다.`)
        loadStyleInfo()
      } else {
        setError(data?.error ?? "자동 설정 실패")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "자동 설정 실패")
    } finally {
      setActionLoading(null)
    }
  }, [loadStyleInfo])

  const handleAttrAutoApplyOne = useCallback(async (layerName: string) => {
    setActionLoading(layerName)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "applyDefaultAttributesToLayer",
        params: { layerName },
      })
      const data = res?.data ?? res
      if (data?.success) {
        setSuccessMsg(`"${layerName}" 속성 자동설정이 완료되었습니다.`)
      } else {
        setError(data?.error ?? "속성 자동설정 실패")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "속성 자동설정 실패")
    } finally {
      setActionLoading(null)
    }
  }, [])

  const openAttrDelete = useCallback((tableName: string) => {
    setAttrDeleteTarget(tableName)
    setAttrDeleteOpen(true)
  }, [])

  const handleAttrDeleteConfirm = useCallback(async () => {
    if (!attrDeleteTarget) return
    setActionLoading(attrDeleteTarget)
    setError(null)
    try {
      const res = await fetch(
        `/api/config/defineLayer/fields/${encodeURIComponent(attrDeleteTarget)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: [] }) }
      )
      const data = await res.json()
      if (data?.success) {
        setAttrDeleteOpen(false)
        setAttrDeleteTarget(null)
        setSuccessMsg(`"${attrDeleteTarget}" 속성 정의가 삭제되었습니다.`)
      } else {
        setError(data?.error ?? "속성 삭제 실패")
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "속성 삭제 실패")
    } finally {
      setActionLoading(null)
    }
  }, [attrDeleteTarget])

  const handleAutoApply = useCallback(async () => {
    setAutoApplyLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "applyAllDefaultStyles",
        params: { url: GEOSERVER_DEFAULT_URL },
      })
      const data = res?.data ?? res
      if (data?.success) {
        const n = (data.applied ?? []).length
        setSuccessMsg(`스타일 없음 레이어 ${n}개에 자동 스타일이 적용되었습니다.`)
        loadStyleInfo()
      } else {
        const applied = (data.applied ?? []).length
        const failed = (data.failed ?? []).length
        setSuccessMsg(`적용: ${applied}개, 실패: ${failed}개. ${data.error ?? ""}`)
        loadStyleInfo()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "자동 스타일 적용 실패")
    } finally {
      setAutoApplyLoading(false)
    }
  }, [loadStyleInfo])

  const renderFormFields = useCallback((geometryType: GeometryType) => {
    const common = (
      <>
        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
          <label className="text-sm">선색상</label>
          <Input
            type="text"
            value={formProps.strokeColor ?? ""}
            onChange={(e) => setFormProps((p) => ({ ...p, strokeColor: e.target.value }))}
            placeholder="#000000"
          />
        </div>
        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
          <label className="text-sm">선두께</label>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={formProps.strokeWidth ?? 1}
            onChange={(e) =>
              setFormProps((p) => ({ ...p, strokeWidth: parseFloat(e.target.value) || 1 }))
            }
          />
        </div>
        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
          <label className="text-sm">투명도</label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={formProps.opacity ?? 1}
            onChange={(e) =>
              setFormProps((p) => ({ ...p, opacity: parseFloat(e.target.value) ?? 1 }))
            }
          />
        </div>
        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
          <label className="text-sm">라벨필드</label>
          <Input
            type="text"
            value={formProps.labelField ?? ""}
            onChange={(e) => setFormProps((p) => ({ ...p, labelField: e.target.value }))}
            placeholder="속성 필드명"
          />
        </div>
      </>
    )
    if (geometryType === "POINT") {
      return (
        <>
          <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
            <label className="text-sm">크기</label>
            <Input
              type="number"
              min={1}
              value={formProps.size ?? 8}
              onChange={(e) =>
                setFormProps((p) => ({ ...p, size: parseFloat(e.target.value) || 8 }))
              }
            />
          </div>
          <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
            <label className="text-sm">색상</label>
            <Input
              type="text"
              value={formProps.fillColor ?? ""}
              onChange={(e) => setFormProps((p) => ({ ...p, fillColor: e.target.value }))}
              placeholder="#808080"
            />
          </div>
          {common}
        </>
      )
    }
    if (geometryType === "LINE") {
      return common
    }
    return (
      <>
        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
          <label className="text-sm">색상</label>
          <Input
            type="text"
            value={formProps.fillColor ?? ""}
            onChange={(e) => setFormProps((p) => ({ ...p, fillColor: e.target.value }))}
            placeholder="#808080"
          />
        </div>
        {common}
      </>
    )
  }, [formProps])

  if (loading) return <p className="text-sm text-muted-foreground">로딩 중...</p>
  if (error && !config) return <p className="text-sm text-destructive">{error}</p>
  if (!config?.tables?.length) return <p className="text-sm text-muted-foreground">테이블이 없습니다.</p>
  if (embedded && fixedTableKey && filteredTables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-2">
        defineLayer에 이 레이어 설정이 없습니다. DB 테이블만 존재하는 상태입니다.
      </p>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3 p-2 min-h-0 h-full", embedded && "overflow-hidden")}>
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        {!embedded && (
          <>
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
              {filteredTables.length} / {total}
              {displayCount < filteredTables.length && (
                <span className="text-xs text-muted-foreground ml-1">
                  (표시: {displayedTables.length})
                </span>
              )}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {successMsg && <span className="text-sm text-green-600 dark:text-green-400">{successMsg}</span>}
          <Button variant="outline" size="sm" className="rounded-md" onClick={saveConfig} disabled={saving}>
            <Save className="w-4 h-4 mr-1.5 opacity-70" />
            {saving ? "저장 중..." : "저장"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-md"
            onClick={() => {
              setSearchQuery("")
              setDebouncedSearch("")
              setShowPublicLayer(false)
              void loadFullList()
            }}
          >
            <RotateCcw className="w-4 h-4 mr-1.5 opacity-70" />
            초기화
          </Button>
          {!embedded && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={() => {
                window.open("/api/config/defineLayer/export", "_blank")
              }}
            >
              <Download className="w-4 h-4 mr-1.5 opacity-70" />
              엑셀 다운로드
            </Button>
          )}
        </div>
      </div>

      {error && <span className="text-sm text-destructive">{error}</span>}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className={cn(
          "flex-1 min-h-0 overflow-auto border rounded-none bg-muted/20",
          embedded ? "max-h-none" : "min-h-[400px] max-h-[73vh]"
        )}
      >
        {/* 헤더 (고정) */}
        <div className="sticky top-0 z-10 bg-muted border-b">
          <div className="flex border-b">
            {TABLE_COLUMNS.map((col, i) => (
              <div
                key={col.id}
                className={`py-1 px-1 text-xs font-medium border-r bg-muted flex items-center ${i === TABLE_COLUMNS.length - 1 ? "border-r-0" : ""} ${col.kind === "field" && col.alignCenter ? "justify-center text-center" : ""} ${col.width === "flex" ? "min-w-0" : "whitespace-nowrap"}`}
                style={getColumnStyle(col)}
              >
                {col.label}
              </div>
            ))}
          </div>
        </div>

        {/* 테이블 행 목록 */}
        <div className="w-full">
          {displayedTables.map((t, listIndex) => {
            const tableIdx = config.tables.indexOf(t)
            if (tableIdx < 0) return null
            const row = t as Record<string, unknown>

            const tableName = String(row.define_table_name ?? "")
            const styleInfo = tableName ? styleInfoMap[tableName] : undefined
            const published = styleInfo?.published ?? false
            const hasCssStyle = styleInfo?.hasCssStyle ?? false
            const styleName = styleInfo?.styleName
            const shpType = String(row.define_table_shp_type ?? "")

            return (
              <div
                key={String(row.define_table_name ?? listIndex)}
                className="flex border-b hover:bg-green-50/30 dark:hover:bg-green-950/10"
              >
                {TABLE_COLUMNS.map((col, colIndex) => {
                  const isLast = colIndex === TABLE_COLUMNS.length - 1
                  const cellClass = `py-0 px-1 overflow-hidden border-r flex items-center min-h-[28px] min-w-0 ${isLast ? "border-r-0" : ""}`
                  const cellStyle = getColumnStyle(col)

                  if (col.kind === "style_legend") {
                    const canShowLegend = hasCssStyle || published
                    const legendUrl = tableName
                      ? getLegendGraphicUrl(tableName, styleName ?? undefined)
                      : ""
                    return (
                      <div
                        key={col.id}
                        role="button"
                        tabIndex={0}
                        className={`${cellClass} justify-center cursor-pointer hover:bg-muted/40`}
                        style={cellStyle}
                        title="클릭하여 스타일 수정"
                        onClick={() => openStyleEditor(tableName, shpType, hasCssStyle, styleName)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            openStyleEditor(tableName, shpType, hasCssStyle, styleName)
                          }
                        }}
                      >
                        {legendUrl && canShowLegend ? (
                          <img
                            src={legendUrl}
                            alt=""
                            className="max-h-7 max-w-full object-contain pointer-events-none"
                            onError={(e) => {
                              e.currentTarget.style.display = "none"
                              const fallback = e.currentTarget.nextElementSibling
                              if (fallback instanceof HTMLElement) fallback.style.display = "inline"
                            }}
                          />
                        ) : null}
                        <span
                          className="text-xs text-muted-foreground pointer-events-none"
                          style={{ display: legendUrl && canShowLegend ? "none" : "inline" }}
                        >
                          —
                        </span>
                      </div>
                    )
                  }
                  if (col.kind === "layer_delete") {
                    const schema = String(row.define_table_schema ?? "layer").trim()
                    return (
                      <div key={col.id} className={`${cellClass} justify-center`} style={cellStyle}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
                          disabled={actionLoading === tableName}
                          onClick={() => openLayerDefineDelete(tableName, schema)}
                        >
                          삭제
                        </Button>
                      </div>
                    )
                  }

                  const key = col.id
                  const val = String(row[key] ?? "")
                  return (
                    <div
                      key={col.id}
                      className={`${cellClass} ${col.alignCenter ? "justify-center text-center" : ""}`}
                      style={cellStyle}
                    >
                      {col.readonly ? (
                        <span className="block min-w-0 w-full truncate text-sm font-mono py-1" title={val}>
                          {val}
                        </span>
                      ) : col.badge === "schema" ? (
                        <SchemaBadge value={val} />
                      ) : col.badge === "source" ? (
                        <SourceBadge value={String(row.define_table_source ?? "")} />
                      ) : col.shapeType ? (
                        <select
                          value={val}
                          onChange={(e) => updateCell(tableIdx, key, e.target.value)}
                          className="h-6 w-full rounded-none text-sm font-mono border border-input bg-background py-0 px-1 min-w-0"
                        >
                          {!SHAPE_TYPE_OPTIONS.includes(val as (typeof SHAPE_TYPE_OPTIONS)[number]) && val ? (
                            <option value={val}>{val}</option>
                          ) : null}
                          {SHAPE_TYPE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : col.share ? (
                        <select
                          value={val}
                          onChange={(e) => updateCell(tableIdx, key, e.target.value)}
                          className="h-6 w-full rounded-none text-sm border border-input bg-background py-0 px-1 min-w-0"
                        >
                          {!SHARE_OPTIONS.some((opt) => opt.value === val) && val ? (
                            <option value={val}>{val}</option>
                          ) : null}
                          {SHARE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={val}
                          onChange={(e) => updateCell(tableIdx, key, e.target.value)}
                          className="h-6 rounded-none text-sm font-mono min-w-0 py-0 px-1"
                        />
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
            아래로 스크롤하면 더 불러옵니다 ({displayedTables.length} / {filteredTables.length})
          </div>
        )}
      </div>

      {/* 스타일 추가 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>스타일 추가: {targetLayerName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
              <label className="text-sm">스타일 이름</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="레이어와 동일"
              />
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
              <label className="text-sm">도형 타입</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={formGeometryType}
                onChange={(e) => setFormGeometryType(e.target.value as GeometryType)}
              >
                {GEOMETRY_TYPES.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            {renderFormFields(formGeometryType)}
          </div>
          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" className="text-muted-foreground" onClick={() => setAddOpen(false)}>
              취소
            </Button>
            <Button variant="secondary" onClick={handleAddSubmit} disabled={formSaving}>
              {formSaving ? "저장 중..." : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 스타일 수정 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>스타일 수정: {targetStyleName}</DialogTitle>
          </DialogHeader>
          {!editEditable ? (
            <p className="text-sm text-muted-foreground py-2">
              CSS 스타일만 간단 수정 가능합니다. 현재 스타일이 CSS가 아니거나 비어 있습니다.
            </p>
          ) : (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                <label className="text-sm">도형 타입</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={formGeometryType}
                  onChange={(e) => setFormGeometryType(e.target.value as GeometryType)}
                >
                  {GEOMETRY_TYPES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              {renderFormFields(formGeometryType)}
            </div>
          )}
          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" className="text-muted-foreground" onClick={() => setEditOpen(false)}>
              취소
            </Button>
            <Button variant="secondary" onClick={handleEditSubmit} disabled={formSaving || !editEditable}>
              {formSaving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 레이어·필드·코드 정의 전체 삭제 확인 */}
      <Dialog open={layerDefineDeleteOpen} onOpenChange={setLayerDefineDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>레이어 설정 삭제</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm">
            테이블 &quot;{layerDefineDeleteTarget?.tableName}&quot;의 레이어·필드·코드 정의를 모두 삭제합니다.
            GeoServer 스타일은 삭제되지 않습니다. 계속하시겠습니까?
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              className="text-muted-foreground"
              onClick={() => setLayerDefineDeleteOpen(false)}
            >
              취소
            </Button>
            <Button
              variant="outline"
              className="text-destructive/90 hover:bg-destructive/10"
              onClick={() => void handleLayerDefineDeleteConfirm()}
              disabled={!!actionLoading}
            >
              {actionLoading ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
