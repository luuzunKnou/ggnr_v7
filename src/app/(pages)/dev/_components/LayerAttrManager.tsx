"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { Save, RotateCcw, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LayerDefineEmbedProps } from "./layerManager/types"

type DefineLayerTable = Record<string, unknown>
type DefineField = Record<string, unknown>

/** table_*.json에 있는 모든 속성 키 (분류 순서 = 상단 분류 행과 일치). 키·테이블키는 표시에서 제외. 선택* 6개는 UI에서만 제외(추후 별도 구현) */
const FIELD_KEYS = [
  ...["define_field_name", "define_field_kor_name"],
  ...["define_field_idx", "define_field_sort_idx", "define_field_sort_type"],
  ...[
    "define_field_type",
    "define_field_is_key",
    "define_field_is_required",
    "define_field_read_only",
    "define_field_max_length",
    "define_field_default_value",
  ],
  ...[
    "define_field_show_search",
    "define_field_show_search_detail",
    "define_field_show_title",
    "define_field_show_list",
    "define_field_show_detail_list",
    "define_field_show_detail",
  ],
]

const BOOL_FIELD_KEYS = new Set([
  "define_field_is_key",
  "define_field_is_required",
  "define_field_read_only",
  "define_field_show_search",
  "define_field_show_search_detail",
  "define_field_show_title",
  "define_field_show_list",
  "define_field_show_detail_list",
  "define_field_show_detail",
])
const READONLY_FIELD_KEYS = new Set(["define_field_name"])
const FIELD_TYPE_OPTIONS = ["TEXT", "NUMBER", "GEOMETRY", "DATE", "BOOLEAN", "CODE"] as const
const SORT_TYPE_OPTIONS = ["DESC", "ASC"] as const
const SELECT_KEYS = new Set(["define_field_type", "define_field_sort_type"])

const COLUMN_LABELS: Record<string, string> = {
  define_field_name: "영문명",
  define_field_kor_name: "한글명",
  define_field_idx: "순서",
  define_field_type: "자료형",
  define_field_is_key: "키",
  define_field_is_required: "필수",
  define_field_read_only: "읽기전용",
  define_field_max_length: "최대길이",
  define_field_default_value: "기본값",
  define_field_sel_list: "선택목록",
  define_field_sel_table: "선택테이블",
  define_field_sel_query: "선택쿼리",
  define_field_sel_url: "선택URL",
  define_field_sel_key_field: "선택키필드",
  define_field_sel_label_field: "선택라벨필드",
  define_field_sort_idx: "데이터",
  define_field_sort_type: "방식",
  define_field_show_search: "검색",
  define_field_show_search_detail: "상세검색",
  define_field_show_title: "제목",
  define_field_show_list: "목록",
  define_field_show_detail_list: "상세목록",
  define_field_show_detail: "상세보기",
}

const COLUMN_WIDTHS: Record<string, string> = {
  define_field_name: "190px",
  define_field_kor_name: "190px",
  define_field_idx: "56px",
  define_field_type: "88px",
  define_field_is_key: "40px",
  define_field_is_required: "44px",
  define_field_read_only: "56px",
  define_field_max_length: "56px",
  define_field_default_value: "150px",
  define_field_sel_list: "80px",
  define_field_sel_table: "90px",
  define_field_sel_query: "90px",
  define_field_sel_url: "80px",
  define_field_sel_key_field: "90px",
  define_field_sel_label_field: "90px",
  define_field_sort_idx: "56px",
  define_field_sort_type: "100px",
  define_field_show_search: "44px",
  define_field_show_search_detail: "56px",
  define_field_show_title: "44px",
  define_field_show_list: "44px",
  define_field_show_detail_list: "56px",
  define_field_show_detail: "48px",
}

const COLUMN_ALIGN_CENTER = new Set([
  "define_field_idx",
  "define_field_is_key",
  "define_field_is_required",
  "define_field_read_only",
  "define_field_show_search",
  "define_field_show_search_detail",
  "define_field_show_title",
  "define_field_show_list",
  "define_field_show_detail_list",
  "define_field_show_detail",
])

