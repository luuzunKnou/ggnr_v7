"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import { Save, RotateCcw } from "lucide-react"

type DefineLayerTable = Record<string, unknown> & { fields?: unknown[] }
type DefineLayerConfig = { version?: string; generatedAt?: string; tables: DefineLayerTable[] }

const TABLE_KEYS = [
  "define_table_group",
  "define_table_name",
  "define_table_kor_name",
  "define_table_idx",
  "define_table_shp_type",
  "define_table_read_share",
  "define_table_write_share",
  "define_table_etc",
]

const BOOL_TABLE_KEYS = new Set<string>()
const READONLY_TABLE_KEYS = new Set(["define_table_name"])
const SHAPE_TYPE_OPTIONS = ["POLYGON", "LINE", "POINT"] as const
const SHARE_OPTIONS = [
  { label: "전체", value: "P" },
  { label: "부서", value: "G" },
  { label: "개인", value: "O" },
] as const
const SHARE_KEYS = new Set(["define_table_read_share", "define_table_write_share"])

const COLUMN_LABELS: Record<string, string> = {
  define_table_name: "테이블명",
  define_table_kor_name: "한글명",
  define_table_shp_type: "도형",
  define_table_read_share: "읽기",
  define_table_write_share: "쓰기",
  define_table_group: "그룹",
  define_table_idx: "순서",
  define_table_etc: "비고",
}

const COLUMN_WIDTHS: Record<string, string> = {
  define_table_name: "15%",
  define_table_kor_name: "15%",
  define_table_read_share: "70px",
  define_table_write_share: "70px",
  define_table_idx: "44px",
  define_table_etc: "40%",
}

const COLUMN_ALIGN_CENTER = new Set(["define_table_idx"])

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
        const key = String((t as Record<string, unknown>).define_table_key ?? "")
        if (key) byKey.set(key, t)
      }
      fullTables = fullTables.map((t) => {
        const key = String((t as Record<string, unknown>).define_table_key ?? "")
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
            {TABLE_KEYS.map((key) => (
              <div
                key={key}
                className={`py-1 px-1 text-xs font-medium whitespace-nowrap border-r last:border-r-0 bg-muted ${COLUMN_ALIGN_CENTER.has(key) ? "text-center flex justify-center items-center" : ""}`}
                style={{
                  width: COLUMN_WIDTHS[key] || "auto",
                  flex: COLUMN_WIDTHS[key] ? undefined : 1,
                }}
              >
                {COLUMN_LABELS[key] ?? key.replace(/^define_table_/, "")}
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

            return (
              <div
                key={String(row.define_table_key ?? listIndex)}
                className="flex border-b hover:bg-muted/50"
              >
                {TABLE_KEYS.map((key) => {
                  const val = String(row[key] ?? "")
                  const isBool = BOOL_TABLE_KEYS.has(key)
                  const isReadOnly = READONLY_TABLE_KEYS.has(key)
                  const isShapeType = key === "define_table_shp_type"
                  const isShareType = SHARE_KEYS.has(key)
                  return (
                    <div
                      key={key}
                      className={`py-0 px-1 overflow-hidden border-r last:border-r-0 flex items-center ${COLUMN_ALIGN_CENTER.has(key) ? "justify-center text-center" : ""}`}
                      style={{
                        width: COLUMN_WIDTHS[key] || "auto",
                        flex: COLUMN_WIDTHS[key] ? undefined : 1,
                        minHeight: "28px",
                      }}
                    >
                      {isBool ? (
                        <label className="flex items-center justify-center gap-1 cursor-pointer w-full">
                          <input
                            type="checkbox"
                            checked={val.toLowerCase() === "true"}
                            onChange={(e) =>
                              updateCell(tableIdx, key, e.target.checked ? "true" : "false")
                            }
                            className="rounded border-input"
                          />
                        </label>
                      ) : isReadOnly ? (
                        <span className="block truncate text-sm font-mono py-1">
                          {val}
                        </span>
                      ) : isShapeType ? (
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
                      ) : isShareType ? (
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
    </div>
  )
}
