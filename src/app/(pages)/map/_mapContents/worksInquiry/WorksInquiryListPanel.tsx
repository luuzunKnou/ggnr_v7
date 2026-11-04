'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getWorksInquiryBinding,
  worksInquiryStatusClass,
  type WorksInquirySerEng,
} from './worksInquiryBinding'
import { searchWorksInquiryRows } from './worksInquiryMock'

type Props = {
  serEng: WorksInquirySerEng
  onClose: () => void
  selectedDetailId: string | null
  onSelectDetailId: (id: string) => void
}

export function WorksInquiryListPanel({
  serEng,
  onClose,
  selectedDetailId,
  onSelectDetailId,
}: Props) {
  const binding = getWorksInquiryBinding(serEng)
  const title = binding?.title ?? '조회'
  const isPermit = binding?.kind === 'permit'

  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')

  useEffect(() => {
    setKeyword('')
    setDebouncedKeyword('')
  }, [serEng])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 200)
    return () => window.clearTimeout(t)
  }, [keyword])

  const rows = useMemo(
    () => searchWorksInquiryRows(serEng, debouncedKeyword),
    [serEng, debouncedKeyword]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">{title}</span>
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
            placeholder={isPermit ? '검색 (허가명, 위치, 상태…)' : '검색 (사업명, 위치, 상태…)'}
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <table className="w-full min-w-[560px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
            <tr>
              <th className="min-w-[140px] px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                {isPermit ? '허가명' : '사업명'}
              </th>
              <th className="min-w-[140px] px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                위치
              </th>
              <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                {isPermit ? '허가일' : '착공'}
              </th>
              <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                {isPermit ? '만료일' : '준공'}
              </th>
              <th className="whitespace-nowrap px-2 py-2 font-semibold text-slate-700 border-b border-slate-200">
                상태
              </th>
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
                    <td className="px-2 py-2 font-medium text-slate-800">{row.name || '—'}</td>
                    <td className="max-w-[200px] truncate px-2 py-2 text-slate-700" title={row.location}>
                      {row.location || '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">
                      {row.startDate || '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">
                      {row.endDate || '—'}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                          worksInquiryStatusClass(row.status)
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