/** 상단 분류 행: [분류명, 해당 필드 키 배열] */
const HEADER_CATEGORIES: { label: string; keys: string[] }[] = [
  { label: "이름", keys: ["define_field_name", "define_field_kor_name"] },
  { label: "정렬", keys: ["define_field_idx", "define_field_sort_idx", "define_field_sort_type"] },
  {
    label: "데이터 속성",
    keys: [
      "define_field_type",
      "define_field_is_key",
      "define_field_is_required",
      "define_field_read_only",
      "define_field_max_length",
      "define_field_default_value",
    ],
  },
  {
    label: "보기",
    keys: [
      "define_field_show_search",
      "define_field_show_search_detail",
      "define_field_show_title",
      "define_field_show_list",
      "define_field_show_detail_list",
      "define_field_show_detail",
    ],
  },
]

const PAGE_SIZE = 50
const SCROLL_LOAD_THRESHOLD = 200
const LAYER_LIST_WIDTH = 280

/** wrapper 100% 채우기: 영문명·한글명은 minmax로 남는 공간 채움, 나머지 고정 */
function getGridTemplateColumns(): string {
  return FIELD_KEYS.map((k) =>
    k === "define_field_name" || k === "define_field_kor_name"
      ? "minmax(180px, 1fr)"
      : COLUMN_WIDTHS[k] || "1fr"
  ).join(" ")
}

