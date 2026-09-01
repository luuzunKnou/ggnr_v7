/** 우클릭 필지정보 — 필지·건축물대장·건축인허가 탭 공통 표 스타일 (V7 shadcn 토큰) */

import {
  PANEL_DETAIL_VALUE_CELL,
} from '../panelDetailTableStyles';

export const LAND_INFO_TABLE_TEXT = 'text-[11px]';

export const LAND_INFO_TABLE_WRAP = 'max-w-full overflow-auto rounded border border-border';

/** 목록 표 thead — 스크롤 시 헤더 배경 유지 */
export const LAND_INFO_LIST_THEAD = 'sticky top-0 z-10 bg-muted';

/** 항목명(라벨) — 그리드·상세표 행 헤더(th) — LIST_TH·GRID_LABEL과 동일 bg-muted */
export const LAND_INFO_LABEL_CELL =
  'bg-muted px-2.5 py-1.5 text-[11px] font-medium text-foreground text-left align-middle border border-border break-keep';

/** 값 셀 — 상세표 */
export const LAND_INFO_VALUE_CELL =
  `${PANEL_DETAIL_VALUE_CELL} text-left align-middle border border-border bg-background`;

/** 목록 표 헤더(th) */
export const LAND_INFO_LIST_TH =
  'border-b border-r border-border bg-muted px-2.5 py-1.5 text-left align-middle font-medium text-foreground last:border-r-0';

/** 목록 표 본문(td) */
export const LAND_INFO_LIST_TD =
  'border-b border-r border-border bg-background px-2.5 py-1.5 align-middle text-foreground last:border-r-0';

/** 목록 표 본문 행 — 흰 배경 통일(줄무늬 제거) */
export const LAND_INFO_LIST_ROW_ODD = 'bg-background';

/** 2열 그리드(토지기본정보 등) */
export const LAND_INFO_FIELD_GRID =
  'grid min-w-0 grid-cols-[minmax(4.5rem,5.25rem)_minmax(0,1fr)_minmax(4.5rem,5.25rem)_minmax(0,1fr)] overflow-x-auto rounded border border-border bg-background text-[11px]';

/** 그리드 라벨 칸 — building register th와 동일 토큰(문자열 한 덩어리로 Tailwind 인식) */
export const LAND_INFO_GRID_LABEL =
  'min-w-0 shrink-0 border-b border-r border-border bg-muted px-2.5 py-1.5 text-[11px] font-medium text-foreground break-keep';

/** 그리드 값 칸 */
export const LAND_INFO_GRID_VALUE =
  'min-w-0 border-b border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground break-words';

/** 표 안 버튼(조회·연혁 등) */
export const LAND_INFO_TABLE_BTN =
  'shrink-0 text-[11px] px-2 py-0.5 border rounded border-border hover:bg-muted';
