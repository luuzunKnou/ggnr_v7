'use client';

import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMapContext } from '../../_mapComponents/MapContext';
import { useMapVisualCenterPixel } from '../../_mapComponents/hooks/useMapVisualCenterPixel';
import { GEOM_EDIT_HINT_BELOW_SEARCH_GAP, useSearchBarOffset } from '../../searchBarOffsetContext';
import {
  usePrivateLandAnalysis,
  type PrivateLandAnalysisPhase,
  type PrivateLandClosedTool,
} from './PrivateLandAnalysisContext';

const PICK_TEXT: Partial<Record<PrivateLandAnalysisPhase, string>> = {
  start: '하천 위에서 시작 위치를 찍으세요.',
  loadingBase: '하천 도형을 불러오는 중…',
  end: '하천을 따라 끝 위치를 찍으세요.',
};

const CLOSED_TOOLS: { id: PrivateLandClosedTool; label: string }[] = [
  { id: 'line', label: '선 찍기' },
  { id: 'polygon', label: '다각형' },
  { id: 'rect', label: '사각형' },
  { id: 'circle', label: '원' },
];

const SHAPE_PICK_TEXT: Record<Exclude<PrivateLandClosedTool, 'line'>, string> = {
  polygon: '지도를 클릭해 꼭짓점을 찍고 더블클릭으로 마치세요.',
  rect: '한 모서리를 찍고 맞은편 모서리를 찍으세요.',
  circle: '가운데를 찍고 반지름만큼 움직여 다시 찍으세요.',
};

