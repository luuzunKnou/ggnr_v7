/** 두벌식 한글을 영문 쿼티 자판으로 친 문자열. 예: 구덕모 → rnejrah */

const CHO = ['r', 'R', 's', 'e', 'E', 'f', 'a', 'q', 'Q', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g'];
const JUNG = [
  'k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l',
];
const JONG = [
  '', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T',
  'd', 'w', 'c', 'z', 'x', 'v', 'g',
];

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;

export function hangulNameToQwerty(name: string): string {
  let out = '';
  for (const ch of name.trim()) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < HANGUL_BASE || code > HANGUL_END) {
      out += ch;
      continue;
    }
    const s = code - HANGUL_BASE;
    const cho = Math.floor(s / 588);
    const jung = Math.floor((s % 588) / 28);
    const jong = s % 28;
    out += (CHO[cho] ?? '') + (JUNG[jung] ?? '') + (JONG[jong] ?? '');
  }
  return out;
}

/** 임시 비밀번호 후보: 성명, 성명을 영문 자판으로 친 값 */
export function tempPasswordCandidates(usrId: string): string[] {
  const id = usrId.trim();
  if (!id) return [];
  const qwerty = hangulNameToQwerty(id);
  return [...new Set([id, qwerty].filter((s) => s.length > 0))];
}
