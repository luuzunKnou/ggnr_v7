"use client"

import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react"
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
import { requestLayerManagerListRefresh, registerLayerManagerDefineRefresh } from "./layerManager/layerManagerUploadBridge"
import { StyleLegendThumb, StylePreviewSwatch } from "./layerManager/StylePreviewSwatch"
import { call } from "@/lib/api"
import { parseSimpleStyleFromCss, parseSymbolFolderFromUrl, symbolFileNameFromUrl, toPublicSymbolPreviewUrl, type GeometryType, type StyleProps } from "@/lib/geoserverStyleUtils"
import {
  fetchDefineLayerTables,
  fetchLayerDbTableList,
  invalidateLayerManagerListCache,
} from "./layerManager/layerManagerListCache"
import { getGeoServerBase } from "@/lib/geoserverUrl"

const GEOSERVER_DEFAULT_URL = getGeoServerBase()

const GEOMETRY_TYPES: { value: GeometryType; label: string }[] = [
  { value: "POINT", label: "POINT" },
  { value: "LINE", label: "LINE" },
  { value: "POLYGON", label: "POLYGON" },
]

/** 스타일 수정 모달 전용. 저장 시 SYMBOL → POINT + 심볼 주소로 보냄 */
type StyleFormGeomType = GeometryType | "SYMBOL"

const EDIT_GEOMETRY_TYPES: { value: StyleFormGeomType; label: string }[] = [
  { value: "POINT", label: "POINT" },
  { value: "SYMBOL", label: "SYMBOL" },
  { value: "LINE", label: "LINE" },
  { value: "POLYGON", label: "POLYGON" },
]

function toApiGeometryType(kind: StyleFormGeomType): GeometryType {
  return kind === "SYMBOL" ? "POINT" : kind
}

function toApiStyleProps(kind: StyleFormGeomType, props: StyleProps): StyleProps {
  if (kind === "SYMBOL") {
    const symbolUrl = props.symbolUrl?.trim()
    return { ...props, symbolUrl: symbolUrl || undefined }
  }
  const { symbolUrl: _drop, ...rest } = props
  return rest
}

function guessSymbolUrl(layerName: string | null | undefined): string | undefined {
  const name = layerName?.trim()
  if (!name) return undefined
  return `${GEOSERVER_DEFAULT_URL}/www/symbol/water/${name}.svg`
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/

/** 색상 텍스트 입력 + 우측 끝 컬러피커 버튼 (직접입력·피커 모두 지원) */
function ColorField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const pickerValue = HEX_COLOR_RE.test(value) ? value : "#000000"
  return (
    <div className="relative">
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-9"
      />
      <input
        type="color"
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
        title="색상 선택"
        className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded border border-input bg-transparent p-0 cursor-pointer"
      />
    </div>
  )
}


const defaultStyleProps: StyleProps = {
  fillColor: "#808080",
  strokeColor: "#000000",
  strokeWidth: 1,
  opacity: 1,
  labelField: "",
  size: 14,
  markSize: 18,
}

type DefineLayerTable = Record<string, unknown> & { fields?: unknown[] }
type DefineLayerConfig = { version?: string; generatedAt?: string; tables: DefineLayerTable[] }

type LayerFilterMode = "all" | "public_layer" | "layer"

const LAYER_FILTER_OPTIONS: { value: LayerFilterMode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "public_layer", label: "public_layer" },
  { value: "layer", label: "layer" },
]

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

/** GeoServer WMS GetLegendGraphic URL (범례 이미지). version이 바뀌면 URL도 바뀌어 브라우저 캐시를 무시하고 새로 받아온다. */
function getLegendGraphicUrl(layerName: string, styleName?: string, version?: number): string {
  const base = GEOSERVER_DEFAULT_URL
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
  return `${base}/wms?${params.toString()}`
}

