'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { cn } from '@/lib/utils';
import { configurePdfJsWorker } from '@/lib/pdfjsWorker';
import { appFetch } from '@/lib/basePath';

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
}: {
  url: string;
  pageNumber: number;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  /** 썸네일 표시 너비(CSS px). 렌더는 DPR 배율 적용 */
  thumbMaxPx?: number;
}) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const alive = useRef(true);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!visible) return;
    alive.current = true;
    setPhase('loading');
    setDataUrl(null);
    configurePdfJsWorker();

    void (async () => {
      try {
        const res = await appFetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!alive.current) return;

        const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
        if (!alive.current) {
          await pdf.destroy().catch(() => {});
          return;
        }
        pdfRef.current = pdf;

        const total = pdf.numPages;
        const pageIdx = Math.min(Math.max(1, pageNumber), total);
        const page = await pdf.getPage(pageIdx);
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);
        const displayPx = Math.max(64, thumbMaxPx);
        const fitScale = displayPx / Math.max(base.width, base.height, 1);
        const viewport = page.getViewport({ scale: fitScale });

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');

        const pxW = Math.ceil(viewport.width);
        const pxH = Math.ceil(viewport.height);
        canvas.width = Math.floor(pxW * dpr);
        canvas.height = Math.floor(pxH * dpr);

        const transform: [number, number, number, number, number, number] | undefined =
          dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

        await page.render({ canvasContext: ctx, viewport, transform }).promise;
        if (!alive.current) {
          await pdf.destroy().catch(() => {});
          return;
        }

        setDataUrl(canvas.toDataURL('image/png'));
        setPhase('ready');
        pdfRef.current = null;
        await pdf.destroy().catch(() => {});
      } catch {
        if (alive.current) setPhase('error');
      }
    })();

    return () => {
      alive.current = false;
      void pdfRef.current?.destroy?.();
      pdfRef.current = null;
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
