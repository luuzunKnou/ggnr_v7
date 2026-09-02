/** 사용자관리·가입승인 — 시안6 확정 스타일 */
export const USER_MANAGER_UI_STYLE = {
  page: 'flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden',
  toolbar: 'flex shrink-0 items-center gap-2',
  // 기능목록관리「공통 추가」와 동일: default variant + rounded-none (색은 Button default)
  primaryButton: '',
  // 흰 배경·검정 글씨 outline
  secondaryButton:
    'border-border bg-background text-foreground shadow-none hover:bg-muted hover:text-foreground',
  search: 'max-w-lg flex-1',
  tableWrap: 'flex min-h-0 flex-1 flex-col overflow-hidden border border-border',
  tableScroll: 'min-h-0 flex-1 overflow-auto',
  table: 'w-full text-xs border-collapse',
  tableHead:
    'bg-muted h-[30px] [&_th]:h-[30px] [&_th]:max-h-[30px] [&_th]:align-middle [&_th]:overflow-hidden [&_th]:border-b [&_th]:border-border',
  tableRow:
    'h-[30px] max-h-[30px] border-b border-border cursor-pointer hover:bg-muted/50 transition-colors [&>td]:h-[30px] [&>td]:max-h-[30px] [&>td]:align-middle [&>td]:overflow-hidden [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0',
  tableCell: 'px-2 py-0 align-middle',
  dialog:
    'sm:max-w-[1020px] p-0 gap-0 max-h-[92vh] overflow-hidden flex flex-col rounded-sm border-border',
  dialogHeader: 'border-b border-border px-3 py-2 bg-muted',
  dialogBody: 'p-3 gap-3',
  formPanel: 'rounded-sm border border-border bg-card p-3',
  sidePanel: 'rounded-sm border border-border bg-card',
  footer: 'border-t border-border px-3 py-2',
} as const;

/** 접속현황 — 집계표 기준 행 높이 25.5px */
export const USER_STATS_HISTORY_TABLE = {
  tableHead:
    'bg-muted h-[25.5px] [&_th]:h-[25.5px] [&_th]:max-h-[25.5px] [&_th]:align-middle [&_th]:overflow-hidden [&_th]:border-b [&_th]:border-border',
  tableRow:
    'h-[25.5px] max-h-[25.5px] border-b border-border hover:bg-muted/50 transition-colors [&>td]:h-[25.5px] [&>td]:max-h-[25.5px] [&>td]:align-middle [&>td]:overflow-hidden [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0',
  tableRowPivot:
    'h-[25.5px] max-h-[25.5px] border-t border-border hover:bg-muted/50 transition-colors [&>td]:h-[25.5px] [&>td]:max-h-[25.5px] [&>td]:align-middle [&>td]:overflow-hidden',
  tableCell: 'px-2 py-0 align-middle leading-[25.5px]',
} as const;

/** 사용자 관리 이력 — 행 높이 30px */
export const USER_MGMT_HISTORY_TABLE = {
  tableHead:
    'bg-muted h-[30px] [&_th]:h-[30px] [&_th]:max-h-[30px] [&_th]:align-middle [&_th]:overflow-hidden [&_th]:border-b [&_th]:border-border',
  tableRow:
    'h-[30px] max-h-[30px] border-b border-border hover:bg-muted/50 transition-colors [&>td]:h-[30px] [&>td]:max-h-[30px] [&>td]:align-middle [&>td]:overflow-hidden [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0',
  tableCell: 'px-2 py-0 align-middle',
} as const;

export type OrgVariantStyle = {
  orgTabs: string;
  orgTabActive: string;
  orgTabIdle: string;
  orgBody: string;
  orgAddBar: string;
  orgTableWrap: string;
  orgTableScroll: string;
  orgTable: string;
  orgTableHead: string;
  orgTableRow: string;
  orgHint: string;
};

/** 부서/팀 모달 — 탭=시안2, 본문·표=시안3 */
export const ORG_MANAGER_UI_STYLE: OrgVariantStyle = {
  orgTabs: 'gap-5 border-b border-border px-6',
  orgTabActive: 'border-b-2 border-foreground px-4 py-2 text-xs font-medium text-foreground',
  orgTabIdle:
    'border-b-2 border-transparent px-4 py-2 text-xs text-muted-foreground hover:text-foreground',
  orgBody: 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-card p-3',
  orgAddBar:
    'flex shrink-0 items-center gap-2 border border-border/70 bg-background/60 p-2 dark:bg-background/40',
  orgTableWrap:
    'flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border border-border/70 bg-background/40 dark:bg-background/25',
  orgTableScroll: 'min-h-0 flex-1 overflow-y-auto',
  orgTable:
    'w-full border-collapse text-xs [&_th]:border-r [&_th]:border-border [&_th:last-child]:border-r-0 [&_td]:border-r [&_td]:border-border/70 [&_td:last-child]:border-r-0',
  orgTableHead:
    'sticky top-0 z-10 bg-muted/70 dark:bg-muted/50 [&_th]:border-b [&_th]:border-border',
  orgTableRow: 'h-10 border-b border-border/50 hover:bg-muted/30',
  orgHint: 'shrink-0 text-[11px] text-muted-foreground',
};
