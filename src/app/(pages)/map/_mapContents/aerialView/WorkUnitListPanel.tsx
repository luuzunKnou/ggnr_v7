'use client';

import type { ReactNode } from 'react';
import { RefreshCw, Upload, Search, CalendarDays, FolderOpen, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import type { ConvertStatus, WorkUnitItem } from './aerialMediaTypes';
import { deriveOrthoUnitStatus } from './aerialMediaTypes';
import { fileMissingGeom } from './aerialLocationParse';
import { MissingGeomMark, StatusBadge } from './AerialMediaUi';
import { AerialPipelineStatus } from './AerialPipelineStatus';
import { DroneDropFolderHint } from './DroneDropFolderHint';

type Props = {
  title: string;
  items: WorkUnitItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  keyword: string;
  onKeywordChange: (v: string) => void;
  onRefresh: () => void;
  /** 없으면 폴더 업로드 버튼 숨김 (조회전용) */
  onUpload?: () => void;
  /** 사이드바 종류 분리 시 목록 헤더 닫기 */
  onClose?: () => void;
  showStatus?: boolean;
  /** 드론영상(정사): 변환중·변환완료 배지 */
  showConvertStatus?: boolean;
  /** 사진·동영상: 위치 없는 파일이 있으면 목록 오른쪽에 표시 */
  showMissingGeom?: boolean;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (v: string) => void;
  onDateToChange?: (v: string) => void;
  banner?: ReactNode;
  /** 검색·업로드 아래 추가 도구 (예: 고화질 제한) */
  toolsExtra?: ReactNode;
  /** 사진·동영상·항공뷰: 자료 폴더에 넣는 방법 */
  showDropFolderHint?: boolean;
  dropFolderKind?: 'drone' | 'panorama' | 'ortho';
  emptyHint?: string;
};

function formatListDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

function formatYear(iso: string): string {
  return iso.slice(0, 4) || iso;
}

function getUploadDate(unit: WorkUnitItem): string {
  if (unit.uploadedAt) return unit.uploadedAt;
  return unit.attrs.find((a) => a.label === '업로드일')?.value || unit.workDate;
}

/** 작성자 값 추출 */
function getAuthor(unit: WorkUnitItem): string | null {
  return unit.attrs.find((a) => a.label === '작성자')?.value ?? null;
}

export function WorkUnitListPanel({
  title,
  items,
  selectedId,
  onSelect,
  keyword,
  onKeywordChange,
  onRefresh,
  onUpload,
  onClose,
  showStatus = false,
  showConvertStatus = false,
  showMissingGeom = false,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  banner,
  toolsExtra,
  showDropFolderHint = false,
  dropFolderKind = 'drone',
  emptyHint = '폴더를 업로드하거나 검색어를 바꿔 보세요.',
}: Props) {
  const filtered = items.filter((u) => {
    const q = keyword.trim().toLowerCase();
    if (q && !u.workName.toLowerCase().includes(q) && !u.workDate.includes(q)) return false;
    if (dateFrom && u.workDate < dateFrom) return false;
    if (dateTo && u.workDate > dateTo) return false;
    return true;
  });

  const showDateFilter = Boolean(onDateFromChange && onDateToChange);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold leading-none text-foreground">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="새로고침"
          aria-label="새로고침"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* 도구 */}
      <div className="shrink-0 space-y-2 border-b border-border/60 px-3 py-2.5">
        {onUpload ? (
          <Button
            type="button"
            size="sm"
            className="h-9 w-full gap-1.5 text-xs font-medium"
            onClick={onUpload}
          >
            <Upload className="h-3.5 w-3.5" />
            폴더 업로드
          </Button>
        ) : null}

        {onUpload && showDropFolderHint ? <DroneDropFolderHint kind={dropFolderKind} /> : null}
        {showDropFolderHint ? <AerialPipelineStatus /> : null}

        {toolsExtra}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="작업명 · 작업일 검색"
            className="h-9 border-border bg-muted/50 pl-8 text-xs focus-visible:bg-background"
          />
        </div>

        {showDateFilter ? (
          <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              작업일 기간
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={dateFrom ?? ''}
                onChange={(e) => onDateFromChange?.(e.target.value)}
                className="h-8 min-w-0 flex-1 border-border bg-background px-1.5 text-[11px] [color-scheme:light] dark:[color-scheme:dark]"
              />
              <span className="shrink-0 text-[10px] text-muted-foreground">~</span>
              <Input
                type="date"
                value={dateTo ?? ''}
                onChange={(e) => onDateToChange?.(e.target.value)}
                className="h-8 min-w-0 flex-1 border-border bg-background px-1.5 text-[11px] [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
          </div>
        ) : null}

        {banner}
      </div>

      <div className="shrink-0 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        {filtered.length.toLocaleString()}건
      </div>

      {/* 목록 — 카드형 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-12 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground/60" aria-hidden />
            <p className="text-xs text-muted-foreground">검색 결과가 없습니다.</p>
            <p className="text-[10px] text-muted-foreground">{emptyHint}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((row) => {
              const selected = row.id === selectedId;
              const author = getAuthor(row);
              const uploadDateLabel = showStatus
                ? `업로드 ${formatListDate(getUploadDate(row))}`
                : null;
              const dateLabel = showStatus
                ? formatYear(row.workDate)
                : formatListDate(row.workDate);
              const convertStatus: ConvertStatus | null = showConvertStatus
                ? (row.status ?? deriveOrthoUnitStatus(row.files))
                : row.status && showStatus
                  ? (row.status as ConvertStatus)
                  : null;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-sky-300 bg-sky-50 shadow-sm ring-1 ring-sky-200 dark:border-sky-800 dark:bg-sky-950/40 dark:ring-sky-800/80'
                        : 'border-border bg-background hover:border-border hover:bg-muted/60'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                        <span
                          className={cn(
                            'inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium tabular-nums',
                            selected ? 'bg-sky-100 dark:bg-sky-950/50 text-sky-800 dark:text-sky-200' : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {showStatus ? `${dateLabel}년` : dateLabel}
                        </span>
                        {uploadDateLabel ? (
                          <span
                            className={cn(
                              'inline-flex h-5 items-center rounded px-1.5 text-[10px] tabular-nums',
                              selected
                                ? 'bg-background text-sky-700 dark:text-sky-300 ring-1 ring-sky-200 dark:ring-sky-800'
                                : 'bg-background text-muted-foreground ring-1 ring-border'
                            )}
                          >
                            {uploadDateLabel}
                          </span>
                        ) : null}
                      </div>
                      {showMissingGeom && row.files.some((file) => fileMissingGeom(file)) ? (
                        <MissingGeomMark />
                      ) : convertStatus ? (
                        <div className="shrink-0">
                          <StatusBadge status={convertStatus} mode="convert" />
                        </div>
                      ) : null}
                    </div>
                    <p
                      className={cn(
                        'mt-1 truncate text-[12px] leading-snug',
                        selected ? 'font-semibold text-sky-950 dark:text-sky-100' : 'font-medium text-foreground'
                      )}
                      title={row.workName}
                    >
                      {row.workName}
                      {author ? (
                        <span className="font-normal text-muted-foreground">{` · ${author}`}</span>
                      ) : null}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
