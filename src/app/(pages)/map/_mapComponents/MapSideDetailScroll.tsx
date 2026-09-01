'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * 상세 패널 본문 스크롤 영역.
 * 내용이 넘칠 때만 세로 스크롤·오른쪽 여유(10px) — 스크롤 없으면 여백·스크롤바 없음.
 */
export type MapSideDetailScrollProps = ComponentPropsWithoutRef<'div'>;

export function MapSideDetailScroll({
  className,
  children,
  ...rest
}: MapSideDetailScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowY, setOverflowY] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      setOverflowY(el.scrollHeight > el.clientHeight + 1);
    };

    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', check);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', check);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        'scrollbar-thin min-h-0',
        overflowY ? 'mr-[10px] overflow-y-auto overscroll-contain' : '!mr-0 overflow-y-hidden',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
