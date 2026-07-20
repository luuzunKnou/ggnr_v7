'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { DevFloatingPanel } from './DevFloatingPanel';
import { registerDevVersionHistoryRefresh } from './devVersionHistoryBridge';

type HistoryFilter = 'source_upload_only' | 'source_all' | 'version_all' | 'install_zip' | 'apply_latest';

type HistoryItem = {
  mvhKey: number;
  mvhHistoryType: string;
  mvhStatus: string;
  mvhMessage: string | null;
  mvhOption: string[] | null;
  mvhMemo: string | null;
  mvhIp: string | null;
  mvhClientHost: string | null;
  mvhCreateDate: string | null;
};

type VersionHistoryDialogProps = {
  open: boolean;
  onClose: () => void;
  /** 소스코드: source_all, 버전관리: apply_latest */
  defaultFilter: HistoryFilter;
  /** 소스코드 관리만 기능 구분 select 표시 */
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

const filterControlClass =
  'h-8 rounded border border-input bg-background px-2 text-xs text-foreground [color-scheme:light] dark:[color-scheme:dark]';

export function VersionHistoryDialog({
  open,
  onClose,
  defaultFilter,
  showFeatureFilter = false,
}: VersionHistoryDialogProps) {
  const [filter, setFilter] = useState<HistoryFilter>(defaultFilter);
  const [dateYmd, setDateYmd] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedKey, setExpandedKey] = useState<number | null>(null);
  const filterRef = useRef(filter);
  const dateYmdRef = useRef(dateYmd);
  const qRef = useRef(q);

  filterRef.current = filter;
  dateYmdRef.current = dateYmd;
  qRef.current = q;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const qs = new URLSearchParams({
        filter: toApiHistoryFilter(filterRef.current),
        limit: '50',
      });
      if (dateYmdRef.current.trim()) qs.set('date', dateYmdRef.current.trim());
      if (qRef.current.trim()) qs.set('q', qRef.current.trim());
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
  }, []);

  useEffect(() => {
    if (!open) return;
    setFilter(defaultFilter);
    setDateYmd('');
    setQ('');
    setExpandedKey(null);
    filterRef.current = defaultFilter;
    dateYmdRef.current = '';
    qRef.current = '';
    setError(null);
    void load();
  }, [open, defaultFilter, load]);

  useEffect(() => {
    return registerDevVersionHistoryRefresh(() => {
      if (!open) return;
      void load();
    });
  }, [load, open]);

  return (
    <DevFloatingPanel
      open={open}
      onClose={onClose}
      title="이력"
      width="45rem"
      minHeight="500px"
      maxHeight="500px"
    >
      <div className="flex shrink-0 flex-nowrap items-center gap-2 border-b px-4 py-2 text-xs">
        {showFeatureFilter && (
          <select
            className={`${filterControlClass} shrink-0`}
            value={
              filter === 'source_upload_only'
                ? 'source_upload'
                : filter === 'source_all'
                  ? 'all'
                  : filter === 'install_zip'
                    ? 'install_zip'
                    : 'all'
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'source_upload') setFilter('source_upload_only');
              else if (v === 'install_zip') setFilter('install_zip');
              else setFilter('source_all');
            }}
          >
            <option value="all">전체</option>
            <option value="source_upload">소스코드 업로드</option>
            <option value="install_zip">설치파일 다운로드</option>
          </select>
        )}
        <input
          type="date"
          className={`${filterControlClass} shrink-0`}
          value={dateYmd}
          onChange={(e) => setDateYmd(e.target.value)}
        />
        <input
          type="text"
          className={`${filterControlClass} min-w-0 flex-1`}
          placeholder="통합검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void load();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={loading}
          onClick={() => void load()}
        >
          검색
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={loading}
          onClick={() => {
            setFilter(defaultFilter);
            setDateYmd('');
            setQ('');
            setExpandedKey(null);
            filterRef.current = defaultFilter;
            dateYmdRef.current = '';
            qRef.current = '';
            void load();
          }}
        >
          초기화
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-2 text-xs">
        {loading && <div className="text-muted-foreground">조회 중...</div>}
        {error && <div className="text-red-600 dark:text-red-400">{error}</div>}
        {!loading && !error && !hasSearched && (
          <div className="text-muted-foreground">기능·날짜를 선택한 뒤 «검색»을 눌러 주세요.</div>
        )}
        {!loading && !error && hasSearched && items.length === 0 && (
          <div className="text-muted-foreground">이력이 없습니다.</div>
        )}
        {items.map((row) => {
          const expanded = expandedKey === row.mvhKey;
          return (
            <div key={row.mvhKey} className="mb-1 border-b last:mb-0 last:border-0">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setExpandedKey(expanded ? null : row.mvhKey)}
                aria-expanded={expanded}
              >
                <span className="shrink-0 tabular-nums">{formatDt(row.mvhCreateDate)}</span>
                {showFeatureFilter && (
                  <span className="shrink-0 text-muted-foreground">
                    {historyTypeLabel(row.mvhHistoryType)}
                  </span>
                )}
                <span
                  className={
                    row.mvhStatus === 'success'
                      ? 'shrink-0 text-green-700 dark:text-green-400'
                      : 'shrink-0 text-red-600 dark:text-red-400'
                  }
                >
                  {row.mvhStatus === 'success' ? '성공' : '실패'}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-muted-foreground"
                  title={row.mvhIp ?? row.mvhClientHost ?? ''}
                >
                  {row.mvhIp ?? row.mvhClientHost ?? '-'}
                </span>
                <span className="shrink-0 text-muted-foreground" aria-hidden>
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
              </button>
              {expanded && (
                <div className="space-y-1 pb-2 pl-1 text-muted-foreground">
                  {!showFeatureFilter && (
                    <div>{historyTypeLabel(row.mvhHistoryType)}</div>
                  )}
                  <div className="break-all text-foreground">
                    <span className="text-muted-foreground">선택: </span>
                    {Array.isArray(row.mvhOption) && row.mvhOption.length > 0
                      ? row.mvhOption.join(', ')
                      : '-'}
                  </div>
                  {row.mvhHistoryType === 'source_upload' && (
                    <div className="break-all text-foreground">
                      <span className="text-muted-foreground">메모: </span>
                      {row.mvhMemo?.trim() ? row.mvhMemo.trim() : '-'}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-all text-foreground">
                    <span className="text-muted-foreground">본문: </span>
                    {(row.mvhMessage ?? '').trim() ? row.mvhMessage : '-'}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DevFloatingPanel>
  );
}
