'use client';

import { useEffect, useRef, useState } from 'react';
import 'pannellum/build/pannellum.css';

type PannellumViewerApi = {
  destroy: () => void;
  resize?: () => void;
};

type PannellumGlobal = {
  viewer: (container: HTMLElement | string, config: Record<string, unknown>) => PannellumViewerApi;
};

declare global {
  interface Window {
    pannellum?: PannellumGlobal;
  }
}

type Props = {
  /** /api/aerial/media?... 등 equirectangular 이미지 URL */
  imageUrl: string;
  className?: string;
};

/**
 * Pannellum equirectangular 뷰어 (클라이언트 전용).
 * 이미지 URL이 바뀌면 뷰어를 다시 만든다.
 */
export function PannellumViewer({ imageUrl, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PannellumViewerApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
          showFullscreenCtrl: true,
          showZoomCtrl: true,
          compass: false,
          hfov: 100,
          minHfov: 50,
          maxHfov: 120,
          /** 동일 출처 인증 쿠키 유지 */
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
    <div className={className ?? 'relative h-full w-full min-h-0 bg-black'}>
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
