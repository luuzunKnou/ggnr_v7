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

export function isRiverBasicPlanAsDefineTable(name: string): boolean {
  const k = String(name ?? '').trim().toLowerCase();
  return k === 'river_plan_as' || k === 'river_plan_s_as';
}

export function riverBasicPlanTabFromAsDefineTable(name: string): RiverBasicPlanTab {
  return String(name ?? '').trim().toLowerCase() === 'river_plan_s_as' ? 'smallRiver' : 'river';
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

/** 탭별 제방(선) — 사업계획 모드에서만 WMS 표시 */
export function riverBasicPlanJbDefineTable(tab: RiverBasicPlanTab): string {
  return tab === 'smallRiver' ? 'river_plan_s_jb_lm' : 'river_d_plan_jb_lm';
}

/** 탭별 제방 목록 배지 */
export function riverBasicPlanJbLabel(tab: RiverBasicPlanTab): string {
  return tab === 'smallRiver' ? '소하천제방' : '하천제방';
}

/** 탭별 구조물(부모) */
export function riverBasicPlanGdParentDefineTable(tab: RiverBasicPlanTab): string {
  return tab === 'smallRiver' ? 'river_plan_s_gd_ps' : 'river_plan_gd_ps';
}

/**
 * 확장패널 «구조물도» 칩과 동일한 WMS 레이어.
 * 지방하천: 분할 자식만(부모 제외). 소하천: 부모 단일.
 */
export function riverBasicPlanGdWmsDefineTables(tab: RiverBasicPlanTab): readonly string[] {
  if (tab === 'smallRiver') return RIVER_PLAN_S_GD_STRUCTURE_DEFINE_TABLES;
  const parent = riverBasicPlanGdParentDefineTable('river');
  return RIVER_PLAN_GD_STRUCTURE_DEFINE_TABLES.filter((n) => n !== parent);
}

/**
 * 목록·탭에서 기본으로 켤 WMS 레이어 (river_name CQL 가능).
 * 구조물은 상세 «구조물도»와 동일 — 지방은 색상 분할 자식만(부모 river_plan_gd_ps 제외).
 * 부모를 켜면 흰 점(…) 스타일이 나와 처음부터 색상 구조물로 보이게 자식만 켠다.
 */
export function riverBasicPlanRiverNameFilterableLayers(tab: RiverBasicPlanTab): readonly string[] {
  if (tab === 'smallRiver') {
    return [
      RIVER_BASIC_PLAN_SMALL_INDEX_DEFINE_TABLE,
      'river_plan_s_as',
      'river_plan_s_jd_lm',
      'river_plan_s_hd_lm',
      riverBasicPlanJbDefineTable('smallRiver'),
      ...riverBasicPlanGdWmsDefineTables('smallRiver'),
    ];
  }
  return [
    RIVER_BASIC_PLAN_INDEX_DEFINE_TABLE,
    'river_plan_as',
    'river_plan_jd_lm',
    'river_plan_hd_lm',
    riverBasicPlanJbDefineTable('river'),
    ...riverBasicPlanGdWmsDefineTables('river'),
  ];
}

/** CQL 문자열 리터럴 */
function cqlQuote(raw: string): string {
  return `'${String(raw ?? '').trim().replace(/'/g, "''")}'`;
}

/**
 * GeoServer CQL — 선택 하천만 표시.
 * 같은 하천명이 여러 코드로 나뉠 때는 river_code 로 한 건만 남긴다.
 */
export function buildRiverBasicPlanRiverNameCql(
  riverName: string,
  riverCode?: string | null
): string {
  const name = String(riverName ?? '').trim();
  if (!name) return 'INCLUDE';
  const parts = [`river_name=${cqlQuote(name)}`];
  const code = String(riverCode ?? '').trim();
  if (code) parts.push(`river_code=${cqlQuote(code)}`);
  return parts.join(' AND ');
}

export type RiverBasicPlanRiverIdentity = {
  riverName: string;
  riverCode?: string | null;
};

/** 여러 하천 식별 — 이름만 같으면 코드로 구분 */
function buildRiverBasicPlanRiversIdentityCql(
  rivers: readonly RiverBasicPlanRiverIdentity[]
): string | null {
  const clauses: string[] = [];
  for (const r of rivers) {
    const cql = buildRiverBasicPlanRiverNameCql(r.riverName, r.riverCode);
    if (cql === 'INCLUDE') continue;
    clauses.push(`(${cql})`);
  }
  if (clauses.length === 0) return null;
  return [...new Set(clauses)].join(' OR ');
}

/**
 * 선택 하천(+선택 기본계획)에 대한 레이어별 CQL.
 * 기본계획(AS)만 연도·계획명·연장으로 더 좁혀 상세와 지도가 맞도록 함.
 */
export function buildRiverBasicPlanMapCqlByLayer(
  tab: RiverBasicPlanTab,
  riverName: string,
  plan?: { planYear?: string; planName?: string; planLen?: string } | null,
  riverCode?: string | null
): Record<string, string> | null {
  const name = String(riverName ?? '').trim();
  if (!name) return null;
  const riverCql = buildRiverBasicPlanRiverNameCql(name, riverCode);
  if (riverCql === 'INCLUDE') return null;
  const out: Record<string, string> = {};
  for (const layer of riverBasicPlanRiverNameFilterableLayers(tab)) {
    out[layer] = riverCql;
  }

  const year = String(plan?.planYear ?? '').trim();
  const planName = String(plan?.planName ?? '').trim();
  const planLen = String(plan?.planLen ?? '').trim().replace(/,/g, '');
  if (!year && !planName && !planLen) return out;

  const asParts = [riverCql];
  if (year) asParts.push(`plan_year=${cqlQuote(year)}`);
  if (planName) asParts.push(`plan_name=${cqlQuote(planName)}`);
  if (planLen) {
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(planLen)) {
      asParts.push(`plan_len=${planLen}`);
    } else {
      asParts.push(`plan_len=${cqlQuote(planLen)}`);
    }
  }
  out[riverBasicPlanAsDefineTable(tab)] = asParts.join(' AND ');
  return out;
}

