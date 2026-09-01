'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  PANEL_DETAIL_LABEL_CELL,
  PANEL_DETAIL_VALUE_CELL,
} from '../panelDetailTableStyles';

const CELL_BORDER = 'border-b border-border';

export function DetailAttrSectionTitle({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-[11px] font-medium text-muted-foreground">{children}</div>;
}

export function DetailAttrTable({
  children,
  empty,
}: {
  children?: ReactNode;
  empty?: ReactNode;
}) {
  if (empty) {
    return (
      <div className="overflow-hidden rounded border border-border px-2.5 py-3 text-[11px] text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[max-content_minmax(0,1fr)] overflow-hidden rounded border border-border">
      {children}
    </div>
  );
}

export function DetailAttrRow({
  label,
  children,
  isLast = false,
  required = false,
  valueClassName,
}: {
  label: ReactNode;
  children: ReactNode;
  isLast?: boolean;
  required?: boolean;
  valueClassName?: string;
}) {
  const edge = isLast ? '' : CELL_BORDER;
  return (
    <div className="contents">
      <div
        className={cn(
          'whitespace-nowrap border-r border-border',
          PANEL_DETAIL_LABEL_CELL,
          edge
        )}
      >
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </div>
      <div
        className={cn('break-all', PANEL_DETAIL_VALUE_CELL, edge, valueClassName)}
      >
        {children}
      </div>
    </div>
  );
}
