'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Magnet, Pencil, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLegendGraphicUrl } from '../../map/_mapComponents/layerFactory/serviceLayerFactory';
import type { BackgroundMapGroup } from '../../map/_mapComponents/mapControlPanel/backgroundMapSelector';
import type { ShapeEditorLayerGroup } from '../types';
import { isReadOnlyWorkLayer } from '../_lib/defaultWorkLayers';
import { useShapeEditorContext } from '../ShapeEditorContext';
import { ShapeEditorAddLayerDialog } from './ShapeEditorAddLayerDialog';

type ShapeEditorLayerPanelProps = {
  layerGroups: ShapeEditorLayerGroup[];
  layerLoading: boolean;
  layerError: string | null;
  backgroundMapId: string;
  onBackgroundMapChange: (id: string) => void;
  backgroundGroups: BackgroundMapGroup[];
};

export function ShapeEditorLayerPanel({
  layerGroups,
  layerLoading,
  layerError,
  backgroundMapId,
  onBackgroundMapChange,
  backgroundGroups,
}: ShapeEditorLayerPanelProps) {
  const {
    workLayers,
    removeWorkLayer,
    setWorkLayerView,
    setWorkLayerEdit,
    setWorkLayerSnap,
    addWorkLayer,
  } = useShapeEditorContext();

  const [addOpen, setAddOpen] = useState(false);
  const [bgExpanded, setBgExpanded] = useState(false);
  const [workExpanded, setWorkExpanded] = useState(true);
  const [failedLegendLayers, setFailedLegendLayers] = useState<Set<string>>(new Set());

  const onLegendError = useCallback((tableName: string) => {
    setFailedLegendLayers((prev) => new Set(prev).add(tableName));
  }, []);

  const existingIds = useMemo(() => new Set(workLayers.map((w) => w.id)), [workLayers]);

  return (
    <>
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-background">
        <div className="border-b border-border p-2">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={layerLoading}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-muted/30 py-2 text-xs font-medium text-foreground hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            레이어 추가
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto text-xs">
          {/* 배경지도 그룹 */}
          <div className="border-b border-border">
            <button
              type="button"
              onClick={() => setBgExpanded((v) => !v)}
              className="flex w-full items-center gap-1 px-2 py-2 font-semibold text-foreground hover:bg-muted/50"
            >
              {bgExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              배경지도
            </button>
            {bgExpanded ? (
              <ul className="pb-2">
                {backgroundGroups.map((group) => (
                  <li key={group.id}>
                    <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {group.title}
                    </div>
                    {group.options.length === 0 ? (
                      <div className="px-4 py-1 text-[10px] text-muted-foreground">항목 없음</div>
                    ) : (
                      group.options.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onBackgroundMapChange(opt.id)}
                          className={cn(
                            'flex w-full items-center gap-2 py-1.5 pl-6 pr-3 text-left hover:bg-muted/50',
                            backgroundMapId === opt.id && 'bg-blue-50 font-medium text-blue-800'
                          )}
                        >
                          <span
                            className={cn(
                              'h-2 w-2 shrink-0 rounded-full border',
                              backgroundMapId === opt.id
                                ? 'border-blue-600 bg-blue-600'
                                : 'border-border'
                            )}
                          />
                          <span className="truncate">{opt.label}</span>
                        </button>
                      ))
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* 작업 레이어 */}
          <div>
            <button
              type="button"
              onClick={() => setWorkExpanded((v) => !v)}
              className="flex w-full items-center gap-1 px-2 py-2 font-semibold text-foreground hover:bg-muted/50"
            >
              {workExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              작업 레이어
              <span className="ml-auto font-normal text-muted-foreground">{workLayers.length}</span>
            </button>
            {workExpanded ? (
              <ul className="pb-2">
                {layerError ? (
                  <li className="px-3 py-2 text-red-600">{layerError}</li>
                ) : workLayers.length === 0 ? (
                  <li className="px-3 py-4 text-center text-[10px] text-muted-foreground">
                    레이어 추가로 등록
                  </li>
                ) : (
                  workLayers.map((w) => {
                    const readOnly = isReadOnlyWorkLayer(w);
                    return (
                    <li
                      key={w.id}
                      className={cn(
                        'flex h-8 items-center gap-0.5 border-l-2 pr-1 pl-1',
                        w.edit ? 'border-blue-500 bg-blue-50/50' : 'border-transparent hover:bg-muted/50'
                      )}
                    >
                      <WorkLayerLegend
                        tableName={w.layer.tableName}
                        failed={failedLegendLayers.has(w.layer.tableName)}
                        onError={onLegendError}
                      />
                      {readOnly ? (
                        <span
                          className="min-w-0 flex-1 truncate font-medium text-foreground"
                          title={w.layer.tableName}
                        >
                          {w.layer.name}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setWorkLayerEdit(w.id)}
                          className="min-w-0 flex-1 truncate text-left font-medium text-foreground hover:text-blue-700"
                          title={w.layer.tableName}
                        >
                          {w.layer.name}
                        </button>
                      )}
                      <LayerToggle
                        title={w.view ? '보기 끄기' : '보기 켜기'}
                        active={w.view}
                        onClick={() => setWorkLayerView(w.id, !w.view)}
                      >
                        {w.view ? (
                          <Eye className="h-3 w-3" />
                        ) : (
                          <EyeOff className="h-3 w-3" />
                        )}
                      </LayerToggle>
                      {!readOnly ? (
                        <LayerToggle
                          title="편집 레이어"
                          active={w.edit}
                          onClick={() => setWorkLayerEdit(w.id)}
                        >
                          <Pencil className="h-3 w-3" />
                        </LayerToggle>
                      ) : null}
                      <LayerToggle
                        title={w.snap ? '스냅 끄기' : '스냅 켜기'}
                        active={w.snap}
                        onClick={() => setWorkLayerSnap(w.id, !w.snap)}
                      >
                        <Magnet className="h-3 w-3" />
                      </LayerToggle>
                      {!readOnly ? (
                        <LayerToggle
                          title="목록에서 제거"
                          onClick={() => removeWorkLayer(w.id)}
                          className="text-muted-foreground hover:text-red-600"
                        >
                          <X className="h-3 w-3" />
                        </LayerToggle>
                      ) : null}
                    </li>
                    );
                  })
                )}
              </ul>
            ) : null}
          </div>
        </div>
      </aside>

      <ShapeEditorAddLayerDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        layerGroups={layerGroups}
        loading={layerLoading}
        error={layerError}
        excludeIds={existingIds}
        onAdd={(layer) => {
          addWorkLayer(layer);
          setAddOpen(false);
        }}
      />
    </>
  );
}

function getWorkLayerLegendUrl(tableName: string): string {
  const url = new URL(getLegendGraphicUrl(tableName, tableName));
  url.searchParams.set('LEGEND_OPTIONS', JSON.stringify({ forceLabels: false }));
  url.searchParams.set('WIDTH', '16');
  url.searchParams.set('HEIGHT', '16');
  return url.toString();
}

function WorkLayerLegend({
  tableName,
  failed,
  onError,
}: {
  tableName: string;
  failed: boolean;
  onError: (tableName: string) => void;
}) {
  if (failed) {
    return (
      <span
        className="h-4 w-4 shrink-0 rounded border border-border bg-muted"
        aria-hidden
      />
    );
  }

  return (
    <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded border border-border bg-background">
      <img
        src={getWorkLayerLegendUrl(tableName)}
        alt=""
        className="absolute left-0 top-1/2 h-[18px] w-auto max-w-none -translate-y-1/2"
        onError={() => onError(tableName)}
      />
    </span>
  );
}

function LayerToggle({
  children,
  title,
  active,
  onClick,
  className,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded p-1 text-muted-foreground hover:bg-muted',
        active && 'bg-blue-100 text-blue-700',
        className
      )}
    >
      {children}
    </button>
  );
}
