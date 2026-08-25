'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, Layers, Eye, EyeOff } from 'lucide-react';

const FAVORITES_STORAGE_KEY = 'map-layer-group-favorites';

function loadFavoriteGroupKeys(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveFavoriteGroupKeys(keys: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // ignore
  }
}
import { useMapContext } from './MapContext';
import { LayerManagementPanel } from './LayerManagementPanel';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { getGeoServerBase } from '@/lib/geoserverUrl';
import { WORKSPACE } from './layerFactory/serviceLayerFactory';
import { getLayerGroupIconMap, defaultLayerGroupIcon } from '@/config/layerGroupIcon';

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

import type { LayerFilterRow } from './layerFactory/serviceLayerFactory';
export type { LayerFilterRow };

type DefineLayerRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  [key: string]: unknown;
};

/**
 * 지도 상단 레이어 그룹 버튼 바 (검색창 옆)
 * - tables.json(defineLayer)의 define_table_group 기준 그룹 버튼 표시
 * - 그룹 클릭: 해당 그룹 레이어만 표시
 * - 설정 아이콘 클릭: 해당 그룹 하위 레이어 목록(체크박스) 표시/숨김 토글
 */
const OPENED_LAYER_SETTING = 'layerSetting';

export function MapLayergroupBar() {
  const mapContext = useMapContext();
  const mapRef = mapContext?.mapInstanceRef ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tableList, setTableList] = useState<DefineLayerRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const visibleLayerNames = mapContext?.visibleLayerNames ?? new Set<string>();
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames ?? (() => {});
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const [layerFilterRows, setLayerFilterRows] = useState<globalThis.Map<string, LayerFilterRow[]>>(() => new Map());
  const [favoriteGroupKeys, setFavoriteGroupKeys] = useState<string[]>(() => loadFavoriteGroupKeys());
  const panelRef = useRef<HTMLDivElement>(null);
  const barWrapperRef = useRef<HTMLDivElement>(null);
  const openedButtonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownLeft, setDropdownLeft] = useState(0);
  const [dropdownTop, setDropdownTop] = useState(0);
  const [dropdownFadeIn, setDropdownFadeIn] = useState(false);

  const toggleFavorite = useCallback((category: string) => {
    setFavoriteGroupKeys((prev) => {
      const next = prev.includes(category)
        ? prev.filter((k) => k !== category)
        : [...prev, category];
      saveFavoriteGroupKeys(next);
      return next;
    });
  }, []);

  const openedList = useMemo(
    () => searchParams.get('opened')?.split(',').filter(Boolean) ?? [],
    [searchParams]
  );
  const layerManagementOpen = openedList.includes(OPENED_LAYER_SETTING);
  const layerGroupIconMap = useMemo(() => getLayerGroupIconMap(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch('/api/config/defineLayer').then((r) => r.json()) as Promise<{
        success?: boolean;
        data?: DefineLayerRow[];
      }>,
      call('', 'POST', {
        service: 'devTestService',
        action: 'getLayerTableList',
        params: {},
      }).then((res: { data?: { success?: boolean; tables?: Array<{ schema: string; table: string }> }; success?: boolean }) => {
        const data = res?.data ?? res;
        const tables = Array.isArray((data as { tables?: unknown[] }).tables)
          ? (data as { tables: Array<{ schema: string; table: string }> }).tables
          : [];
        return new Set(
          tables.filter((t) => t.schema === 'layer').map((t) => t.table)
        );
      }),
    ])
      .then(([defineBody, layerSchemaTableSet]) => {
        if (cancelled) return;
        const list = defineBody?.data ?? [];
        const parentTablesWithSplitDefs = new Set<string>();
        for (const row of list) {
          if (String(row.define_table_schema ?? 'layer').toLowerCase() !== 'layer') continue;
          const p = String(row.define_table_parents_layer ?? '').trim().toLowerCase();
          const divQ = String(row.define_table_div_query ?? '').trim();
          if (p && divQ) parentTablesWithSplitDefs.add(p);
        }
        const filtered = list.filter((row) => {
          const name = String(row.define_table_name ?? '').trim();
          if (!name || !layerSchemaTableSet.has(name)) return false;
          if (parentTablesWithSplitDefs.has(name.toLowerCase())) return false;
          return true;
        });
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const row of filtered) {
          const group = String(row.define_table_group ?? '').trim();
          const key = group || '(미분류)';
          if (!seen.has(key)) {
            seen.add(key);
            ordered.push(key);
          }
        }
        setTableList(filtered);
        setCategories(ordered);
      })
      .catch(() => {
        if (!cancelled) {
          setTableList([]);
          setCategories([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCategoryClick = (category: string) => {
    const namesInGroup = tableList
      .filter((row) => (String(row.define_table_group ?? '').trim() || '(미분류)') === category)
      .map((row) => String(row.define_table_name ?? '').trim())
      .filter(Boolean);
    const anyVisible = namesInGroup.some((n) => visibleLayerNames.has(n));
    const nextSet = new Set(visibleLayerNames);
    if (anyVisible) namesInGroup.forEach((n) => nextSet.delete(n));
    else namesInGroup.forEach((n) => nextSet.add(n));
    setVisibleLayerNames(nextSet);
  };

  const handleLayerFilterRowsChange = useCallback(
    (layerName: string, rows: LayerFilterRow[]) => {
      setLayerFilterRows((prev) => {
        const nextMap = new Map(prev);
        if (rows.length === 0) nextMap.delete(layerName);
        else nextMap.set(layerName, rows);
        return nextMap;
      });
    },
    []
  );

  const closeDropdown = useCallback(() => {
    setDropdownFadeIn(false);
    window.setTimeout(() => setOpenGroupKey(null), 150);
  }, []);

  const switchToGroup = useCallback((category: string) => {
    setDropdownFadeIn(false);
    window.setTimeout(() => setOpenGroupKey(category), 150);
  }, []);

  const handleSettingsClick = (e: React.MouseEvent, category: string) => {
    e.stopPropagation();
    const btn = (e.target as HTMLElement).closest('button');
    openedButtonRef.current = btn ? (btn as HTMLButtonElement) : null;
    if (openGroupKey === category) {
      closeDropdown();
      return;
    }
    if (openGroupKey) {
      switchToGroup(category);
      return;
    }
    setOpenGroupKey(category);
  };

  const serviceLayersForGroup = (groupKey: string): DefineLayerRow[] => {
    return tableList.filter(
      (row) => (String(row.define_table_group ?? '').trim() || '(미분류)') === groupKey
    );
  };

  const activeGroupKeys = useMemo(() => {
    const set = new Set<string>();
    for (const row of tableList) {
      const key = String(row.define_table_group ?? '').trim() || '(미분류)';
      if (visibleLayerNames.has(String(row.define_table_name ?? '').trim())) set.add(key);
    }
    return set;
  }, [tableList, visibleLayerNames]);

  useLayoutEffect(() => {
    if (!openGroupKey || !openedButtonRef.current) {
      setDropdownLeft(0);
      setDropdownTop(0);
      setDropdownFadeIn(false);
      return;
    }
    const br = openedButtonRef.current.getBoundingClientRect();
    setDropdownLeft(br.left);
    setDropdownTop(br.bottom + 8);
    setDropdownFadeIn(false);
    const t = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDropdownFadeIn(true));
    });
    return () => cancelAnimationFrame(t);
  }, [openGroupKey]);

  useEffect(() => {
    const closeOnClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inPanel = panelRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (openGroupKey && !inPanel && !inDropdown) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', closeOnClickOutside);
    return () => document.removeEventListener('mousedown', closeOnClickOutside);
  }, [openGroupKey, closeDropdown]);

  const openLayerManagement = useCallback(() => {
    const next = [...new Set([...openedList, OPENED_LAYER_SETTING])];
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (next.length) params.set('opened', next.join(','));
    else params.delete('opened');
    router.push(`/map?${params.toString()}`);
  }, [openedList, searchParams, router]);

  const closeLayerManagement = useCallback(() => {
    const next = openedList.filter((x) => x !== OPENED_LAYER_SETTING);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (next.length) params.set('opened', next.join(','));
    else params.delete('opened');
    router.push(`/map?${params.toString()}`);
  }, [openedList, searchParams, router]);

  if (loading) return null;
  if (categories.length === 0) return null;

  const layerList = openGroupKey ? serviceLayersForGroup(openGroupKey) : [];
  const displayCategories =
    favoriteGroupKeys.length > 0
      ? categories.filter((c) => favoriteGroupKeys.includes(c))
      : categories;
  const visibleCategories = displayCategories;

  return (
    <div className="relative flex items-start gap-2 min-w-0 w-full" ref={panelRef}>
      {/* 레이어 그룹 버튼: 공간 없으면 두 줄로 줄바꿈, 전체끄기·설정은 항상 노출 */}
      <div className="relative flex flex-wrap items-start gap-2 min-w-0 flex-1 overflow-hidden" ref={barWrapperRef}>
        {visibleCategories.map((category) => {
          const isActive = activeGroupKeys.has(category);
          const iconItem = layerGroupIconMap[category];
          const IconComponent = iconItem?.icon ?? defaultLayerGroupIcon;
          const iconColor = iconItem?.color;
          return (
          <button
            key={category}
            type="button"
            className={cn(
              'group relative flex items-center rounded-[10px] border h-10 pl-3 pr-3 py-1 shrink-0 transition-all duration-200',
              isActive
                ? 'border-2 border-primary bg-white text-primary shadow-md shadow-slate-200/50'
                : 'border-2 border-slate-200 bg-white text-slate-700 shadow-md shadow-slate-200/50 hover:border-slate-300 hover:shadow-lg'
            )}
            aria-label={category}
            aria-pressed={isActive}
            onClick={() => handleCategoryClick(category)}
          >
            <span className="invisible font-medium text-sm whitespace-nowrap pr-8 flex items-center gap-1.5" aria-hidden>
              <span className="w-4 h-4 shrink-0" />
              {category}
            </span>
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 font-medium text-sm whitespace-nowrap transition-transform duration-200 ease-out group-hover:-translate-x-[calc(50%+0.5rem)] group-hover:-translate-y-1/2 text-current">
              <span
                className={cn(
                  'shrink-0 flex items-center justify-center w-4 h-4 [&_svg]:w-full [&_svg]:h-full',
                  isActive && 'text-primary'
                )}
                style={!isActive && iconColor ? { color: iconColor } : undefined}
                aria-hidden
              >
                <IconComponent className="w-4 h-4 shrink-0" />
              </span>
              <span>{category}</span>
            </span>
            <span
              role="button"
              tabIndex={0}
              className={cn(
                'absolute right-[6px] top-1/2 -translate-y-1/2 flex items-center justify-center w-[29px] h-[29px] rounded-full opacity-0 translate-x-2 transition-all duration-200 ease-out group-hover:opacity-100 group-hover:translate-x-0 cursor-pointer',
                isActive ? 'hover:bg-primary/10 text-primary' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
              )}
              aria-label={`${category} 레이어 목록`}
              onClick={(e) => handleSettingsClick(e, category)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSettingsClick(e as unknown as React.MouseEvent, category);
                }
              }}
            >
              <Settings className="w-4 h-4 shrink-0" />
            </span>
          </button>
          );
        })}

        {openGroupKey &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={dropdownRef}
              className={cn(
                'fixed z-[9999] w-[220px] transition-opacity duration-300',
                dropdownFadeIn ? 'opacity-100' : 'opacity-0'
              )}
              style={{ left: dropdownLeft, top: dropdownTop }}
            >
              <div className="overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-lg">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-200 bg-primary/[0.03] px-4 py-1.5">
                  <div className="flex items-center gap-3.5 h-2">
                  </div>
                </div>

                {/* Layer List */}
                <div className="max-h-[360px] overflow-y-auto">
                  {layerList.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-500">레이어 없음</div>
                  ) : (
                    <ul className="divide-y divide-slate-200/50">
                      {layerList.map((row, index) => {
                        const defineTableName = String(row.define_table_name ?? '').trim();
                        const name = String(row.define_table_kor_name ?? '').trim() || defineTableName;
                        const isChecked = visibleLayerNames.has(defineTableName);
                        return (
                          <li
                            key={defineTableName}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              'group flex items-center gap-1.5 px-4 py-[3px] transition-all duration-150 cursor-pointer',
                              isChecked ? 'bg-primary/[0.04]' : 'hover:bg-slate-50'
                            )}
                            onClick={() => {
                              if (visibleLayerNames.has(defineTableName)) return;
                              const nextSet = new Set(visibleLayerNames);
                              nextSet.add(defineTableName);
                              setVisibleLayerNames(nextSet);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (visibleLayerNames.has(defineTableName)) return;
                                const nextSet = new Set(visibleLayerNames);
                                nextSet.add(defineTableName);
                                setVisibleLayerNames(nextSet);
                              }
                            }}
                            style={{ animationDelay: `${index * 30}ms` }}
                          >
                            <span className="w-5 h-5 shrink-0 rounded-full overflow-hidden [background:transparent]">
                              <img
                                src={getLegendGraphicUrl(defineTableName)}
                                alt=""
                                className="w-full h-full object-contain object-center"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            </span>
                            <span
                              className={cn(
                                'flex-1 text-[12px] truncate transition-colors duration-150 min-w-0',
                                isChecked ? 'font-medium text-slate-800' : 'text-slate-600 group-hover:text-slate-800'
                              )}
                            >
                              {name}
                            </span>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                e.stopPropagation();
                                const nextSet = new Set(visibleLayerNames);
                                if (nextSet.has(defineTableName)) nextSet.delete(defineTableName);
                                else nextSet.add(defineTableName);
                                setVisibleLayerNames(nextSet);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 rounded border-slate-300 text-[#0ea5e9] focus:ring-[#0ea5e9] shrink-0"
                              aria-label={name}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-4 py-2">
                  <span className="text-xs text-slate-500">
                    총 {layerList.length}개 레이어
                  </span>
                  {layerList.some((r) => visibleLayerNames.has(String(r.define_table_name ?? '').trim()))}
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>

      <button
        type="button"
        className="flex items-center justify-center w-[30px] h-[30px] rounded-[10px] border border-slate-200 bg-white shadow-lg text-slate-600 hover:bg-slate-50 shrink-0"
        aria-label="모든 레이어 끄기"
        title="모든 레이어 끄기"
        onClick={() => {
          setVisibleLayerNames(new Set());
        }}
      >
        <EyeOff className="w-5 h-5" strokeWidth={2} />
      </button>

      <button
        type="button"
        className="flex items-center justify-center w-10 h-10 rounded-[10px] border border-slate-200 bg-white shadow-lg text-slate-600 hover:bg-slate-50 shrink-0"
        aria-label="설정"
        title="설정"
        onClick={openLayerManagement}
      >
        <Settings className="w-5 h-5" strokeWidth={2} />
      </button>

      {layerManagementOpen && (
        <LayerManagementPanel
          categories={categories}
          tableList={tableList}
          visibleLayerNames={visibleLayerNames}
          onVisibleChange={setVisibleLayerNames}
          onUpdateWms={() => {}}
          layerFilterRows={layerFilterRows}
          onLayerFilterRowsChange={handleLayerFilterRowsChange}
          onClose={closeLayerManagement}
          favoriteGroupKeys={favoriteGroupKeys}
          onFavoriteToggle={toggleFavorite}
        />
      )}
    </div>
  );
}
