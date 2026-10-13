'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Loader2,
  Download,
  Printer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { zoomPreviewAtPointer } from './previewZoomAtCursor';
import { ServiceFilePdfPreviewStage } from './ServiceFilePdfPreviewStage';

export type ServiceFilePreviewItem = {
  url: string;
  fileName: string;
  /** 이미지: 기존 img 뷰 · PDF: pdf.js 1페이지 기준 캔버스 + 페이지 이동 */
  kind: 'image' | 'pdf';
};

/** @deprecated ServiceFilePreviewItem 사용 */
export type ServiceFileImagePreviewItem = ServiceFilePreviewItem;

type Props = {
  items: ServiceFilePreviewItem[];
  initialIndex: number;
  onClose: () => void;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP_WHEEL = 0.18;
const ZOOM_STEP_BUTTON = 0.35;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 쿠키 인증이 필요한 동일 출처 URL — Blob으로 받아 파일 저장 */
export async function downloadServiceFilePreviewBlob(url: string, fileName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('download failed');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  }
}

function uniqueZipEntryName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let i = 2;
  while (used.has(`${stem}_${i}${ext}`)) i += 1;
  const next = `${stem}_${i}${ext}`;
  used.add(next);
  return next;
}

/** 미리보기 목록 전체를 ZIP으로 저장 */
export async function downloadServiceFilePreviewItemsZip(
  items: { url: string; fileName: string }[],
  zipFileName: string
): Promise<void> {
  if (items.length === 0) throw new Error('empty');
  const { zipSync } = await import('fflate');
  const zipEntries: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();

  for (const item of items) {
    const res = await fetch(item.url, { credentials: 'include' });
    if (!res.ok) throw new Error('download failed');
    const buf = new Uint8Array(await res.arrayBuffer());
    zipEntries[uniqueZipEntryName(item.fileName, usedNames)] = buf;
  }

  const zipped = zipSync(zipEntries);
  const blob = new Blob([zipped], { type: 'application/zip' });
  const objectUrl = URL.createObjectURL(blob);
  const safeName = zipFileName.toLowerCase().endsWith('.zip') ? zipFileName : `${zipFileName}.zip`;
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  }
}

export function buildServiceFilePreviewListZipName(
  items: { fileName: string }[],
  currentIndex: number
): string {
  const cur = items[clampPreviewIndex(currentIndex, items.length)]?.fileName ?? 'PDF';
  const base = cur.replace(/\.pdf$/i, '').trim() || 'PDF';
  return `${base}_PDF목록.zip`;
}

function clampPreviewIndex(index: number, len: number): number {
  if (len <= 0) return 0;
  return Math.min(Math.max(0, index), len - 1);
}

/**
 * 이미지·PDF: 숨김 iframe에서 브라우저 인쇄 대화상자 (새 탭/팝업 없음).
 * PDF는 blob URL을 iframe.src로 두어 파일 자체를 인쇄한다 (canvas 렌더 아님).
 * 대용량·다페이지 PDF는 0×0 iframe에서 인쇄가 실패하므로 오프스크린 실크기 iframe + 지연·재시도.
 */