const TABLE_COLUMNS: TableColumnDef[] = [
  { id: "define_table_schema", label: "스키마", width: "92px", kind: "field", badge: "schema", alignCenter: true },
  { id: "define_table_source", label: "출처", width: "64px", kind: "field", badge: "source", alignCenter: true },
  { id: "define_table_group", label: "그룹", width: "130px", kind: "field", alignCenter: true },
  { id: "define_table_name", label: "테이블명", width: "flex", kind: "field", readonly: true },
  { id: "define_table_kor_name", label: "한글명", width: "flex", kind: "field" },
  { id: "__style_legend", label: "스타일", width: "80px", kind: "style_legend" },
  { id: "define_table_idx", label: "순서", width: "50px", kind: "field", alignCenter: true },
  { id: "define_table_shp_type", label: "도형", width: "120px", kind: "field", shapeType: true },
  { id: "define_table_read_share", label: "읽기", width: "70px", kind: "field", share: "read", alignCenter: true },
  { id: "define_table_write_share", label: "쓰기", width: "70px", kind: "field", share: "write", alignCenter: true },
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
const SCHEMA_OPTIONS = ["layer", "public_layer"] as const

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
  const originalTablesRef = useRef<Map<string, Record<string, unknown>>>(new Map())
  const [total, setTotal] = useState(0)
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [layerFilterMode, setLayerFilterMode] = useState<LayerFilterMode>("all")
  const [usedOnly, setUsedOnly] = useState(false)
  const [dbTableKeySet, setDbTableKeySet] = useState<Set<string>>(new Set())
  const parentRef = useRef<HTMLDivElement>(null)

  // 스타일: GeoServer 레이어별 스타일 보유 여부 (테이블명 기준)
  const [styleInfoMap, setStyleInfoMap] = useState<
    Record<string, { tableExists?: boolean; published?: boolean; hasCssStyle: boolean; styleName?: string }>
  >({})
  const [styleLoading, setStyleLoading] = useState(false)
  const [styleVersion, setStyleVersion] = useState(0)
  /** WMS 범례(GetLegendGraphic) 실패 시 CSS를 직접 파싱해서 보여주는 미리보기 캐시 — DB 테이블이 없어도 스타일 자체는 볼 수 있게 함 */
  const [cssFallbackMap, setCssFallbackMap] = useState<
    Record<string, "loading" | "error" | (StyleProps & { geometryType: GeometryType })>
  >({})
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
  const [schemaSwitchOpen, setSchemaSwitchOpen] = useState(false)
  const [schemaSwitchTarget, setSchemaSwitchTarget] = useState<{
    tableName: string
    fromSchema: string
    toSchema: "layer" | "public_layer"
    tableIdx: number
  } | null>(null)
  const [schemaSwitching, setSchemaSwitching] = useState(false)
  /** public_layer 전환 시 데이터 통합이력 삭제 여부 */
  const [schemaSwitchDeleteHistory, setSchemaSwitchDeleteHistory] = useState(false)
  const [attrDeleteOpen, setAttrDeleteOpen] = useState(false)
  const [attrDeleteTarget, setAttrDeleteTarget] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formGeometryType, setFormGeometryType] = useState<StyleFormGeomType>("POLYGON")
  const [formProps, setFormProps] = useState<StyleProps>(defaultStyleProps)
  const [labelFieldOptions, setLabelFieldOptions] = useState<{ name: string; korName: string }[]>([])
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [symbolFolders, setSymbolFolders] = useState<string[]>([])
  const [symbolFolder, setSymbolFolder] = useState("")
  const [newSymbolFolder, setNewSymbolFolder] = useState("")
  const [symbolPickFile, setSymbolPickFile] = useState<File | null>(null)
  const [symbolFolderFiles, setSymbolFolderFiles] = useState<string[]>([])
  const [symbolLinkFile, setSymbolLinkFile] = useState("")
  const [symbolUploading, setSymbolUploading] = useState(false)
  const [symbolPreviewKey, setSymbolPreviewKey] = useState(0)
  const lastSymbolUrlRef = useRef("")
  const [pickPreviewUrl, setPickPreviewUrl] = useState("")
  const [editEditable, setEditEditable] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [autoApplyLoading, setAutoApplyLoading] = useState(false)

  const loadFullList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await fetchDefineLayerTables()
      if (body.success && body.data) {
        setConfig({ tables: body.data })
        originalTablesRef.current = new Map(
          (body.data as Record<string, unknown>[]).map((t) => [String(t.define_table_name ?? ""), t])
        )
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

  const loadDbTableKeySet = useCallback(async () => {
    try {
      const data = await fetchLayerDbTableList()
      if (!data?.success || !Array.isArray(data.tables)) return
      const keys = new Set<string>(
        (data.tables as Array<{ schema: string; table: string }>).map(
          (t) => `${t.schema === "public_layer" ? "public_layer" : "layer"}:${String(t.table).toLowerCase()}`
        )
      )
      setDbTableKeySet(keys)
    } catch {
      // 조회 실패해도 "사용중" 필터만 못 쓰게 되고 나머지는 정상 동작
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
        setStyleVersion((v) => v + 1)
      }
    } catch {
      // 스타일 정보 실패해도 정보 테이블은 유지
    } finally {
      setStyleLoading(false)
    }
  }, [])

  useEffect(() => {
    return registerLayerManagerDefineRefresh(() => {
      void loadFullList()
      void loadDbTableKeySet()
      void loadStyleInfo()
    })
  }, [loadFullList, loadDbTableKeySet, loadStyleInfo])

  useEffect(() => {
    if (config?.tables?.length) {
      loadStyleInfo()
    }
  }, [config?.tables?.length, loadStyleInfo])

  /** "사용중" 필터용 — 현재 접속된 DB(layer/public_layer 스키마)에 실제로 존재하는 테이블 목록 */
  useEffect(() => {
    void loadDbTableKeySet()
  }, [loadDbTableKeySet])

  // 디바운싱: 검색어 입력 후 300ms 대기
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

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

  // 저장 전까지는 마지막 저장 시점의 스키마로 필터링·정렬해 편집 중인 행이 목록에서 사라지거나 위치가 튀지 않게 함
  const getStableSchema = useCallback((row: Record<string, unknown>): string => {
    const name = String(row.define_table_name ?? "").trim()
    const original = name ? originalTablesRef.current.get(name) : undefined
    const raw = original ? original.define_table_schema : row.define_table_schema
    return String(raw ?? "layer") === "public_layer" ? "public_layer" : "layer"
  }, [])

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
        const tSchema = getStableSchema(t as Record<string, unknown>)
        if (name !== key) return false
        if (schema && tSchema !== schema) return false
        return true
      })
    }
    if (layerFilterMode === "public_layer") {
      list = list.filter((t) => getStableSchema(t as Record<string, unknown>) === "public_layer")
    } else if (layerFilterMode === "layer") {
      list = list.filter((t) => getStableSchema(t as Record<string, unknown>) !== "public_layer")
    }
    if (usedOnly) {
      list = list.filter((t) => {
        const row = t as Record<string, unknown>
        const schema = getStableSchema(row)
        const name = String(row.define_table_name ?? "").trim().toLowerCase()
        return name && dbTableKeySet.has(`${schema}:${name}`)
      })
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
    // 정렬: layer/SHP → layer/Excel → public_layer/SHP → public_layer/Excel → 그 외
    const sortRank = (t: DefineLayerTable) => {
      const row = t as Record<string, unknown>
      const isPublic = getStableSchema(row) === "public_layer"
      const source = String(row.define_table_source ?? "").toLowerCase()
      if (!isPublic && source === "shp") return 0
      if (!isPublic && source === "excel") return 1
      if (isPublic && source === "shp") return 2
      if (isPublic && source === "excel") return 3
      return 4
    }
    return [...list].sort((a, b) => sortRank(a) - sortRank(b))
  }, [
    config?.tables,
    embedded,
    fixedTableKey,
    fixedSchema,
    debouncedSearch,
    layerFilterMode,
    usedOnly,
    dbTableKeySet,
    getStableSchema,
  ])

  const displayedTables = useMemo(
    () => filteredTables.slice(0, displayCount),
    [filteredTables, displayCount]
  )
  const hasMoreDisplay = displayCount < filteredTables.length

  useEffect(() => {
    setDisplayCount(PAGE_SIZE)
  }, [layerFilterMode, usedOnly, debouncedSearch])

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
      const fullBody = await fetchDefineLayerTables()
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
      if (body.success) {
        invalidateLayerManagerListCache()
        setSuccessMsg("저장되었습니다.")
        originalTablesRef.current = new Map(
          config.tables.map((t) => [String((t as Record<string, unknown>).define_table_name ?? ""), t as Record<string, unknown>])
        )
      } else {
        setError(body.error ?? "저장에 실패했습니다.")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }, [config])

  /** 스타일 모달의 라벨필드 드롭다운용 — 해당 테이블의 실제 필드 목록 조회 (gid/geom 제외) */
  const loadLabelFieldOptions = useCallback(async (tableName: string) => {
    setLabelFieldOptions([])
    try {
      const res = await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(tableName)}`)
      const body = await res.json()
      if (body.success && Array.isArray(body.data)) {
        const seen = new Set<string>()
        const options = (body.data as Record<string, unknown>[])
          .map((f) => ({
            name: String(f.define_field_name ?? "").trim(),
            korName: String(f.define_field_kor_name ?? "").trim(),
          }))
          .filter((o) => {
            if (!o.name || ["gid", "geom"].includes(o.name.toLowerCase())) return false
            if (seen.has(o.name)) return false
            seen.add(o.name)
            return true
          })
        setLabelFieldOptions(options)
      }
    } catch {
      // 라벨필드 목록 실패해도 직접입력은 계속 가능
    }
  }, [])

  const loadSymbolFolders = useCallback(async (preferredFolder?: string | null) => {
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "listGeoServerSymbolFolders",
        params: {},
      })
      const data = res?.data ?? res
      const folders: string[] = data?.success && Array.isArray(data.folders) ? data.folders : []
      setSymbolFolders(folders)
      const prefer = preferredFolder?.trim()
      setSymbolFolder((prev) => {
        if (prefer && folders.includes(prefer)) return prefer
        if (prev && folders.includes(prev)) return prev
        if (folders.includes("water")) return "water"
        return folders[0] ?? ""
      })
    } catch {
      setSymbolFolders([])
    }
  }, [])

  const loadSymbolFolderFiles = useCallback(async (folder: string) => {
    if (!folder) {
      setSymbolFolderFiles([])
      setSymbolLinkFile("")
      return
    }
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "listGeoServerSymbolFiles",
        params: { folder },
      })
      const data = res?.data ?? res
      const files: string[] = data?.success && Array.isArray(data.files) ? data.files : []
      setSymbolFolderFiles(files)
      setSymbolLinkFile((prev) => (prev && files.includes(prev) ? prev : ""))
    } catch {
      setSymbolFolderFiles([])
      setSymbolLinkFile("")
    }
  }, [])

  useEffect(() => {
    void loadSymbolFolderFiles(symbolFolder)
  }, [symbolFolder, loadSymbolFolderFiles])

  useEffect(() => {
    if (!symbolPickFile) {
      setPickPreviewUrl("")
      return
    }
    const url = URL.createObjectURL(symbolPickFile)
    setPickPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [symbolPickFile])

  const applySymbolUrl =
    pickPreviewUrl ||
    (symbolFolder && symbolLinkFile
      ? `${GEOSERVER_DEFAULT_URL}/www/symbol/${encodeURIComponent(symbolFolder)}/${encodeURIComponent(symbolLinkFile)}`
      : "")
  const applySymbolName = symbolPickFile?.name || symbolLinkFile || ""

  const handleCreateSymbolFolder = useCallback(async () => {
    const name = newSymbolFolder.trim()
    if (!name) {
      setFormError("새 폴더 이름을 입력하세요.")
      return
    }
    setSymbolUploading(true)
    setFormError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "createGeoServerSymbolFolder",
        params: { folder: name },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setFormError(data?.error ?? "폴더 생성 실패")
        return
      }
      setNewSymbolFolder("")
      setSymbolFolder(data.folder ?? name)
      await loadSymbolFolders(data.folder ?? name)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "폴더 생성 실패")
    } finally {
      setSymbolUploading(false)
    }
  }, [newSymbolFolder, loadSymbolFolders])

  const handleSaveSymbolFile = useCallback(async () => {
    if (!symbolFolder) {
      setFormError("저장할 폴더를 선택하세요.")
      return
    }
    if (!symbolPickFile) {
      setFormError("올릴 파일을 선택하세요.")
      return
    }
    setSymbolUploading(true)
    setFormError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ""))
        reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."))
        reader.readAsDataURL(symbolPickFile)
      })
      const res = await call("", "POST", {
        service: "devTestService",
        action: "uploadGeoServerSymbolFile",
        params: {
          folder: symbolFolder,
          layerName: targetLayerName,
          fileName: symbolPickFile.name,
          mime: symbolPickFile.type,
          base64: dataUrl,
        },
      })
      const data = res?.data ?? res
      if (!data?.success || !data.symbolUrl) {
        setFormError(data?.error ?? "심볼 파일 저장 실패")
        return
      }
      setFormProps((p) => ({ ...p, symbolUrl: data.symbolUrl }))
      setSymbolPickFile(null)
      setSymbolPreviewKey((n) => n + 1)
      await loadSymbolFolderFiles(symbolFolder)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "심볼 파일 저장 실패")
    } finally {
      setSymbolUploading(false)
    }
  }, [symbolFolder, symbolPickFile, targetLayerName, loadSymbolFolderFiles])

  const handleLinkSymbolFile = useCallback(async () => {
    if (!symbolFolder) {
      setFormError("저장할 폴더를 선택하세요.")
      return
    }
    if (!symbolLinkFile) {
      setFormError("연결할 파일을 선택하세요.")
      return
    }
    setSymbolUploading(true)
    setFormError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "linkGeoServerSymbolFile",
        params: {
          folder: symbolFolder,
          layerName: targetLayerName,
          fileName: symbolLinkFile,
        },
      })
      const data = res?.data ?? res
      if (!data?.success || !data.symbolUrl) {
        setFormError(data?.error ?? "심볼 파일 연결 실패")
        return
      }
      setFormProps((p) => ({ ...p, symbolUrl: data.symbolUrl }))
      lastSymbolUrlRef.current = data.symbolUrl
      setSymbolPreviewKey((n) => n + 1)
      setSymbolLinkFile("")
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "심볼 파일 연결 실패")
    } finally {
      setSymbolUploading(false)
    }
  }, [symbolFolder, symbolLinkFile, targetLayerName])

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
    void loadLabelFieldOptions(layerName)
  }, [loadLabelFieldOptions])

  const openEdit = useCallback(async (layerName: string, styleName: string) => {
    setTargetLayerName(layerName)
    setTargetStyleName(styleName)
    setFormError(null)
    setEditOpen(true)
    setFormSaving(false)
    void loadLabelFieldOptions(layerName)
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
        const symbolUrl = String(data.styleProps.symbolUrl ?? "").trim()
        lastSymbolUrlRef.current = symbolUrl
        const hasSymbol = Boolean(symbolUrl)
        setFormGeometryType(
          hasSymbol ? "SYMBOL" : ((data.geometryType as GeometryType) ?? "POLYGON")
        )
        setSymbolPickFile(null)
        setPickPreviewUrl("")
        setSymbolLinkFile("")
        setSymbolPreviewKey((n) => n + 1)
        void loadSymbolFolders(parseSymbolFolderFromUrl(symbolUrl))
      }
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "조회 실패")
      setEditEditable(false)
    }
  }, [loadLabelFieldOptions, loadSymbolFolders])

  const openLayerDefineDelete = useCallback((tableName: string, schema: string) => {
    setLayerDefineDeleteTarget({ tableName, schema })
    setLayerDefineDeleteOpen(true)
  }, [])

  const openSchemaSwitch = useCallback(
    (tableIdx: number, tableName: string, currentSchema: string) => {
      const from =
        SCHEMA_OPTIONS.includes(currentSchema as (typeof SCHEMA_OPTIONS)[number])
          ? currentSchema
          : "layer"
      const toSchema: "layer" | "public_layer" =
        from === "public_layer" ? "layer" : "public_layer"
      setSchemaSwitchTarget({
        tableName,
        fromSchema: from,
        toSchema,
        tableIdx,
      })
      setSchemaSwitchDeleteHistory(false)
      setSchemaSwitchOpen(true)
    },
    []
  )

  const handleSchemaSwitchConfirm = useCallback(async () => {
    if (!schemaSwitchTarget || !config) return
    const { tableName, toSchema, tableIdx } = schemaSwitchTarget
    const deleteDataHistory =
      toSchema === "public_layer" && schemaSwitchDeleteHistory
    setSchemaSwitching(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "switchLayerTableSchema",
        params: {
          tableName,
          toSchema,
          url: GEOSERVER_DEFAULT_URL,
          deleteDataHistory,
        },
      })
      const data = res?.data ?? res
      // 정의는 서비스에서 먼저 저장됨 → UI 반영
      updateCell(tableIdx, "define_table_schema", toSchema)
      originalTablesRef.current.set(tableName, {
        ...(originalTablesRef.current.get(tableName) ??
          (config.tables[tableIdx] as Record<string, unknown>)),
        define_table_schema: toSchema,
      })
      await loadDbTableKeySet()
      setStyleVersion((v) => v + 1)
      requestLayerManagerListRefresh()
      if (!data?.success) {
        setError(
          `${data?.error ?? "스키마 전환 실패"} (정의는 저장됨 · 오류수정 탭에서 이어서 처리할 수 있습니다)`
        )
        setSchemaSwitchOpen(false)
        setSchemaSwitchTarget(null)
        setSchemaSwitchDeleteHistory(false)
        return
      }
      setSuccessMsg(data.message ?? `"${tableName}" 스키마 전환 완료`)
      setSchemaSwitchOpen(false)
      setSchemaSwitchTarget(null)
      setSchemaSwitchDeleteHistory(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "스키마 전환 실패")
    } finally {
      setSchemaSwitching(false)
    }
  }, [schemaSwitchTarget, schemaSwitchDeleteHistory, config, updateCell, loadDbTableKeySet])

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
      invalidateLayerManagerListCache()

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
          geometryType: toApiGeometryType(formGeometryType),
          styleProps: toApiStyleProps(formGeometryType, formProps),
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
        setStyleVersion((v) => v + 1)
        loadStyleInfo()
        requestLayerManagerListRefresh()
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
    if (formGeometryType === "SYMBOL" && !formProps.symbolUrl?.trim()) {
      setFormError("심볼 파일이 없습니다. POINT로 바꾸거나 심볼 파일을 확인하세요.")
      return
    }
    setFormSaving(true)
    setFormError(null)
    try {
      const res = await call("", "POST", {
        service: "devTestService",
        action: "updateGeoServerStyle",
        params: {
          url: GEOSERVER_DEFAULT_URL,
          name: targetStyleName,
          geometryType: toApiGeometryType(formGeometryType),
          styleProps: toApiStyleProps(formGeometryType, formProps),
          preserveExtraRules: true,
        },
      })
      const data = res?.data ?? res
      if (data?.success) {
        const fallbackKey = (targetStyleName || targetLayerName || "").toLowerCase()
        if (fallbackKey) {
          setCssFallbackMap((prev) => ({
            ...prev,
            [fallbackKey]: {
              ...toApiStyleProps(formGeometryType, formProps),
              geometryType: toApiGeometryType(formGeometryType),
            },
          }))
        }
        setEditOpen(false)
        setTargetStyleName(null)
        setTargetLayerName(null)
        setSuccessMsg(`레이어 "${targetLayerName}"의 스타일이 수정되었습니다.`)
        setStyleVersion(Date.now())
        loadStyleInfo()
        requestLayerManagerListRefresh()
      } else {
        setFormError(data?.error ?? "수정 실패")
      }
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "수정 실패")
    } finally {
      setFormSaving(false)
    }
  }, [targetStyleName, targetLayerName, editEditable, formGeometryType, formProps, loadStyleInfo])

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
        requestLayerManagerListRefresh()
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

  const renderFormFields = useCallback((geometryType: StyleFormGeomType) => {
    const opacityField = (
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
    )
    const markSizeField = (label: string) => (
      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
        <label className="text-sm">{label}</label>
        <Input
          type="number"
          min={1}
          max={64}
          value={formProps.markSize ?? 18}
          onChange={(e) =>
            setFormProps((p) => ({ ...p, markSize: parseFloat(e.target.value) || 18 }))
          }
        />
      </div>
    )
    const fontSizeField = (
      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
        <label className="text-sm">글자크기</label>
        <Input
          type="number"
          min={1}
          value={formProps.size ?? 14}
          onChange={(e) =>
            setFormProps((p) => ({ ...p, size: parseFloat(e.target.value) || 14 }))
          }
        />
      </div>
    )
    const labelFieldBlock = (
        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
          <label className="text-sm">라벨필드</label>
          <select
            value={formProps.labelField ?? ""}
            onChange={(e) => setFormProps((p) => ({ ...p, labelField: e.target.value }))}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">(없음)</option>
            {formProps.labelField && !labelFieldOptions.some((o) => o.name === formProps.labelField) ? (
              <option value={formProps.labelField}>{formProps.labelField}</option>
            ) : null}
            {labelFieldOptions.map((o) => (
              <option key={o.name} value={o.name}>
                {o.korName ? `${o.name} - ${o.korName}` : o.name}
              </option>
            ))}
          </select>
        </div>
    )
    const renderStrokeAndLabelFields = (showLinePreview: boolean) => (
      <>
        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
          <label className="text-sm">선색상</label>
          {showLinePreview ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <ColorField
                  value={formProps.strokeColor ?? ""}
                  onChange={(v) => setFormProps((p) => ({ ...p, strokeColor: v }))}
                  placeholder="#000000"
                />
              </div>
              <StylePreviewSwatch geometryType="LINE" strokeColor={formProps.strokeColor} />
            </div>
          ) : (
            <ColorField
              value={formProps.strokeColor ?? ""}
              onChange={(v) => setFormProps((p) => ({ ...p, strokeColor: v }))}
              placeholder="#000000"
            />
          )}
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
      </>
    )
    if (geometryType === "SYMBOL") {
      return (
        <Fragment key="SYMBOL">
          <div className="rounded-md border border-input p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">심볼 설정</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col items-center gap-1 rounded-md border border-input bg-muted/40 p-2 min-w-0">
                <p className="text-xs text-muted-foreground">현재 심볼</p>
                <StylePreviewSwatch
                  key={formProps.symbolUrl?.trim() || "symbol-current"}
                  geometryType="POINT"
                  symbolUrl={formProps.symbolUrl}
                  cacheBust={symbolPreviewKey}
                />
                {formProps.symbolUrl?.trim() ? (
                  <a
                    href={`${toPublicSymbolPreviewUrl(formProps.symbolUrl) ?? formProps.symbolUrl}${symbolPreviewKey ? `?v=${symbolPreviewKey}` : ""}`}
                    download={symbolFileNameFromUrl(formProps.symbolUrl)}
                    className="text-xs text-primary underline underline-offset-2 truncate max-w-full hover:cursor-pointer"
                    title="클릭하면 파일을 받습니다"
                  >
                    {symbolFileNameFromUrl(formProps.symbolUrl)}
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">없음</span>
                )}
              </div>
              <div className="flex flex-col items-center gap-1 rounded-md border border-input p-2 min-w-0">
                <p className="text-xs text-muted-foreground">적용할 심볼</p>
                {applySymbolUrl ? (
                  <StylePreviewSwatch
                    key={applySymbolUrl}
                    geometryType="POINT"
                    symbolUrl={applySymbolUrl}
                  />
                ) : (
                  <div className="h-8 w-8 shrink-0 rounded border border-dashed border-input" />
                )}
                <span className="text-xs text-muted-foreground truncate max-w-full">
                  {applySymbolName || "아래에서 고르세요"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-start">
              <label className="text-sm pt-2">저장 폴더</label>
              <div className="flex flex-col gap-2 min-w-0">
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={symbolFolder}
                  onChange={(e) => {
                    setSymbolFolder(e.target.value)
                    setSymbolLinkFile("")
                    setSymbolPickFile(null)
                  }}
                >
                  {symbolFolders.length === 0 ? (
                    <option value="">폴더 없음</option>
                  ) : (
                    symbolFolders.map((f) => (
                      <option key={f} value={f}>
                        www/symbol/{f}
                      </option>
                    ))
                  )}
                </select>
                <div className="flex items-center gap-1">
                  <Input
                    className="h-8"
                    value={newSymbolFolder}
                    onChange={(e) => setNewSymbolFolder(e.target.value)}
                    placeholder="없으면 새 폴더 이름 입력"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 hover:cursor-pointer"
                    disabled={symbolUploading}
                    onClick={() => void handleCreateSymbolFolder()}
                  >
                    폴더 만들기
                  </Button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-start">
              <label className="text-sm pt-2">파일 고르기</label>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-1">
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm min-w-0"
                    value={symbolLinkFile}
                    onChange={(e) => {
                      setSymbolLinkFile(e.target.value)
                      setSymbolPickFile(null)
                    }}
                  >
                    {symbolFolderFiles.length === 0 ? (
                      <option value="">파일을 선택해주세요</option>
                    ) : (
                      <>
                        <option value="">파일을 선택해주세요</option>
                        {symbolFolderFiles.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 hover:cursor-pointer"
                    disabled={
                      symbolUploading ||
                      !symbolFolder ||
                      !symbolLinkFile ||
                      symbolLinkFile === symbolFileNameFromUrl(formProps.symbolUrl ?? "")
                    }
                    onClick={() => void handleLinkSymbolFile()}
                  >
                    이 파일로 사용
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">폴더에 있는 파일 중 하나를 씁니다.</p>
              </div>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 items-start">
              <label className="text-sm pt-2">새 파일</label>
              <div className="flex flex-col gap-1 min-w-0">
                <input
                  type="file"
                  accept=".svg,.png,image/svg+xml,image/png"
                  className="text-sm file:mr-2 file:h-8 file:rounded file:border file:border-input file:bg-background file:px-2"
                  onChange={(e) => setSymbolPickFile(e.target.files?.[0] ?? null)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 hover:cursor-pointer"
                    disabled={symbolUploading || !symbolFolder || !symbolPickFile}
                    onClick={() => void handleSaveSymbolFile()}
                  >
                    {symbolUploading ? "저장 중..." : "올려서 사용"}
                  </Button>
                  {symbolPickFile ? (
                    <span className="text-xs text-muted-foreground truncate">{symbolPickFile.name}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">svg 또는 png</span>
                  )}
                </div>
              </div>
            </div>
            {markSizeField("심볼 크기")}
          </div>
          <div className="rounded-md border border-input p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">라벨</p>
            {labelFieldBlock}
            {fontSizeField}
          </div>
        </Fragment>
      )
    }
    if (geometryType === "POINT") {
      return (
        <Fragment key="POINT">
          {markSizeField("점 크기")}
          <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
            <label className="text-sm">색상</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <ColorField
                  value={formProps.fillColor ?? ""}
                  onChange={(v) => setFormProps((p) => ({ ...p, fillColor: v }))}
                  placeholder="#808080"
                />
              </div>
              <StylePreviewSwatch
                geometryType="POINT"
                fillColor={formProps.fillColor}
                strokeColor={formProps.strokeColor}
                opacity={formProps.opacity}
              />
            </div>
          </div>
          {opacityField}
          {renderStrokeAndLabelFields(false)}
          {labelFieldBlock}
          {fontSizeField}
        </Fragment>
      )
    }
    if (geometryType === "LINE") {
      return (
        <Fragment key="LINE">
          {renderStrokeAndLabelFields(true)}
          {opacityField}
          {labelFieldBlock}
          {fontSizeField}
        </Fragment>
      )
    }
    return (
      <Fragment key="POLYGON">
        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
          <label className="text-sm">색상</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <ColorField
                value={formProps.fillColor ?? ""}
                onChange={(v) => setFormProps((p) => ({ ...p, fillColor: v }))}
                placeholder="#808080"
              />
            </div>
            <StylePreviewSwatch
              geometryType="POLYGON"
              fillColor={formProps.fillColor}
              strokeColor={formProps.strokeColor}
              opacity={formProps.opacity}
            />
          </div>
        </div>
        {opacityField}
        {renderStrokeAndLabelFields(false)}
        {labelFieldBlock}
        {fontSizeField}
      </Fragment>
    )
  }, [formProps, labelFieldOptions, symbolFolders, symbolFolder, newSymbolFolder, symbolFolderFiles, symbolLinkFile, symbolPickFile, symbolUploading, symbolPreviewKey, applySymbolUrl, applySymbolName, handleCreateSymbolFolder, handleSaveSymbolFile, handleLinkSymbolFile])

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
      <div className="flex items-center gap-3 flex-nowrap shrink-0 overflow-x-auto">
        {!embedded && (
          <>
            <Input
              placeholder="그룹명·테이블명·한글명 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-56 rounded-md text-sm"
            />
            <div className="flex items-center gap-1 rounded-md border p-0.5 w-fit">
              {LAYER_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLayerFilterMode(opt.value)}
                  className={cn(
                    "h-6 rounded-sm px-2 text-xs leading-none whitespace-nowrap transition-colors",
                    layerFilterMode === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={usedOnly}
                onChange={(e) => setUsedOnly(e.target.checked)}
                className="rounded border-input"
              />
              접속 DB에 있는 레이어만
            </label>
            <span className="text-sm text-muted-foreground">
              총 {filteredTables.length}건
              {displayCount < filteredTables.length && (
                <span className="text-xs text-muted-foreground ml-1">
                  (표시: {displayedTables.length})
                </span>
              )}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-3 flex-nowrap shrink-0">
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
              setLayerFilterMode("all")
              setUsedOnly(false)
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
                className={`py-1 px-1 text-xs font-medium border-r bg-muted flex items-center ${i === TABLE_COLUMNS.length - 1 ? "border-r-0" : ""} ${(col.kind === "field" && col.alignCenter) || col.kind === "style_legend" || col.kind === "layer_delete" ? "justify-center text-center" : ""} ${col.width === "flex" ? "min-w-0" : "whitespace-nowrap"}`}
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
            const originalRow = originalTablesRef.current.get(tableName)
            const isDirty = !originalRow || JSON.stringify(row) !== JSON.stringify(originalRow)

            return (
              <div
                key={String(row.define_table_name ?? listIndex)}
                className={cn(
                  "flex border-b hover:bg-amber-100/40 dark:hover:bg-amber-600/20",
                  isDirty && "bg-amber-100/40 dark:bg-amber-600/20"
                )}
              >
                {TABLE_COLUMNS.map((col, colIndex) => {
                  const isLast = colIndex === TABLE_COLUMNS.length - 1
                  const cellClass = `py-0 px-1 overflow-hidden border-r flex items-center min-h-[28px] min-w-0 ${isLast ? "border-r-0" : ""}`
                  const cellStyle = getColumnStyle(col)

                  if (col.kind === "style_legend") {
                    const canShowLegend = hasCssStyle || published
                    const legendUrl = tableName
                      ? getLegendGraphicUrl(tableName, styleName ?? undefined, styleVersion)
                      : ""
                    const fallbackKey = (styleName || tableName || "").toLowerCase()
                    const fallbackState = fallbackKey ? cssFallbackMap[fallbackKey] : undefined
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
                        <StyleLegendThumb
                          key={`${tableName}-${styleVersion}`}
                          tableName={tableName}
                          shpType={shpType}
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
                        <button
                          type="button"
                          className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                          title="클릭하면 layer ↔ public_layer 전환 (정의·DB·GeoServer)"
                          disabled={schemaSwitching || !!actionLoading}
                          onClick={() => {
                            const tableName = String(row.define_table_name ?? "").trim()
                            if (!tableName) return
                            const current = SCHEMA_OPTIONS.includes(val as (typeof SCHEMA_OPTIONS)[number])
                              ? val
                              : "layer"
                            openSchemaSwitch(tableIdx, tableName, current)
                          }}
                        >
                          <SchemaBadge value={val} />
                        </button>
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
                          className={cn(
                            "h-6 rounded-none text-sm font-mono min-w-0 py-0 px-1",
                            key === "define_table_idx" && "text-right"
                          )}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hover:cursor-pointer w-fit"
            disabled={!targetLayerName || actionLoading === targetLayerName}
            onClick={() => {
              if (!targetLayerName) return
              void handleAutoApplyOne(targetLayerName)
              setAddOpen(false)
            }}
          >
            {actionLoading === targetLayerName ? "자동 생성 중..." : "기본 스타일 자동 생성"}
          </Button>
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
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={formGeometryType === "SYMBOL" ? "POINT" : formGeometryType}
                onChange={(e) => {
                  setFormGeometryType(e.target.value as GeometryType)
                  setFormProps((p) => {
                    const { symbolUrl: _drop, ...rest } = p
                    return rest
                  })
                }}
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
            <Button variant="outline" className="hover:cursor-pointer" onClick={() => setAddOpen(false)}>
              취소
            </Button>
            <Button variant="default" className="hover:cursor-pointer" onClick={handleAddSubmit} disabled={formSaving}>
              {formSaving ? "저장 중..." : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 스타일 수정 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>스타일 수정: {targetLayerName}</DialogTitle>
          </DialogHeader>
          {targetStyleName && (
            <a
              href={`${GEOSERVER_DEFAULT_URL}/web/wicket/bookmarkable/org.geoserver.wms.web.data.StyleEditPage?name=${encodeURIComponent(targetStyleName)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline underline-offset-4 hover:no-underline"
            >
              GeoServer 관리자 화면에서 스타일 직접 수정 →
            </a>
          )}
          {!editEditable ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                CSS 스타일만 간단 수정 가능합니다. 현재 스타일이 CSS가 아니거나 비어 있습니다.
              </p>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                <label className="text-sm">도형 타입</label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={formGeometryType}
                  onChange={(e) => {
                    const next = e.target.value as StyleFormGeomType
                    const kept = formProps.symbolUrl?.trim() || lastSymbolUrlRef.current
                    if (kept) lastSymbolUrlRef.current = kept
                    setFormGeometryType(next)
                    if (next === "SYMBOL") {
                      const symbolUrl = kept || guessSymbolUrl(targetLayerName) || ""
                      setFormProps((p) => ({
                        ...p,
                        symbolUrl: p.symbolUrl?.trim() || symbolUrl || undefined,
                      }))
                      void loadSymbolFolders(parseSymbolFolderFromUrl(symbolUrl))
                    }
                  }}
                >
                  {EDIT_GEOMETRY_TYPES.map((g) => (
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
            <Button variant="outline" className="hover:cursor-pointer" onClick={() => setEditOpen(false)}>
              취소
            </Button>
            <Button variant="default" className="hover:cursor-pointer" onClick={handleEditSubmit} disabled={formSaving || !editEditable}>
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

      {/* 스키마 전환: 정의 + DB + GeoServer */}
      <Dialog
        open={schemaSwitchOpen}
        onOpenChange={(open) => {
          if (schemaSwitching) return
          setSchemaSwitchOpen(open)
          if (!open) {
            setSchemaSwitchTarget(null)
            setSchemaSwitchDeleteHistory(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>스키마 전환</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm whitespace-pre-line">
            {schemaSwitchTarget
              ? `테이블 "${schemaSwitchTarget.tableName}"의 스키마를\n${schemaSwitchTarget.fromSchema} → ${schemaSwitchTarget.toSchema}\n로 전환합니다.\n\n레이어 정의 · DB 테이블 · GeoServer 레이어를 함께 변경합니다.`
              : ""}
          </p>
          {schemaSwitchTarget?.toSchema === "public_layer" && (
            <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={schemaSwitchDeleteHistory}
                disabled={schemaSwitching}
                onChange={(e) => setSchemaSwitchDeleteHistory(e.target.checked)}
                className="mt-0.5 rounded border-input"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">저장된 데이터 이력 삭제</span>
                <span className="text-xs text-muted-foreground">
                  전환 후에도 업로드·편집 이력은 계속 남습니다. 이미 저장된 통합 이력·스냅샷만 지금 지울지 선택합니다.
                </span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="text-muted-foreground"
              disabled={schemaSwitching}
              onClick={() => {
                setSchemaSwitchOpen(false)
                setSchemaSwitchTarget(null)
                setSchemaSwitchDeleteHistory(false)
              }}
            >
              취소
            </Button>
            <Button
              variant="default"
              className="hover:cursor-pointer"
              disabled={schemaSwitching}
              onClick={() => void handleSchemaSwitchConfirm()}
            >
              {schemaSwitching ? "전환 중..." : "전환"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
