/**
 * 하천기본계획 — 지도 식별 시 도면 첨부(상세목록 도면보기와 동일 경로)로 열 수 있는 define_table_name.
 * 서버 `riverBasicPlanService`의 구조물 목록·open_scan 설정과 동기화할 것.
 */
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

export const RIVER_BASIC_PLAN_MAP_ATTACHMENT_DEFINE_TABLES: readonly string[] = [
  'river_plan_jd_lm',
  'river_plan_hd_lm',
  ...RIVER_PLAN_GD_STRUCTURE_DEFINE_TABLES,
];

const ATTACHMENT_DEFINE_TABLE_SET = new Set(
  RIVER_BASIC_PLAN_MAP_ATTACHMENT_DEFINE_TABLES.map((t) => t.toLowerCase()),
);

export function isRiverBasicPlanMapAttachmentDefineTable(name: string): boolean {
  return ATTACHMENT_DEFINE_TABLE_SET.has(String(name ?? '').trim().toLowerCase());
}

/** 하천색인도 define_table_name */
export const RIVER_BASIC_PLAN_INDEX_DEFINE_TABLE = 'river_d_index';

/**
 * 지도 식별 결과가 겹칠 때 처리 순서: 포인트(0) → 라인(1) → 폴리곤(2).
 * defineLayer `define_table_shp_type`·테이블명과 맞춤.
 */
export function riverBasicPlanIdentifyGeometryRank(defineTableName: string): number {
  const k = String(defineTableName ?? '').trim().toLowerCase();
  if (!k) return 99;
  if (k.startsWith('river_plan_gd_ps')) return 0;
  if (k === 'river_plan_jd_lm' || k === 'river_plan_hd_lm') return 1;
  if (k === RIVER_BASIC_PLAN_INDEX_DEFINE_TABLE || k === 'river_plan_as') return 2;
  return 99;
}
