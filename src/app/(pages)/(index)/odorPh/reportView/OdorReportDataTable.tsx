'use client'

import { cn } from '@/lib/utils'
import type { ReportTableCol, ReportTableRow } from './odorReportViewMock'

type Props = {
  title: string
  cols: ReportTableCol[]
  rows: ReportTableRow[]
  className?: string
}

export function OdorReportDataTable({ title, cols, rows, className }: Props) {
  return (
    <section
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded border border-border bg-card',
        className
      )}
    >
      <h3 className="shrink-0 border-b border-border px-2.5 py-1.5 text-[12px] font-semibold text-foreground">
        {title}
      </h3>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[480px] border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-1 bg-muted/90 backdrop-blur-sm">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'whitespace-nowrap border-b border-border px-2 py-1.5 font-semibold text-muted-foreground',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center'
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/70 hover:bg-muted/30">
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'whitespace-nowrap px-2 py-1.5 tabular-nums text-foreground',
                      c.align === 'right' && 'text-right',
                      c.align === 'center' && 'text-center'
                    )}
                  >
                    {row[c.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
