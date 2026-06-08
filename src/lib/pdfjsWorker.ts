'use client';

import { GlobalWorkerOptions, version } from 'pdfjs-dist';

let configured = false;

/** pdfjs 워커 URL (메인 번들과 동일 버전). 브라우저에서 한 번만 설정. */
export function configurePdfJsWorker(): void {
  if (typeof window === 'undefined' || configured) return;
  configured = true;
  GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
}
