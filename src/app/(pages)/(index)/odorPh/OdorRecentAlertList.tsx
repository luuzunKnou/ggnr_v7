'use client';

import { ChevronsRight } from 'lucide-react';
import {
  MOCK_RECENT_ALERTS,
  formatAlertTime,
  gradeDotColor,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock';
import { cn } from '@/lib/utils';

type Props = {
  items?: OdorAlertItem[];
  onGoAlertList?: () => void;
};

export function OdorRecentAlertList({ items = MOCK_RECENT_ALERTS, onGoAlertList }: Props) {
  const rows = [...items].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-border p-3">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">최근 경보</h2>
        <button
          type="button"
          title="경보목록"
          onClick={() => onGoAlertList?.()}
          className="inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[12px] font-normal text-muted-foreground hover:text-foreground"
        >
          경보목록
          <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p className="mb-1.5 shrink-0 text-[11px] text-muted-foreground">방금 발생한 악취 경보</p>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <li className="py-6 text-center text-xs text-muted-foreground">최근 경보가 없습니다.</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 transition-colors hover:bg-muted/50"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: gradeDotColor(row.grade) }}
                title={`${row.grade}등급`}
                aria-label={`${row.grade}등급`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{row.sensorKorNm}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {row.sensorNm} · {formatAlertTime(row.occurredAt)} ·{' '}
                  <span
                    className={cn(
                      row.abatementRunning
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {row.abatementRunning ? '저감가동' : '미가동'}
                  </span>
                </div>
              </div>
              <span className="shrink-0 text-[12px] font-semibold tabular-nums text-foreground">
                {row.ppm.toFixed(1)}
                <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">ppm</span>
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
