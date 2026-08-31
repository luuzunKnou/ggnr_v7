'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { type PDFDocumentProxy } from 'pdfjs-dist';
import { cn } from '@/lib/utils';
import { configurePdfJsWorker } from '@/lib/pdfjsWorker';
import { acquirePdfDocument, releasePdfDocument } from './pdfDocumentCache';
import { cancelPdfTextLayer, renderPdfTextLayer } from './renderPdfTextLayer';
import { scheduleLazyPdfTextLayer, type LazyTextLayerHandle } from './lazyPdfTextLayer';
import type { TextLayer } from 'pdfjs-dist';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export const STAGE_MIN_ZOOM = 0.25;
export const STAGE_MAX_ZOOM = 5;

export type PdfPreviewFitMode = 'page' | 'width';

/** 캔버스 긴 변 픽셀 상한 (DPR 적용 전 CSS px 기준) — 대형 도면 OOM 방지 */
const MAX_CANVAS_LONG_EDGE = 8192;

/** pdf.js — 2단계 LOD: renderScale 배율로 1회 렌더, UI 줌은 부모 CSS scale */
export function ServiceFilePdfPreviewStage({
  url,
  pageNumber,
  onPagesReady,
  fitMode = 'page',
  renderScale = 1,
}: {
  url: string;
  pageNumber: number;
  onPagesReady: (n: number) => void;
  /** page=화면에 페이지 전체, width=가로 너비 맞춤 */
  fitMode?: PdfPreviewFitMode;
  /** pdf.js viewport scale = fit × renderScale (LOD 확정 배율) */
  renderScale?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const heldUrlRef = useRef<string | null>(null);
  const loadUrlRef = useRef<string | null>(null);
  const lastPageRef = useRef<number>(0);
  const hasRenderedRef = useRef(false);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const textLayerTaskRef = useRef<TextLayer | null>(null);
  const lazyTextLayerRef = useRef<LazyTextLayerHandle | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [upgrading, setUpgrading] = useState(false);
  const alive = useRef(true);
  const onPagesReadyRef = useRef(onPagesReady);
  onPagesReadyRef.current = onPagesReady;

  useEffect(() => {
    alive.current = true;
    configurePdfJsWorker();
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const needNewDoc = loadUrlRef.current !== url || pdfRef.current == null;
      const pageChanged = lastPageRef.current !== pageNumber;
      const isLodUpgrade = hasRenderedRef.current && !needNewDoc && !pageChanged;

      if (isLodUpgrade) {
        setUpgrading(true);
      } else {
        setPhase('loading');
        setUpgrading(false);
        hasRenderedRef.current = false;
      }

      try {
        let pdf = pdfRef.current;
        if (needNewDoc) {
          if (heldUrlRef.current && heldUrlRef.current !== url) {
            releasePdfDocument(heldUrlRef.current);
            heldUrlRef.current = null;
            pdfRef.current = null;
            loadUrlRef.current = null;
          }
          pdf = await acquirePdfDocument(url);
          if (cancelled || !alive.current) {
            releasePdfDocument(url);
            return;
          }
          pdfRef.current = pdf;
          heldUrlRef.current = url;
          loadUrlRef.current = url;
          onPagesReadyRef.current(pdf.numPages);
        }

        pdf = pdfRef.current;
        if (!pdf) {
          if (!cancelled && alive.current) setPhase('error');
          return;
        }

        lastPageRef.current = pageNumber;
        const total = pdf.numPages;
        const pageIdx = clamp(pageNumber, 1, total);
        const page = await pdf.getPage(pageIdx);
        if (cancelled || !alive.current) return;

        const canvas = canvasRef.current;
        if (!canvas) {
          if (!cancelled && alive.current) setPhase('error');
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');

        const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 3);
        const maxW = Math.min(window.innerWidth * 0.96, 1800);
        const maxH = Math.min(window.innerHeight * 0.85, 1400);
        const vp1 = page.getViewport({ scale: 1 });
        const fitSc =
          fitMode === 'width'
            ? Math.min(maxW / vp1.width, STAGE_MAX_ZOOM)
            : Math.min(maxW / vp1.width, maxH / vp1.height, STAGE_MAX_ZOOM);
        const zoom = clamp(renderScale, STAGE_MIN_ZOOM, STAGE_MAX_ZOOM);
        let renderSc = fitSc * zoom;
        let viewport = page.getViewport({ scale: renderSc });

        const longEdge = Math.max(viewport.width, viewport.height);
        if (longEdge > MAX_CANVAS_LONG_EDGE) {
          renderSc *= MAX_CANVAS_LONG_EDGE / longEdge;
          viewport = page.getViewport({ scale: renderSc });
        }

        const pxW = Math.ceil(viewport.width);
        const pxH = Math.ceil(viewport.height);
        canvas.width = Math.floor(pxW * dpr);
        canvas.height = Math.floor(pxH * dpr);
        canvas.style.width = `${pxW}px`;
        canvas.style.height = `${pxH}px`;

        const transform: [number, number, number, number, number, number] | undefined =
          dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
          transform,
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        renderTaskRef.current = null;
        if (cancelled || !alive.current) return;

        hasRenderedRef.current = true;
        setUpgrading(false);
        setPhase('ready');

        const textContainer = textLayerRef.current;
        if (textContainer) {
          lazyTextLayerRef.current?.cancel();
          lazyTextLayerRef.current = null;
          cancelPdfTextLayer(textLayerTaskRef.current, textContainer);
          textLayerTaskRef.current = null;

          lazyTextLayerRef.current = scheduleLazyPdfTextLayer(async (signal) => {
            if (cancelled || !alive.current || signal.aborted) return;
            try {
              textLayerTaskRef.current = await renderPdfTextLayer({
                page,
                viewport,
                container: textContainer,
                signal,
              });
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') return;
              /* 스캔 PDF 등 텍스트 없음 — canvas만 표시 */
            }
          });
        }
      } catch {
        if (!cancelled && alive.current) {
          setUpgrading(false);
          setPhase('error');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      lazyTextLayerRef.current?.cancel();
      lazyTextLayerRef.current = null;
      cancelPdfTextLayer(textLayerTaskRef.current, textLayerRef.current);
      textLayerTaskRef.current = null;
    };
  }, [url, pageNumber, fitMode, renderScale]);

  useEffect(() => {
    return () => {
      lazyTextLayerRef.current?.cancel();
      lazyTextLayerRef.current = null;
      cancelPdfTextLayer(textLayerTaskRef.current, textLayerRef.current);
      textLayerTaskRef.current = null;
      if (heldUrlRef.current) {
        releasePdfDocument(heldUrlRef.current);
        heldUrlRef.current = null;
      }
      pdfRef.current = null;
      loadUrlRef.current = null;
      lastPageRef.current = 0;
      hasRenderedRef.current = false;
    };
  }, []);

  if (phase === 'error') {
    return (
      <div className="rounded border border-white/20 bg-background/5 px-4 py-6 text-center text-sm text-white/80">
        PDF를 불러오지 못했습니다.
      </div>
    );
  }

  const showBlockingLoader = phase === 'loading' && !hasRenderedRef.current;

  return (
    <div className="relative flex min-h-[min(40vh,200px)] items-center justify-center">
      {showBlockingLoader ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded bg-black/25"
          aria-busy="true"
        >
          <Loader2 className="h-10 w-10 animate-spin text-white/60" aria-hidden />
        </div>
      ) : null}
      {upgrading ? (
        <div
          className="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50"
          aria-busy="true"
          title="고해상도 렌더 중"
        >
          <Loader2 className="h-4 w-4 animate-spin text-white/70" aria-hidden />
        </div>
      ) : null}
      <div className="relative inline-block">
        <canvas
          ref={canvasRef}
          className={cn(
            'relative z-0 block shadow-2xl transition-opacity duration-150',
            showBlockingLoader ? 'opacity-0' : 'opacity-100'
          )}
          aria-hidden={showBlockingLoader}
        />
        <div
          ref={textLayerRef}
          className="textLayer absolute left-0 top-0 z-[1]"
          aria-hidden={showBlockingLoader}
        />
      </div>
    </div>
  );
}
