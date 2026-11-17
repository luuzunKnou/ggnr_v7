'use client';

import { Input } from '@/app/shadcnComponents/ui/input';
import type { ShapeProps } from './shapeTypes';

type Props = {
  draft: ShapeProps;
  onChange: (next: ShapeProps) => void;
};

/** 지형·관로 모달용 색상·불투명도 */
export function ShapeAppearanceFields({ draft, onChange }: Props) {
  const opacity = Math.max(0, Math.min(1, draft.opacity ?? 1));
  const pct = Math.round(opacity * 1000) / 10;

  return (
    <div className="grid gap-3 rounded border border-border/60 bg-muted/20 p-2">
      <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
        <label htmlFor="shape-appear-color" className="text-[12px] text-foreground">
          색상
        </label>
        <Input
          id="shape-appear-color"
          type="color"
          className="h-9 cursor-pointer"
          value={draft.color || '#84cc16'}
          title="색상"
          onChange={(e) => onChange({ ...draft, color: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
        <label htmlFor="shape-appear-opacity" className="pt-2 text-[12px] text-foreground">
          불투명도
        </label>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              id="shape-appear-opacity-range"
              type="range"
              className="h-9 min-w-0 flex-1 cursor-pointer accent-primary"
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              title="불투명도 슬라이더"
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange({
                  ...draft,
                  opacity: Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : opacity,
                });
              }}
            />
            <Input
              id="shape-appear-opacity"
              type="number"
              className="h-9 w-[4.5rem] shrink-0"
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              title="불투명도"
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange({
                  ...draft,
                  opacity: Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : opacity,
                });
              }}
            />
            <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
              {pct}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
