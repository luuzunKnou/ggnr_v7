/**
 * 접도구역 표주 — 설치위치(한 줄)·지목 정규화·엑셀 적재용 조립.
 */

export type MarkerAddressParts = {
  county?: string | null;
  myeon?: string | null;
  ri?: string | null;
  landCategory?: string | null;
  lotNo?: string | null;
};

export const JIMOK_TOKENS = new Set([
  '대',
  '전',
  '답',
  '도로',
  '임야',
  '공장용지',
  '구거',
  '하천',
  '잡종지',
  '학교용지',
  '주차장',
  '공원',
  '체육용지',
  '유원지',
  '창고용지',
  '목장용지',
  '양어장',
  '수도용지',
  '철도용지',
  '제방',
  '유지',
  '공장',
  '산',
  '과수원',
  '주유소용지',
  '창고용지',
]);

function tx(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 면·읍·동 접미사 */
export function withMyeonSuffix(raw: string): string {
  const t = tx(raw);
  if (!t) return '';
  if (/(읍|면|동)$/u.test(t)) return t;
  return `${t}면`;
}

/** 엑셀 축약 리명 → 정식 리명 (이미 「리」로 끝나도 불완전한 경우) */
const RI_CANONICAL: Record<string, string> = {
  발리: '발리리',
  발리리: '발리리',
  원: '원리리',
  원리: '원리리',
  원리리: '원리리',
};

/** 리 접미사 */
export function withRiSuffix(raw: string): string {
  const t = tx(raw);
  if (!t) return '';
  if (RI_CANONICAL[t]) return RI_CANONICAL[t]!;
  if (/리$/u.test(t)) return t;
  return `${t}리`;
}

/** 엑셀 분리값 → 설치위치(지목 제외). 예: 일월면 곡강리 162-2 */
export function formatMarkerInstallLocation(parts: MarkerAddressParts): string {
  const myeon = withMyeonSuffix(parts.myeon ?? '');
  const ri = withRiSuffix(parts.ri ?? '');
  const lot = tx(parts.lotNo);
  return [myeon, ri, lot].filter(Boolean).join(' ');
}

/**
 * 설치위치 보정 — 영양면→영양읍, 발리→발리리 등.
 */
export function normalizeMarkerInstallLocation(raw: string): string {
  let s = tx(raw);
  if (!s) return '';

  s = s.replace(/영양면/g, '영양읍');

  s = s.replace(
    /([가-힣]+(?:면|읍|동))\s+([가-힣]{1,6})(?=\s+(?:산\s*)?[\d-]+)/gu,
    (_full, emd: string, ri: string) => `${emd} ${withRiSuffix(ri)}`
  );

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 지적 jibun(예: 240답, 산7임, 1-1 답)에서 지목만 추출.
 */
export function jimokFromJijukJibun(jibunRaw: string | null | undefined): string {
  const s = String(jibunRaw ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(?:산?\d+(?:-\d+)?)[\s]*([가-힣]+)$/u);
  return m?.[1]?.trim() ?? '';
}

/** 끝 지목 토큰 분리. «주유소 용지»처럼 띄어쓴 지목도 처리 */
export function splitInstallLocationAndJimok(raw: string): {
  installLocation: string;
  landCategory: string;
} {
  const norm = normalizeMarkerInstallLocation(raw);
  if (!norm) return { installLocation: '', landCategory: '' };

  const tokens = norm.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { installLocation: '', landCategory: '' };

  // 끝 2토큰 합쳐 지목인지 (주유소 용지, 창고 용지)
  if (tokens.length >= 2) {
    const joined2 = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`.replace(/\s+/g, '');
    const knownJoined = ['주유소용지', '창고용지', '공장용지', '학교용지', '목장용지', '수도용지', '철도용지'];
    if (knownJoined.includes(joined2) || JIMOK_TOKENS.has(joined2)) {
      return {
        installLocation: tokens.slice(0, -2).join(' '),
        landCategory: joined2,
      };
    }
  }

  const last = tokens[tokens.length - 1]!;
  if (JIMOK_TOKENS.has(last)) {
    return {
      installLocation: tokens.slice(0, -1).join(' '),
      landCategory: last,
    };
  }

  return { installLocation: norm, landCategory: '' };
}

/** 지적 조회용 — 시도·시군구 보강 (지목 제외된 설치위치 가정) */
export function installLocationToParcelAddress(installLocation: string): string {
  const { installLocation: body0 } = splitInstallLocationAndJimok(installLocation);
  const body = body0 || normalizeMarkerInstallLocation(installLocation);
  if (!body) return '';
  if (/^(경상북도|경북|대한민국)/.test(body)) return body;
  if (/^영양군/.test(body)) return `경상북도 ${body}`;
  return `경상북도 영양군 ${body}`;
}
