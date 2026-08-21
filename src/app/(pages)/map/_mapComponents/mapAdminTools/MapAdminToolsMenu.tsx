'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, ScrollText } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MAP_ADMIN_TOOL_ITEMS, type MapAdminToolId } from './mapAdminToolsItems';

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
  const [open, setOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const runUseFeeSync = useCallback(async () => {
    if (syncBusy) return;
    const ok = window.confirm(
      '점사용료 연계를 지금 실행할까요?\n완료까지 시간이 걸릴 수 있습니다.'
    );
    if (!ok) return;
    setSyncBusy(true);
    try {
      const res = await call('', 'POST', {
        service: 'useFeeService',
        action: 'runNextGenSync',
        params: {},
      });
      const data = (res?.data ?? res) as { message?: string } | undefined;
      window.alert(String(data?.message ?? '연계를 시작했습니다.'));
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'error' in e
            ? String((e as { error?: unknown }).error ?? '실행에 실패했습니다.')
            : '실행에 실패했습니다.';
      window.alert(msg);
    } finally {
      setSyncBusy(false);
    }
  }, [syncBusy]);

  const onPick = useCallback(
    (id: MapAdminToolId) => {
      if (id === 'geoserverLog') {
        onToggleLog();
        return;
      }
      if (id === 'useFeeSync') {
        void runUseFeeSync();
      }
    },
    [onToggleLog, runUseFeeSync]
  );

  return (
    <div ref={wrapRef} className="relative">
      <div className={iconShell}>
        <button
          type="button"
          title="점검 도구"
          aria-label="점검 도구"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(iconBtnInner, (open || logOn) && iconBtnActive)}
        >
          <span className="flex shrink-0 items-center justify-center leading-none">
            <ScrollText className="w-5 h-5" strokeWidth={2} />
          </span>
        </button>
      </div>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-full right-0 mt-1 min-w-[200px] rounded-[5px] opacity-90 shadow-lg overflow-hidden z-50 border',
            'bg-white border-slate-200',
            'dark:bg-black/80 dark:border-white/10 dark:backdrop-blur-sm'
          )}
        >
          <ul className="py-0.5">
            {MAP_ADMIN_TOOL_ITEMS.map((item) => {
              const logItem = item.id === 'geoserverLog';
              const syncItem = item.id === 'useFeeSync';
              const busy = syncItem && syncBusy;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => onPick(item.id)}
                    className={cn(
                      'w-full cursor-pointer text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2',
                      'border-b border-slate-100 last:border-b-0',
                      'text-slate-700 hover:bg-slate-50',
                      'dark:border-white/10 dark:text-white/90 dark:hover:bg-white/10',
                      busy && 'opacity-70 cursor-wait'
                    )}
                  >
                    <span className="flex-1 min-w-0 truncate">{item.label}</span>
                    {logItem && logOn ? (
                      <Check className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-300" />
                    ) : null}
                    {busy ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
