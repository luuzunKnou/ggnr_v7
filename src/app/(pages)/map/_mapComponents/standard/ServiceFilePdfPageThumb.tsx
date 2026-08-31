'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPdfPageThumbDataUrl } from './renderPdfPageThumb';

/** 사이드바(240px) 기준 썸네일 표시 너비 */
export const PDF_PAGE_THUMB_DISPLAY_PX = 220;

type Phase = 'idle' | 'loading' | 'ready' | 'error';

/**
 * PDF 특정 페이지 썸네일. visible 시 lazy 렌더 (IntersectionObserver).
 */
export function ServiceFilePdfPageThumb({
  url,
  pageNumber,
  active = false,
  onClick,
  className,
  thumbMaxPx = PDF_PAGE_THUMB_DISPLAY_PX,
  priority = false,
}: {
  url: string;
  pageNumber: number;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  /** 썸네일 표시 너비(CSS px). 렌더는 DPR 배율 적용 */
  thumbMaxPx?: number;
  /** true면 IntersectionObserver 없이 즉시 렌더 (현재 페이지) */
  priority?: boolean;
}) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(priority);
  const [phase, setPhase] = useState<Phase>('idle');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    if (priority) {
      setVisible(true);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '80px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [priority]);

  useEffect(() => {
    if (!visible) return;
    alive.current = true;
    setPhase('loading');
    setDataUrl(null);

    const ac = new AbortController();
    void getPdfPageThumbDataUrl(url, pageNumber, thumbMaxPx, ac.signal)
      .then((thumb) => {
        if (!alive.current) return;
        setDataUrl(thumb);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setPhase('error');
      });

    return () => {
      alive.current = false;
      ac.abort();
    };
  }, [visible, url, pageNumber, thumbMaxPx]);

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={onClick}
      title={`페이지 ${pageNumber}`}
      className={cn(
        'mx-auto flex w-full max-w-full flex-col items-center overflow-hidden rounded border text-center transition-colors',
        active
          ? 'border-primary ring-1 ring-inset ring-primary/40'
          : 'border-white/15 hover:border-white/35',
        className
      )}
      style={{ maxWidth: thumbMaxPx }}
    >
      <div className="flex aspect-[3/4] w-full items-center justify-center">
        {phase === 'ready' && dataUrl != null ? (
          /* eslint-disable-next-line @next/next/no-img-element -- data URL 썸네일 */
          <img
            src={dataUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        ) : phase === 'error' ? (
          <FileText className="h-5 w-5 text-white/40" aria-hidden />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-white/40" aria-hidden />
        )}
      </div>
      <span className="block py-0.5 text-[10px] tabular-nums text-white/65">{pageNumber}</span>
    </button>
  );
}
