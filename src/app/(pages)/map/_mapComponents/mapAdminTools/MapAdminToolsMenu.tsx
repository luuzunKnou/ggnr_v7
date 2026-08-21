'use client';

import { ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';

const iconShell = cn(
  'shrink-0 opacity-90 rounded-[5px] backdrop-blur-sm shadow-lg border overflow-hidden',
  'bg-white/95 border-slate-200',
  'dark:bg-black/55 dark:border-white/10'
);

const iconBtnInner = cn(
  'box-border flex items-center justify-center w-[30px] h-[30px] p-0 cursor-pointer transition-colors',
  'text-slate-600 dark:text-white/90',
  'hover:bg-slate-100 hover:text-blue-600',
  'dark:hover:bg-white/10 dark:hover:text-white'
);

const iconBtnActive = cn(
  'bg-slate-100 text-blue-600',
  'dark:bg-white/20 dark:text-white'
);

export function MapAdminToolsMenu({
  logOn,
  onToggleLog,
}: {
  logOn: boolean;
  onToggleLog: () => void;
}) {
  return (
    <div className={iconShell}>
      <button
        type="button"
        title="로그 보기"
        aria-label="로그 보기"
        aria-pressed={logOn}
        onClick={onToggleLog}
        className={cn(iconBtnInner, logOn && iconBtnActive)}
      >
        <span className="flex shrink-0 items-center justify-center leading-none">
          <ScrollText className="w-5 h-5" strokeWidth={2} />
        </span>
      </button>
    </div>
  );
}
