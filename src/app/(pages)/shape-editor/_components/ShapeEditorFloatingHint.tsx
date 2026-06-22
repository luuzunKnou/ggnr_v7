'use client';

import { useShapeEditorContext } from '../ShapeEditorContext';
import { shpTypeLabel } from '../_lib/geomUtils';

export function ShapeEditorFloatingHint() {
  const { activeEditLayer, editMode, toolMode, draft } = useShapeEditorContext();

  if (!activeEditLayer) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-md ring-1 ring-amber-200">
        상단에서 편집 레이어를 선택하세요
      </div>
    );
  }

  if (editMode === 'edit') {
    return (
      <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-md bg-slate-800/90 px-4 py-2 text-sm text-white shadow-md">
        기존 수정: 지도에서 피처를 클릭하세요 (준비 중)
      </div>
    );
  }

  if (toolMode === 'draw') {
    const label = shpTypeLabel(activeEditLayer.shpType);
    return (
      <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-md bg-slate-800/90 px-4 py-2 text-sm text-white shadow-md">
        {label === '점' && '지도를 클릭해 점을 추가하세요'}
        {label === '선' && '클릭으로 선을 그리고 더블클릭으로 종료하세요'}
        {label === '면' && '클릭으로 면을 그리고 더블클릭으로 종료하세요'}
      </div>
    );
  }

  if (draft.hasGeometry) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-md bg-slate-800/90 px-4 py-2 text-sm text-white shadow-md">
        꼭짓점을 드래그해 수정한 뒤 저장하세요
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-md bg-slate-800/90 px-4 py-2 text-sm text-white shadow-md">
      좌측에서 그리기 도구를 선택하세요
    </div>
  );
}
