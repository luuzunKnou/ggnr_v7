'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileUp,
  FolderOpen,
  Layers,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Switch } from '@/app/shadcnComponents/ui/switch';
import {
  DRAWING_ACCEPT,
  DRAWING_CRS_OPTIONS,
  type DrawingCrsCode,
} from './drawingDisplayConfig';
import type { DrawingDisplayItem } from './drawingDisplayTypes';
import type { DrawingLayerStatus } from './useDrawingDisplayLayer';

type Props = {
  onClose: () => void;
  items: DrawingDisplayItem[];
  statuses: Record<string, DrawingLayerStatus>;
  loading: boolean;
  error: string | null;
  onFiles: (files: FileList | File[] | null) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onCrsChange: (id: string, crs: DrawingCrsCode) => void;
};

const selectClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

function formatUploadDate(iso: string): string {
  const d = iso.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  try {
    const dt = new Date(d);
    if (!Number.isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const mo = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}.${mo}.${day}`;
    }
  } catch {
    /* ignore */
  }
  return d || '—';
}

/** 왼쪽 메뉴 «도면 표시» — 다중 DXF/DWG 목록·on/off (서버 저장) */
export function DrawingDisplayPanel({
  onClose,
  items,
  statuses,
  loading,
  error,
  onFiles,
  onToggleVisible,
  onRemove,
  onClearAll,
  onCrsChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.fileName.toLowerCase().includes(q));
  }, [items, keyword]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
            <Layers className="h-4 w-4 text-primary/80" />
          </div>
          <h2 className="truncate text-[13px] font-semibold leading-none text-foreground">도면 표시</h2>
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="닫기"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border/60 px-3 py-2.5">
        <input
          ref={inputRef}
          type="file"
          accept={DRAWING_ACCEPT}
          multiple
          className="hidden"
          disabled={loading}
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          size="sm"
          className="h-9 w-full gap-1.5 text-xs font-medium"
          disabled={loading}
          onClick={() => inputRef.current?.click()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {loading ? '업로드 중…' : '파일 업로드'}
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="파일명 검색"
            className="h-9 border-border bg-muted/50 pl-8 text-xs focus-visible:bg-background"
          />
        </div>
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        {filtered.length.toLocaleString()}건
        {items.length > 0 ? (
          <button
            type="button"
            className="ml-2 text-primary hover:underline"
            onClick={() => void onClearAll()}
          >
            모두 지우기
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-12 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground/60" aria-hidden />
            <p className="text-xs text-muted-foreground">
              {items.length === 0 ? '등록된 도면이 없습니다.' : '검색 결과가 없습니다.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((item) => {
              const status = statuses[item.id];
              const expanded = expandedId === item.id;
              const resolvingCrs = item.features.length > 0 && !item.mapCrsReady;

              return (
                <li key={item.id} className="rounded-lg border border-border bg-background">
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={expanded ? '접기' : '펼치기'}
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <FileUp className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-foreground" title={item.fileName}>
                        {item.fileName}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        업로드 {formatUploadDate(item.createdAt)}
                        {resolvingCrs || status?.mode === 'preparing' ? ' · 처리 중' : ''}
                      </p>
                    </div>
                    <Switch
                      checked={item.visible}
                      onCheckedChange={(v) => onToggleVisible(item.id, v)}
                      aria-label={`${item.fileName} 표시`}
                    />
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="삭제"
                      onClick={() => void onRemove(item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {expanded ? (
                    <div className="space-y-3 border-t border-border px-3 py-2.5">
                      <div>
                        <span className="mb-1 block text-[11px] font-medium text-foreground/80">좌표계</span>
                        <select
                          className={selectClass}
                          value={item.crs}
                          aria-label={`${item.fileName} 좌표계`}
                          disabled={resolvingCrs}
                          onChange={(e) => onCrsChange(item.id, e.target.value as DrawingCrsCode)}
                        >
                          {DRAWING_CRS_OPTIONS.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.label} · EPSG:{o.code}
                            </option>
                          ))}
                        </select>
                      </div>

                      {status?.outOfKorea ? (
                        <p className="flex gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-100">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          좌표계를 확인하세요.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
