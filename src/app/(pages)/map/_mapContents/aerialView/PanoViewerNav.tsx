'use client';

import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  fileName: string;
  index: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** 오버레이(어두운 배경) / 라이트 */
  tone?: 'dark' | 'light';
  className?: string;
};

/**
 * 파노라마 뷰어 이전·다음 UI — 하단 컨트롤 바 + 좌우 화살표.
 */
export function PanoViewerNav({
  fileName,
  index,
  total,
  canPrev,
  canNext,
  onPrev,
  onNext,
  tone = 'dark',
  className,
}: Props) {
  const dark = tone === 'dark';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPrev, onNext]);

  if (total <= 0 || index < 0) return null;

  return (
    <div className={cn('pointer-events-none absolute inset-0 z-10', className)}>
      {/* 좌우 화살표 */}
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev}
        className={cn(
          'pointer-events-auto absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-all',
          'disabled:pointer-events-none disabled:opacity-0',
          dark
            ? 'border border-white/15 bg-black/45 text-white shadow-lg backdrop-blur-md hover:scale-105 hover:bg-black/65'
            : 'border border-slate-200/80 bg-white/90 text-slate-700 shadow-md backdrop-blur-md hover:scale-105 hover:bg-white'
        )}
        title="이전 파일 (←)"
        aria-label="이전 파일"
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={2.25} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className={cn(
          'pointer-events-auto absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-all',
          'disabled:pointer-events-none disabled:opacity-0',
          dark
            ? 'border border-white/15 bg-black/45 text-white shadow-lg backdrop-blur-md hover:scale-105 hover:bg-black/65'
            : 'border border-slate-200/80 bg-white/90 text-slate-700 shadow-md backdrop-blur-md hover:scale-105 hover:bg-white'
        )}
        title="다음 파일 (→)"
        aria-label="다음 파일"
      >
        <ChevronRight className="h-5 w-5" strokeWidth={2.25} />
      </button>

      {/* 하단 글래스 컨트롤 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/55 via-black/20 to-transparent px-4 pb-4 pt-16">
        <div
          className={cn(
            'pointer-events-auto flex max-w-[min(100%,28rem)] items-center gap-2 rounded-2xl px-2 py-1.5 shadow-xl backdrop-blur-md',
            dark
              ? 'border border-white/15 bg-slate-950/70'
              : 'border border-slate-200/90 bg-white/95'
          )}
        >
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11px] font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-35',
              dark
                ? 'text-slate-100 hover:bg-white/10'
                : 'text-slate-700 hover:bg-slate-100'
            )}
            title="이전 파일 (←)"
            aria-label="이전 파일"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            이전
          </button>

          <div
            className={cn(
              'min-w-0 flex-1 px-1 text-center',
              dark ? 'text-slate-100' : 'text-slate-800'
            )}
          >
            <p className="truncate text-[11px] font-medium leading-tight">{fileName}</p>
            <p
              className={cn(
                'mt-0.5 text-[10px] tabular-nums',
                dark ? 'text-slate-400' : 'text-slate-500'
              )}
            >
              {index + 1}
              <span className="mx-0.5 opacity-50">/</span>
              {total}
            </p>
          </div>

          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11px] font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-35',
              dark
                ? 'text-slate-100 hover:bg-white/10'
                : 'text-slate-700 hover:bg-slate-100'
            )}
            title="다음 파일 (→)"
            aria-label="다음 파일"
          >
            다음
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
