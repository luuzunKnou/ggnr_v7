'use client';

import { useShapeEditorContext } from '../ShapeEditorContext';
import { shpTypeLabel } from '../_lib/geomUtils';

const hintClass =
  'pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-lg border border-amber-300/70 bg-amber-100/70 px-3 py-1.5 text-xs font-medium text-amber-900 shadow-lg backdrop-blur-[2px]';

export function ShapeEditorFloatingHint() {
  const { activeEditLayer, editMode, toolMode, draft, dirtySaveItems, canUndo, canRedo } =
    useShapeEditorContext();

  if (!activeEditLayer) {
    return <div className={hintClass}>작업할 레이어를 선택해주세요</div>;
  }

  const layerName = <span className="font-semibold">{activeEditLayer.name}</span>;

  if (editMode === 'edit') {
    return (
      <div className={hintClass}>
        {layerName} 레이어를 편집합니다. · 피처를 클릭하세요 (준비 중)
      </div>
    );
  }

  if (toolMode === 'draw') {
    const label = shpTypeLabel(activeEditLayer.shpType);
    const drawHint =
      label === '점' ? '클릭해 점 추가' : '클릭으로 그리기 · 더블클릭 종료';
    return (
      <div className={hintClass}>
        {layerName} · {drawHint}
      </div>
    );
  }

  if (draft.hasGeometry) {
    const kindLabel = draft.changeKind === 'update' ? '기존 도형 수정' : '신규 도형';
    const undoHint =
      canUndo || canRedo
        ? ` · Undo/Redo ${canUndo ? '↩' : ''}${canRedo ? '↪' : ''}`
        : '';
    return (
      <div className={hintClass}>
        {layerName} · {kindLabel} · 꼭짓점 드래그 시 이력 추가{undoHint}
        {dirtySaveItems.length > 0 ? ` · 저장 대기 ${dirtySaveItems.length}건` : ''}
      </div>
    );
  }

  if (dirtySaveItems.length > 0) {
    return (
      <div className={hintClass}>
        {layerName} · 저장 대기 {dirtySaveItems.length}건 · 「일괄저장」
      </div>
    );
  }

  return <div className={hintClass}>{layerName} 레이어를 편집합니다.</div>;
}
