'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Circle, MapPin, Pentagon, Pencil, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { useMapContext } from '../../_mapComponents/MapContext';
import {
  DrawToolbarActions,
  ParcelAnalysisAreaSummary,
  useParcelAnalysisAreaLayer,
  useParcelAnalysisDraw,
  useParcelAnalysisDrawToolbarPosition,
} from './ParcelAnalysis.area';
import {
  getBoundarySelectionCount,
  ParcelAnalysisBoundaryPicker,
  useParcelAnalysisSigunguBoundary,
} from './ParcelAnalysis.boundary';
import {
  ParcelAnalysisItemSelector,
  STATIC_PARCEL_ANALYSIS_GROUPS,
  STATIC_PARCEL_ITEM_IDS,
  type ParcelAnalysisGroupDef,
} from './ParcelAnalysis.items';
import {
  ParcelAnalysisAnalyzingModal,
  ParcelAnalysisResultModal,
} from './ParcelAnalysis.resultModal';
import {
  EMPTY_PARCEL_ANALYSIS_RESULT,
  useParcelAnalysisResultSections,
} from './parcelAnalysis.result';
import { useParcelAnalysis } from './parcelAnalysisContext';
import {
  isLargeParcelAnalysisArea,
  type BoundaryEmdSelection,
  type DrawProjectScope,
  type DrawTool,
  type EmdRiOption,
  type ParcelAnalysisArea,
  type ParcelModalStep,
} from './parcelAnalysis.types';

export const PARCEL_ANALYSIS_PANEL_DEFAULT_WIDTH = 280;
export const PARCEL_ANALYSIS_PANEL_MIN_WIDTH = 260;
export const PARCEL_ANALYSIS_PANEL_MAX_WIDTH = 400;

type PanelProps = {
  area: ParcelAnalysisArea | null;
  areaCleared?: boolean;
  groups: ParcelAnalysisGroupDef[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  /** 시설 카탈로그·클라이언트 마운트 완료 후 true — 수화 불일치 방지 */
  itemsReady?: boolean;
  onChangeArea: () => void;
  onClearArea: () => void;
  onSpecifyArea: () => void;
  onAnalyze: () => void;
  analyzing?: boolean;
  /** 도형 그리기·편집 중(적용 전) 등 — 분석 항목·분석 버튼 비활성 */
  analyzeBlocked?: boolean;
  onClose: () => void;
};

export function ParcelAnalysisPanel({
  area,
  areaCleared,
  groups,
  selectedIds,
  onSelectedIdsChange,
  itemsReady = true,
  onChangeArea,
  onClearArea,
  onSpecifyArea,
  onAnalyze,
  analyzing,
  analyzeBlocked = false,
  onClose,
}: PanelProps) {
  const hasArea = area != null;
  const hasItems = selectedIds.size > 0;
  const canAnalyze = hasArea && hasItems && !analyzing && !analyzeBlocked;
  const largeAreaWarning = area != null && isLargeParcelAnalysisArea(area);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-background px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">필지분석</h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground">분석 영역·항목 선택</span>
      </header>

      <ParcelAnalysisAreaSummary
        area={area}
        areaCleared={areaCleared}
        onChangeClick={onChangeArea}
        onClearClick={onClearArea}
        onSpecifyClick={onSpecifyArea}
      />

      {!hasArea && !areaCleared && (
        <div className="mx-3 mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          분석 영역을 지정해야 분석 항목을 선택할 수 있습니다.
        </div>
      )}

      {largeAreaWarning ? (
        <div className="mx-3 mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-2 text-[11px] leading-snug text-orange-900 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200">
          분석 영역이 넓습니다. 필지가 많으면 수 분 이상 걸리거나 조회가 중단될 수 있으니, 가능하면
          영역을 나누어 분석하세요.
        </div>
      ) : null}

      <ParcelAnalysisItemSelector
        groups={groups}
        selectedIds={selectedIds}
        onSelectedIdsChange={onSelectedIdsChange}
        disabled={!hasArea || analyzeBlocked}
        itemsReady={itemsReady}
      />

      <div className="shrink-0 border-t border-border bg-muted/80 px-3 py-2">
        <Button
          type="button"
          className="w-full"
          size="sm"
          disabled={!canAnalyze}
          title={analyzeBlocked ? '도형을 적용한 뒤 분석할 수 있습니다.' : undefined}
          onClick={onAnalyze}
        >
          {analyzing ? '분석 중…' : '분석'}
        </Button>
      </div>
    </aside>
  );
}


