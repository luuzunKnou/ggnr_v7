'use client';

import { SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';

type StreetViewKakaoMapLinkProps = {
  /** WGS84 위도 */
  lat: number;
  /** WGS84 경도 */
  lng: number;
};

/** 카카오맵 로드뷰 바로가기 — map.kakao.com/link/roadview/위도,경도 (방향·시야 파라미터 미지원) */
export function buildKakaoRoadviewLink(lat: number, lng: number): string {
  return `https://map.kakao.com/link/roadview/${lat},${lng}`;
}

function openKakaoRoadviewWindow(url: string) {
  const width = Math.min(1280, Math.floor(window.screen.availWidth * 0.85));
  const height = Math.min(900, Math.floor(window.screen.availHeight * 0.85));
  const left = Math.max(0, Math.floor((window.screen.availWidth - width) / 2));
  const top = Math.max(0, Math.floor((window.screen.availHeight - height) / 2));
  const features = [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');
  const win = window.open(url, 'kakaoRoadview', features);
  if (win) win.opener = null;
}

/** 카카오맵에서 현재 위치 로드뷰 열기(새 창) — 하단 flex 바용 */
export const StreetViewKakaoMapLink = memo(function StreetViewKakaoMapLink({
  lat,
  lng,
}: StreetViewKakaoMapLinkProps) {
  const href = buildKakaoRoadviewLink(lat, lng);
  const label = '카카오맵에서 보기';

  return (
    <a
      href={href}
      title={label}
      className={cn(
        'pointer-events-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full',
        'bg-slate-800 px-3 py-2 shadow-md',
        'opacity-90 transition-opacity hover:opacity-100',
        'dark:bg-slate-900 dark:shadow-black/40',
        'text-sm text-white/80 hover:text-white/90'
      )}
      onClick={(e) => {
        e.preventDefault();
        openKakaoRoadviewWindow(href);
      }}
    >
      <SquareArrowOutUpRight className="h-3.5 w-3.5 shrink-0 text-white/80" strokeWidth={2} aria-hidden />
      <span>{label}</span>
    </a>
  );
});
