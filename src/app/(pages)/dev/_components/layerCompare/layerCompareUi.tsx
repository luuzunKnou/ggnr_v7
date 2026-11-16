'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 식별값 — 끝 `.0000` 정리 */
export function formatCompareId(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '—';
  if (/^-?\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  if (/^-?\d+\.\d*0+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && Number.isInteger(n)) return String(n);
  }
  return s;
}

export function CompareSplit(props: {
  left: ReactNode;
  right: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-1 overflow-hidden rounded-lg border border-border bg-background',
        props.className
      )}
    >
      <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-b border-border lg:w-[48%] lg:min-w-[22rem] lg:max-w-[34rem] lg:border-r lg:border-b-0">
        {props.left}
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {props.right}
      </main>
    </div>
  );
}

export function ComparePane(props: {
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', props.className)}>
      {props.toolbar ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          {props.toolbar}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3">
        {props.children}
      </div>
      {props.footer ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
          {props.footer}
        </div>
      ) : null}
    </div>
  );
}

export function SectionBox(props: {
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  fill?: boolean;
  scrollBody?: boolean;
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-md border border-border bg-card',
        props.fill && 'flex min-h-0 flex-1 flex-col',
        props.className
      )}
    >
      <div className="shrink-0 border-b border-border bg-sky-50/45 px-3 py-2 dark:bg-sky-950/20">
        <h3 className="text-sm font-normal text-foreground">{props.title}</h3>
      </div>
      <div
        className={cn(
          'p-3 text-sm',
          props.fill && 'min-h-0 flex-1',
          props.scrollBody ? 'overflow-auto' : 'overflow-hidden',
          props.bodyClassName
        )}
      >
        {props.children}
      </div>
    </section>
  );
}

export function FieldLabel(props: { children: ReactNode }) {
  return <div className="mb-1 text-sm font-normal text-foreground">{props.children}</div>;
}

export function StatTile(props: {
  label: string;
  value: string | number;
  detail?: string;
  /** 다름만 강조 */
  diff?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2',
        props.diff
          ? 'border-rose-200/50 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/15'
          : 'border-primary/25 bg-primary/4'
      )}
    >
      <div className="text-sm font-normal text-foreground">{props.label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">
        {props.value}
      </div>
      {props.detail ? (
        <div className="mt-0.5 text-sm font-normal text-foreground">{props.detail}</div>
      ) : null}
    </div>
  );
}

export const controlClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50';

/** 엑셀형 표 — 헤더 회색, 내용 길이에 맞춰 가로 확장 */
export function SheetTable(props: {
  columns: {
    key: string;
    label: string;
    className?: string;
    diffCol?: boolean;
    /** 긴 값은 줄바꿈, 아니면 내용만큼 가로 확장 */
    wrap?: boolean;
  }[];
  rows: Record<string, ReactNode>[];
  empty?: string;
  className?: string;
}) {
  return (
    <div className={cn('overflow-auto', props.className)}>
      <table className="w-max min-w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {props.columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'border border-border bg-muted px-2.5 py-1.5 text-sm font-normal whitespace-nowrap text-foreground',
                  c.className
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.length === 0 ? (
            <tr>
              <td
                colSpan={props.columns.length}
                className="border border-border px-2.5 py-8 text-center text-sm text-foreground"
              >
                {props.empty ?? '데이터 없음'}
              </td>
            </tr>
          ) : (
            props.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/15'}>
                {props.columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'border border-border px-2.5 py-1.5 align-top text-sm text-foreground',
                      c.wrap ? 'max-w-[18rem] break-all whitespace-normal' : 'whitespace-nowrap',
                      c.diffCol && 'bg-rose-50/50 dark:bg-rose-950/15',
                      c.className
                    )}
                  >
                    {row[c.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
