'use client';

import { createContext, useContext } from 'react';

const SIDEBAR_WIDTH = 65;
const SEARCH_BAR_MARGIN = 20;

export const SearchBarOffsetContext = createContext<{ leftPx: number; topPx: number }>({
  leftPx: SIDEBAR_WIDTH + SEARCH_BAR_MARGIN,
  topPx: 16,
});

export function useSearchBarOffset() {
  return useContext(SearchBarOffsetContext);
}

/** 주소검색 한 줄 입력란(`map-search-bar` 단일 행) 바로 아래에 맞출 때: `topPx + 이 값` */
export const FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA = 48;
