'use client';

import '@/app/(pages)/map/_mapComponents/config/projections';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Overlay from 'ol/Overlay';
import { getTransform } from 'ol/proj';
import { Download, X } from 'lucide-react';
import { useMapContext } from '../../_mapComponents/MapContext';
import { ServiceFileImagePreview } from '../../_mapComponents/standard/ServiceFileImagePreview';
import { fileCoord5181 } from './aerialLocationParse';
import type { WorkFileItem } from './aerialMediaTypes';

const to3857 = getTransform('EPSG:5181', 'EPSG:3857');

function mediaUrl(relativePath: string, opts?: { download?: boolean; width?: number }): string {
  const q = new URLSearchParams({ path: relativePath.replace(/\\/g, '/') });
  if (opts?.download) q.set('download', '1');
  if (opts?.width) q.set('w', String(opts.width));
  return `/api/aerial/media?${q.toString()}`;
}

/**
 * 리스트에서 그린 촬영 위치 점 위 작은 미리보기.
 * 넓은 파일 상세 대신 좌표에 첨부파일과 짧은 정보만 붙인다.
 */
export function AerialMediaPointPopup({
  file,
  files = [],
  workName,
  workDate,
  onClose,
}: {
  file: WorkFileItem;
  /** 같은 작업단위 이미지 — 확대 뷰어 이전/다음 */
  files?: WorkFileItem[];
  workName: string;
  workDate: string;
  onClose: () => void;
}) {
  const mapContext = useMapContext();
  const mapReady = Boolean(mapContext?.mapReady);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const isVideo = file.previewKind === 'video' || file.format === 'mp4' || file.format === 'mov';
  const src = file.relativePath ? mediaUrl(file.relativePath, { width: 560 }) : null;
  const place = file.locationLabel?.trim() || '';
  const galleryItems = (files.length > 0 ? files : [file])
    .filter((item) => item.previewKind !== 'video' && item.relativePath)
    .filter((item) => item.format !== 'mp4' && item.format !== 'mov')
    .map((item) => ({
      url: mediaUrl(item.relativePath!),
      fileName: item.name,
      kind: 'image' as const,
    }));
  const viewerInitialIndex = Math.max(
    0,
    galleryItems.findIndex((item) => item.fileName === file.name)
  );

  useEffect(() => {
    setViewerOpen(false);
  }, [file.id]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;
    const el = document.createElement('div');
    el.className = 'pointer-events-auto';
    const overlay = new Overlay({
      element: el,
      positioning: 'bottom-center',
      offset: [0, -14],
      stopEvent: true,
    });
    map.addOverlay(overlay);
    const coord = fileCoord5181(file);
    if (coord) {
      const c = to3857(coord, undefined, undefined) as [number, number];
      if (Number.isFinite(c[0]) && Number.isFinite(c[1])) overlay.setPosition(c);
    }
    setHost(el);
    return () => {
      map.removeOverlay(overlay);
      setHost(null);
    };
  }, [mapReady, mapContext?.mapInstanceRef, file]);

  if (!host) return null;

  const download = () => {
    if (!file.relativePath) {
      window.alert('다운로드 경로가 없습니다.');
      return;
    }
    const a = document.createElement('a');
    a.href = mediaUrl(file.relativePath, { download: true });
    a.download = file.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return createPortal(
    <>
      <div className="flex w-[280px] flex-col items-center drop-shadow-[0_8px_18px_rgba(15,23,42,0.22)]">
        <div className="w-full overflow-hidden rounded-2xl border-2 border-slate-700 bg-background shadow-md dark:border-white/80">
          <div className="relative h-[168px] bg-slate-950">
            {src && !isVideo ? (
              <button
                type="button"
                className="group relative block h-full w-full cursor-zoom-in"
                title="클릭하여 크게 보기"
                onClick={() => {
                  if (galleryItems.length > 0) setViewerOpen(true);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 인증 쿠키 포함 미디어 */}
                <img src={src} alt={file.name} className="h-full w-full object-cover" />
                <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/15" />
              </button>
            ) : src && isVideo ? (
              <video
                key={src}
                src={src}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full bg-black object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-slate-300">
                미리보기 없음
              </div>
            )}
            <button
              type="button"
              aria-label="닫기"
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="다운로드"
              title="다운로드"
              className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65 disabled:opacity-40"
              disabled={!file.relativePath}
              onClick={download}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-0.5 px-2.5 py-2">
            <p className="break-words text-[11px] leading-4 text-foreground">{file.name}</p>
            {workName ? (
              <p className="break-words text-[10px] leading-4 text-muted-foreground">{workName}</p>
            ) : null}
            {workDate ? (
              <p className="break-words text-[10px] leading-4 text-muted-foreground">촬영일 {workDate}</p>
            ) : null}
            {place ? (
              <p className="break-words text-[10px] leading-4 text-muted-foreground">{place}</p>
            ) : null}
          </div>
        </div>
        <div className="-mt-px h-0 w-0 border-x-8 border-t-8 border-x-transparent border-t-background" />
      </div>
      {viewerOpen && galleryItems.length > 0 ? (
        <ServiceFileImagePreview
          items={galleryItems}
          initialIndex={viewerInitialIndex}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </>,
    host
  );
}
