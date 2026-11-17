'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  formatRelatedParcels,
  getLandArchiveDocType,
  type LandArchiveFile,
} from './landArchiveConfig'

type SortKey = 'kind' | 'file' | 'parcels'
type SortSpec = { key: SortKey; dir: 'asc' | 'desc' }
type EmdOption = { code: string; name: string }

const ALL = ''
const SEARCH_DEBOUNCE_MS = 400

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'kind', label: '종류', className: 'w-[28%]' },
  { key: 'file', label: '파일', className: 'w-[36%]' },
  { key: 'parcels', label: '지번', className: 'w-[36%]' },
]

function compareRow(a: LandArchiveFile, b: LandArchiveFile, key: SortKey): number {
  switch (key) {
    case 'kind':
      return a.docTypeLabel.localeCompare(b.docTypeLabel, 'ko')
    case 'file':
      return a.fileName.localeCompare(b.fileName, 'ko', { numeric: true })
    case 'parcels':
      return a.parcelCount - b.parcelCount
  }
}

type Props = {
  onClose: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function LandArchiveListPanel({ onClose, selectedId, onSelect }: Props) {
  const [all, setAll] = useState<LandArchiveFile[]>([])
  const [loading, setLoading] = useState(false)
  const [emdOptions, setEmdOptions] = useState<EmdOption[]>([])
  const [emd, setEmd] = useState(ALL)
  const [keyword, setKeyword] = useState('')
  const [debouncedKw, setDebouncedKw] = useState('')
  const [sort, setSort] = useState<SortSpec>({ key: 'kind', dir: 'asc' })

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKw(keyword.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [keyword])

  useEffect(() => {
    let cancelled = false
    void call('', 'POST', { service: 'landArchiveService', action: 'listEmd', params: {} })
      .then((res) => {
        if (cancelled) return
        const items = Array.isArray(res?.data?.emd) ? (res.data.emd as EmdOption[]) : []
        setEmdOptions(items)
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const emdName = emd
    const kw = debouncedKw
    let cancelled = false
    setLoading(true)
    void call('', 'POST', {
      service: 'landArchiveService',
      action: 'list',
      params: { emd: emdName, keyword: kw },
    })
      .then((res) => {
        if (cancelled) return
        const items = Array.isArray(res?.data?.items) ? (res.data.items as LandArchiveFile[]) : []
        setAll(items)
      })
      .catch(() => {
        if (!cancelled) setAll([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [emd, debouncedKw])

  const filtered = useMemo(() => {
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...all].sort((a, b) => sign * compareRow(a, b, sort.key))
  }, [all, sort])

  useEffect(() => {
    if (selectedId && !filtered.some((d) => d.id === selectedId)) onSelect(null)
  }, [filtered, selectedId, onSelect])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  const emptyHint = loading ? '기록물을 불러오는 중…' : '자료 폴더에 파일이 있는 기록물이 없습니다.'

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">지적기록물</span>
        <button
          type="button"
          onClick={onClose}
          className="standard-panel-close"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="standard-filter-section">
        <div className="flex items-center gap-1.5">
          <select
            className="standard-filter-select max-w-none w-[8.5rem] shrink-0"
            value={emd}
            onChange={(e) => setEmd(e.target.value)}
            aria-label="읍면동"
          >
            <option value={ALL}>전체 읍면동</option>
            {emdOptions.map((n) => (
              <option key={n.code} value={n.name}>
                {n.name}
              </option>
            ))}
          </select>
          <div className="standard-search-wrap min-w-0 flex-1">
            <Search className="standard-search-icon" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="지번·권"
              className="standard-search-input"
            />
          </div>
        </div>
      </div>

      <div className="standard-list-body">
        <div className="standard-list-scroll">
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                {COLUMNS.map((col) => {
                  const active = sort.key === col.key
                  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                  return (
                    <th
                      key={col.key}
                      className={cn('standard-table-th standard-table-th-left', col.className)}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'standard-sort-button standard-sort-button-left',
                          active && 'standard-sort-button-active'
                        )}
                        title={`${col.label} 정렬`}
                      >
                        <span className="truncate">{col.label}</span>
                        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="standard-table-empty">
                    {emptyHint}
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const isSelected = selectedId === d.id
                  const kind = getLandArchiveDocType(d.docType)
                  let parcelLabel = formatRelatedParcels(d.firstParcel, d.parcelCount)
                  if (parcelLabel === '—' && d.volumeNo) parcelLabel = `권 ${d.volumeNo}`
                  return (
                    <tr
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelect(d.id)
                        }
                      }}
                      className={cn('standard-list-row', isSelected && 'standard-list-row-selected')}
                    >
                      <td className="standard-table-td-compact" title={d.docTypeLabel}>
                        <span
                          className="standard-status-badge max-w-full truncate"
                          style={{
                            backgroundColor: `${kind.color}33`,
                            color: kind.color,
                            boxShadow: `inset 0 0 0 1px ${kind.color}80`,
                          }}
                        >
                          {d.docTypeLabel}
                        </span>
                      </td>
                      <td className="standard-table-td-text-muted" title={d.fileName}>
                        {d.fileName}
                      </td>
                      <td className="standard-table-td-text" title={parcelLabel}>
                        {parcelLabel}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">
          <span>{filtered.length.toLocaleString()}건</span>
        </div>
      </div>
    </div>
  )
}
