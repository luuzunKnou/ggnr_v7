'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { AttrRow, ConvertStatus, StatusBadgeMode } from './aerialMediaTypes';
import { statusLabel } from './aerialMediaTypes';

export function StatusBadge({
  status,
  mode = 'convert',
}: {
  status: ConvertStatus;
  /** convert: 변환중·변환완료 (정사). upload: 업로드완료 (사진·동영상) */
  mode?: StatusBadgeMode;
}) {
  const tone =
    status === 'done' || status === 'registered'
      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800'
      : status === 'converting'
        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 ring-amber-300 dark:ring-amber-700'
        : 'bg-muted text-muted-foreground ring-border';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap',
        tone
      )}
    >
      {statusLabel(status, mode)}
    </span>
  );
}

const missingGeomTone =
  'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800';

/** 위치 없는 파일. 업로드완료와 같은 둥근 배지 */
export function MissingGeomMark({ onClick }: { onClick?: () => void }) {
  const className = cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap',
    missingGeomTone
  );
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        위치 추가
      </button>
    );
  }
  return <span className={className}>위치 추가</span>;
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="h-3.5 w-1 shrink-0 rounded-full bg-sky-50 dark:bg-sky-950/400" aria-hidden />
      <h3 className="min-w-0 flex-1 text-[11px] font-semibold tracking-wide text-foreground">{children}</h3>
      {action}
    </div>
  );
}

/** 속성정보 — 라벨 열 정렬된 속성표 */
export function AttributeSection({
  title,
  rows,
  emptyText = '표시할 속성이 없습니다.',
  dense = false,
  editable = false,
  editableLabels,
  hiddenLabels,
  onChangeValue,
}: {
  title: string;
  rows: AttrRow[];
  emptyText?: string;
  dense?: boolean;
  editable?: boolean;
  editableLabels?: string[];
  hiddenLabels?: string[];
  onChangeValue?: (index: number, value: string) => void;
}) {
  const visible = rows.filter(
    (row) => row.label !== '좌표계' && !hiddenLabels?.includes(row.label)
  );

  return (
    <section className="mb-4">
      <SectionTitle>{title}</SectionTitle>
      <dl className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        {visible.length === 0 ? (
          <div className="px-3 py-5 text-center text-[11px] text-muted-foreground">{emptyText}</div>
        ) : (
          visible.map((row, i) => (
            <div
              key={`${row.label}-${i}`}
              className={cn(
                'grid gap-x-3 border-b border-border/60 last:border-b-0',
                dense
                  ? 'grid-cols-[6.5rem_minmax(0,1fr)] px-2.5 py-1.5'
                  : 'grid-cols-[7.25rem_minmax(0,1fr)] px-3 py-2.5',
                i % 2 === 1 && 'bg-muted/40'
              )}
            >
              <dt className="shrink-0 text-[10px] font-medium leading-5 text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words text-[11px] leading-5 text-foreground">
                {editable && (!editableLabels || editableLabels.includes(row.label)) ? (
                  <input
                    value={row.value}
                    onChange={(e) => {
                      const srcIdx = rows.indexOf(row);
                      onChangeValue?.(srcIdx >= 0 ? srcIdx : i, e.target.value);
                    }}
                    className="h-6 w-full rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-sky-400"
                  />
                ) : (
                  row.value || '—'
                )}
              </dd>
            </div>
          ))
        )}
      </dl>
    </section>
  );
}

export function MapPlaceholder({
  title = '지도',
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-muted">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-background/70 px-3">
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(to right, #94a3b8 1px, transparent 1px), linear-gradient(to bottom, #94a3b8 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.55)_0%,_transparent_70%)]" />
        <div className="relative z-[1] flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
          {children ?? (
            <div className="rounded-lg border border-border bg-background/80 px-4 py-3 shadow-sm backdrop-blur-sm">
              <p className="text-xs font-medium text-muted-foreground">지도 영역 (목업)</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                실제 타일·뷰어 연동은 백엔드 연결 후 표시됩니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
