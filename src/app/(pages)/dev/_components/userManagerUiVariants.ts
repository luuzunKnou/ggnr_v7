/** 사용자관리·가입승인 — 시안6 확정 스타일 */
export const USER_MANAGER_UI_STYLE = {
  page: 'space-y-3',
  toolbar: 'flex items-center gap-2',
  // 기능목록관리「공통 추가」와 동일: default variant + rounded-none (색은 Button default)
  primaryButton: '',
  // 흰 배경·검정 글씨 outline
  secondaryButton:
    'border-border bg-background text-foreground shadow-none hover:bg-muted hover:text-foreground',
  search: 'max-w-lg flex-1',
  tableWrap: 'overflow-auto border border-border max-h-[56vh]',
  table: 'w-full text-xs border-collapse',
  tableHead: 'bg-muted',
  tableRow:
    'border-t border-border cursor-pointer hover:bg-muted/50 transition-colors [&>td]:border-r [&>td]:border-border/60 [&>td:last-child]:border-r-0',
  tableCell: 'px-2 py-2',
  dialog:
    'sm:max-w-[1020px] p-0 gap-0 max-h-[92vh] overflow-hidden flex flex-col rounded-sm border-border',
  dialogHeader: 'border-b border-border px-3 py-2 bg-muted',
  dialogBody: 'p-3 gap-3',
  formPanel: 'rounded-sm border border-border bg-card p-3',
  sidePanel: 'rounded-sm border border-border bg-card',
  footer: 'border-t border-border px-3 py-2',
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
  orgBody: 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3',
  orgAddBar: 'flex shrink-0 items-center gap-2 border border-dashed border-border bg-muted/20 p-2',
  orgTableWrap: 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border border-border',
  orgTableScroll: 'min-h-0 flex-1 overflow-y-auto',
  orgTable:
    'w-full border-collapse text-xs [&_th]:border-r [&_th]:border-border [&_th:last-child]:border-r-0 [&_td]:border-r [&_td]:border-border/70 [&_td:last-child]:border-r-0',
  orgTableHead: 'sticky top-0 z-10 bg-muted [&_th]:border-b [&_th]:border-border',
  orgTableRow: 'h-10 border-b border-border/50 hover:bg-muted/40',
  orgHint: 'shrink-0 text-[11px] text-muted-foreground',
};
