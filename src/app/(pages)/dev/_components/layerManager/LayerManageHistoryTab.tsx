"use client"

/**
 * 데이터 이력관리 — data_log / data_detail_log 통합 목록·상세
 */
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import {
  HelpCircle,
  Search,
  RotateCcw,
  Undo2,
  Loader2,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from "lucide-react"
import { call } from "@/lib/api"
import { GeoJsonMiniMap } from "../shp/GeoJsonMiniMap"

const WORK_TYPES = ["전체", "되돌리기", "삭제", "수정", "저장", "조회", "추가"] as const
type WorkType = (typeof WORK_TYPES)[number]

/** 구분 상단 고정 — 전체 / SHP·Excel 업로드 / 레이어 관리 (+ 하단 동적 서비스) */
const PINNED_CATEGORIES = [
  "전체",
  "SHP 업로드",
  "Excel 업로드",
  "레이어 관리(개발자모드)",
] as const
type PinnedCategory = (typeof PINNED_CATEGORIES)[number]
type CategoryFilter = PinnedCategory | string

type DetailAttr = {
  name: string
  before?: string
  after?: string
  value?: string
  ddKey?: number
  colName?: string
  canRevert?: boolean
}

type HistoryRow = {
  id: string
  date: string
  userId: string
  userName: string
  category: string
  groupName: string
  layerName: string
  keyField: string
  keyValue: string
  saveType?: string
  workType: Exclude<WorkType, "전체">
  source: "지도" | "SHP" | "Excel"
  canDetail: boolean
  batchKey?: string | null
  canRevertAll?: boolean
  details?: DetailAttr[]
}

const PAGE_SIZE = 20

function defaultRange() {
  const now = new Date()
  const end = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now)
  const startDate = new Date(now)
  startDate.setMonth(startDate.getMonth() - 1)
  const start = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(startDate)
  return {
    startDate: start.replace(/-/g, ""),
    endDate: end.replace(/-/g, ""),
  }
}

function toInputDate(ymd: string): string {
  if (/^\d{8}$/.test(ymd)) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  }
  return ymd
}

/** 빈 메타 값 → em dash (레이어 관리 목록과 동일) */
function cellText(v: string | null | undefined): string {
  const s = String(v ?? "").trim()
  return s || "—"
}

const GEOM_COL_NAMES = new Set(["geom", "geometry", "the_geom", "shape"])

