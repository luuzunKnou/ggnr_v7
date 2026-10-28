'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { type PDFDocumentProxy } from 'pdfjs-dist';
import { cn } from '@/lib/utils';
import { configurePdfJsWorker } from '@/lib/pdfjsWorker';
import { acquirePdfDocument, isPdfDocumentReady, releasePdfDocument } from './pdfDocumentCache';
import {
  inferPdfPageUprightRotation,
  type IndexSheetGuide,
  type IndexSheetMode,
} from './inferPdfPageUprightRotation';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export const STAGE_MIN_ZOOM = 0.25;
export const STAGE_MAX_ZOOM = 5;
/** 화면 배율이 1이어도 도면 선이 살아 있게 최소 2배 */
export const STAGE_OUTPUT_SCALE_MIN = 2;
export const STAGE_OUTPUT_SCALE_MAX = 3;

export type PdfPreviewFitMode = 'page' | 'width';

/** 맞춤 기준 긴 변 (CSS px) — 대형 도면 OOM 방지 */
const MAX_CSS_LONG_EDGE = 8192;
/** 실제 픽셀 긴 변 상한 */
const MAX_BUFFER_LONG_EDGE = 16384;

export function pdfStageFitLimits(
  fitMaxWidth?: number,
  fitMaxHeight?: number
): { maxW: number; maxH: number } {
  const maxW =
    fitMaxWidth != null && fitMaxWidth > 0
      ? fitMaxWidth
      : typeof window !== 'undefined'
        ? window.innerWidth * 0.96
        : 1280;
  const maxH =
    fitMaxHeight != null && fitMaxHeight > 0
      ? fitMaxHeight
      : typeof window !== 'undefined'
        ? window.innerHeight * 0.85
        : 800;
  return { maxW, maxH };
}

/** 표시 크기 대비 캔버스 픽셀 배율. 패널 썸네일과 무관. */
export function pdfStageOutputScale(cssW: number, cssH: number): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const desired = Math.min(STAGE_OUTPUT_SCALE_MAX, Math.max(dpr, STAGE_OUTPUT_SCALE_MIN));
  const longEdge = Math.max(cssW, cssH, 1);
  return Math.max(1, Math.min(desired, MAX_BUFFER_LONG_EDGE / longEdge));
}

/** pdf.js — 2단계 LOD: renderScale 배율로 1회 렌더, UI 줌은 부모 CSS scale */
export function ServiceFilePdfPreviewStage({
  url,
  pageNumber,
  onPagesReady,
  onMainCanvasReady,
  fitMode = 'page',
  renderScale = 1,
  fitMaxWidth,
  fitMaxHeight,
  indexSheetMode,
  indexSheetGuide,
}: {
  url: string;
  pageNumber: number;
  onPagesReady: (n: number) => void;
  /** 첫 메인 canvas 렌더 완료 시 1회 호출 — 썸네일 등 부가 로드 지연용 */
  onMainCanvasReady?: () => void;
  /** page=화면에 페이지 전체, width=가로 너비 맞춤 */
  fitMode?: PdfPreviewFitMode;
  /** pdf.js viewport scale = fit × renderScale (LOD 확정 배율) */
  renderScale?: number;
  /** 맞춤 기준 최대 너비(CSS px). 없으면 창 너비×0.96 */
  fitMaxWidth?: number;
  /** 맞춤 기준 최대 높이(CSS px). 없으면 창 높이×0.85 */
  fitMaxHeight?: number;
  /** 색인도일 때만 지정. 가로 칸은 90·180·270, 세로 칸은 180만 */
  indexSheetMode?: IndexSheetMode;
  indexSheetGuide?: IndexSheetGuide;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const heldUrlRef = useRef<string | null>(null);
  const loadUrlRef = useRef<string | null>(null);
  const lastPageRef = useRef<number>(0);
  const hasRenderedRef = useRef(false);
  const mainReadyNotifiedRef = useRef(false);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [upgrading, setUpgrading] = useState(false);
  const alive = useRef(true);
  const onPagesReadyRef = useRef(onPagesReady);
  const onMainCanvasReadyRef = useRef(onMainCanvasReady);
  onPagesReadyRef.current = onPagesReady;
  onMainCanvasReadyRef.current = onMainCanvasReady;

  useEffect(() => {
    alive.current = true;
    configurePdfJsWorker();
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    mainReadyNotifiedRef.current = false;
  }, [url]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const needNewDoc = loadUrlRef.current !== url || pdfRef.current == null;
      const pageChanged = lastPageRef.current !== pageNumber;
      const isLodUpgrade = hasRenderedRef.current && !needNewDoc && !pageChanged;

      const docAlreadyCached = needNewDoc && isPdfDocumentReady(url);

      if (isLodUpgrade) {
        setUpgrading(true);
      } else if (!docAlreadyCached) {
        setPhase('loading');
        setUpgrading(false);
        hasRenderedRef.current = false;
      } else {
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

        const rotation = await inferPdfPageUprightRotation(page, { indexSheetMode, indexSheetGuide });
        if (cancelled || !alive.current) return;

        const canvas = canvasRef.current;
        if (!canvas) {
          if (!cancelled && alive.current) setPhase('error');
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');

        const { maxW, maxH } = pdfStageFitLimits(fitMaxWidth, fitMaxHeight);
        const vp1 = page.getViewport({ scale: 1, rotation });
        const fitSc =
          fitMode === 'width'
            ? Math.min(maxW / vp1.width, STAGE_MAX_ZOOM)
            : Math.min(maxW / vp1.width, maxH / vp1.height, STAGE_MAX_ZOOM);
        const zoom = clamp(renderScale, STAGE_MIN_ZOOM, STAGE_MAX_ZOOM);
        let renderSc = fitSc * zoom;
        let viewport = page.getViewport({ scale: renderSc, rotation });

        const longEdge = Math.max(viewport.width, viewport.height);
        if (longEdge > MAX_CSS_LONG_EDGE) {
          renderSc *= MAX_CSS_LONG_EDGE / longEdge;
          viewport = page.getViewport({ scale: renderSc, rotation });
        }

        const pxW = Math.ceil(viewport.width);
        const pxH = Math.ceil(viewport.height);
        const outputScale = pdfStageOutputScale(pxW, pxH);
        canvas.width = Math.floor(pxW * outputScale);
        canvas.height = Math.floor(pxH * outputScale);
        canvas.style.width = `${pxW}px`;
        canvas.style.height = `${pxH}px`;

        const transform: [number, number, number, number, number, number] | undefined =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

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

        if (!mainReadyNotifiedRef.current) {
          mainReadyNotifiedRef.current = true;
          onMainCanvasReadyRef.current?.();
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
    };
  }, [url, pageNumber, fitMode, renderScale, fitMaxWidth, fitMaxHeight, indexSheetMode, indexSheetGuide]);

  useEffect(() => {
    return () => {
      if (heldUrlRef.current) {
        releasePdfDocument(heldUrlRef.current);
        heldUrlRef.current = null;
      }
      pdfRef.current = null;
      loadUrlRef.current = null;
      lastPageRef.current = 0;
      hasRenderedRef.current = false;
      mainReadyNotifiedRef.current = false;
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
      <canvas
        ref={canvasRef}
        className={cn(
          'relative z-0 block shadow-2xl transition-opacity duration-150',
          showBlockingLoader ? 'opacity-0' : 'opacity-100'
        )}
        aria-hidden={showBlockingLoader}
      />
    </div>
  );
}
