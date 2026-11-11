'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { WtlFacilityEquipPanel } from '../facility/WtlFacilityEquipPanel'
import {
  listAllWtlEquipment,
  listWtlEquipKinds,
  type WtlEquipKind,
  type WtlEquipListRow,
} from '../facility/wtlFacilitySample'

const LIST_DEFAULT = 480
const LIST_MIN = 400
const LIST_MAX = 720
const DETAIL_DEFAULT = 420
const DETAIL_MIN = 320
const DETAIL_MAX = 640

function statusClass(status: string) {
  if (status === '가동') return 'text-emerald-700'
  if (status === '정지') return 'text-slate-500'
  if (status === '점검') return 'text-amber-700'
  return 'text-foreground'
}

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

export function WtlEquipmentShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const allRows = useMemo(() => listAllWtlEquipment(), [])
  const kindOptions = useMemo(() => listWtlEquipKinds(allRows), [allRows])
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  const [kindFilter, setKindFilter] = useState<WtlEquipKind | '전체'>('전체')
  const [selectedId, setSelectedId] = useState<string | null>(allRows[0]?.equipment.id ?? null)

  const filtered = useMemo(() => {
    if (kindFilter === '전체') return allRows
    return allRows.filter((row) => row.equipment.kind === kindFilter)
  }, [allRows, kindFilter])

  const selected: WtlEquipListRow | null =
    filtered.find((row) => row.equipment.id === selectedId) ??
    filtered[0] ??
    null

  const detailOpen = selected != null
  const total = listWidth + (detailOpen ? detailWidth : 0)

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  useEffect(() => {
    setSelectedId((prev) => {
      if (filtered.length === 0) return null
      if (prev && filtered.some((row) => row.equipment.id === prev)) return prev
      return filtered[0].equipment.id
    })
  }, [kindFilter, filtered])

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={LIST_MIN}
          maxWidth={LIST_MAX}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
        >
          <div className="standard-panel-root">
            <div className="standard-panel-header">
              <span className="standard-panel-title">설비관리</span>
              <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="standard-filter-section shrink-0">
                <div className="standard-filter-chips">
                  <button
                    type="button"
                    className={cn(
                      'standard-filter-chip',
                      kindFilter === '전체' && 'border-primary bg-primary/10 text-primary'
                    )}
                    onClick={() => setKindFilter('전체')}
                  >
                    전체
                  </button>
                  {kindOptions.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={cn(
                        'standard-filter-chip',
                        kindFilter === kind && 'border-primary bg-primary/10 text-primary'
                      )}
                      onClick={() => setKindFilter(kind)}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full table-fixed border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="border-b border-border">
                      <th className="w-[18%] px-2 py-1.5 font-medium text-muted-foreground">구분</th>
                      <th className="px-2 py-1.5 font-medium text-muted-foreground">설비명</th>
                      <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">소속시설</th>
                      <th className="w-[12%] px-2 py-1.5 font-medium text-muted-foreground">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const on = selected?.equipment.id === row.equipment.id
                      return (
                        <tr
                          key={row.equipment.id}
                          className={cn(
                            'cursor-pointer border-b border-border hover:bg-primary/5',
                            on && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                          )}
                          onClick={() => setSelectedId(row.equipment.id)}
                        >
                          <td className="truncate px-2 py-1.5 text-foreground">{row.equipment.kind}</td>
                          <td className="truncate px-2 py-1.5 text-foreground">{row.equipment.name}</td>
                          <td className="truncate px-2 py-1.5 text-muted-foreground">{row.plant.name}</td>
                          <td className={cn('px-2 py-1.5', statusClass(row.equipment.status))}>
                            {row.equipment.status}
                          </td>
                        </tr>
                      )
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                          해당 설비가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex shrink-0 items-center border-t border-border bg-muted/30 px-3 py-1.5">
                <span className="text-[11px] text-muted-foreground">{filtered.length}건</span>
              </div>
            </div>
          </div>
        </MapSideListPanel>
      </div>
      {detailOpen && selected && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={detailWidth}
            minWidth={DETAIL_MIN}
            maxWidth={DETAIL_MAX}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            <WtlFacilityEquipPanel
              plant={selected.plant}
              equipment={selected.equipment}
              onClose={() => setSelectedId(null)}
            />
          </MapSideListPanel>
        </div>
      )}
    </>
  )
}
