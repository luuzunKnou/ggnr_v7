'use client'

import { cn } from '@/lib/utils'
import type { WtlEquipment, WtlPlant } from './wtlFacilitySample'

function statusClass(status: string) {
  if (status === '가동') return 'text-emerald-700'
  if (status === '정지') return 'text-slate-500'
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
            {row.label === '가동상태' ? <span className={statusClass(row.value)}>{row.value}</span> : row.value}
          </div>
        </div>
      ))}
    </div>
  )
}

type Props = {
  plants: WtlPlant[]
  selectedPlantId: string | null
  selectedEquipId: string | null
  onSelectPlant: (plant: WtlPlant) => void
  onSelectEquip: (equip: WtlEquipment | null) => void
}

export function WtlFacilityPlantView({
  plants,
  selectedPlantId,
  selectedEquipId,
  onSelectPlant,
  onSelectEquip,
}: Props) {
  const selected = plants.find((plant) => plant.id === selectedPlantId) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className={cn('flex min-h-0 flex-col overflow-hidden', selected ? 'flex-[3]' : 'flex-1')}>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr className="border-b border-border">
                <th className="px-2 py-1.5 font-medium text-muted-foreground">시설명</th>
                <th className="w-[28%] px-2 py-1.5 font-medium text-muted-foreground">용량</th>
                <th className="w-[14%] px-2 py-1.5 font-medium text-muted-foreground">준공</th>
                <th className="w-[14%] px-2 py-1.5 font-medium text-muted-foreground">상태</th>
              </tr>
            </thead>
            <tbody>
              {plants.map((plant) => (
                <tr
                  key={plant.id}
                  className={cn(
                    'cursor-pointer border-b border-border hover:bg-primary/5',
                    selectedPlantId === plant.id && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                  )}
                  onClick={() => onSelectPlant(plant)}
                >
                  <td className="truncate px-2 py-1.5 text-foreground">{plant.name}</td>
                  <td className="truncate px-2 py-1.5 text-foreground">{plant.capacity}</td>
                  <td className="px-2 py-1.5 text-foreground">{plant.year}</td>
                  <td className={cn('px-2 py-1.5', statusClass(plant.status))}>{plant.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center border-t border-border bg-muted/30 px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">{plants.length}건</span>
        </div>
      </div>

      {selected && (
        <div className="flex min-h-0 flex-[7] flex-col overflow-hidden border-t-2 border-primary/30 bg-background">
          <div className="min-h-0 flex-1 overflow-auto">
            <AttrRows
              rows={[
                { label: '시설명', value: selected.name },
                { label: '종류', value: selected.kind },
                { label: '용량', value: selected.capacity },
                { label: '준공연도', value: selected.year },
                { label: '주소', value: selected.address },
                { label: '가동상태', value: selected.status },
                { label: '관리자', value: selected.manager },
                { label: '연락처', value: selected.phone },
              ]}
            />
            <div className="flex items-center justify-between border-y border-border bg-muted/40 px-3 py-1.5">
              <span className="text-[11px] font-semibold text-foreground">내부설비</span>
              <span className="text-[11px] text-muted-foreground">{selected.equipment.length}건</span>
            </div>
            <table className="w-full table-fixed border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-[22%] px-2 py-1.5 font-medium text-muted-foreground">구분</th>
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">설비명</th>
                  <th className="w-[14%] px-2 py-1.5 font-medium text-muted-foreground">상태</th>
                  <th className="w-[24%] px-2 py-1.5 font-medium text-muted-foreground">점검일</th>
                </tr>
              </thead>
              <tbody>
                {selected.equipment.map((item) => (
                  <tr
                    key={item.id}
                    className={cn(
                      'cursor-pointer border-b border-border hover:bg-primary/5',
                      selectedEquipId === item.id && 'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                    )}
                    onClick={() => onSelectEquip(item)}
                  >
                    <td className="truncate px-2 py-1.5 text-foreground">{item.kind}</td>
                    <td className="truncate px-2 py-1.5 text-foreground">{item.name}</td>
                    <td className={cn('px-2 py-1.5', statusClass(item.status))}>{item.status}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{item.lastCheck}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
