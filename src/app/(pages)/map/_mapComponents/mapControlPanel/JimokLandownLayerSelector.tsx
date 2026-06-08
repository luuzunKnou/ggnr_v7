'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { getLegendGraphicUrl } from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory';

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
  /** true면 패널 높이를 내용만큼만 사용 (고정 높이 없음) */
  contentSized?: boolean;
}

/**
 * 배경지도 선택과 동일한 스타일의 패널, 체크박스로 포함 레이어 켜기/끄기
 */
export function JimokLandownLayerSelector({
  title,
  layers,
  selectedTableNames,
  onSelectionChange,
  onClose,
  className,
  contentSized = false,
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
        'w-56 bg-white shadow-xl overflow-hidden flex flex-col rounded-[5px] opacity-90',
        !contentSized && 'flex-1 min-h-0',
        className
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="text-[13px] font-medium">{title}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-xs"
            aria-label="닫기"
          >
            닫기
          </button>
        )}
      </div>
      <div className="flex gap-1 px-2 py-1 border-b border-slate-100 shrink-0">
        <button
          type="button"
          onClick={selectAll}
          className="text-[11px] text-blue-600 hover:underline"
        >
          전체 선택
        </button>
        <span className="text-slate-300">|</span>
        <button
          type="button"
          onClick={selectNone}
          className="text-[11px] text-slate-500 hover:underline"
        >
          전체 해제
        </button>
      </div>
      <div
        className={cn(
          'py-1',
          contentSized ? 'overflow-visible' : 'flex-1 min-h-0 overflow-y-auto'
        )}
      >
        {layers.map((opt) => {
          const checked = selectedTableNames.has(opt.tableName);
          const useFallback = failedLegendLayers.has(opt.tableName);
          const legendUrl = getLegendGraphicUrl(opt.tableName, opt.tableName);
          return (
            <label
              key={opt.tableName}
              className={cn(
                'flex items-center justify-between gap-2 pl-2 pr-4 py-0.5 cursor-pointer transition-colors hover:bg-slate-50',
                checked && 'bg-blue-50'
              )}
            >
              <span className="flex items-center gap-2 min-w-0 flex-1">
                {useFallback ? (
                  <span
                    className="shrink-0 w-5 h-5 rounded border border-slate-300"
                    style={{ backgroundColor: opt.legendColor ?? FALLBACK_COLOR }}
                    aria-hidden
                  />
                ) : (
                  <img
                    src={legendUrl}
                    alt=""
                    className="shrink-0 w-5 h-5 object-contain border border-slate-200 rounded"
                    onError={() => onLegendError(opt.tableName)}
                  />
                )}
                <span
                  className={cn(
                    'text-xs truncate',
                    checked ? 'text-blue-600 font-medium' : 'text-slate-700'
                  )}
                >
                  {opt.layerName}
                </span>
              </span>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => toggle(opt.tableName, e.target.checked)}
                className="w-3.5 h-3.5 shrink-0 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
