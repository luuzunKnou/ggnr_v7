import type { SafetydataRefreshSchedule } from '@/integrations/safetydata.config';

/** 매일 새벽 1시 — 6세대 토지행정망 배치와 동일. 기동 직후 실행 없음 */
export const KRAS_LAYER_REFRESH_SCHEDULE: SafetydataRefreshSchedule = {
  mode: 'daily',
  hour: 1,
  minute: 0,
};

export const KRAS_SHAPE_QUERY_ID = 'KRAS000038';
export const KRAS_CATALOG_QUERY_ID = 'KRAS000037';
export const KRAS_LAND_BASIC_QUERY_ID = 'KRAS000040';
export const KOREPS_PRICE_FILE_QUERY_ID = 'KOREPS00039';

export const KRAS_LANDOWN_TABLE = 'landown';
export const KRAS_LAND_BASIC_TABLE = 'kras000040';
export const KOREPS_PRICE_FILE_TABLE = 'koreps00039';

export const KRAS_LANDOWN_OWN_LABEL: Record<string, string> = {
  '00': '일본인, 창씨명등',
  '01': '개인',
  '02': '국유지',
  '03': '외국인, 외국공공기관',
  '04': '시, 도유지',
  '05': '군유지',
  '06': '법인',
  '07': '종중',
  '08': '종교단체',
  '09': '기타단체',
};

export const KRAS_LAYER_SCHEMA_CANDIDATES = ['public_layer', 'layer'] as const;

export const KRAS_LAYER_CATALOG_SCHEMA = 'land_linkage';
export const KRAS_LAYER_CATALOG_TABLE = 'kras000037';

/** shp / dbf / shx — 규격 file_type */
export const KRAS_SHAPE_FILE_PARTS = [
  { fileType: '2', ext: 'shp' },
  { fileType: '3', ext: 'dbf' },
  { fileType: '4', ext: 'shx' },
] as const;

/** 연속지적·읍면동·리 — 목록 코드 접미사 → 지도 테이블 */
export const KRAS_FIXED_LAYER_MAP = [
  {
    layerSuffix: 'LSMD_CONT_LDREG',
    targetTable: 'jijuk',
    label: '지적',
    kind: 'parcel' as const,
  },
  {
    layerSuffix: 'LSMD_ADM_SECT_UMD',
    targetTable: 'emd',
    label: '읍면동',
    kind: 'boundary' as const,
  },
  {
    layerSuffix: 'LSMD_ADM_SECT_RI',
    targetTable: 'ri',
    label: '리',
    kind: 'boundary' as const,
  },
] as const;

export const KRAS_THEMATIC_GROUP_ID = 'PLAN_00004';

/** 지도 주제도에 노출하는 정의 그룹 — 원본만 받음 */
export const KRAS_THEMATIC_DEFINE_GROUPS = [
  '도시계획시설',
  '용도구역',
  '용도지구',
  '용도지역',
  '주제도(기타)',
  '지구단위계획구역',
  '행정제한/특별고시',
] as const;

export const KRAS_DEFAULT_SOURCE_SRS = 'EPSG:5176';
export const KRAS_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
/** 기존 건수가 이보다 클 때만 급감 검사 */
export const KRAS_DROP_GUARD_MIN_OLD = 100;
/** 새 건수가 기존 대비 이 비율 미만이면 교체하지 않음 */
export const KRAS_DROP_GUARD_RATIO = 0.3;

export type KrasLayerSyncScope = 'all' | 'parcel' | 'boundary' | 'thematic';

/** 개발자 모드 KRAS 대상 — 도형 범위 + 목록·토지기본·소유현황 */
export type KrasIntegrationTarget = KrasLayerSyncScope | 'catalog' | 'landinfo' | 'landown';
