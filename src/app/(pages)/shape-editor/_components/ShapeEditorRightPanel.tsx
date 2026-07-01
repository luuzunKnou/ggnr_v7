'use client';

import { List } from 'lucide-react';
import { ShapeEditorFeatureAttributes } from './ShapeEditorFeatureAttributes';
import { ShapeEditorWorkHistory } from './ShapeEditorWorkHistory';

/** 우측 패널 — 상단 속성 / 하단 작업 내역 */
export function ShapeEditorRightPanel() {
  return (
    <aside className="flex w-[306px] shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-slate-200">
        <ShapeEditorFeatureAttributes />
      </div>

      <div className="flex h-[40%] min-h-[120px] shrink-0 flex-col overflow-hidden bg-slate-50/50">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-1.5">
          <List className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-[11px] font-semibold text-slate-600">작업 내역</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ShapeEditorWorkHistory />
        </div>
      </div>
    </aside>
  );
}
