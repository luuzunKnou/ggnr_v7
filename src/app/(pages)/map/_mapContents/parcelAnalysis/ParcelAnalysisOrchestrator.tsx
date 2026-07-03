'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useParcelAnalysis } from './parcelAnalysisContext';
import { useParcelAnalysisResultSections } from './useParcelAnalysisResultSections';
import { useParcelAnalysisSigunguBoundary } from './useParcelAnalysisSigunguBoundary';
import { useParcelAnalysisAreaLayer } from './useParcelAnalysisAreaLayer';
import { useParcelAnalysisDraw } from './useParcelAnalysisDraw';
import { ParcelAnalysisMethodModal } from './ParcelAnalysisMethodModal';
import {
  ParcelAnalysisAnalyzingModal,
  ParcelAnalysisResultModal,
} from './ParcelAnalysisResultModal';

export function ParcelAnalysisOrchestrator() {
  const {
    isOpen,
    area,
    panelEngaged,
    modalOpen,
    modalStep,
    boundarySessionDraft,
    setBoundarySessionDraft,
    selectedIds,
    analyzing,
    drawerOpen,
    setDrawerOpen,
    setModalStep,
    exitParcelAnalysis,
    closeAreaModal,
    startDraw,
    cancelDraw,
    redrawShape,
    confirmDraw,
    drawTool,
    drawPhase,
    handleApplyBoundary,
    applyingArea,
  } = useParcelAnalysis();

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);
  const { sections, mockResult } = useParcelAnalysisResultSections(selectedIdList);

  useParcelAnalysisSigunguBoundary(isOpen);
  // 새 도형을 다 그리기 전(그리기 단계)까지는 기존 확정 영역을 유지(참고용).
  // 다 그려 편집 단계로 넘어가면 기존 영역을 숨겨 새 도형만 남긴다.
  const hideConfirmedArea = drawTool != null && drawPhase === 'editing';
  useParcelAnalysisAreaLayer(isOpen && !hideConfirmedArea, area?.wkt ?? null);
  useParcelAnalysisDraw();

  if (!isOpen) return null;

  return (
    <>
      <ParcelAnalysisMethodModal
        open={modalOpen}
        step={modalStep}
        hasConfirmedArea={area != null || panelEngaged}
        boundarySessionDraft={boundarySessionDraft}
        onBoundarySessionDraftChange={setBoundarySessionDraft}
        onStepChange={setModalStep}
        onClose={exitParcelAnalysis}
        onDismiss={closeAreaModal}
        onStartDraw={startDraw}
        onApplyBoundary={handleApplyBoundary}
        applyingArea={applyingArea}
      />

      {drawTool && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[1200] flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 py-2 pr-2 pl-4 text-sm text-slate-700 shadow-lg backdrop-blur">
            <span>
              {drawPhase === 'drawing'
                ? '지도에 도형을 그리세요.'
                : '꼭짓점을 드래그해 모양을 수정하세요.'}
            </span>
            {drawPhase === 'editing' && (
              <>
                <button
                  type="button"
                  onClick={confirmDraw}
                  className="cursor-pointer rounded-full bg-blue-600 px-3 py-1 font-medium text-white transition-colors hover:bg-blue-700"
                >
                  적용
                </button>
                <button
                  type="button"
                  onClick={redrawShape}
                  className="cursor-pointer rounded-full bg-slate-100 px-3 py-1 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800"
                >
                  다시 그리기
                </button>
              </>
            )}
            <button
              type="button"
              onClick={cancelDraw}
              className="flex cursor-pointer items-center gap-1 rounded-full bg-slate-100 py-1 pr-2.5 pl-2 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800"
            >
              <X className="size-3.5" />
              취소
            </button>
          </div>
        </div>
      )}

      <ParcelAnalysisAnalyzingModal open={analyzing} />

      <ParcelAnalysisResultModal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sections={sections}
        mockResult={mockResult}
        areaSummary={area?.summaryLabel}
      />
    </>
  );
}