type MethodModalProps = {
  open: boolean;
  step: ParcelModalStep;
  boundarySessionDraft: BoundaryEmdSelection[];
  onBoundarySessionDraftChange: (selection: BoundaryEmdSelection[]) => void;
  onStepChange: (step: ParcelModalStep) => void;
  /** 모달만 닫고 패널 «영역 지정» 유지 */
  onDismiss: () => void;
  onStartDraw: (tool: DrawTool) => void;
  onApplyBoundary: (selection: BoundaryEmdSelection[]) => void;
  applyingArea: boolean;
  boundaryEmdOptions: EmdRiOption[];
  boundaryEmdLoading: boolean;
  boundaryEmdError: string | null;
  onReloadBoundaryEmd: () => void;
};

const DRAW_TOOLS: { id: DrawTool; icon: typeof Square; label: string }[] = [
  { id: 'rectangle', icon: Square, label: '사각형' },
  { id: 'polygon', icon: Pentagon, label: '다각형' },
  { id: 'circle', icon: Circle, label: '원' },
];

const STEP_MAX_WIDTH: Record<ParcelModalStep, string> = {
  choose: 'sm:max-w-[480px]',
  draw: 'sm:max-w-[440px]',
  boundary: 'sm:max-w-[520px]',
};

const STEP_SUBTITLE: Record<Exclude<ParcelModalStep, 'choose'>, string> = {
  draw: '도형 그리기',
  boundary: '행정경계 선택',
};

