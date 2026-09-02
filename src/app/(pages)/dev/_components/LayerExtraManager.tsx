"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { Save, RotateCcw, Plus, Trash2, Search, AlertCircle, DatabaseZap } from "lucide-react"
import { cn } from "@/lib/utils"
import { call } from "@/lib/api"
import type { LayerDefineEmbedProps } from "./layerManager/types"
import { fetchDefineLayerTables, fetchLayerDbTableList } from "./layerManager/layerManagerListCache"

type DefineLayerTable = Record<string, unknown>

type ExtraDefRow = {
  fieldName: string
  dataType: string
  sortOrder: number
}

const LAYER_LIST_WIDTH = 280

type LayerFilterMode = "all" | "public_layer" | "layer"

const LAYER_FILTER_OPTIONS: { value: LayerFilterMode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "public_layer", label: "public_layer" },
  { value: "layer", label: "layer" },
]

const DATA_TYPE_OPTIONS = ["varchar", "integer", "date"]

export function LayerExtraManager({
  embedded = false,
  fixedTableKey = null,
}: LayerDefineEmbedProps = {}) {
  const [tables, setTables] = useState<DefineLayerTable[]>([])
  const [selectedTableKey, setSelectedTableKey] = useState<string>("")
  const [selectedSchema, setSelectedSchema] = useState<string>("layer")
  const [layerListSearch, setLayerListSearch] = useState("")
  const [debouncedLayerListSearch, setDebouncedLayerListSearch] = useState("")
  const [layerFilterMode, setLayerFilterMode] = useState<LayerFilterMode>("all")
  const [usedOnly, setUsedOnly] = useState(false)
  const [dbTableKeySet, setDbTableKeySet] = useState<Set<string>>(new Set())
  const [loadingTables, setLoadingTables] = useState(true)

  // 컬럼 상태
  const [checkingColumn, setCheckingColumn] = useState(false)
  const [hasExtraColumn, setHasExtraColumn] = useState<boolean | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)

  // 정의 항목
  const [items, setItems] = useState<ExtraDefRow[]>([])
  const [originalItems, setOriginalItems] = useState<ExtraDefRow[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // 신규 행 입력
  const [newFieldName, setNewFieldName] = useState("")
  const [newDataType, setNewDataType] = useState("text")
  const [newSortOrder, setNewSortOrder] = useState("")

  useEffect(() => {
    if (fixedTableKey) setSelectedTableKey(fixedTableKey)
  }, [fixedTableKey])

  useEffect(() => {
    let cancelled = false
    setLoadingTables(true)
    fetchDefineLayerTables()
      .then((body) => {
        if (cancelled) return
        if (body.success && Array.isArray(body.data)) setTables(body.data)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingTables(false))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchLayerDbTableList()
      .then((data) => {
        if (cancelled) return
        if (!data?.success || !Array.isArray(data.tables)) return
        const keys = new Set<string>(
          (data.tables as Array<{ schema: string; table: string }>).map(
            (t) => `${t.schema === "public_layer" ? "public_layer" : "layer"}:${String(t.table).toLowerCase()}`
          )
        )
        setDbTableKeySet(keys)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLayerListSearch(layerListSearch), 300)
    return () => clearTimeout(t)
  }, [layerListSearch])

  const filteredTables = useMemo(() => {
    let list = [...tables]
    if (layerFilterMode === "public_layer") {
      list = list.filter((t) => String((t as Record<string, unknown>).define_table_schema ?? "layer") === "public_layer")
    } else if (layerFilterMode === "layer") {
      list = list.filter((t) => String((t as Record<string, unknown>).define_table_schema ?? "layer") !== "public_layer")
    }
    if (usedOnly) {
      list = list.filter((t) => {
        const r = t as Record<string, unknown>
        const schema = String(r.define_table_schema ?? "layer") === "public_layer" ? "public_layer" : "layer"
        const name = String(r.define_table_name ?? "").trim().toLowerCase()
        return name && dbTableKeySet.has(`${schema}:${name}`)
      })
    }
    if (debouncedLayerListSearch.trim()) {
      const q = debouncedLayerListSearch.trim().toLowerCase()
      list = list.filter((t) => {
        const r = t as Record<string, unknown>
        return (
          String(r.define_table_group ?? "").toLowerCase().includes(q) ||
          String(r.define_table_name ?? "").toLowerCase().includes(q) ||
          String(r.define_table_kor_name ?? "").toLowerCase().includes(q)
        )
      })
    }
    return list
  }, [tables, debouncedLayerListSearch, layerFilterMode, usedOnly, dbTableKeySet])

  const checkColumn = useCallback(async (tableName: string, tableSchema: string) => {
    setCheckingColumn(true)
    setHasExtraColumn(null)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await call("", "POST", {
        service: "layerExtraService",
        action: "checkLayerExtraColumn",
        params: { tableName, tableSchema },
      })
      const data = res?.data ?? res
      setHasExtraColumn(data?.hasColumn === true)
      if (!data?.tableExists) setError("DB에서 테이블을 찾을 수 없습니다. «DB에 있는 레이어만» 필터를 켜 주세요.")
    } catch {
      setHasExtraColumn(false)
    } finally {
      setCheckingColumn(false)
    }
  }, [])

  const loadItems = useCallback(async (tableName: string, tableSchema: string) => {
    setLoadingItems(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await call("", "POST", {
        service: "layerExtraService",
        action: "getLayerExtraDefs",
        params: { tableName, tableSchema },
      })
      const data = res?.data ?? res
      if (data?.error) throw new Error(String(data.error))
      const next: ExtraDefRow[] = (Array.isArray(data?.items) ? data.items : []).map(
        (it: { fieldName?: string; dataType?: string; sortOrder?: number }, idx: number) => ({
          fieldName: String(it.fieldName ?? "").trim(),
          dataType: String(it.dataType ?? "text").trim() || "text",
          sortOrder: Number(it.sortOrder) || idx + 1,
        })
      )
      setItems(next)
      setOriginalItems(next.map((r) => ({ ...r })))
    } catch (e: unknown) {
      setItems([])
      setOriginalItems([])
      setError(e instanceof Error ? e.message : "정의 조회 실패")
    } finally {
      setLoadingItems(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedTableKey) {
      setItems([])
      setOriginalItems([])
      setHasExtraColumn(null)
      return
    }
    void checkColumn(selectedTableKey, selectedSchema)
  }, [selectedTableKey, selectedSchema, checkColumn])

  useEffect(() => {
    if (!selectedTableKey || hasExtraColumn !== true) return
    void loadItems(selectedTableKey, selectedSchema)
  }, [selectedTableKey, selectedSchema, hasExtraColumn, loadItems])

  const selectTable = (t: DefineLayerTable) => {
    const r = t as Record<string, unknown>
    const key = String(r.define_table_name ?? "")
    const schema = String(r.define_table_schema ?? "layer") === "public_layer" ? "public_layer" : "layer"
    setSelectedTableKey(key)
    setSelectedSchema(schema)
  }

  const handleAddColumn = async () => {
    if (!selectedTableKey) return
    setAddingColumn(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await call("", "POST", {
        service: "layerExtraService",
        action: "addLayerExtraColumn",
        params: { tableName: selectedTableKey, tableSchema: selectedSchema },
      })
      const data = res?.data ?? res
      if (data?.success === false || data?.error) throw new Error(String(data?.error ?? "컬럼 추가 실패"))
      setHasExtraColumn(true)
      setSuccessMsg("extra 컬럼이 추가되었습니다.")
      await loadItems(selectedTableKey, selectedSchema)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "컬럼 추가 실패")
    } finally {
      setAddingColumn(false)
    }
  }

  const addItem = () => {
    const fieldName = newFieldName.trim()
    if (!fieldName) { setError("속성명을 입력하세요."); return }
    if (items.some((it) => it.fieldName.toLowerCase() === fieldName.toLowerCase())) {
      setError("이미 있는 속성명입니다."); return
    }
    const sortOrder = newSortOrder.trim()
      ? Number(newSortOrder)
      : (items.reduce((m, it) => Math.max(m, it.sortOrder), 0) || 0) + 1
    setItems((prev) => [
      ...prev,
      { fieldName, dataType: newDataType.trim() || "text", sortOrder: Number.isFinite(sortOrder) ? sortOrder : prev.length + 1 },
    ])
    setNewFieldName("")
    setNewDataType("text")
    setNewSortOrder("")
    setError(null)
    setSuccessMsg(null)
  }

  const updateItem = (index: number, patch: Partial<ExtraDefRow>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
    setSuccessMsg(null)
  }

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
    setSuccessMsg(null)
  }

  const resetItems = () => {
    setItems(originalItems.map((r) => ({ ...r })))
    setError(null)
    setSuccessMsg(null)
  }

  const saveItems = async () => {
    if (!selectedTableKey) return
    setSaving(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await call("", "POST", {
        service: "layerExtraService",
        action: "saveLayerExtraDefs",
        params: { tableName: selectedTableKey, tableSchema: selectedSchema, items },
      })
      const data = res?.data ?? res
      if (data?.success === false || data?.error) throw new Error(String(data?.error ?? "저장 실패"))
      setSuccessMsg("저장되었습니다.")
      await loadItems(selectedTableKey, selectedSchema)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "저장 실패")
    } finally {
      setSaving(false)
    }
  }

  if (loadingTables) return <p className="p-4 text-sm text-muted-foreground">테이블 목록 로딩 중...</p>

  const canEdit = hasExtraColumn === true
  const showNoColumnWarning = !checkingColumn && hasExtraColumn === false && !!selectedTableKey

  return (
    <div
      className={cn("flex gap-4 min-h-0 flex-1 overflow-hidden w-full min-w-0 p-2", embedded && "h-full")}
      style={embedded ? undefined : { height: "calc(100vh - 14rem)" }}
    >
      {/* 레이어 목록 */}
      {!embedded && (
        <div
          className="shrink-0 flex flex-col border rounded-none bg-muted/20 overflow-hidden max-h-[calc(100vh-10rem)]"
          style={{ width: LAYER_LIST_WIDTH }}
        >
          <div className="shrink-0 p-2 border-b bg-muted/50 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 rounded-md border p-0.5 w-fit">
                {LAYER_FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLayerFilterMode(opt.value)}
                    className={cn(
                      "h-6 rounded-sm px-2 text-xs transition-colors",
                      layerFilterMode === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">총 {filteredTables.length}건</span>
            </div>
            <label className="flex items-center px-2 gap-1.5 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={usedOnly}
                onChange={(e) => setUsedOnly(e.target.checked)}
                className="rounded border-input"
              />
              접속 DB에 있는 레이어만
            </label>
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
              <p className="p-3 text-sm text-muted-foreground">레이어가 없습니다.</p>
            ) : (
              <ul className="py-0.5">
                {filteredTables.map((t) => {
                  const key = String((t as Record<string, unknown>).define_table_name ?? "")
                  const group = String((t as Record<string, unknown>).define_table_group ?? "")
                  const name =
                    String((t as Record<string, unknown>).define_table_kor_name ?? "") ||
                    String((t as Record<string, unknown>).define_table_name ?? key)
                  const label = group ? `${group} - ${name}` : name
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => selectTable(t)}
                        title={label}
                        className={cn(
                          "w-full text-left px-2.5 py-1.5 text-sm border-l-2 transition-colors flex items-center min-w-0 outline-none",
                          "hover:bg-primary/10 focus-visible:bg-primary/10",
                          selectedTableKey === key
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

      {/* 우측 정의 패널 */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden">

        {/* 저장·초기화 버튼 영역 (Code 탭 동일 스타일) */}
        <div className="flex items-center gap-3 flex-wrap shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="rounded-md"
            disabled={!canEdit || saving}
            onClick={() => void saveItems()}
          >
            <Save className="w-4 h-4 mr-1.5 opacity-70" />
            {saving ? "저장 중..." : "저장"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-md"
            disabled={!canEdit || saving}
            onClick={resetItems}
          >
            <RotateCcw className="w-4 h-4 mr-1.5 opacity-70" />
            초기화
          </Button>
          {successMsg && <span className="text-sm text-green-600">{successMsg}</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
          {canEdit && <span className="text-sm text-muted-foreground">{items.length}개</span>}
        </div>

        {/* 추가 입력 + 목록 — 항상 표시, canEdit=false 시 disabled */}
        {(
          <div className="flex-1 min-h-0 overflow-hidden w-full min-w-0 flex flex-col gap-2">

            {/* 추가 입력 행 (Code 탭 동일 스타일) */}
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 border border-border bg-muted/20 p-2 shrink-0 items-center">
              <Input
                placeholder="속성명"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                className="h-8 rounded-none text-sm"
                disabled={!canEdit}
              />
              <select
                value={newDataType}
                onChange={(e) => setNewDataType(e.target.value)}
                disabled={!canEdit}
                className="h-8 rounded-md border border-input bg-background px-1 text-sm disabled:opacity-40"
              >
                {DATA_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <Input
                placeholder="순서"
                value={newSortOrder}
                onChange={(e) => setNewSortOrder(e.target.value)}
                className="h-8 rounded-none text-sm"
                disabled={!canEdit}
              />
              <Button
                variant="outline"
                size="sm"
                className="rounded-md shrink-0 w-fit"
                disabled={!canEdit}
                onClick={addItem}
              >
                <Plus className="w-4 h-4 mr-1.5 opacity-70" />
                추가
              </Button>
            </div>

            {/* 2열 목록 */}
            <div className="flex-1 min-h-0 flex flex-col border border-border bg-muted/20 w-full min-w-0 overflow-hidden">
              {/* 헤더 — 2열, 데이터 행과 동일한 grid + 셀 구조 */}
              <div className="grid grid-cols-2 border-b bg-muted shrink-0 sticky top-0 z-10">
                {[0, 1].map((col) => (
                  <div
                    key={col}
                    className={cn(
                      "grid grid-cols-[1fr_1fr_100px_100px_100px] gap-x-1 items-stretch text-xs font-medium text-foreground",
                      col === 0 && "border-r border-border/60"
                    )}
                  >
                    <div className="px-1 py-1 flex items-center min-w-0">레이어명</div>
                    <div className="px-1 py-1 flex items-center min-w-0">속성명</div>
                    <div className="px-1 py-1 flex items-center justify-center shrink-0">데이터타입</div>
                    <div className="px-1 py-1 flex items-center justify-center shrink-0">순서</div>
                    <div className="px-1 py-1 flex items-center justify-center shrink-0">삭제</div>
                  </div>
                ))}
              </div>

              {/* 본문 스크롤 영역 */}
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-background min-w-0">
                {!selectedTableKey ? (
                  <p className="p-4 text-sm text-muted-foreground">왼쪽에서 레이어를 선택하세요.</p>
                ) : checkingColumn ? (
                  <p className="p-4 text-sm text-muted-foreground">컬럼 확인 중...</p>
                ) : showNoColumnWarning ? (
                  <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
                    <AlertCircle className="h-6 w-6 text-amber-400" />
                    <div className="space-y-1">
                      <p className="text-xs font-medium">
                        이 레이어에 <code className="rounded bg-muted px-1 py-0.5">extra</code> 컬럼이 없습니다.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        추가속성을 사용하려면 DB에 extra(jsonb) 컬럼을 먼저 추가하세요.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="rounded-md gap-1.5"
                      disabled={addingColumn}
                      onClick={() => void handleAddColumn()}
                    >
                      <DatabaseZap className="w-4 h-4 mr-0.5 opacity-70" />
                      {addingColumn ? "추가 중..." : "extra 컬럼 추가"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      추가되는 컬럼: <code className="rounded bg-muted px-1 py-0.5">extra / jsonb / 추가속성</code>
                    </p>
                  </div>
                ) : loadingItems ? (
                  <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>
                ) : items.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    정의된 추가속성이 없습니다. 위에서 속성명·타입·순서를 입력하고 「추가」를 누르세요.
                  </p>
                ) : (
                  (() => {
                    const totalRows = Math.ceil(items.length / 2)
                    return Array.from({ length: totalRows }, (_, rowIdx) => {
                      const isLast = rowIdx === totalRows - 1
                      return (
                        <div key={rowIdx} className={cn("grid grid-cols-2", isLast && "border-b border-border")}>
                          {[0, 1].map((col) => {
                            const idx = rowIdx * 2 + col
                            const row = items[idx]
                            const orig = originalItems[idx]
                            const isDirty = row && orig && (
                              row.fieldName !== orig.fieldName ||
                              row.dataType !== orig.dataType ||
                              row.sortOrder !== orig.sortOrder
                            )
                            if (!row) {
                              return <div key={col} className={cn("min-h-[28px]", col === 0 && "border-r border-border/60")} />
                            }
                            return (
                              <div
                                key={col}
                                className={cn(
                                  "grid grid-cols-[1fr_1fr_100px_100px_100px] gap-x-1 items-stretch",
                                  col === 0 && "border-r border-border/60"
                                )}
                              >
                                {/* 레이어명 — Input에 bg-muted 직접 */}
                                <div className="px-1 py-1 flex items-center min-w-0">
                                  <Input
                                    value={selectedTableKey}
                                    readOnly
                                    tabIndex={-1}
                                    className="h-7 rounded-none text-sm min-w-0 bg-muted text-muted-foreground cursor-default focus-visible:ring-0"
                                    title={selectedTableKey}
                                  />
                                </div>
                                {/* 속성명 */}
                                <div className="px-1 py-1 flex items-center min-w-0">
                                  <Input
                                    value={row.fieldName}
                                    onChange={(e) => updateItem(idx, { fieldName: e.target.value })}
                                    className={cn(
                                      "h-7 rounded-none text-sm min-w-0 hover:bg-amber-100/40 dark:hover:bg-amber-600/20",
                                      isDirty && "bg-amber-100/40 dark:bg-amber-600/20"
                                    )}
                                  />
                                </div>
                                {/* 데이터타입 */}
                                <div className="px-1 py-1 flex items-center justify-center shrink-0">
                                  <select
                                    value={row.dataType}
                                    onChange={(e) => updateItem(idx, { dataType: e.target.value })}
                                    className={cn(
                                      "h-7 w-full rounded-none border border-input px-1 text-sm text-center hover:bg-amber-100/40 dark:hover:bg-amber-600/20",
                                      isDirty ? "bg-amber-100/40 dark:bg-amber-600/20" : "bg-background"
                                    )}
                                  >
                                    {DATA_TYPE_OPTIONS.map((t) => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                </div>
                                {/* 순서 */}
                                <div className="px-1 py-1 flex items-center justify-center shrink-0">
                                  <Input
                                    value={String(row.sortOrder)}
                                    onChange={(e) => updateItem(idx, { sortOrder: Number(e.target.value) || 0 })}
                                    className={cn(
                                      "h-7 rounded-none text-sm min-w-0 text-center hover:bg-amber-100/40 dark:hover:bg-amber-600/20",
                                      isDirty && "bg-amber-100/40 dark:bg-amber-600/20"
                                    )}
                                  />
                                </div>
                                {/* 삭제 */}
                                <div className="px-1 py-1 flex items-center justify-center shrink-0">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-7 w-full rounded-none text-xs text-muted-foreground hover:text-destructive gap-0"
                                    onClick={() => removeItem(idx)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    삭제
                                  </Button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })
                  })()
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
