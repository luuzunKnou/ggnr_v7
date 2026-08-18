/**
 * 필지분석 외부 API 동시 호출 수·단건 타임아웃 (소스 상수, 단일 출처).
 */
/** 건축물대장 포털 동시 호출 수 (초당 한도 고려) */
export const PARCEL_ANALYSIS_BUILDING_CONCURRENCY = 3;

/** 건축물대장 포털 요청 시작 최소 간격(ms) */
export const PARCEL_ANALYSIS_BUILDING_GAP_MS = 200;

/** 행망(KRAS·KOREPS) 연계 동시 조회 수 (필지분석 보강·토지이용계획) */
export const PARCEL_ANALYSIS_LINKAGE_CONCURRENCY = 8;

/** KRAS·브이월드 등 연계 단건 요청 타임아웃(ms) */
export const PARCEL_ANALYSIS_LINKAGE_TIMEOUT_MS = 8_000;

/** 건축물대장 공공데이터 단건 요청 타임아웃(ms) */
export const PARCEL_ANALYSIS_BUILDING_TIMEOUT_MS = 10_000;

/** 결과 지도(테마·캡처) 브이월드 타일 1장 로드 타임아웃(ms) — 초과 시 단색 폴백 */
export const PARCEL_ANALYSIS_BASEMAP_TILE_TIMEOUT_MS = 8_000;

/** 지도·범례에 쓰지 않는 구분(표만) */
export const PARCEL_THEME_OTHER_FILL = 'rgba(217, 255, 0, 0.4)';
export const PARCEL_THEME_OTHER_STROKE = 'rgba(217, 255, 0, 0.75)';

/** 테마 지도 — 필지 없음(도로·골목 등) 바탕 (항공영상 위 반투명) */
export const PARCEL_THEME_MAP_NO_PARCEL_FILL = 'rgba(232, 232, 232, 0.35)';
export const PARCEL_THEME_MAP_NO_PARCEL_STROKE = '#D0D0D0';

/** 테마 지도 — 전 구분 색칠 상한 필지 수 */
export const PARCEL_THEME_MAP_FULL_COLOR_LIMIT = 2000;

/** 테마 지도 — 상한 초과 시 지도에 색칠할 상위 구분 수 */
export const PARCEL_THEME_MAP_TOP_CATEGORY_COUNT = 10;

/** PostGIS ST_SimplifyPreserveTopology 허용오차(미터, EPSG:5181) */
export const PARCEL_THEME_MAP_SIMPLIFY_TOLERANCE_M = 1.0;

/**
 * 분석 영역 화면 표시 하한(초기 맞춤 대비).
 * 0.3 = 영역이 화면에서 30% 크기까지 축소되면 더 이상 축소 불가
 */
export const PARCEL_THEME_MAP_MIN_AREA_VISIBLE_RATIO = 0.3;

/** 지도 «그 외» 통합 도형 구분 키 (API·스타일 공통) */
export const PARCEL_THEME_MAP_OTHER_CATEGORY = '__theme_other__';

export type ParcelThemeMapKind = 'owner' | 'jimok';

export type ParcelThemeMapCategory = {
  label: string;
  count: number;
  areaSqm: number;
  onMap: boolean;
};

export type ParcelThemeMapFeature = {
  /** PNU 단위 도형일 때 — 클라이언트에서 보강 범주/지목으로 색칠 */
  pnu?: string;
  category: string;
  geometry: GeoJSON.Geometry;
};

export type ParcelThemeMapPayload = {
  ok: boolean;
  theme?: ParcelThemeMapKind;
  parcelCount?: number;
  mapCategoryLimitApplied?: boolean;
  categories?: ParcelThemeMapCategory[];
  features?: ParcelThemeMapFeature[];
  error?: string;
};

/** 클라 보강 결과로 테마 범주·지도용 라벨(상위 N) 산출 */
export type ThemeMapParcelInput = {
  pnu: string;
  category: string;
  areaSqm?: number;
};

