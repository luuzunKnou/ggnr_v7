'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WtlEquipment, WtlHistoryRow, WtlPlant } from './wtlFacilitySample'

type HistoryTab = 'maint' | 'inspect' | 'contract'

function statusClass(status: string) {
  if (status === '가동') return 'text-emerald-700'
  if (status === '정지') return 'text-slate-500'
  if (status === '점검') return 'text-amber-700'
  return 'text-foreground'
}

function HistoryTable({ rows, empty }: { rows: WtlHistoryRow[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">{empty}</p>
  }
  return (
    <table className="w-full table-fixed border-collapse text-left text-[11px]">
      <thead>
        <tr className="border-b border-border bg-muted/50">
          <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">일자</th>
          <th className="px-2 py-1.5 font-medium text-muted-foreground">내용</th>
          <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">담당·업체</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.date}-${row.title}`} className="border-b border-border">
            <td className="px-2 py-1.5 text-foreground">{row.date}</td>
            <td className="truncate px-2 py-1.5 text-foreground">{row.title}</td>
            <td className="truncate px-2 py-1.5 text-muted-foreground">{row.party}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AttrRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="standard-detail-attr-table">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <div className="standard-detail-attr-label standard-detail-attr-cell-border">{row.label}</div>
          <div className="standard-detail-attr-value standard-detail-attr-cell-border text-foreground">
            {row.label === '가동상태' ? <span className={statusClass(row.value)}>{row.value}</span> : row.value}
          </div>
        </div>
      ))}
    </div>
  )
}

type Props = {
  plant: WtlPlant
  equipment: WtlEquipment
  onClose: () => void
}

export function WtlFacilityEquipPanel({ plant, equipment, onClose }: Props) {
  const [historyTab, setHistoryTab] = useState<HistoryTab>('maint')

  useEffect(() => {
    setHistoryTab('maint')
  }, [equipment.id])

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <div className="min-w-0 flex-1">
          <span className="standard-panel-title truncate">{equipment.name}</span>
          <p className="truncate text-[11px] text-muted-foreground">
            {plant.name} · {equipment.kind}
          </p>
        </div>
        <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-[4] flex-col overflow-hidden border-b border-border">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">제원</span>
            <span className={cn('text-[11px]', statusClass(equipment.status))}>{equipment.status}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <AttrRows
              rows={[
                { label: '설비명', value: equipment.name },
                { label: '구분', value: equipment.kind },
                { label: '형식', value: equipment.form },
                { label: '용량', value: equipment.capacity },
                { label: '제작사', value: equipment.maker },
                { label: '설치연도', value: equipment.installYear },
                { label: '가동상태', value: equipment.status },
                { label: '최근점검', value: equipment.lastCheck },
              ]}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-[6] flex-col overflow-hidden">
          <div className="flex shrink-0 border-b border-border">
            {(
              [
                { id: 'maint', label: '유지보수' },
                { id: 'inspect', label: '정기점검' },
                { id: 'contract', label: '계약정보' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'flex-1 py-2 text-center text-[11px] font-medium transition-colors',
                  historyTab === item.id
                    ? 'border-b-2 border-primary bg-primary/5 text-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
                onClick={() => setHistoryTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {historyTab === 'maint' && (
              <HistoryTable rows={equipment.maintenance} empty="유지보수 이력이 없습니다." />
            )}
            {historyTab === 'inspect' && (
              <HistoryTable rows={equipment.inspection} empty="정기점검 이력이 없습니다." />
            )}
            {historyTab === 'contract' && (
              <HistoryTable rows={equipment.contracts} empty="계약정보가 없습니다." />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
