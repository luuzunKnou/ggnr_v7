const RE_ADDR_SIDO = /^([가-힣]+)(특별자치도|특별자치시|특별시|광역시|도)(\s+|$)/u;
const RE_ADDR_SIGUNGU = /^([가-힣]+)(시|군|구)(\s+|$)/u;

/**
 * 주소 문자열 앞의 시·도·시·군·구 행정구역명만 제거하고 읍·면·동·리·도로명 등 나머지를 반환.
 * 인식 실패 시 원문을 그대로 둔다.
 */
export function formatAddressStripSidoSigungu(raw: unknown): string {
  const original = String(raw ?? '').trim();
  if (!original) return '';
  let s = original.replace(RE_ADDR_SIDO, '').trim();
  for (let i = 0; i < 6; i++) {
    const next = s.replace(RE_ADDR_SIGUNGU, '').trim();
    if (next === s) break;
    s = next;
  }
  return s.length > 0 ? s : original;
}
