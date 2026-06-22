'use client';

import { RotateCcw, Redo2, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { useShapeEditorContext } from '../ShapeEditorContext';
import { clearShapeEditorGeometry } from './ShapeEditorEngine';
import type { ShapeEditorLayerGroup, ShapeEditorLayerItem } from '../types';
import { ShapeEditorLayerSelect } from './ShapeEditorLayerSelect';

type ShapeEditorTopBarProps = {
  layerGroups: ShapeEditorLayerGroup[];
  layerLoading: boolean;
  layerError: string | null;
};

export function ShapeEditorTopBar({
  layerGroups,
  layerLoading,
  layerError,
}: ShapeEditorTopBarProps) {
  const {
    activeEditLayer,
    setActiveEditLayer,
    editMode,
    setEditMode,
    draft,
    setDraft,
    refreshWms,
  } = useShapeEditorContext();

  const handleSave = async () => {
    if (!activeEditLayer) {
      window.alert('편집할 레이어를 먼저 선택하세요.');
      return;
    }
    if (editMode === 'edit') {
      window.alert('기존 수정 저장은 준비 중입니다.');
      return;
    }
    if (!draft.wkt5181) {
      window.alert('저장할 도형이 없습니다.');
      return;
    }

    setDraft({ saving: true, saveMessage: null });
    try {
      const res = await call('', 'POST', {
        service: 'layerRowService',
        action: 'insertTableRow',
        params: {
          table: activeEditLayer.tableName,
          schema: activeEditLayer.schema,
          values: {},
          geomWkt5181: draft.wkt5181,
        },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        setDraft({
          saving: false,
          saveMessage: String(data?.error ?? '저장에 실패했습니다.'),
        });
        return;
      }
      clearShapeEditorGeometry();
      refreshWms();
      setDraft({
        saving: false,
        saveMessage: `저장 완료 (키: ${data?.keyValue ?? '-'})`,
        hasGeometry: false,
        wkt5181: null,
      });
    } catch {
      setDraft({ saving: false, saveMessage: '저장 요청에 실패했습니다.' });
    }
  };

  const handleClose = () => {
    if (draft.hasGeometry && !window.confirm('저장하지 않은 도형이 있습니다. 창을 닫을까요?')) {
      return;
    }
    window.close();
  };

  const onSelectLayer = (layer: ShapeEditorLayerItem) => {
    if (draft.hasGeometry && !window.confirm('저장하지 않은 도형이 있습니다. 레이어를 변경할까요?')) {
      return;
    }
    setActiveEditLayer(layer);
  };

  const toolsDisabled = !activeEditLayer;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
      <ShapeEditorLayerSelect
        layerGroups={layerGroups}
        loading={layerLoading}
        error={layerError}
        activeLayer={activeEditLayer}
        onSelectLayer={onSelectLayer}
      />

      <div className="h-6 w-px shrink-0 bg-slate-200" />

      <div className="flex shrink-0 items-center rounded-md border border-slate-200 p-0.5">
        <ModeButton
          active={editMode === 'new'}
          disabled={toolsDisabled}
          onClick={() => setEditMode('new')}
        >
          신규
        </ModeButton>
        <ModeButton
          active={editMode === 'edit'}
          disabled={toolsDisabled}
          onClick={() => setEditMode('edit')}
        >
          기존수정
        </ModeButton>
      </div>

      <div className="h-6 w-px shrink-0 bg-slate-200" />

      <div className="flex shrink-0 items-center gap-1">
        <TextIconButton title="실행 취소 (준비 중)" disabled>
          <RotateCcw className="h-3.5 w-3.5" />
          Undo
        </TextIconButton>
        <TextIconButton title="다시 실행 (준비 중)" disabled>
          <Redo2 className="h-3.5 w-3.5" />
          Redo
        </TextIconButton>
      </div>

      {draft.saveMessage ? (
        <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{draft.saveMessage}</span>
      ) : (
        <div className="flex-1" />
      )}

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={!activeEditLayer || !draft.wkt5181 || draft.saving || editMode === 'edit'}
          onClick={() => void handleSave()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          <Save className="h-4 w-4" />
          {draft.saving ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50"
        >
          <X className="h-4 w-4" />
          닫기
        </button>
      </div>
    </header>
  );
}

function ModeButton({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
        active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
      )}
    >
      {children}
    </button>
  );
}

function TextIconButton({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
