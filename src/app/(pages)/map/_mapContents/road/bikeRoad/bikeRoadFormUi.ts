/** 불법점용·접도구역 관리카드와 같은 서식 테두리 */

/** 관리카드보다 옅은 선 — 안 깨지되 덜 진하게 */
export const BIKE_FORM_BORDER = "border border-border";
export const BIKE_FORM_TH_BG = "bg-muted";
export const BIKE_FORM_LABEL_W = "5.5rem";

export const bikeFormTableClass = "w-full table-fixed border-collapse leading-none";

export const bikeFormThClass = `box-border ${BIKE_FORM_BORDER} ${BIKE_FORM_TH_BG} px-1 py-0.5 text-center align-middle text-[11px] font-medium leading-tight text-muted-foreground`;

export const bikeFormTdClass = `box-border h-[30px] ${BIKE_FORM_BORDER} bg-background px-1.5 py-1 align-middle text-[11px] leading-snug text-foreground`;

/** 셀 안 입력 — 표 선만 쓰고 input 자체 border 없음 */
export const bikeFormFieldClass =
  "box-border h-[20px] w-full min-w-0 border-0 bg-transparent px-0.5 text-[11px] leading-none text-foreground outline-none focus:bg-muted/50";
