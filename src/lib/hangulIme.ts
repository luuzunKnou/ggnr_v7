/** 두벌식 영문 자판 입력을 한글로 조합한다. 이미 한글 입력기인 경우에는 쓰지 않는다. */

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'] as const;
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'] as const;
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'] as const;

const KEY_TO_CHO: Record<string, number> = {
  r: 0, R: 1, s: 2, e: 3, E: 4, f: 5, a: 6, q: 7, Q: 8, t: 9, T: 10,
  d: 11, w: 12, W: 13, c: 14, z: 15, x: 16, v: 17, g: 18,
};

const KEY_TO_JUNG: Record<string, number> = {
  k: 0, o: 1, i: 2, O: 3, j: 4, p: 5, u: 6, P: 7, h: 8, y: 12, n: 13, b: 17, m: 18, l: 20,
};

const KEY_TO_JONG: Record<string, number> = {
  r: 1, R: 2, s: 4, e: 7, f: 8, a: 16, q: 17, t: 19, T: 20, d: 21, w: 22,
  c: 23, z: 24, x: 25, v: 26, g: 27,
};

const JUNG_COMBO: Record<number, Record<string, number>> = {
  8: { k: 9, o: 10, l: 11 },
  13: { j: 14, p: 15, l: 16 },
  18: { l: 19 },
};

const JUNG_SPLIT: Record<number, number> = {
  9: 8, 10: 8, 11: 8, 14: 13, 15: 13, 16: 13, 19: 18,
};

const JONG_COMBO: Record<number, Record<string, number>> = {
  1: { t: 3 },
  4: { w: 5, g: 6 },
  8: { r: 9, a: 10, q: 11, t: 12, x: 13, v: 14, g: 15 },
  17: { t: 18 },
};

/** 겹받침을 앞 받침 + 다음 초성으로 나눈다. */
const JONG_SPLIT: Record<number, [number, number]> = {
  3: [1, 9],
  5: [4, 12],
  6: [4, 18],
  9: [8, 0],
  10: [8, 6],
  11: [8, 7],
  12: [8, 9],
  13: [8, 16],
  14: [8, 17],
  15: [8, 18],
  18: [17, 9],
};

const JONG_TO_CHO: Record<number, number> = {
  1: 0, 2: 1, 4: 2, 7: 3, 8: 5, 16: 6, 17: 7, 19: 9, 20: 10, 21: 11, 22: 12,
  23: 14, 24: 15, 25: 16, 26: 17, 27: 18,
};

const HANGUL_BASE = 0xac00;
const CHO_INDEX = new Map<string, number>(CHO.map((ch, index) => [ch, index]));
const JUNG_INDEX = new Map<string, number>(JUNG.map((ch, index) => [ch, index]));

export type HangulEdit = { value: string; cursor: number };

function syllable(cho: number, jung: number, jong: number): string {
  return String.fromCharCode(HANGUL_BASE + (cho * 21 + jung) * 28 + jong);
}

function parseSyllable(ch: string): { cho: number; jung: number; jong: number } | null {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > 0xd7a3) return null;
  const offset = code - HANGUL_BASE;
  return {
    cho: Math.floor(offset / 588),
    jung: Math.floor((offset % 588) / 28),
    jong: offset % 28,
  };
}

function replacePrev(value: string, cursor: number, nextChar: string): HangulEdit {
  const head = value.slice(0, cursor - 1);
  return { value: head + nextChar + value.slice(cursor), cursor: head.length + nextChar.length };
}

function insertAt(value: string, cursor: number, ch: string): HangulEdit {
  return { value: value.slice(0, cursor) + ch + value.slice(cursor), cursor: cursor + ch.length };
}

/** 영문 키 한 글자를 커서 위치에 한글로 넣는다. 조합 대상이 아니면 null. */
export function applyHangulKey(value: string, start: number, end: number, key: string): HangulEdit | null {
  const cho = KEY_TO_CHO[key];
  const jung = KEY_TO_JUNG[key];
  if (cho == null && jung == null) return null;

  const text = value.slice(0, start) + value.slice(end);
  const cursor = start;
  if (cursor <= 0) {
    const ch = jung != null ? JUNG[jung] : CHO[cho];
    return insertAt(text, cursor, ch);
  }

  const prev = text[cursor - 1];
  const syl = parseSyllable(prev);
  if (syl) {
    if (syl.jong === 0) {
      const combo = jung != null ? JUNG_COMBO[syl.jung]?.[key] : undefined;
      if (combo != null) return replacePrev(text, cursor, syllable(syl.cho, combo, 0));
      const jong = KEY_TO_JONG[key];
      if (jong != null) return replacePrev(text, cursor, syllable(syl.cho, syl.jung, jong));
    } else if (jung != null) {
      const split = JONG_SPLIT[syl.jong];
      const remainJong = split ? split[0] : 0;
      const nextCho = split ? split[1] : JONG_TO_CHO[syl.jong];
      const head = text.slice(0, cursor - 1);
      const composed = syllable(syl.cho, syl.jung, remainJong) + syllable(nextCho, jung, 0);
      return { value: head + composed + text.slice(cursor), cursor: head.length + composed.length };
    } else {
      const combo = JONG_COMBO[syl.jong]?.[key];
      if (combo != null) return replacePrev(text, cursor, syllable(syl.cho, syl.jung, combo));
    }
    const ch = jung != null ? JUNG[jung] : CHO[cho];
    return insertAt(text, cursor, ch);
  }

  const prevCho = CHO_INDEX.get(prev);
  if (prevCho != null && jung != null) return replacePrev(text, cursor, syllable(prevCho, jung, 0));

  const prevJung = JUNG_INDEX.get(prev);
  if (prevJung != null && jung != null) {
    const combo = JUNG_COMBO[prevJung]?.[key];
    if (combo != null) return replacePrev(text, cursor, JUNG[combo]);
  }

  const ch = jung != null ? JUNG[jung] : CHO[cho];
  return insertAt(text, cursor, ch);
}

/** 한글이면 자모 단위로 지운다. 선택이 있거나 한글이 아니면 null. */
export function applyHangulBackspace(value: string, start: number, end: number): HangulEdit | null {
  if (start !== end || start <= 0) return null;
  const prev = value[start - 1];
  const syl = parseSyllable(prev);
  if (syl) {
    if (syl.jong > 0) {
      const split = JONG_SPLIT[syl.jong];
      const nextJong = split ? split[0] : 0;
      return replacePrev(value, start, syllable(syl.cho, syl.jung, nextJong));
    }
    const splitJung = JUNG_SPLIT[syl.jung];
    if (splitJung != null) return replacePrev(value, start, syllable(syl.cho, splitJung, 0));
    return replacePrev(value, start, CHO[syl.cho]);
  }
  if (CHO_INDEX.has(prev) || JUNG_INDEX.has(prev)) {
    const head = value.slice(0, start - 1);
    return { value: head + value.slice(start), cursor: head.length };
  }
  return null;
}
