'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { serviceFileDataDownloadUrl, type ServiceFileDataSerEng } from './useServiceFileData';
import { getPdfPageThumbDataUrl } from './renderPdfPageThumb';

const box = { sm: 'h-8 w-8', md: 'h-9 w-9' } as const;
const iconSz = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4' } as const;

/** 목록 셀에 맞게 첫 페이지만 작게 렌더 */
const THUMB_MAX_DEFAULT = 144;

type Phase = 'loading' | 'ready' | 'error';

/**
 * 첨부 PDF 첫 페이지 썸네일. 인증 쿠키 포함 fetch 후 pdfjs로 렌더.
 */
export function ServiceFilePdfThumb({
  serEng,
  layerSegment,
  keyValue,
  fileName,
  subfolder,
  size = 'sm',
  className,
  /** 픽셀 기준 긴 변 상한 (클수록 고해상도, 렌더 비용 증가) */
  thumbMaxPx = THUMB_MAX_DEFAULT,
  /** true면 고정 sm/md 박스 대신 부모 높이·너비를 가득 채움 */
  unboxed = false,
}: {
  serEng: ServiceFileDataSerEng;
  layerSegment: string;
  keyValue: string | number;
  fileName: string;
  subfolder?: string | null;
  size?: 'sm' | 'md';
  className?: string;
  thumbMaxPx?: number;
  unboxed?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const url = serviceFileDataDownloadUrl(serEng, layerSegment, keyValue, fileName, { subfolder });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setPhase('loading');
    setDataUrl(null);

    const ac = new AbortController();
    void getPdfPageThumbDataUrl(url, 1, thumbMaxPx, ac.signal)
      .then((thumb) => {
        if (!alive.current) return;
        setDataUrl(thumb);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setPhase('error');
      });

    return () => {
      alive.current = false;
      ac.abort();
    };
  }, [url, thumbMaxPx]);

  const frameClass = unboxed
    ? 'relative h-full w-full min-h-0 min-w-0 overflow-hidden'
    : cn('relative shrink-0 overflow-hidden rounded border border-border bg-muted/40', box[size]);

  if (phase === 'error') {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-rose-100',
          unboxed ? 'h-full w-full rounded-none' : cn('shrink-0 rounded', box[size]),
          className
        )}
        title="PDF 미리보기를 불러올 수 없습니다"
      >
        <FileText className={cn('text-rose-600', unboxed ? 'h-10 w-10' : iconSz[size])} aria-hidden />
      </div>
    );
  }

  if (phase === 'ready' && dataUrl != null) {
    return (
      <div className={cn(frameClass, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL 썸네일 */}
        <img src={dataUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center bg-muted/30',
        unboxed ? 'h-full w-full rounded-none' : cn('shrink-0 rounded border border-border', box[size]),
        className
      )}
      aria-hidden
    >
      <Loader2 className={cn('animate-spin text-muted-foreground', unboxed ? 'h-8 w-8' : iconSz[size])} />
    </div>
  );
}
