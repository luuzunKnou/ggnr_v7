'use client';

import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 나침반 핀 기준 지름(px).
 * 빨간 높이 = 지름-3, 흰 높이 = 지름 → 합이 버튼(h-8) 안에 들어가게 설정.
 */
const COMPASS_D = 17;
const COMPASS_BASE = 8;
const COMPASS_RED_H = COMPASS_D - 5;
const COMPASS_WHITE_H = COMPASS_D;
const COMPASS_TOTAL_H = COMPASS_RED_H + COMPASS_WHITE_H;

type StreetViewRoadviewControlsProps = {
  panDeg: number;
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

/** 북쪽 빨간·남쪽 흰 삼각형 (아랫변 8px, 빨강 높이 지름-5, 흰색 지름) */
function CompassPin() {
  const cx = COMPASS_BASE / 2;
  const midY = COMPASS_RED_H;

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

/** 로드뷰 하단 중앙 — 축소 / 정북 / 확대 */
export function StreetViewRoadviewControls({
  panDeg,
  disabled = false,
  onZoomOut,
  onZoomIn,
  onResetNorth,
}: StreetViewRoadviewControlsProps) {
  return (
    <div
      className={cn(
        'absolute bottom-3 left-1/2 z-[3] flex -translate-x-1/2 flex-row items-center gap-1.5 rounded-full bg-slate-800 p-1.5 shadow-md',
        'opacity-95 transition-opacity hover:opacity-100',
        'dark:bg-slate-900 dark:shadow-black/40'
      )}
    >
      <ControlButton title="축소" disabled={disabled} onClick={onZoomOut}>
        <Minus className="h-4 w-4" strokeWidth={2} aria-hidden />
      </ControlButton>
      <ControlButton
        title="정북"
        disabled={disabled}
        onClick={onResetNorth}
        className="bg-slate-700 hover:bg-slate-700 disabled:hover:bg-slate-700"
      >
        <span
          className="flex items-center justify-center"
          style={{ transform: `rotate(${panDeg}deg)` }}
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
