'use client'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

type Props = {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  'aria-label'?: string
  /** 유효성 실패 시 포커스용 */
  dataField?: string
  autoFocus?: boolean
  className?: string
}

/**
 * 포커스 시 기존 값을 select처럼 전체 표시, 입력 시 자동완성 필터.
 * 목록에 없는 값은 그대로 두고, 저장 후 options(명단 파생)에 반영된다.
 */
export function VillagePatrolSuggestInput({
  value,
  onChange,
  options,
  placeholder,
  'aria-label': ariaLabel,
  dataField,
  autoFocus,
  className,
}: Props) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'all' | 'filter'>('all')
  const [hi, setHi] = useState(0)
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)

  const suggestions = useMemo(() => {
    if (mode === 'all') return options
    const q = value.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [mode, options, value])

  const updateBox = () => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setBox({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 120) })
  }

  useLayoutEffect(() => {
    if (!open) return
    updateBox()
  }, [open, suggestions.length])

  useEffect(() => {
    if (!open) return
    const onScroll = () => updateBox()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (inputRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    setHi(0)
  }, [suggestions, open])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setMode('all')
  }

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-vp-field={dataField}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
        className={cn(className)}
        onFocus={() => {
          setMode('all')
          setOpen(true)
        }}
        onBlur={() => {
          // Tab·다른 칸 이동 시 목록 닫기. 목록 클릭은 mousedown preventDefault로 blur 전에 pick됨
          window.setTimeout(() => {
            if (inputRef.current === document.activeElement) return
            if (listRef.current?.contains(document.activeElement)) return
            setOpen(false)
          }, 0)
        }}
        onChange={(e) => {
          onChange(e.target.value)
          setMode('filter')
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            setOpen(false)
            return
          }
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            setMode('all')
            setOpen(true)
            e.preventDefault()
            return
          }
          if (!open) return
          if (e.key === 'Escape') {
            setOpen(false)
            e.preventDefault()
            return
          }
          if (e.key === 'ArrowDown') {
            setHi((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)))
            e.preventDefault()
            return
          }
          if (e.key === 'ArrowUp') {
            setHi((i) => Math.max(i - 1, 0))
            e.preventDefault()
            return
          }
          if (e.key === 'Enter' && suggestions[hi]) {
            pick(suggestions[hi])
            e.preventDefault()
          }
        }}
      />
      {open && box && typeof document !== 'undefined'
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              className="fixed z-[200] max-h-48 min-w-max overflow-auto rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-md scrollbar-thin"
              style={{ top: box.top, left: box.left, width: 'auto', minWidth: box.width }}
            >
              {suggestions.length === 0 ? (
                <li className="whitespace-nowrap bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                  {value.trim() ? '새 값으로 저장됩니다' : '등록된 값 없음'}
                </li>
              ) : (
                suggestions.map((opt, i) => (
                  <li
                    key={opt}
                    role="option"
                    aria-selected={i === hi}
                    className={cn(
                      'cursor-pointer truncate px-2.5 py-1.5 text-foreground',
                      i === hi ? 'bg-muted text-foreground' : 'hover:bg-muted/50'
                    )}
                    onMouseEnter={() => setHi(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(opt)
                    }}
                  >
                    {opt}
                  </li>
                ))
              )}
            </ul>,
            document.body
          )
        : null}
    </>
  )
}
