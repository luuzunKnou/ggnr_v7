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

/** 분석 결과에 있는 소유구분만 필터로 — 범례 순서, 범례에 없는 값(미상 등)은 뒤에 */
export function ownFilterOptions(ownGbns: Iterable<string>): { key: string; label: string }[] {
  const present = new Set(ownGbns);
  const known = OWN_GBN_ORDER.filter((k) => present.has(k));
  const extra = [...present].filter((k) => k && !OWN_GBN_ORDER.includes(k)).sort();
  return [
    { key: OWN_FILTER_ALL, label: OWN_FILTER_ALL },
    ...[...known, ...extra].map((k) => ({ key: k, label: ownGbnShort(k) })),
  ];
}

export function matchesOwnFilter(filter: string, ownGbn: string): boolean {
  return filter === OWN_FILTER_ALL || ownGbn === filter;
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
