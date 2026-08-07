'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Circle,
  Layers,
  MapPin,
  Pencil,
  Pentagon,
  Square,
  X,
} from 'lucide-react';
import Feature from 'ol/Feature';
import Draw, { createBox, type DrawEvent } from 'ol/interaction/Draw';
import Modify, { type ModifyEvent } from 'ol/interaction/Modify';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import WKT from 'ol/format/WKT';
import type { Geometry } from 'ol/geom';
import type CircleGeom from 'ol/geom/Circle';
import { fromCircle } from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Switch } from '@/app/shadcnComponents/ui/switch';
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
  ParcelAnalysisBoundaryPicker,
  getBoundarySelectionCount,
  useParcelAnalysisAreaLayer,
  useParcelAnalysisDrawToolbarPosition,
  useParcelAnalysisSigunguBoundary,
  type BoundaryEmdSelection,
} from '../../_mapComponents/analysisArea';
import { isLargeParcelAnalysisArea } from '../parcelAnalysis/parcelAnalysis.types';
import { useChangeHistory, type ChangeHistoryDrawToolbarAnchor } from './changeHistoryContext';
import { ChangeHistoryResult } from './ChangeHistory.result';
import {
  type ChangeHistoryDrawTool,
  type ChangeHistoryModalStep,
} from './changeHistory.types';

const DRAW_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 1)', width: 2.5 }),
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.18)' }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: 'rgba(37, 99, 235, 1)' }),
    stroke: new Stroke({ color: '#fff', width: 1.5 }),
  }),
});

const DRAW_LAYER_Z = 870;

const DRAW_TOOLS: { id: ChangeHistoryDrawTool; icon: typeof Square; label: string }[] = [
  { id: 'rectangle', icon: Square, label: '사각형' },
  { id: 'polygon', icon: Pentagon, label: '다각형' },
  { id: 'circle', icon: Circle, label: '원' },
];

const STEP_MAX_WIDTH: Record<ChangeHistoryModalStep, string> = {
  choose: 'sm:max-w-[480px]',
  draw: 'sm:max-w-[440px]',
  boundary: 'sm:max-w-[520px]',
};

const STEP_SUBTITLE: Record<Exclude<ChangeHistoryModalStep, 'choose'>, string> = {
  draw: '도형 그리기',
  boundary: '행정경계 선택',
};

function toWkt5181(geom: Geometry): string {
  const base = geom.getType() === 'Circle' ? fromCircle(geom as CircleGeom) : geom;
  const cloned = base.clone();
  cloned.transform('EPSG:3857', 'EPSG:5181');
  return new WKT().writeGeometry(cloned);
}

function extentTopCenter(geom: Geometry): [number, number] {
  const ext = geom.getExtent();
  return [(ext[0] + ext[2]) / 2, ext[3]];
}

function buildToolbarAnchorFromGeom(geom: Geometry): ChangeHistoryDrawToolbarAnchor {
  return { topCenter: extentTopCenter(geom) };
}

