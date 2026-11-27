'use client'

import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LayerRowParcelItem } from '../../../_mapComponents/layerRowEdit'
import {
  formatSqm,
  jimokBadgeStyle,
  jimokFullName,
  ownGbnBadgeStyle,
  ownGbnShort,
} from '../../privateLandAnalysis/privateLandAnalysisFormat'

export type ConsParcelRow = {
  address: string
  pnu: string
  jimok?: string
  /** 소유구분(개인·국유지 등) */
  ownGbn?: string
  areaSqm?: number
  geometry3857?: Record<string, unknown> | null
}

type Props = {
  parcels: ConsParcelRow[]
  parcelItems: LayerRowParcelItem[]
  selectedIdx: number | null
  onClick: (item: LayerRowParcelItem, index: number) => void
}

function EmptyParcelHint() {
  return (
    <div className="shrink-0 rounded border border-border bg-muted/30 px-3 py-4 text-center">
      <MapPin className="mx-auto mb-1.5 h-4 w-4 text-muted-foreground/60" strokeWidth={1.5} aria-hidden />
      <p className="text-[11px] leading-relaxed text-muted-foreground">교차하는 필지가 없습니다.</p>
    </div>
  )
}

/** 시안1 — 사유지분석 목록: 소유구분·지목 배지·주소·면적 */
function ParcelListV1({
  parcels,
  selectedIdx,
  onSelect,
}: {
  parcels: ConsParcelRow[]
  selectedIdx: number | null
  onSelect: (index: number) => void
}) {
  if (parcels.length === 0) return <EmptyParcelHint />
  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col />
          <col className="w-[5.75rem]" />
        </colgroup>
        <tbody>
          {parcels.map((row, i) => {
            const isSelected = selectedIdx === i
            const ownGbn = String(row.ownGbn ?? '').trim() || '미상'
            const jimok = String(row.jimok ?? '').trim()
            return (
              <tr
                key={`v1-${row.pnu || i}-${row.address.slice(0, 20)}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(i)
                  }
                }}
                className={cn(
                  'cursor-pointer border-b border-border align-middle transition-colors',
                  isSelected
                    ? 'border-l-[3px] border-l-primary bg-primary/11 ring-1 ring-inset ring-primary/20 hover:bg-primary/14'
                    : 'border-l-[3px] border-l-transparent hover:bg-muted/50'
                )}
              >
                <td className="min-w-0 overflow-hidden px-3 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="inline-flex w-[3.5rem] shrink-0 items-center justify-center truncate whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                      style={ownGbnBadgeStyle(ownGbn)}
                      title={ownGbn}
                    >
                      {ownGbnShort(ownGbn)}
                    </span>
                    {jimok ? (
                      <span
                        className="inline-flex w-[2.5rem] shrink-0 items-center justify-center truncate whitespace-nowrap rounded border px-0.5 py-0.5 text-[10px] font-semibold leading-none"
                        style={jimokBadgeStyle(jimok)}
                        title={jimokFullName(jimok)}
                      >
                        {jimok}
                      </span>
                    ) : null}
                    <p
                      className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight text-foreground"
                      title={row.address || row.pnu}
                    >
                      {row.address || row.pnu || '필지 미확인'}
                    </p>
                  </div>
                </td>
                <td
                  className="min-w-0 px-3 py-2.5 pl-1.5 text-right text-[11px] tabular-nums text-muted-foreground"
                  title="면적"
                >
                  <span className="block truncate">{formatSqm(row.areaSqm)}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 공사대장 필지목록 — 시안1(사유지분석) 고정 */
export function WtlConsParcelListVariants({ parcels, parcelItems, selectedIdx, onClick }: Props) {
  const selectByIndex = (index: number) => {
    const item = parcelItems[index]
    if (item) onClick(item, index)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ParcelListV1 parcels={parcels} selectedIdx={selectedIdx} onSelect={selectByIndex} />
    </div>
  )
}