/**
 * 보고서 하나에 속한 여러 하천을 함께 보여 줄 레이어별 CQL.
 * 기본계획(AS)은 그 보고서(연도·계획명)만 남겨, 같은 하천의 다른 보고서 구역은 보이지 않게 함.
 * 하천 인자는 이름 문자열 또는 { riverName, riverCode }.
 */
export function buildRiverBasicPlanReportRiversCqlByLayer(
  tab: RiverBasicPlanTab,
  rivers: readonly (string | RiverBasicPlanRiverIdentity)[],
  plan: { planYear?: string; planName?: string }
): Record<string, string> | null {
  const identities: RiverBasicPlanRiverIdentity[] = rivers.map((r) =>
    typeof r === 'string' ? { riverName: r } : r
  );
  const riverCql = buildRiverBasicPlanRiversIdentityCql(identities);
  if (!riverCql) return null;
  const out: Record<string, string> = {};
  for (const layer of riverBasicPlanRiverNameFilterableLayers(tab)) {
    out[layer] = riverCql;
  }
  const asParts = [riverCql];
  const year = String(plan.planYear ?? '').trim();
  const planName = String(plan.planName ?? '').trim();
  if (year) asParts.push(`plan_year=${cqlQuote(year)}`);
  if (planName) asParts.push(`plan_name=${cqlQuote(planName)}`);
  out[riverBasicPlanAsDefineTable(tab)] = asParts.join(' AND ');
  return out;
}

/** 선택 하천·탭에 대한 레이어별 CQL 맵 (비우면 null) */
export function buildRiverBasicPlanRiverNameCqlByLayer(
  tab: RiverBasicPlanTab,
  riverName: string,
  riverCode?: string | null
): Record<string, string> | null {
  return buildRiverBasicPlanMapCqlByLayer(tab, riverName, null, riverCode);
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
    k === 'river_plan_s_hd_lm' ||
    k === riverBasicPlanJbDefineTable('river') ||
    k === riverBasicPlanJbDefineTable('smallRiver')
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
