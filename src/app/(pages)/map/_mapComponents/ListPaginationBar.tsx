'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  page: number
  pageCount: number
  loading?: boolean
  onPageChange: (page: number) => void
  className?: string
}

const btnClass =
  'inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground disabled:cursor-not-allowed disabled:opacity-40'

export function ListPaginationBar({
  page,
  pageCount,
  loading = false,
  onPageChange,
  className,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(page))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(String(page))
  }, [page, editing])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const go = (next: number) => {
    if (loading) return
    const clamped = Math.min(pageCount, Math.max(1, next))
    if (clamped === page) return
    onPageChange(clamped)
  }

  const commitDraft = () => {
    setEditing(false)
    const n = parseInt(draft.replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(n)) {
      setDraft(String(page))
      return
    }
    go(n)
  }

  if (pageCount < 1) return null

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-1 border-t border-border px-3 py-2',
        className
      )}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          title="처음"
          aria-label="처음"
          onClick={() => go(1)}
          className={btnClass}
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={page <= 1}
          title="이전"
          aria-label="이전"
          onClick={() => go(page - 1)}
          className={cn(btnClass, 'px-2')}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          이전
        </button>
      </div>

      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(String(page))
                setEditing(false)
              }
            }}
            className="h-7 w-12 rounded-md border border-primary/40 bg-background px-1.5 text-center text-[11px] font-medium text-foreground outline-none ring-1 ring-primary/20"
            aria-label="페이지 번호 입력"
          />
        ) : (
          <button
            type="button"
            title="클릭하여 페이지 입력"
            onClick={() => {
              if (loading) return
              setDraft(String(page))
              setEditing(true)
            }}
            className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border border-transparent px-1.5 font-medium text-foreground/80 hover:border-border hover:bg-muted/50"
          >
            {page}
          </button>
        )}
        <span>/ {pageCount}</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page >= pageCount}
          title="다음"
          aria-label="다음"
          onClick={() => go(page + 1)}
          className={cn(btnClass, 'px-2')}
        >
          다음
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={page >= pageCount}
          title="끝"
          aria-label="끝"
          onClick={() => go(pageCount)}
          className={btnClass}
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
