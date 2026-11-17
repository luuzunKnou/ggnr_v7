'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Map as OlMap, MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { GitBranch, Loader2 } from 'lucide-react';
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
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-background/95 p-0.5 shadow-md backdrop-blur">
      {CLOSED_TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={cn(
            'cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] transition-colors',
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

/** 지도를 덜 가리도록 낮고 짧은 알약 모양 — 한 줄 유지 */
const PILL_SHELL =
  'pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background/95 py-1 pr-1 pl-3 text-[12px] leading-snug text-foreground shadow-md backdrop-blur';
const NOTICE_SHELL =
  'pointer-events-none whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-snug shadow-sm backdrop-blur-md';
const BTN_MUTED =
  'cursor-pointer rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY =
  'rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground enabled:cursor-pointer';
const PILL_DIVIDER = 'h-3.5 w-px shrink-0 bg-border';
/** 오류·알림 — 길면 줄바꿈해 옆으로 늘어나지 않게 */
const ERROR_NOTICE =
  'pointer-events-none max-w-[300px] rounded-lg border border-destructive/30 bg-background/95 px-2.5 py-1 text-[11px] font-medium leading-snug text-destructive shadow-sm backdrop-blur-md';

/** 커서에서 박스까지 거리(px) */
const FOLLOW_OFFSET = 16;
/** 지도 가장자리 여백(px) */
const FOLLOW_EDGE_GAP = 8;
/** 한 프레임마다 목표 위치로 다가가는 비율 — 클수록 빠르게 붙음 */
const FOLLOW_EASE = 0.35;
/** 이 거리(px) 안에서 박스 쪽으로 움직이면 고정 */
const FREEZE_APPROACH_PX = 60;
/** 고정 후 이 거리(px) 넘게 멀어지면 다시 따라감 */
const FREEZE_RELEASE_PX = 120;
/** 이동 방향과 박스 방향 사이 각도가 약 50° 이내면 «다가감»으로 봄 */
const FREEZE_APPROACH_COS = 0.65;
/** 한 번에 이만큼(px) 넘게 움직이면 지도를 훑는 중으로 보고 고정하지 않음 — 버튼을 노릴 땐 느려짐 */
const FREEZE_MAX_STEP_PX = 24;

type Point = { x: number; y: number };

/**
 * 안내 전체를 담는 하나의 박스 — 단계가 바뀌어도 같은 박스라 위치가 튀지 않는다.
 * - 마우스를 프레임마다 부드럽게 따라감(React 다시 그리기 없이 위치만 옮김)
 * - 누를 버튼이 있으면 마우스가 박스 쪽으로 다가갈 때 고정, 멀리 벗어나면 다시 따라감
 * - hold 중(적용·분석 중)엔 그 자리에 멈춤
 * - 지도 밖으로 나가도 마지막 위치 유지. 마우스가 한 번도 지도에 없었으면 상단 가운데
 */
function FollowBox({
  map,
  host,
  minLeft,
  interactive,
  hold,
  fallback,
  pointerRef,
  posRef,
  children,
}: {
  map: OlMap;
  host: HTMLElement;
  minLeft: number;
  interactive: boolean;
  hold: boolean;
  fallback: Point;
  /** 박스가 없을 때도 기록한 마지막 마우스 위치 — 다시 뜰 때 그 자리에서 시작 */
  pointerRef: RefObject<Point | null>;
  /** 마지막으로 그린 박스 위치 — 다시 뜰 때 튀지 않게 이어서 움직임 */
  posRef: RefObject<Point | null>;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<Point | null>(null);
  const frozenRef = useRef(false);
  const rafRef = useRef(0);
  const interactiveRef = useRef(interactive);
  const holdRef = useRef(hold);
  const fallbackRef = useRef(fallback);
  const minLeftRef = useRef(minLeft);
  /** 박스 안 내용이 바뀔 때마다 위치를 다시 맞추는 함수 (리스너 1회 등록과 공유) */
  const kickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const target = (): Point | null => {
      const el = boxRef.current;
      if (!el) return null;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const c = cursorRef.current;
      if (!c) {
        const f = fallbackRef.current;
        return { x: Math.max(minLeftRef.current + FOLLOW_EDGE_GAP, f.x - w / 2), y: f.y };
      }
      let left = c.x + FOLLOW_OFFSET;
      let top = c.y + FOLLOW_OFFSET;
      if (left + w > host.clientWidth - FOLLOW_EDGE_GAP) left = c.x - FOLLOW_OFFSET - w;
      if (top + h > host.clientHeight - FOLLOW_EDGE_GAP) top = c.y - FOLLOW_OFFSET - h;
      return {
        x: Math.max(minLeftRef.current + FOLLOW_EDGE_GAP, left),
        y: Math.max(FOLLOW_EDGE_GAP, top),
      };
    };
    const place = (p: Point) => {
      const el = boxRef.current;
      if (el) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    };
    const tick = () => {
      rafRef.current = 0;
      const t = target();
      if (!t) return;
      const cur = posRef.current;
      if (!cur) {
        posRef.current = t;
        place(t);
        return;
      }
      const nx = cur.x + (t.x - cur.x) * FOLLOW_EASE;
      const ny = cur.y + (t.y - cur.y) * FOLLOW_EASE;
      if (Math.abs(t.x - nx) < 0.5 && Math.abs(t.y - ny) < 0.5) {
        posRef.current = t;
        place(t);
        return;
      }
      posRef.current = { x: nx, y: ny };
      place(posRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };
    kickRef.current = kick;
    if (!cursorRef.current) cursorRef.current = pointerRef.current;
    /** 처음엔 애니메이션 없이 바로 제자리. 직전에 떠 있던 위치가 있으면 거기서 이어서 */
    if (posRef.current) {
      place(posRef.current);
      kick();
    } else {
      const first = target();
      if (first) {
        posRef.current = first;
        place(first);
      }
    }

    let last: Point | null = null;
    const onMove = (e: MapBrowserEvent<PointerEvent>) => {
      const x = e.pixel[0];
      const y = e.pixel[1];
      const prev = last;
      last = { x, y };
      if (holdRef.current) return;
      const el = boxRef.current;
      const pos = posRef.current;
      if (el && pos && interactiveRef.current) {
        const l = pos.x;
        const t = pos.y;
        const r = l + el.offsetWidth;
        const b = t + el.offsetHeight;
        const dist = Math.hypot(Math.max(l - x, 0, x - r), Math.max(t - y, 0, y - b));
        if (frozenRef.current) {
          if (dist <= FREEZE_RELEASE_PX) return;
          frozenRef.current = false;
        } else if (prev && dist <= FREEZE_APPROACH_PX) {
          const mx = x - prev.x;
          const my = y - prev.y;
          const tx = (l + r) / 2 - x;
          const ty = (t + b) / 2 - y;
          const mLen = Math.hypot(mx, my);
          const tLen = Math.hypot(tx, ty);
          if (
            mLen >= 2 &&
            mLen <= FREEZE_MAX_STEP_PX &&
            tLen > 0 &&
            (mx * tx + my * ty) / (mLen * tLen) > FREEZE_APPROACH_COS
          ) {
            frozenRef.current = true;
            return;
          }
        }
      } else {
        frozenRef.current = false;
      }
      cursorRef.current = { x, y };
      kick();
    };
    const key = map.on('pointermove', onMove as never);
    return () => {
      unByKey(key);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      kickRef.current = () => undefined;
    };
  }, [map, host, pointerRef, posRef]);

  /** 단계·내용이 바뀌면 크기가 달라질 수 있어 가장자리 뒤집기를 다시 계산 */
  useLayoutEffect(() => {
    interactiveRef.current = interactive;
    holdRef.current = hold;
    fallbackRef.current = fallback;
    minLeftRef.current = minLeft;
    if (!interactive) frozenRef.current = false;
    kickRef.current();
  });

  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute top-0 left-0 z-[15] flex flex-col items-start gap-1.5 will-change-transform"
    >
      {children}
    </div>
  );
}

/** 지류 추가 — 열려 있는 동안 지도에서 지류 끝을 찍는다. 지도를 덜 가리게 한 줄 알약 */
function TributaryPickBar({
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
    <>
      <div
        className={cn(PILL_SHELL, 'pointer-events-none')}
        title="찍은 위치까지 구간이 늘어납니다. 같은 지류를 다시 찍으면 끝 위치가 바뀝니다."
      >
        <GitBranch className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span>지류 끝을 찍으세요</span>
        <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium tabular-nums text-primary">
          {cutCount}곳
        </span>
        {previewing ? <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : null}
        <span className={PILL_DIVIDER} aria-hidden />
        <button
          type="button"
          onClick={onUndo}
          disabled={cutCount === 0}
          className={cn(BTN_MUTED, 'pointer-events-auto')}
          title="마지막으로 찍은 지류 끝 빼기"
        >
          되돌리기
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={cutCount === 0}
          className={cn(BTN_MUTED, 'pointer-events-auto')}
          title="추가한 지류 모두 빼기"
        >
          모두 빼기
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={previewing}
          className={cn(BTN_PRIMARY, 'pointer-events-auto')}
        >
          완료
        </button>
      </div>
      {rangeError ? <div className={ERROR_NOTICE}>{rangeError}</div> : null}
    </>
  );
}

/** 지도 위 단계 안내·구간 툴바 — 모두 하나의 박스로 마우스를 따라다닌다 */
export function PrivateLandAnalysisMapGuide() {
  const {
    phase,
    message,
    changeArea,
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

  const tribCardOpen = toolbarActive && tributaryPicking && phase === 'ranged';
  const showToolbar = toolbarActive && !tribCardOpen;
  const pickHasButton = phase === 'end';
  /** 박스에 누를 버튼이 있을 때만 «다가가면 고정» */
  const interactive = showToolSwitch || pickHasButton || tribCardOpen || (showToolbar && !applying);

  /** 박스가 잠시 사라졌다 다시 떠도(단계 사이) 마지막 마우스·박스 위치에서 이어가도록 보관 */
  const pointerRef = useRef<Point | null>(null);
  const followPosRef = useRef<Point | null>(null);
  useEffect(() => {
    if (!map) return;
    const onMove = (e: MapBrowserEvent<PointerEvent>) => {
      pointerRef.current = { x: e.pixel[0], y: e.pixel[1] };
    };
    const key = map.on('pointermove', onMove as never);
    return () => unByKey(key);
  }, [map]);

  if (!map || !bannerHost || !(pickText || message || toolbarActive)) return null;

  const fallback = centerPixel ? { x: centerPixel.x, y: hintTopPx } : { x: bannerHost.clientWidth / 2, y: hintTopPx };

  const pickIcon =
    phase === 'loadingBase' ? (
      <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
    ) : null;

  return createPortal(
    <FollowBox
      map={map}
      host={bannerHost}
      minLeft={mapPaddingLeft}
      interactive={interactive}
      hold={applying}
      fallback={fallback}
      pointerRef={pointerRef}
      posRef={followPosRef}
    >
      {showToolSwitch ? <ClosedToolSwitch value={closedTool} onChange={setClosedTool} /> : null}

      {pickText ? (
        <div className={cn(PILL_SHELL, 'pointer-events-none', !pickHasButton && 'pr-3')}>
          {pickIcon}
          <span>{pickText}</span>
          {pickHasButton ? (
            <button type="button" onClick={changeArea} className={cn(BTN_MUTED, 'pointer-events-auto')}>
              다시 지정
            </button>
          ) : null}
        </div>
      ) : null}

      {tribCardOpen ? (
        <TributaryPickBar
          cutCount={tribCuts}
          previewing={tribPreviewing}
          rangeError={rangeError}
          onUndo={undoTributaryCut}
          onClear={() => setIncludeTributary(false)}
          onDone={closeTributaryPick}
        />
      ) : null}

      {showToolbar ? (
        <>
          {/* 버튼 줄을 커서에 가장 가깝게(맨 위), 안내는 그 아래 짧게 */}
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
                <span className={PILL_DIVIDER} aria-hidden />
              </>
            ) : null}
            {hasTributary && !rangeInvalid ? (
              <>
                <button
                  type="button"
                  onClick={openTributaryPick}
                  disabled={applying}
                  className={cn(BTN_MUTED, 'inline-flex items-center gap-1', tribCuts > 0 && 'bg-primary/10 font-medium text-primary')}
                >
                  <GitBranch className="size-3 shrink-0" aria-hidden />
                  {tribCuts > 0 ? `지류 ${tribCuts}곳` : '지류 추가'}
                </button>
                <span className={PILL_DIVIDER} aria-hidden />
              </>
            ) : null}
            <button
              type="button"
              onClick={apply}
              disabled={applyDisabled}
              title={rangeInvalid ? '구간을 다시 지정해야 적용할 수 있습니다.' : undefined}
              className={cn(BTN_PRIMARY, 'inline-flex items-center gap-1')}
            >
              {applying || checkBlocking ? <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden /> : null}
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
          </div>
          {rangeInvalid ? <div className={ERROR_NOTICE}>{rangeError}</div> : null}
          {tribPreviewing && !applying ? (
            <div className={cn(NOTICE_SHELL, 'flex items-center gap-1 border-border/80 bg-background/95 text-muted-foreground')}>
              <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
              지류 포함 구간 계산 중 · 바로 적용 가능
            </div>
          ) : null}
          {hasTributary && !rangeInvalid && (openRiver || tribCuts === 0) && !applying ? (
            <div
              className={cn(
                NOTICE_SHELL,
                'border-amber-200/90 bg-amber-50/95 text-amber-900 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200'
              )}
            >
              {openRiver ? '반대쪽 하천은 끝까지 포함 · 막으려면 지류 추가' : '합류 지류 있음 · 포함하려면 지류 추가'}
            </div>
          ) : null}
          {closed && !applying && !rangeInvalid ? (
            <div
              className={cn(
                NOTICE_SHELL,
                closedOpen || rangeChecking
                  ? 'border-amber-200/90 bg-amber-50/95 text-amber-900 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200'
                  : 'border-red-200/90 bg-red-50/95 text-red-800 dark:border-red-800 dark:bg-red-950/80 dark:text-red-200'
              )}
            >
              {shapeTool
                ? rangeChecking
                  ? '범위 확인 중…'
                  : '도형 안 도로가 범위 · 적용을 누르세요'
                : rangeChecking
                  ? `범위 확인 중… · 경계선 ${closedLineCount}개`
                  : closedOpen
                    ? `아직 열려 있음 · 뻗은 도로마다 경계선 · ${closedLineCount}개`
                    : `범위 닫힘 · 적용을 누르세요 · 경계선 ${closedLineCount}개`}
            </div>
          ) : null}
        </>
      ) : null}

      {message ? <div className={ERROR_NOTICE}>{message}</div> : null}
    </FollowBox>,
    bannerHost,
  );
}
