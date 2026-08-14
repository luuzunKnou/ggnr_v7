'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from 'react';
import { cn } from '@/lib/utils';

/** 실제 세로 스크롤이 생길 때만 너비조절 핸들과 겹치지 않도록 오른쪽 여유 */
const SCROLL_CLEARANCE_MR = 'mr-[10px]';

export type MapSideDetailScrollProps = ComponentPropsWithoutRef<'div'>;

/**
 * 상세 패널 본문 스크롤 영역.
 * 내용이 넘칠 때만 margin-right 10px — 스크롤 없으면 여백 없음.
 */
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
    <div ref={ref} className={cn(className, overflowY && SCROLL_CLEARANCE_MR)} {...rest}>
      {children}
    </div>
  );
}
