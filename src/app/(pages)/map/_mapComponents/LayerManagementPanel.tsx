'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Settings, ChevronDown, ChevronRight, X, Search, SlidersHorizontal, Palette, Trash2, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WORKSPACE } from './layerFactory/serviceLayerFactory';
import type { LayerFilterRow } from './map-layergroup-bar';

type DefineLayerRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  [key: string]: unknown;
};

type DefineField = { define_field_name?: string; define_field_kor_name?: string; define_field_type?: string };

interface LayerManagementPanelProps {
  categories: string[];
  tableList: DefineLayerRow[];
  visibleLayerNames: Set<string>;
  onVisibleChange: (next: Set<string>) => void;
  onUpdateWms: (visible: Set<string>) => void;
  onClose: () => void;
  layerFilterRows?: globalThis.Map<string, LayerFilterRow[]>;
  onLayerFilterRowsChange?: (layerName: string, rows: LayerFilterRow[]) => void;
  favoriteGroupKeys?: string[];
  onFavoriteToggle?: (category: string) => void;
}

function serviceLayersForGroup(
  tableList: DefineLayerRow[],
  groupKey: string
): DefineLayerRow[] {
  return tableList.filter(
    (row) => (String(row.define_table_group ?? '').trim() || '(미분류)') === groupKey
  );
}

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

/** GeoServer WMS GetLegendGraphic URL (범례 이미지) */
function getLegendGraphicUrl(layerName: string): string {
  const base = getGeoServerBase();
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetLegendGraphic',
    VERSION: '1.0.0',
    LAYER: `${WORKSPACE}:${layerName}`,
    STYLE: layerName,
    FORMAT: 'image/png',
    WIDTH: '48',
    HEIGHT: '48',
  });
  return `${base}/wms?${params.toString()}`;
}

