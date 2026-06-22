'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShapeEditorLayerGroup, ShapeEditorLayerItem } from '../types';
import { shpTypeLabel } from '../_lib/geomUtils';

type ShapeEditorLayerSelectProps = {
  layerGroups: ShapeEditorLayerGroup[];
  loading: boolean;
  error: string | null;
  activeLayer: ShapeEditorLayerItem | null;
  onSelectLayer: (layer: ShapeEditorLayerItem) => void;
};

export function ShapeEditorLayerSelect({
  layerGroups,
  loading,
  error,
  activeLayer,
  onSelectLayer,
}: ShapeEditorLayerSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const flatLayers = useMemo(
    () => layerGroups.flatMap((g) => g.layers.map((l) => ({ ...l, groupName: g.name }))),
    [layerGroups]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatLayers;
    return flatLayers.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.tableName.toLowerCase().includes(q) ||
        l.groupName.toLowerCase().includes(q)
    );
  }, [flatLayers, query]);

  const handleSelect = (layer: ShapeEditorLayerItem) => {
    onSelectLayer(layer);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative min-w-[200px] max-w-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border px-3 text-left text-sm transition-colors',
          activeLayer
            ? 'border-blue-200 bg-blue-50 text-blue-900'
            : 'border-amber-300 bg-amber-50 text-amber-900',
          open && 'ring-2 ring-blue-400/40'
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {loading
            ? '레이어 불러오는 중…'
            : activeLayer
              ? activeLayer.name
              : '편집 레이어 선택'}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="닫기"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-50 mt-1 flex w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
            <div className="border-b border-slate-100 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="레이어 검색"
                  className="w-full rounded border border-slate-200 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-blue-400"
                />
              </div>
            </div>
            <ul className="max-h-64 overflow-y-auto py-1">
              {error ? (
                <li className="px-3 py-2 text-xs text-red-600">{error}</li>
              ) : filtered.length === 0 ? (
                <li className="px-3 py-2 text-xs text-slate-500">검색 결과 없음</li>
              ) : (
                filtered.map((layer) => (
                  <li key={layer.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(layer)}
                      className={cn(
                        'flex w-full flex-col px-3 py-2 text-left text-xs hover:bg-slate-50',
                        activeLayer?.id === layer.id && 'bg-blue-50'
                      )}
                    >
                      <span className="font-medium text-slate-800">{layer.name}</span>
                      <span className="text-[10px] text-slate-400">
                        {layer.groupName} · {layer.tableName} · {shpTypeLabel(layer.shpType)}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
