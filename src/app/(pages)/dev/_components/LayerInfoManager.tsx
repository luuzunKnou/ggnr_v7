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
    }
  | { id: string; label: string; width: string; kind: "table_status" }
  | { id: string; label: string; width: string; kind: "layer_status" }
  | { id: string; label: string; width: string; kind: "style_status" }
  | { id: string; label: string; width: string; kind: "attr_actions" }
  | { id: string; label: string; width: string; kind: "style_actions" }
  | { id: string; label: string; width: string; kind: "style_legend" }

const GEOSERVER_WORKSPACE = "ggnr"

/** GeoServer WMS GetLegendGraphic URL (범례 이미지) */
function getLegendGraphicUrl(layerName: string, styleName?: string): string {
  const base = GEOSERVER_DEFAULT_URL
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetLegendGraphic",
    VERSION: "1.0.0",
    LAYER: `${GEOSERVER_WORKSPACE}:${layerName}`,
    FORMAT: "image/png",
    WIDTH: "32",
    HEIGHT: "32",
  })
  if (styleName) params.set("STYLE", styleName)
  return `${base}/wms?${params.toString()}`
}

const TABLE_COLUMNS: TableColumnDef[] = [
  { id: "define_table_group", label: "그룹", width: "200px", kind: "field" },
  { id: "define_table_name", label: "테이블명", width: "200px", kind: "field", readonly: true },
  { id: "define_table_kor_name", label: "한글명", width: "200px", kind: "field" },
  { id: "__style_legend", label: "범례", width: "80px", kind: "style_legend" },
  { id: "define_table_idx", label: "순서", width: "50px", kind: "field", alignCenter: true },
  { id: "define_table_shp_type", label: "도형", width: "120px", kind: "field", shapeType: true },
  { id: "define_table_read_share", label: "읽기", width: "70px", kind: "field", share: "read" },
  { id: "define_table_write_share", label: "쓰기", width: "70px", kind: "field", share: "write" },
  { id: "__table_status", label: "테이블 상태", width: "100px", kind: "table_status" },
  { id: "__layer_status", label: "레이어 상태", width: "100px", kind: "layer_status" },
  { id: "__style_status", label: "스타일 상태", width: "110px", kind: "style_status" },
  { id: "__attr_actions", label: "속성", width: "120px", kind: "attr_actions" },
  { id: "__style_actions", label: "스타일", width: "160px", kind: "style_actions" },
  //{ id: "define_table_etc", label: "비고", width: "flex", kind: "field" },
]

