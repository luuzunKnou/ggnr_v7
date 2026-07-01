'use client';

import { cn } from '@/lib/utils';

export const SER_LEVELS = [
  { v: 0, l: '없음' },
  { v: 1, l: '버튼보기' },
  { v: 2, l: '읽기' },
  { v: 3, l: '쓰기' },
] as const;

export function SerLevelSegments(props: { value: number; onChange: (v: number) => void }) {
  const { value, onChange } = props;
  return (
    <div
      role="group"
      aria-label="접근 단계"
      className="inline-flex max-w-full flex-wrap gap-px rounded-md border border-border/70 bg-muted/40 p-px"
    >
      {SER_LEVELS.map((l) => {
        const selected = value === l.v;
        return (
          <button
            key={l.v}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(l.v)}
            className={cn(
              'rounded-[3px] px-1.5 py-0.5 text-[11px] font-normal transition-colors leading-tight',
              selected
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/90 hover:text-foreground'
            )}
          >
            {l.l}
          </button>
        );
      })}
    </div>
  );
}

const SYS_ACCESS_OPTIONS = [
  { allowed: false as const, label: '없음' },
  { allowed: true as const, label: '접속허용' },
] as const;

export function SysAccessSegments(props: { allowed: boolean; onChange: (allowed: boolean) => void }) {
  const { allowed, onChange } = props;
  return (
    <div
      role="group"
      aria-label="시스템 접속"
      className="inline-flex max-w-full flex-wrap gap-px rounded-md border border-border/70 bg-muted/40 p-px"
    >
      {SYS_ACCESS_OPTIONS.map((o) => {
        const selected = allowed === o.allowed;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.allowed)}
            className={cn(
              'rounded-[3px] px-1.5 py-0.5 text-[11px] font-normal transition-colors leading-tight',
              selected
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/90 hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