/** 필지분석과 동일 — 그리기 → 편집(적용/다시그리기) */
function useChangeHistoryDraw() {
  const mapContext = useMapContext();
  const {
    drawTool,
    drawPhase,
    drawWktRef,
    setDrawPhase,
    setDrawToolbarAnchor,
    clearDrawToolbarAnchor,
  } = useChangeHistory();

  const attachDrawRef = useRef<((tool: ChangeHistoryDrawTool) => void) | null>(null);
  const attachModifyRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !drawTool) return;

    const source = new VectorSource();
    const layer = new VectorLayer({ source, style: DRAW_STYLE, zIndex: DRAW_LAYER_Z });
    layer.set('changeHistoryDraw', true);
    map.addLayer(layer);

    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined;
    dblClickZoom?.setActive(false);

    let draw: Draw | null = null;
    let modify: Modify | null = null;

    const detachDraw = () => {
      if (draw) {
        map.removeInteraction(draw);
        draw.dispose();
        draw = null;
      }
    };
    const detachModify = () => {
      if (modify) {
        map.removeInteraction(modify);
        modify.dispose();
        modify = null;
      }
    };

    const writeWkt = () => {
      const geom = source.getFeatures()[0]?.getGeometry();
      drawWktRef.current = geom ? toWkt5181(geom) : null;
    };

    const attachDraw = (tool: ChangeHistoryDrawTool) => {
      detachDraw();
      detachModify();
      source.clear();
      drawWktRef.current = null;
      draw =
        tool === 'rectangle'
          ? new Draw({ source, type: 'Circle', geometryFunction: createBox(), stopClick: true })
          : tool === 'polygon'
            ? new Draw({ source, type: 'Polygon', stopClick: true })
            : new Draw({ source, type: 'Circle', stopClick: true });
      draw.on('drawstart', () => {
        source.clear();
        clearDrawToolbarAnchor();
      });
      draw.on('drawend', (e: DrawEvent) => {
        const geom = e.feature?.getGeometry()?.clone();
        if (!geom) return;
        let wkt: string | null = null;
        try {
          wkt = toWkt5181(geom);
        } catch {
          wkt = null;
        }
        drawWktRef.current = wkt;
        const anchor = buildToolbarAnchorFromGeom(geom);
        queueMicrotask(() => {
          setDrawToolbarAnchor(anchor);
          setDrawPhase('editing');
        });
      });
      map.addInteraction(draw);
    };

    const attachModify = () => {
      detachDraw();
      detachModify();
      modify = new Modify({ source });
      let anchorRaf = 0;
      const scheduleAnchorFromGeom = (geom: Geometry) => {
        if (anchorRaf) return;
        anchorRaf = requestAnimationFrame(() => {
          anchorRaf = 0;
          setDrawToolbarAnchor(buildToolbarAnchorFromGeom(geom));
        });
      };
      modify.on('modifyend', (e: ModifyEvent) => {
        writeWkt();
        const geom =
          e.features.getArray()[0]?.getGeometry() ?? source.getFeatures()[0]?.getGeometry();
        if (geom) scheduleAnchorFromGeom(geom);
      });
      map.addInteraction(modify);
    };

    attachDrawRef.current = attachDraw;
    attachModifyRef.current = attachModify;

    return () => {
      detachDraw();
      detachModify();
      map.removeLayer(layer);
      source.clear();
      dblClickZoom?.setActive(true);
      attachDrawRef.current = null;
      attachModifyRef.current = null;
    };
  }, [
    drawTool,
    mapContext?.mapInstanceRef,
    drawWktRef,
    setDrawPhase,
    setDrawToolbarAnchor,
    clearDrawToolbarAnchor,
  ]);

  useEffect(() => {
    if (!drawTool) return;
    if (drawPhase === 'drawing') attachDrawRef.current?.(drawTool);
    else attachModifyRef.current?.();
  }, [drawTool, drawPhase]);
}

