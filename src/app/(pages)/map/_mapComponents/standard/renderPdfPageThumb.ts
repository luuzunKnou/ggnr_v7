import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  acquirePdfDocument,
  getPdfViewerFocusUrl,
  releasePdfDocument,
} from './pdfDocumentCache';
import {
  inferPdfPageUprightRotation,
  type IndexSheetGuide,
  type IndexSheetMode,
} from './inferPdfPageUprightRotation';

const THUMB_JPEG_QUALITY = 0.65;
/** 사이드바 썸네일 DPR 상한 — 렌더 비용 절감 */
const THUMB_DPR_MAX = 1;
const THUMB_RENDER_CONCURRENCY = 2;
const THUMB_CACHE_MAX = 240;

const thumbCache = new Map<string, string>();

let activeRenders = 0;
const renderQueue: Array<() => void> = [];

function guideCacheToken(guide?: IndexSheetGuide): string {
  const g = guide?.guide3857;
  if (g == null || g.length < 2) return '0';
  const a = g[0];
  const b = g[g.length - 1];
  return `${g.length}:${a[0].toFixed(0)}:${b[0].toFixed(0)}:${b[1].toFixed(0)}`;
}

function thumbCacheKey(
  url: string,
  pageNumber: number,
  thumbMaxPx: number,
  indexSheetMode?: IndexSheetMode,
  indexSheetGuide?: IndexSheetGuide
): string {
  return `${url}\0${pageNumber}\0${thumbMaxPx}\0${indexSheetMode ?? '0'}\0${guideCacheToken(indexSheetGuide)}\0u11`;
}

function trimThumbCache(): void {
  while (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest == null) break;
    thumbCache.delete(oldest);
  }
}

function assertThumbAllowed(url: string, signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Thumb render aborted', 'AbortError');
  }
  const focus = getPdfViewerFocusUrl();
  if (focus != null && focus !== url) {
    throw new DOMException('Thumb render stale url', 'AbortError');
  }
}

function runThumbRenderQueued<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeRenders += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeRenders -= 1;
          const next = renderQueue.shift();
          if (next) next();
        });
    };
    if (activeRenders < THUMB_RENDER_CONCURRENCY) run();
    else renderQueue.push(run);
  });
}

async function renderPageThumbDataUrl(
  url: string,
  pdf: PDFDocumentProxy,
  pageNumber: number,
  thumbMaxPx: number,
  signal?: AbortSignal,
  indexSheetMode?: IndexSheetMode,
  indexSheetGuide?: IndexSheetGuide
): Promise<string> {
  assertThumbAllowed(url, signal);
  const total = pdf.numPages;
  const pageIdx = Math.min(Math.max(1, pageNumber), total);
  const page = await pdf.getPage(pageIdx);
  assertThumbAllowed(url, signal);

  const rotation = await inferPdfPageUprightRotation(page, { indexSheetMode, indexSheetGuide });
  assertThumbAllowed(url, signal);

  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, THUMB_DPR_MAX);
  const displayPx = Math.max(64, thumbMaxPx);
  const fitScale = displayPx / Math.max(base.width, base.height, 1);
  const viewport = page.getViewport({ scale: fitScale, rotation });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no ctx');

  const pxW = Math.ceil(viewport.width);
  const pxH = Math.ceil(viewport.height);
  canvas.width = Math.floor(pxW * dpr);
  canvas.height = Math.floor(pxH * dpr);

  const transform: [number, number, number, number, number, number] | undefined =
    dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

  const renderTask = page.render({ canvasContext: ctx, viewport, transform });
  signal?.addEventListener('abort', () => renderTask.cancel(), { once: true });
  await renderTask.promise;
  assertThumbAllowed(url, signal);
  return canvas.toDataURL('image/jpeg', THUMB_JPEG_QUALITY);
}

/** 페이지 썸네일 data URL — PDF 공유 로드 + 결과 캐시 + 동시 렌더 제한 */
export function getPdfPageThumbDataUrl(
  url: string,
  pageNumber: number,
  thumbMaxPx: number,
  signal?: AbortSignal,
  opts?: { indexSheetMode?: IndexSheetMode; indexSheetGuide?: IndexSheetGuide }
): Promise<string> {
  const indexSheetMode = opts?.indexSheetMode;
  const indexSheetGuide = opts?.indexSheetGuide;
  const key = thumbCacheKey(url, pageNumber, thumbMaxPx, indexSheetMode, indexSheetGuide);
  const hit = thumbCache.get(key);
  if (hit) return Promise.resolve(hit);

  return runThumbRenderQueued(async () => {
    assertThumbAllowed(url, signal);
    const cached = thumbCache.get(key);
    if (cached) return cached;

    const pdf = await acquirePdfDocument(url);
    try {
      assertThumbAllowed(url, signal);
      const dataUrl = await renderPageThumbDataUrl(
        url,
        pdf,
        pageNumber,
        thumbMaxPx,
        signal,
        indexSheetMode,
        indexSheetGuide
      );
      assertThumbAllowed(url, signal);
      thumbCache.set(key, dataUrl);
      trimThumbCache();
      return dataUrl;
    } finally {
      releasePdfDocument(url);
    }
  });
}
