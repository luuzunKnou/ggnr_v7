'use client';

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShapeEditorLayerGroup, ShapeEditorLayerItem } from '../types';
import { shpTypeLabel } from '../_lib/geomUtils';

type ShapeEditorAddLayerDialogProps = {
  open: boolean;
  onClose: () => void;
  layerGroups: ShapeEditorLayerGroup[];
  loading: boolean;
  error: string | null;
  excludeIds: Set<string>;
  onAdd: (layer: ShapeEditorLayerItem) => void;
};

export function ShapeEditorAddLayerDialog({
  open,
  onClose,
  layerGroups,
  loading,
  error,
  excludeIds,
  onAdd,
}: ShapeEditorAddLayerDialogProps) {
  const [query, setQuery] = useState('');

  const flatLayers = useMemo(
    () => layerGroups.flatMap((g) => g.layers.map((l) => ({ ...l, groupName: g.name }))),
    [layerGroups]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = flatLayers.filter((l) => !excludeIds.has(l.id));
    if (q) {
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.tableName.toLowerCase().includes(q) ||
          l.groupName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [flatLayers, excludeIds, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        className="flex max-h-[min(480px,80vh)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        role="dialog"
        aria-labelledby="add-layer-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="add-layer-title" className="text-sm font-semibold text-foreground">
            레이어 추가
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted/50"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="레이어 검색"
              className="w-full rounded-md border border-border py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {loading ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">불러오는 중…</li>
          ) : error ? (
            <li className="px-4 py-6 text-center text-sm text-red-600">{error}</li>
          ) : filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">추가할 레이어가 없습니다</li>
          ) : (
            filtered.map((layer) => (
              <li key={layer.id}>
                <button
                  type="button"
                  onClick={() => onAdd(layer)}
                  className={cn(
                    'flex w-full flex-col px-4 py-2.5 text-left hover:bg-muted/50',
                    'border-b border-border/50 last:border-0'
                  )}
                >
                  <span className="text-sm font-medium text-foreground">{layer.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {layer.groupName} · {layer.tableName} · {shpTypeLabel(layer.shpType)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
