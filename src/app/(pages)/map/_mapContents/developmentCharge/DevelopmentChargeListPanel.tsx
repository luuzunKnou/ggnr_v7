'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DEVELOPMENT_CHARGE_STATUSES,
  getDevelopmentChargeStatus,
} from './developmentChargeConfig'
import {
  formatAreaM2,
  getDevelopmentChargeAreas,
  type DevelopmentChargeArea,
} from './developmentChargeMock'
import { useDevelopmentChargeAreaLayer } from './useDevelopmentChargeAreaLayer'

type SortKey = 'name' | 'emd' | 'area' | 'status' | 'year'
type SortSpec = { key: SortKey; dir: 'asc' | 'desc' }

const ALL = ''

const COLUMNS: { key: SortKey; label: string; className: string; align?: 'center' }[] = [
  { key: 'name', label: '사업명', className: 'w-[28%]' },
  { key: 'emd', label: '소재지', className: 'w-[18%]' },
  { key: 'year', label: '연도', className: 'w-[12%]', align: 'center' },
  { key: 'area', label: '면적', className: 'w-[18%]', align: 'center' },
  { key: 'status', label: '상태', className: 'w-[24%]', align: 'center' },
]

function compareArea(a: DevelopmentChargeArea, b: DevelopmentChargeArea, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name, 'ko')
    case 'emd':
      return a.emd.localeCompare(b.emd, 'ko')
    case 'year':
      return a.year - b.year
    case 'area':
      return a.area - b.area
    case 'status':
      return a.statusLabel.localeCompare(b.statusLabel, 'ko')
  }
}

type Props = {
  onClose: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function DevelopmentChargeListPanel({ onClose, selectedId, onSelect }: Props) {
  const all = useMemo(() => getDevelopmentChargeAreas(), [])
  const [year, setYear] = useState(ALL)
  const [emd, setEmd] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<SortSpec>({ key: 'year', dir: 'desc' })

  const yearOptions = useMemo(
    () => [...new Set(all.map((d) => d.year))].sort((a, b) => b - a),
    [all]
  )
  const emdOptions = useMemo(
    () => [...new Set(all.map((d) => d.emd))].sort((a, b) => a.localeCompare(b, 'ko')),
    [all]
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim()
    const rows = all.filter((d) => {
      if (year && String(d.year) !== year) return false
      if (emd && d.emd !== emd) return false
      if (status && d.status !== status) return false
      if (kw && !`${d.name} ${d.emd} ${d.address} ${d.obligor} ${d.projectType}`.includes(kw)) {
        return false
      }
      return true
    })
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => sign * compareArea(a, b, sort.key))
  }, [all, year, emd, status, keyword, sort])

  const { fitToArea } = useDevelopmentChargeAreaLayer({
    areas: filtered,
    selectedId,
    onSelect: (id) => onSelect(id),
  })

  useEffect(() => {
    if (selectedId && !filtered.some((d) => d.id === selectedId)) onSelect(null)
  }, [filtered, selectedId, onSelect])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  const handleRowSelect = useCallback(
    (id: string) => {
      onSelect(id)
      fitToArea(id)
    },
    [onSelect, fitToArea]
  )

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">개발부담금</span>
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
            className="standard-filter-select max-w-none flex-1"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label="기준연도"
          >
            <option value={ALL}>전체 연도</option>
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>
                {y}년
              </option>
            ))}
          </select>
          <select
            className="standard-filter-select max-w-none flex-1"
            value={emd}
            onChange={(e) => setEmd(e.target.value)}
            aria-label="읍면동"
          >
            <option value={ALL}>전체 읍면동</option>
            {emdOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select
            className="standard-filter-select max-w-none flex-1"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="상태"
          >
            <option value={ALL}>전체 상태</option>
            {DEVELOPMENT_CHARGE_STATUSES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (사업명, 소재지, 납부의무자)"
            className="standard-search-input"
          />
        </div>
        <p className="px-0.5 text-[11px] text-muted-foreground">임시 자료 · 실제 부과와 무관</p>
      </div>

      <div className="standard-list-body">
        <div className="standard-list-scroll">
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                {COLUMNS.map((col) => {
                  const active = sort.key === col.key
                  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                  const center = col.align === 'center'
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        'standard-table-th',
                        center ? 'standard-table-th-center' : 'standard-table-th-left',
                        col.className
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'standard-sort-button',
                          center ? 'standard-sort-button-center' : 'standard-sort-button-left',
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
                    조회된 대상 지역이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const st = getDevelopmentChargeStatus(d.status)
                  const isSelected = selectedId === d.id
                  return (
                    <tr
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowSelect(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleRowSelect(d.id)
                        }
                      }}
                      className={cn('standard-list-row', isSelected && 'standard-list-row-selected')}
                    >
                      <td className="standard-table-td-text font-medium" title={d.name}>
                        {d.name}
                      </td>
                      <td className="standard-table-td-text-muted" title={d.address}>
                        {d.emd}
                      </td>
                      <td className="standard-table-td-date text-center">{d.year}</td>
                      <td className="standard-table-td-date text-center tabular-nums">
                        {formatAreaM2(d.area)}
                      </td>
                      <td className="standard-table-td-compact text-center">
                        <span
                          className="standard-status-badge max-w-full truncate"
                          style={{
                            backgroundColor: `${st.color}33`,
                            color: st.color,
                            boxShadow: `inset 0 0 0 1px ${st.color}80`,
                          }}
                          title={st.label}
                        >
                          {st.label}
                        </span>
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
