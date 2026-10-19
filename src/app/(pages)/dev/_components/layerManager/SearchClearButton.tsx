"use client"

import { X } from "lucide-react"

type Props = {
  value: string
  onClear: () => void
}

/** 검색창 안 오른쪽 끝 X. 입력값이 있을 때만 표시한다. */
export function SearchClearButton({ value, onClear }: Props) {
  if (!value) return null
  return (
    <button
      type="button"
      className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onClear}
      title="검색 초기화"
      aria-label="검색 초기화"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  )
}
