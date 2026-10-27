'use client';

import { cn } from '@/lib/utils';

export type PrivateLandFilterOption = {
  key: string;
  label: string;
};

type Props = {
  /** 접근성 이름 (소유구분·지목) */
  title: string;
  options: PrivateLandFilterOption[];
  value: string;
  onChange: (key: string) => void;
};

/** 한 줄 칸 수 — 넘치면 다음 줄 */
const FILTER_COLS = 6;

const CHIP_BASE =
  'min-w-0 truncate rounded border px-0.5 py-1 text-center text-[10px] font-medium leading-tight transition-colors';
const CHIP_ON = 'border-primary bg-primary/10 text-primary';
const CHIP_OFF = 'border-border bg-background text-muted-foreground hover:bg-muted/50';

/** 사유지분석 결과 필터 버튼 묶음 — 이름만 있는 버튼. 소유구분·지목 탭이 같은 모양 */
export function PrivateLandFilterGroup({ title, options, value, onChange }: Props) {
  return (
    <div
      className="grid w-full gap-0.5"
      style={{ gridTemplateColumns: `repeat(${Math.min(options.length, FILTER_COLS)}, minmax(0, 1fr))` }}
      role="group"
      aria-label={`${title} 필터`}
    >
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            title={o.label}
            aria-pressed={active}
            className={cn(CHIP_BASE, active ? CHIP_ON : CHIP_OFF)}
          >
            <span className="block truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
