'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getResurveyStageGroup } from './cadastralResurveyConfig'
import { getResurveyDistricts, type ResurveyDistrict } from './cadastralResurveyMock'
import { useCadastralResurveyDistrictLayer } from './useCadastralResurveyDistrictLayer'

type SortKey = 'name' | 'location' | 'year' | 'parcelCount' | 'stage'
type SortSpec = { key: SortKey; dir: 'asc' | 'desc' }

const ALL = ''

const COLUMNS: { key: SortKey; label: string; className: string; align?: 'center' }[] = [
  { key: 'name', label: '지구명', className: 'w-[20%]' },
  { key: 'location', label: '위치', className: 'w-[22%]' },
  { key: 'year', label: '연도', className: 'w-[11%]', align: 'center' },
  { key: 'parcelCount', label: '필지', className: 'w-[11%]', align: 'center' },
  { key: 'stage', label: '진행단계', className: 'w-[36%]', align: 'center' },
]

function compareDistrict(a: ResurveyDistrict, b: ResurveyDistrict, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name, 'ko')
    case 'location':
      return `${a.emd} ${a.ri}`.localeCompare(`${b.emd} ${b.ri}`, 'ko')
    case 'year':
      return a.year - b.year
    case 'parcelCount':
      return a.parcelCount - b.parcelCount
    case 'stage':
      return a.stageCd - b.stageCd
  }
}

type Props = {
  onClose: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function CadastralResurveyListPanel({ onClose, selectedId, onSelect }: Props) {
  const all = useMemo(() => getResurveyDistricts(), [])
  const [year, setYear] = useState(ALL)
  const [emd, setEmd] = useState(ALL)
  const [stage, setStage] = useState(ALL)
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
  const stageOptions = useMemo(() => {
    const m = new Map<number, string>()
    for (const d of all) if (!m.has(d.stageCd)) m.set(d.stageCd, d.stageName)
    return [...m.entries()]
      .map(([cd, name]) => ({ cd, name }))
      .sort((a, b) => a.cd - b.cd)
  }, [all])

  const filtered = useMemo(() => {
    const kw = keyword.trim()
    const rows = all.filter((d) => {
      if (year && String(d.year) !== year) return false
      if (emd && d.emd !== emd) return false
      if (stage && String(d.stageCd) !== stage) return false
      if (kw && !`${d.name} ${d.emd} ${d.ri} ${d.agent}`.includes(kw)) return false
      return true
    })
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => sign * compareDistrict(a, b, sort.key))
  }, [all, year, emd, stage, keyword, sort])

  const { fitToDistrict } = useCadastralResurveyDistrictLayer({
    districts: filtered,
    selectedId,
    onSelect,
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
      fitToDistrict(id)
    },
    [onSelect, fitToDistrict]
  )

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">지적재조사</span>
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
            aria-label="사업연도"
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
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            aria-label="진행 단계"
          >
            <option value={ALL}>전체 단계</option>
            {stageOptions.map((s) => (
              <option key={s.cd} value={String(s.cd)}>
                {s.name}
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
            placeholder="검색 (지구명, 읍면동, 리, 대행자)"
            className="standard-search-input"
          />
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
                    조회된 지구가 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const st = getResurveyStageGroup(d.stageGroup)
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
                      <td className="standard-table-td-text-muted" title={`${d.emd} ${d.ri}`}>
                        {d.emd} {d.ri}
                      </td>
                      <td className="standard-table-td-date text-center">{d.year}</td>
                      <td className="standard-table-td-date text-center">
                        {d.parcelCount.toLocaleString()}
                      </td>
                      <td className="standard-table-td-compact text-center">
                        <span
                          className="standard-status-badge max-w-full truncate"
                          style={{
                            backgroundColor: `${st.color}33`,
                            color: st.color,
                            boxShadow: `inset 0 0 0 1px ${st.color}80`,
                          }}
                          title={`${st.label} · ${d.stageName}`}
                        >
                          {d.stageName}
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
