'use client';

import { Loader2, Waves, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { usePrivateLandAnalysis } from './PrivateLandAnalysisContext';

const LAYER_HINT: Record<string, string> = {
  river_d_as: '국가·지방하천 구역',
  river_s_as: '소하천 구역',
};

const CARD_TONES = [
  {
    card: 'hover:border-primary/40 hover:bg-primary/5',
    icon: 'bg-primary/15 text-primary group-hover:bg-primary/25',
  },
  {
    card: 'hover:border-emerald-500/40 hover:bg-emerald-500/5',
    icon: 'bg-emerald-500/15 text-emerald-600 group-hover:bg-emerald-500/25 dark:text-emerald-400',
  },
];

/** 사유지분석 시작 — 분석할 구역(하천구역·소하천구역) 선택 */
export function PrivateLandAnalysisAreaModal() {
  const { areaModalOpen, closeAreaModal, layers, layersLoading, layer, selectLayer } = usePrivateLandAnalysis();

  return (
    <Dialog open={areaModalOpen} onOpenChange={(open) => (open ? undefined : closeAreaModal())}>
      <DialogContent
        showCloseButton={false}
        className="z-[60] flex max-h-[min(560px,88vh)] flex-col gap-0 overflow-hidden rounded-[5px] border-border p-0 shadow-xl sm:max-w-[480px]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 pt-3 pb-2">
          <DialogTitle className="text-lg font-medium leading-tight text-foreground">분석 구역 선택</DialogTitle>
          <DialogDescription className="sr-only">사유지를 분석할 하천 구역 레이어를 선택합니다.</DialogDescription>
          <button
            type="button"
            onClick={closeAreaModal}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          <p className="mb-3 text-sm text-muted-foreground">
            분석할 구역을 선택하면 이 창이 닫히고 지도에서 하천 구간을 지정합니다.
          </p>
          {layersLoading ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              불러오는 중…
            </p>
          ) : layers.length === 0 ? (
            <p className="text-sm text-muted-foreground">분석할 수 있는 구역 레이어가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {layers.map((l, i) => {
                const tone = CARD_TONES[i % CARD_TONES.length];
                const active = layer?.table === l.table;
                return (
                  <button
                    key={l.table}
                    type="button"
                    onClick={() => selectLayer(l.table)}
                    className={cn(
                      'group flex cursor-pointer flex-col items-center gap-3 rounded-xl border bg-background p-5 text-center shadow-sm transition-all hover:shadow-md',
                      active ? 'border-primary/60' : 'border-border',
                      tone.card
                    )}
                  >
                    <span
                      className={cn('flex size-12 items-center justify-center rounded-full transition-colors', tone.icon)}
                    >
                      <Waves className="size-6" />
                    </span>
                    <span className="text-[15px] font-medium text-foreground">{l.label}</span>
                    <span className="text-sm leading-snug text-muted-foreground">
                      {LAYER_HINT[l.table] ?? '하천 구간 지정'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border bg-muted/50 px-4 py-3 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={closeAreaModal}>
            취소
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
