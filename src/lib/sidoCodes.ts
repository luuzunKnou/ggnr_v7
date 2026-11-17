import sidoCodesJson from '@/config/reference/sidoCodes.json';

export type SidoCodeItem = {
  sidoCd: string;
  sidoNm: string;
};

export type SidoOption = {
  code: string;
  name: string;
};

/** 시도 10자리 법정동코드(시도 레벨) 정적 목록 */
export const SIDO_CODES: readonly SidoCodeItem[] = sidoCodesJson as SidoCodeItem[];

const nameByCd = new Map(SIDO_CODES.map((item) => [item.sidoCd, item.sidoNm]));

/** 시도 코드 → 시도명. 없으면 빈 문자열 */
export function getSidoName(sidoCd: unknown): string {
  const cd = String(sidoCd ?? '').trim();
  if (!cd) return '';
  return nameByCd.get(cd) ?? '';
}

/** select·토글 등용 { code, name } 목록 (JSON 순서 유지) */
export function getSidoOptions(): SidoOption[] {
  return SIDO_CODES.map((item) => ({ code: item.sidoCd, name: item.sidoNm }));
}

/** 시도 10자리 코드 → 앞 2자리(시도 구분) */
export function sidoCdToPrefix(sidoCd: unknown): string {
  const digits = String(sidoCd ?? '').replace(/\D/g, '');
  return digits.slice(0, 2);
}

/** adm_sect_c 앞 2글자 등 prefix → 시도명 (sidoCd prefix 매칭) */
export function getSidoNameByPrefix(prefix: unknown): string {
  const p = String(prefix ?? '').trim().slice(0, 2);
  if (!p) return '';
  const found = SIDO_CODES.find((item) => sidoCdToPrefix(item.sidoCd) === p);
  return found?.sidoNm ?? '';
}
