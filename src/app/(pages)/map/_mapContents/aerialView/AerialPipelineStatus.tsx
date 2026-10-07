'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';

type Status = {
  busy: boolean;
  headline: string;
  detail: string;
};

/** 드론영상 변환·파일 등록이 진행 중인지. 진행 중이면 폴더 등록은 끝난 뒤 이어진다. */
export function AerialPipelineStatus() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void call('', 'POST', {
        service: 'aerialUploadService',
        action: 'getAerialPipelineStatus',
        params: {},
      })
        .then((res) => {
          if (cancelled) return;
          const data = res?.data as Status | undefined;
          if (!res?.success || !data || typeof data.headline !== 'string') {
            setStatus(null);
            return;
          }
          setStatus({
            busy: Boolean(data.busy),
            headline: data.headline,
            detail: typeof data.detail === 'string' ? data.detail : '',
          });
        })
        .catch(() => {
          if (!cancelled) setStatus(null);
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  return (
    <div
      className={cn(
        'mb-2 rounded-md border px-2.5 py-2',
        status.busy
          ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40'
          : 'border-border bg-muted/40'
      )}
    >
      <p
        className={cn(
          'text-[11px] font-semibold',
          status.busy ? 'text-amber-900 dark:text-amber-100' : 'text-foreground'
        )}
      >
        {status.headline}
      </p>
      {status.detail ? (
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{status.detail}</p>
      ) : null}
    </div>
  );
}
