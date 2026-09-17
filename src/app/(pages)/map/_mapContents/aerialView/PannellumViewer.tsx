'use client';

import { useEffect, useRef, useState } from 'react';
import 'pannellum/build/pannellum.css';
import { cn } from '@/lib/utils';

type PannellumViewerApi = {
  destroy: () => void;
  resize?: () => void;
  getHfov?: () => number;
  setHfov?: (hfov: number) => void;
};

type PannellumGlobal = {
  viewer: (container: HTMLElement | string, config: Record<string, unknown>) => PannellumViewerApi;
};

declare global {
  interface Window {
    pannellum?: PannellumGlobal;
  }
}

export type PannellumViewerHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
};

type Props = {
  /** /api/aerial/media?... 등 equirectangular 이미지 URL */
  imageUrl: string;
  className?: string;
  onControlsReady?: (api: PannellumViewerHandle | null) => void;
};

/**
 * Pannellum equirectangular 뷰어 (클라이언트 전용).
 * 기본 줌·전체화면 버튼은 주소검색 등과 겹쳐 끄고, 휠 줌·하단 바 줌만 사용.
 */
export function PannellumViewer({ imageUrl, className, onControlsReady }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PannellumViewerApi | null>(null);
  const onControlsReadyRef = useRef(onControlsReady);
  onControlsReadyRef.current = onControlsReady;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready) {
      onControlsReadyRef.current?.(null);
      return;
    }
    const api: PannellumViewerHandle = {
      zoomIn: () => {
        const v = viewerRef.current;
        if (!v?.getHfov || !v?.setHfov) return;
        v.setHfov(Math.max(50, v.getHfov() - 12));
      },
      zoomOut: () => {
        const v = viewerRef.current;
        if (!v?.getHfov || !v?.setHfov) return;
        v.setHfov(Math.min(120, v.getHfov() + 12));
      },
    };
    onControlsReadyRef.current?.(api);
    return () => onControlsReadyRef.current?.(null);
  }, [ready]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReady(false);

    const destroy = () => {
      try {
        viewerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      viewerRef.current = null;
    };

    const boot = async () => {
      destroy();
      if (!imageUrl || !containerRef.current) return;

      try {
        await import('pannellum/build/pannellum.js');
      } catch {
        if (!cancelled) setError('파노라마 뷰어를 불러오지 못했습니다.');
        return;
      }
      if (cancelled || !containerRef.current || !window.pannellum) {
        if (!cancelled) setError('파노라마 뷰어를 불러오지 못했습니다.');
        return;
      }

      try {
        const viewer = window.pannellum.viewer(containerRef.current, {
          type: 'equirectangular',
          panorama: imageUrl,
          autoLoad: true,
          /** 주소검색·우측 메뉴와 겹치는 기본 컨트롤 비활성 */
          showFullscreenCtrl: false,
          showZoomCtrl: false,
          mouseZoom: true,
          compass: false,
          hfov: 100,
          minHfov: 50,
          maxHfov: 120,
          crossOrigin: 'use-credentials',
        });
        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;
        setReady(true);
        requestAnimationFrame(() => {
          try {
            viewer.resize?.();
          } catch {
            /* ignore */
          }
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '파노라마를 표시할 수 없습니다.');
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
      destroy();
    };
  }, [imageUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      try {
        viewerRef.current?.resize?.();
      } catch {
        /* ignore */
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  return (
    <div className={cn('relative h-full w-full min-h-0 bg-black', className)}>
      <div ref={containerRef} className="h-full w-full" />
      {error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-center text-[11px] text-rose-200">
          {error}
        </div>
      ) : null}
      {!ready && !error ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-slate-400">
          뷰어 로딩…
        </div>
      ) : null}
    </div>
  );
}

export default PannellumViewer;