export function buildThemeCategoriesFromParcels(
  parcels: ThemeMapParcelInput[],
  parcelCountHint?: number
): { categories: ParcelThemeMapCategory[]; onMapLabels: Set<string>; mapCategoryLimitApplied: boolean } {
  const map = new Map<string, { count: number; areaSqm: number }>();
  for (const p of parcels) {
    const label = String(p.category ?? '').trim() || '미상';
    const prev = map.get(label) ?? { count: 0, areaSqm: 0 };
    map.set(label, {
      count: prev.count + 1,
      areaSqm: prev.areaSqm + (Number(p.areaSqm) || 0),
    });
  }
  const ranked = [...map.entries()]
    .map(([label, v]) => ({ label, count: v.count, areaSqm: v.areaSqm }))
    .sort((a, b) => b.areaSqm - a.areaSqm || b.count - a.count);

  const parcelCount = parcelCountHint ?? parcels.length;
  const limitApplied = parcelCount > PARCEL_THEME_MAP_FULL_COLOR_LIMIT;
  const allowed = new Set(
    (limitApplied ? ranked.slice(0, PARCEL_THEME_MAP_TOP_CATEGORY_COUNT) : ranked).map((r) => r.label)
  );

  const categories: ParcelThemeMapCategory[] = ranked.map((r) => ({
    label: r.label,
    count: r.count,
    areaSqm: r.areaSqm,
    onMap: allowed.has(r.label),
  }));

  return { categories, onMapLabels: allowed, mapCategoryLimitApplied: limitApplied };
}

export function resolveThemeFeatureCategory(
  rawCategory: string,
  onMapLabels: Set<string>
): string {
  const label = String(rawCategory ?? '').trim() || '미상';
  if (onMapLabels.has(label)) return label;
  return PARCEL_THEME_MAP_OTHER_CATEGORY;
}

const OWNER_COLORS: Record<string, string> = {
  개인: '#43A047',
  국유지: '#1E88E5',
  군유지: '#8E24AA',
  '시 도유지': '#FB8C00',
  '시, 도유지': '#FB8C00',
  '시·도유지': '#FB8C00',
  시도유지: '#FB8C00',
  법인: '#6D4C41',
  종중: '#546E7A',
  종교단체: '#D81B60',
  미상: '#8E8E8E',
  기타: '#BDBDBD',
};

const JIMOK_COLORS: Record<string, string> = {
  전: '#F9A825',
  답: '#C0CA33',
  과수원: '#7CB342',
  목장용지: '#8BC34A',
  임야: '#2E7D32',
  광천지: '#26A69A',
  염전: '#00ACC1',
  대: '#EF6C00',
  공장용지: '#78909C',
  학교용지: '#5C6BC0',
  주차장: '#7E57C2',
  주유소용지: '#EC407A',
  창고용지: '#8D6E63',
  도로: '#616161',
  철도용지: '#455A64',
  제방: '#4FC3F7',
  하천: '#29B6F6',
  구거: '#4DD0E1',
  유지: '#26C6DA',
  양어장: '#00BCD4',
  수도용지: '#039BE5',
  공원: '#66BB6A',
  체육용지: '#9CCC65',
  유원지: '#AB47BC',
  종교용지: '#7E57C2',
  사적지: '#A1887F',
  묘지: '#90A4AE',
  잡종지: '#B0BEC5',
  미상: '#8E8E8E',
  기타: '#BDBDBD',
};

const FALLBACK_PALETTE = [
  '#E53935',
  '#3949AB',
  '#00897B',
  '#F4511E',
  '#6A1B9A',
  '#C0CA33',
  '#00ACC1',
  '#8D6E63',
];

function hashLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i += 1) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return h;
}

export function resolveOwnerThemeColor(label: string): string {
  const key = String(label ?? '').trim() || '미상';
  return OWNER_COLORS[key] ?? FALLBACK_PALETTE[hashLabel(key) % FALLBACK_PALETTE.length];
}

export function resolveJimokThemeColor(label: string): string {
  const key = String(label ?? '').trim() || '미상';
  return JIMOK_COLORS[key] ?? FALLBACK_PALETTE[hashLabel(key) % FALLBACK_PALETTE.length];
}

export function resolveThemeColor(theme: 'owner' | 'jimok', label: string): string {
  return theme === 'owner' ? resolveOwnerThemeColor(label) : resolveJimokThemeColor(label);
}

/** 지도·범례 공통 필지 채움 투명도 */
export const PARCEL_THEME_MAP_FILL_OPACITY = 0.3;

export function themeFillColor(hex: string, opacity = PARCEL_THEME_MAP_FILL_OPACITY): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return `rgba(120, 120, 120, ${opacity})`;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** 범례 색칩 — 지도 필지와 동일(반투명 채움 + 원색 테두리) */
export function themeSwatchStyle(hex: string): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: themeFillColor(hex),
    borderColor: hex,
  };
}

export function themeOtherSwatchStyle(): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: PARCEL_THEME_OTHER_FILL,
    borderColor: PARCEL_THEME_OTHER_STROKE,
  };
}

export function themeNoParcelSwatchStyle(): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: PARCEL_THEME_MAP_NO_PARCEL_FILL,
    borderColor: PARCEL_THEME_MAP_NO_PARCEL_STROKE,
  };
}
