'use client';

import { Minus, Plus } from 'lucide-react';
import {
  forwardRef,
  memo,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/** 나침반 핀 — 북·남 동일 높이로 중심 = 버튼 중심 */
const COMPASS_BASE = 8;
const COMPASS_HALF_H = 10;
const COMPASS_TOTAL_H = COMPASS_HALF_H * 2;

export type StreetViewCompassHandle = {
  setPan: (panDeg: number) => void;
};

type StreetViewRoadviewControlsProps = {
  disabled?: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetNorth: () => void;
};

function ControlButton({
  title,
  disabled,
  onClick,
  className,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
        'bg-slate-800/90 text-slate-200 hover:bg-slate-700',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-800/90',
        className
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 북쪽 빨간·남쪽 흰 삼각형 (대칭 다이아몬드) */
function CompassPin() {
  const cx = COMPASS_BASE / 2;
  const midY = COMPASS_HALF_H;

  return (
    <svg
      width={COMPASS_BASE}
      height={COMPASS_TOTAL_H}
      viewBox={`0 0 ${COMPASS_BASE} ${COMPASS_TOTAL_H}`}
      aria-hidden
    >
      <polygon points={`${cx},0 0,${midY} ${COMPASS_BASE},${midY}`} fill="#ef4444" />
      <polygon
        points={`0,${midY} ${COMPASS_BASE},${midY} ${cx},${COMPASS_TOTAL_H}`}
        fill="#ffffff"
      />
    </svg>
  );
}

/** 로드뷰 하단 — 축소 / 정북 / 확대. pan은 imperative handle로만 반영 */
export const StreetViewRoadviewControls = memo(
  forwardRef<StreetViewCompassHandle, StreetViewRoadviewControlsProps>(
    function StreetViewRoadviewControls(
      { disabled = false, onZoomOut, onZoomIn, onResetNorth },
      ref
    ) {
      const rotateRef = useRef<HTMLSpanElement>(null);

      useImperativeHandle(
        ref,
        () => ({
          setPan(panDeg: number) {
            const el = rotateRef.current;
            if (!el) return;
            el.style.transform = `rotate(${panDeg}deg)`;
          },
        }),
        []
      );

      return (
        <div
          className={cn(
            'pointer-events-auto flex flex-row items-center gap-1.5 rounded-full bg-slate-800 p-1.5 shadow-md',
            'opacity-90 transition-opacity hover:opacity-100',
            'dark:bg-slate-900 dark:shadow-black/40'
          )}
        >
          <ControlButton title="축소" disabled={disabled} onClick={onZoomOut}>
            <Minus className="h-4 w-4" strokeWidth={2} aria-hidden />
          </ControlButton>
          <ControlButton
            title="북쪽 보기"
            disabled={disabled}
            onClick={onResetNorth}
            className="bg-slate-700 hover:bg-slate-700 disabled:hover:bg-slate-700"
          >
            <span
              ref={rotateRef}
              className="flex items-center justify-center origin-center"
              style={{ transform: 'rotate(0deg)', transformOrigin: 'center center' }}
            >
              <CompassPin />
            </span>
          </ControlButton>
          <ControlButton title="확대" disabled={disabled} onClick={onZoomIn}>
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          </ControlButton>
        </div>
      );
    }
  )
);
