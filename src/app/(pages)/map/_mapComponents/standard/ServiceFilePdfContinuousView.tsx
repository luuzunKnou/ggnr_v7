'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { cn } from '@/lib/utils';
import { configurePdfJsWorker } from '@/lib/pdfjsWorker';
import {
  STAGE_MAX_ZOOM,
  STAGE_MIN_ZOOM,
  type PdfPreviewFitMode,
} from './ServiceFilePdfPreviewStage';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const MAX_CANVAS_LONG_EDGE = 8192;
const PAGE_GAP_PX = 12;

type ContinuousPageProps = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  fitMode: PdfPreviewFitMode;
  renderScale: number;
  rotation: number;
  scrollRoot: HTMLElement | null;
  onHeightReady: (pageNumber: number, height: number) => void;
};

function ContinuousPage({
  pdf,
  pageNumber,
  fitMode,
  renderScale,
  rotation,
  scrollRoot,
  onHeightReady,
}: ContinuousPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const onHeightReadyRef = useRef(onHeightReady);
  onHeightReadyRef.current = onHeightReady;

  useEffect(() => {
    const el = rootRef.current;
    if (!el || scrollRoot == null) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { root: scrollRoot, rootMargin: '240px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const run = async () => {
      setPhase('loading');
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');

        const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 3);
        const maxW = Math.min(window.innerWidth * 0.96, 1800);
        const maxH = Math.min(window.innerHeight * 0.85, 1400);
        const vp1 = page.getViewport({ scale: 1, rotation });
        const fitSc =
          fitMode === 'width'
            ? Math.min(maxW / vp1.width, STAGE_MAX_ZOOM)
            : Math.min(maxW / vp1.width, maxH / vp1.height, STAGE_MAX_ZOOM);
        const zoom = clamp(renderScale, STAGE_MIN_ZOOM, STAGE_MAX_ZOOM);
        let renderSc = fitSc * zoom;
        let viewport = page.getViewport({ scale: renderSc, rotation });

        const longEdge = Math.max(viewport.width, viewport.height);
        if (longEdge > MAX_CANVAS_LONG_EDGE) {
          renderSc *= MAX_CANVAS_LONG_EDGE / longEdge;
          viewport = page.getViewport({ scale: renderSc, rotation });
        }

        const pxW = Math.ceil(viewport.width);
        const pxH = Math.ceil(viewport.height);
        canvas.width = Math.floor(pxW * dpr);
        canvas.height = Math.floor(pxH * dpr);
        canvas.style.width = `${pxW}px`;
        canvas.style.height = `${pxH}px`;

        onHeightReadyRef.current(pageNumber, pxH);

        const transform: [number, number, number, number, number, number] | undefined =
          dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

        const renderTask = page.render({ canvasContext: ctx, viewport, transform });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        renderTaskRef.current = null;
        if (cancelled) return;
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('error');
      }
    };

    void run();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [visible, pdf, pageNumber, fitMode, renderScale, rotation]);

  return (
    <div
      ref={rootRef}
      data-page={pageNumber}
      className="flex w-full justify-center"
    >
      <div className="relative">
        {phase === 'loading' || phase === 'idle' ? (
          <div
            className="flex min-h-[min(40vh,320px)] min-w-[min(80vw,480px)] items-center justify-center rounded bg-white/5"
            aria-busy={phase === 'loading'}
          >
            <Loader2 className="h-8 w-8 animate-spin text-white/45" aria-hidden />
          </div>
        ) : null}
        {phase === 'error' ? (
          <div className="rounded border border-white/20 bg-background/5 px-4 py-6 text-center text-sm text-white/80">
            페이지 {pageNumber}를 불러오지 못했습니다.
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className={cn(
            'block shadow-2xl',
            phase === 'ready' ? 'opacity-100' : 'absolute h-0 w-0 overflow-hidden opacity-0'
          )}
        />
      </div>
    </div>
  );
}

type Props = {
  url: string;
  fitMode: PdfPreviewFitMode;
  renderScale: number;
  cssZoomRatio: number;
  rotation: number;
  pdfPage: number;
  scrollToPageToken: number;
  onPagesReady: (n: number) => void;
  onVisiblePageChange: (n: number) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
};

/** PDF 전 페이지 세로 연속 스크롤 */
export function ServiceFilePdfContinuousView({
  url,
  fitMode,
  renderScale,
  cssZoomRatio,
  rotation,
  pdfPage,
  scrollToPageToken,
  onPagesReady,
  onVisiblePageChange,
  scrollContainerRef,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loadPhase, setLoadPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadUrlRef = useRef<string | null>(null);
  const scrollSyncLockRef = useRef(false);
  const visibilityRef = useRef<Map<number, number>>(new Map());
  const onPagesReadyRef = useRef(onPagesReady);
  const onVisiblePageChangeRef = useRef(onVisiblePageChange);
  onPagesReadyRef.current = onPagesReady;
  onVisiblePageChangeRef.current = onVisiblePageChange;

  const assignScrollRoot = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      setScrollRoot(el);
      if (scrollContainerRef) {
        (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }
    },
    [scrollContainerRef]
  );

  useEffect(() => {
    configurePdfJsWorker();
    let cancelled = false;

    const run = async () => {
      setLoadPhase('loading');
      if (pdfRef.current && loadUrlRef.current === url) {
        setPdf(pdfRef.current);
        setNumPages(pdfRef.current.numPages);
        setLoadPhase('ready');
        onPagesReadyRef.current(pdfRef.current.numPages);
        return;
      }

      if (pdfRef.current) {
        await pdfRef.current.destroy().catch(() => {});
        pdfRef.current = null;
      }
      loadUrlRef.current = null;

      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('fetch');
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
        if (cancelled) {
          await doc.destroy().catch(() => {});
          return;
        }
        pdfRef.current = doc;
        loadUrlRef.current = url;
        setPdf(doc);
        setNumPages(doc.numPages);
        setLoadPhase('ready');
        onPagesReadyRef.current(doc.numPages);
      } catch {
        if (!cancelled) setLoadPhase('error');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    return () => {
      void pdfRef.current?.destroy().catch(() => {});
      pdfRef.current = null;
      loadUrlRef.current = null;
    };
  }, []);

  const handleHeightReady = useCallback((_pageNumber: number, _height: number) => {
    /* placeholder heights handled by canvas layout */
  }, []);

  /** 사이드바·툴바 등 명시적 페이지 이동 시에만 스크롤 */
  useEffect(() => {
    if (scrollToPageToken === 0) return;
    const root = scrollRef.current;
    if (!root || numPages < 1) return;
    const target = root.querySelector(`[data-page="${pdfPage}"]`) as HTMLElement | null;
    if (!target) return;

    scrollSyncLockRef.current = true;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const id = window.setTimeout(() => {
      scrollSyncLockRef.current = false;
    }, 450);
    return () => window.clearTimeout(id);
  }, [scrollToPageToken, pdfPage, numPages]);

  /** IntersectionObserver — 스크롤·회전·줌 후에도 현재 페이지 감지 */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || numPages < 1) return;

    visibilityRef.current.clear();

    const pickVisiblePage = () => {
      if (scrollSyncLockRef.current) return;
      let bestPage = 1;
      let bestRatio = 0;
      visibilityRef.current.forEach((ratio, page) => {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestPage = page;
        }
      });
      if (bestRatio > 0) {
        onVisiblePageChangeRef.current(bestPage);
      }
    };

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const n = parseInt((entry.target as HTMLElement).dataset.page ?? '0', 10);
          if (!Number.isFinite(n) || n < 1) return;
          visibilityRef.current.set(n, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
        pickVisiblePage();
      },
      {
        root,
        rootMargin: '-32% 0px -48% 0px',
        threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    const bind = () => {
      obs.disconnect();
      visibilityRef.current.clear();
      root.querySelectorAll<HTMLElement>('[data-page]').forEach((node) => obs.observe(node));
    };

    bind();
    const raf = requestAnimationFrame(() => pickVisiblePage());

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      visibilityRef.current.clear();
    };
  }, [numPages, scrollRoot, rotation, cssZoomRatio]);

  const pageNumbers =
    numPages > 0 ? Array.from({ length: numPages }, (_, i) => i + 1) : [];

  const rotNorm = ((rotation % 360) + 360) % 360;
  const scrollSideways = rotNorm === 90 || rotNorm === 270;

  if (loadPhase === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-white/80">
        PDF를 불러오지 못했습니다.
      </div>
    );
  }

  if (loadPhase === 'loading' || pdf == null) {
    return (
      <div className="flex flex-1 items-center justify-center" aria-busy="true">
        <Loader2 className="h-10 w-10 animate-spin text-white/60" aria-hidden />
      </div>
    );
  }

  return (
    <div
      ref={assignScrollRoot}
      className={cn(
        'min-h-0 flex-1 cursor-pointer px-2 py-3',
        scrollSideways ? 'overflow-auto' : 'overflow-y-auto overflow-x-hidden'
      )}
    >
      <div
        className="mx-auto flex w-fit max-w-none flex-col items-center"
        style={{
          gap: PAGE_GAP_PX,
          transform: cssZoomRatio !== 1 ? `scale(${cssZoomRatio})` : undefined,
          transformOrigin: 'top center',
        }}
      >
        {pageNumbers.map((pn) => (
          <ContinuousPage
            key={pn}
            pdf={pdf}
            pageNumber={pn}
            fitMode={fitMode}
            renderScale={renderScale}
            rotation={rotation}
            scrollRoot={scrollRoot}
            onHeightReady={handleHeightReady}
          />
        ))}
      </div>
    </div>
  );
}
