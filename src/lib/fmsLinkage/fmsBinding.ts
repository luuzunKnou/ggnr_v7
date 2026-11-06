/**
 * FMS 안전점검 — 시설물·점검진단실적은 도로 테이블 한 쌍(road_fms_facility / road_fms_inspection)에 모두 담고,
 * 상하수도·도로·건축물 구분은 시설물구분(facil_gbn)으로 한다.
 */
import {
  facilGbnTokensForGroup,
  type FmsFacilGroup,
} from '@/lib/fmsLinkage/prefixRouting';

export type { FmsFacilGroup } from '@/lib/fmsLinkage/prefixRouting';

export const FMS_FACILITY_TABLE = 'road_fms_facility';
export const FMS_INSPECTION_TABLE = 'road_fms_inspection';

export const FMS_FACIL_GROUPS: readonly FmsFacilGroup[] = ['water', 'road', 'public'];

const SYSTEM_KEY_TO_GROUP: Record<string, FmsFacilGroup> = {
  river: 'water',
  road: 'road',
  build: 'public',
};

/** 시설물구분(facil_gbn) → 시스템. 재난안전·미지정은 전체. 코드·한글 모두 */
export function getFmsFacilGbnFilterForSystem(systemKey: string | null | undefined): readonly string[] | null {
  const key = String(systemKey ?? '').trim().toLowerCase();
  if (!key || key === 'safety') return null;
  const group = SYSTEM_KEY_TO_GROUP[key];
  if (!group) return null;
  return facilGbnTokensForGroup(group);
}

function systemKeyToFmsGroup(systemKey: string): FmsFacilGroup | null {
  return SYSTEM_KEY_TO_GROUP[String(systemKey ?? '').trim().toLowerCase()] ?? null;
}

/** ENABLED_SYSTEMS=null 이면 상하수도·도로·건축물 전부 */
export function getFmsGroupsForEnabledSystems(enabledSystems: string[] | null): FmsFacilGroup[] {
  if (!enabledSystems?.length) return [...FMS_FACIL_GROUPS];
  const out: FmsFacilGroup[] = [];
  for (const key of enabledSystems) {
    const group = systemKeyToFmsGroup(key);
    if (group && !out.includes(group)) out.push(group);
  }
  return out;
}

export function isFmsGroupAllowedBySystems(group: FmsFacilGroup, enabledSystems: string[] | null): boolean {
  return getFmsGroupsForEnabledSystems(enabledSystems).includes(group);
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

export function getFmsLayerTableName(kind: FmsDataKind): string {
  return kind === 'facility' ? FMS_FACILITY_TABLE : FMS_INSPECTION_TABLE;
}

/** 데이터조회 — 안전점검 시설물 테이블은 조회만 (수정·추가·삭제 불가) */
export function isFmsFacilityLayerTable(table: string | null | undefined): boolean {
  return String(table ?? '').trim().toLowerCase() === FMS_FACILITY_TABLE;
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
