'use client';

import { useCallback } from 'react';
import { ArrowLeft, Circle, MapPin, Pentagon, Pencil, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import type { BoundaryEmdSelection, DrawTool, ParcelModalStep } from './parcelAnalysisTypes';
import {
  getBoundarySelectionCount,
  ParcelAnalysisBoundaryPicker,
} from './ParcelAnalysisBoundaryPicker';

type Props = {
  open: boolean;
  step: ParcelModalStep;
  hasConfirmedArea: boolean;
  boundarySessionDraft: BoundaryEmdSelection[];
  onBoundarySessionDraftChange: (selection: BoundaryEmdSelection[]) => void;
  onStepChange: (step: ParcelModalStep) => void;
  onClose: () => void;
  onDismiss: () => void;
  onStartDraw: (tool: DrawTool) => void;
  onApplyBoundary: (selection: BoundaryEmdSelection[]) => void;
  applyingArea: boolean;
};

const DRAW_TOOLS: { id: DrawTool; icon: typeof Square; label: string }[] = [
  { id: 'rectangle', icon: Square, label: '사각형' },
  { id: 'polygon', icon: Pentagon, label: '다각형' },
  { id: 'circle', icon: Circle, label: '원' },
];

const STEP_MAX_WIDTH: Record<ParcelModalStep, string> = {
  choose: 'sm:max-w-[480px]',
  draw: 'sm:max-w-[440px]',
  boundary: 'sm:max-w-[520px]',
};

const STEP_SUBTITLE: Record<Exclude<ParcelModalStep, 'choose'>, string> = {
  draw: '도형 그리기',
  boundary: '행정경계 선택',
};

export function ParcelAnalysisMethodModal({
  open,
  step,
  hasConfirmedArea,
  boundarySessionDraft,
  onBoundarySessionDraftChange,
  onStepChange,
  onClose,
  onDismiss,
  onStartDraw,
  onApplyBoundary,
  applyingArea,
}: Props) {
  const dismissOrExit = useCallback(() => {
    if (hasConfirmedArea) onDismiss();
    else onClose();
  }, [hasConfirmedArea, onDismiss, onClose]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) return;
      if (step === 'choose') dismissOrExit();
      else onStepChange('choose');
    },
    [step, dismissOrExit, onStepChange]
  );

  const handleSecondaryAction = useCallback(() => {
    if (step === 'choose') dismissOrExit();
    else onStepChange('choose');
  }, [step, dismissOrExit, onStepChange]);

  const boundaryCount = getBoundarySelectionCount(boundarySessionDraft);
  const canApplyBoundary = boundaryCount > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal={step !== 'draw'}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'gap-0 overflow-hidden rounded-[5px] border-slate-200/80 p-0 shadow-xl',
          'flex max-h-[min(560px,88vh)] flex-col',
          STEP_MAX_WIDTH[step]
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 pt-3 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {step !== 'choose' && (
              <button
                type="button"
                onClick={() => onStepChange('choose')}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="뒤로"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <DialogTitle className="flex min-w-0 items-baseline gap-2 text-lg font-medium leading-tight text-slate-800">
              <span className="truncate">분석 영역 지정</span>
              {step !== 'choose' && (
                <span className="truncate text-sm font-normal text-slate-500">
                  · {STEP_SUBTITLE[step]}
                </span>
              )}
            </DialogTitle>
          </div>
          <button
            type="button"
            onClick={dismissOrExit}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {step === 'choose' && (
            <>
              <p className="mb-3 text-sm text-slate-500">분석할 영역을 지정하는 방식을 선택하세요.</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onStepChange('draw')}
                  className="group flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-md"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 transition-colors group-hover:bg-blue-200">
                    <Pencil className="size-6" />
                  </span>
                  <span className="text-[15px] font-medium text-slate-800">도형 그리기</span>
                  <span className="text-sm leading-snug text-slate-500">사각형 · 다각형 · 원</span>
                </button>
                <button
                  type="button"
                  onClick={() => onStepChange('boundary')}
                  className="group flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-50/40 hover:shadow-md"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 transition-colors group-hover:bg-emerald-200">
                    <MapPin className="size-6" />
                  </span>
                  <span className="text-[15px] font-medium text-slate-800">행정경계 선택</span>
                  <span className="text-sm leading-snug text-slate-500">읍 · 면 · 동 · 리</span>
                </button>
              </div>
            </>
          )}

          {step === 'draw' && (
            <div className="space-y-4">
              <p className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm leading-relaxed text-slate-600">
                도구를 선택하면 이 창이 닫히고 지도에 그릴 수 있어요. 다 그린 뒤 꼭짓점을 드래그해 수정하고 «적용»하세요.
              </p>
              <div className="flex flex-wrap gap-2">
                {DRAW_TOOLS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onStartDraw(t.id)}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-normal text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <Icon className="size-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'boundary' && (
            <ParcelAnalysisBoundaryPicker
              initialSelection={boundarySessionDraft}
              onSelectionChange={onBoundarySessionDraftChange}
            />
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={handleSecondaryAction}>
            {step === 'choose' ? '취소' : '뒤로'}
          </Button>
          {step === 'boundary' && (
            <Button
              type="button"
              size="sm"
              disabled={!canApplyBoundary || applyingArea}
              onClick={() => onApplyBoundary(boundarySessionDraft)}
            >
              {applyingArea ? '적용 중…' : '적용'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
