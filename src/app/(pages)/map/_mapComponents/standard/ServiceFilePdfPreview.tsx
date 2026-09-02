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
  Menu,
  XCircle,
  GalleryVertical,
  GalleryHorizontal,
  GalleryVerticalEnd,
  GalleryThumbnails,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { zoomPreviewAtPointer } from './previewZoomAtCursor';
import {
  ServiceFilePdfPreviewStage,
  type PdfPreviewFitMode,
} from './ServiceFilePdfPreviewStage';
import { ServiceFilePdfContinuousView } from './ServiceFilePdfContinuousView';
import { ServiceFilePdfPageThumb, PDF_PAGE_THUMB_DISPLAY_PX } from './ServiceFilePdfPageThumb';
import {
  downloadServiceFilePreviewBlob,
  downloadServiceFilePreviewItemsZip,
  buildServiceFilePreviewListZipName,
  printServiceFilePreviewBlob,
} from './ServiceFileImagePreview';
import { setPdfViewerFocusUrl, getCachedPdfNumPages, prefetchPdfDocument } from './pdfDocumentCache';

export type ServiceFilePdfPreviewItem = {
  url: string;
  fileName: string;
};

type Props = {
  items: ServiceFilePdfPreviewItem[];
  initialIndex: number;
  onClose: () => void;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP_WHEEL = 0.18;
const ZOOM_STEP_BUTTON = 0.35;
const SIDEBAR_WIDTH = 240;
/** 휠·버튼 줌 멈춘 뒤 LOD 재렌더 대기(ms) */
const LOD_SETTLE_MS = 350;
/** display·render 배율 차이가 이 값 미만이면 재렌더 생략 */
const LOD_RENDER_THRESHOLD = 0.12;

type PdfViewMode = 'single' | 'continuous';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toolbarBtnClass(disabled?: boolean, active?: boolean): string {
  return cn(
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-background/10',
    active && 'bg-background/15 text-white ring-1 ring-inset ring-white/20',
    disabled && 'pointer-events-none opacity-35'
  );
}

/**
 * PDF 전용 전체화면 뷰어 — 사이드바(PDF 목록·페이지 썸네일) + 확대·패닝·회전·인쇄.
 */
export function ServiceFilePdfPreview({ items, initialIndex, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const itemsKey = useMemo(() => items.map((i) => i.fileName).join('\n'), [items]);

  const maxIdx = Math.max(0, items.length - 1);
  const [index, setIndex] = useState(() => clamp(initialIndex, 0, maxIdx));
  const [scale, setScale] = useState(1);
  /** LOD — canvas에 bake된 배율 (휠 중에는 scale만 변하고 멈추면 동기화) */
  const [renderScale, setRenderScale] = useState(1);
  const [fitMode, setFitMode] = useState<PdfPreviewFitMode>('page');
  const [viewMode, setViewMode] = useState<PdfViewMode>('single');
  const scaleRef = useRef(1);
  scaleRef.current = scale;
  const panRef = useRef(pan);
  panRef.current = pan;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const viewModeRef = useRef<PdfViewMode>('single');
  viewModeRef.current = viewMode;
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfPagesLoading, setPdfPagesLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pdfListSearchDraft, setPdfListSearchDraft] = useState('');
  const [pdfListSearch, setPdfListSearch] = useState('');
  const [pdfListSectionOpen, setPdfListSectionOpen] = useState(true);
  const [pageInput, setPageInput] = useState('1');
  /** 연속 보기 — 사이드바·툴바 등 명시적 페이지 이동 시에만 스크롤 */
  const [continuousScrollToken, setContinuousScrollToken] = useState(0);
  /** 메인 canvas 첫 렌더 완료 — 썸네일 등 부가 로드 지연 */
  const [mainCanvasReady, setMainCanvasReady] = useState(false);

  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const wheelTargetRef = useRef<HTMLDivElement>(null);
  const pageThumbScrollRef = useRef<HTMLDivElement>(null);
  const wheelNavRef = useRef({ viewMode: 'single' as PdfViewMode });
  wheelNavRef.current = { viewMode };
  const continuousScrollRef = useRef<HTMLDivElement | null>(null);
  const attachActionBusyRef = useRef(false);
  const [attachBusy, setAttachBusy] = useState<'download' | 'print' | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  const current = items[index];

  const setPdfNumPagesStable = useCallback((n: number) => {
    setPdfNumPages(Math.max(1, n));
    setPdfPagesLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    setPdfViewerFocusUrl(null);
    onClose();
  }, [onClose]);

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
    const item = items[index];
    const cachedPages = item?.url ? getCachedPdfNumPages(item.url) : null;

    setScale(1);
    setRenderScale(1);
    setFitMode('page');
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setPdfPage(1);
    setPageInput('1');
    setMainCanvasReady(false);

    if (cachedPages != null) {
      setPdfNumPages(cachedPages);
      setPdfPagesLoading(false);
    } else {
      setPdfNumPages(0);
      setPdfPagesLoading(true);
    }
  }, [index, items]);

  useEffect(() => {
    if (!current?.url) return;
    for (const ni of [index - 1, index + 1]) {
      const neighbor = items[ni]?.url;
      if (neighbor) prefetchPdfDocument(neighbor);
    }
  }, [index, items, current?.url]);

  useEffect(() => {
    if (current?.url) setPdfViewerFocusUrl(current.url);
  }, [current?.url]);

  useEffect(() => {
    return () => setPdfViewerFocusUrl(null);
  }, []);

  /** 단일 페이지 모드: 페이지 전환 시 이동만 초기화 (확대율 유지) */
  useEffect(() => {
    if (viewMode !== 'single') return;
    setPan({ x: 0, y: 0 });
  }, [pdfPage, viewMode]);

  /** 파일 변경 시 보기·줌 초기화 */
  useEffect(() => {
    setScale(1);
    setRenderScale(1);
    setPan({ x: 0, y: 0 });
    setMainCanvasReady(false);
  }, [current?.url]);

  const handleMainCanvasReady = useCallback(() => {
    setMainCanvasReady(true);
  }, []);

  /** 2단계 LOD: 휠·버튼 줌 멈춘 뒤 renderScale 확정 → canvas 재렌더 */
  useEffect(() => {
    const id = window.setTimeout(() => {
      const target = scaleRef.current;
      setRenderScale((prev) => {
        if (Math.abs(target - prev) < LOD_RENDER_THRESHOLD) return prev;
        return target;
      });
    }, LOD_SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [scale]);

  useEffect(() => {
    setPageInput(String(pdfPage));
  }, [pdfPage]);

  const commitPdfListSearch = useCallback(() => {
    setPdfListSearch(pdfListSearchDraft.trim());
  }, [pdfListSearchDraft]);

  const clearPdfListSearch = useCallback(() => {
    setPdfListSearchDraft('');
    setPdfListSearch('');
  }, []);

  const filteredFileEntries = useMemo(() => {
    const q = pdfListSearch.trim().toLowerCase();
    return items
      .map((item, fileIndex) => ({ item, fileIndex }))
      .filter(({ item }) => !q || item.fileName.toLowerCase().includes(q));
  }, [items, pdfListSearch]);

  const navigateToPdfPage = useCallback(
    (n: number) => {
      const next = clamp(n, 1, Math.max(1, pdfNumPages));
      if (viewMode === 'continuous') {
        setContinuousScrollToken((t) => t + 1);
      }
      setPdfPage(next);
      setPageInput(String(next));
    },
    [pdfNumPages, viewMode]
  );

  const commitPageInput = useCallback(() => {
    const n = parseInt(pageInput.trim(), 10);
    if (!Number.isFinite(n)) {
      setPageInput(String(pdfPage));
      return;
    }
    navigateToPdfPage(clamp(n, 1, Math.max(1, pdfNumPages)));
  }, [pageInput, pdfPage, pdfNumPages, navigateToPdfPage]);

  useEffect(() => {
    const el = pageThumbScrollRef.current?.querySelector(`[data-page="${pdfPage}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pdfPage, index]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
        return;
      }

      const pdfPageArrowNav =
        viewModeRef.current === 'single' && pdfNumPages > 1;

      if (viewModeRef.current === 'continuous') {
        const scrollEl = continuousScrollRef.current;
        if (scrollEl && pdfNumPages > 1) {
          if (e.key === 'PageDown' || e.key === 'ArrowDown') {
            e.preventDefault();
            scrollEl.scrollBy({ top: scrollEl.clientHeight * 0.85, behavior: 'smooth' });
            return;
          }
          if (e.key === 'PageUp' || e.key === 'ArrowUp') {
            e.preventDefault();
            scrollEl.scrollBy({ top: -scrollEl.clientHeight * 0.85, behavior: 'smooth' });
            return;
          }
        }
      } else if (pdfNumPages > 1) {
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

      if (items.length > 1 && !pdfPageArrowNav) {
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
  }, [handleClose, items.length, pdfNumPages]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + items.length) % items.length);
  }, [items.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % items.length);
  }, [items.length]);

  const pdfPagePrev = useCallback(() => {
    navigateToPdfPage(pdfPage - 1);
  }, [navigateToPdfPage, pdfPage]);

  const pdfPageNext = useCallback(() => {
    navigateToPdfPage(pdfPage + 1);
  }, [navigateToPdfPage, pdfPage]);

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
    setFitMode('page');
    setScale(1);
    setRenderScale(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, []);

  const fitPage = useCallback(() => {
    setFitMode('page');
    setScale(1);
    setRenderScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const fitWidth = useCallback(() => {
    setFitMode('width');
    setScale(1);
    setRenderScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode((m) => (m === 'single' ? 'continuous' : 'single'));
    setPan({ x: 0, y: 0 });
  }, []);

  const onContinuousVisiblePageChange = useCallback((n: number) => {
    setPdfPage((prev) => (prev === n ? prev : n));
  }, []);

  const selectFile = useCallback((fileIndex: number) => {
    setIndex(clamp(fileIndex, 0, Math.max(0, items.length - 1)));
  }, [items.length]);

  const handleDownloadCurrent = useCallback(async () => {
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

  const handleDownloadAll = useCallback(async () => {
    if (items.length === 0 || attachActionBusyRef.current) return;
    attachActionBusyRef.current = true;
    setAttachBusy('download');
    try {
      await downloadServiceFilePreviewItemsZip(items, buildServiceFilePreviewListZipName(items, index));
    } catch {
      window.alert('ZIP 다운로드에 실패했습니다.');
    } finally {
      attachActionBusyRef.current = false;
      setAttachBusy(null);
    }
  }, [items, index]);

  const onDownloadButtonClick = useCallback(() => {
    if (items.length >= 2) {
      setDownloadMenuOpen((o) => !o);
      return;
    }
    void handleDownloadCurrent();
  }, [items.length, handleDownloadCurrent]);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (downloadMenuRef.current?.contains(e.target as Node)) return;
      setDownloadMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [downloadMenuOpen]);

  useEffect(() => {
    setDownloadMenuOpen(false);
  }, [index, itemsKey]);

  const handlePrint = useCallback(async () => {
    const cur = items[index];
    if (!cur || attachActionBusyRef.current) return;
    attachActionBusyRef.current = true;
    setAttachBusy('print');
    try {
      await printServiceFilePreviewBlob(cur.url, cur.fileName, 'pdf');
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
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isEditableTarget(e.target)) return;
      spaceHeldRef.current = true;
      setSpaceHeld(true);
      if (viewModeRef.current === 'single') e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const el = wheelTargetRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      const { viewMode: mode } = wheelNavRef.current;
      const zoomWithWheel = e.ctrlKey || e.metaKey;

      if (mode === 'continuous' && !zoomWithWheel) {
        return;
      }

      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY > 0 ? -ZOOM_STEP_WHEEL : ZOOM_STEP_WHEEL;
      applyZoomStepRef.current(delta, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheelNative, { capture: true });
  }, [mounted]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!(e.altKey || spaceHeldRef.current)) return;
    e.preventDefault();
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

  const pageNumbers = useMemo(() => {
    if (pdfPagesLoading || pdfNumPages < 1) return [];
    return Array.from({ length: pdfNumPages }, (_, i) => i + 1);
  }, [pdfNumPages, pdfPagesLoading]);

  if (!mounted || typeof document === 'undefined') return null;
  if (items.length === 0 || current == null) return null;

  const canNav = items.length > 1;
  const scalePct = Math.round(scale * 100);
  const canPdfPage = pdfNumPages > 1;
  const isAtBaseZoom = Math.abs(scale - 1) < 0.02;
  const isPageFitActive = fitMode === 'page' && isAtBaseZoom;
  const isWidthFitActive = fitMode === 'width' && isAtBaseZoom;

  const cssZoomRatio = renderScale > 0 ? scale / renderScale : scale;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex flex-col bg-black/92"
      role="dialog"
      aria-modal="true"
      aria-label="PDF 미리보기"
    >
      <div
        className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2 text-white sm:px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setSidebarOpen((o) => !o)}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-background/10',
            sidebarOpen ? 'bg-background/10 text-white' : 'text-white/80'
          )}
          title={sidebarOpen ? '목록 닫기' : '목록 열기'}
          aria-label={sidebarOpen ? '목록 닫기' : '목록 열기'}
          aria-expanded={sidebarOpen}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium sm:text-sm" title={current.fileName}>
          {current.fileName}
        </span>
        <div className="relative flex shrink-0 items-center gap-0.5 sm:gap-1" ref={downloadMenuRef}>
          <button
            type="button"
            onClick={onDownloadButtonClick}
            disabled={attachBusy != null}
            className={toolbarBtnClass(attachBusy != null)}
            title="다운로드"
            aria-label="다운로드"
            aria-expanded={items.length >= 2 ? downloadMenuOpen : undefined}
            aria-haspopup={items.length >= 2 ? 'menu' : undefined}
          >
            {attachBusy === 'download' ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-5 w-5" aria-hidden />
            )}
          </button>
          {downloadMenuOpen && items.length >= 2 ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1 min-w-[10.5rem] overflow-hidden rounded-md border border-white/15 bg-zinc-900 py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full cursor-pointer px-3 py-2 text-left text-[12px] text-white/90 transition-colors hover:bg-white/10"
                title="전체 다운로드"
                onClick={() => {
                  setDownloadMenuOpen(false);
                  void handleDownloadAll();
                }}
              >
                전체 다운로드
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full cursor-pointer px-3 py-2 text-left text-[12px] text-white/90 transition-colors hover:bg-white/10"
                title="현재 파일 다운로드"
                onClick={() => {
                  setDownloadMenuOpen(false);
                  void handleDownloadCurrent();
                }}
              >
                현재 파일 다운로드
              </button>
            </div>
          ) : null}
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
            onClick={handleClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-background/10"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            'shrink-0 overflow-hidden border-r border-white/10 bg-black/40 transition-[width,opacity] duration-200 ease-out',
            sidebarOpen ? 'opacity-100' : 'opacity-0'
          )}
          style={{ width: sidebarOpen ? SIDEBAR_WIDTH : 0 }}
        >
          <div
            className="flex h-full flex-col"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <div className="shrink-0 border-b border-white/10 px-2 py-2">
              <button
                type="button"
                onClick={() => setPdfListSectionOpen((o) => !o)}
                className={cn(
                  'flex w-full cursor-pointer items-baseline justify-between gap-2 rounded px-0.5 py-0.5 text-left transition-colors hover:bg-white/5',
                  pdfListSectionOpen ? 'mb-2' : 'mb-0'
                )}
                title={pdfListSectionOpen ? 'PDF 목록 접기' : 'PDF 목록 펼치기'}
                aria-expanded={pdfListSectionOpen}
                aria-label={pdfListSectionOpen ? 'PDF 목록 접기' : 'PDF 목록 펼치기'}
              >
                <span className="flex min-w-0 items-center gap-1">
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-white/55 transition-transform duration-200',
                      !pdfListSectionOpen && '-rotate-90'
                    )}
                    aria-hidden
                  />
                  <span className="text-[12px] font-semibold text-white/80">PDF 목록</span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-white/55">총 {items.length}건</span>
              </button>
              {pdfListSectionOpen ? (
                <>
              <div className="relative mb-2">
                <input
                  type="text"
                  value={pdfListSearchDraft}
                  onChange={(e) => setPdfListSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitPdfListSearch();
                    }
                  }}
                  placeholder="파일명 검색 (Enter)"
                  className="h-8 w-full rounded border border-white/15 bg-white/5 py-1 pl-2 pr-8 text-[11px] text-white placeholder:text-white/35 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
                  aria-label="PDF 파일명 검색"
                />
                {pdfListSearchDraft.trim() !== '' || pdfListSearch.trim() !== '' ? (
                  <button
                    type="button"
                    onClick={clearPdfListSearch}
                    className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                    title="검색 초기화"
                    aria-label="검색 초기화"
                  >
                    <XCircle className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              <ul className="max-h-[28vh] space-y-0.5 overflow-y-auto">
                {pdfListSearch.trim() !== '' && filteredFileEntries.length === 0 ? (
                  <li className="px-2 py-2 text-[11px] text-white/45">검색 결과가 없습니다.</li>
                ) : (
                  filteredFileEntries.map(({ item, fileIndex }) => (
                    <li key={item.fileName}>
                      <button
                        type="button"
                        onClick={() => selectFile(fileIndex)}
                        title={item.fileName}
                        className={cn(
                          'w-full truncate rounded px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-white/10',
                          fileIndex === index
                            ? 'border-l-[3px] border-l-primary bg-primary/15 text-white'
                            : 'text-white/75'
                        )}
                      >
                        {item.fileName}
                      </button>
                    </li>
                  ))
                )}
              </ul>
                </>
              ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-2 py-2">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-[12px] font-semibold text-white/80">페이지</p>
                <span className="shrink-0 text-[11px] tabular-nums text-white/55">
                  {pdfPagesLoading ? '로딩중...' : `총 ${pdfNumPages}건`}
                </span>
              </div>
              <div
                ref={pageThumbScrollRef}
                className="flex min-h-0 flex-1 flex-col items-center space-y-1.5 overflow-y-auto pb-2"
              >
                {pdfPagesLoading ? (
                  <div className="flex flex-1 items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-white/40" aria-hidden />
                  </div>
                ) : null}
                {pageNumbers.map((pn) => (
                  <div key={`${current.url}-${pn}`} data-page={pn} className="flex w-full justify-center">
                    <ServiceFilePdfPageThumb
                      url={current.url}
                      pageNumber={pn}
                      active={pn === pdfPage}
                      priority={mainCanvasReady && pn === pdfPage}
                      loadEnabled={mainCanvasReady}
                      onClick={() => navigateToPdfPage(pn)}
                      thumbMaxPx={PDF_PAGE_THUMB_DISPLAY_PX}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          ref={wheelTargetRef}
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 flex-col',
            viewMode === 'single' &&
              (dragging ? 'cursor-grabbing touch-none' : spaceHeld ? 'cursor-grab' : 'cursor-auto'),
            viewMode === 'continuous' && 'cursor-auto'
          )}
          onPointerDown={viewMode === 'single' ? onPointerDown : undefined}
          onPointerMove={viewMode === 'single' ? onPointerMove : undefined}
          onPointerUp={viewMode === 'single' ? onPointerUp : undefined}
          onPointerCancel={viewMode === 'single' ? onPointerUp : undefined}
        >
          {viewMode === 'single' ? (
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="absolute left-1/2 top-1/2 flex max-h-[85vh] max-w-[96vw] items-center justify-center"
              onDoubleClick={(e) => {
                e.stopPropagation();
                resetView();
              }}
              style={{
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${cssZoomRatio})`,
                transformOrigin: 'center center',
              }}
            >
              <ServiceFilePdfPreviewStage
                key={current.url}
                url={current.url}
                pageNumber={pdfPage}
                fitMode={fitMode}
                renderScale={renderScale}
                onPagesReady={setPdfNumPagesStable}
                onMainCanvasReady={handleMainCanvasReady}
              />
            </div>
          </div>
          ) : (
            <ServiceFilePdfContinuousView
              url={current.url}
              fitMode={fitMode}
              renderScale={renderScale}
              cssZoomRatio={cssZoomRatio}
              rotation={rotation}
              pdfPage={pdfPage}
              scrollToPageToken={continuousScrollToken}
              onPagesReady={setPdfNumPagesStable}
              onVisiblePageChange={onContinuousVisiblePageChange}
              onMainCanvasReady={handleMainCanvasReady}
              scrollContainerRef={continuousScrollRef}
            />
          )}
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
          className={toolbarBtnClass(pdfNumPages < 1)}
          onClick={pdfPagePrev}
          disabled={pdfNumPages < 1 || pdfPage <= 1}
          title="PDF 이전 페이지 (↑ / Page Up)"
          aria-label="PDF 이전 페이지"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1 px-0.5">
          <input
            type="text"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPageInput();
              }
            }}
            onBlur={() => commitPageInput()}
            disabled={pdfNumPages < 1}
            className="h-8 w-10 rounded border border-white/20 bg-white/5 text-center text-[11px] tabular-nums text-white outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 disabled:opacity-40"
            title="페이지 번호 입력"
            aria-label="페이지 번호 입력"
          />
          <span className="text-[11px] tabular-nums text-white/55">
            / {pdfPagesLoading ? '…' : pdfNumPages}
          </span>
        </div>
        <button
          type="button"
          className={toolbarBtnClass(pdfNumPages < 1)}
          onClick={pdfPageNext}
          disabled={pdfNumPages < 1 || pdfPage >= pdfNumPages}
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
        <span className="mx-1 hidden h-5 w-px bg-background/20 sm:block" aria-hidden />
        <button
          type="button"
          className={toolbarBtnClass(false, isPageFitActive)}
          onClick={fitPage}
          title="페이지 맞춤"
          aria-label="페이지 맞춤"
          aria-pressed={isPageFitActive}
        >
          <GalleryVertical className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          className={toolbarBtnClass(false, isWidthFitActive)}
          onClick={fitWidth}
          title="너비 맞춤"
          aria-label="너비 맞춤"
          aria-pressed={isWidthFitActive}
        >
          <GalleryHorizontal className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          className={toolbarBtnClass()}
          onClick={toggleViewMode}
          title={viewMode === 'single' ? '페이지 보기' : '연속 보기'}
          aria-label={viewMode === 'single' ? '페이지 보기' : '연속 보기'}
        >
          {viewMode === 'single' ? (
            <GalleryThumbnails className="h-5 w-5" aria-hidden />
          ) : (
            <GalleryVerticalEnd className="h-5 w-5" aria-hidden />
          )}
        </button>
      </div>
      <p className="shrink-0 px-3 pb-2 text-center text-[10px] text-white/45">
        {viewMode === 'continuous'
          ? canPdfPage
            ? '스크롤로 페이지 이동 · Ctrl+휠 확대·축소'
            : '스크롤 · Ctrl+휠 확대·축소'
          : canPdfPage
            ? '휠로 확대·축소 · 방향키로 이전·다음 페이지'
            : '휠로 확대·축소'}
        {viewMode === 'single'
          ? ' · Space 또는 Alt+드래그로 화면 이동 · 더블클릭 시 초기화'
          : ''}
        {canNav && !canPdfPage ? ' · ← → 이전·다음 파일' : ''}
        {canPdfPage && viewMode === 'continuous' ? ' · ↑↓ 스크롤' : ''}
      </p>
    </div>,
    document.body
  );
}
