'use client';

import { GlobalWorkerOptions } from 'pdfjs-dist';
import { withBasePath } from '@/lib/basePath';

let configured = false;

/**
 * pdfjs 워커 URL — 폐쇄망 운영에서도 열리도록 앱이 서빙하는 public 사본 사용.
 * public/pdf.worker.min.mjs 는 node_modules/pdfjs-dist 와 같은 버전이어야 한다.
 */
export function configurePdfJsWorker(): void {
  if (typeof window === 'undefined' || configured) return;
  configured = true;
  GlobalWorkerOptions.workerSrc = withBasePath('/pdf.worker.min.mjs');
}
