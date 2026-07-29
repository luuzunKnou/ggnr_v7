'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLegendGraphicUrl } from '../layerFactory/serviceLayerFactory';
import {
  THEMATIC_MAP_LAYER_GROUPS,
  type ThematicMapLayerGroup,
  type ThematicMapLayerOption,
} from '../layerFactory/thematicMapLayerFactory';

const FALLBACK_LEGEND_COLOR = 'rgb(148,163,184)';

function GroupSelectCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (next: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-white/30 dark:text-blue-400"
      title={checked ? '이 그룹 전체 해제' : '이 그룹 전체 선택'}
      aria-label={checked ? '이 그룹 전체 해제' : '이 그룹 전체 선택'}
    />
  );
}

function ThematicMapGroupSection({
  group,
  selectedTableNames,
  onToggle,
  onToggleGroup,
  failedLegendLayers,
  onLegendError,
  defaultExpanded = true,
}: {
  group: ThematicMapLayerGroup;
  selectedTableNames: Set<string>;
  onToggle: (tableName: string, checked: boolean) => void;
  onToggleGroup: (tableNames: string[], checked: boolean) => void;
  failedLegendLayers: Set<string>;
  onLegendError: (tableName: string) => void;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const selectedCount = group.layers.filter((l) => selectedTableNames.has(l.tableName)).length;
  const allSelected = selectedCount === group.layers.length && group.layers.length > 0;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="border-b border-slate-100 last:border-b-0 dark:border-white/10">
      <button
        type="button"
        title={group.title}
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium transition-colors',
          'bg-slate-100 text-foreground hover:bg-slate-200',
          'dark:bg-white/10 dark:text-white/90 dark:hover:bg-white/15 dark:hover:text-white',
          (allSelected || someSelected) && 'text-blue-600 dark:text-white'
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-4 w-1 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400" />
          <GroupSelectCheckbox
            checked={allSelected}
            indeterminate={someSelected}
            onChange={(checked) =>
              onToggleGroup(
                group.layers.map((l) => l.tableName),
                checked
              )
            }
          />
          <span className="truncate">{group.title}</span>
          <span className="shrink-0 text-[11px] font-normal text-slate-400 dark:text-white/50">
            {selectedCount}/{group.layers.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400 dark:text-white/50" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 dark:text-white/50" />
        )}
      </button>

      {isExpanded && (
        <div className="pb-1">
          {group.layers.map((option: ThematicMapLayerOption) => {
            const checked = selectedTableNames.has(option.tableName);
            const useFallback = failedLegendLayers.has(option.tableName);
            const legendUrl = getLegendGraphicUrl(option.tableName, option.tableName);
            return (
              <label
                key={option.tableName}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 transition-colors',
                  'hover:bg-slate-50 dark:hover:bg-white/10',
                  checked && 'bg-blue-50 dark:bg-white/20'
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {useFallback ? (
                    <span
                      className="h-5 w-5 shrink-0 rounded border border-slate-300 dark:border-white/20"
                      style={{ backgroundColor: FALLBACK_LEGEND_COLOR }}
                      aria-hidden
                    />
                  ) : (
                    <img
                      src={legendUrl}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded border border-slate-200 object-contain dark:border-white/20"
                      onError={() => onLegendError(option.tableName)}
                    />
                  )}
                  <span
                    className={cn(
                      'truncate text-xs',
                      checked
                        ? 'font-medium text-blue-600 dark:text-white'
                        : 'text-slate-700 dark:text-white/90'
                    )}
                    title={option.layerName}
                  >
                    {option.layerName}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggle(option.tableName, e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-white/30 dark:text-blue-400"
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface ThematicMapLayerSelectorProps {
  groups?: ThematicMapLayerGroup[];
  selectedTableNames: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onClose?: () => void;
  className?: string;
}

/**
 * 배경지도와 같은 그룹 골격.
 * - 제목 → 전체 선택/해제 → 그룹(접기) → 레이어별 체크
 * - 행: 왼쪽 스타일·레이어명 / 오른쪽 선택
 * - 안쪽 얇은 스크롤(scrollbar-thin)
 */
export function ThematicMapLayerSelector({
  groups = THEMATIC_MAP_LAYER_GROUPS,
  selectedTableNames,
  onSelectionChange,
  onClose,
  className,
}: ThematicMapLayerSelectorProps) {
  const allTableNames = useMemo(
    () => groups.flatMap((g) => g.layers.map((l) => l.tableName)),
    [groups]
  );

  const [failedLegendLayers, setFailedLegendLayers] = useState<Set<string>>(new Set());
  const onLegendError = useCallback((tableName: string) => {
    setFailedLegendLayers((prev) => new Set(prev).add(tableName));
  }, []);

  const toggle = (tableName: string, checked: boolean) => {
    const next = new Set(selectedTableNames);
    if (checked) next.add(tableName);
    else next.delete(tableName);
    onSelectionChange(next);
  };

  const toggleGroup = (tableNames: string[], checked: boolean) => {
    const next = new Set(selectedTableNames);
    for (const name of tableNames) {
      if (checked) next.add(name);
      else next.delete(name);
    }
    onSelectionChange(next);
  };

  const selectAll = () => onSelectionChange(new Set(allTableNames));
  const selectNone = () => onSelectionChange(new Set());

  return (
    <div
      className={cn(
        'flex w-56 flex-col overflow-hidden rounded-[5px] bg-white opacity-90 shadow-xl',
        'max-h-[min(70vh,calc(100vh-90px))]',
        'dark:border dark:border-white/10 dark:bg-black/40 dark:text-white/90 dark:opacity-100 dark:backdrop-blur-sm',
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
        <span className="text-[13px] font-medium text-slate-800 dark:text-white/90">주제도</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-white"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-1.5 dark:border-white/10">
        <button
          type="button"
          onClick={selectAll}
          className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
        >
          전체 선택
        </button>
        <span className="text-slate-300 dark:text-white/30">|</span>
        <button
          type="button"
          onClick={selectNone}
          className="text-[11px] text-slate-500 hover:underline dark:text-white/60"
        >
          전체 해제
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {groups.length === 0 ? (
          <div className="px-3 py-3 text-[11px] leading-snug text-slate-500 dark:text-white/60">
            주제도 그룹이 정의에 없습니다.
          </div>
        ) : (
          groups.map((group) => (
            <ThematicMapGroupSection
              key={group.id}
              group={group}
              selectedTableNames={selectedTableNames}
              onToggle={toggle}
              onToggleGroup={toggleGroup}
              failedLegendLayers={failedLegendLayers}
              onLegendError={onLegendError}
            />
          ))
        )}
      </div>
    </div>
  );
}
