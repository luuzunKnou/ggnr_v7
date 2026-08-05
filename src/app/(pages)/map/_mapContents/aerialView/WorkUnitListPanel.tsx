'use client';

import type { ReactNode } from 'react';
import { RefreshCw, Upload, Search, CalendarDays, FolderOpen, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';
import type { ConvertStatus, WorkUnitItem } from './aerialMediaTypes';
import { deriveOrthoUnitStatus } from './aerialMediaTypes';
import { StatusBadge } from './AerialMediaUi';

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
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (v: string) => void;
  onDateToChange?: (v: string) => void;
  banner?: ReactNode;
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
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  banner,
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
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* 헤더 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-slate-800">{title}</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">{filtered.length}건</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="새로고침"
          aria-label="새로고침"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* 도구 */}
      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2.5">
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

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="작업명 · 작업일 검색"
            className="h-9 border-slate-200 bg-slate-50/80 pl-8 text-xs focus-visible:bg-white"
          />
        </div>

        {showDateFilter ? (
          <div className="rounded-md border border-slate-200 bg-slate-50/60 px-2.5 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
              <CalendarDays className="h-3 w-3" />
              작업일 기간
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={dateFrom ?? ''}
                onChange={(e) => onDateFromChange?.(e.target.value)}
                className="h-8 min-w-0 flex-1 border-slate-200 bg-white px-1.5 text-[11px]"
              />
              <span className="shrink-0 text-[10px] text-slate-400">~</span>
              <Input
                type="date"
                value={dateTo ?? ''}
                onChange={(e) => onDateToChange?.(e.target.value)}
                className="h-8 min-w-0 flex-1 border-slate-200 bg-white px-1.5 text-[11px]"
              />
            </div>
          </div>
        ) : null}

        {banner}
      </div>

      {/* 목록 — 카드형 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-12 text-center">
            <FolderOpen className="h-8 w-8 text-slate-300" aria-hidden />
            <p className="text-xs text-slate-400">검색 결과가 없습니다.</p>
            <p className="text-[10px] text-slate-400">{emptyHint}</p>
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
                        ? 'border-sky-300 bg-sky-50 shadow-sm ring-1 ring-sky-200/80'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                            selected ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          {showStatus ? `${dateLabel}년` : dateLabel}
                        </span>
                        {uploadDateLabel ? (
                          <span
                            className={cn(
                              'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] tabular-nums',
                              selected
                                ? 'bg-white text-sky-700 ring-1 ring-sky-200'
                                : 'bg-white text-slate-500 ring-1 ring-slate-200'
                            )}
                          >
                            {uploadDateLabel}
                          </span>
                        ) : null}
                      </div>
                      {convertStatus ? <StatusBadge status={convertStatus} mode="convert" /> : null}
                    </div>
                    <p
                      className={cn(
                        'mt-1 truncate text-[12px] leading-snug',
                        selected ? 'font-semibold text-sky-950' : 'font-medium text-slate-800'
                      )}
                      title={row.workName}
                    >
                      {row.workName}
                      {author ? (
                        <span className="font-normal text-slate-400">{` · ${author}`}</span>
                      ) : null}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-3 py-1.5 text-[10px] text-slate-400">
        목업 데이터 · 실저장 연동 전
      </div>
    </div>
  );
}
