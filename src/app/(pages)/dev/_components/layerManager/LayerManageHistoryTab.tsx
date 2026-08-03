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
import { HelpCircle, Search, RotateCcw, Loader2 } from "lucide-react"
import { call } from "@/lib/api"

const WORK_TYPES = ["전체", "되돌리기", "삭제", "수정", "저장", "조회", "추가"] as const
type WorkType = (typeof WORK_TYPES)[number]

/** 구분 상단 고정 — 전체 / SHP 업로드 / Excel 업로드 (+ 하단 동적 서비스) */
const PINNED_CATEGORIES = ["전체", "SHP 업로드", "Excel 업로드"] as const
type PinnedCategory = (typeof PINNED_CATEGORIES)[number]
type CategoryFilter = PinnedCategory | string

type DetailAttr = {
  name: string
  before?: string
  after?: string
  value?: string
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
                ────────
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
          SHP·Excel 업로드 및 서비스(구분)별 확정 이력 통합 조회
        </p>
      </div>

      <div className="shrink-0 flex items-center gap-2 text-xs text-muted-foreground">
        <span>총 {total}건</span>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        {error ? <span className="text-destructive">{error}</span> : null}
      </div>

      <section className="flex-1 min-h-0 overflow-auto border rounded">
        {!loading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            이력이 없습니다.
          </div>
        ) : (
          <table className="w-full text-xs table-fixed min-w-[80rem]">
            <colgroup>
              <col className="w-[4.5rem]" />
              <col className="w-[11rem]" />
              <col className="w-[8rem]" />
              <col className="w-[7.5rem]" />
              <col className="w-[7.5rem]" />
              <col className="w-[8.5rem]" />
              <col className="w-[8.5rem]" />
              <col />
              <col className="w-[6rem]" />
              <col className="w-[5.5rem]" />
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
              {rows.map((r, idx) => (
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
                  <td className="h-[32px] px-3 align-middle whitespace-nowrap">{r.date}</td>
                  <td className="h-[32px] px-3 align-middle truncate" title={r.userId}>
                    {r.userId}
                  </td>
                  <td className="h-[32px] px-3 align-middle truncate" title={r.userName}>
                    {r.userName}
                  </td>
                  <td className="h-[32px] px-3 align-middle truncate" title={r.groupName}>
                    {r.groupName}
                  </td>
                  <td className="h-[32px] px-3 align-middle truncate" title={r.layerName}>
                    {r.layerName}
                  </td>
                  <td className="h-[32px] px-3 align-middle truncate" title={r.category}>
                    {r.category}
                  </td>
                  <td
                    className="h-[32px] px-3 align-middle"
                    title={
                      r.workType === "저장" && r.saveType
                        ? `${r.saveType} | ${r.keyField} | ${r.keyValue}`
                        : `${r.keyField} | ${r.keyValue}`
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
                        {r.keyField}
                      </span>
                      <span className="shrink-0 px-1.5 text-muted-foreground/60" aria-hidden>
                        |
                      </span>
                      <span className="truncate font-medium max-w-[38%] text-left">
                        {r.keyValue}
                      </span>
                    </div>
                  </td>
                  <td className="h-[32px] px-3 align-middle whitespace-nowrap">{r.workType}</td>
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
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="shrink-0 flex items-center justify-center gap-2 text-xs pb-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          이전
        </Button>
        <span>
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          다음
        </Button>
      </div>

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-2 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-base">데이터 상세보기</DialogTitle>
            {detailRow ? (
              <p className="text-xs text-muted-foreground break-words">
                {detailRow.groupName} / {detailRow.layerName} · {detailRow.category} ·{" "}
                {detailRow.keyField} | {detailRow.keyValue} · {detailRow.workType}
                <span className="ml-1 text-[10px] opacity-70">({detailRow.source})</span>
              </p>
            ) : null}
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden border rounded">
            {detailLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
              </div>
            ) : detailRow &&
              (detailRow.workType === "수정" || detailRow.workType === "되돌리기") ? (
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[39%]" />
                  <col className="w-[39%]" />
                </colgroup>
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-center">
                    <th className="py-1.5 px-2 font-medium border-r">속성명</th>
                    <th className="py-1.5 px-2 font-medium border-r">변경 전</th>
                    <th className="py-1.5 px-2 font-medium">변경 후</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailRow.details ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-muted-foreground">
                        변경된 속성이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    (detailRow.details ?? []).map((d) => (
                      <tr key={d.name} className="border-t text-center align-top">
                        <td className="py-1.5 px-2 break-all whitespace-pre-wrap">{d.name}</td>
                        <td className="py-1.5 px-2 text-muted-foreground break-all whitespace-pre-wrap">
                          {d.before ?? "—"}
                        </td>
                        <td className="py-1.5 px-2 break-all whitespace-pre-wrap">{d.after ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : detailRow ? (
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[70%]" />
                </colgroup>
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-center">
                    <th className="py-1.5 px-2 font-medium border-r">속성명</th>
                    <th className="py-1.5 px-2 font-medium">
                      {detailRow.workType === "추가" ? "추가" : "값"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(detailRow.details ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-4 text-center text-muted-foreground">
                        속성 값이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    (detailRow.details ?? []).map((d) => (
                      <tr key={d.name} className="border-t text-center align-top">
                        <td className="py-1.5 px-2 break-all whitespace-pre-wrap">{d.name}</td>
                        <td className="py-1.5 px-2 break-all whitespace-pre-wrap">
                          {d.value ?? d.after ?? "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
