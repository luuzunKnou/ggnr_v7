'use client';

import { createContext, useContext } from 'react';

const SIDEBAR_WIDTH = 65;
const SEARCH_BAR_MARGIN = 20;
const SEARCH_BAR_TOP_PX = 16;
/** map-search-bar 주소검색 입력 한 줄(측정 전 fallback) */
const SEARCH_BAR_INPUT_ROW_HEIGHT_FALLBACK = 30;

export type SearchBarOffsetValue = {
  leftPx: number;
  topPx: number;
  /** viewport 기준 주소검색 입력란 하단(px) */
  inputBottomPx: number;
};

export const SearchBarOffsetContext = createContext<SearchBarOffsetValue>({
  leftPx: SIDEBAR_WIDTH + SEARCH_BAR_MARGIN,
  topPx: SEARCH_BAR_TOP_PX,
  inputBottomPx: SEARCH_BAR_TOP_PX + SEARCH_BAR_INPUT_ROW_HEIGHT_FALLBACK,
});

export function useSearchBarOffset() {
  return useContext(SearchBarOffsetContext);
}

/** 주소검색 한 줄 입력란(`map-search-bar` 단일 행) 바로 아래에 맞출 때: `topPx + 이 값` */
export const FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA = 48;

/** 도형 편집 안내 — 주소검색 입력란 하단과의 간격(px) */
export const GEOM_EDIT_HINT_BELOW_SEARCH_GAP = 17;
