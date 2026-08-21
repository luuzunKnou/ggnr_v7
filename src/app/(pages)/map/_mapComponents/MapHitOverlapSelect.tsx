'use client'

import { cn } from '@/lib/utils'

export type MapHitOverlapOption = {
  value: string
  label: string
  extent3857?: [number, number, number, number] | null
}

type Props = {
  /** 점사용료=대장번호, 점용=허가번호 */
  fieldLabel: string
  options: MapHitOverlapOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

/** 지도 클릭 시 겹친 도형이 2건 이상일 때 상세 상단 선택 */
export function MapHitOverlapSelect({
  fieldLabel,
  options,
  value,
  onChange,
  className,
}: Props) {
  if (options.length <= 1) return null
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5',
        className
      )}
    >
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{fieldLabel}</span>
      <select
        className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs text-foreground outline-none focus:border-primary"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${fieldLabel} 선택`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label || opt.value}
          </option>
        ))}
      </select>
      <span className="shrink-0 pr-2 text-[10px] text-muted-foreground">{options.length}건</span>
    </div>
  )
}