export async function printServiceFilePreviewBlob(
  url: string,
  fileName: string,
  kind: 'image' | 'pdf'
): Promise<void> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('print fetch failed');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  if (kind === 'pdf') {
    await new Promise<void>((resolve, reject) => {
      const iframe = document.createElement('iframe');
      // Chrome PDF 뷰어는 0×0이면 다페이지 문서를 준비하지 못함 → 실크기 + 화면 밖
      iframe.setAttribute(
        'style',
        'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;opacity:0;pointer-events:none'
      );
      iframe.setAttribute('title', fileName || 'PDF print');
      document.body.appendChild(iframe);

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        try {
          document.body.removeChild(iframe);
        } catch {
          /* ignore */
        }
        URL.revokeObjectURL(objectUrl);
      };

      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const runPrint = (): boolean => {
        if (cleaned) return false;
        try {
          const win = iframe.contentWindow;
          if (!win) return false;
          win.focus();
          win.print();
          win.addEventListener('afterprint', () => window.setTimeout(cleanup, 300), {
            once: true,
          });
          // afterprint 미지원·취소 시 대비 (인쇄 중 blob 유지)
          window.setTimeout(cleanup, 180_000);
          finishOk();
          return true;
        } catch {
          return false;
        }
      };

      const sizeMb = blob.size / (1024 * 1024);
      // 용량이 클수록 PDF 뷰어 준비 대기 (최대 약 10초). print()는 한 번만 호출.
      const baseDelay = Math.min(10_000, Math.max(1_200, 1_000 + sizeMb * 700));

      const loadTimer = window.setTimeout(() => {
        finishErr(new Error('pdf load timeout'));
      }, 60_000);

      iframe.addEventListener(
        'load',
        () => {
          window.clearTimeout(loadTimer);
          window.setTimeout(() => {
            if (runPrint()) return;
            // contentWindow 미준비 시 한 번만 재시도 (대화상자가 열린 뒤 재호출하면 닫힐 수 있음)
            window.setTimeout(() => {
              if (!runPrint()) finishErr(new Error('print failed'));
            }, 2_000);
          }, baseDelay);
        },
        { once: true }
      );
      iframe.addEventListener(
        'error',
        () => {
          window.clearTimeout(loadTimer);
          finishErr(new Error('pdf iframe error'));
        },
        { once: true }
      );
      iframe.src = objectUrl;
    });
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'style',
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
  );
  document.body.appendChild(iframe);

  const cleanup = () => {
    try {
      document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(objectUrl);
  };

  const runPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      /* ignore */
    }
    window.setTimeout(cleanup, 2000);
  };

  const doc = iframe.contentDocument;
  if (!doc) {
    cleanup();
    throw new Error('iframe');
  }
  const safeName = escapeHtml(fileName);
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeName}</title></head>` +
      `<body style="margin:0;text-align:center">` +
      `<img src="${objectUrl}" alt="" style="max-width:100%;height:auto"/>` +
      `</body></html>`
  );
  doc.close();

  const img = doc.querySelector('img');
  if (!img) {
    cleanup();
    throw new Error('no img');
  }
  img.addEventListener('error', cleanup, { once: true });
  if (img.complete && img.naturalWidth > 0) {
    window.setTimeout(runPrint, 150);
  } else {
    img.addEventListener('load', () => window.setTimeout(runPrint, 150), { once: true });
  }
}

function toolbarBtnClass(disabled?: boolean): string {
  return cn(
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-background/10',
    disabled && 'pointer-events-none opacity-35'
  );
}

/**
 * 첨부 이미지·PDF 전체화면 미리보기. 확대·축소·회전·파일 이전/다음, PDF는 페이지 이동.
 */
export function ServiceFileImagePreview({ items, initialIndex, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const itemsKey = useMemo(() => items.map((i) => `${i.fileName}\0${i.kind}`).join('\n'), [items]);

  const maxIdx = Math.max(0, items.length - 1);
  const [index, setIndex] = useState(() => clamp(initialIndex, 0, maxIdx));
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState(1);

  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const wheelTargetRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  scaleRef.current = scale;
  const panRef = useRef(pan);
  panRef.current = pan;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const attachActionBusyRef = useRef(false);
  const [attachBusy, setAttachBusy] = useState<'download' | 'print' | null>(null);

  const current = items[index];

  const setPdfNumPagesStable = useCallback((n: number) => {
    setPdfNumPages(Math.max(1, n));
  }, []);

  const applyZoomStep = useCallback((scaleDelta: number, pointer: { x: number; y: number } | null) => {
    const el = wheelTargetRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const result = zoomPreviewAtPointer(
      panRef.current,
      pointer,
      { width: rect.width, height: rect.height },
      scaleRef.current,
      scaleDelta,
      MIN_SCALE,
      MAX_SCALE,
      rotationRef.current
    );
    if (!result) return;
    setPan(result.pan);
    setScale(result.scale);
  }, []);

  const applyZoomStepRef = useRef(applyZoomStep);
  applyZoomStepRef.current = applyZoomStep;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setIndex(clamp(initialIndex, 0, Math.max(0, items.length - 1)));
  }, [initialIndex, items.length, itemsKey]);

  useEffect(() => {
    setScale(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setPdfPage(1);
    setPdfNumPages(1);
  }, [index]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const cur = items[index];
      const isPdf = cur?.kind === 'pdf';

      const pdfPageNav = isPdf && pdfNumPages > 1;
      if (pdfPageNav) {
        if (
          e.key === 'PageDown' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowRight'
        ) {
          e.preventDefault();
          setPdfPage((p) => Math.min(pdfNumPages, p + 1));
          return;
        }
        if (
          e.key === 'PageUp' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowLeft'
        ) {
          e.preventDefault();
          setPdfPage((p) => Math.max(1, p - 1));
          return;
        }
      }

      if (items.length > 1 && !pdfPageNav) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setIndex((i) => (i - 1 + items.length) % items.length);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setIndex((i) => (i + 1) % items.length);
          return;
        }
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        applyZoomStepRef.current(ZOOM_STEP_BUTTON, null);
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        applyZoomStepRef.current(-ZOOM_STEP_BUTTON, null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, items.length, items, index, pdfNumPages]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + items.length) % items.length);
  }, [items.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % items.length);
  }, [items.length]);

  const pdfPagePrev = useCallback(() => {
    setPdfPage((p) => Math.max(1, p - 1));
  }, []);

  const pdfPageNext = useCallback(() => {
    setPdfPage((p) => Math.min(pdfNumPages, p + 1));
  }, [pdfNumPages]);

  const zoomIn = useCallback(() => {
    applyZoomStep(ZOOM_STEP_BUTTON, null);
  }, [applyZoomStep]);

  const zoomOut = useCallback(() => {
    applyZoomStep(-ZOOM_STEP_BUTTON, null);
  }, [applyZoomStep]);

  const rotateCw = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  const rotateCcw = useCallback(() => {
    setRotation((r) => (r - 90 + 360) % 360);
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleDownload = useCallback(async () => {
    const cur = items[index];
    if (!cur || attachActionBusyRef.current) return;
    attachActionBusyRef.current = true;
    setAttachBusy('download');
    try {
      await downloadServiceFilePreviewBlob(cur.url, cur.fileName);
    } catch {
      window.alert('다운로드에 실패했습니다.');
    } finally {
      attachActionBusyRef.current = false;
      setAttachBusy(null);
    }
  }, [items, index]);

  const handlePrint = useCallback(async () => {
    const cur = items[index];
    if (!cur || attachActionBusyRef.current) return;
    attachActionBusyRef.current = true;
    setAttachBusy('print');
    try {
      await printServiceFilePreviewBlob(cur.url, cur.fileName, cur.kind);
    } catch (e) {
      const blocked = e instanceof Error && e.message === 'popup blocked';
      window.alert(
        blocked
          ? '팝업이 차단되어 PDF 인쇄 창을 열 수 없습니다. 팝업을 허용한 뒤 다시 시도해 주세요.'
          : '인쇄를 시작하지 못했습니다.'
      );
    } finally {
      attachActionBusyRef.current = false;
      setAttachBusy(null);
    }
  }, [items, index]);

  useEffect(() => {
    if (!mounted) return;
    const el = wheelTargetRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY > 0 ? -ZOOM_STEP_WHEEL : ZOOM_STEP_WHEEL;
      applyZoomStepRef.current(delta, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [mounted]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    draggingRef.current = false;
    setDragging(false);
  }, []);

  if (!mounted || typeof document === 'undefined') return null;

  if (items.length === 0 || current == null) return null;

  const canNav = items.length > 1;
  const scalePct = Math.round(scale * 100);
  const isPdf = current.kind === 'pdf';
  const canPdfPage = isPdf && pdfNumPages > 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex flex-col bg-black/92"
      role="dialog"
      aria-modal="true"
      aria-label="첨부 미리보기"
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-white sm:px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium sm:text-sm" title={current.fileName}>
          {current.fileName}
          {isPdf && pdfNumPages >= 1 ? (
            <span className="ml-2 font-normal text-white/55">
              (페이지 {pdfPage} / {pdfNumPages})
            </span>
          ) : null}
          {canNav ? (
            <span className="ml-2 font-normal text-white/55">
              · 파일 {index + 1} / {items.length}
            </span>
          ) : null}
        </span>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={attachBusy != null}
            className={toolbarBtnClass(attachBusy != null)}
            title="다운로드"
            aria-label="다운로드"
          >
            {attachBusy === 'download' ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-5 w-5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handlePrint()}
            disabled={attachBusy != null}
            className={toolbarBtnClass(attachBusy != null)}
            title="인쇄"
            aria-label="인쇄"
          >
            {attachBusy === 'print' ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <Printer className="h-5 w-5" aria-hidden />
            )}
          </button>
          <span className="mx-0.5 hidden h-5 w-px bg-background/25 sm:block" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-background/10"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        ref={wheelTargetRef}
        className={cn(
          'relative min-h-0 flex-1 touch-none select-none',
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* flex 오버플로 치우침 방지 — 화면 정중앙에 맞춤 */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute left-1/2 top-1/2 flex max-h-[85vh] max-w-[96vw] items-center justify-center"
            onDoubleClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
            style={{
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${scale})`,
              transformOrigin: 'center center',
            }}
          >
            {current.kind === 'image' ? (
              /* eslint-disable-next-line @next/next/no-img-element -- 인증 URL 미리보기 */
              <img
                key={current.fileName}
                src={current.url}
                alt=""
                draggable={false}
                className="block h-auto w-auto max-h-[85vh] max-w-[96vw] object-contain shadow-2xl"
              />
            ) : (
              <ServiceFilePdfPreviewStage
                key={current.url}
                url={current.url}
                pageNumber={pdfPage}
                onPagesReady={setPdfNumPagesStable}
              />
            )}
          </div>
        </div>
      </div>

      <div
        className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-t border-white/10 px-2 py-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={toolbarBtnClass(!canNav)}
          onClick={goPrev}
          disabled={!canNav}
          title="이전 파일 (←)"
          aria-label="이전 파일"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={toolbarBtnClass(!canNav)}
          onClick={goNext}
          disabled={!canNav}
          title="다음 파일 (→)"
          aria-label="다음 파일"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <span className="mx-1 hidden h-5 w-px bg-background/20 sm:block" aria-hidden />
        <button
          type="button"
          className={toolbarBtnClass(!canPdfPage)}
          onClick={pdfPagePrev}
          disabled={!canPdfPage}
          title="PDF 이전 페이지 (↑ / Page Up)"
          aria-label="PDF 이전 페이지"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={toolbarBtnClass(!canPdfPage)}
          onClick={pdfPageNext}
          disabled={!canPdfPage}
          title="PDF 다음 페이지 (↓ / Page Down)"
          aria-label="PDF 다음 페이지"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        <span className="mx-1 hidden h-5 w-px bg-background/20 sm:block" aria-hidden />
        <button type="button" className={toolbarBtnClass()} onClick={zoomOut} title="축소 (-)" aria-label="축소">
          <ZoomOut className="h-5 w-5" />
        </button>
        <span className="min-w-[3rem] text-center text-[11px] tabular-nums text-white/80">{scalePct}%</span>
        <button type="button" className={toolbarBtnClass()} onClick={zoomIn} title="확대 (+)" aria-label="확대">
          <ZoomIn className="h-5 w-5" />
        </button>
        <span className="mx-1 hidden h-5 w-px bg-background/20 sm:block" aria-hidden />
        <button type="button" className={toolbarBtnClass()} onClick={rotateCcw} title="반시계 회전" aria-label="반시계 방향 회전">
          <RotateCcw className="h-5 w-5" />
        </button>
        <button type="button" className={toolbarBtnClass()} onClick={rotateCw} title="시계 회전" aria-label="시계 방향 회전">
          <RotateCw className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={toolbarBtnClass()}
          onClick={resetView}
          title="보기 초기화 (더블클릭과 동일)"
          aria-label="확대·이동·회전 초기화"
        >
          <Maximize2 className="h-5 w-5" />
        </button>
      </div>
      <p className="shrink-0 px-3 pb-2 text-center text-[10px] text-white/45">
        휠로 확대·축소
        {' · 확대 시 끌어서 이동 · 더블클릭 시 초기화'}
        {canNav && !canPdfPage ? ' · ← → 이전·다음 파일' : ''}
        {canPdfPage ? ' · 방향키로 이전·다음 페이지' : ''}
      </p>
    </div>,
    document.body
  );
}
