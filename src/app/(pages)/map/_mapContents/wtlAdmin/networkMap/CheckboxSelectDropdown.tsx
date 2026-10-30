'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CheckboxSelectOption = {
  value: string
  label: string
}

type CheckboxSelectDropdownProps = {
  label?: string
  options: CheckboxSelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  /** 비선택 시 트리거 문구 */
  placeholder?: string
  /** true면 전체 선택 행 표시 (기본 true) */
  showSelectAll?: boolean
  className?: string
  disabled?: boolean
  title?: string
}

/**
 * 위치 검색 select와 같은 입력 룩의 다중 선택 드롭다운.
 * 패널 너비 = 트리거 너비, 바깥 클릭·푸터 «닫기»로 닫힘.
 */
export function CheckboxSelectDropdown({
  label,
  options,
  value,
  onChange,
  placeholder = '선택',
  showSelectAll = true,
  className,
  disabled,
  title,
}: CheckboxSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = useMemo(() => new Set(value), [value])
  const allValues = useMemo(() => options.map((o) => o.value), [options])
  const allSelected = allValues.length > 0 && allValues.every((v) => selected.has(v))
  const someSelected = allValues.some((v) => selected.has(v))

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const triggerText = (() => {
    if (allValues.length === 0) return placeholder
    if (value.length === 0) return placeholder
    if (allSelected) return '전체'
    if (value.length === 1) {
      return options.find((o) => o.value === value[0])?.label ?? value[0]
    }
    return `${value.length}개 선택`
  })()

  const toggleOne = (code: string) => {
    const next = new Set(selected)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange([...next])
  }

  const toggleAll = () => {
    onChange(allSelected ? [] : [...allValues])
  }

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)}>
      {label ? (
        <span className="sr-only">{label}</span>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        title={title ?? label ?? placeholder}
        aria-label={title ?? label ?? placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'standard-detail-input flex h-7 w-full min-w-0 cursor-pointer items-center justify-between gap-1 px-1 text-left text-[11px]',
          disabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <span className="min-w-0 truncate">{triggerText}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable
          className="absolute left-0 right-0 top-[calc(100%+2px)] z-50 flex max-h-56 flex-col overflow-hidden rounded border border-border bg-background shadow-md"
        >
          <div className="min-h-0 flex-1 overflow-auto py-1">
            {showSelectAll && options.length > 0 ? (
              <label className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[11px] text-foreground hover:bg-muted/60">
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected
                  }}
                  onChange={toggleAll}
                  title="전체 선택"
                />
                <span>전체 선택</span>
              </label>
            ) : null}
            {options.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-muted-foreground">선택 항목이 없습니다.</p>
            ) : (
              options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[11px] text-foreground hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    className="cursor-pointer"
                    checked={selected.has(opt.value)}
                    onChange={() => toggleOne(opt.value)}
                    title={opt.label}
                  />
                  <span className="min-w-0 truncate" title={opt.label}>
                    {opt.label}
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="flex shrink-0 justify-end border-t border-border bg-muted/30 px-2 py-1">
            <button
              type="button"
              className="cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              title="닫기"
              onClick={() => setOpen(false)}
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
