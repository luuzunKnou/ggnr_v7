"use client"

/**
 * 데이터 이력관리 — UI 프로토타입 (목업 데이터만, API·DB 미연동)
 */
import { useMemo, useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Input } from "@/app/shadcnComponents/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { HelpCircle, Search, RotateCcw } from "lucide-react"

const WORK_TYPES = ["전체", "되돌리기", "삭제", "수정", "저장", "조회", "추가"] as const
type WorkType = (typeof WORK_TYPES)[number]

type DetailAttr = {
  name: string
  before?: string
  after?: string
  value?: string
}

type MockHistoryRow = {
  id: number
  date: string
  userId: string
  userName: string
  category: string
  groupName: string
  layerName: string
  keyField: string
  keyValue: string
  /** 작업분류가 저장일 때만 — 엑셀·한글·레이어 등 */
  saveType?: string
  workType: Exclude<WorkType, "전체">
  source: "지도" | "SHP" | "Excel"
  details: DetailAttr[]
}

const MOCK_ROWS: MockHistoryRow[] = [
  {
    id: 1,
    date: "2026-07-24 10:12:03",
    userId: "admin",
    userName: "관리자",
    category: "도로대장 조회",
    groupName: "도로",
    layerName: "도로대장",
    keyField: "road_id",
    keyValue: "00",
    workType: "수정",
    source: "지도",
    details: [
      { name: "도로명", before: "중앙로", after: "본대로" },
      { name: "폭(m)", before: "8", after: "10" },
      { name: "비고", before: "", after: "차로 확장" },
    ],
  },
  {
    id: 2,
    date: "2026-07-23 16:40:11",
    userId: "hslee",
    userName: "이한샘",
    category: "SHP 업로드",
    groupName: "하천",
    layerName: "하천망",
    keyField: "riv_id",
    keyValue: "101",
    workType: "추가",
    source: "SHP",
    details: [
      { name: "하천명", value: "남대천" },
      { name: "등급", value: "지방2급" },
      { name: "연장(m)", value: "1250" },
    ],
  },
  {
    id: 3,
    date: "2026-07-23 14:05:22",
    userId: "hslee",
    userName: "이한샘",
    category: "SHP 업로드",
    groupName: "하천",
    layerName: "하천망",
    keyField: "riv_id",
    keyValue: "88",
    workType: "삭제",
    source: "SHP",
    details: [],
  },
  {
    id: 4,
    date: "2026-07-22 09:30:00",
    userId: "planner01",
    userName: "김기획",
    category: "Excel 업로드",
    groupName: "도시계획",
    layerName: "용도지역",
    keyField: "zone_cd",
    keyValue: "A-12",
    workType: "수정",
    source: "Excel",
    details: [
      { name: "용도지역", before: "제1종전용주거", after: "제2종전용주거" },
      { name: "건폐율", before: "50", after: "60" },
    ],
  },
  {
    id: 5,
    date: "2026-07-21 11:18:45",
    userId: "admin",
    userName: "관리자",
    category: "도로대장 조회",
    groupName: "도로",
    layerName: "도로대장",
    keyField: "road_id",
    keyValue: "00",
    workType: "되돌리기",
    source: "지도",
    details: [
      { name: "도로명", before: "본대로", after: "중앙로" },
      { name: "폭(m)", before: "10", after: "8" },
    ],
  },
  {
    id: 6,
    date: "2026-07-20 15:02:10",
    userId: "viewer1",
    userName: "박조회",
    category: "지적정보",
    groupName: "지적",
    layerName: "지적도",
    keyField: "pnu",
    keyValue: "4711331021***",
    workType: "조회",
    source: "지도",
    details: [],
  },
  {
    id: 7,
    date: "2026-07-19 13:55:33",
    userId: "hslee",
    userName: "이한샘",
    category: "상수도관로",
    groupName: "상하수도",
    layerName: "상수도관",
    keyField: "pipe_no",
    keyValue: "P-204",
    saveType: "엑셀",
    workType: "저장",
    source: "지도",
    details: [],
  },
  {
    id: 8,
    date: "2026-07-18 17:20:01",
    userId: "planner01",
    userName: "김기획",
    category: "Excel 업로드",
    groupName: "도시계획",
    layerName: "용도지역",
    keyField: "zone_cd",
    keyValue: "B-03",
    workType: "추가",
    source: "Excel",
    details: [
      { name: "용도지역", value: "근린상업" },
      { name: "건폐율", value: "70" },
      { name: "용적률", value: "400" },
    ],
  },
  {
    id: 9,
    date: "2026-07-17 10:05:00",
    userId: "admin",
    userName: "관리자",
    category: "도로대장 조회",
    groupName: "도로",
    layerName: "도로대장",
    keyField: "road_id",
    keyValue: "12",
    saveType: "한글",
    workType: "저장",
    source: "지도",
    details: [],
  },
  {
    id: 10,
    date: "2026-07-16 14:22:40",
    userId: "hslee",
    userName: "이한샘",
    category: "하천망 관리",
    groupName: "하천",
    layerName: "하천망",
    keyField: "riv_id",
    keyValue: "55",
    saveType: "레이어",
    workType: "저장",
    source: "지도",
    details: [],
  },
]

const PAGE_SIZE = 10

function toInputDate(ymd: string): string {
  // yyyymmdd → yyyy-mm-dd (date input)
  if (/^\d{8}$/.test(ymd)) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  }
  return ymd
}

function rowDateKey(dateTime: string): string {
  return dateTime.slice(0, 10).replace(/-/g, "")
}

