const RE_ADDR_SIDO = /^([가-힣]+)(특별자치도|특별자치시|특별시|광역시|도)(\s+|$)/u;
const RE_ADDR_SIGUNGU = /^([가-힣]+)(시|군|구)(\s+|$)/u;
/** 문장 어디에 있어도 «시도 + 시군구» 접두를 뺀다 */
const RE_SIDO_SIGUNGU_PAIR =
  /([가-힣]+)(특별자치도|특별자치시|특별시|광역시|도)\s+([가-힣]+)(시|군|구)(?=\s|$|,)/gu;

function normalizeAddrSpaces(s: string): string {
  return s.replace(/\s+,/g, ',').replace(/,\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

function stripLeadingSidoSigungu(original: string): string {
  let s = original.replace(RE_ADDR_SIDO, '').trim();
  for (let i = 0; i < 6; i++) {
    const next = s.replace(RE_ADDR_SIGUNGU, '').trim();
    if (next === s) break;
    s = next;
  }
  return s.length > 0 ? s : original;
}

/**
 * 주소에서 시·도·시·군·구 행정구역명을 빼고 읍·면·동·리·도로명 등 나머지를 반환.
 * 앞뿐 아니라 가운데·쉼표 뒤에도 같은 접두가 있으면 모두 뺀다. 인식 실패 시 원문.
 */
export function formatAddressStripSidoSigungu(raw: unknown): string {
  const original = String(raw ?? '').trim();
  if (!original) return '';
  const withoutPairs = normalizeAddrSpaces(original.replace(RE_SIDO_SIGUNGU_PAIR, ' '));
  const stripped = stripLeadingSidoSigungu(withoutPairs || original);
  const out = normalizeAddrSpaces(stripped);
  return out.length > 0 ? out : original;
}
