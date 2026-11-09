'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

type Props = {
  title: string;
  count: number;
  /** 제목 줄 오른쪽 (예: 수정 중 «추가») — 접혀 있어도 보인다 */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * 필지목록·물건지목록·점사용료 이력 묶음 — «제목 (건수)» 머리, 0건이면 접힌 채 시작.
 * 건을 바꿀 때 상태가 다시 시작되도록 부모에서 key로 건 키를 준다.
 */
export function OccupationLedgerCollapsibleSection({ title, count, actions, children }: Props) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? count > 0;

  return (
    <section className="mt-3">
      <div className="-mx-1 mb-1 flex min-h-7 items-center gap-1">
        <button
          type="button"
          onClick={() => setUserOpen(!open)}
          className="standard-detail-section-toggle"
          title={open ? `${title} 접기` : `${title} 펼치기`}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="standard-detail-section-chevron" />
          ) : (
            <ChevronRight className="standard-detail-section-chevron" />
          )}
          <span className="standard-detail-section-toggle-label">
            {title} ({count.toLocaleString()})
          </span>
        </button>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {open ? children : null}
    </section>
  );
}
