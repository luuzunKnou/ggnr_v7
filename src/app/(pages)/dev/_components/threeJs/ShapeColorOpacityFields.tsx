'use client';

import { Input } from '@/app/shadcnComponents/ui/input';

type Props = {
  colorId: string;
  opacityId: string;
  label: string;
  color: string;
  opacity: number;
  onColor: (hex: string) => void;
  onOpacity: (n: number) => void;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** 색상 + 불투명도(슬라이더·숫자) 한 줄 블록 */
export function ShapeColorOpacityFields({
  colorId,
  opacityId,
  label,
  color,
  opacity,
  onColor,
  onOpacity,
}: Props) {
  const pct = Math.round(clamp01(opacity) * 1000) / 10;
  return (
    <div className="flex flex-col gap-1.5 rounded border border-border/60 bg-muted/20 p-2">
      <p className="text-[11px] font-medium text-foreground">{label}</p>
      <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
        <label htmlFor={colorId} className="text-[12px] text-foreground">
          색상
        </label>
        <Input
          id={colorId}
          type="color"
          className="h-9 cursor-pointer"
          value={color}
          title={`${label} 색상`}
          onChange={(e) => onColor(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
        <label htmlFor={opacityId} className="text-[12px] text-foreground">
          불투명도
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${opacityId}-range`}
            type="range"
            className="h-9 min-w-0 flex-1 cursor-pointer accent-primary"
            min={0}
            max={1}
            step={0.01}
            value={clamp01(opacity)}
            title={`${label} 불투명도 슬라이더`}
            onChange={(e) => onOpacity(clamp01(Number(e.target.value)))}
          />
          <Input
            id={opacityId}
            type="number"
            className="h-9 w-[4.5rem] shrink-0"
            min={0}
            max={1}
            step={0.01}
            value={clamp01(opacity)}
            title={`${label} 불투명도`}
            onChange={(e) => onOpacity(clamp01(Number(e.target.value)))}
          />
          <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
            {pct}%
          </span>
        </div>
      </div>
    </div>
  );
}