function matchesKeyword(r: MockHistoryRow, q: string): boolean {
  if (!q) return true
  const hay = [r.userId, r.userName, r.groupName, r.layerName, r.category]
    .join(" ")
    .toLowerCase()
  return hay.includes(q)
}

export function LayerManageHistoryTab() {
  const [startDate, setStartDate] = useState("20260701")
  const [endDate, setEndDate] = useState("20260731")
  const [workType, setWorkType] = useState<WorkType>("전체")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({
    startDate: "20260701",
    endDate: "20260731",
    workType: "전체" as WorkType,
    keyword: "",
  })
  const [page, setPage] = useState(1)
  const [detailRow, setDetailRow] = useState<MockHistoryRow | null>(null)

  const filtered = useMemo(() => {
    const start = applied.startDate.replace(/-/g, "").slice(0, 8)
    const end = applied.endDate.replace(/-/g, "").slice(0, 8)
    const q = applied.keyword.trim().toLowerCase()
    return MOCK_ROWS.filter((r) => {
      const d = rowDateKey(r.date)
      if (start && d < start) return false
      if (end && d > end) return false
      if (applied.workType !== "전체" && r.workType !== applied.workType) return false
      if (!matchesKeyword(r, q)) return false
      return true
    })
  }, [applied])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSearch = () => {
    setApplied({
      startDate,
      endDate,
      workType,
      keyword,
    })
    setPage(1)
  }

  const handleReset = () => {
    setStartDate("20260701")
    setEndDate("20260731")
    setWorkType("전체")
    setKeyword("")
    setApplied({
      startDate: "20260701",
      endDate: "20260731",
      workType: "전체",
      keyword: "",
    })
    setPage(1)
  }

  /** 조회·저장·삭제 = 1차 상세 없음 */
  const canDetail = (t: string) =>
    t === "수정" || t === "추가" || t === "되돌리기"

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
        <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <label className="text-[11px] text-muted-foreground">
            검색 (사용자·그룹·레이어·구분)
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
        <p className="w-full text-[10px] text-amber-700 dark:text-amber-400">
          프로토타입 · 목업 데이터 (API·DB 미연동)
        </p>
      </div>

      <div className="shrink-0 flex items-center text-xs text-muted-foreground">
        <span>총 {filtered.length}건</span>
      </div>

      <section className="flex-1 min-h-0 overflow-auto border rounded">
        {pageRows.length === 0 ? (
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
              {pageRows.map((r, idx) => (
                <tr
                  key={r.id}
                  className={`border-t text-center hover:bg-muted/40 ${
                    canDetail(r.workType) ? "cursor-pointer" : ""
                  }`}
                  onClick={() => {
                    if (canDetail(r.workType)) setDetailRow(r)
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
                        ? `${r.keyField} | ${r.keyValue} · ${r.saveType}`
                        : `${r.keyField} | ${r.keyValue}`
                    }
                  >
                    <div className="flex items-center min-w-0 gap-0 justify-center">
                      <span className="truncate text-muted-foreground max-w-[38%] text-right">
                        {r.keyField}
                      </span>
                      <span className="shrink-0 px-1.5 text-muted-foreground/60" aria-hidden>
                        |
                      </span>
                      <span className="truncate font-medium max-w-[38%] text-left">
                        {r.keyValue}
                      </span>
                      {r.workType === "저장" && r.saveType ? (
                        <>
                          <span className="shrink-0 mx-2 h-3.5 w-px bg-foreground/40" aria-hidden />
                          <span className="shrink-0 font-medium text-foreground whitespace-nowrap">
                            {r.saveType}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="h-[32px] px-3 align-middle whitespace-nowrap">{r.workType}</td>
                  <td className="h-[32px] px-3 align-middle">
                    {canDetail(r.workType) ? (
                      <button
                        type="button"
                        className="inline-flex text-emerald-600 hover:text-emerald-700"
                        title="상세보기"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDetailRow(r)
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
          disabled={page <= 1}
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
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          다음
        </Button>
      </div>

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col gap-2 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-base">데이터 상세보기</DialogTitle>
            {detailRow ? (
              <p className="text-xs text-muted-foreground">
                {detailRow.groupName} / {detailRow.layerName} · {detailRow.category} ·{" "}
                {detailRow.keyField} | {detailRow.keyValue} · {detailRow.workType}
                <span className="ml-1 text-[10px] opacity-70">({detailRow.source})</span>
              </p>
            ) : null}
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto border rounded">
            {detailRow &&
            (detailRow.workType === "수정" || detailRow.workType === "되돌리기") ? (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-center">
                    <th className="py-1.5 px-2 font-medium border-r">속성명</th>
                    <th className="py-1.5 px-2 font-medium border-r">변경 전</th>
                    <th className="py-1.5 px-2 font-medium">변경 후</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRow.details.map((d) => (
                    <tr key={d.name} className="border-t text-center">
                      <td className="py-1.5 px-2">{d.name}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{d.before ?? "—"}</td>
                      <td className="py-1.5 px-2">{d.after ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : detailRow ? (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-center">
                    <th className="py-1.5 px-2 font-medium border-r">속성명</th>
                    <th className="py-1.5 px-2 font-medium">
                      {detailRow.workType === "추가" ? "추가" : "값"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detailRow.details.map((d) => (
                    <tr key={d.name} className="border-t text-center">
                      <td className="py-1.5 px-2">{d.name}</td>
                      <td className="py-1.5 px-2">{d.value ?? d.after ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