/** px 컬럼은 고정 너비, "flex"는 남은 공간 채움 (스크롤 없이) */
function getColumnStyle(width: string): React.CSSProperties {
  if (width === "flex") {
    return { flex: 1, minWidth: 0, flexShrink: 1 }
  }
  return { width, flexShrink: 0 }
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

export function LayerInfoManager() {
  const [config, setConfig] = useState<DefineLayerConfig | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [searchName, setSearchName] = useState("")
  const [debouncedSearchName, setDebouncedSearchName] = useState("")
  const [searchGroup, setSearchGroup] = useState("")
  const [debouncedSearchGroup, setDebouncedSearchGroup] = useState("")
  const parentRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  loadingMoreRef.current = loadingMore
  hasMoreRef.current = hasMore

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

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/config/defineLayer?page=1&limit=${PAGE_SIZE}`
      )
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) {
        const text = await res.text()
        setError(res.ok ? "응답이 JSON이 아닙니다." : `요청 실패 (${res.status}): ${text.slice(0, 100)}`)
        return
      }
      const body = await res.json()
      if (body.success && body.data) {
        setConfig({ tables: body.data })
        setTotal(body.total ?? body.data.length)
        setPage(1)
        const more = (body.data?.length ?? 0) < (body.total ?? 0)
        setHasMore(more)
        hasMoreRef.current = more
      } else {
        setError(body.error ?? "설정을 불러올 수 없습니다.")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "설정을 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return
    if (!config?.tables?.length) return
    setLoadingMore(true)
    loadingMoreRef.current = true
    setError(null)
    try {
      const nextPage = page + 1
      const res = await fetch(
        `/api/config/defineLayer?page=${nextPage}&limit=${PAGE_SIZE}`
      )
      const body = await res.json()
      if (body.success && Array.isArray(body.data)) {
        if (body.data.length > 0) {
          setConfig((prev) =>
            prev ? { tables: [...prev.tables, ...body.data] } : prev
          )
          setPage(nextPage)
        }
        const newLen = config.tables.length + (body.data?.length ?? 0)
        const stillHasMore = newLen < (body.total ?? 0)
        setHasMore(stillHasMore)
        hasMoreRef.current = stillHasMore
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가 로드 실패")
    } finally {
      setLoadingMore(false)
      loadingMoreRef.current = false
    }
  }, [config, page])

  useEffect(() => {
    loadFirstPage()
  }, [loadFirstPage])

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

  // 스크롤 끝 근처에서 다음 페이지 로드 (loadMore 내부에서 ref로 중복 호출 방지)
  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_LOAD_THRESHOLD) {
      loadMore()
    }
  }, [loadMore])

  // 디바운싱: 검색어 입력 후 300ms 대기
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchName(searchName), 300)
    return () => clearTimeout(timer)
  }, [searchName])
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchGroup(searchGroup), 300)
    return () => clearTimeout(timer)
  }, [searchGroup])

  const filteredTables = useMemo(() => {
    if (!config?.tables) return []
    let list = [...config.tables]
    if (debouncedSearchGroup.trim()) {
      const g = debouncedSearchGroup.trim().toLowerCase()
      list = list.filter((t) =>
        String((t as Record<string, unknown>).define_table_group ?? "").toLowerCase().includes(g)
      )
    }
    if (debouncedSearchName.trim()) {
      const n = debouncedSearchName.trim().toLowerCase()
      list = list.filter(
        (t) =>
          String((t as Record<string, unknown>).define_table_name ?? "").toLowerCase().includes(n) ||
          String((t as Record<string, unknown>).define_table_kor_name ?? "").toLowerCase().includes(n)
      )
    }
    return list
  }, [config?.tables, debouncedSearchName, debouncedSearchGroup])

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <Button size="sm" className="rounded-none" onClick={saveConfig} disabled={saving}>
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? "저장 중..." : "저장"}
        </Button>
        <Button
          size="sm"
          className="rounded-none"
          onClick={() => {
            setSearchGroup("")
            setSearchName("")
            setDebouncedSearchGroup("")
            setDebouncedSearchName("")
          }}
        >
          <RotateCcw className="w-4 h-4 mr-1.5" />
          초기화
        </Button>
        <Button
          type="button"
          size="sm"
          className="rounded-none"
          onClick={handleAutoApply}
          disabled={autoApplyLoading || styleLoading}
        >
          {autoApplyLoading ? "적용 중..." : "전체 자동 스타일 설정"}
        </Button>
        <Button
          type="button"
          size="sm"
          className="rounded-none"
          variant="outline"
          onClick={() => {
            window.open("/api/config/defineLayer/export", "_blank")
          }}
        >
          <Download className="w-4 h-4 mr-1.5" />
          엑셀 다운로드
        </Button>
        {successMsg && <span className="text-sm text-green-600">{successMsg}</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
        <span className="text-sm text-muted-foreground">
          {config.tables.length} / {total}
        </span>
        <Input
          placeholder="그룹명 검색"
          value={searchGroup}
          onChange={(e) => setSearchGroup(e.target.value)}
          className="h-8 w-40 rounded-none text-sm"
        />
        <Input
          placeholder="테이블명/한글명 검색"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          className="h-8 w-48 rounded-none text-sm"
        />
      </div>
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="min-h-[400px] max-h-[73vh] overflow-auto border rounded-none bg-muted/20"
      >
        {/* 헤더 (고정) */}
        <div className="sticky top-0 z-10 bg-muted border-b">
          <div className="flex border-b">
            {TABLE_COLUMNS.map((col, i) => (
              <div
                key={col.id}
                className={`py-1 px-1 text-xs font-medium border-r bg-muted flex items-center ${i === TABLE_COLUMNS.length - 1 ? "border-r-0" : ""} ${col.kind === "field" && col.alignCenter ? "justify-center text-center" : ""} ${col.width === "flex" ? "min-w-0" : "whitespace-nowrap"}`}
                style={getColumnStyle(col.width)}
              >
                {col.label}
              </div>
            ))}
          </div>
        </div>

        {/* 테이블 행 목록 */}
        <div className="w-full">
          {filteredTables.map((t, listIndex) => {
            const tableIdx = config.tables.indexOf(t)
            if (tableIdx < 0) return null
            const row = t as Record<string, unknown>

            const tableName = String(row.define_table_name ?? "")
            const styleInfo = tableName ? styleInfoMap[tableName] : undefined
            const tableExists = styleInfo?.tableExists ?? false
            const published = styleInfo?.published ?? false
            const hasCssStyle = styleInfo?.hasCssStyle ?? false
            const styleName = styleInfo?.styleName
            const shpType = String(row.define_table_shp_type ?? "")

            return (
              <div
                key={String(row.define_table_name ?? listIndex)}
                className={`flex border-b hover:bg-muted/50 ${hasCssStyle ? "bg-green-50/30 dark:bg-green-950/10" : ""}`}
              >
                {TABLE_COLUMNS.map((col, colIndex) => {
                  const isLast = colIndex === TABLE_COLUMNS.length - 1
                  const cellClass = `py-0 px-1 overflow-hidden border-r flex items-center min-h-[28px] min-w-0 ${isLast ? "border-r-0" : ""}`
                  const cellStyle = getColumnStyle(col.width)

                  if (col.kind === "table_status") {
                    return (
                      <div key={col.id} className={cellClass} style={cellStyle}>
                        {styleLoading ? (
                          <span className="text-xs text-muted-foreground">...</span>
                        ) : (
                          <span
                            className={
                              tableExists
                                ? "inline-flex items-center rounded-md bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 px-2 py-0.5 text-xs font-medium"
                                : "inline-flex items-center rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-xs font-medium"
                            }
                          >
                            {tableExists ? "테이블 있음" : "테이블 없음"}
                          </span>
                        )}
                      </div>
                    )
                  }
                  if (col.kind === "layer_status") {
                    return (
                      <div key={col.id} className={cellClass} style={cellStyle}>
                        {styleLoading ? (
                          <span className="text-xs text-muted-foreground">...</span>
                        ) : (
                          <span
                            className={
                              published
                                ? "inline-flex items-center rounded-md bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 px-2 py-0.5 text-xs font-medium"
                                : "inline-flex items-center rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-xs font-medium"
                            }
                          >
                            {published ? "레이어 있음" : "레이어 없음"}
                          </span>
                        )}
                      </div>
                    )
                  }
                  if (col.kind === "style_status") {
                    return (
                      <div key={col.id} className={cellClass} style={cellStyle}>
                        {styleLoading ? (
                          <span className="text-xs text-muted-foreground">...</span>
                        ) : (
                          <span
                            className={
                              hasCssStyle
                                ? "inline-flex items-center rounded-md bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 px-2 py-0.5 text-xs font-medium"
                                : "inline-flex items-center rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-xs font-medium"
                            }
                          >
                            {hasCssStyle ? "스타일 있음" : "스타일 없음"}
                          </span>
                        )}
                      </div>
                    )
                  }
                  if (col.kind === "style_legend") {
                    const legendUrl = tableName
                      ? getLegendGraphicUrl(tableName, styleName ?? undefined)
                      : ""
                    return (
                      <div key={col.id} className={`${cellClass} justify-center`} style={cellStyle}>
                        {legendUrl ? (
                          <img
                            src={legendUrl}
                            alt=""
                            className="max-h-7 max-w-full object-contain"
                            title={`${tableName} 범례`}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    )
                  }
                  if (col.kind === "attr_actions") {
                    return (
                      <div key={col.id} className={`${cellClass} gap-1 flex-wrap`} style={cellStyle}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2"
                          disabled={actionLoading === tableName}
                          onClick={() => handleAttrAutoApplyOne(tableName)}
                        >
                          자동
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2 text-red-600 hover:text-red-700 dark:text-red-400"
                          disabled={actionLoading === tableName}
                          onClick={() => openAttrDelete(tableName)}
                        >
                          삭제
                        </Button>
                      </div>
                    )
                  }
                  if (col.kind === "style_actions") {
                    return (
                      <div key={col.id} className={`${cellClass} gap-1 flex-wrap`} style={cellStyle}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() =>
                            hasCssStyle && styleName
                              ? openEdit(tableName, styleName)
                              : openAdd(tableName, shpType || undefined)
                          }
                        >
                          수정
                        </Button>
                        {!hasCssStyle && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2"
                            disabled={actionLoading === tableName}
                            onClick={() => handleAutoApplyOne(tableName)}
                          >
                            {actionLoading === tableName ? "적용 중..." : "자동"}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2 text-red-600 hover:text-red-700 dark:text-red-400"
                          disabled={actionLoading === tableName || !hasCssStyle}
                          onClick={() => openDelete(tableName)}
                          title={!hasCssStyle ? "스타일이 없습니다" : undefined}
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
                        <span className="block truncate text-sm font-mono py-1">{val}</span>
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
        {loadingMore && (
          <div className="py-2 text-center text-sm text-muted-foreground border-t">
            더 불러오는 중...
          </div>
        )}
        {!loadingMore && hasMore && total > config.tables.length && (
          <div className="py-1 text-center text-xs text-muted-foreground">
            아래로 스크롤하면 더 불러옵니다
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
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              취소
            </Button>
            <Button onClick={handleAddSubmit} disabled={formSaving}>
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
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              취소
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={formSaving || !editEditable}
            >
              {formSaving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 스타일 삭제 확인 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>스타일 삭제</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm">
            레이어 &quot;{deleteTarget}&quot;에 적용된 스타일을 삭제하고 기본 스타일로 바꿉니다. 계속하시겠습니까?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={!!actionLoading}
            >
              {actionLoading ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 속성 삭제 확인 */}
      <Dialog open={attrDeleteOpen} onOpenChange={setAttrDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>속성 삭제</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm">
            테이블 &quot;{attrDeleteTarget}&quot;의 속성 정의(필드 목록)를 삭제합니다. 계속하시겠습니까?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttrDeleteOpen(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleAttrDeleteConfirm}
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
