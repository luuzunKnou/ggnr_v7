'use client';

import {
  Circle,
  Hexagon,
  MousePointer2,
  Pencil,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShapeEditorContext } from '../ShapeEditorContext';
import { shpTypeLabel } from '../_lib/geomUtils';
import {
  SHAPE_EDITOR_OVERLAY_CONTROLS,
  type ShapeEditorOverlayControls,
} from '../_hooks/useShapeEditorOverlayControls';

type ShapeEditorTopBarProps = {
  overlayControls: ShapeEditorOverlayControls;
};

export function ShapeEditorTopBar({ overlayControls }: ShapeEditorTopBarProps) {
  const {
    activeEditLayer,
    editMode,
    toolMode,
    setToolMode,
    draft,
    dirtySaveItems,
    bulkSavePending,
    bulkSaving,
    bulkSaveMessage,
    hasUnsavedWork,
    undo,
    redo,
    canUndo,
    canRedo,
    deleteCurrentGeometry,
  } = useShapeEditorContext();

  const toolsDisabled = !activeEditLayer;
  const drawDisabled = toolsDisabled || editMode === 'edit';
  const shpLabel = activeEditLayer ? shpTypeLabel(activeEditLayer.shpType) : '면';

  const handleClose = () => {
    if (hasUnsavedWork && !window.confirm('저장하지 않은 작업이 있습니다. 창을 닫을까요?')) {
      return;
    }
    window.close();
  };

  const DrawIcon =
    shpLabel === '점' ? Circle : shpLabel === '선' ? Pencil : Hexagon;

  const { toggleControl, isActive } = overlayControls;

  const statusMessage = bulkSaveMessage ?? draft.saveMessage;

  return (
    <header className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-2">
      <ToolbarButton
        title="선택·수정"
        active={toolMode === 'select'}
        disabled={toolsDisabled}
        onClick={() => setToolMode('select')}
      >
        <MousePointer2 className="h-3.5 w-3.5" />
        선택
      </ToolbarButton>
      <ToolbarButton
        title={`${shpLabel} 그리기`}
        active={toolMode === 'draw'}
        disabled={drawDisabled}
        onClick={() => setToolMode('draw')}
      >
        <DrawIcon className="h-3.5 w-3.5" />
        그리기
      </ToolbarButton>
      <ToolbarButton
        title="도형 지우기"
        disabled={toolsDisabled || !draft.hasGeometry}
        onClick={() => deleteCurrentGeometry()}
      >
        <Trash2 className="h-3.5 w-3.5" />
        삭제
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-slate-200" />

      <ToolbarButton title="실행 취소" disabled={!canUndo || bulkSaving} onClick={() => undo()}>
        <RotateCcw className="h-3.5 w-3.5" />
        Undo
      </ToolbarButton>
      <ToolbarButton title="다시 실행" disabled={!canRedo || bulkSaving} onClick={() => redo()}>
        <Redo2 className="h-3.5 w-3.5" />
        Redo
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-slate-200" />

      <ToolbarButton
        title="변경된 도형 일괄 저장"
        disabled={dirtySaveItems.length === 0 || bulkSaving}
        onClick={() => void bulkSavePending()}
      >
        <Save className="h-3.5 w-3.5" />
        {bulkSaving
          ? '저장 중…'
          : `일괄저장${dirtySaveItems.length > 0 ? ` (${dirtySaveItems.length})` : ''}`}
      </ToolbarButton>
      <ToolbarButton title="닫기" onClick={handleClose}>
        <X className="h-3.5 w-3.5" />
        닫기
      </ToolbarButton>

      <div className="mx-1 h-5 w-px shrink-0 bg-slate-200" />

      {SHAPE_EDITOR_OVERLAY_CONTROLS.map(({ id, label }) => (
        <ToolbarButton
          key={id}
          title={label}
          active={isActive(id)}
          onClick={() => toggleControl(id)}
        >
          {label}
        </ToolbarButton>
      ))}

      {statusMessage ? (
        <span className="ml-2 min-w-0 flex-1 truncate text-xs text-slate-500">{statusMessage}</span>
      ) : null}
    </header>
  );
}

function ToolbarButton({
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
        'inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-slate-700 transition-colors',
        'hover:bg-slate-100 disabled:opacity-40',
        active && 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
      )}
    >
      {children}
    </button>
  );
}
