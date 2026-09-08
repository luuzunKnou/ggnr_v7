import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { takeMountainFromJibunRest } from '@/lib/excelUploadAddressNormalize';

const BONBUN_LEN = 4;
const BUBUN_LEN = 4;

export type OccupPlaceJijukParts = {
  emdName: string;
  riName: string;
  bonbun: string;
  bubun: string;
  isMountain: boolean;
};

export type OccupPlaceInherit = {
  emdName?: string;
  riName?: string;
};

/** 쉼표로 이어진 점용장소를 필지 단위로 나눈다. */
export function splitOccupPlaceSegments(raw: string): string[] {
  return String(raw ?? '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 점용장소 한 토막 → 지적 맞춤용 문자열.
 * 시·군 접두와 지번·번지·등·일원·외 필지를 빼고 읍·면·동·리·본번-부번만 남긴다.
 */
export function normalizeOccupPlaceForJijuk(raw: string): string {
  let s = formatAddressStripSidoSigungu(String(raw ?? '').trim());
  if (!s) return '';
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/외\s*\d+\s*(?:필지|번지)/gi, ' ');
  s = s.replace(/(\d{1,5})\s*번지\s+(\d{1,5})\s*호/gu, '$1-$2');
  s = s.replace(/지번/g, ' ');
  s = s.replace(/번지/g, ' ');
  s = s.replace(/일원/g, ' ');
  s = s.replace(/(?:^|\s)등(?:\s|$)/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function lotFromRest(rest: string): {
  bonbun: string;
  bubun: string;
  isMountain: boolean;
} | null {
  const t = String(rest ?? '').trim();
  if (!t) return null;
  const { isMountain, jibunRest } = takeMountainFromJibunRest(t);
  const m = jibunRest.match(/^(\d+)(?:-(\d+))?/u);
  if (!m?.[1]) return null;
  return {
    bonbun: m[1].padStart(BONBUN_LEN, '0').slice(-BONBUN_LEN),
    bubun: (m[2] ?? '0').padStart(BUBUN_LEN, '0').slice(-BUBUN_LEN),
    isMountain,
  };
}

/** 읍·면·동 + 리 + 지번. 앞 토막에서 받은 읍·면은 뒤 토막에 이어 쓴다. */
export function parseOccupPlaceForJijuk(
  raw: string,
  inherit?: OccupPlaceInherit
): OccupPlaceJijukParts | null {
  const s = normalizeOccupPlaceForJijuk(raw);
  if (!s) return null;
  const tokens = s.split(/\s+/).filter(Boolean);
  let emdName = String(inherit?.emdName ?? '').trim();
  let riName = String(inherit?.riName ?? '').trim();
  for (const t of tokens) {
    if (/(읍|면|동)$/u.test(t)) emdName = t;
    else if (/리$/u.test(t)) riName = t;
  }
  if (!riName) return null;

  const riIdx = tokens.lastIndexOf(riName);
  const rest = (riIdx >= 0 ? tokens.slice(riIdx + 1) : tokens)
    .filter((t) => t !== emdName && t !== riName)
    .join(' ')
    .trim();
  const lot = lotFromRest(rest);
  if (!lot) return null;
  return {
    emdName,
    riName,
    bonbun: lot.bonbun,
    bubun: lot.bubun,
    isMountain: lot.isMountain,
  };
}

/** 쉼표로 나눈 뒤 각 필지. 뒤 토막에 읍·면이 없으면 앞 토막 값을 쓴다. */
export function parseOccupPlacePartsForJijuk(raw: string): OccupPlaceJijukParts[] {
  const segs = splitOccupPlaceSegments(raw);
  const out: OccupPlaceJijukParts[] = [];
  let inherit: OccupPlaceInherit = {};
  for (const seg of segs) {
    const parsed = parseOccupPlaceForJijuk(seg, inherit);
    if (!parsed) continue;
    inherit = { emdName: parsed.emdName, riName: parsed.riName };
    out.push(parsed);
  }
  return out;
}
