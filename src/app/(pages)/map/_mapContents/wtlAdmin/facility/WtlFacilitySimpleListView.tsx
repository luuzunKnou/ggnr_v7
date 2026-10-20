'use client'

import { cn } from '@/lib/utils'
import type { WtlSimpleItem, WtlSimpleListConfig } from './wtlFacilitySample'

function statusClass(status: string) {
  if (status === '정상' || status === '가동' || status === '관리중') return 'text-emerald-700'
  if (status === '정지' || status === '장애') return 'text-slate-500'
  if (status === '점검') return 'text-amber-700'
  return 'text-foreground'
}

function AttrRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="standard-detail-attr-table">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <div className="standard-detail-attr-label standard-detail-attr-cell-border">{row.label}</div>
          <div className="standard-detail-attr-value standard-detail-attr-cell-border text-foreground">
            {row.label === '상태' || row.label === '가동상태' ? (
              <span className={statusClass(row.value)}>{row.value}</span>
            ) : (
              row.value
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

type Props = {
  config: WtlSimpleListConfig
  selectedId: string | null
  onSelect: (item: WtlSimpleItem) => void
}

export function WtlFacilitySimpleListView({ config, selectedId, onSelect }: Props) {
  const selected = config.items.find((item) => item.id === selectedId) ?? null
  const [c1, c2, c3, c4] = config.columns

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className={cn('flex min-h-0 flex-col overflow-hidden', selected ? 'flex-[3]' : 'flex-1')}>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr className="border-b border-border">
                <th className="px-2 py-1.5 font-medium text-muted-foreground">{c1}</th>
                <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">{c2}</th>
                <th className="w-[18%] px-2 py-1.5 font-medium text-muted-foreground">{c3}</th>
                <th className="w-[14%] px-2 py-1.5 font-medium text-muted-foreground">{c4}</th>
              </tr>
            </thead>
            <tbody>
              {config.items.map((item) => (
                <tr
                  key={item.id}
                  className={cn(
                    'cursor-pointer border-b border-border hover:bg-primary/5',
                    selectedId === item.id && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                  )}
                  onClick={() => onSelect(item)}
                >
                  <td className="truncate px-2 py-1.5 text-foreground">{item.name}</td>
                  <td className="truncate px-2 py-1.5 text-foreground">{item.col2}</td>
                  <td className="truncate px-2 py-1.5 text-foreground">{item.col3}</td>
                  <td className={cn('px-2 py-1.5', statusClass(item.status))}>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center border-t border-border bg-muted/30 px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">{config.items.length}건</span>
        </div>
      </div>

      {selected && (
        <div className="flex min-h-0 flex-[7] flex-col overflow-hidden border-t-2 border-primary/30 bg-background">
          <div className="min-h-0 flex-1 overflow-auto">
            <AttrRows rows={selected.attrs} />
          </div>
        </div>
      )}
    </div>
  )
}
