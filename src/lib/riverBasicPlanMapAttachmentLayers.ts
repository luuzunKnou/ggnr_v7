/**
 * 하천기본계획 — 지도 식별 시 도면 첨부(상세목록 도면보기와 동일 경로)로 열 수 있는 define_table_name.
 * 서버 `riverBasicPlanService`의 구조물 목록·open_scan 설정과 동기화할 것.
 */
export type RiverBasicPlanTab = 'river' | 'smallRiver';

export const RIVER_PLAN_GD_STRUCTURE_DEFINE_TABLES = [
  'river_plan_gd_ps',
  'river_plan_gd_ps_gg',
  'river_plan_gd_ps_gr',
  'river_plan_gd_ps_etc',
  'river_plan_gd_ps_ncg',
  'river_plan_gd_ps_dam',
  'river_plan_gd_ps_road',
  'river_plan_gd_ps_bsm',
  'river_plan_gd_ps_bsag',
  'river_plan_gd_ps_bstg',
  'river_plan_gd_ps_bo',
  'river_plan_gd_ps_sm',
  'river_plan_gd_ps_csb',
  'river_plan_gd_ps_cib',
] as const;

/** 소하천 구조물 — 분할 자식 없이 부모 단일 테이블 */
export const RIVER_PLAN_S_GD_STRUCTURE_DEFINE_TABLES = ['river_plan_s_gd_ps'] as const;

export const RIVER_BASIC_PLAN_MAP_ATTACHMENT_DEFINE_TABLES: readonly string[] = [
  'river_plan_jd_lm',
  'river_plan_hd_lm',
  ...RIVER_PLAN_GD_STRUCTURE_DEFINE_TABLES,
  'river_plan_s_jd_lm',
  'river_plan_s_hd_lm',
  ...RIVER_PLAN_S_GD_STRUCTURE_DEFINE_TABLES,
];

const ATTACHMENT_DEFINE_TABLE_SET = new Set(
  RIVER_BASIC_PLAN_MAP_ATTACHMENT_DEFINE_TABLES.map((t) => t.toLowerCase()),
);

export function isRiverBasicPlanMapAttachmentDefineTable(name: string): boolean {
  return ATTACHMENT_DEFINE_TABLE_SET.has(String(name ?? '').trim().toLowerCase());
}

/** 지방하천 색인도 define_table_name */
export const RIVER_BASIC_PLAN_INDEX_DEFINE_TABLE = 'river_d_index';
/** 소하천 색인도 define_table_name */
export const RIVER_BASIC_PLAN_SMALL_INDEX_DEFINE_TABLE = 'river_s_index';

export function isRiverBasicPlanIndexDefineTable(name: string): boolean {
  const k = String(name ?? '').trim().toLowerCase();
  return k === RIVER_BASIC_PLAN_INDEX_DEFINE_TABLE || k === RIVER_BASIC_PLAN_SMALL_INDEX_DEFINE_TABLE;
}

export function riverBasicPlanTabFromIndexDefineTable(name: string): RiverBasicPlanTab {
  return String(name ?? '').trim().toLowerCase() === RIVER_BASIC_PLAN_SMALL_INDEX_DEFINE_TABLE
    ? 'smallRiver'
    : 'river';
}

/** 탭별 기본계획(폴리곤) define_table_name */
export function riverBasicPlanAsDefineTable(tab: RiverBasicPlanTab): string {
  return tab === 'smallRiver' ? 'river_plan_s_as' : 'river_plan_as';
}

/** 탭별 색인도 define_table_name */
export function riverBasicPlanIndexDefineTable(tab: RiverBasicPlanTab): string {
  return tab === 'smallRiver' ? RIVER_BASIC_PLAN_SMALL_INDEX_DEFINE_TABLE : RIVER_BASIC_PLAN_INDEX_DEFINE_TABLE;
}

/** 탭별 종단면도 */
export function riverBasicPlanJdDefineTable(tab: RiverBasicPlanTab): string {
  return tab === 'smallRiver' ? 'river_plan_s_jd_lm' : 'river_plan_jd_lm';
}

/** 탭별 횡단면도 */
export function riverBasicPlanHdDefineTable(tab: RiverBasicPlanTab): string {
  return tab === 'smallRiver' ? 'river_plan_s_hd_lm' : 'river_plan_hd_lm';
}

/** 탭별 구조물(부모) */
export function riverBasicPlanGdParentDefineTable(tab: RiverBasicPlanTab): string {
  return tab === 'smallRiver' ? 'river_plan_s_gd_ps' : 'river_plan_gd_ps';
}

/** 목록에서 하천 선택 시 WMS에 river_name 조건을 걸 수 있는 define_table_name */
export function riverBasicPlanRiverNameFilterableLayers(tab: RiverBasicPlanTab): readonly string[] {
  if (tab === 'smallRiver') {
    return [
      RIVER_BASIC_PLAN_SMALL_INDEX_DEFINE_TABLE,
      'river_plan_s_as',
      'river_plan_s_jd_lm',
      'river_plan_s_hd_lm',
      ...RIVER_PLAN_S_GD_STRUCTURE_DEFINE_TABLES,
    ];
  }
  return [
    RIVER_BASIC_PLAN_INDEX_DEFINE_TABLE,
    'river_plan_as',
    'river_plan_jd_lm',
    'river_plan_hd_lm',
    ...RIVER_PLAN_GD_STRUCTURE_DEFINE_TABLES,
  ];
}

/** GeoServer CQL — 선택 하천만 표시 */
export function buildRiverBasicPlanRiverNameCql(riverName: string): string {
  const v = String(riverName ?? '').trim().replace(/'/g, "''");
  if (!v) return 'INCLUDE';
  return `river_name='${v}'`;
}

/** 선택 하천·탭에 대한 레이어별 CQL 맵 (비우면 null) */
export function buildRiverBasicPlanRiverNameCqlByLayer(
  tab: RiverBasicPlanTab,
  riverName: string
): Record<string, string> | null {
  const name = String(riverName ?? '').trim();
  if (!name) return null;
  const cql = buildRiverBasicPlanRiverNameCql(name);
  if (cql === 'INCLUDE') return null;
  const out: Record<string, string> = {};
  for (const layer of riverBasicPlanRiverNameFilterableLayers(tab)) {
    out[layer] = cql;
  }
  return out;
}

/**
 * 지도 식별 결과가 겹칠 때 처리 순서: 포인트(0) → 라인(1) → 폴리곤(2).
 * defineLayer `define_table_shp_type`·테이블명과 맞춤.
 */
export function riverBasicPlanIdentifyGeometryRank(defineTableName: string): number {
  const k = String(defineTableName ?? '').trim().toLowerCase();
  if (!k) return 99;
  if (k.startsWith('river_plan_gd_ps') || k.startsWith('river_plan_s_gd_ps')) return 0;
  if (
    k === 'river_plan_jd_lm' ||
    k === 'river_plan_hd_lm' ||
    k === 'river_plan_s_jd_lm' ||
    k === 'river_plan_s_hd_lm'
  ) {
    return 1;
  }
  if (
    isRiverBasicPlanIndexDefineTable(k) ||
    k === 'river_plan_as' ||
    k === 'river_plan_s_as'
  ) {
    return 2;
  }
  return 99;
}