export function LayerAttrManager({
  embedded = false,
  fixedTableKey = null,
  fixedSchema = null,
}: LayerDefineEmbedProps = {}) {
  const [tables, setTables] = useState<DefineLayerTable[]>([])
  const [selectedTableKey, setSelectedTableKey] = useState<string>("")
  const [layerListSearch, setLayerListSearch] = useState("")
  const [debouncedLayerListSearch, setDebouncedLayerListSearch] = useState("")
  const [fields, setFields] = useState<DefineField[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingTables, setLoadingTables] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [searchName, setSearchName] = useState("")
  const [debouncedSearchName, setDebouncedSearchName] = useState("")
  const [showPublicLayer, setShowPublicLayer] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  loadingMoreRef.current = loadingMore
  hasMoreRef.current = hasMore

  useEffect(() => {
    if (fixedTableKey) setSelectedTableKey(fixedTableKey)
  }, [fixedTableKey])

  // 테이블 목록 로드 (전체)
  useEffect(() => {
    let cancelled = false
    setLoadingTables(true)
    fetch("/api/config/defineLayer")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return
        if (body.success && Array.isArray(body.data)) {
          setTables(body.data)
          if (body.data.length > 0 && !selectedTableKey && !fixedTableKey) {
            const first = String((body.data[0] as Record<string, unknown>).define_table_name ?? "")
            if (first) setSelectedTableKey(first)
          }
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "테이블 목록 로드 실패"))
      .finally(() => !cancelled && setLoadingTables(false))
    return () => { cancelled = true }
  }, [])

  const loadFirstPage = useCallback(async (tableKey: string) => {
    if (!tableKey) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/config/defineLayer/fields/${encodeURIComponent(tableKey)}?page=1&limit=${PAGE_SIZE}`
      )
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) {
        const text = await res.text()
        setError(res.ok ? "응답이 JSON이 아닙니다." : `요청 실패 (${res.status}): ${text.slice(0, 100)}`)
        return
      }
      const body = await res.json()
      if (body.success && body.data) {
        setFields(body.data)
        setTotal(body.total ?? body.data.length)
        setPage(1)
        const more = (body.data?.length ?? 0) < (body.total ?? 0)
        setHasMore(more)
        hasMoreRef.current = more
      } else {
        setError(body.error ?? "필드를 불러올 수 없습니다.")
        setFields([])
        setTotal(0)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "필드를 불러올 수 없습니다.")
      setFields([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (!selectedTableKey || loadingMoreRef.current || !hasMoreRef.current) return
    if (!fields.length) return
    setLoadingMore(true)
    loadingMoreRef.current = true
    setError(null)
    try {
      const nextPage = page + 1
      const res = await fetch(
        `/api/config/defineLayer/fields/${encodeURIComponent(selectedTableKey)}?page=${nextPage}&limit=${PAGE_SIZE}`
      )
      const body = await res.json()
      if (body.success && Array.isArray(body.data)) {
        if (body.data.length > 0) {
          setFields((prev) => [...prev, ...body.data])
          setPage(nextPage)
        }
        const newLen = fields.length + (body.data?.length ?? 0)
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
  }, [selectedTableKey, page, fields.length])

  useEffect(() => {
    if (selectedTableKey) loadFirstPage(selectedTableKey)
    else {
      setFields([])
      setTotal(0)
      setPage(1)
      setHasMore(false)
    }
  }, [selectedTableKey, loadFirstPage])

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_LOAD_THRESHOLD) {
      loadMore()
    }
  }, [loadMore])

  // 레이어 목록 검색 디바운스
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedLayerListSearch(layerListSearch), 300)
    return () => clearTimeout(timer)
  }, [layerListSearch])
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchName(searchName), 300)
    return () => clearTimeout(timer)
  }, [searchName])

  /** 왼쪽 패널: defineLayer 목록 + 그룹/테이블명/한글명 검색 */
  const filteredTables = useMemo(() => {
    if (!tables.length) return []
    let list = [...tables]
    if (!showPublicLayer) {
      list = list.filter(
        (t) => String((t as Record<string, unknown>).define_table_schema ?? "layer") !== "public_layer"
      )
    }
    if (debouncedLayerListSearch.trim()) {
      const q = debouncedLayerListSearch.trim().toLowerCase()
      list = list.filter((t) => {
        const r = t as Record<string, unknown>
        const group = String(r.define_table_group ?? "").toLowerCase()
        const name = String(r.define_table_name ?? "").toLowerCase()
        const kor = String(r.define_table_kor_name ?? "").toLowerCase()
        return group.includes(q) || name.includes(q) || kor.includes(q)
      })
    }
    return list
  }, [tables, debouncedLayerListSearch, showPublicLayer])

  const filteredFields = useMemo(() => {
    if (!fields.length) return []
    /** 목록에서 숨김: gid, geom */
    let list = fields.filter(
      (f) => !["gid", "geom"].includes(String(f.define_field_name ?? "").toLowerCase())
    )
    if (debouncedSearchName.trim()) {
      const n = debouncedSearchName.trim().toLowerCase()
      list = list.filter(
        (f) =>
          String(f.define_field_name ?? "").toLowerCase().includes(n) ||
          String(f.define_field_kor_name ?? "").toLowerCase().includes(n)
      )
    }
    return list
  }, [fields, debouncedSearchName])

  const updateCell = useCallback(
    (fieldIndex: number, key: string, value: string) => {
      const idx = fields.indexOf(filteredFields[fieldIndex])
      if (idx < 0) return
      const next = [...fields]
      next[idx] = { ...next[idx], [key]: value }
      setFields(next)
    },
    [fields, filteredFields]
  )

  const saveConfig = useCallback(async () => {
    if (!selectedTableKey) return
    setSaving(true)
    setSuccessMsg(null)
    setError(null)
    try {
      const fullRes = await fetch(
        `/api/config/defineLayer/fields/${encodeURIComponent(selectedTableKey)}`
      )
      const fullBody = await fullRes.json()
      let fullFields: DefineField[] =
        fullBody.success && Array.isArray(fullBody.data) ? fullBody.data : []
      const byKey = new Map<string, DefineField>()
      for (const f of fields) {
        const key = String(f.define_field_name ?? "")
        if (key) byKey.set(key, f)
      }
      fullFields = fullFields.map((f) => {
        const key = String(f.define_field_name ?? "")
        return byKey.get(key) ?? f
      })
      const res = await fetch(
        `/api/config/defineLayer/fields/${encodeURIComponent(selectedTableKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: fullFields }),
        }
      )
      const body = await res.json()
      if (body.success) setSuccessMsg("저장되었습니다.")
      else setError(body.error ?? "저장에 실패했습니다.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }, [selectedTableKey, fields])

  const selectedTable = tables.find(
    (t) => String((t as Record<string, unknown>).define_table_name ?? "") === selectedTableKey
  )
  const selectedTableName =
    selectedTable &&
    String(
      (selectedTable as Record<string, unknown>).define_table_kor_name ||
        (selectedTable as Record<string, unknown>).define_table_name ||
        selectedTableKey
    )

  if (loadingTables) return <p className="text-sm text-muted-foreground">테이블 목록 로딩 중...</p>

  return (
    <div
      className={cn(
        "flex gap-4 min-h-0 flex-1 overflow-hidden",
        embedded ? "h-full max-h-none p-2" : "max-h-[calc(100vh-14rem)]"
      )}
      style={embedded ? undefined : { minHeight: "50vh" }}
    >
      {!embedded && (
      <div
        className="shrink-0 flex flex-col border rounded-none bg-muted/20 overflow-hidden max-h-[calc(100vh-14rem)]"
        style={{ width: LAYER_LIST_WIDTH }}
      >
        <div className="shrink-0 p-2 border-b bg-muted/50 space-y-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showPublicLayer}
                onChange={(e) => setShowPublicLayer(e.target.checked)}
                className="rounded border-input"
              />
              public_layer 포함
            </label>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="레이어 검색 (그룹/테이블명/한글명)"
              value={layerListSearch}
              onChange={(e) => setLayerListSearch(e.target.value)}
              className="h-9 pl-8 rounded-md text-sm bg-background"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {filteredTables.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">검색 결과가 없습니다.</p>
          ) : (
            <ul className="py-0.5">
              {filteredTables.map((t) => {
                const key = String((t as Record<string, unknown>).define_table_name ?? "")
                const group = String((t as Record<string, unknown>).define_table_group ?? "")
                const name =
                  String((t as Record<string, unknown>).define_table_kor_name ?? "") ||
                  String((t as Record<string, unknown>).define_table_name ?? key)
                const isSelected = selectedTableKey === key
                const label = group ? `${group} - ${name}` : name
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setSelectedTableKey(key)}
                      title={label}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 text-sm border-l-2 transition-colors flex items-center min-w-0",
                        "hover:bg-muted/70",
                        isSelected
                          ? "border-l-primary bg-primary/10 text-foreground font-medium"
                          : "border-l-transparent text-muted-foreground"
                      )}
                    >
                      <span className="truncate block min-w-0">{label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden">
        {!selectedTableKey ? (
          <p className="text-sm text-muted-foreground py-4">
            {embedded
              ? "목록 탭에서 레이어를 선택하세요."
              : "왼쪽에서 레이어를 선택하면 해당 레이어의 속성(필드)을 편집할 수 있습니다."}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-wrap shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="rounded-md"
                onClick={saveConfig}
                disabled={saving}
              >
                <Save className="w-4 h-4 mr-1.5 opacity-70" />
                {saving ? "저장 중..." : "저장"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-md"
                onClick={() => {
                  setFields((prev) =>
                    prev.map((f) => ({ ...f, define_field_show_detail: "false" }))
                  )
                }}
                title="모든 필드의 상세보기를 false로 설정합니다. 저장 버튼으로 반영하세요."
              >
                상세보기 전체 해제
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-md"
                onClick={() => {
                  setSearchName("")
                  setDebouncedSearchName("")
                }}
              >
                <RotateCcw className="w-4 h-4 mr-1.5 opacity-70" />
                초기화
              </Button>
              {successMsg && <span className="text-sm text-green-600">{successMsg}</span>}
              {error && <span className="text-sm text-destructive">{error}</span>}
              <span className="text-sm text-muted-foreground">
                {fields.length} / {total}
              </span>
              <Input
                placeholder="필드명/한글명 검색"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="h-8 w-48 rounded-md text-sm"
              />
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground py-4 shrink-0">필드 로딩 중...</p>
            ) : (
              <div
                ref={parentRef}
                onScroll={handleScroll}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-auto border rounded-none bg-muted/20 w-full min-w-0"
              >
                <div
                  className="sticky top-0 z-10 bg-muted border-b w-full min-w-0"
                  style={{
                    display: "grid",
                    gridTemplateColumns: getGridTemplateColumns(),
                    width: "100%",
                  }}
                >
                  {/* 상단 분류 행 */}
                  {HEADER_CATEGORIES.map((cat) => (
                    <div
                      key={cat.label}
                      className="py-1 px-2 text-xs font-semibold border-r border-b border-muted-foreground/20 bg-muted/80 flex items-center justify-center text-center"
                      style={{ gridColumn: `span ${cat.keys.length}` }}
                    >
                      {cat.label}
                    </div>
                  ))}
                  {/* 컬럼명 행 */}
                  {FIELD_KEYS.map((key) => (
                    <div
                      key={key}
                      className="py-1 px-1 text-xs font-medium whitespace-nowrap border-r last:border-r-0 bg-muted border-b flex items-center justify-center text-center"
                    >
                      {COLUMN_LABELS[key] ?? key.replace(/^define_field_/, "")}
                    </div>
                  ))}
                </div>
                <div className="w-full min-w-0" style={{ width: "100%" }}>
                  {filteredFields.map((f, listIndex) => {
                    const fieldIdx = fields.indexOf(f)
                    if (fieldIdx < 0) return null
                    const row = f as Record<string, unknown>

                    return (
                      <div
                        key={fieldIdx}
                        className="grid border-b hover:bg-muted/50 w-full min-w-0"
                        style={{
                          gridTemplateColumns: getGridTemplateColumns(),
                          width: "100%",
                        }}
                      >
                        {FIELD_KEYS.map((key) => {
                          const val = String(row[key] ?? "")
                          const isBool = BOOL_FIELD_KEYS.has(key)
                          const isReadOnly = READONLY_FIELD_KEYS.has(key)
                          const isTypeSelect = key === "define_field_type"
                          const isSortTypeSelect = key === "define_field_sort_type"
                          return (
                            <div
                              key={key}
                              className={`py-0 px-1 overflow-hidden border-r last:border-r-0 flex items-center min-w-0 ${COLUMN_ALIGN_CENTER.has(key) ? "justify-center text-center" : ""}`}
                              style={{
                                minHeight: "28px",
                              }}
                            >
                              {isBool ? (
                                <label className="flex items-center justify-center gap-1 cursor-pointer w-full min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={val.toLowerCase() === "true"}
                                    onChange={(e) =>
                                      updateCell(listIndex, key, e.target.checked ? "true" : "false")
                                    }
                                    className="rounded border-input shrink-0"
                                  />
                                </label>
                              ) : isReadOnly ? (
                                <span className="block truncate text-sm font-mono py-1 min-w-0">{val}</span>
                              ) : isTypeSelect ? (
                                <select
                                  value={val}
                                  onChange={(e) => updateCell(listIndex, key, e.target.value)}
                                  className="h-6 w-full rounded-none text-sm font-mono border border-input bg-background py-0 px-1 min-w-0"
                                >
                                  {val &&
                                    !FIELD_TYPE_OPTIONS.includes(val as (typeof FIELD_TYPE_OPTIONS)[number]) && (
                                      <option value={val}>{val}</option>
                                    )}
                                  {FIELD_TYPE_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              ) : isSortTypeSelect ? (
                                <select
                                  value={val}
                                  onChange={(e) => updateCell(listIndex, key, e.target.value)}
                                  className="h-6 w-full rounded-none text-sm border border-input bg-background py-0 px-1 min-w-0"
                                >
                                  {val &&
                                    !SORT_TYPE_OPTIONS.includes(val as (typeof SORT_TYPE_OPTIONS)[number]) && (
                                      <option value={val}>{val}</option>
                                    )}
                                  {SORT_TYPE_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt === "DESC" ? "내림차순" : "오름차순"}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <Input
                                  value={val}
                                  onChange={(e) => updateCell(listIndex, key, e.target.value)}
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
                {!loadingMore && hasMore && total > fields.length && (
                  <div className="py-1 text-center text-xs text-muted-foreground">
                    아래로 스크롤하면 더 불러옵니다
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
