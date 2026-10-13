"use client"

import { useMemo, useState } from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  handbookMaterialFileHint,
  isSameHandbookDetail,
  matchHandbookMaterial,
  matchHandbookProcedure,
  type HandbookDetailSelection,
  type HandbookMatchStatus,
  type HandbookViewMode,
} from "./roadWorkHandbookData"
import { HandbookMaterialListButton, HandbookScaleCard, MatchBadge } from "./roadWorkHandbookUi"
import { useHandbookMapPick } from "./roadWorkHandbookMapContext"
import { useRoadWorkHandbookCatalog } from "./useRoadWorkHandbookCatalog"

type MatchFilter = "all" | Exclude<HandbookMatchStatus, "wait">

const EMPTY_SCALE: Record<string, string> = {}

const MATCH_SORT_ORDER: Record<HandbookMatchStatus, number> = {
  met: 0,
  unmet: 1,
  check: 2,
  wait: 3,
}

type Props = {
  onClose: () => void
  mode: HandbookViewMode
  onModeChange: (mode: HandbookViewMode) => void
  selected: HandbookDetailSelection | null
  onSelect: (next: HandbookDetailSelection | null) => void
  /** 업무자료 패널 안에 넣을 때 제목·구분 탭 숨김 */
  embedded?: boolean
}

