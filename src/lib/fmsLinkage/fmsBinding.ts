/**
 * FMS 안전점검 — system · 접두(water|road|public) → layer 테이블
 * (점사용료 useFeeBinding 과 동일 접두 규칙)
 */
import { facilGbnTokensForPrefix } from '@/lib/fmsLinkage/prefixRouting';

export const FMS_PREFIXES = ['water', 'road', 'public'] as const;
export type FmsPrefix = (typeof FMS_PREFIXES)[number];

export type FmsBinding = {
  schema: 'layer';
  facilityTable: string;
  inspectionTable: string;
  prefix: FmsPrefix;
  systemKey: 'river' | 'road' | 'build';
  title: string;
};

const BINDINGS_BY_PREFIX: Record<FmsPrefix, FmsBinding> = {
  water: {
    schema: 'layer',
    facilityTable: 'water_fms_facility',
    inspectionTable: 'water_fms_inspection',
    prefix: 'water',
    systemKey: 'river',
    title: '하천 안전점검',
  },
  road: {
    schema: 'layer',
    facilityTable: 'road_fms_facility',
    inspectionTable: 'road_fms_inspection',
    prefix: 'road',
    systemKey: 'road',
    title: '도로 안전점검',
  },
  public: {
    schema: 'layer',
    facilityTable: 'public_fms_facility',
    inspectionTable: 'public_fms_inspection',
    prefix: 'public',
    systemKey: 'build',
    title: '국공유지 안전점검',
  },
};

const SYSTEM_KEY_TO_PREFIX: Record<string, FmsPrefix> = {
  river: 'water',
  road: 'road',
  build: 'public',
};

/** 시설물구분(facil_gbn) → 시스템. 재난안전·미지정은 전체. 코드·한글 모두 */
export function getFmsFacilGbnFilterForSystem(systemKey: string | null | undefined): readonly string[] | null {
  const key = String(systemKey ?? '').trim().toLowerCase();
  if (!key || key === 'safety') return null;
  const prefix = SYSTEM_KEY_TO_PREFIX[key];
  if (!prefix) return null;
  return facilGbnTokensForPrefix(prefix);
}

export function isFmsPrefix(v: string): v is FmsPrefix {
  return (FMS_PREFIXES as readonly string[]).includes(v);
}

export function getFmsBindingByPrefix(prefix: FmsPrefix): FmsBinding {
  return BINDINGS_BY_PREFIX[prefix];
}

export function fmsPrefixToSystemKey(prefix: FmsPrefix): 'river' | 'road' | 'build' {
  return BINDINGS_BY_PREFIX[prefix].systemKey;
}

export function systemKeyToFmsPrefix(systemKey: string): FmsPrefix | null {
  return SYSTEM_KEY_TO_PREFIX[String(systemKey ?? '').trim().toLowerCase()] ?? null;
}

/** ENABLED_SYSTEMS=null 이면 water·road·public 전부 */
export function getFmsPrefixesForEnabledSystems(enabledSystems: string[] | null): FmsPrefix[] {
  if (!enabledSystems?.length) return [...FMS_PREFIXES];
  const out: FmsPrefix[] = [];
  for (const key of enabledSystems) {
    const prefix = systemKeyToFmsPrefix(key);
    if (prefix && !out.includes(prefix)) out.push(prefix);
  }
  return out;
}

export function isFmsPrefixAllowedBySystems(
  prefix: FmsPrefix,
  enabledSystems: string[] | null
): boolean {
  return getFmsPrefixesForEnabledSystems(enabledSystems).includes(prefix);
}

/** v6 identifier → layer 테이블 종류 */
export type FmsDataKind = 'facility' | 'inspection';

const IDENTIFIER_TO_KIND: Record<string, FmsDataKind> = {
  BASTB_MASTER: 'facility',
  MANTB_DIGN_RESULT: 'inspection',
};

export function getFmsDataKindForIdentifier(identifier: string | null | undefined): FmsDataKind | null {
  const key = String(identifier ?? '').trim().toUpperCase();
  return IDENTIFIER_TO_KIND[key] ?? null;
}

export function getFmsLayerTableName(prefix: FmsPrefix, kind: FmsDataKind): string {
  const binding = BINDINGS_BY_PREFIX[prefix];
  return kind === 'facility' ? binding.facilityTable : binding.inspectionTable;
}

export const FMS_FACILITY_TABLE_NAMES = FMS_PREFIXES.map((p) =>
  getFmsLayerTableName(p, 'facility')
);

export const FMS_INSPECTION_TABLE_NAMES = FMS_PREFIXES.map((p) =>
  getFmsLayerTableName(p, 'inspection')
);

/** 데이터조회 — 안전점검 시설물 3테이블은 조회만 (수정·추가·삭제 불가) */
export function isFmsFacilityLayerTable(table: string | null | undefined): boolean {
  const t = String(table ?? '').trim().toLowerCase();
  if (!t) return false;
  return FMS_FACILITY_TABLE_NAMES.some((n) => n.toLowerCase() === t);
}

/** opened / ser_eng — 기존 도로 키와 공통 키를 같은 화면으로 */
export const FMS_OPENED_KEYS = ['roadFMS', 'fmsLinkage'] as const;

export function isFmsOpenedToken(token: string): boolean {
  const t = String(token ?? '').trim();
  return (FMS_OPENED_KEYS as readonly string[]).includes(t);
}

export function findOpenedFmsToken(openedTokens: string[]): string | null {
  for (const token of openedTokens) {
    if (isFmsOpenedToken(token)) return token;
  }
  return null;
}