/** 표시 레이어 — 데이터조회 그룹·목록 (기본 접힘, 하단까지 스크롤). 결과 지도에서 켜기/끄기 */
function ChangeHistoryLayerSelector({
  groups,
  layersLoaded,
  layerIds,
  onLayerIdsChange,
  disabled,
}: {
  groups: { id: string; title: string; items: { id: string; name: string }[] }[];
  layersLoaded: boolean;
  layerIds: Set<string>;
  onLayerIdsChange: (ids: Set<string>) => void;
  disabled?: boolean;
}) {
  /** true만 펼침 — 기본 모두 닫힘 */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const allIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const totalCount = allIds.length;
  const selectedCount = layerIds.size;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const someSelected = selectedCount > 0 && !allSelected;

  const setAll = (on: boolean) => {
    onLayerIdsChange(on ? new Set(allIds) : new Set());
  };

  const setGroupAll = (groupId: string, on: boolean) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const next = new Set(layerIds);
    for (const item of group.items) {
      if (on) next.add(item.id);
      else next.delete(item.id);
    }
    onLayerIdsChange(next);
  };

  const toggleItem = (id: string) => {
    const next = new Set(layerIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onLayerIdsChange(next);
  };

  const toggleGroupOpen = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', disabled && 'pointer-events-none opacity-50')}>
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-muted-foreground">표시 레이어</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {!layersLoaded
                ? '레이어 불러오는 중…'
                : `${selectedCount}/${totalCount} 선택`}
            </p>
          </div>
          <Switch
            id="change-history-layers-all"
            aria-label={allSelected ? '전체 해제' : '전체 선택'}
            title={allSelected ? '전체 해제' : '전체 선택'}
            checked={allSelected}
            indeterminate={someSelected}
            disabled={!layersLoaded || totalCount === 0}
            onCheckedChange={(on) => setAll(on || someSelected)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {layersLoaded && groups.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">표시할 레이어가 없습니다.</p>
        )}
        {groups.map((group) => {
          const groupIds = group.items.map((i) => i.id);
          const selected = groupIds.filter((id) => layerIds.has(id)).length;
          const allOn = selected === groupIds.length && groupIds.length > 0;
          const someOn = selected > 0 && selected < groupIds.length;
          const isGroupOpen = openGroups[group.id] === true;

          return (
            <div key={group.id} className="mb-3 last:mb-0">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => toggleGroupOpen(group.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 py-0.5 text-left"
                >
                  {isGroupOpen ? (
                    <ChevronDown className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-[12px] font-semibold text-muted-foreground">{group.title}</span>
                  <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                    {selected}/{groupIds.length}
                  </span>
                </button>
                <Switch
                  id={`change-history-group-${group.id}`}
                  aria-label={`${group.title} ${allOn ? '전체 해제' : '전체 선택'}`}
                  checked={allOn}
                  indeterminate={someOn}
                  disabled={!layersLoaded}
                  onCheckedChange={(on) => setGroupAll(group.id, on || someOn)}
                />
              </div>
              {isGroupOpen && (
                <ul className="ml-1.5 mt-1 space-y-0.5 border-l border-border pl-2">
                  {group.items.map((item) => {
                    const checked = layerIds.has(item.id);
                    return (
                      <li key={item.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded py-1 pr-1 hover:bg-muted/60">
                          <input
                            type="checkbox"
                            className="size-3.5 shrink-0 cursor-pointer rounded border-border text-primary focus:ring-primary/30"
                            checked={checked}
                            onChange={() => toggleItem(item.id)}
                          />
                          <span className="flex-1 text-[11px] text-muted-foreground">{item.name}</span>
                          <Layers className="h-3 w-3 text-muted-foreground/40" />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChangeHistorySidePanel() {
  const {
    area,
    panelEngaged,
    layerGroups,
    layersLoaded,
    layerIds,
    setLayerIds,
    openChangeAreaModal,
    resetArea,
    openResult,
    closeMode,
    resultOpen,
    drawTool,
    applyingArea,
  } = useChangeHistory();

  const hasArea = area != null;
  const areaCleared = panelEngaged && !hasArea;
  const canOpenResult = hasArea && layerIds.size > 0 && !resultOpen && !drawTool && !applyingArea;
  const largeAreaWarning = area != null && isLargeParcelAnalysisArea(area);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-background px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">변동이력분석</h3>
          <button
            type="button"
            onClick={closeMode}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground">분석 영역·표시 레이어</span>
      </header>

      <ParcelAnalysisAreaSummary
        area={area}
        areaCleared={areaCleared}
        onChangeClick={openChangeAreaModal}
        onClearClick={resetArea}
        onSpecifyClick={openChangeAreaModal}
      />

      {!hasArea && !areaCleared && (
        <div className="mx-3 mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          분석 영역을 지정해야 표시 레이어를 선택할 수 있습니다.
        </div>
      )}

      {largeAreaWarning ? (
        <div className="mx-3 mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-2 text-[11px] leading-snug text-orange-900 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200">
          분석 영역이 넓습니다. 이력·시점 도형 조회에 시간이 오래 걸릴 수 있으니, 가능하면 영역을
          나누어 조회하세요.
        </div>
      ) : null}

      <ChangeHistoryLayerSelector
        groups={layerGroups}
        layersLoaded={layersLoaded}
        layerIds={layerIds}
        onLayerIdsChange={setLayerIds}
        disabled={!hasArea || Boolean(drawTool) || applyingArea}
      />

      <div className="shrink-0 border-t border-border bg-muted/80 px-3 py-2">
        <Button type="button" className="w-full" size="sm" disabled={!canOpenResult} onClick={openResult}>
          이력 보기
        </Button>
      </div>
    </aside>
  );
}

function ChangeHistoryMethodModal({
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
}: {
  open: boolean;
  step: ChangeHistoryModalStep;
  boundarySessionDraft: BoundaryEmdSelection[];
  onBoundarySessionDraftChange: (selection: BoundaryEmdSelection[]) => void;
  onStepChange: (step: ChangeHistoryModalStep) => void;
  onDismiss: () => void;
  onStartDraw: (tool: ChangeHistoryDrawTool) => void;
  onApplyBoundary: (selection: BoundaryEmdSelection[]) => void;
  applyingArea: boolean;
  boundaryEmdOptions: { code: string; name: string }[];
  boundaryEmdLoading: boolean;
  boundaryEmdError: string | null;
  onReloadBoundaryEmd: () => void;
}) {
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
                도구를 선택하면 이 창이 닫히고 지도에 그릴 수 있어요. 다 그린 뒤 꼭짓점을 드래그해 수정하고
                «적용»하세요.
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

export function ChangeHistoryOrchestrator() {
  const mapContext = useMapContext();
  const {
    isOpen,
    area,
    modalOpen,
    modalStep,
    boundarySessionDraft,
    setBoundarySessionDraft,
    setModalStep,
    closeAreaModal,
    startDraw,
    cancelDraw,
    redrawShape,
    confirmDraw,
    handleApplyBoundary,
    applyingArea,
    boundaryEmdOptions,
    boundaryEmdLoading,
    boundaryEmdError,
    reloadBoundaryEmd,
    drawTool,
    drawPhase,
    drawToolbarAnchor,
  } = useChangeHistory();

  useParcelAnalysisSigunguBoundary(isOpen && !boundaryEmdLoading);
  const hideConfirmedArea = drawTool != null && drawPhase === 'editing';
  useParcelAnalysisAreaLayer(isOpen && !hideConfirmedArea, area?.wkt ?? null, {
    layerFlag: 'changeHistoryArea',
  });
  useChangeHistoryDraw();

  const drawToolbarRef = useRef<HTMLDivElement>(null);
  const editingToolbarActive = drawTool != null && drawPhase === 'editing' && drawToolbarAnchor != null;
  const toolbarPlacement = useParcelAnalysisDrawToolbarPosition(
    mapContext?.mapInstanceRef ?? { current: null },
    drawToolbarAnchor,
    drawToolbarRef,
    editingToolbarActive
  );

  if (!isOpen) return null;

  return (
    <>
      <ChangeHistoryMethodModal
        open={modalOpen}
        step={modalStep}
        boundarySessionDraft={boundarySessionDraft}
        onBoundarySessionDraftChange={setBoundarySessionDraft}
        onStepChange={setModalStep}
        onDismiss={closeAreaModal}
        onStartDraw={startDraw}
        onApplyBoundary={(sel) => void handleApplyBoundary(sel)}
        applyingArea={applyingArea}
        boundaryEmdOptions={boundaryEmdOptions}
        boundaryEmdLoading={boundaryEmdLoading}
        boundaryEmdError={boundaryEmdError}
        onReloadBoundaryEmd={reloadBoundaryEmd}
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
              />
            </div>
          )}
        </>
      )}

      <ChangeHistoryResult />
    </>
  );
}
