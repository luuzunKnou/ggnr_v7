'use client';

import { SquareArrowOutUpRight } from 'lucide-react';
import { memo, useRef } from 'react';
import { cn } from '@/lib/utils';

/** 카카오맵 URL zoom 허용 범위 (SDK와 동일 상한) */
const LINK_ZOOM_MIN = -3;
const LINK_ZOOM_MAX = 3;

export type KakaoRoadviewLinkViewpoint = {
  panoId: number;
  pan: number;
  tilt: number;
  zoom: number;
};

type StreetViewKakaoMapLinkProps = {
  /** 클릭 시 현재 로드뷰 시점으로 URL 생성. null이면 열지 않음 */
  getHref: () => string | null;
  disabled?: boolean;
};

function normalizePan(pan: number): number {
  return ((pan % 360) + 360) % 360;
}

function clampTilt(tilt: number): number {
  return Math.min(90, Math.max(-90, tilt));
}

function clampZoom(zoom: number): number {
  const z = Math.round(zoom);
  return Math.min(LINK_ZOOM_MAX, Math.max(LINK_ZOOM_MIN, z));
}

/** 카카오맵 로드뷰 바로가기 — panoid + pan/tilt/zoom (공식 샘플과 동일) */
export function buildKakaoRoadviewLink(vp: KakaoRoadviewLinkViewpoint): string {
  const pan = normalizePan(vp.pan);
  const tilt = clampTilt(vp.tilt);
  const zoom = clampZoom(vp.zoom);
  const params = new URLSearchParams({
    panoid: String(vp.panoId),
    pan: String(pan),
    tilt: String(tilt),
    zoom: String(zoom),
  });
  return `https://map.kakao.com/?${params.toString()}`;
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

/** 카카오맵에서 현재 시점 로드뷰 열기(새 창) — 하단 flex 바용 */
export const StreetViewKakaoMapLink = memo(function StreetViewKakaoMapLink({
  getHref,
  disabled = false,
}: StreetViewKakaoMapLinkProps) {
  const lastHrefRef = useRef('#');
  const label = '카카오맵에서 보기';

  return (
    <a
      href={lastHrefRef.current}
      title={label}
      aria-disabled={disabled}
      className={cn(
        'pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full',
        'bg-slate-800 px-3 py-2 shadow-md',
        'opacity-90 transition-opacity',
        'dark:bg-slate-900 dark:shadow-black/40',
        'text-sm text-white/80',
        disabled
          ? '!cursor-not-allowed opacity-40 hover:opacity-40'
          : 'cursor-pointer hover:opacity-100 hover:text-white/90'
      )}
      onClick={(e) => {
        e.preventDefault();
        if (disabled) return;
        const href = getHref();
        if (!href) return;
        lastHrefRef.current = href;
        openKakaoRoadviewWindow(href);
      }}
    >
      <SquareArrowOutUpRight className="h-3.5 w-3.5 shrink-0 text-white/80" strokeWidth={2} aria-hidden />
      <span>{label}</span>
    </a>
  );
});
