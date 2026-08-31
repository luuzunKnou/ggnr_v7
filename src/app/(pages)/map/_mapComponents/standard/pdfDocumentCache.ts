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

let viewerFocusUrl: string | null = null;

export function getPdfViewerFocusUrl(): string | null {
  return viewerFocusUrl;
}

/** 뷰어가 보는 URL만 유지 — 그 외 in-flight load 즉시 취소 */
export function setPdfViewerFocusUrl(url: string | null): void {
  viewerFocusUrl = url;
  for (const cachedUrl of [...cache.keys()]) {
    if (cachedUrl !== url) cancelPdfDocument(cachedUrl);
  }
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
          cache.delete(url);
        }
        throw err;
      });
    entry = newEntry;
    cache.set(url, entry);
  }

  entry.refCount += 1;
  try {
    const doc = await entry.promise;
    throwIfAborted(entry, url);
    return doc;
  } catch (err) {
    entry.refCount = Math.max(0, entry.refCount - 1);
    throw err;
  }
}

export function releasePdfDocument(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0 && entry.doc && !entry.cancelled) {
    void entry.doc.destroy().catch(() => {});
    cache.delete(url);
  }
}
