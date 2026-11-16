'use client'

/** 한 화면(페이지)에 보이는 이력 건수 */
export const ANALYSIS_HISTORY_PAGE_SIZE = 8

type Props = {
  page: number
  total: number
  pageSize?: number
  onPageChange: (page: number) => void
}

export function AnalysisHistoryPager({
  page,
  total,
  pageSize = ANALYSIS_HISTORY_PAGE_SIZE,
  onPageChange,
}: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, total)
  const hasPrev = safePage > 1
  const hasNext = safePage * pageSize < total

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-2 py-1.5">
      <span className="text-[11px] text-muted-foreground">
        {total === 0 ? '0건' : `${from}–${to} / ${total.toLocaleString()}건`}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="이전"
          disabled={!hasPrev}
          className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onPageChange(safePage - 1)}
        >
          이전
        </button>
        <span className="px-1.5 text-[11px] text-muted-foreground">{safePage}페이지</span>
        <button
          type="button"
          title="다음"
          disabled={!hasNext}
          className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onPageChange(safePage + 1)}
        >
          다음
        </button>
      </div>
    </div>
  )
}
