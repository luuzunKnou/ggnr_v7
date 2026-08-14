/**
 * 엑셀 업로드 전용 주소·PNU 정규화.
 * 다른 기능(보상·안동 도로점용 등)과 공유하지 않는다 — 업로드 경로 유지수용.
 */

const BONBUN_LEN = 4;
const BUBUN_LEN = 4;

export type ExcelUploadParsedPnuParts = {
  emdName: string;
  riName: string;
  bonbun: string;
  bubun: string;
  /** 지번 앞 «산» — PNU 대장구분 2 */
  isMountain: boolean;
};

/**
 * 행정리(서부3리·현1리) → 법정리(서부리·현리).
 * 지적·PNU 조회는 법정리 기준이라 숫자 붙은 리를 법정리명으로 정규화한다.
 */
export function toBeopjeongRiName(riName: string): string {
  const t = String(riName ?? '').trim();
  const m = t.match(/^(.+?)\d+리$/u);
  return m ? `${m[1]}리` : t;
}

/** 리 조회 후보: 원명 → (다를 때만) 법정리명 */
export function riNameLookupCandidates(riName: string): string[] {
  const raw = String(riName ?? '').trim();
  const legal = toBeopjeongRiName(raw);
  return [raw, legal].filter((n, i, arr) => n && arr.indexOf(n) === i);
}

/**
 * 주소 문자열 안의 행정리(서부3리)를 법정리(서부리)로 치환.
 * 엑셀 VWorld 지오코딩·표시용 정규화에만 사용.
 */
export function normalizeHangjeongRiInAddress(address: string): string {
  const t = String(address ?? '').trim();
  if (!t) return t;
  return t.replace(/([가-힣]+)\d+리/gu, '$1리').replace(/\s{2,}/g, ' ').trim();
}

/** 행정리가 법정리와 다르면 법정리 주소, 같으면 null */
export function hangjeongRiAddressAlt(address: string): string | null {
  const raw = String(address ?? '').trim();
  if (!raw) return null;
  const alt = normalizeHangjeongRiInAddress(raw);
  return alt && alt !== raw ? alt : null;
}

/**
 * 지번 토큰에서만 산 여부 판별.
 * «구산리» 등 지명 속 산은 건드리지 않고, «산 123»·«산123-1»만 산 지번으로 본다.
 */
export function takeMountainFromJibunRest(rest: string): { isMountain: boolean; jibunRest: string } {
  let jibunRest = String(rest ?? '').trim();
  // «산» 단독 토큰 뒤 본번, 또는 «산123» 붙여 쓴 경우
  const isMountain = /^산(?:\s+|(?=\d))/u.test(jibunRest);
  if (isMountain) {
    jibunRest = jibunRest.replace(/^산\s*/u, '').trim();
  }
  return { isMountain, jibunRest };
}

/**
 * 엑셀 주소 문자열 → 읍면동·리·본번·부번·산여부.
 * 지명에 포함된 «산»은 제거하지 않는다.
 */
export function parseAddressForPnu(address: string): ExcelUploadParsedPnuParts | null {
  let s = String(address ?? '').trim();
  if (!s) return null;
  s = s.replace(/번지/g, '').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 5) return null;
  const emdName = parts[2]!.trim();
  const riName = parts[3]!.trim();
  const { isMountain, jibunRest } = takeMountainFromJibunRest(parts.slice(4).join(' '));
  const addrParts = jibunRest.split('-').map((p) => p.trim());
  const bonbunRaw = (addrParts[0] ?? '0').replace(/\D/g, '') || '0';
  const bubunRaw = (addrParts[1] ?? '0').replace(/\D/g, '') || '0';
  const bonbun = bonbunRaw.padStart(BONBUN_LEN, '0').slice(-BONBUN_LEN);
  const bubun = bubunRaw.padStart(BUBUN_LEN, '0').slice(-BUBUN_LEN);
  return { emdName, riName, bonbun, bubun, isMountain };
}

/** PNU 19자리: 리코드10 + 대장구분1(대지1/산2) + 본번4 + 부번4 */
export function buildPnu19(
  riCd: string,
  parts: Pick<ExcelUploadParsedPnuParts, 'bonbun' | 'bubun' | 'isMountain'>
): string {
  const land = parts.isMountain ? '2' : '1';
  return `${riCd}${land}${parts.bonbun}${parts.bubun}`;
}
