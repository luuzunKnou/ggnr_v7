'use client';

import { createPortal } from 'react-dom';
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from '../searchBarOffsetContext';
import { useMapVisualCenterPixel } from './hooks/useMapVisualCenterPixel';
import type { Map } from 'ol';

type Props = {
  active: boolean;
  text: string;
  map: Map | null;
  mapReady: boolean;
  mapPaddingLeft: number;
  bannerHost: HTMLElement | null;
};

/** 도로망·보상편입 등 — 검색창 아래 지도 안내 배너 */
export function MapEditHintBanner({
  active,
  text,
  map,
  mapReady,
  mapPaddingLeft,
  bannerHost,
}: Props) {
  const { inputBottomPx } = useSearchBarOffset();
  const hintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const centerPixel = useMapVisualCenterPixel(map, mapReady, mapPaddingLeft);

  if (!active || !bannerHost || !text.trim()) return null;

  return createPortal(
    <div
      className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col gap-1.5 rounded border border-red-300 bg-red-50/95 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm dark:border-red-800 dark:bg-red-950/80 dark:text-red-300"
      style={
        centerPixel
          ? { left: centerPixel.x, top: hintTopPx }
          : { left: '50%', top: hintTopPx }
      }
    >
      <span className="whitespace-nowrap text-center">{text}</span>
    </div>,
    bannerHost
  );
}
