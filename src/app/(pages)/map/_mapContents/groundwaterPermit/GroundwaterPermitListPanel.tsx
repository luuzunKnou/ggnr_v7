'use client'

import { useCallback, useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  groundwaterPermitStatusClass,
  type GroundwaterPermitStatusCode,
} from '@/lib/groundwaterPermitStatus'
import { useGroundwaterPermitMapHighlight } from './useGroundwaterPermitMapHighlight'

type ListRow = {
  id: string
  nameOrTrade: string
  developLocation: string
  permitStartDate: string
  permitEndDate: string
  statusCode: GroundwaterPermitStatusCode
  statusLabel: string
}

type Props = {
  onClose: () => void
  selectedDetailId: string | null
  onSelectDetailId: (id: string) => void
}

export function GroundwaterPermitListPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
}: Props) {
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [rows, setRows] = useState<ListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { clearHighlight } = useGroundwaterPermitMapHighlight()

  const handleClose = useCallback(() => {
    clearHighlight()
    onClose()
  }, [clearHighlight, onClose])

  const handleRowSelect = useCallback(
    (id: string) => {
      onSelectDetailId(id)
    },
    [onSelectDetailId]
  )

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 300)
    return () => window.clearTimeout(t)
  }, [keyword])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void call('', 'POST', {
      service: 'groundwaterPermitService',
      action: 'getGroundwaterPermitList',
      params: { keyword: debouncedKeyword },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as { rows?: ListRow[]; error?: string }
        if (data?.error) setError(data.error)
        setRows(Array.isArray(data?.rows) ? data.rows : [])
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedKeyword])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">지하수 개발허가</span>
        <button
          type="button"
          onClick={handleClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (상호, 위치, 상태…)"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-foreground outline-none ring-offset-2 placeholder:text-muted-foreground focus:border-border focus:ring-2 focus:ring-border"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {error && (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <table className="w-full min-w-[640px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-[1] bg-muted shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              <th className="min-w-[110px] border-b border-border px-2 py-2 font-semibold text-foreground/90">
                상호또는성명
              </th>
              <th className="min-w-[160px] border-b border-border px-2 py-2 font-semibold text-foreground/90">
                개발위치
              </th>
              <th className="whitespace-nowrap border-b border-border px-2 py-2 font-semibold text-foreground/90">
                허가유효시작일
              </th>
              <th className="whitespace-nowrap border-b border-border px-2 py-2 font-semibold text-foreground/90">
                허가유효종료일
              </th>
              <th className="whitespace-nowrap border-b border-border px-2 py-2 font-semibold text-foreground/90">
                상태
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  불러오는 중…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  {error ? '데이터를 표시할 수 없습니다.' : '조회된 항목이 없습니다.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelected = selectedDetailId === row.id
                return (
                  <tr
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowSelect(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleRowSelect(row.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border transition-colors',
                      isSelected
                        ? 'border-l-[3px] border-l-primary bg-primary/[0.11] ring-1 ring-inset ring-primary/20 hover:bg-primary/[0.14]'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <td className="px-2 py-2 font-medium text-foreground">{row.nameOrTrade || '—'}</td>
                    <td
                      className="max-w-[220px] truncate px-2 py-2 text-foreground/90"
                      title={row.developLocation}
                    >
                      {row.developLocation || '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-foreground/90">
                      {row.permitStartDate || '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-foreground/90">
                      {row.permitEndDate || '—'}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                          groundwaterPermitStatusClass(row.statusCode)
                        )}
                      >
                        {row.statusLabel}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
