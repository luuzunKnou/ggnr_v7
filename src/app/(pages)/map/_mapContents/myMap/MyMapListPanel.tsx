'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  MapPinned,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { call } from '@/lib/api';
import { withBasePath } from '@/lib/basePath';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';

export type MyMapLayerRow = {
  tableName: string;
  layerKey: string;
  layerName: string;
  layerGroup: string;
  geomType: string;
  source: 'shp' | 'excel';
  coorStand: string;
};

type Props = {
  onClose: () => void;
  onAdd: () => void;
  selectedTableName: string | null;
  onSelectTableName: (tableName: string | null) => void;
  refreshKey?: number;
};

export function MyMapListPanel({
  onClose,
  onAdd,
  selectedTableName,
  onSelectTableName,
  refreshKey = 0,
}: Props) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [layers, setLayers] = useState<MyMapLayerRow[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyTable, setBusyTable] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'myMapService',
        action: 'listMyLayers',
        params: { q },
      });
      const data = res?.data ?? res;
      setLayers(Array.isArray(data?.layers) ? data.layers : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLayers([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const groups = useMemo(() => {
    const map = new Map<string, MyMapLayerRow[]>();
    for (const layer of layers) {
      const g = layer.layerGroup || '나의지도';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(layer);
    }
    return [...map.entries()];
  }, [layers]);

  const handleDelete = async (tableName: string) => {
    if (!window.confirm('이 레이어를 삭제할까요? 지도·데이터도 함께 제거됩니다.')) return;
    setBusyTable(tableName);
    try {
      await call('', 'POST', {
        service: 'myMapService',
        action: 'deleteMyLayer',
        params: { tableName },
      });
      if (selectedTableName === tableName) onSelectTableName(null);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyTable(null);
    }
  };

  const handleDownload = (tableName: string) => {
    window.open(withBasePath(`/api/myMap/download?tableName=${encodeURIComponent(tableName)}`), '_blank');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MapPinned className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <h2 className="truncate text-sm font-semibold">나의지도</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            레이어 추가
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load();
            }}
            placeholder="그룹·이름 검색"
            className="h-8 pl-7 text-[12px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중…
          </div>
        ) : error ? (
          <p className="px-2 py-6 text-center text-[12px] text-destructive">{error}</p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
            등록된 개인 레이어가 없습니다.
            <br />
            «레이어 추가»로 SHP·Excel을 올려 주세요.
          </p>
        ) : (
          <ul className="space-y-1">
            {groups.map(([group, rows]) => {
              const closed = collapsed[group] === true;
              return (
                <li key={group}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[12px] font-medium hover:bg-muted/60"
                    onClick={() => setCollapsed((p) => ({ ...p, [group]: !closed }))}
                  >
                    {closed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span className="truncate">{group}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{rows.length}</span>
                  </button>
                  {!closed && (
                    <ul className="ml-3 space-y-0.5 border-l border-border/70 pl-2">
                      {rows.map((row) => {
                        const active = selectedTableName === row.tableName;
                        const busy = busyTable === row.tableName;
                        return (
                          <li
                            key={row.tableName}
                            className={cn(
                              'group flex items-center gap-1 rounded px-1.5 py-1 text-[12px]',
                              active ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
                            )}
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left"
                              onClick={() => onSelectTableName(row.tableName)}
                              title={row.tableName}
                            >
                              <span className="block truncate font-medium">{row.layerName}</span>
                              <span className="block truncate text-[10px] text-muted-foreground">
                                {row.source.toUpperCase()} · {row.geomType}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground opacity-70 hover:bg-background hover:opacity-100"
                              title="SHP 받기"
                              onClick={() => handleDownload(row.tableName)}
                              disabled={busy}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground opacity-70 hover:bg-background hover:text-destructive hover:opacity-100"
                              title="삭제"
                              onClick={() => void handleDelete(row.tableName)}
                              disabled={busy}
                            >
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
