'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/api';

type PreviewRow = {
  noticeKey?: number;
  boardKey?: number;
  noticeTitle?: string;
  boardTitle?: string;
  noticeIsActive?: boolean;
  noticeStartDate?: string | null;
  noticeEndDate?: string | null;
  dateLabel: string;
};

/** listActivePopups 와 동일 — 공지여부 + 기간 내 */
function isNoticePopupActive(row: PreviewRow): boolean {
  if (!row.noticeIsActive) return false;
  const start = row.noticeStartDate ? Date.parse(row.noticeStartDate) : NaN;
  const end = row.noticeEndDate ? Date.parse(row.noticeEndDate) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const now = Date.now();
  return start <= now && end >= now;
}

type PreviewCardProps = {
  title: string;
  listPath: string;
  service: string;
  linkPrefix: string;
  titleField: 'noticeTitle' | 'boardTitle';
  keyField: 'noticeKey' | 'boardKey';
  showActivePopupBadge?: boolean;
};

function PreviewCard(props: PreviewCardProps) {
  const { title, listPath, service, linkPrefix, titleField, keyField, showActivePopupBadge } =
    props;
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void call('', 'POST', {
      service,
      action: 'list',
      params: { limit: 5, offset: 0 },
    })
      .then((res) => {
        const data = (res.data ?? {}) as { rows?: PreviewRow[] };
        if (!cancelled) setRows(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  return (
    <div className="bg-card border border-border p-5 flex-1 rounded-[5px] flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-border shrink-0">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <Link
          href={listPath}
          className="text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
        >
          전체보기
        </Link>
      </div>
      <ul className="space-y-3 flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <li className="text-sm text-muted-foreground">불러오는 중…</li>
        ) : rows.length === 0 ? (
          <li className="text-sm text-muted-foreground">등록된 글이 없습니다.</li>
        ) : (
          rows.map((row) => {
            const key = row[keyField];
            const itemTitle = row[titleField] ?? '—';
            return (
              <li key={key} className="flex items-center justify-between text-sm gap-2">
                <Link
                  href={`${linkPrefix}/${key}`}
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors min-w-0"
                  title={itemTitle}
                >
                  <span className="truncate">{itemTitle}</span>
                  {showActivePopupBadge && isNoticePopupActive(row) ? (
                    <span className="inline-flex shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      공지
                    </span>
                  ) : null}
                </Link>
                <span className="text-xs text-muted-foreground/70 shrink-0">{row.dateLabel}</span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

export function NoticeLibraryPreview() {
  return (
    <div className="flex flex-col gap-[23px] max-h-[350px]">
      <PreviewCard
        title="공지사항"
        listPath="/notice"
        linkPrefix="/notice"
        service="noticeService"
        titleField="noticeTitle"
        keyField="noticeKey"
        showActivePopupBadge
      />
      <PreviewCard
        title="자료실"
        listPath="/library"
        linkPrefix="/library"
        service="boardService"
        titleField="boardTitle"
        keyField="boardKey"
      />
    </div>
  );
}
