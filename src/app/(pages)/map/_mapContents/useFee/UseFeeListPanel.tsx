'use client'

import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'

type ListRow = {
  id: string
  status: string
  chargeNo: string
  year: string
  payer: string
  amount: string
  dueDate: string
}

type ListProps = {
  onClose: () => void
  selectedId: string | null
  onSelectId: (id: string) => void
}

export function UseFeeListPanel({ onClose, selectedId, onSelectId }: ListProps) {
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [rows, setRows] = useState<ListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 300)
    return () => window.clearTimeout(t)
  }, [keyword])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void call('', 'POST', {
      service: 'useFeeService',
      action: 'getUseFeeList',
      params: { keyword: debouncedKeyword },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          rows?: ListRow[]
          total?: number
          error?: string
        }
        if (data?.error) setError(data.error)
        setRows(Array.isArray(data?.rows) ? data.rows : [])
        setTotal(Number(data?.total ?? 0))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setRows([])
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedKeyword])

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">점사용료</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (부과번호, 납부자, 상태, 연도)"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
          {error ? (
            <div className="px-3 py-6 text-center text-xs text-red-600">{error}</div>
          ) : loading && rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">조회된 점사용료가 없습니다.</div>
          ) : (
            <table className="w-full min-w-[440px] table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[48px]" />
                <col className="w-[68px]" />
                <col className="w-[44px]" />
                <col className="w-[64px]" />
                <col className="w-[88px]" />
                <col className="w-[76px]" />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="whitespace-nowrap border-b border-slate-200 px-1.5 py-2 font-semibold text-slate-700">
                    상태
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-1.5 py-2 font-semibold text-slate-700">
                    부과번호
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-1.5 py-2 font-semibold text-slate-700">
                    연도
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-1.5 py-2 font-semibold text-slate-700">
                    납부자
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-1.5 py-2 font-semibold text-slate-700">
                    납부금액
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-1.5 py-2 font-semibold text-slate-700">
                    납기일
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelected = selectedId === row.id
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectId(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectId(row.id)
                        }
                      }}
                      className={cn(
                        'cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/80',
                        isSelected && 'bg-primary/10'
                      )}
                    >
                      <td className="px-1.5 py-1.5">
                        <span
                          className={cn(
                            'inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                            row.status === '미납'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-emerald-50 text-emerald-700'
                          )}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-slate-800" title={row.chargeNo}>
                        {row.chargeNo || '—'}
                      </td>
                      <td className="px-1.5 py-1.5 text-slate-700">{row.year || '—'}</td>
                      <td className="truncate px-1.5 py-1.5 text-slate-700" title={row.payer}>
                        {row.payer || '—'}
                      </td>
                      <td
                        className="truncate px-1 py-1.5 text-right tabular-nums text-slate-700"
                        title={row.amount}
                      >
                        {row.amount}
                      </td>
                      <td
                        className="truncate px-1 py-1.5 tabular-nums text-slate-700"
                        title={row.dueDate}
                      >
                        {row.dueDate}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="shrink-0 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          {loading ? '갱신 중 · ' : ''}
          {total.toLocaleString()}건 · 조회 전용
          {rows.length < total ? ` (표시 ${rows.length.toLocaleString()}건)` : ''}
        </div>
      </div>
    </div>
  )
}
