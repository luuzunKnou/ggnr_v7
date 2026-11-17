'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TablePreview } from './userDataUploadParse';

export type PreviewSummaryItem = {
  label: string;
  value: string;
  warn?: boolean;
};

type Props = {
  summary: PreviewSummaryItem[];
  table: TablePreview | null;
  rowLimit: number;
  loading?: boolean;
  warnings?: string[];
};

/** 등록 전 요약과 속성 앞부분 표 */
export function UserDataUploadPreview({ summary, table, rowLimit, loading, warnings = [] }: Props) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        {summary.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[10.5px] text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                'truncate text-[12px] font-medium',
                item.warn ? 'text-amber-600 dark:text-amber-400' : 'text-foreground/90'
              )}
              title={item.value}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {warnings.map((w) => (
        <p
          key={w}
          className="flex items-start gap-1.5 rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          {w}
        </p>
      ))}

      <div>
        <p className="mb-1.5 text-[11px] font-medium text-foreground/80">
          속성 미리보기
          <span className="ml-1 font-normal text-muted-foreground">
            (앞 {Math.min(rowLimit, table?.rows.length ?? 0)}건 · 컬럼 {table?.columns.length ?? 0}개)
          </span>
        </p>
        {loading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">읽는 중…</p>
        ) : !table || table.columns.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">표시할 속성이 없습니다.</p>
        ) : (
          <div className="max-h-[320px] overflow-auto rounded-md border border-border">
            <table className="w-max min-w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-[1] bg-muted">
                <tr>
                  <th className="border-b border-border px-2 py-1.5 text-right font-medium text-muted-foreground">#</th>
                  {table.columns.map((c) => (
                    <th
                      key={c}
                      className="whitespace-nowrap border-b border-border px-2 py-1.5 text-left font-medium text-foreground/80"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, rowLimit).map((row, i) => (
                  <tr key={i} className="odd:bg-background even:bg-muted/20">
                    <td className="border-b border-border/60 px-2 py-1 text-right text-muted-foreground">{i + 1}</td>
                    {table.columns.map((c, ci) => (
                      <td
                        key={c}
                        className="max-w-[220px] truncate whitespace-nowrap border-b border-border/60 px-2 py-1 text-foreground/90"
                        title={row[ci]}
                      >
                        {row[ci]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
