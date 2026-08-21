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
  s = s.replace(/(\d+)\s*번지\s*\d+\s*호/gi, '$1번지');
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

const SIDO_ABBR: Record<string, string> = {
  서울: '서울특별시',
  부산: '부산광역시',
  대구: '대구광역시',
  인천: '인천광역시',
  광주: '광주광역시',
  대전: '대전광역시',
  울산: '울산광역시',
  세종: '세종특별자치시',
  경기: '경기도',
  강원: '강원특별자치도',
  충북: '충청북도',
  충남: '충청남도',
  전북: '전북특별자치도',
  전남: '전라남도',
  경북: '경상북도',
  경남: '경상남도',
  제주: '제주특별자치도',
};

const SIDO_ABBR_NAMES = Object.keys(SIDO_ABBR).join('|');
const SIDO_HEAD = `(?:${SIDO_ABBR_NAMES}|[가-힣]+(?:특별자치시|특별자치도|특별시|광역시|도))`;

/** 경북→경상북도 등 시·도 약칭을 정식 명칭으로 */
export function expandExcelSidoAbbreviation(s: string): string {
  const re = new RegExp(`(^|[\\s])(${SIDO_ABBR_NAMES})(?=[\\s]|$)`, 'g');
  return String(s ?? '').replace(re, (_full, pre: string, abbr: string) => `${pre}${SIDO_ABBR[abbr] ?? abbr}`);
}

/** 새골길13 → 새골길 13 */
export function spaceExcelRoadNameNumber(s: string): string {
  return String(s ?? '').replace(/([가-힣]+(?:대로|로|길))(\d+(?:-\d+)?)/g, '$1 $2');
}

export function polishExcelGeocodeAddress(s: string): string {
  return spaceExcelRoadNameNumber(expandExcelSidoAbbreviation(s)).replace(/\s{2,}/g, ' ').trim();
}

function sidoSigunguPrefix(addr: string): string {
  const m = addr.match(
    /^([가-힣]+(?:특별자치시|특별자치도|특별시|광역시|도)\s+[가-힣]+(?:시|군|구))/
  );
  return m?.[1] ?? '';
}

/**
 * «81번지 경북 … 새골길13»처럼 지번 뒤에 시·도(약칭 포함)가 이어지면 2건으로 분리.
 * 시·군 접두는 뒤 주소에서 가져와 앞 지번에도 붙인다.
 */
export function splitExcelJibunThenFollowingAddress(raw: string): string[] | null {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const re = new RegExp(`^(.+?번지)\\s+(${SIDO_HEAD}\\s+.+)$`);
  const m = t.match(re);
  if (!m) return null;
  let head = (m[1] ?? '').trim();
  const tail = polishExcelGeocodeAddress(m[2] ?? '');
  if (!head || !tail) return null;
  if (!/(?:시|군|구)/.test(tail) && !/(?:대로|로|길)\s*\d+/.test(tail)) return null;
  const prefix = sidoSigunguPrefix(tail);
  if (prefix && !head.startsWith(prefix)) {
    head = `${prefix} ${head}`.replace(/\s+/g, ' ').trim();
  }
  head = polishExcelGeocodeAddress(head);
  if (!head || !tail || head === tail) return null;
  return [head, tail];
}

/** 번지 뒤에 시·도 약칭·정식명 또는 도로명이 이어지면 복수 주소로 본다. */
export function excelAddressLooksLikeJibunThenFollowing(raw: string): boolean {
  const t = String(raw ?? '').trim();
  if (!t) return false;
  const sidoRe = new RegExp(`번지\\s+(?:${SIDO_ABBR_NAMES}|[가-힣]+(?:특별자치시|특별자치도|특별시|광역시|도))`);
  if (sidoRe.test(t)) return true;
  if (/번지\s+.+(?:대로|로|길)\s*\d+/.test(t)) return true;
  return splitExcelJibunThenFollowingAddress(t) != null;
}
