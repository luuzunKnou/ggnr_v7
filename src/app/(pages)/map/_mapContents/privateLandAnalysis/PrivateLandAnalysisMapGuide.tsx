'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMapContext } from '../../_mapComponents/MapContext';
import { useDrawToolbarPosition } from '../../_mapComponents/analysisArea';
import { useMapVisualCenterPixel } from '../../_mapComponents/hooks/useMapVisualCenterPixel';
import { GEOM_EDIT_HINT_BELOW_SEARCH_GAP, useSearchBarOffset } from '../../searchBarOffsetContext';
import { usePrivateLandAnalysis, type PrivateLandAnalysisPhase } from './PrivateLandAnalysisContext';

const PICK_TEXT: Partial<Record<PrivateLandAnalysisPhase, string>> = {
  start: '하천 위에서 시작 위치를 찍으세요.',
  loadingBase: '하천 도형을 불러오는 중…',
  end: '하천을 따라 끝 위치를 찍으세요.',
};

const PILL_SHELL =
  'pointer-events-auto flex max-w-[min(100vw-16px,560px)] flex-wrap items-center gap-2 rounded-full border border-border bg-background/95 py-2 pr-2 pl-4 text-foreground shadow-lg backdrop-blur';
const BTN_MUTED =
  'cursor-pointer rounded-full bg-muted px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';
const BTN_PRIMARY =
  'rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground enabled:cursor-pointer sm:text-sm';

function CancelButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="취소"
      aria-label="취소"
      className="flex cursor-pointer items-center gap-1 rounded-full bg-muted py-1 pr-2.5 pl-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
    >
      <X className="size-3.5" />
      취소
    </button>
  );
}

/** 합류 지류 포함 여부 선택 */
function TributaryChoice({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const seg = (active: boolean) =>
    cn(
      'rounded-full px-2.5 py-0.5 text-[12px] transition-colors disabled:cursor-not-allowed sm:text-sm',
      active ? 'bg-background font-medium text-foreground shadow-sm' : 'cursor-pointer text-muted-foreground hover:text-foreground'
    );
  return (
    <div className="flex items-center">
      <div className="flex rounded-full bg-muted p-0.5" role="radiogroup" aria-label="지류 포함 여부">
        <button type="button" role="radio" aria-checked={!on} disabled={disabled} onClick={() => onChange(false)} className={seg(!on)}>
          미포함
        </button>
        <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(true)} className={seg(on)}>
          포함
        </button>
      </div>
    </div>
  );
}

/** 지도 위 단계 안내·구간 툴바 */
export function PrivateLandAnalysisMapGuide() {
  const {
    phase,
    message,
    changeArea,
    resetAll,
    apply,
    riverKnown,
    includeTributary,
    setIncludeTributary,
    tribCandidateCount,
    toolbarAnchor,
  } = usePrivateLandAnalysis();
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const { inputBottomPx } = useSearchBarOffset();
  const hintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const centerPixel = useMapVisualCenterPixel(map, true, mapPaddingLeft);
  const bannerHost = map?.getTargetElement()?.parentElement ?? null;

  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarActive = (phase === 'ranged' || phase === 'applying') && toolbarAnchor != null;
  const placement = useDrawToolbarPosition(
    mapContext?.mapInstanceRef ?? { current: null },
    toolbarAnchor,
    toolbarRef,
    toolbarActive
  );

  const pickText = PICK_TEXT[phase];
  const applying = phase === 'applying';
  const hasTributary = riverKnown && tribCandidateCount > 0;

  return (
    <>
      {bannerHost && (pickText || message)
        ? createPortal(
            <div
              className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col items-center gap-1.5"
              style={centerPixel ? { left: centerPixel.x, top: hintTopPx } : { left: '50%', top: hintTopPx }}
            >
              {pickText ? (
                <div className={PILL_SHELL}>
                  {phase === 'loadingBase' ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                  ) : null}
                  <span className="text-[12px] leading-snug sm:text-sm">{pickText}</span>
                  {phase === 'end' ? (
                    <button type="button" onClick={changeArea} className={BTN_MUTED}>
                      다시 찍기
                    </button>
                  ) : null}
                  <CancelButton onClick={resetAll} disabled={phase === 'loadingBase'} />
                </div>
              ) : null}
              {message ? (
                <div className="rounded-md border border-destructive/30 bg-background/95 px-3 py-1 text-[12px] text-destructive shadow">
                  {message}
                </div>
              ) : null}
            </div>,
            bannerHost
          )
        : null}

      {toolbarActive ? (
        <div
          ref={toolbarRef}
          className="pointer-events-none fixed z-[1200] flex flex-col items-start gap-2"
          style={
            placement
              ? { left: placement.left, top: placement.top }
              : { left: '50%', top: 16, transform: 'translateX(-50%)' }
          }
        >
          <div className={PILL_SHELL}>
            {hasTributary ? (
              <>
                <TributaryChoice on={includeTributary} disabled={applying} onChange={setIncludeTributary} />
                <span className="h-4 w-px bg-border" aria-hidden />
              </>
            ) : null}
            <button type="button" onClick={apply} disabled={applying} className={BTN_PRIMARY}>
              {applying ? '적용 중…' : '적용'}
            </button>
            <button type="button" onClick={changeArea} disabled={applying} className={BTN_MUTED}>
              다시 지정
            </button>
            <CancelButton onClick={resetAll} disabled={applying} />
          </div>
          {hasTributary ? (
            <div className="pointer-events-auto rounded-xl border border-amber-200/90 bg-amber-50/95 px-3 py-1.5 text-[11px] font-medium leading-snug text-amber-900 shadow-[0_6px_20px_rgba(245,158,11,0.15)] backdrop-blur-md dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200">
              {includeTributary
                ? '포함할 지류 위에서 끝 위치를 찍으세요. 찍은 위치까지 구간이 늘어납니다.'
                : '구간에 합류하는 지류가 있습니다. 포함할지 선택하세요.'}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
