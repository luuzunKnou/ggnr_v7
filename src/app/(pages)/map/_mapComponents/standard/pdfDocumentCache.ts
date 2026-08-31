'use client';

import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import { appFetch } from '@/lib/basePath';
import { configurePdfJsWorker } from '@/lib/pdfjsWorker';

type CacheEntry = {
  promise: Promise<PDFDocumentProxy>;
  doc: PDFDocumentProxy | null;
  refCount: number;
  loadingTask: PDFDocumentLoadingTask | null;
  abortController: AbortController;
  cancelled: boolean;
};

const cache = new Map<string, CacheEntry>();

/** refCount=0 상태로 유지할 최근 PDF 상한 — 파일 전환 시 재파싱 방지 */
const WARM_CACHE_MAX = 4;

let viewerFocusUrl: string | null = null;
/** refCount=0 idle 문서 LRU (오래된 것부터 evict) */
const warmIdleUrls: string[] = [];

export function getPdfViewerFocusUrl(): string | null {
  return viewerFocusUrl;
}

function touchWarmIdle(url: string): void {
  const idx = warmIdleUrls.indexOf(url);
  if (idx >= 0) warmIdleUrls.splice(idx, 1);
  warmIdleUrls.push(url);
}

function removeWarmIdle(url: string): void {
  const idx = warmIdleUrls.indexOf(url);
  if (idx >= 0) warmIdleUrls.splice(idx, 1);
}

function evictWarmIdle(): void {
  while (warmIdleUrls.length > WARM_CACHE_MAX) {
    const evict = warmIdleUrls.shift();
    if (!evict || evict === viewerFocusUrl) continue;
    const entry = cache.get(evict);
    if (entry && entry.refCount === 0 && entry.doc) {
      void entry.doc.destroy().catch(() => {});
      cache.delete(evict);
    }
  }
}

/** 파싱 완료된 PDF가 캐시에 있는지 (동기) */
export function isPdfDocumentReady(url: string): boolean {
  const entry = cache.get(url);
  return Boolean(entry?.doc && !entry.cancelled);
}

/** 캐시된 PDF 페이지 수 — 파일 전환 시 사이드바 즉시 표시용 */
export function getCachedPdfNumPages(url: string): number | null {
  const entry = cache.get(url);
  if (entry?.doc && !entry.cancelled) return entry.doc.numPages;
  return null;
}

/**
 * 뷰어 포커스 URL 갱신.
 * 진행 중(in-flight) 로드만 취소하고, 파싱 완료 문서는 warm cache에 유지한다.
 */
export function setPdfViewerFocusUrl(url: string | null): void {
  viewerFocusUrl = url;
  for (const cachedUrl of [...cache.keys()]) {
    if (cachedUrl === url) continue;
    const entry = cache.get(cachedUrl);
    if (entry && !entry.doc && !entry.cancelled) {
      cancelPdfDocument(cachedUrl);
    }
  }
  evictWarmIdle();
}

function throwIfAborted(entry: CacheEntry, url: string): void {
  if (entry.cancelled || !cache.has(url)) {
    throw new DOMException('PDF load cancelled', 'AbortError');
  }
}

async function loadPdfDocument(url: string, entry: CacheEntry): Promise<PDFDocumentProxy> {
  configurePdfJsWorker();
  const res = await appFetch(url, {
    credentials: 'include',
    signal: entry.abortController.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  throwIfAborted(entry, url);

  const buf = await res.arrayBuffer();
  throwIfAborted(entry, url);

  const loadingTask = getDocument({ data: new Uint8Array(buf) });
  entry.loadingTask = loadingTask;
  const doc = await loadingTask.promise;
  entry.loadingTask = null;
  throwIfAborted(entry, url);
  return doc;
}

/** 진행 중 fetch·parse·doc destroy 후 cache 제거 */
export function cancelPdfDocument(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  entry.cancelled = true;
  entry.abortController.abort();
  entry.loadingTask?.destroy();
  entry.loadingTask = null;
  if (entry.doc) {
    void entry.doc.destroy().catch(() => {});
    entry.doc = null;
  }
  removeWarmIdle(url);
  cache.delete(url);
}

/** URL당 PDF 1회 fetch·파싱 — Stage·썸네일·연속보기 공유 */
export async function acquirePdfDocument(url: string): Promise<PDFDocumentProxy> {
  let entry = cache.get(url);
  if (!entry) {
    const abortController = new AbortController();
    const newEntry: CacheEntry = {
      promise: Promise.resolve(null as unknown as PDFDocumentProxy),
      doc: null,
      refCount: 0,
      loadingTask: null,
      abortController,
      cancelled: false,
    };
    newEntry.promise = loadPdfDocument(url, newEntry)
      .then((doc) => {
        const current = cache.get(url);
        if (!current || current.cancelled) {
          void doc.destroy().catch(() => {});
          throw new DOMException('PDF load cancelled', 'AbortError');
        }
        current.doc = doc;
        return doc;
      })
      .catch((err) => {
        if (cache.get(url) === newEntry) {
          removeWarmIdle(url);
          cache.delete(url);
        }
        throw err;
      });
    entry = newEntry;
    cache.set(url, entry);
  }

  removeWarmIdle(url);
  entry.refCount += 1;
  try {
    const doc = await entry.promise;
    throwIfAborted(entry, url);
    return doc;
  } catch (err) {
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0 && entry.doc && !entry.cancelled) {
      touchWarmIdle(url);
      evictWarmIdle();
    }
    throw err;
  }
}

export function releasePdfDocument(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0 && entry.doc && !entry.cancelled) {
    touchWarmIdle(url);
    evictWarmIdle();
  }
}

/** 백그라운드 fetch·파싱 — 인접 파일 전환 가속 */
export function prefetchPdfDocument(url: string): void {
  if (!url || isPdfDocumentReady(url)) return;
  const existing = cache.get(url);
  if (existing && !existing.cancelled) return;

  void acquirePdfDocument(url)
    .then(() => releasePdfDocument(url))
    .catch(() => {});
}
