'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MapSideDetailScroll } from '../../_mapComponents/MapSideDetailScroll';

type Props = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  /** 접혀 있어도 헤더 오른쪽에 표시 */
  headerActions?: ReactNode;
};

/** 속성정보·추가속성 — 보상편입용지 속성정보 접기와 같은 머리줄 */
export function OccupationLedgerDetailSection({
  title,
  defaultOpen = true,
  children,
  className,
  headerActions,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={cn('shrink-0', className)}>
      <div className="-mx-1 mb-1 flex min-h-8 items-center gap-1 py-0.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="standard-detail-section-toggle"
          title={open ? `${title} 접기` : `${title} 펼치기`}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="standard-detail-section-chevron" />
          ) : (
            <ChevronRight className="standard-detail-section-chevron" />
          )}
          <span className="standard-detail-section-toggle-label">{title}</span>
        </button>
        {headerActions ? (
          <div className="standard-detail-section-header-actions ml-auto min-w-0">
            {headerActions}
          </div>
        ) : null}
      </div>
      {open ? (
        <MapSideDetailScroll className="max-h-[42vh]">{children}</MapSideDetailScroll>
      ) : null}
    </section>
  );
}