export function LayerManagementPanel({
  categories,
  tableList,
  visibleLayerNames,
  onVisibleChange,
  onUpdateWms,
  onClose,
  layerFilterRows = new Map(),
  onLayerFilterRowsChange,
  favoriteGroupKeys = [],
  onFavoriteToggle,
}: LayerManagementPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [layerFields, setLayerFields] = useState<Record<string, DefineField[]>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // 필터가 있는 레이어는 필드 목록 fetch
  useEffect(() => {
    if (!layerFilterRows) return;
    for (const [layerName, rows] of layerFilterRows) {
      if (rows.length > 0 && !layerFields[layerName]) {
        fetch(`/api/config/defineLayer/fields/${encodeURIComponent(layerName)}`)
          .then((r) => r.json())
          .then((body: { success?: boolean; data?: DefineField[] }) => {
            const list = body?.data ?? [];
            setLayerFields((prev) => ({ ...prev, [layerName]: list }));
          })
          .catch(() => setLayerFields((prev) => ({ ...prev, [layerName]: [] })));
      }
    }
  }, [layerFilterRows, layerFields]);

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggle = (defineTableName: string, checked: boolean) => {
    const next = new Set(visibleLayerNames);
    if (checked) next.add(defineTableName);
    else next.delete(defineTableName);
    onVisibleChange(next);
    onUpdateWms(next);
  };

  const handleDeselectAll = () => {
    onVisibleChange(new Set());
    onUpdateWms(new Set());
  };

  const handleToggleCategory = (category: string, checked: boolean) => {
    const layers = serviceLayersForGroup(tableList, category);
    const names = layers.map((row) => String(row.define_table_name ?? '').trim()).filter(Boolean);
    const next = new Set(visibleLayerNames);
    if (checked) names.forEach((name) => next.add(name));
    else names.forEach((name) => next.delete(name));
    onVisibleChange(next);
    onUpdateWms(next);
  };

  const activeCount = visibleLayerNames.size;

  const sortedCategories = useMemo(() => {
    if (favoriteGroupKeys.length === 0) return categories;
    return [...categories].sort((a, b) => {
      const aFav = favoriteGroupKeys.includes(a);
      const bFav = favoriteGroupKeys.includes(b);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return 0;
    });
  }, [categories, favoriteGroupKeys]);

  const searchLower = debouncedSearchQuery.trim().toLowerCase();
  const layerMatchesSearch = (row: DefineLayerRow) => {
    if (!searchLower) return true;
    const name = (String(row.define_table_kor_name ?? '').trim() || String(row.define_table_name ?? '').trim()).toLowerCase();
    const tableName = String(row.define_table_name ?? '').trim().toLowerCase();
    return name.includes(searchLower) || tableName.includes(searchLower);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-[960px] h-[85vh] flex flex-col bg-slate-100 rounded-[10px] shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-4 py-2.5 bg-[#F1F9FB] border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-[10px] bg-[#0ea5e9]/15 flex items-center justify-center shrink-0">
                <Settings className="w-5 h-5 text-[#0ea5e9]" strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-[14px] font-semibold text-slate-800">레이어 설정</h2>
                <p className="text-[12px] text-slate-500 -mt-0.5">지도에 보여줄 레이어를 설정합니다</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5">
            <Search className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="레이어 검색"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Content - Grid of category cards */}
        <div className="flex-1 overflow-auto p-4">
          <div key={debouncedSearchQuery} className="columns-2 md:columns-3 gap-3.5">
            {sortedCategories.map((category, idx) => {
              const allLayers = serviceLayersForGroup(tableList, category);
              const categoryMatchesSearch =
                !searchLower || category.toLowerCase().includes(searchLower);
              const layers =
                searchLower && !categoryMatchesSearch
                  ? allLayers.filter(layerMatchesSearch)
                  : allLayers;
              if (layers.length === 0) return null;
              const isCollapsed = collapsed[category] ?? false;
              const selectedCount = layers.filter((row) =>
                visibleLayerNames.has(String(row.define_table_name ?? '').trim())
              ).length;

              return (
                <div
                  key={category}
                  className="break-inside-avoid mb-3.5 rounded-lg border border-slate-200 bg-white overflow-hidden animate-layer-result-in"
                >
                  {/* Category header */}
                  <div className="w-full px-3.5 py-2.5 flex items-center gap-2 hover:bg-slate-50">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(category)}
                      className="flex items-center gap-2 text-left min-w-0 hover:bg-transparent py-0 shrink-0"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span className="text-[12px] font-medium text-slate-800 truncate">
                        {category}
                      </span>
                    </button>
                    {onFavoriteToggle && (
                      <button
                        type="button"
                        onClick={() => onFavoriteToggle(category)}
                        className={cn(
                          'p-0 rounded hover:bg-slate-200 transition-colors shrink-0',
                          favoriteGroupKeys.includes(category)
                            ? 'text-amber-500 fill-amber-500'
                            : 'text-slate-400 hover:text-amber-500'
                        )}
                        title={favoriteGroupKeys.includes(category) ? '즐겨찾기 해제' : '상단 버튼에 표시'}
                        aria-label={favoriteGroupKeys.includes(category) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                      >
                        <Star
                          className={cn('w-4 h-4', favoriteGroupKeys.includes(category) && 'fill-current')}
                          strokeWidth={1.5}
                        />
                      </button>
                    )}
                    <span className="flex items-center gap-1.5 shrink-0 text-[12px] text-slate-500 ml-auto">
                      {selectedCount}/{layers.length}
                      <input
                        type="checkbox"
                        checked={layers.length > 0 && selectedCount === layers.length}
                        onChange={(e) => handleToggleCategory(category, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded border-slate-300 text-[#0ea5e9] focus:ring-[#0ea5e9]"
                        title="전체 레이어 켜기/끄기"
                      />
                    </span>
                  </div>

                  {/* Layer list */}
                  {!isCollapsed && (
                    <div className="border-t border-slate-100 pl-[9px] pr-3.5 py-[5px]">
                      {layers.map((row) => {
                        const defineTableName = String(row.define_table_name ?? '').trim();
                        const name =
                          String(row.define_table_kor_name ?? '').trim() || defineTableName;
                        const checked = visibleLayerNames.has(defineTableName);
                        const filterRows = layerFilterRows.get(defineTableName) ?? [];
                        const hasFilters = filterRows.length > 0;
                        const fields = layerFields[defineTableName]?.filter((f) => (f.define_field_type ?? '') !== 'GEOMETRY') ?? [];

                        return (
                          <React.Fragment key={defineTableName}>
                            <div
                              className={cn(
                                'flex items-center gap-1.5 py-[3px] pl-1 pr-0 hover:bg-slate-50',
                                checked && 'bg-[#0ea5e9]/10'
                              )}
                            >
                              <label
                              htmlFor={`layer-cb-${defineTableName}`}
                              className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
                            >
                                <span className="w-3 h-3 shrink-0 rounded overflow-hidden [background:transparent]">
                                  <img
                                    src={getLegendGraphicUrl(defineTableName)}
                                    alt=""
                                    className="w-full h-full object-cover object-center scale-150"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                </span>
                                <span
                                  className={cn(
                                    'text-[12px] truncate flex-1',
                                    checked ? 'font-medium text-slate-800' : 'text-slate-600'
                                  )}
                                >
                                  {name}
                                </span>
                              </label>
                              {onLayerFilterRowsChange && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    const current = layerFilterRows.get(defineTableName) ?? [];
                                    onLayerFilterRowsChange(defineTableName, [...current, { field: '', value: '' }]);
                                  }}
                                  className={cn(
                                    'relative rounded shrink-0',
                                    hasFilters ? 'text-[#0ea5e9]' : 'text-slate-400 hover:text-slate-600'
                                  )}
                                  title="필터 추가"
                                >
                                  <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={1.5} />
                                  {hasFilters && (
                                    <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-[#0ea5e9]" />
                                  )}
                                </button>
                              )}
                              <Palette className="w-3.5 h-3.5 text-slate-400 shrink-0" strokeWidth={1.5} />
                              <input
                                id={`layer-cb-${defineTableName}`}
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  handleToggle(defineTableName, e.target.checked)
                                }
                                className="w-4 h-4 rounded border-slate-300 text-[#0ea5e9] focus:ring-[#0ea5e9] shrink-0"
                              />
                            </div>
                            {filterRows.length > 0 && onLayerFilterRowsChange && (
                              <div className="ml-2 mt-0.5 mb-1.5 space-y-1 text-left">
                                {filterRows.map((filterRow, idx) => (
                                  <div key={idx} className="flex items-center gap-2">
                                    <span className="w-2 h-px bg-slate-400 shrink-0 self-center" aria-hidden />
                                    <select
                                        value={filterRow.field}
                                        onChange={(e) => {
                                          const next = [...filterRows];
                                          next[idx] = { ...next[idx], field: e.target.value };
                                          onLayerFilterRowsChange(defineTableName, next);
                                        }}
                                        className="flex-1 min-w-0 rounded border border-slate-200 px-2 py-0.5 text-[12px]"
                                      >
                                        <option value="">필드 선택</option>
                                        {fields.map((f) => (
                                          <option key={f.define_field_name} value={f.define_field_name ?? ''}>
                                            {(f.define_field_kor_name ?? f.define_field_name ?? '').trim() || f.define_field_name}
                                          </option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        value={filterRow.value}
                                        onChange={(e) => {
                                          const next = [...filterRows];
                                          next[idx] = { ...next[idx], value: e.target.value };
                                          onLayerFilterRowsChange(defineTableName, next);
                                        }}
                                        placeholder="값 입력"
                                        className="flex-1 min-w-0 rounded border border-slate-200 px-2 py-0.5 text-[12px]"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const next = filterRows.filter((_, i) => i !== idx);
                                          onLayerFilterRowsChange(defineTableName, next);
                                        }}
                                        className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
                                        title="삭제"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-2 border-t border-slate-200 flex items-center justify-between bg-slate-50">
          <span className="text-[12px] text-slate-600">
            {activeCount}개 레이어 활성화
          </span>
          <button
            type="button"
            onClick={handleDeselectAll}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
          >
            전체 해제
          </button>
        </div>
      </div>
    </>
  );
}
