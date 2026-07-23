"use client"

import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { Save, RotateCcw, Search, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { call } from "@/lib/api"
import type { LayerDefineEmbedProps } from "./layerManager/types"

type DefineLayerTable = Record<string, unknown>
type DefineField = Record<string, unknown>
type DefineCode = Record<string, unknown>

const LAYER_LIST_WIDTH = 280
const FIELD_LIST_WIDTH = 280

type LayerFilterMode = "all" | "public_layer" | "layer"

const LAYER_FILTER_OPTIONS: { value: LayerFilterMode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "public_layer", label: "public_layer" },
  { value: "layer", label: "layer" },
]

export function LayerCodeManager({
  embedded = false,
  fixedTableKey = null,
}: LayerDefineEmbedProps = {}) {
  const [tables, setTables] = useState<DefineLayerTable[]>([])
  const [codeTableKeys, setCodeTableKeys] = useState<Set<string>>(new Set())
  const [selectedTableKey, setSelectedTableKey] = useState<string>("")
  const [layerListSearch, setLayerListSearch] = useState("")
  const [debouncedLayerListSearch, setDebouncedLayerListSearch] = useState("")
  const [layerFilterMode, setLayerFilterMode] = useState<LayerFilterMode>("all")
  const [usedOnly, setUsedOnly] = useState(false)
  const [dbTableKeySet, setDbTableKeySet] = useState<Set<string>>(new Set())
  const [fields, setFields] = useState<DefineField[]>([])
  const [codeFields, setCodeFields] = useState<DefineField[]>([])
  const [fieldListSearch, setFieldListSearch] = useState("")
  const [debouncedFieldListSearch, setDebouncedFieldListSearch] = useState("")
  const [selectedFieldKey, setSelectedFieldKey] = useState<string>("")
  const [codes, setCodes] = useState<DefineCode[]>([])
  const originalCodesRef = useRef<Map<number, Record<string, unknown>>>(new Map())
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(new Set())
  const [loadingTables, setLoadingTables] = useState(true)
  const [loadingFields, setLoadingFields] = useState(false)
  const [loadingCodes, setLoadingCodes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [newCodeName, setNewCodeName] = useState("")
  const [newCodeKorName, setNewCodeKorName] = useState("")
  const fieldListContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (fixedTableKey) setSelectedTableKey(fixedTableKey)
  }, [fixedTableKey])

  // CODE 필드가 있는 테이블 키 목록
  useEffect(() => {
    let cancelled = false
    fetch("/api/config/defineLayer/codeTables")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return
        if (body.success && Array.isArray(body.tableKeys)) {
          setCodeTableKeys(new Set(body.tableKeys))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 테이블 목록 (전체)
  useEffect(() => {
    let cancelled = false
    setLoadingTables(true)
    fetch("/api/config/defineLayer")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return
        if (body.success && Array.isArray(body.data)) {
          setTables(body.data)
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "테이블 목록 로드 실패"))
      .finally(() => !cancelled && setLoadingTables(false))
    return () => { cancelled = true }
  }, [])

  /** "사용중" 필터용 — 현재 접속된 DB(layer/public_layer 스키마)에 실제로 존재하는 테이블 목록 */
  useEffect(() => {
    let cancelled = false
    call("", "POST", { service: "devTestService", action: "getLayerTableList", params: {} })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        if (!data?.success || !Array.isArray(data.tables)) return
        const keys = new Set<string>(
          (data.tables as Array<{ schema: string; table: string }>).map(
            (t) => `${t.schema === "public_layer" ? "public_layer" : "layer"}:${String(t.table).toLowerCase()}`
          )
        )
        setDbTableKeySet(keys)
      })
      .catch(() => {
        // 조회 실패해도 "사용중" 필터만 못 쓰게 되고 나머지는 정상 동작
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 선택한 테이블의 필드 로드 → CODE 타입만
  useEffect(() => {
    if (!selectedTableKey) {
      setFields([])
      setCodeFields([])
      setSelectedFieldKey("")
      setCodes([])
      return
    }
    setLoadingFields(true)
    setSelectedFieldKey("")
    setCodes([])
    fetch(`/api/config/defineLayer/fields/${encodeURIComponent(selectedTableKey)}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.success && Array.isArray(body.data)) {
          setFields(body.data)
          const codeOnly = body.data.filter(
            (f: DefineField) => String((f as Record<string, unknown>).define_field_type ?? "").toUpperCase() === "CODE"
          )
          setCodeFields(codeOnly)
        } else {
          setFields([])
          setCodeFields([])
        }
      })
      .catch(() => {
        setFields([])
        setCodeFields([])
      })
      .finally(() => setLoadingFields(false))
  }, [selectedTableKey])

  // 선택한 필드의 코드 로드
  useEffect(() => {
    if (!selectedFieldKey) {
      setCodes([])
      setDeletedIndices(new Set())
      originalCodesRef.current = new Map()
      return
    }
    setLoadingCodes(true)
    setDeletedIndices(new Set())
    fetch(`/api/config/defineLayer/codes/${encodeURIComponent(selectedFieldKey)}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.success && Array.isArray(body.data)) {
          setCodes(body.data)
          originalCodesRef.current = new Map(
            (body.data as Record<string, unknown>[]).map((c, idx) => [idx, c])
          )
        } else {
          setCodes([])
          originalCodesRef.current = new Map()
        }
      })
      .catch(() => setCodes([]))
      .finally(() => setLoadingCodes(false))
  }, [selectedFieldKey])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLayerListSearch(layerListSearch), 300)
    return () => clearTimeout(t)
  }, [layerListSearch])
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFieldListSearch(fieldListSearch), 300)
    return () => clearTimeout(t)
  }, [fieldListSearch])

  /** defineLayer 중 CODE 필드가 있는 테이블 + 검색 */
  const filteredTables = useMemo(() => {
    let list = tables.filter((t) => codeTableKeys.has(String((t as Record<string, unknown>).define_table_name ?? "")))
    if (layerFilterMode === "public_layer") {
      list = list.filter(
        (t) => String((t as Record<string, unknown>).define_table_schema ?? "layer") === "public_layer"
      )
    } else if (layerFilterMode === "layer") {
      list = list.filter(
        (t) => String((t as Record<string, unknown>).define_table_schema ?? "layer") !== "public_layer"
      )
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
        const group = String(r.define_table_group ?? "").toLowerCase()
        const name = String(r.define_table_name ?? "").toLowerCase()
        const kor = String(r.define_table_kor_name ?? "").toLowerCase()
        return group.includes(q) || name.includes(q) || kor.includes(q)
      })
    }
    return list
  }, [tables, codeTableKeys, debouncedLayerListSearch, layerFilterMode, usedOnly, dbTableKeySet])

  /** 필드 목록 검색 필터 */
  const filteredCodeFields = useMemo(() => {
    if (!codeFields.length) return []
    let list = [...codeFields]
    if (debouncedFieldListSearch.trim()) {
      const q = debouncedFieldListSearch.trim().toLowerCase()
      list = list.filter(
        (f) =>
          String(f.define_field_name ?? "").toLowerCase().includes(q) ||
          String(f.define_field_kor_name ?? "").toLowerCase().includes(q)
      )
    }
    return list
  }, [codeFields, debouncedFieldListSearch])

  const updateCodeCell = useCallback(
    (index: number, key: "define_code_name" | "define_code_kor_name", value: string) => {
      setCodes((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [key]: value }
        return next
      })
    },
    []
  )

  const toggleDelete = useCallback((idx: number) => {
    setDeletedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const addCode = useCallback(() => {
    setCodes((prev) => [
      ...prev,
      { define_code_name: newCodeName.trim(), define_code_kor_name: newCodeKorName.trim() },
    ])
    setNewCodeName("")
    setNewCodeKorName("")
  }, [newCodeName, newCodeKorName])

  const saveConfig = useCallback(async () => {
    if (!selectedFieldKey) return
    setSaving(true)
    setSuccessMsg(null)
    setError(null)
    try {
      const toSave = codes.filter((_, idx) => !deletedIndices.has(idx))
      const res = await fetch(`/api/config/defineLayer/codes/${encodeURIComponent(selectedFieldKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: toSave }),
      })
      const body = await res.json()
      if (body.success) {
        setCodes(toSave)
        originalCodesRef.current = new Map(
          (toSave as Record<string, unknown>[]).map((c, idx) => [idx, c])
        )
        setDeletedIndices(new Set())
        setSuccessMsg("저장되었습니다.")
      } else setError(body.error ?? "저장에 실패했습니다.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }, [selectedFieldKey, codes, deletedIndices])

  if (loadingTables) return <p className="text-sm text-muted-foreground">테이블 목록 로딩 중...</p>

  return (
    <div
      className={cn(
        "flex gap-4 min-h-0 flex-1 overflow-hidden w-full min-w-0 p-2",
        embedded && "h-full"
      )}
      style={embedded ? undefined : { height: "calc(100vh - 14rem)" }}
    >
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
            <p className="p-3 text-sm text-muted-foreground">CODE 필드가 있는 레이어가 없습니다.</p>
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
                      onKeyDown={(e) => {
                        if (e.key === "ArrowRight") {
                          e.preventDefault()
                          fieldListContainerRef.current
                            ?.querySelector<HTMLButtonElement>("button")
                            ?.focus()
                        }
                      }}
                      title={label}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 text-sm border-l-2 transition-colors flex items-center min-w-0 outline-none",
                        "hover:bg-primary/10 focus-visible:bg-primary/10",
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

      <div
        className={cn(
          "shrink-0 flex flex-col border rounded-none bg-muted/20 overflow-hidden",
          embedded ? "h-full" : "max-h-[calc(100vh-14rem)]"
        )}
        style={{ width: FIELD_LIST_WIDTH }}
      >
        <div className="shrink-0 p-2 border-b bg-muted/50">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="필드 검색 (영문명/한글명)"
              value={fieldListSearch}
              onChange={(e) => setFieldListSearch(e.target.value)}
              className="h-9 pl-8 rounded-md text-sm bg-background"
              disabled={!selectedTableKey}
            />
          </div>
        </div>
        <div ref={fieldListContainerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {!selectedTableKey ? (
            <p className="p-3 text-sm text-muted-foreground">
              {embedded ? "목록 탭에서 레이어를 선택하세요." : "레이어를 선택하세요."}
            </p>
          ) : loadingFields ? (
            <p className="p-3 text-sm text-muted-foreground">필드 로딩 중...</p>
          ) : filteredCodeFields.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">CODE 필드가 없습니다.</p>
          ) : (
            <ul className="py-0.5">
              {filteredCodeFields.map((f) => {
                const fieldName = String(f.define_field_name ?? "")
                const key = selectedTableKey ? `${selectedTableKey}__${fieldName}` : fieldName
                const name =
                  String(f.define_field_kor_name ?? "") || fieldName || key
                const isSelected = selectedFieldKey === key
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setSelectedFieldKey(key)}
                      title={name}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 text-sm border-l-2 transition-colors flex items-center min-w-0 outline-none",
                        "hover:bg-primary/10 focus-visible:bg-primary/10",
                        isSelected
                          ? "border-l-primary bg-primary/10 text-foreground font-medium"
                          : "border-l-transparent text-muted-foreground"
                      )}
                    >
                      <span className="truncate block min-w-0">{name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* 3. 오른쪽: 코드 그리드 (코드명, 한글명, 삭제) */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden">
        {!selectedFieldKey ? (
          <p className="text-sm text-muted-foreground py-4">
            {embedded
              ? "CODE 타입 필드를 선택하면 코드 목록을 편집할 수 있습니다."
              : "왼쪽에서 레이어를, 가운데에서 CODE 필드를 선택하면 코드 목록을 편집할 수 있습니다."}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-wrap shrink-0">
              <Button variant="outline" size="sm" className="rounded-md" onClick={saveConfig} disabled={saving}>
                <Save className="w-4 h-4 mr-1.5 opacity-70" />
                {saving ? "저장 중..." : "저장"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-md"
                onClick={() => {
                  setFieldListSearch("")
                  setDebouncedFieldListSearch("")
                }}
              >
                <RotateCcw className="w-4 h-4 mr-1.5 opacity-70" />
                초기화
              </Button>
              {successMsg && <span className="text-sm text-green-600">{successMsg}</span>}
              {error && <span className="text-sm text-destructive">{error}</span>}
              <span className="text-sm text-muted-foreground">{codes.length}개</span>
            </div>
            {loadingCodes ? (
              <p className="text-sm text-muted-foreground py-4 shrink-0">코드 로딩 중...</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-hidden w-full min-w-0 flex flex-col gap-2">
                {/* 추가 행: 코드명·한글명 입력 후 표에 추가 */}
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 border border-border bg-muted/20 p-2 shrink-0 items-center">
                  <Input
                    placeholder="코드명"
                    value={newCodeName}
                    onChange={(e) => setNewCodeName(e.target.value)}
                    className="h-8 rounded-none text-sm"
                  />
                  <Input
                    placeholder="한글명"
                    value={newCodeKorName}
                    onChange={(e) => setNewCodeKorName(e.target.value)}
                    className="h-8 rounded-none text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-md shrink-0 w-fit"
                    onClick={addCode}
                    disabled={!selectedFieldKey}
                  >
                    <Plus className="w-4 h-4 mr-1 opacity-70" />
                    추가
                  </Button>
                </div>
                {/* 단일 표, 세로 3열: 내용이 길면 표 안에 세로 스크롤 */}
                <div className="flex-1 min-h-0 flex flex-col border border-border bg-muted/20 w-full min-w-0 overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,0.8fr)_1fr_minmax(3.5rem,3.5rem)_minmax(0,0.8fr)_1fr_minmax(3.5rem,3.5rem)_minmax(0,0.8fr)_1fr_minmax(3.5rem,3.5rem)] gap-x-2 border-b border-border bg-muted shrink-0 min-w-0">
                    {[0, 1, 2].map((i) => (
                      <Fragment key={i}>
                        <div className="py-1 px-1.5 text-xs font-medium flex items-center justify-start text-left text-foreground min-w-0">
                          코드명
                        </div>
                        <div className="py-1 px-1.5 text-xs font-medium flex items-center justify-start text-left text-foreground min-w-0">
                          한글명
                        </div>
                        <div className={cn(
                          "py-1 px-1.5 pr-[23px] text-xs font-medium flex items-center justify-start text-left text-foreground min-w-14 shrink-0 whitespace-nowrap",
                          i < 2 && "border-r border-border/60"
                        )}>
                          삭제
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-background min-w-0">
                    {Array.from({ length: Math.ceil(codes.length / 3) }, (_, rowIndex) => {
                      const totalRows = Math.ceil(codes.length / 3)
                      const idx0 = rowIndex * 3
                      const idx1 = idx0 + 1
                      const idx2 = idx0 + 2
                      const isLastRow = rowIndex === totalRows - 1
                      const showBorder = (rowIndex + 1) % 5 === 0 || isLastRow
                      return (
                        <div
                          key={rowIndex}
                          className={cn(
                            "grid grid-cols-[minmax(0,0.8fr)_1fr_minmax(3.5rem,3.5rem)_minmax(0,0.8fr)_1fr_minmax(3.5rem,3.5rem)_minmax(0,0.8fr)_1fr_minmax(3.5rem,3.5rem)] gap-x-2 border-border min-w-0",
                            showBorder && "border-b"
                          )}
                        >
                          {[idx0, idx1, idx2].map((idx, groupIndex) => {
                            if (idx >= codes.length) {
                              return (
                                <div key={idx} className="contents">
                                  <div className="min-h-[28px] min-w-0" />
                                  <div className="min-h-[28px] min-w-0" />
                                  <div className={cn(
                                    "min-h-[28px] min-w-14 shrink-0 pr-[23px]",
                                    groupIndex < 2 && "border-r border-border/60"
                                  )} />
                                </div>
                              )
                            }
                            const row = codes[idx]
                            const isDeleted = deletedIndices.has(idx)
                            const originalRow = originalCodesRef.current.get(idx)
                            const isDirty =
                              !originalRow ||
                              String(row.define_code_kor_name ?? "") !== String(originalRow.define_code_kor_name ?? "")
                            return (
                              <div
                                key={idx}
                                className={cn(
                                  "contents",
                                  isDeleted && "[&>*]:opacity-50"
                                )}
                              >
                                <div className="py-0 px-1 flex items-center min-h-[28px] min-w-0">
                                  <span className="text-sm font-mono text-primary truncate block py-1">
                                    {String(row.define_code_name ?? "")}
                                  </span>
                                </div>
                                <div
                                  className={cn(
                                    "py-0 px-1 flex items-center min-h-[28px] hover:bg-amber-100/40 dark:hover:bg-amber-600/20",
                                    isDirty && "bg-amber-100/40 dark:bg-amber-600/20"
                                  )}
                                >
                                  <Input
                                    value={String(row.define_code_kor_name ?? "")}
                                    onChange={(e) => updateCodeCell(idx, "define_code_kor_name", e.target.value)}
                                    className="h-6 rounded-none text-sm min-w-0 py-0 px-1 bg-transparent"
                                  />
                                </div>
                                <div className={cn(
                                  "py-0 px-1 pr-[23px] flex items-center justify-center min-h-[28px] min-w-14 shrink-0",
                                  groupIndex < 2 && "border-r border-border/60"
                                )}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 rounded-none text-xs text-muted-foreground hover:text-destructive gap-0"
                                    onClick={() => toggleDelete(idx)}
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
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
