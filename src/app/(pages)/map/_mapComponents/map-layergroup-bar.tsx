'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, MoreHorizontal } from 'lucide-react';
import { useMapContext } from './MapContext';
import { LayerManagementPanel } from './LayerManagementPanel';
import { cn } from '@/lib/utils';
import { WORKSPACE } from './serviceLayerFactory';

const MAX_VISIBLE_GROUPS = 8;

export type LayerFilterRow = { field: string; value: string };

function filterRowsToCql(rows: LayerFilterRow[]): string {
  const valid = rows.filter((r) => String(r.field).trim() && String(r.value).trim());
  if (valid.length === 0) return 'INCLUDE';
  const escaped = valid.map((r) => {
    const v = String(r.value).replace(/'/g, "''");
    return `${String(r.field).trim()}='${v}'`;
  });
  return escaped.join(' AND ');
}

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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [layerFilterRows, setLayerFilterRows] = useState<Map<string, LayerFilterRow[]>>(() => new Map());
  const panelRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

  const openedList = useMemo(
    () => searchParams.get('opened')?.split(',').filter(Boolean) ?? [],
    [searchParams]
  );
  const layerManagementOpen = openedList.includes(OPENED_LAYER_SETTING);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/config/defineLayer')
      .then((r) => r.json())
      .then((body: { success?: boolean; data?: DefineLayerRow[] }) => {
        if (cancelled) return;
        const list = body?.data ?? [];
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const row of list) {
          const group = String(row.define_table_group ?? '').trim();
          const key = group || '(미분류)';
          if (!seen.has(key)) {
            seen.add(key);
            ordered.push(key);
          }
        }
        setTableList(list);
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

  const updateWmsParams = useCallback(
    (visibleNames: Set<string>, filterRowsMap?: Map<string, LayerFilterRow[]>) => {
      const map = mapRef?.current;
      if (!map) return;
      const serviceLayer = map.getLayers().getArray().find((l) => l.get('serviceLayer')) as
        | {
            getSource(): {
              getParams(): { LAYERS?: string; STYLES?: string; CQL_FILTER?: string };
              changed(): void;
            };
            setVisible(v: boolean): void;
          }
        | undefined;
      if (!serviceLayer) return;
      const source = serviceLayer.getSource();
      if (!source) return;
      const params = source.getParams();
      if (!params) return;
      if (visibleNames.size === 0) {
        params.LAYERS = '';
        params.STYLES = '';
        delete params.CQL_FILTER;
        serviceLayer.setVisible(false);
      } else {
        const names = Array.from(visibleNames);
        params.LAYERS = names.map((n) => `${WORKSPACE}:${n}`).join(',');
        params.STYLES = names.join(',');
        const cqlArr = names.map((n) =>
          filterRowsToCql(filterRowsMap?.get(n) ?? [])
        );
        params.CQL_FILTER = cqlArr.join(';');
        serviceLayer.setVisible(true);
        source.changed();
      }
    },
    [mapRef]
  );

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
    updateWmsParams(nextSet, layerFilterRows);
  };

  const handleLayerFilterRowsChange = useCallback(
    (layerName: string, rows: LayerFilterRow[]) => {
      setLayerFilterRows((prev) => {
        const nextMap = new Map(prev);
        if (rows.length === 0) nextMap.delete(layerName);
        else nextMap.set(layerName, rows);
        updateWmsParams(visibleLayerNames, nextMap);
        return nextMap;
      });
    },
    [visibleLayerNames, updateWmsParams]
  );

  const handleSettingsClick = (e: React.MouseEvent, category: string) => {
    e.stopPropagation();
    setOpenGroupKey((prev) => (prev === category ? null : category));
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

  useEffect(() => {
    const closeOnClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (openGroupKey && panelRef.current && !panelRef.current.contains(target)) {
        setOpenGroupKey(null);
      }
      if (overflowOpen && overflowRef.current && !overflowRef.current.contains(target)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnClickOutside);
    return () => document.removeEventListener('mousedown', closeOnClickOutside);
  }, [openGroupKey, overflowOpen]);

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
  const visibleCategories = categories.slice(0, MAX_VISIBLE_GROUPS);
  const overflowCategories = categories.slice(MAX_VISIBLE_GROUPS);

  return (
    <div className="relative flex items-center gap-2 flex-nowrap" ref={panelRef}>
      {visibleCategories.map((category) => {
        const isActive = activeGroupKeys.has(category);
        return (
        <button
          key={category}
          type="button"
          className={cn(
            'group relative flex items-center rounded-full border shadow-lg h-10 pl-4 pr-3 py-1 shrink-0',
            isActive
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-slate-200 bg-white text-slate-700'
          )}
          aria-label={category}
          aria-pressed={isActive}
          onClick={() => handleCategoryClick(category)}
        >
          <span className="invisible font-medium text-sm whitespace-nowrap pr-8" aria-hidden>
            {category}
          </span>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-medium text-sm whitespace-nowrap transition-transform duration-200 ease-out group-hover:-translate-x-[calc(50%+0.5rem)] group-hover:-translate-y-1/2">
            {category}
          </span>
          <span
            role="button"
            tabIndex={0}
            className={cn(
              'absolute right-[6px] top-1/2 -translate-y-1/2 flex items-center justify-center w-[29px] h-[29px] rounded-full opacity-0 translate-x-2 transition-all duration-200 ease-out group-hover:opacity-100 group-hover:translate-x-0 cursor-pointer',
              isActive ? 'hover:bg-primary-foreground/20 text-primary-foreground' : 'hover:bg-primary/10 text-primary hover:text-primary/80'
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

      <button
        type="button"
        className="flex items-center justify-center w-10 h-10 rounded-full border border-slate-200 bg-white shadow-lg text-slate-600 hover:bg-slate-50 shrink-0"
        aria-label="설정"
        title="설정"
        onClick={openLayerManagement}
      >
        <Settings className="w-5 h-5" strokeWidth={2} />
      </button>

      {overflowCategories.length > 0 && (
        <div className="relative shrink-0" ref={overflowRef}>
          <button
            type="button"
            className="flex items-center justify-center w-10 h-10 rounded-full border border-slate-200 bg-white shadow-lg text-slate-600 hover:bg-slate-50"
            aria-label="더보기"
            onClick={() => setOverflowOpen((v) => !v)}
          >
            <MoreHorizontal className="w-5 h-5" strokeWidth={2} />
          </button>
          {overflowOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] max-h-[280px] overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
              {overflowCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm hover:bg-slate-100',
                    activeGroupKeys.has(category) ? 'text-primary-foreground font-medium bg-primary' : 'text-slate-700'
                  )}
                  onClick={() => {
                    handleCategoryClick(category);
                    setOverflowOpen(false);
                  }}
                >
                  {category}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {layerManagementOpen && (
        <LayerManagementPanel
          categories={categories}
          tableList={tableList}
          visibleLayerNames={visibleLayerNames}
          onVisibleChange={setVisibleLayerNames}
          onUpdateWms={(nextSet) => updateWmsParams(nextSet, layerFilterRows)}
          layerFilterRows={layerFilterRows}
          onLayerFilterRowsChange={handleLayerFilterRowsChange}
          onClose={closeLayerManagement}
        />
      )}

      {openGroupKey && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[200px] max-h-[320px] overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg py-2">
          <div className="px-3 py-1.5 text-xs font-medium text-slate-500 border-b border-slate-100">
            {openGroupKey}
          </div>
          <ul className="py-1">
            {layerList.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500">레이어 없음</li>
            ) : (
              layerList.map((row) => {
                const defineTableName = String(row.define_table_name ?? '').trim();
                const name = String(row.define_table_kor_name ?? '').trim() || defineTableName;
                const visible = visibleLayerNames.has(defineTableName);
                return (
                  <li key={defineTableName} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => {
                        const nextSet = new Set(visibleLayerNames);
                        if (nextSet.has(defineTableName)) nextSet.delete(defineTableName);
                        else nextSet.add(defineTableName);
                        setVisibleLayerNames(nextSet);
                        updateWmsParams(nextSet, layerFilterRows);
                      }}
                      className="rounded border-slate-300 shrink-0"
                    />
                    <span className="text-sm truncate">{name}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