export function RoadWorkHandbookListPanel({
  onClose,
  mode,
  onModeChange,
  selected,
  onSelect,
  embedded = false,
}: Props) {
  const [keyword, setKeyword] = useState("")
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all")
  const [appliedVals, setAppliedVals] = useState<Record<string, string> | null>(null)
  const mapPick = useHandbookMapPick()
  const { reviews, materials, loading, error } = useRoadWorkHandbookCatalog()
  const scaleVals = mapPick?.scaleVals ?? {}
  const kw = keyword.trim()
  const statusVals = appliedVals ?? EMPTY_SCALE
  const hasScaleInput = Object.values(scaleVals).some((v) => String(v ?? "").trim() !== "")

  const filteredProcs = useMemo(() => {
    const byKw = !kw
      ? reviews
      : reviews.filter(
          (p) =>
            p.name.includes(kw) ||
            p.criteria.includes(kw) ||
            p.law.includes(kw) ||
            p.criteriaItems.some((item) => item.includes(kw))
        )
    const filtered =
      matchFilter === "all"
        ? byKw
        : byKw.filter((p) => matchHandbookProcedure(p, statusVals) === matchFilter)
    if (!appliedVals) return filtered
    return [...filtered].sort((a, b) => {
      const rankA = MATCH_SORT_ORDER[matchHandbookProcedure(a, statusVals)]
      const rankB = MATCH_SORT_ORDER[matchHandbookProcedure(b, statusVals)]
      if (rankA !== rankB) return rankA - rankB
      return a.no - b.no
    })
  }, [appliedVals, kw, matchFilter, reviews, statusVals])

  const filteredMaterials = useMemo(
    () => materials.filter((m) => matchHandbookMaterial(m, kw)),
    [kw, materials]
  )

  const switchMode = (next: HandbookViewMode) => {
    if (next === mode) return
    onModeChange(next)
    setKeyword("")
    setMatchFilter("all")
    setAppliedVals(null)
    onSelect(null)
  }

  const handleApply = () => {
    setAppliedVals({ ...scaleVals })
  }

  const handleCancel = () => {
    mapPick?.resetScale()
    setAppliedVals(null)
    setMatchFilter("all")
  }

  const selectRefMaterial = (materialId: string) => {
    const next: HandbookDetailSelection = { kind: "ref", materialId }
    onSelect(isSameHandbookDetail(selected, next) ? null : next)
  }

  const searchPlaceholder = mode === "target" ? "절차명, 기준, 법령 검색" : "자료명, 파일명, 출처 검색"
  const filterOptions: { id: MatchFilter; label: string }[] = [
    { id: "all", label: "전체" },
    { id: "met", label: "해당" },
    { id: "unmet", label: "미달" },
    { id: "check", label: "판단" },
  ]

  const searchField = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder={searchPlaceholder}
        className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-ring"
      />
    </div>
  )

  const targetList = (
    <ul>
      {filteredProcs.length === 0 ? (
        <li className="px-3 py-6 text-center text-[11px] text-muted-foreground">
          {matchFilter === "met"
            ? "해당하는 절차가 없습니다."
            : matchFilter === "unmet"
              ? "기준에 미치지 않는 절차가 없습니다."
              : matchFilter === "check"
                  ? "판단이 필요한 절차가 없습니다."
                  : "검색 결과가 없습니다."}
        </li>
      ) : (
        filteredProcs.map((proc) => {
          const next: HandbookDetailSelection = { kind: "target", no: proc.no }
          const isSelected = isSameHandbookDetail(selected, next)
          const status = matchHandbookProcedure(proc, statusVals)
          return (
            <li key={proc.no}>
              <button
                type="button"
                title={proc.name}
                onClick={() => onSelect(isSelected ? null : next)}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-0.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors",
                  isSelected && status === "unmet"
                    ? "bg-destructive/5"
                    : isSelected
                      ? "bg-primary/5 dark:bg-primary/15"
                      : "hover:bg-muted/50",
                  status === "met" && "shadow-[inset_3px_0_0_0] shadow-primary",
                  status === "unmet" && "shadow-[inset_3px_0_0_0] shadow-destructive"
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <MatchBadge status={status} />
                  <span
                    className={cn(
                      "min-w-0 line-clamp-2 break-keep text-[12px] font-medium leading-snug",
                      status === "met"
                        ? "text-primary"
                        : status === "unmet"
                          ? "text-destructive"
                          : "text-foreground"
                    )}
                  >
                    {proc.no}. {proc.name}
                  </span>
                </div>
                <span className="line-clamp-2 break-keep text-[11px] leading-snug text-muted-foreground">
                  {proc.criteria}
                  {proc.when !== "—" ? ` · ${proc.when}` : ""}
                </span>
              </button>
            </li>
          )
        })
      )}
    </ul>
  )

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-background",
        embedded ? "h-full min-h-0 flex-1" : "h-full"
      )}
    >
      {!embedded ? (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <span className="text-sm font-semibold text-foreground">업무편람</span>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            className="flex shrink-0 gap-0 border-b border-border px-3"
            role="tablist"
            aria-label="업무편람 구분"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "target"}
              onClick={() => switchMode("target")}
              className={cn(
                "relative -mb-px border-b-2 px-3 py-2 text-[12px] font-medium transition-colors",
                mode === "target"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              대상여부 검토
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "ref"}
              onClick={() => switchMode("ref")}
              className={cn(
                "relative -mb-px border-b-2 px-3 py-2 text-[12px] font-medium transition-colors",
                mode === "ref"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              설계실무요령 자료
            </button>
          </div>
        </>
      ) : null}

      {mode === "target" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-3 py-2">{searchField}</div>
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="mb-1.5">
              <p className="text-[12px] font-semibold text-foreground">사업규모</p>
            </div>
            <HandbookScaleCard />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button
                type="button"
                disabled={!hasScaleInput}
                onClick={handleApply}
                className={cn(
                  "h-7 rounded border px-2.5 text-[11px] font-medium",
                  hasScaleInput
                    ? "border-primary bg-primary text-white hover:bg-primary/90"
                    : "cursor-not-allowed border-border bg-muted text-muted-foreground"
                )}
              >
                적용
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="h-7 rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted/50"
              >
                취소
              </button>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-border px-3 py-2">
            {filterOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMatchFilter(opt.id)}
                className={cn(
                  "rounded border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  matchFilter === opt.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            {loading ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">불러오는 중…</p>
            ) : error ? (
              <p className="px-3 py-6 text-center text-[11px] text-destructive">{error}</p>
            ) : (
              targetList
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-border px-3 py-2">{searchField}</div>
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            {loading ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">불러오는 중…</p>
            ) : error ? (
              <p className="px-3 py-6 text-center text-[11px] text-destructive">{error}</p>
            ) : (
              <ul>
                {filteredMaterials.length === 0 ? (
                  <li className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                    검색 결과가 없습니다.
                  </li>
                ) : (
                  filteredMaterials.map((mat) => {
                    const next: HandbookDetailSelection = { kind: "ref", materialId: mat.id }
                    return (
                      <li key={mat.id}>
                        <HandbookMaterialListButton
                          material={mat}
                          selected={isSameHandbookDetail(selected, next)}
                          fileHint={handbookMaterialFileHint(mat, kw)}
                          onClick={() => selectRefMaterial(mat.id)}
                        />
                      </li>
                    )
                  })
                )}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