function isGeomAttr(d: DetailAttr): boolean {
  const col = String(d.colName ?? "").trim().toLowerCase()
  if (GEOM_COL_NAMES.has(col)) return true
  const n = String(d.name ?? "").trim().toLowerCase()
  if (GEOM_COL_NAMES.has(n)) return true
  return /^(geom|geometry|the_geom|shape)\s*\(/.test(n)
}

function parseGeoJsonGeometry(raw?: string): Record<string, unknown> | null {
  const s = String(raw ?? "").trim()
  if (!s.startsWith("{")) return null
  try {
    const parsed = JSON.parse(s) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object") return null
    if (parsed.type === "Feature" && parsed.geometry && typeof parsed.geometry === "object") {
      const g = parsed.geometry as Record<string, unknown>
      if (g.type && ("coordinates" in g || "geometries" in g)) return g
      return null
    }
    if (parsed.type && ("coordinates" in parsed || "geometries" in parsed)) return parsed
    return null
  } catch {
    return null
  }
}

function GeomEmptySlot({ label, text }: { label?: string; text?: string }) {
  return (
    <div>
      {label ? (
        <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">{label}</h4>
      ) : null}
      <div className="flex h-[180px] items-center justify-center rounded border bg-muted/20 text-xs text-muted-foreground">
        {cellText(text)}
      </div>
    </div>
  )
}

function GeomPreviewSlot({ label, raw }: { label?: string; raw?: string }) {
  const geom = parseGeoJsonGeometry(raw)
  if (geom) {
    return <GeoJsonMiniMap geometry={geom} dataProjection="EPSG:5181" label={label} />
  }
  return <GeomEmptySlot label={label} text={raw} />
}

export function LayerManageHistoryTab() {
  const initial = defaultRange()
  const [startDate, setStartDate] = useState(initial.startDate)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [workType, setWorkType] = useState<WorkType>("전체")
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("전체")
  const [serviceOptions, setServiceOptions] = useState<string[]>([])
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({
    startDate: initial.startDate,
    endDate: initial.endDate,
    workType: "전체" as WorkType,
    category: "전체" as CategoryFilter,
    keyword: "",
  })
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<HistoryRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "dataHistoryService",
        action: "getDataHistoryList",
        params: {
          startDate: applied.startDate,
          endDate: applied.endDate,
          workType: applied.workType,
          category: applied.category,
          keyword: applied.keyword,
          page,
          limit: PAGE_SIZE,
        },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setRows([])
        setTotal(0)
        setError(data?.error ?? "목록을 불러오지 못했습니다.")
        return
      }
      setRows((data.data as HistoryRow[]) ?? [])
      setTotal(Number(data.total ?? 0))
      // 구분 옵션도 갱신 (신규 서비스 반영)
      try {
        const optRes = await call("", "POST", {
          service: "dataHistoryService",
          action: "getDataHistoryCategoryOptions",
          params: {},
        })
        const optData = optRes?.data ?? optRes
        if (optData?.success && Array.isArray(optData.data)) {
          setServiceOptions(optData.data as string[])
        }
      } catch {
        /* ignore */
      }
    } catch (e: unknown) {
      setRows([])
      setTotal(0)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [applied, page])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await call("", "POST", {
          service: "dataHistoryService",
          action: "getDataHistoryCategoryOptions",
          params: {},
        })
        const data = res?.data ?? res
        if (cancelled) return
        if (data?.success && Array.isArray(data.data)) {
          setServiceOptions(data.data as string[])
        }
      } catch {
        if (!cancelled) setServiceOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const openDetail = async (row: HistoryRow) => {
    if (!row.canDetail) return
    setDetailLoading(true)
    setDetailRow({ ...row, details: [] })
    try {
      const res = await call("", "POST", {
        service: "dataHistoryService",
        action: "getDataHistoryDetail",
        params: { id: row.id },
      })
      const data = res?.data ?? res
      if (!data?.success || !data.data) {
        setError(data?.error ?? "상세를 불러오지 못했습니다.")
        setDetailRow(null)
        return
      }
      setDetailRow(data.data as HistoryRow)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setDetailRow(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleRevertAll = async () => {
    if (!detailRow) return
    if (!detailRow.canRevertAll && !(detailRow.details ?? []).some((d) => d.canRevert && d.ddKey)) {
      return
    }
    if (
      !confirm(
        detailRow.workType === "추가"
          ? "전체 되돌리기를 실행합니다.\n이 이력으로 추가된 행을 삭제합니다. 계속할까요?"
          : "전체 되돌리기를 실행합니다.\n이 이력에 표시된 속성을 모두 변경 전 값으로 되돌립니다. 계속할까요?"
      )
    ) {
      return
    }
    const target = detailRow
    setActionLoading(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "dataHistoryService",
        action: "revertDataHistoryRow",
        params: { id: target.id },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setError(data?.error ?? "전체 되돌리기에 실패했습니다.")
        return
      }
      const n = Number(data.revertedCount ?? 0)
      alert(
        target.workType === "추가"
          ? "추가된 행을 삭제했습니다."
          : n > 0
            ? `전체 되돌리기 완료 (${n}개 속성)`
            : "전체 되돌리기를 완료했습니다."
      )
      setDetailRow(null)
      void loadList()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionLoading(false)
    }
  }

  const handleRevertField = async (d: DetailAttr) => {
    if (!d.ddKey || !d.canRevert) return
    if (!confirm("되돌리겠습니까?")) return
    setActionLoading(true)
    setError(null)
    try {
      const res = await call("", "POST", {
        service: "dataHistoryService",
        action: "revertDataHistoryField",
        params: { ddKey: d.ddKey },
      })
      const data = res?.data ?? res
      if (!data?.success) {
        setError(data?.error ?? "되돌리기에 실패했습니다.")
        return
      }
      alert("되돌리기를 완료했습니다.")
      if (detailRow) void openDetail(detailRow)
      void loadList()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleSearch = () => {
    setApplied({
      startDate,
      endDate,
      workType,
      category: categoryFilter,
      keyword,
    })
    setPage(1)
  }

  const handleReset = () => {
    const range = defaultRange()
    setStartDate(range.startDate)
    setEndDate(range.endDate)
    setWorkType("전체")
    setCategoryFilter("전체")
    setKeyword("")
    setApplied({
      startDate: range.startDate,
      endDate: range.endDate,
      workType: "전체",
      category: "전체",
      keyword: "",
    })
    setPage(1)
  }

  const geomDetails = (detailRow?.details ?? []).filter(isGeomAttr)
  const attrDetails = (detailRow?.details ?? []).filter((d) => !isGeomAttr(d))
  const isCompare =
    detailRow?.workType === "수정" || detailRow?.workType === "되돌리기"
  const emptyLabel = isCompare ? "변경된 속성이 없습니다." : "속성 값이 없습니다."

  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-2 pb-0 gap-2">
      <div className="shrink-0 flex flex-wrap items-end gap-2 border rounded-md bg-muted/20 p-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">기간</label>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              className="h-8 w-[9.5rem] text-xs"
              value={toInputDate(startDate)}
              onChange={(e) => setStartDate(e.target.value.replace(/-/g, ""))}
            />
            <span className="text-xs text-muted-foreground">~</span>
            <Input
              type="date"
              className="h-8 w-[9.5rem] text-xs"
              value={toInputDate(endDate)}
              onChange={(e) => setEndDate(e.target.value.replace(/-/g, ""))}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">작업분류</label>
          <select
            className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs"
            value={workType}
            onChange={(e) => setWorkType(e.target.value as WorkType)}
          >
            {WORK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">구분</label>
          <select
            className="h-8 min-w-[10rem] max-w-[18rem] rounded-md border border-input bg-background px-2 text-xs"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            {PINNED_CATEGORIES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {serviceOptions.length > 0 ? (
              <option disabled value="__sep__">
                ──────── 서비스명
              </option>
            ) : null}
            {serviceOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <label className="text-[11px] text-muted-foreground">
            검색 (사용자·그룹·레이어)
          </label>
          <Input
            className="h-8 text-xs"
            placeholder="예: 도로대장, hslee, 하천"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch()
            }}
          />
        </div>
        <div className="flex items-center gap-1 pb-0.5">
          <Button type="button" variant="default" size="sm" className="h-8 gap-1" onClick={handleSearch}>
            <Search className="w-3.5 h-3.5" /> 검색
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={handleReset}>
            <RotateCcw className="w-3.5 h-3.5" /> 초기화
          </Button>
        </div>
        <p className="w-full text-[10px] text-muted-foreground">
          SHP·Excel 업로드·레이어 관리(개발자모드) 및 서비스(구분)별 이력 통합 조회
        </p>
      </div>

      <div className="shrink-0 flex items-center gap-2 text-xs text-muted-foreground">
        <span>총 {total}건</span>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        {error ? <span className="text-destructive">{error}</span> : null}
      </div>

      <section className="flex-1 min-h-0 overflow-auto border rounded">
        <table className="w-full text-xs table-fixed min-w-[80rem]">
          <colgroup>
            <col className="w-[4.5rem]" />
            <col className="w-[11rem]" />
            <col className="w-[8rem]" />
            <col className="w-[8.5rem]" />
            <col className="w-[8.5rem]" />
            <col className="w-[9.5rem]" />
            <col className="w-[9.5rem]" />
            <col />
            <col className="w-[5rem]" />
            <col className="w-[5rem]" />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="text-center">
              <th className="py-1.5 px-3 font-medium border-r bg-muted">순번</th>
              <th className="py-1.5 px-3 font-medium border-r bg-muted">일자</th>
              <th className="py-1.5 px-3 font-medium border-r bg-muted">사용자 아이디</th>
              <th className="py-1.5 px-3 font-medium border-r bg-muted">사용자 이름</th>
              <th className="py-1.5 px-3 font-medium border-r bg-muted">그룹명</th>
              <th className="py-1.5 px-3 font-medium border-r bg-muted">레이어명</th>
              <th className="py-1.5 px-3 font-medium border-r bg-muted">구분</th>
              <th className="py-1.5 px-3 font-medium border-r bg-muted">내용</th>
              <th className="py-1.5 px-3 font-medium border-r bg-muted">작업분류</th>
              <th className="py-1.5 px-3 font-medium bg-muted">상세보기</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted-foreground">
                  이력이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr
                  key={r.id}
                  className={`border-t text-center hover:bg-muted/40 ${
                    r.canDetail ? "cursor-pointer" : ""
                  }`}
                  onClick={() => {
                    if (r.canDetail) void openDetail(r)
                  }}
                >
                  <td className="h-[32px] px-3 align-middle tabular-nums">
                    {(page - 1) * PAGE_SIZE + idx + 1}
                  </td>
                  <td className="h-[32px] px-3 align-middle whitespace-nowrap">
                    {cellText(r.date)}
                  </td>
                  <td
                    className="h-[32px] px-3 align-middle truncate"
                    title={r.userId || undefined}
                  >
                    {cellText(r.userId)}
                  </td>
                  <td
                    className="h-[32px] px-3 align-middle truncate"
                    title={r.userName || undefined}
                  >
                    {cellText(r.userName)}
                  </td>
                  <td
                    className="h-[32px] px-3 align-middle truncate"
                    title={r.groupName || undefined}
                  >
                    {cellText(r.groupName)}
                  </td>
                  <td
                    className="h-[32px] px-3 align-middle truncate"
                    title={r.layerName || undefined}
                  >
                    {cellText(r.layerName)}
                  </td>
                  <td
                    className="h-[32px] px-3 align-middle truncate"
                    title={r.category || undefined}
                  >
                    {cellText(r.category)}
                  </td>
                  <td
                    className="h-[32px] px-3 align-middle"
                    title={
                      r.workType === "저장" && r.saveType
                        ? `${r.saveType} | ${cellText(r.keyField)} | ${cellText(r.keyValue)}`
                        : `${cellText(r.keyField)} | ${cellText(r.keyValue)}`
                    }
                  >
                    <div className="flex items-center min-w-0 gap-0 justify-center">
                      {r.workType === "저장" && r.saveType ? (
                        <>
                          <span className="shrink-0 font-medium text-foreground whitespace-nowrap">
                            {r.saveType}
                          </span>
                          <span className="shrink-0 px-1.5 text-muted-foreground/60" aria-hidden>
                            |
                          </span>
                        </>
                      ) : null}
                      <span className="truncate text-muted-foreground max-w-[38%] text-right">
                        {cellText(r.keyField)}
                      </span>
                      <span className="shrink-0 px-1.5 text-muted-foreground/60" aria-hidden>
                        |
                      </span>
                      <span className="truncate font-medium max-w-[38%] text-left">
                        {cellText(r.keyValue)}
                      </span>
                    </div>
                  </td>
                  <td className="h-[32px] px-3 align-middle whitespace-nowrap">
                    {cellText(r.workType)}
                  </td>
                  <td className="h-[32px] px-3 align-middle">
                    {r.canDetail ? (
                      <button
                        type="button"
                        className="inline-flex text-emerald-600 hover:text-emerald-700"
                        title="상세보기"
                        onClick={(e) => {
                          e.stopPropagation()
                          void openDetail(r)
                        }}
                      >
                        <HelpCircle className="w-4 h-4" />
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <div className="shrink-0 flex items-center justify-center gap-1 text-xs pb-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page <= 1 || loading}
          onClick={() => setPage(1)}
          title="처음"
          aria-label="처음"
        >
          <ChevronsLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
          title="이전"
          aria-label="이전"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="px-2 tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
          title="다음"
          aria-label="다음"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page >= totalPages || loading}
          onClick={() => setPage(totalPages)}
          title="끝"
          aria-label="끝"
        >
          <ChevronsRight className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col gap-2 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-base">데이터 상세보기</DialogTitle>
            {detailRow ? (
              <p className="text-xs text-muted-foreground break-words">
                {cellText(detailRow.groupName)} / {cellText(detailRow.layerName)} ·{" "}
                {cellText(detailRow.category)} · {cellText(detailRow.keyField)} |{" "}
                {cellText(detailRow.keyValue)} · {cellText(detailRow.workType)}
                <span className="ml-1 text-[10px] opacity-70">({detailRow.source})</span>
              </p>
            ) : null}
            {detailRow?.canRevertAll ||
            (detailRow?.details ?? []).some((d) => d.canRevert && d.ddKey) ? (
              <div className="pt-1 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionLoading || detailLoading}
                  onClick={() => void handleRevertAll()}
                  className="h-7 text-xs gap-1"
                  title="전체 되돌리기"
                >
                  {actionLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Undo2 className="w-3.5 h-3.5" />
                  )}
                  전체 되돌리기
                </Button>
              </div>
            ) : null}
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-2">
            {detailLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
              </div>
            ) : detailRow ? (
              <>
                {geomDetails.length > 0 ? (
                  <div className="shrink-0 space-y-2 rounded border p-2">
                    {geomDetails.map((d) => (
                      <div key={d.name} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{d.name}</span>
                          {d.canRevert && d.ddKey ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-1.5"
                              disabled={actionLoading}
                              onClick={() => void handleRevertField(d)}
                              title="되돌리기"
                              aria-label="되돌리기"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                            </Button>
                          ) : null}
                        </div>
                        {isCompare ? (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <GeomPreviewSlot label="변경 전" raw={d.before} />
                            <GeomPreviewSlot label="변경 후" raw={d.after} />
                          </div>
                        ) : (
                          <GeomPreviewSlot
                            label={detailRow.workType === "추가" ? "추가" : "값"}
                            raw={d.value ?? d.after}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {attrDetails.length > 0 ? (
                  <div className="min-h-0 overflow-x-hidden rounded border">
                    {isCompare ? (
                      <table className="w-full table-fixed text-xs">
                        <colgroup>
                          <col className="w-[20%]" />
                          <col className="w-[32%]" />
                          <col className="w-[32%]" />
                          <col className="w-[16%]" />
                        </colgroup>
                        <thead className="sticky top-0 bg-muted">
                          <tr className="text-center">
                            <th className="py-1.5 px-2 font-medium border-r">속성명</th>
                            <th className="py-1.5 px-2 font-medium border-r">변경 전</th>
                            <th className="py-1.5 px-2 font-medium border-r">변경 후</th>
                            <th className="py-1.5 px-2 font-medium">되돌리기</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attrDetails.map((d) => (
                            <tr key={d.name} className="border-t text-center align-top">
                              <td className="py-1.5 px-2 break-all whitespace-pre-wrap">{d.name}</td>
                              <td className="py-1.5 px-2 text-muted-foreground break-all whitespace-pre-wrap">
                                {d.before ?? "—"}
                              </td>
                              <td className="py-1.5 px-2 break-all whitespace-pre-wrap">
                                {d.after ?? "—"}
                              </td>
                              <td className="py-1.5 px-2">
                                {d.canRevert && d.ddKey ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-1.5"
                                    disabled={actionLoading}
                                    onClick={() => void handleRevertField(d)}
                                    title="되돌리기"
                                    aria-label="되돌리기"
                                  >
                                    <Undo2 className="w-3.5 h-3.5" />
                                  </Button>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table className="w-full table-fixed text-xs">
                        <colgroup>
                          <col className="w-[28%]" />
                          <col className="w-[56%]" />
                          <col className="w-[16%]" />
                        </colgroup>
                        <thead className="sticky top-0 bg-muted">
                          <tr className="text-center">
                            <th className="py-1.5 px-2 font-medium border-r">속성명</th>
                            <th className="py-1.5 px-2 font-medium border-r">
                              {detailRow.workType === "추가" ? "추가" : "값"}
                            </th>
                            <th className="py-1.5 px-2 font-medium">되돌리기</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attrDetails.map((d) => (
                            <tr key={d.name} className="border-t text-center align-top">
                              <td className="py-1.5 px-2 break-all whitespace-pre-wrap">{d.name}</td>
                              <td className="py-1.5 px-2 break-all whitespace-pre-wrap">
                                {d.value ?? d.after ?? "—"}
                              </td>
                              <td className="py-1.5 px-2">
                                {d.canRevert && d.ddKey ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-1.5"
                                    disabled={actionLoading}
                                    onClick={() => void handleRevertField(d)}
                                    title="되돌리기"
                                    aria-label="되돌리기"
                                  >
                                    <Undo2 className="w-3.5 h-3.5" />
                                  </Button>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : geomDetails.length === 0 ? (
                  <div className="rounded border py-4 text-center text-xs text-muted-foreground">
                    {emptyLabel}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
