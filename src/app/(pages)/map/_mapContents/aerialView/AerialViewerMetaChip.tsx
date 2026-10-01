'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 촬영 정보. 뷰어 안이면 왼쪽 위, 지도면 검색창 아래 왼쪽.
 * 오른쪽 메뉴와 아래 조작은 비워 둔다.
 */
export function AerialViewerMetaChip({
  workName,
  shotDate,
  photographer,
  kindLabel,
  dateLabel = '촬영일',
  place = 'viewer',
}: {
  workName?: string;
  shotDate?: string;
  photographer?: string;
  kindLabel?: string;
  dateLabel?: string;
  place?: 'viewer' | 'map';
}) {
  const name = workName?.trim() ?? '';
  const date = shotDate?.trim() ?? '';
  const who = photographer?.trim() ?? '';
  const kind = kindLabel?.trim() ?? '';
  const corner = useMapCorner(place === 'map');
  if (!name && !date && !who) return null;

  const card = (
    <div className="max-w-[18rem] rounded-md bg-black/55 px-2.5 py-1.5 text-white shadow-md">
      {kind ? <p className="truncate text-[10px] leading-4 text-white/70">{kind}</p> : null}
      {name ? <p className="truncate text-[12px] font-medium leading-4">{name}</p> : null}
      {date ? <p className="truncate text-[11px] leading-4 text-white/85">{dateLabel} {date}</p> : null}
      {who ? <p className="truncate text-[11px] leading-4 text-white/85">촬영자 {who}</p> : null}
    </div>
  );

  if (place === 'map') {
    if (!corner || typeof document === 'undefined') return null;
    return createPortal(
      <div className="pointer-events-none fixed z-30" style={{ left: corner.left, top: corner.top }}>
        {card}
      </div>,
      document.body
    );
  }

  return <div className="pointer-events-none absolute left-4 top-16 z-30">{card}</div>;
}

/** 검색창 아래, 왼쪽 목록 오른쪽. 오른쪽 메뉴와 겹치지 않는다. */
function useMapCorner(enabled: boolean) {
  const [corner, setCorner] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const aside = document.querySelector('aside');
      let left = aside ? Math.round(aside.getBoundingClientRect().right) : 0;
      document.querySelectorAll('.pointer-events-none.flex.h-full > .pointer-events-auto').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width >= 80 && rect.left < window.innerWidth * 0.7) {
          left = Math.max(left, Math.round(rect.right));
        }
      });
      setCorner({ left: left + 16, top: 72 });
    };
    measure();
    const column = document.querySelector('.pointer-events-none.flex.h-full');
    const ro = new ResizeObserver(measure);
    if (column) {
      ro.observe(column);
      column.querySelectorAll(':scope > .pointer-events-auto').forEach((el) => ro.observe(el));
    }
    const mo = new MutationObserver(measure);
    if (column) mo.observe(column, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled]);

  return corner;
}
