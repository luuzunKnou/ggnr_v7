'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BuildingDataSourceLine,
  LandLinkageLegendText,
  ParcelLandLinkageSourceText,
  ParcelLinkageValueText,
} from '@/app/(pages)/map/_mapComponents/parcelLandLinkageUi';
import type { ParcelLandRowSource } from '@/lib/parcelLandNormalize';

export function ComplaintLandTabShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">{children}</div>
    </div>
  );
}

export function CompactSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="text-[11px] font-semibold text-foreground">{title}</p>
      {children}
    </section>
  );
}

export function CompactField({
  label,
  value,
  source,
  action,
}: {
  label: string;
  value: React.ReactNode;
  source?: ParcelLandRowSource;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-1.5">
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-start justify-between gap-1.5">
        <div className="min-w-0 text-[11px] text-foreground break-words">
          {typeof value === 'string' ? (
            <ParcelLinkageValueText value={value} source={source} />
          ) : (
            value
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

export function CompactFieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

export function CompactScrollTable({
  headers,
  rows,
  linkageSource,
}: {
  headers: string[];
  rows: string[][];
  linkageSource?: ParcelLandRowSource;
}) {
  return (
    <div className="overflow-auto rounded border border-border max-h-40">
      <table className="w-full min-w-[280px] table-auto text-[11px]">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="border-b border-r border-border px-2 py-1 text-left font-medium text-foreground last:border-r-0 whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-2 py-3 text-center text-muted-foreground">
                데이터 없음
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={idx} className="odd:bg-background even:bg-muted/30">
                {row.map((cell, cidx) => (
                  <td key={cidx} className="border-b border-r border-border px-2 py-1 last:border-r-0">
                    <ParcelLinkageValueText value={cell} source={linkageSource} />
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

export function CompactLoading({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="flex flex-1 min-h-[120px] items-center justify-center gap-2 text-muted-foreground text-xs">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function CompactEmpty({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-1 min-h-[120px] flex-col items-center justify-center gap-1 p-4 text-center text-muted-foreground',
        className
      )}
    >
      <p className="text-xs font-medium text-foreground/80">{title}</p>
      {description ? <p className="text-[11px]">{description}</p> : null}
    </div>
  );
}

export function CompactLinkageFooter({ source }: { source?: ParcelLandRowSource }) {
  return (
    <div className="mt-3 space-y-1 border-t border-border pt-2">
      {source ? <ParcelLandLinkageSourceText source={source} /> : null}
      <LandLinkageLegendText source={source} />
      <BuildingDataSourceLine className="text-right" sources={[source]} />
    </div>
  );
}
