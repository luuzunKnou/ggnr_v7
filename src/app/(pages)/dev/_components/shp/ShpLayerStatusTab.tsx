'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RefreshCw, Check, X, Search, Download } from 'lucide-react';

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
  dbSchema?: 'layer' | 'public_layer';
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

function RepairableStepCell({
  ok,
  label,
  busy,
  onRepair,
}: {
  ok: boolean;
  label: string;
  busy: boolean;
  onRepair?: () => void;
}) {
  if (ok) return <Check className="w-3.5 h-3.5 text-green-600 mx-auto" />;
  return (
    <button
      type="button"
      className="mx-auto flex h-7 w-7 items-center justify-center rounded-md border border-transparent hover:bg-muted hover:border-border disabled:opacity-40"
      disabled={busy || !onRepair}
      onClick={onRepair}
      title={`${label} 생성 (GeoServer / defineLayer)`}
    >
      <X className="w-3.5 h-3.5 text-red-400" />
    </button>
  );
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
  /** 레이어 상태 목록 DB 스키마: layer(기본) | public_layer만 */
  const [statusSchema, setStatusSchema] = useState<'layer' | 'public_layer'>('layer');
  const [downloadingShp, setDownloadingShp] = useState<string | null>(null);
  const [repairingKey, setRepairingKey] = useState<string | null>(null);
  const repairingRef = useRef(false);

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  const handleShpDownload = useCallback(async (tableName: string, dbSchema: 'layer' | 'public_layer') => {
    if (!tableName?.trim()) return;
    setDownloadingShp(tableName);
    try {
      const res = await fetch('/api/download/shp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName, schema: dbSchema }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.error === 'string' ? data.error : 'SHP export failed');
      }
      const blob = await res.blob();
      triggerBlobDownload(blob, `${tableName}.zip`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'SHP 다운로드 실패');
    } finally {
      setDownloadingShp(null);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'shpUploadService',
        action: 'getLayerStatusList',
        params: { schema: statusSchema },
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
  }, [statusSchema]);

  useEffect(() => {
    setGroupFilter(null);
  }, [statusSchema]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const repairStep = useCallback(
    async (row: LayerStatusRow, step: 'layer' | 'style' | 'define') => {
      const key = `${row.tableName}:${step}`;
      if (repairingRef.current) return;
      repairingRef.current = true;
      setRepairingKey(key);
      try {
        const action =
          step === 'layer'
            ? 'createGeoServerLayerForTableName'
            : step === 'style'
              ? 'createGeoServerStyleForTableName'
              : 'createDefineTableAndFieldsByTableName';
        const res = await call('', 'POST', {
          service: 'shpUploadService',
          action,
          params: {
            tableName: row.tableName,
            dbSchema: row.dbSchema ?? statusSchema,
            geometryType: row.geometryType ?? undefined,
            group: row.group?.trim() ? row.group : undefined,
          },
        });
        const d = res?.data ?? res;
        if (!d?.success) {
          alert(typeof d?.error === 'string' ? d.error : '처리 실패');
          return;
        }
        await fetchStatus();
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : String(e));
      } finally {
        repairingRef.current = false;
        setRepairingKey(null);
      }
    },
    [fetchStatus, statusSchema]
  );

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
          총 {totalCount}개 (Layer {layerOk} / Style {styleOk} / Define {defineOk}) ·{' '}
          <span className="font-mono">{statusSchema}</span>
        </span>
        <div className="flex flex-wrap gap-1 items-center shrink-0">
          <span className="text-[10px] text-muted-foreground mr-0.5">스키마</span>
          <button
            type="button"
            onClick={() => setStatusSchema('layer')}
            className={cn(
              'px-2 py-0.5 rounded border text-xs',
              statusSchema === 'layer' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
          >
            layer
          </button>
          <button
            type="button"
            onClick={() => setStatusSchema('public_layer')}
            className={cn(
              'px-2 py-0.5 rounded border text-xs',
              statusSchema === 'public_layer' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
          >
            public_layer
          </button>
        </div>
        <div className="flex-1 min-w-2" />
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
        <Button type="button" variant="outline" size="sm" onClick={fetchStatus} className="gap-1">
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
                <th className="py-1.5 px-2 text-left min-w-[5rem]">비고</th>
                <th className="py-1.5 px-2 text-center w-24">SHP 다운로드</th>
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
                  <td className="py-1 px-2">
                    <RepairableStepCell
                      ok={row.layer}
                      label="Layer"
                      busy={repairingKey !== null}
                      onRepair={
                        !row.layer
                          ? () => {
                              void repairStep(row, 'layer');
                            }
                          : undefined
                      }
                    />
                  </td>
                  <td className="py-1 px-2">
                    <RepairableStepCell
                      ok={row.style}
                      label="Style"
                      busy={repairingKey !== null}
                      onRepair={
                        !row.style
                          ? () => {
                              void repairStep(row, 'style');
                            }
                          : undefined
                      }
                    />
                  </td>
                  <td className="py-1 px-2">
                    <RepairableStepCell
                      ok={row.define}
                      label="Define"
                      busy={repairingKey !== null}
                      onRepair={
                        !row.define
                          ? () => {
                              void repairStep(row, 'define');
                            }
                          : undefined
                      }
                    />
                  </td>
                  <td className="py-1 px-2 text-muted-foreground truncate" />
                  <td className="py-1 px-2 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 gap-0.5"
                      disabled={!row.table || downloadingShp !== null}
                      onClick={() => handleShpDownload(row.tableName, row.dbSchema ?? 'layer')}
                      title="DB layer 테이블을 EPSG:5181 SHP(zip)로 다운로드"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="text-xs">SHP</span>
                    </Button>
                  </td>
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
