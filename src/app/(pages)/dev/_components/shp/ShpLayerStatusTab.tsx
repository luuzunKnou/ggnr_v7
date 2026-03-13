'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RefreshCw, Check, X, Search } from 'lucide-react';

type LayerStatusRow = {
  tableName: string;
  korName: string;
  group: string;
  geometryType: 'POINT' | 'LINE' | 'POLYGON' | null;
  shpType: string;
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
  updatedAt: string | null;
};

type Props = {
  relativePath: string;
  onPathChange: (p: string) => void;
};

const GEOM_LABEL: Record<string, string> = { POINT: 'Point', LINE: 'Line', POLYGON: 'Polygon' };
const GEOM_COLOR: Record<string, string> = {
  POINT: 'text-orange-600 dark:text-orange-400',
  LINE: 'text-sky-600 dark:text-sky-400',
  POLYGON: 'text-emerald-600 dark:text-emerald-400',
};

function StepCell({ ok }: { ok: boolean }) {
  return ok ? <Check className="w-3.5 h-3.5 text-green-600 mx-auto" /> : <X className="w-3.5 h-3.5 text-red-400 mx-auto" />;
}

function GeomBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('font-medium text-[10px]', GEOM_COLOR[type] ?? '')}>
      {GEOM_LABEL[type] ?? type}
    </span>
  );
}

export function ShpLayerStatusTab({ relativePath, onPathChange }: Props) {
  const [rows, setRows] = useState<LayerStatusRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'getLayerStatusList',
        params: {},
      });
      const d = res?.data ?? res;
      if (d?.success) {
        setRows(d.rows ?? []);
      } else {
        setError(d?.error ?? '목록을 불러올 수 없습니다.');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const groups = Array.from(new Set(rows.map((r) => r.group).filter(Boolean))).sort();

  const filtered = rows.filter((r) => {
    if (groupFilter && r.group !== groupFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.tableName.toLowerCase().includes(q) || r.korName.toLowerCase().includes(q) || r.group.toLowerCase().includes(q);
    }
    return true;
  });

  const totalCount = rows.length;
  const layerOk = rows.filter((r) => r.layer).length;
  const styleOk = rows.filter((r) => r.style).length;
  const defineOk = rows.filter((r) => r.define).length;

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      {/* toolbar */}
      <div className="shrink-0 flex items-center gap-2">
        <span className="text-sm font-medium whitespace-nowrap">레이어 상태</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          총 {totalCount}개 (Layer {layerOk} / Style {styleOk} / Define {defineOk})
        </span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 pr-2 text-xs border rounded w-40 bg-background"
          />
        </div>
        <Button variant="outline" size="sm" onClick={fetchStatus} className="gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </Button>
      </div>

      {/* group filter */}
      {groups.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1 items-center">
          <button
            type="button"
            onClick={() => setGroupFilter(null)}
            className={cn(
              'px-2 py-0.5 rounded border text-xs',
              groupFilter === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
          >
            전체
          </button>
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupFilter(groupFilter === g ? null : g)}
              className={cn(
                'px-2 py-0.5 rounded border text-xs',
                groupFilter === g ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* table */}
      <section className="flex-1 min-h-0 overflow-auto border rounded">
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">로딩 중…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-xs text-red-500">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {rows.length === 0 ? '레이어가 없습니다.' : '검색 결과가 없습니다.'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-muted-foreground">
                <th className="py-1.5 px-2 text-left w-24">그룹</th>
                <th className="py-1.5 px-2 text-left w-28">테이블명</th>
                <th className="py-1.5 px-2 text-left w-28">한글명</th>
                <th className="py-1.5 px-2 text-center w-16">도형</th>
                <th className="py-1.5 px-2 text-center w-24">최종 업데이트</th>
                <th className="py-1.5 px-2 text-center w-14">Table</th>
                <th className="py-1.5 px-2 text-center w-14">Layer</th>
                <th className="py-1.5 px-2 text-center w-14">Style</th>
                <th className="py-1.5 px-2 text-center w-14">Define</th>
                <th className="py-1.5 px-2 text-left">비고</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.tableName} className="border-t hover:bg-muted/40">
                  <td className="py-1 px-2 truncate max-w-[6rem]" title={row.group}>{row.group || '—'}</td>
                  <td className="py-1 px-2 font-mono truncate max-w-[7rem]" title={row.tableName}>{row.tableName}</td>
                  <td className="py-1 px-2 truncate max-w-[7rem]" title={row.korName}>{row.korName !== row.tableName ? row.korName : ''}</td>
                  <td className="py-1 px-2 text-center"><GeomBadge type={row.geometryType} /></td>
                  <td className="py-1 px-2 text-center whitespace-nowrap text-muted-foreground">{row.updatedAt ?? '—'}</td>
                  <td className="py-1 px-2"><StepCell ok={row.table} /></td>
                  <td className="py-1 px-2"><StepCell ok={row.layer} /></td>
                  <td className="py-1 px-2"><StepCell ok={row.style} /></td>
                  <td className="py-1 px-2"><StepCell ok={row.define} /></td>
                  <td className="py-1 px-2 text-muted-foreground truncate" />

                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* footer count */}
      {filtered.length > 0 && filtered.length !== rows.length && (
        <div className="shrink-0 text-xs text-muted-foreground px-1">
          {filtered.length}건 표시 (전체 {rows.length}건)
        </div>
      )}
    </div>
  );
}
