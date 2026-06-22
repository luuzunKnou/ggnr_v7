'use client';

import { useState } from 'react';
import {
  Circle,
  Globe,
  Hexagon,
  MousePointer2,
  Pencil,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShapeEditorContext } from '../ShapeEditorContext';
import { clearShapeEditorGeometry } from './ShapeEditorEngine';
import { shpTypeLabel } from '../_lib/geomUtils';
import type { BackgroundMapGroup } from '../../map/_mapComponents/mapControlPanel/backgroundMapSelector';

type ShapeEditorToolSidebarProps = {
  backgroundMapId: string;
  onBackgroundMapChange: (id: string) => void;
  backgroundGroups: BackgroundMapGroup[];
};

/** 좌측 48px 도구 아이콘바 */
export function ShapeEditorToolSidebar({
  backgroundMapId,
  onBackgroundMapChange,
  backgroundGroups,
}: ShapeEditorToolSidebarProps) {
  const { mapInstanceRef, activeEditLayer, editMode, toolMode, setToolMode, draft } =
    useShapeEditorContext();
  const [bgOpen, setBgOpen] = useState(false);

  const disabled = !activeEditLayer;
  const shpLabel = activeEditLayer ? shpTypeLabel(activeEditLayer.shpType) : null;
  const drawDisabled = disabled || editMode === 'edit';

  const zoomBy = (delta: number) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const view = map.getView();
    view.animate({ zoom: (view.getZoom() ?? 0) + delta, duration: 200 });
  };

  return (
    <aside className="flex w-[48px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <SidebarButton
        title="선택·수정"
        active={toolMode === 'select'}
        disabled={disabled}
        onClick={() => setToolMode('select')}
      >
        <MousePointer2 className="h-4 w-4" strokeWidth={1.5} />
      </SidebarButton>
      <SidebarButton
        title={shpLabel ? `${shpLabel} 그리기` : '그리기'}
        active={toolMode === 'draw'}
        disabled={drawDisabled}
        onClick={() => setToolMode('draw')}
      >
        {shpLabel === '점' ? (
          <Circle className="h-4 w-4" strokeWidth={1.5} />
        ) : shpLabel === '선' ? (
          <Pencil className="h-4 w-4" strokeWidth={1.5} />
        ) : (
          <Hexagon className="h-4 w-4" strokeWidth={1.5} />
        )}
      </SidebarButton>
      <SidebarButton
        title="도형 지우기"
        active={false}
        disabled={disabled || !draft.hasGeometry}
        onClick={() => clearShapeEditorGeometry()}
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
      </SidebarButton>

      <div className="mt-auto border-t border-slate-100">
        <SidebarButton title="확대" onClick={() => zoomBy(1)}>
          <ZoomIn className="h-4 w-4" strokeWidth={1.5} />
        </SidebarButton>
        <SidebarButton title="축소" onClick={() => zoomBy(-1)}>
          <ZoomOut className="h-4 w-4" strokeWidth={1.5} />
        </SidebarButton>
        <div className="relative">
          <SidebarButton title="배경지도" active={bgOpen} onClick={() => setBgOpen((v) => !v)}>
            <Globe className="h-4 w-4" strokeWidth={1.5} />
          </SidebarButton>
          {bgOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="닫기"
                onClick={() => setBgOpen(false)}
              />
              <div className="absolute left-full top-0 z-50 ml-1 max-h-72 w-48 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                {backgroundGroups.map((group) => (
                  <div key={group.id} className="px-2 py-1">
                    <div className="text-[10px] font-semibold text-slate-400">{group.title}</div>
                    {group.options.length === 0 ? (
                      <div className="py-1 text-[10px] text-slate-400">항목 없음</div>
                    ) : (
                      group.options.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            onBackgroundMapChange(opt.id);
                            setBgOpen(false);
                          }}
                          className={cn(
                            'block w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-50',
                            backgroundMapId === opt.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function SidebarButton({
  children,
  title,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-[48px] w-[48px] items-center justify-center transition-colors',
        'hover:bg-slate-100 hover:text-blue-600 disabled:opacity-40',
        active && 'bg-slate-100 text-blue-600'
      )}
    >
      {children}
    </button>
  );
}
