'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { getLegendGraphicUrl } from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory';
import { MAP_LAYER_PANEL_MAX_H_CLASS } from './mapLayerPanelLayout';

export interface LayerOption {
  tableName: string;
  layerName: string;
  /** GetLegendGraphic 실패 시 범례에 쓸 색상(hex). 없으면 회색 플레이스홀더 */
  legendColor?: string;
}

interface JimokLandownLayerSelectorProps {
  title: string;
  layers: LayerOption[];
  selectedTableNames: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onClose?: () => void;
  className?: string;
  /** false면 전체 선택·해제 숨김 (인쇄 등) */
  showBulkActions?: boolean;
}

/**
 * 지목·소유구분·지적도·건물도로 공통 목록 패널.
 * 최대 높이: 화면 하단 10px 여백, 스크롤은 목록 안쪽.
 */
export function JimokLandownLayerSelector({
  title,
  layers,
  selectedTableNames,
  onSelectionChange,
  onClose,
  className,
  showBulkActions = true,
}: JimokLandownLayerSelectorProps) {
  const toggle = (tableName: string, checked: boolean) => {
    const next = new Set(selectedTableNames);
    if (checked) next.add(tableName);
    else next.delete(tableName);
    onSelectionChange(next);
  };

  const selectAll = () => onSelectionChange(new Set(layers.map((l) => l.tableName)));
  const selectNone = () => onSelectionChange(new Set());

  const [failedLegendLayers, setFailedLegendLayers] = useState<Set<string>>(new Set());
  const onLegendError = useCallback((tableName: string) => {
    setFailedLegendLayers((prev) => new Set(prev).add(tableName));
  }, []);

  const FALLBACK_COLOR = 'rgb(148,163,184)';

  return (
    <div
      className={cn(
        'flex w-56 flex-col overflow-hidden rounded-[5px] border border-border bg-card/95 shadow-lg backdrop-blur-sm',
        MAP_LAYER_PANEL_MAX_H_CLASS,
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <span className="text-[13px] font-medium text-foreground">{title}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded px-1"
            aria-label="닫기"
            title="닫기"
          >
            닫기
          </button>
        )}
      </div>
      {showBulkActions ? (
        <div className="flex shrink-0 gap-1 border-b border-border px-2 py-1">
          <button
            type="button"
            onClick={selectAll}
            className="text-[11px] text-primary hover:underline"
            title="전체 선택"
          >
            전체 선택
          </button>
          <span className="text-border">|</span>
          <button
            type="button"
            onClick={selectNone}
            className="text-[11px] text-muted-foreground hover:underline"
            title="전체 해제"
          >
            전체 해제
          </button>
        </div>
      ) : null}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
        {layers.length === 0 ? (
          <div className="px-3 py-3 text-[11px] leading-snug text-muted-foreground">
            표시할 레이어가 없습니다.
          </div>
        ) : (
          layers.map((opt) => {
            const checked = selectedTableNames.has(opt.tableName);
            const useFallback = failedLegendLayers.has(opt.tableName);
            const legendUrl = getLegendGraphicUrl(opt.tableName, opt.tableName);
            return (
              <label
                key={opt.tableName}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 py-0.5 pl-2 pr-4 transition-colors hover:bg-muted/50',
                  checked && 'bg-primary/10'
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {useFallback ? (
                    <span
                      className="h-5 w-5 shrink-0 rounded border border-border"
                      style={{ backgroundColor: opt.legendColor ?? FALLBACK_COLOR }}
                      aria-hidden
                    />
                  ) : (
                    <img
                      src={legendUrl}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded border border-border object-contain"
                      onError={() => onLegendError(opt.tableName)}
                    />
                  )}
                  <span
                    className={cn(
                      'truncate text-xs',
                      checked ? 'font-medium text-primary' : 'text-foreground'
                    )}
                  >
                    {opt.layerName}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(opt.tableName, e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-border text-primary focus:ring-primary"
                />
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
