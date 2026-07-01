'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { filterVisibleNotices, snoozeNoticesForOneWeek } from '@/lib/noticeSnoozeStorage';
import { Megaphone, X } from 'lucide-react';

type PopupNotice = {
  noticeKey: number;
  noticeTitle: string;
  noticeContents: string | null;
  periodLabel: string;
};

/** 인덱스(/) 진입 시 공지기간·공지여부에 해당하는 팝업 표시 */
export function ActiveNoticeModal() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<PopupNotice[]>([]);
  const [snoozeWeek, setSnoozeWeek] = useState(false);

  useEffect(() => {
    if (pathname !== '/') {
      setOpen(false);
      setNotices([]);
      return;
    }

    let cancelled = false;
    setOpen(false);
    setSnoozeWeek(false);
    void call('', 'POST', {
      service: 'noticeService',
      action: 'listActivePopups',
      params: {},
    })
      .then((res) => {
        const rows = (res.data ?? []) as PopupNotice[];
        if (!Array.isArray(rows) || cancelled) return;
        const visible = filterVisibleNotices(rows);
        if (visible.length > 0) {
          setNotices(visible);
          setOpen(true);
        } else {
          setNotices([]);
        }
      })
      .catch(() => {
        if (!cancelled) setNotices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const dismiss = (applySnooze: boolean) => {
    if (applySnooze && snoozeWeek && notices.length > 0) {
      snoozeNoticesForOneWeek(notices.map((n) => n.noticeKey));
    }
    setOpen(false);
    setSnoozeWeek(false);
  };

  if (!notices.length) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) dismiss(false);
      }}
    >
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>공지사항</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 bg-slate-50/80">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Megaphone className="h-4 w-4 text-primary" />
            공지사항
          </span>
          <button
            type="button"
            onClick={() => dismiss(false)}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-visible px-4 py-4 space-y-6">
          {notices.map((n, idx) => (
            <article
              key={n.noticeKey}
              className={idx > 0 ? 'pt-6 border-t border-border/60' : undefined}
            >
              <h3 className="text-base font-bold text-foreground mb-1">{n.noticeTitle}</h3>
              <p className="text-xs text-muted-foreground mb-3">공지기간 {n.periodLabel}</p>
              <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                {n.noticeContents?.trim() || '내용 없음'}
              </div>
              <Link
                href={`/notice/${n.noticeKey}`}
                className="inline-block mt-3 text-xs text-primary hover:underline"
                onClick={() => dismiss(false)}
              >
                자세히 보기
              </Link>
            </article>
          ))}
        </div>
        <div className="px-4 pb-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={snoozeWeek}
              onChange={(e) => setSnoozeWeek(e.target.checked)}
              className="rounded border-border"
            />
            1주일간 보지 않기
          </label>
          <Button type="button" size="sm" onClick={() => dismiss(true)}>
            확인
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
