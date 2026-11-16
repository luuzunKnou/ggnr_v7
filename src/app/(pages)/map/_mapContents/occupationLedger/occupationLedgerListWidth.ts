/** 목록 열 제목이 «…» 없이 다 보이는 최소 폭(px) — 한글 12px·그 밖 7px 어림 + 여백·정렬 아이콘 */
export function listHeaderMinPx(label: string, extraPx = 32): number {
  let w = 0;
  for (const ch of String(label ?? '')) {
    w += /[\u3131-\uD79D]/.test(ch) ? 12 : 7;
  }
  return Math.ceil(w + extraPx);
}

/** 필지·물건지 목록 — 약 7행(21.7rem)까지, 초과 시 세로 스크롤 */
export const OCCUPATION_PARCEL_LIST_MAX_HEIGHT_CLASS = 'max-h-[21.7rem]';

/** 필지목록 열 최소 폭 */
export function occupationParcelListColumnMinPx(label: string): number {
  return Math.max(88, listHeaderMinPx(label, 28));
}

/** 필지주소·소재지 등 — 목록에서 가로를 더 많이 쓰는 열 */
export function occupationParcelListColumnIsWide(field: string, label: string): boolean {
  const f = String(field ?? '').toLowerCase();
  if (/addr|address|juso|jibun|loc|place|location|full_addr/.test(f)) return true;
  const l = String(label ?? '').trim();
  if (/주소|소재|필지주소|점용위치|점용장소/.test(l)) return true;
  return false;
}

/** grid-template-columns 한 칸 — 짧은 열 1fr, 주소류 2.5fr */
export function occupationParcelListColumnGridTrack(field: string, label: string): string {
  const minPx = occupationParcelListColumnMinPx(label);
  const fr = occupationParcelListColumnIsWide(field, label) ? 2.5 : 1;
  return `minmax(${minPx}px, ${fr}fr)`;
}

/** 필지 상세·편집 모달 — 패널 합친 폭에 맞춰 최대 가로 */
export function occupationParcelModalMaxWidthClass(overlayWidthPx: number): string {
  if (overlayWidthPx <= 0) return 'max-w-lg';
  if (overlayWidthPx >= 1000) return 'max-w-3xl';
  if (overlayWidthPx >= 820) return 'max-w-2xl';
  if (overlayWidthPx >= 680) return 'max-w-xl';
  return 'max-w-lg';
}

/** 필지 모달 — 한 행에 한 칸만 쓸지 (긴 값·비고 등). 나머지는 하천명+필지주소처럼 두 칸씩 */
export function occupationParcelModalFieldFullWidth(
  field: string,
  _label: string,
  value?: string
): boolean {
  const f = String(field ?? '').toLowerCase();
  if (/remark|note|bigo|content|desc|memo|geom/.test(f)) return true;
  const v = String(value ?? '').trim();
  if (v.includes('\n')) return true;
  if (v.length > 42) return true;
  return false;
}
