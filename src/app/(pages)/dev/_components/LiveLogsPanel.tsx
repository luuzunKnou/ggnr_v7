'use client';

import { useLayoutEffect, useRef } from 'react';

export function LiveLogsPanel({ logs }: { logs: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="mt-0 flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded border bg-muted/10">
      <div className="shrink-0 border-b px-3 py-1.5 font-sans text-xs font-medium text-muted-foreground">
        실시간 로그
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px]">
        {logs.length === 0 ? (
          <div className="text-muted-foreground">로그 대기 중...</div>
        ) : (
          logs.map((line, i) => (
            <div key={`${i}-${line}`} className="whitespace-pre-wrap break-all leading-relaxed">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
