'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { DevFloatingPanel } from './DevFloatingPanel';
import { registerDevVersionHistoryRefresh } from './devVersionHistoryBridge';

type HistoryFilter = 'source_upload_only' | 'version_all' | 'install_zip' | 'apply_latest';

type HistoryItem = {
  mvhKey: number;
  mvhHistoryType: string;
  mvhStatus: string;
  mvhMessage: string | null;
  mvhIp: string | null;
  mvhClientHost: string | null;
  mvhCreateDate: string | null;
};

type VersionHistoryDialogProps = {
  open: boolean;
  onClose: () => void;
  /** 업로더: source_upload_only, 버전관리: version_all */
  defaultFilter: HistoryFilter;
  showFeatureFilter?: boolean;
};

function historyTypeLabel(type: string): string {
  switch (type) {
    case 'source_upload':
      return '소스코드 업로드';
    case 'install_zip':
      return '설치파일 다운로드';
    case 'apply_latest':
      return '최신 소스 적용';
    default:
      return type;
  }
}

function formatDt(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}.${m}.${day} ${h}:${min}:${s}`;
}

function toApiHistoryFilter(filter: HistoryFilter): string {
  if (filter === 'source_upload_only') return 'source_upload';
  return filter;
}

export function VersionHistoryDialog({
  open,
  onClose,
  defaultFilter,
  showFeatureFilter = false,
}: VersionHistoryDialogProps) {
  const [filter, setFilter] = useState<HistoryFilter>(defaultFilter);
  const [dateYmd, setDateYmd] = useState('');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFilter(defaultFilter);
      setDateYmd('');
    }
  }, [open, defaultFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        filter: toApiHistoryFilter(filter),
        limit: '50',
      });
      if (dateYmd.trim()) qs.set('date', dateYmd.trim());
      const res = await fetch(`/api/dev/version-history?${qs.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as { items?: HistoryItem[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? '조회 실패');
      setItems(json.items ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter, dateYmd]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    return registerDevVersionHistoryRefresh(() => {
      void load();
    });
  }, [load]);

  return (
    <DevFloatingPanel open={open} onClose={onClose} title="이력" minHeight="500px">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        {showFeatureFilter && (
          <select
            className="h-8 rounded border px-2"
            value={filter === 'source_upload_only' ? 'source_upload' : filter}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'all') setFilter('version_all');
              else if (v === 'install_zip' || v === 'apply_latest') setFilter(v);
              else setFilter('version_all');
            }}
          >
            <option value="all">전체</option>
            <option value="install_zip">설치파일 다운로드</option>
            <option value="apply_latest">최신 소스 적용</option>
          </select>
        )}
        <input
          type="date"
          className="h-8 rounded border px-2"
          value={dateYmd}
          onChange={(e) => setDateYmd(e.target.value)}
        />
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          검색
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-2 text-xs">
        {loading && <div className="text-muted-foreground">조회 중...</div>}
        {error && <div className="text-red-600">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="text-muted-foreground">이력이 없습니다.</div>
        )}
        {items.map((row) => (
          <div key={row.mvhKey} className="mb-2 border-b pb-2 last:mb-0 last:border-0">
            <div className="flex flex-wrap gap-2">
              <span>{formatDt(row.mvhCreateDate)}</span>
              {showFeatureFilter && (
                <span className="text-muted-foreground">{historyTypeLabel(row.mvhHistoryType)}</span>
              )}
              <span className={row.mvhStatus === 'success' ? 'text-green-700' : 'text-red-600'}>
                {row.mvhStatus === 'success' ? '성공' : '실패'}
              </span>
            </div>
            <div className="truncate text-muted-foreground" title={row.mvhIp ?? row.mvhClientHost ?? ''}>
              {row.mvhIp ?? row.mvhClientHost ?? '-'}
            </div>
            <div className="whitespace-pre-wrap break-all">{row.mvhMessage ?? ''}</div>
          </div>
        ))}
      </div>
    </DevFloatingPanel>
  );
}
