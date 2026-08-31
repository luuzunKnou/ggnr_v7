'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { type PDFDocumentProxy, type TextLayer } from 'pdfjs-dist';
import { cn } from '@/lib/utils';
import { configurePdfJsWorker } from '@/lib/pdfjsWorker';
import { acquirePdfDocument, releasePdfDocument } from './pdfDocumentCache';
import { cancelPdfTextLayer, renderPdfTextLayer } from './renderPdfTextLayer';
import { scheduleLazyPdfTextLayer, type LazyTextLayerHandle } from './lazyPdfTextLayer';
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
/** canvas prefetch — 뷰포트 밖 여유 */
const CANVAS_ROOT_MARGIN = '320px 0px';
/** TextLayer — 실제 화면에 들어온 페이지만 */
const TEXT_LAYER_ROOT_MARGIN = '80px 0px';

function releaseCanvasMemory(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = '';
  canvas.style.height = '';
}

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
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [textLayerEligible, setTextLayerEligible] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const textLayerTaskRef = useRef<TextLayer | null>(null);
  const lazyTextLayerRef = useRef<LazyTextLayerHandle | null>(null);
  const onHeightReadyRef = useRef(onHeightReady);
  onHeightReadyRef.current = onHeightReady;

  const cancelTextLayer = useCallback(() => {
    lazyTextLayerRef.current?.cancel();
    lazyTextLayerRef.current = null;
    cancelPdfTextLayer(textLayerTaskRef.current, textLayerRef.current);
    textLayerTaskRef.current = null;
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || scrollRoot == null) return;

    const canvasObs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === el) setInView(entry.isIntersecting);
        }
      },
      { root: scrollRoot, rootMargin: CANVAS_ROOT_MARGIN }
    );
    canvasObs.observe(el);

    const textObs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === el) setTextLayerEligible(entry.isIntersecting);
        }
      },
      { root: scrollRoot, rootMargin: TEXT_LAYER_ROOT_MARGIN }
    );
    textObs.observe(el);

    return () => {
      canvasObs.disconnect();
      textObs.disconnect();
    };
  }, [scrollRoot]);

  useEffect(() => {
    if (!inView) {
      cancelTextLayer();
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      releaseCanvasMemory(canvasRef.current);
      setPhase('idle');
      return;
    }

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
      cancelTextLayer();
    };
  }, [inView, pdf, pageNumber, fitMode, renderScale, rotation, cancelTextLayer]);

  /** canvas 준비·뷰포트 진입 시 TextLayer lazy 스케줄 */
  useEffect(() => {
    if (!textLayerEligible || phase !== 'ready' || !inView) {
      if (!textLayerEligible) cancelTextLayer();
      return;
    }

    let cancelled = false;

    const run = async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled || !textLayerEligible) return;

      const canvas = canvasRef.current;
      if (!canvas || canvas.width < 1) return;

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

      const textContainer = textLayerRef.current;
      if (!textContainer) return;

      cancelTextLayer();
      lazyTextLayerRef.current = scheduleLazyPdfTextLayer(async (signal) => {
        if (cancelled || signal.aborted || !textLayerEligible) return;
        try {
          textLayerTaskRef.current = await renderPdfTextLayer({
            page,
            viewport,
            container: textContainer,
            signal,
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        }
      });
    };

    void run();
    return () => {
      cancelled = true;
      cancelTextLayer();
    };
  }, [
    textLayerEligible,
    phase,
    inView,
    pdf,
    pageNumber,
    fitMode,
    renderScale,
    rotation,
    cancelTextLayer,
  ]);

  useEffect(() => {
    return () => cancelTextLayer();
  }, [cancelTextLayer]);

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
        <div className={cn(phase === 'ready' ? 'relative inline-block' : 'absolute h-0 w-0 overflow-hidden opacity-0')}>
          <canvas
            ref={canvasRef}
            className="relative z-0 block shadow-2xl"
          />
          <div
            ref={textLayerRef}
            className="textLayer absolute left-0 top-0 z-[1]"
          />
        </div>
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
  const heldUrlRef = useRef<string | null>(null);
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

      if (heldUrlRef.current && heldUrlRef.current !== url) {
        releasePdfDocument(heldUrlRef.current);
        heldUrlRef.current = null;
        pdfRef.current = null;
      }
      loadUrlRef.current = null;

      try {
        const doc = await acquirePdfDocument(url);
        if (cancelled) {
          releasePdfDocument(url);
          return;
        }
        pdfRef.current = doc;
        heldUrlRef.current = url;
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
      if (heldUrlRef.current) {
        releasePdfDocument(heldUrlRef.current);
        heldUrlRef.current = null;
      }
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
        'min-h-0 flex-1 cursor-default px-2 py-3',
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
