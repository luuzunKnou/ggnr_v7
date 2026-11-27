'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MAP_UI_Z_CLASS } from '@/lib/mapUiZIndex'
import type { OdorStationRow } from '../odorDashboard2StationRows'

type Props = {
  open: boolean
  stations: OdorStationRow[]
  currentStationId: string
  selectedIds: string[]
  onConfirm: (ids: string[]) => void
  onClose: () => void
}

/**
 * 추이비교 — 다중 측정 지점 선택 (업체 아코디언·현재 지점 고정).
 */
export function OdorMultiStationPickModal({
  open,
  stations,
  currentStationId,
  selectedIds,
  onConfirm,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selectedIds))
  const [emdFilter, setEmdFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [openAgencies, setOpenAgencies] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!open) return
    setDraft(new Set(selectedIds.includes(currentStationId) ? selectedIds : [...selectedIds, currentStationId]))
    setEmdFilter('all')
    setKeyword('')
  }, [open, selectedIds, currentStationId])

  const emdOptions = useMemo(() => {
    const set = new Set(stations.map((s) => s.emdNm).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [stations])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return stations.filter((s) => {
      if (emdFilter !== 'all' && s.emdNm !== emdFilter) return false
      if (!kw) return true
      return (
        s.sensorKorNm.toLowerCase().includes(kw) ||
        s.sensorNm.toLowerCase().includes(kw) ||
        s.agency.toLowerCase().includes(kw)
      )
    })
  }, [stations, emdFilter, keyword])

  const byAgency = useMemo(() => {
    const map = new Map<string, OdorStationRow[]>()
    for (const s of filtered) {
      const key = s.agency || '기타'
      const list = map.get(key) ?? []
      list.push(s)
      map.set(key, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))
  }, [filtered])

  useEffect(() => {
    if (!open) return
    const agencies = [
      ...new Set(stations.map((s) => s.agency || '기타')),
    ]
    const next: Record<string, boolean> = {}
    for (const agency of agencies) next[agency] = true
    setOpenAgencies(next)
  }, [open, stations])

  const toggle = (id: string) => {
    if (id === currentStationId) return
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      next.add(currentStationId)
      return next
    })
  }

  const toggleAgency = (agency: string) => {
    setOpenAgencies((prev) => ({ ...prev, [agency]: !prev[agency] }))
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center bg-black/40 p-3',
        MAP_UI_Z_CLASS.nestedDialog
      )}
      role="dialog"
      aria-modal="true"
      aria-label="다중 측정 지점 선택"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(80vh,560px)] w-full max-w-md flex-col overflow-hidden rounded border border-border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h3 className="text-[13px] font-semibold text-foreground">다중 측정 지점 선택</h3>
          <button
            type="button"
            title="닫기"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
          <label className="sr-only" htmlFor="odor-compare-emd">
            읍면동
          </label>
          <select
            id="odor-compare-emd"
            title="읍면동"
            value={emdFilter}
            onChange={(e) => setEmdFilter(e.target.value)}
            className="h-7 w-[7.5rem] shrink-0 cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
          >
            <option value="all">읍면동 전체</option>
            {emdOptions.map((emd) => (
              <option key={emd} value={emd}>
                {emd}
              </option>
            ))}
          </select>
          <div className="standard-search-wrap min-w-0 flex-1">
            <Search className="standard-search-icon" aria-hidden />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="지점 찾기"
              title="지점 찾기"
              className="standard-search-input focus:ring-0 focus:ring-offset-0"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-1.5">
          {byAgency.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              조건에 맞는 지점이 없습니다.
            </p>
          ) : (
            byAgency.map(([agency, list]) => {
              const openRow = openAgencies[agency] !== false
              return (
                <div key={agency} className="mb-1 rounded border border-border">
                  <button
                    type="button"
                    title={agency}
                    className="flex w-full cursor-pointer items-center gap-1 px-2 py-1.5 text-left text-[12px] font-medium text-foreground hover:bg-muted/40"
                    onClick={() => toggleAgency(agency)}
                  >
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                        !openRow && '-rotate-90'
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{agency}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {list.length}개
                    </span>
                  </button>
                  {openRow ? (
                    <ul className="border-t border-border px-1 py-1">
                      {list.map((s) => {
                        const isCurrent = s.id === currentStationId
                        const checked = draft.has(s.id)
                        return (
                          <li key={s.id}>
                            <label
                              className={cn(
                                'flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-muted/50',
                                isCurrent && 'bg-primary/5'
                              )}
                              title={s.sensorKorNm}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 cursor-pointer"
                                checked={checked}
                                disabled={isCurrent}
                                onChange={() => toggle(s.id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-foreground">
                                  {s.sensorKorNm}
                                  {isCurrent ? (
                                    <span className="ml-1 font-normal text-muted-foreground">
                                      (현재 선택 지점)
                                    </span>
                                  ) : null}
                                </span>
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {s.sensorNm} · {s.emdNm}
                                </span>
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border px-3 py-2">
          <button
            type="button"
            title="취소"
            className="standard-detail-action-btn cursor-pointer"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            title="적용"
            className="inline-flex h-7 cursor-pointer items-center rounded border border-primary bg-primary px-2.5 text-[11px] font-medium text-white hover:bg-primary/90"
            onClick={() => {
              const ids = [...draft]
              if (!ids.includes(currentStationId)) ids.push(currentStationId)
              onConfirm(ids)
              onClose()
            }}
          >
            적용
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
