'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatWonList,
  searchSmallPublicFacRows,
  type SmallPublicFacRow,
} from './smallPublicFacMock'

type SortKey = 'office' | 'contractName' | 'contractAmount' | 'contractDate' | 'companyName'
type SortDir = 'asc' | 'desc'

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'office', label: '관서' },
  { key: 'contractName', label: '계약명' },
  { key: 'contractAmount', label: '계약금액', align: 'right' },
  { key: 'contractDate', label: '계약일자' },
  { key: 'companyName', label: '업체명' },
]

type Props = {
  onClose: () => void
  selectedDetailId: string | null
  onSelectDetailId: (id: string) => void
}

function compareRows(a: SmallPublicFacRow, b: SmallPublicFacRow, key: SortKey, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1
  if (key === 'contractAmount') return (a.contractAmount - b.contractAmount) * mul
  const av = String(a[key] ?? '')
  const bv = String(b[key] ?? '')
  return av.localeCompare(bv, 'ko') * mul
}

export function SmallPublicFacListPanel({ onClose, selectedDetailId, onSelectDetailId }: Props) {
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('contractAmount')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 200)
    return () => window.clearTimeout(t)
  }, [keyword])

  const rows = useMemo(() => {
    const filtered = searchSmallPublicFacRows(debouncedKeyword)
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir))
  }, [debouncedKeyword, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'contractAmount' || key === 'contractDate' ? 'desc' : 'asc')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">소규모 공공시설</span>
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
            placeholder="검색 (계약명, 업체명, 관서…)"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <table className="w-full min-w-[680px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200',
                    col.key === 'contractName' && 'min-w-[220px]',
                    col.align === 'right' && 'text-right'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className={cn(
                      'inline-flex items-center gap-1 hover:text-slate-900',
                      col.align === 'right' && 'ml-auto'
                    )}
                  >
                    {col.label}
                    <ArrowUpDown
                      className={cn(
                        'h-3 w-3',
                        sortKey === col.key ? 'text-slate-700' : 'text-slate-300'
                      )}
                    />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  조회된 항목이 없습니다.
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
                    onClick={() => onSelectDetailId(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectDetailId(row.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-slate-100 transition-colors',
                      isSelected ? 'bg-primary/10' : 'hover:bg-slate-50'
                    )}
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-slate-700">{row.office}</td>
                    <td className="px-2 py-2 font-medium text-slate-800" title={row.contractName}>
                      {row.contractName}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-700">
                      {formatWonList(row.contractAmount)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">
                      {row.contractDate}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-700">{row.companyName}</td>
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
