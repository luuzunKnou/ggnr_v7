import type { CSSProperties } from 'react';

export function formatSqm(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v).toLocaleString()}㎡`;
}

export const OWN_FILTER_ALL = '전체';

/** 소유구분 순서 — 지도 소유자정보 범례와 동일 */
const OWN_GBN_ORDER = [
  '개인',
  '국유지',
  '군유지',
  '법인',
  '시, 도유지',
  '외국인, 외국공공기관',
  '일본인, 창씨명등',
  '종교단체',
  '종중',
  '기타단체',
];

const OWN_GBN_SHORT: Record<string, string> = {
  '시, 도유지': '시도유지',
  '외국인, 외국공공기관': '외국인',
  '일본인, 창씨명등': '일본인',
};

/** 목록 배지·필터용 짧은 이름 */
export function ownGbnShort(ownGbn: string): string {
  return OWN_GBN_SHORT[ownGbn] ?? ownGbn;
}

/** 필터 — 구간과 겹치는 건물·건물군만 */
export const OWN_FILTER_BUILDING = '건물';

/** 분석 결과에 있는 소유구분만 필터로 — 범례 순서, 범례에 없는 값(미상 등)은 뒤에. 건물이 있으면 맨 끝에 «건물» */
export function ownFilterOptions(ownGbns: Iterable<string>, hasBuildings = false): { key: string; label: string }[] {
  const present = new Set(ownGbns);
  const known = OWN_GBN_ORDER.filter((k) => present.has(k));
  const extra = [...present].filter((k) => k && !OWN_GBN_ORDER.includes(k)).sort();
  return [
    { key: OWN_FILTER_ALL, label: OWN_FILTER_ALL },
    ...[...known, ...extra].map((k) => ({ key: k, label: ownGbnShort(k) })),
    ...(hasBuildings ? [{ key: OWN_FILTER_BUILDING, label: OWN_FILTER_BUILDING }] : []),
  ];
}

/** 필지는 소유구분, 건물·건물군은 «건물» 필터로만 걸린다 */
export function matchesOwnFilter(filter: string, ownGbn: string, isBuilding = false): boolean {
  if (filter === OWN_FILTER_ALL) return true;
  if (filter === OWN_FILTER_BUILDING) return isBuilding;
  return !isBuilding && ownGbn === filter;
}

/** 지목이 비어 있는 필지 필터 이름 */
export const JIMOK_FILTER_NONE = '미상';

/** 지목 필터 키 — 한 글자 부호(임·답 등)와 전체 이름을 같은 지목으로 묶는다 */
export function jimokFilterKey(jimok: string | null | undefined): string {
  return jimokFullName(jimok) || JIMOK_FILTER_NONE;
}

/** 지목 전체 이름 — 한 글자 부호(천·임 등)는 하천·임야처럼 풀어서. 상세 표시용 */
export function jimokFullName(jimok: string | null | undefined): string {
  const j = String(jimok ?? '').trim();
  return JIMOK_SHORT[j] ?? j;
}

/** 분석 결과에 있는 지목만 필터로 — 필지 수 많은 순, 같으면 이름순. 건물은 지목이 없어 제외 */
export function jimokFilterOptions(jimoks: Iterable<string>): { key: string; label: string }[] {
  const freq = new Map<string, number>();
  for (const j of jimoks) {
    const k = jimokFilterKey(j);
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const keys = [...freq.keys()].sort((a, b) => {
    if (a === JIMOK_FILTER_NONE) return 1;
    if (b === JIMOK_FILTER_NONE) return -1;
    return (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || a.localeCompare(b, 'ko');
  });
  return [{ key: OWN_FILTER_ALL, label: OWN_FILTER_ALL }, ...keys.map((k) => ({ key: k, label: k }))];
}

/** 필지는 지목, 건물·건물군은 지목이 없어 «전체»일 때만 보인다 */
export function matchesJimokFilter(filter: string, jimok: string, isBuilding = false): boolean {
  if (filter === OWN_FILTER_ALL) return true;
  return !isBuilding && jimokFilterKey(jimok) === filter;
}

/** 검색어(소문자) — 주소·PNU·소유구분·지목·건물명 */
export function matchesParcelKeyword(
  p: { address: string; pnu: string; ownGbn: string; jimok: string; name?: string },
  lowerKeyword: string
): boolean {
  if (!lowerKeyword) return true;
  return `${p.address} ${p.pnu} ${p.ownGbn} ${p.jimok} ${p.name ?? ''}`.toLowerCase().includes(lowerKeyword);
}

/** 건물 행 배지 이름 */
export const BUILDING_KIND_LABEL: Record<'building' | 'buildingGroup', string> = {
  building: '건물',
  buildingGroup: '건물군',
};

/** 건물 배지·지도 윤곽 색 */
export const BUILDING_COLOR = '#6B7280';

export function buildingBadgeStyle(): CSSProperties {
  return badgeStyle(BUILDING_COLOR);
}

/** 소유구분 색 — 지도 소유자정보 레이어 범례(GeoServer 스타일)와 동일 */
const OWN_GBN_COLOR: Record<string, string> = {
  개인: '#4CAF50',
  국유지: '#3F51B5',
  군유지: '#00BCD4',
  법인: '#FF5722',
  '시, 도유지': '#F44336',
  '외국인, 외국공공기관': '#F44336',
  '일본인, 창씨명등': '#FF9800',
  종교단체: '#CDDC39',
  종중: '#03A9F4',
  기타단체: '#3F51B5',
};

/** 지목 색 — 지도 지목 레이어 범례(GeoServer 스타일)와 동일 */
const JIMOK_COLOR: Record<string, string> = {
  전: '#3F51B5',
  답: '#4CAF50',
  과수원: '#FF5722',
  목장용지: '#F44336',
  임야: '#FF9800',
  광천지: '#A749F9',
  염전: '#F44336',
  대: '#8BC34A',
  공장용지: '#03A9F4',
  학교용지: '#F44336',
  주차장: '#00BCD4',
  주유소용지: '#F44336',
  창고용지: '#673AB7',
  도로: '#FF9800',
  철도용지: '#8BC34A',
  제방: '#CDDC39',
  하천: '#FFC107',
  구거: '#9C27B0',
  유지: '#00BCD4',
  양어장: '#FF9800',
  수도용지: '#3F51B5',
  공원: '#03A9F4',
  체육용지: '#E91E63',
  유원지: '#CDDC39',
  종교용지: '#FFEB3B',
  사적지: '#673AB7',
  묘지: '#E91E63',
  잡종지: '#2196F3',
};

/** 지적 한 글자 지목 부호 → 지목명 */
const JIMOK_SHORT: Record<string, string> = {
  임: '임야',
  광: '광천지',
  염: '염전',
  장: '공장용지',
  학: '학교용지',
  차: '주차장',
  주: '주유소용지',
  창: '창고용지',
  도: '도로',
  철: '철도용지',
  제: '제방',
  천: '하천',
  구: '구거',
  유: '유지',
  양: '양어장',
  수: '수도용지',
  공: '공원',
  체: '체육용지',
  원: '유원지',
  종: '종교용지',
  사: '사적지',
  묘: '묘지',
  잡: '잡종지',
};

const FALLBACK_COLOR = '#9E9E9E';

export function ownGbnColor(ownGbn: string): string {
  return OWN_GBN_COLOR[ownGbn] ?? FALLBACK_COLOR;
}

export function jimokColor(jimok: string): string {
  return JIMOK_COLOR[jimok] ?? JIMOK_COLOR[JIMOK_SHORT[jimok] ?? ''] ?? FALLBACK_COLOR;
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 배지 글자색 — 밝은 색(노랑 등)도 읽히도록 검정 쪽으로 섞음 */
function darken(hex: string, ratio: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => Math.round(v * (1 - ratio));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

function badgeStyle(hex: string): CSSProperties {
  return {
    backgroundColor: hexToRgba(hex, 0.16),
    borderColor: hexToRgba(hex, 0.55),
    color: darken(hex, 0.4),
  };
}

export function ownGbnBadgeStyle(ownGbn: string): CSSProperties {
  return badgeStyle(ownGbnColor(ownGbn));
}

export function jimokBadgeStyle(jimok: string): CSSProperties {
  return badgeStyle(jimokColor(jimok));
}
