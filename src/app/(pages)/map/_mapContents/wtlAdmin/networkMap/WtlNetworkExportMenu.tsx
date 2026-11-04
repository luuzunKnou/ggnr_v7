'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type WtlNetworkExportScope = 'all' | 'filtered'

type Props = {
  label: string
  title?: string
  busy?: boolean
  busyLabel?: string
  disabled?: boolean
  className?: string
  active?: boolean
  onPick: (scope: WtlNetworkExportScope) => void
}

/** 하단 도구줄용 — 선택 메뉴는 위로 펼침 */
export function WtlNetworkExportMenu({
  label,
  title,
  busy = false,
  busyLabel,
  disabled = false,
  className,
  active = false,
  onPick,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current
      if (!el) return
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (busy) setOpen(false)
  }, [busy])

  const shown = busy ? busyLabel || `${label}…` : label

  return (
    <div ref={rootRef} className={cn('relative min-w-0 flex-1', className)}>
      <button
        type="button"
        title={title ?? label}
        disabled={disabled || busy}
        className={cn(
          'flex h-7 w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-[5px] px-0.5 text-[11px] font-semibold leading-none disabled:cursor-not-allowed disabled:opacity-60',
          active || open
            ? 'bg-[#14607a] text-white hover:bg-[#0f4d62]'
            : 'bg-[#d7ebf1] text-[#14607a] hover:bg-[#c5e3eb]'
        )}
        onClick={() => {
          if (busy || disabled) return
          setOpen((v) => !v)
        }}
      >
        {shown}
      </button>
      {open && !busy && (
        <div
          className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded border border-border bg-background shadow-md"
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            title="전체 다운로드"
            className="flex w-full cursor-pointer items-center justify-center px-1 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted"
            onClick={() => {
              setOpen(false)
              onPick('all')
            }}
          >
            전체 다운로드
          </button>
          <button
            type="button"
            role="menuitem"
            title="현재 조건으로 다운로드"
            className="flex w-full cursor-pointer items-center justify-center border-t border-border px-1 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted"
            onClick={() => {
              setOpen(false)
              onPick('filtered')
            }}
          >
            현재 조건으로
          </button>
        </div>
      )}
    </div>
  )
}
