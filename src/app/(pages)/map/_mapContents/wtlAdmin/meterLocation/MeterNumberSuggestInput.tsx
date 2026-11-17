'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { call } from '@/lib/api'

type SuggestRow = {
  meterNo: string
  address: string
}

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  className?: string
  placeholder?: string
  disabled?: boolean
}

type Rect = { left: number; top: number; width: number }

/**
 * 계량기번호(MET_NUM) 서버 자동완성. 목록에 없어도 직접 입력·추가 가능.
 */
export function MeterNumberSuggestInput({
  value,
  onChange,
  onSubmit,
  className,
  placeholder,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<SuggestRow[]>([])
  const [loading, setLoading] = useState(false)
  const [rect, setRect] = useState<Rect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncRect = () => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ left: r.left, top: r.bottom + 2, width: r.width })
  }

  const openDropdown = () => {
    syncRect()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const kw = value.trim()
    if (kw.length < 1) {
      setOptions([])
      setLoading(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      call('', 'POST', {
        service: 'wtlMeterLocationService',
        action: 'suggestMeterNumbers',
        params: { keyword: kw, limit: 30 },
      })
        .then((res) => {
          const data = (res as { data?: { rows?: SuggestRow[] } })?.data ?? res
          const rows = (data as { rows?: SuggestRow[] })?.rows
          setOptions(Array.isArray(rows) ? rows : [])
        })
        .catch(() => setOptions([]))
        .finally(() => setLoading(false))
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, open])

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (inputRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('scroll', syncRect, true)
    window.addEventListener('resize', syncRect)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('scroll', syncRect, true)
      window.removeEventListener('resize', syncRect)
    }
  }, [open])

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        className={className}
        value={value}
        title={placeholder ?? '계량기 번호 또는 주소'}
        placeholder={placeholder ?? '계량기 번호 또는 주소'}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onFocus={openDropdown}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            setOpen(false)
            onSubmit?.()
          }
        }}
      />
      {open && rect
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[9999] max-h-48 overflow-y-auto rounded border border-border bg-background shadow-lg"
              style={{ left: rect.left, top: rect.top, width: Math.max(rect.width, 200) }}
            >
              {loading ? (
                <p className="px-2 py-1.5 text-[11px] text-muted-foreground">검색 중…</p>
              ) : options.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] text-slate-400">
                  {value.trim() ? '일치하는 계량기번호가 없습니다. 그대로 추가할 수 있습니다.' : '번호를 입력하세요.'}
                </p>
              ) : (
                options.map((row) => (
                  <button
                    key={row.meterNo}
                    type="button"
                    title={row.meterNo}
                    className="block w-full truncate px-2 py-1.5 text-left text-[11px] text-foreground/90 hover:bg-muted cursor-pointer"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onChange(row.meterNo)
                      setOpen(false)
                    }}
                  >
                    <span className="font-medium">{row.meterNo}</span>
                    {row.address ? (
                      <span className="ml-1.5 text-slate-500">{row.address}</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
