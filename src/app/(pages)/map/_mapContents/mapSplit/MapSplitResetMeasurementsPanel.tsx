'use client';

import { cn } from '@/lib/utils';
import {
  dispatchMapMeasurementsReset,
  type MapMeasurementsResetTarget,
} from './mapMeasurementsReset';

type Option = {
  target: MapMeasurementsResetTarget;
  label: string;
  iconSrc: string;
};

const OPTIONS: Option[] = [
  { target: 'both', label: '좌우 전부 지우기', iconSrc: '/image/mapSplit/reset-both.svg' },
  { target: 'primary', label: '좌측 지우기', iconSrc: '/image/mapSplit/reset-left.svg' },
  { target: 'secondary', label: '우측 지우기', iconSrc: '/image/mapSplit/reset-right.svg' },
];

type Props = {
  onClose: () => void;
  className?: string;
};

/** 지도분할 시 «초기화» — 배경지도 패널과 동일한 우측 확장 형태 */
export function MapSplitResetMeasurementsPanel({ onClose, className }: Props) {
  const onPick = (target: MapMeasurementsResetTarget) => {
    dispatchMapMeasurementsReset(target);
    onClose();
  };

  return (
    <div
      className={cn(
        'flex w-56 flex-col overflow-hidden rounded-[5px] bg-white opacity-90 shadow-xl',
        'dark:border dark:border-white/10 dark:bg-black/40 dark:text-white/90 dark:opacity-100 dark:backdrop-blur-sm',
        className
      )}
    >
      <div
        className={cn(
          'border-b border-slate-100 px-3 py-2 text-[13px] font-medium',
          'bg-slate-100 text-foreground dark:border-white/10 dark:bg-white/10 dark:text-white/90'
        )}
      >
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full bg-blue-500 dark:bg-blue-400" />
          <span>측정 초기화</span>
        </div>
      </div>
      <ul className="py-1" role="list">
        {OPTIONS.map((opt) => (
          <li key={opt.target}>
            <button
              type="button"
              title={opt.label}
              onClick={() => onPick(opt.target)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors',
                'hover:bg-slate-50 dark:hover:bg-white/10'
              )}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 dark:bg-white/10"
                aria-hidden
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={opt.iconSrc} alt="" width={24} height={24} className="h-6 w-6" />
              </span>
              <span className="truncate text-xs text-slate-700 dark:text-white/90">{opt.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
