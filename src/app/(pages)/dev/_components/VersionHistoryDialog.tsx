'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';

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

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDt(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ko-KR', { hour12: false });
}

export function VersionHistoryDialog({
  open,
  onClose,
  defaultFilter,
  showFeatureFilter = false,
}: VersionHistoryDialogProps) {
  const [filter, setFilter] = useState<HistoryFilter>(defaultFilter);
  const [dateYmd, setDateYmd] = useState(todayYmd());
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        filter,
        date: dateYmd,
        limit: '50',
      });
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-xl rounded border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">이력</span>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
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
        <div className="max-h-72 overflow-auto px-3 py-2 text-xs">
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
              <div className="text-muted-foreground truncate" title={row.mvhClientHost ?? ''}>
                {row.mvhClientHost ?? row.mvhIp ?? '-'}
              </div>
              <div className="break-all">{row.mvhMessage ?? ''}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
