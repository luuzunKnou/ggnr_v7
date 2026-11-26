/** 목록 열 제목이 «…» 없이 다 보이는 최소 폭(px) — 한글 12px·그 밖 7px 어림 + 여백·정렬 아이콘 */
export function listHeaderMinPx(label: string, extraPx = 32): number {
  let w = 0;
  for (const ch of String(label ?? '')) {
    w += /[\u3131-\uD79D]/.test(ch) ? 12 : 7;
  }
  return Math.ceil(w + extraPx);
}

/**
 * 점용대장 목록 열 폭(px).
 * 점용코드·관리번호는 좁게, 점용기간·점용장소는 잘리지 않게 넓게.
 */
export function occupationLedgerListColumnWidthPx(
  field: string,
  label: string,
  edge?: 'start' | 'end'
): number {
  const headerMin = listHeaderMinPx(label);
  // 시작·종료 분리 열 — 날짜가 잘리지 않게
  if (edge) return Math.max(118, headerMin);
  const f = String(field ?? '').toLowerCase();
  const l = String(label ?? '').trim();
  if (
    /^(cons_code|ftr_idn)$/.test(f) ||
    /점용코드|관리번호/.test(l)
  ) {
    return Math.max(100, headerMin);
  }
  // 점용기간 한 칸(usage_pd 등) — 기간 문구가 잘리지 않게
  if (
    /^(usage_pd|perm_pd|occ_pd)$/.test(f) ||
    /기간|period|_pd$/.test(f) ||
    /점용기간|허가기간/.test(l)
  ) {
    return Math.max(240, headerMin);
  }
  if (
    /^(usage_loc|occ_loc|occup_place)$/.test(f) ||
    /점용장소|점용위치|주소|소재/.test(l)
  ) {
    return Math.max(200, headerMin);
  }
  if (/^(usage_name|occ_nam|work_name)$/.test(f) || /점용명/.test(l)) {
    return Math.max(140, headerMin);
  }
  return Math.max(120, headerMin);
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