export function ParcelAnalysisMethodModal({
  open,
  step,
  boundarySessionDraft,
  onBoundarySessionDraftChange,
  onStepChange,
  onDismiss,
  onStartDraw,
  onApplyBoundary,
  applyingArea,
  boundaryEmdOptions,
  boundaryEmdLoading,
  boundaryEmdError,
  onReloadBoundaryEmd,
}: MethodModalProps) {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) return;
      if (step === 'choose') onDismiss();
      else onStepChange('choose');
    },
    [step, onDismiss, onStepChange]
  );

  const handleSecondaryAction = useCallback(() => {
    if (step === 'choose') onDismiss();
    else onStepChange('choose');
  }, [step, onDismiss, onStepChange]);

  const boundaryCount = getBoundarySelectionCount(boundarySessionDraft);
  const canApplyBoundary = boundaryCount > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal={step !== 'draw'}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'z-[60] gap-0 overflow-hidden rounded-[5px] border-border p-0 shadow-xl',
          'flex max-h-[min(560px,88vh)] flex-col',
          STEP_MAX_WIDTH[step]
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 pt-3 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {step !== 'choose' && (
              <button
                type="button"
                onClick={() => onStepChange('choose')}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="뒤로"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <DialogTitle className="flex min-w-0 items-baseline gap-2 text-lg font-medium leading-tight text-foreground">
              <span className="truncate">분석 영역 지정</span>
              {step !== 'choose' && (
                <span className="truncate text-sm font-normal text-muted-foreground">
                  · {STEP_SUBTITLE[step]}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              도형 그리기 또는 행정경계 선택으로 분석 영역을 지정합니다.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {step === 'choose' && (
            <>
              <p className="mb-3 text-sm text-muted-foreground">분석할 영역을 지정하는 방식을 선택하세요.</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onStepChange('draw')}
                  className="group flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-border bg-background p-5 text-center shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-md"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
                    <Pencil className="size-6" />
                  </span>
                  <span className="text-[15px] font-medium text-foreground">도형 그리기</span>
                  <span className="text-sm leading-snug text-muted-foreground">사각형 · 다각형 · 원</span>
                </button>
                <button
                  type="button"
                  onClick={() => onStepChange('boundary')}
                  className="group flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-border bg-background p-5 text-center shadow-sm transition-all hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:shadow-md"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 transition-colors group-hover:bg-emerald-500/25">
                    <MapPin className="size-6" />
                  </span>
                  <span className="text-[15px] font-medium text-foreground">행정경계 선택</span>
                  <span className="text-sm leading-snug text-muted-foreground">읍 · 면 · 동 · 리</span>
                </button>
              </div>
            </>
          )}

          {step === 'draw' && (
            <div className="space-y-4">
              <p className="rounded-lg border border-border bg-muted/80 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                도구를 선택하면 이 창이 닫히고 지도에 그릴 수 있어요. 다 그린 뒤 꼭짓점을 드래그해 수정하고 «적용»하세요.
              </p>
              <div className="flex flex-wrap gap-2">
                {DRAW_TOOLS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onStartDraw(t.id)}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-normal text-foreground transition-colors hover:border-border hover:bg-muted/60"
                    >
                      <Icon className="size-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'boundary' && (
            <ParcelAnalysisBoundaryPicker
              initialSelection={boundarySessionDraft}
              onSelectionChange={onBoundarySessionDraftChange}
              emdOptions={boundaryEmdOptions}
              emdLoading={boundaryEmdLoading}
              emdError={boundaryEmdError}
              onReloadEmd={onReloadBoundaryEmd}
            />
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border bg-muted/50 px-4 py-3 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={handleSecondaryAction}>
            {step === 'choose' ? '취소' : '뒤로'}
          </Button>
          {step === 'boundary' && (
            <Button
              type="button"
              size="sm"
              disabled={!canApplyBoundary || applyingArea}
              onClick={() => onApplyBoundary(boundarySessionDraft)}
            >
              {applyingArea ? '적용 중…' : '적용'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function filterStaticSelectedIds(ids: Set<string>): Set<string> {
  const staticSet = new Set(STATIC_PARCEL_ITEM_IDS);
  const next = new Set<string>();
  for (const id of ids) {
    if (staticSet.has(id)) next.add(id);
  }
  return next;
}

export function ParcelAnalysisMapSidePanel() {
  const {
    area,
    panelEngaged,
    analysisGroups,
    facilityCatalogLoaded,
    selectedIds,
    setSelectedIds,
    openChangeAreaModal,
    resetArea,
    handleAnalyze,
    analyzing,
    drawTool,
    applyingArea,
    exitParcelAnalysis,
  } = useParcelAnalysis();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const areaCleared = panelEngaged && area == null;
  const itemsReady = mounted && facilityCatalogLoaded;

  const displayGroups = itemsReady ? analysisGroups : STATIC_PARCEL_ANALYSIS_GROUPS;
  const displaySelectedIds = useMemo(
    () => (itemsReady ? selectedIds : filterStaticSelectedIds(selectedIds)),
    [itemsReady, selectedIds]
  );

  return (
    <ParcelAnalysisPanel
      area={area}
      areaCleared={areaCleared}
      groups={displayGroups}
      selectedIds={displaySelectedIds}
      itemsReady={itemsReady}
      onSelectedIdsChange={setSelectedIds}
      onChangeArea={openChangeAreaModal}
      onClearArea={resetArea}
      onSpecifyArea={openChangeAreaModal}
      onAnalyze={handleAnalyze}
      analyzing={analyzing}
      analyzeBlocked={drawTool != null || applyingArea}
      onClose={exitParcelAnalysis}
    />
  );
}


/** 편집 단계(적용 전) 도형의 사업 구역 이탈 안내 — 구역 밖일 때만 */
function DrawScopeBanner({
  preview,
}: {
  preview: { projectScope: DrawProjectScope; label: string } | null;
}) {
  if (!preview) return null;

  if (preview.projectScope === 'fully_outside') {
    return (
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-[11px] font-medium leading-snug text-amber-900 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200 shadow-[0_6px_20px_rgba(245,158,11,0.15)] backdrop-blur-md">
        <AlertTriangle className="size-3.5 shrink-0" />
        사업 구역을 벗어났습니다. 구역 안에서 다시 그려 주세요.
      </div>
    );
  }

  if (preview.projectScope === 'partially_outside') {
    return (
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-amber-200/90 bg-amber-50/95 px-3 py-2 text-[11px] font-medium leading-snug text-amber-900 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200 shadow-[0_6px_20px_rgba(245,158,11,0.15)] backdrop-blur-md">
        <AlertTriangle className="size-3.5 shrink-0" />
        일부가 사업 구역을 벗어났습니다 (구역 안 필지만 분석)
      </div>
    );
  }

  return null;
}

export function ParcelAnalysisOrchestrator() {
  const mapContext = useMapContext();
  const {
    isOpen,
    area,
    modalOpen,
    modalStep,
    boundarySessionDraft,
    setBoundarySessionDraft,
    selectedIds,
    analyzing,
    cancelAnalyze,
    enriching,
    result,
    analyzeError,
    drawerOpen,
    closeResultDrawer,
    setModalStep,
    closeAreaModal,
    startDraw,
    cancelDraw,
    redrawShape,
    confirmDraw,
    drawTool,
    drawPhase,
    drawPreview,
    drawToolbarAnchor,
    handleApplyBoundary,
    applyingArea,
    analysisGroups,
    facilityLayerMap,
    facilityWmsLayerMap,
    mapCaptureConfig,
    boundaryEmdOptions,
    boundaryEmdLoading,
    boundaryEmdError,
    reloadBoundaryEmd,
  } = useParcelAnalysis();

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);
  const { sections } = useParcelAnalysisResultSections(
    selectedIdList,
    analysisGroups,
    facilityWmsLayerMap
  );
  const displayResult = result ?? EMPTY_PARCEL_ANALYSIS_RESULT;

  useParcelAnalysisSigunguBoundary(isOpen && !boundaryEmdLoading);
  // 새 도형을 다 그리기 전(그리기 단계)까지는 기존 확정 영역을 유지(참고용).
  // 다 그려 편집 단계로 넘어가면 기존 영역을 숨겨 새 도형만 남긴다.
  const hideConfirmedArea = drawTool != null && drawPhase === 'editing';
  useParcelAnalysisAreaLayer(isOpen && !hideConfirmedArea, area?.wkt ?? null);
  useParcelAnalysisDraw();

  const drawToolbarRef = useRef<HTMLDivElement>(null);
  const editingToolbarActive = drawTool != null && drawPhase === 'editing' && drawToolbarAnchor != null;
  const toolbarPlacement = useParcelAnalysisDrawToolbarPosition(
    mapContext?.mapInstanceRef ?? { current: null },
    drawToolbarAnchor,
    drawToolbarRef,
    editingToolbarActive
  );
  const applyDisabled = drawPreview?.projectScope === 'fully_outside';

  if (!isOpen) return null;

  return (
    <>
      <ParcelAnalysisMethodModal
        open={modalOpen}
        step={modalStep}
        boundarySessionDraft={boundarySessionDraft}
        onBoundarySessionDraftChange={setBoundarySessionDraft}
        onStepChange={setModalStep}
        onDismiss={closeAreaModal}
        onStartDraw={startDraw}
        onApplyBoundary={handleApplyBoundary}
        applyingArea={applyingArea}
        boundaryEmdOptions={boundaryEmdOptions}
        boundaryEmdLoading={boundaryEmdLoading}
        boundaryEmdError={boundaryEmdError}
        onReloadBoundaryEmd={() => void reloadBoundaryEmd()}
      />
      {drawTool != null && (
        <>
          {drawPhase === 'drawing' ? (
            <div className="pointer-events-none fixed inset-x-0 top-4 z-[1200] flex flex-col items-center gap-2">
              <DrawToolbarActions
                drawPhase={drawPhase}
                confirmDraw={confirmDraw}
                redrawShape={redrawShape}
                cancelDraw={cancelDraw}
                applyDisabled={applyDisabled}
              />
            </div>
          ) : (
            <div
              ref={drawToolbarRef}
              className="pointer-events-none fixed z-[1200] flex flex-col items-start gap-2"
              style={
                toolbarPlacement
                  ? { left: toolbarPlacement.left, top: toolbarPlacement.top }
                  : { left: '50%', top: 16, transform: 'translateX(-50%)' }
              }
            >
              <DrawToolbarActions
                drawPhase={drawPhase}
                confirmDraw={confirmDraw}
                redrawShape={redrawShape}
                cancelDraw={cancelDraw}
                applyDisabled={applyDisabled}
              />
              <DrawScopeBanner preview={drawPreview} />
            </div>
          )}
        </>
      )}

      <ParcelAnalysisAnalyzingModal open={analyzing && !modalOpen} onCancel={cancelAnalyze} />

      <ParcelAnalysisResultModal
        open={drawerOpen}
        onClose={() => closeResultDrawer()}
        onForceClose={() => closeResultDrawer({ force: true })}
        sections={sections}
        result={displayResult}
        analyzeError={analyzeError}
        enriching={enriching}
        scopeAreaSqm={area?.areaSqm ?? 0}
        itemCount={displayResult.itemCount}
        mapCaptureConfig={mapCaptureConfig}
      />
    </>
  );
}