/** 닫힌 범위 지정 방식 — 선 찍기 / 도형 그리기 */
function ClosedToolSwitch({
  value,
  onChange,
}: {
  value: PrivateLandClosedTool;
  onChange: (tool: PrivateLandClosedTool) => void;
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-background/95 p-1 shadow-lg backdrop-blur">
      {CLOSED_TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={cn(
            'cursor-pointer rounded-full px-3 py-1 text-[12px] transition-colors sm:text-sm',
            value === t.id
              ? 'bg-primary font-medium text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const PILL_SHELL =
  'pointer-events-auto flex max-w-[min(100vw-16px,560px)] flex-wrap items-center gap-2 rounded-full border border-border bg-background/95 py-2 pr-2 pl-4 text-foreground shadow-lg backdrop-blur';
const BTN_MUTED =
  'cursor-pointer rounded-full bg-muted px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';
const BTN_PRIMARY =
  'rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground enabled:cursor-pointer sm:text-sm';

/** 안내 문구 — 문장(마침표) 단위로 줄을 나눔 */
function SentenceLines({ text }: { text: string }) {
  const lines = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="block whitespace-nowrap">
          {line}
        </span>
      ))}
    </>
  );
}

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

/** 지류 추가 창 — 열려 있는 동안 지도에서 지류 끝을 찍는다 */
function TributaryPickCard({
  cutCount,
  previewing,
  rangeError,
  onUndo,
  onClear,
  onDone,
}: {
  cutCount: number;
  previewing: boolean;
  rangeError: string | null;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  return (
    <div className="pointer-events-auto w-[300px] overflow-hidden rounded-[5px] border border-border bg-background shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <span className="text-sm font-medium text-foreground">지류 추가</span>
        <button
          type="button"
          onClick={onDone}
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="닫기"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="space-y-2 px-3 py-2.5 text-[12px] leading-snug">
        <div className="text-muted-foreground">
          <SentenceLines text="포함할 지류 위에서 끝 위치를 찍으세요. 찍은 위치까지 구간이 늘어납니다. 같은 지류를 다시 찍으면 끝 위치가 바뀝니다." />
        </div>
        <p className="font-medium text-foreground">
          추가한 지류 <span className="text-primary">{cutCount}곳</span>
        </p>
        {previewing ? (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
            늘어난 구간 계산 중…
          </p>
        ) : null}
        {rangeError ? (
          <div className="rounded border border-destructive/30 px-2 py-1 text-[11px] font-medium text-destructive">
            <SentenceLines text={rangeError} />
          </div>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-muted/50 px-3 py-2">
        <button type="button" onClick={onUndo} disabled={cutCount === 0} className={BTN_MUTED}>
          끝선 되돌리기
        </button>
        <button type="button" onClick={onClear} disabled={cutCount === 0} className={BTN_MUTED}>
          모두 빼기
        </button>
        <button type="button" onClick={onDone} disabled={previewing} className={BTN_PRIMARY}>
          완료
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
    tribCutCount,
    tributaryPicking,
    openTributaryPick,
    closeTributaryPick,
    undoTributaryCut,
    rangeChecking,
    tribPreviewing,
    rangeError,
    riverOpen,
    rangeMode,
    closedLineCount,
    closedOpen,
    undoLastLine,
    closedTool,
    setClosedTool,
    hasShape,
    redrawShape,
    viewTooLarge,
  } = usePrivateLandAnalysis();
  const closed = rangeMode === 'closed';
  const shapeTool = closed && closedTool !== 'line';
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapPaddingLeft = mapContext?.mapPaddingLeft ?? 0;
  const { inputBottomPx } = useSearchBarOffset();
  const hintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const centerPixel = useMapVisualCenterPixel(map, true, mapPaddingLeft);
  const bannerHost = map?.getTargetElement()?.parentElement ?? null;

  const toolbarActive = phase === 'ranged' || phase === 'applying' || phase === 'analyzing';

  const pickText = closed
    ? phase === 'start'
      ? closedTool !== 'line'
        ? SHAPE_PICK_TEXT[closedTool]
        : viewTooLarge
          ? '지도를 확대한 뒤 도로를 찍으세요.'
          : '도로를 가로질러 범위 경계선을 찍으세요.'
      : undefined
    : PICK_TEXT[phase];
  const applying = phase === 'applying' || phase === 'analyzing';
  const showToolSwitch = closed && (phase === 'start' || phase === 'ranged');
  const rangeInvalid = rangeError != null;
  const hasTributary = !closed && riverKnown && tribCandidateCount > 0;
  const tribCuts = includeTributary ? tribCutCount : 0;
  const openRiver = !closed && riverOpen;
  const checkBlocking = rangeChecking && !tribPreviewing;
  const applyDisabled =
    applying ||
    checkBlocking ||
    rangeInvalid ||
    (shapeTool ? !hasShape : closed && (closedLineCount < 2 || closedOpen));
  const applyLabel =
    phase === 'applying' ? '적용 중…' : phase === 'analyzing' ? '분석 중…' : checkBlocking ? '확인 중…' : '적용';

  if (!bannerHost || !(pickText || message || toolbarActive)) return null;

  return createPortal(
    <div
      className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={centerPixel ? { left: centerPixel.x, top: hintTopPx } : { left: '50%', top: hintTopPx }}
    >
      {showToolSwitch ? <ClosedToolSwitch value={closedTool} onChange={setClosedTool} /> : null}
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
      {!toolbarActive ? null : tributaryPicking && phase === 'ranged' ? (
        <TributaryPickCard
          cutCount={tribCuts}
          previewing={tribPreviewing}
          rangeError={rangeError}
          onUndo={undoTributaryCut}
          onClear={() => setIncludeTributary(false)}
          onDone={closeTributaryPick}
        />
      ) : (
        <>
          {tribPreviewing && !applying ? (
            <div className="pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded-full border border-border/80 bg-background/95 px-3 py-0.5 text-[11px] font-medium leading-snug text-muted-foreground shadow-sm backdrop-blur-md">
              <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
              지류 포함 구간 미리보기 계산 중 · 바로 적용해도 됩니다
            </div>
          ) : null}
          {hasTributary && !rangeInvalid && (openRiver || tribCuts === 0) && !applying ? (
            <div className="pointer-events-auto whitespace-nowrap rounded-full border border-amber-200/90 bg-amber-50/95 px-3 py-0.5 text-[11px] font-medium leading-snug text-amber-900 shadow-sm backdrop-blur-md dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200">
              {openRiver ? '반대쪽 하천은 끝까지 포함됩니다 · 막으려면 «지류 추가»' : '합류하는 지류가 있습니다 · 포함하려면 «지류 추가»'}
            </div>
          ) : null}
          {closed && !applying && !rangeInvalid ? (
            <div
              className={cn(
                'pointer-events-auto whitespace-nowrap rounded-full border px-3 py-0.5 text-[11px] font-medium leading-snug shadow-sm backdrop-blur-md',
                closedOpen || rangeChecking
                  ? 'border-amber-200/90 bg-amber-50/95 text-amber-900 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200'
                  : 'border-red-200/90 bg-red-50/95 text-red-800 dark:border-red-800 dark:bg-red-950/80 dark:text-red-200'
              )}
            >
              {shapeTool
                ? rangeChecking
                  ? '범위 확인 중…'
                  : '도형 안 도로가 범위로 잡혔습니다 · 적용을 누르세요 · 다시 그리면 바뀝니다'
                : rangeChecking
                  ? `범위 확인 중… · 경계선 ${closedLineCount}개`
                  : closedOpen
                    ? `아직 닫히지 않았습니다 · 뻗어나가는 도로마다 경계선을 찍으세요 · 경계선 ${closedLineCount}개`
                    : `범위가 닫혔습니다 · 적용을 누르세요 · 경계선 ${closedLineCount}개`}
            </div>
          ) : null}
          <div className={PILL_SHELL}>
            {closed ? (
              <>
                {shapeTool ? (
                  <button type="button" onClick={redrawShape} disabled={applying} className={BTN_MUTED}>
                    다시 그리기
                  </button>
                ) : (
                  <button type="button" onClick={undoLastLine} disabled={applying} className={BTN_MUTED}>
                    선 되돌리기
                  </button>
                )}
                <span className="h-4 w-px bg-border" aria-hidden />
              </>
            ) : null}
            {hasTributary && !rangeInvalid ? (
              <>
                <button
                  type="button"
                  onClick={openTributaryPick}
                  disabled={applying}
                  className={cn(BTN_MUTED, tribCuts > 0 && 'bg-primary/10 font-medium text-primary')}
                >
                  {tribCuts > 0 ? `지류 ${tribCuts}곳` : '지류 추가'}
                </button>
                <span className="h-4 w-px bg-border" aria-hidden />
              </>
            ) : null}
            <button
              type="button"
              onClick={apply}
              disabled={applyDisabled}
              title={rangeInvalid ? '구간을 다시 지정해야 적용할 수 있습니다.' : undefined}
              className={BTN_PRIMARY}
            >
              {applyLabel}
            </button>
            <button
              type="button"
              onClick={changeArea}
              disabled={applying}
              className={cn(BTN_MUTED, rangeInvalid && !closed && 'bg-primary/10 font-medium text-primary ring-1 ring-primary/40')}
            >
              다시 지정
            </button>
            <CancelButton onClick={resetAll} disabled={applying} />
          </div>
          {rangeInvalid ? (
            <div className="pointer-events-auto rounded-xl border border-destructive/30 bg-background/95 px-3 py-1.5 text-[11px] font-medium leading-snug text-destructive shadow-lg backdrop-blur-md">
              <SentenceLines text={rangeError} />
            </div>
          ) : null}
        </>
      )}
      {message ? (
        <div className="rounded-md border border-destructive/30 bg-background/95 px-3 py-1 text-center text-[12px] text-destructive shadow">
          <SentenceLines text={message} />
        </div>
      ) : null}
    </div>,
    bannerHost,
  );
}
