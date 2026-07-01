'use client';

import { cn } from '@/lib/utils';
import { isHistoryEntryVisibleInLog } from '../_lib/editHistory';
import { useShapeEditorContext } from '../ShapeEditorContext';

export function ShapeEditorWorkHistory() {
  const { editHistory, historyIndex } = useShapeEditorContext();

  const visibleEntries = editHistory
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isHistoryEntryVisibleInLog(item));

  if (visibleEntries.length === 0) {
    return (
      <p className="text-[10px] text-slate-400">
        도형을 그리거나 꼭짓점을 이동하면 편집 이력이 자동으로 쌓입니다.
      </p>
    );
  }

  const currentVisiblePos = visibleEntries.findIndex((v) => v.index === historyIndex);

  return (
    <div className="space-y-2">
      <span className="text-[10px] text-slate-500">
        {visibleEntries.length}건
        {currentVisiblePos >= 0
          ? ` · 현재 ${currentVisiblePos + 1}번째`
          : historyIndex >= 0
            ? ' · 선택됨'
            : ''}
      </span>
      <ul className="space-y-1.5">
        {visibleEntries.map(({ item, index }, visibleIdx) => {
          const isCurrent = index === historyIndex;
          const isFuture = index > historyIndex;
          return (
            <li
              key={item.id}
              className={cn(
                'rounded border px-2 py-1.5 transition-colors',
                isCurrent
                  ? 'border-blue-300 bg-blue-50/80 ring-1 ring-blue-200'
                  : isFuture
                    ? 'border-slate-100 bg-slate-50/80 opacity-50'
                    : 'border-slate-200 bg-white'
              )}
            >
              <div className="flex items-center gap-1.5">
                <ActionBadge action={item.action} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[11px]',
                    isCurrent ? 'font-semibold text-blue-900' : 'font-medium text-slate-700'
                  )}
                  title={item.label}
                >
                  {item.label}
                </span>
                <span className="shrink-0 text-[9px] tabular-nums text-slate-400">
                  {visibleIdx + 1}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActionBadge({ action }: { action: 'select' | 'create' | 'move' | 'delete' }) {
  if (action === 'move') {
    return (
      <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-700">
        이동
      </span>
    );
  }
  if (action === 'create') {
    return (
      <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">
        신규
      </span>
    );
  }
  if (action === 'delete') {
    return (
      <span className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[9px] font-semibold text-red-700">
        삭제
      </span>
    );
  }
  return null;
}
