'use client';

import { History, Magnet, PanelRightClose } from 'lucide-react';
import { useShapeEditorContext } from '../ShapeEditorContext';

const PANEL_WIDTH = 208; // w-52

/** 우측 고정 열 — 지도와 나란히 배치 (오버레이 아님) */
export function ShapeEditorRightPanel() {
  const { rightPanelOpen, setRightPanelOpen } = useShapeEditorContext();

  if (!rightPanelOpen) {
    return (
      <div className="flex w-8 shrink-0 flex-col border-l border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setRightPanelOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] text-slate-500 hover:bg-slate-50"
          title="패널 펼치기"
        >
          <PanelRightClose className="h-4 w-4 rotate-180" />
          <span className="[writing-mode:vertical-rl]">펼치기</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      className="flex w-52 shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white"
      style={{ width: PANEL_WIDTH }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-semibold text-slate-700">작업 내역</span>
        </div>
        <button
          type="button"
          onClick={() => setRightPanelOpen(false)}
          className="text-[10px] text-slate-500 hover:text-slate-800"
        >
          접기
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="text-xs text-slate-400">Undo/Redo 연동 후 표시됩니다.</p>
      </div>

      <div className="shrink-0 border-t border-slate-100">
        <div className="flex items-center gap-2 px-3 py-2">
          <Magnet className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-semibold text-slate-700">스냅</span>
        </div>
        <div className="space-y-1 px-3 pb-3">
          {['필지', '상수관로', '하수관로', '도로'].map((label) => (
            <label
              key={label}
              className="flex cursor-not-allowed items-center gap-2 text-xs text-slate-400"
            >
              <input type="checkbox" disabled className="rounded" />
              {label}
            </label>
          ))}
          <p className="pt-1 text-[10px] text-slate-400">WFS 스냅 연동 예정</p>
        </div>
      </div>
    </aside>
  );
}
