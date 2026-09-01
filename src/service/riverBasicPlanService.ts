import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import {
  isRiverBasicPlanIndexDefineTable,
  isRiverBasicPlanMapAttachmentDefineTable,
  riverBasicPlanAsDefineTable,
  riverBasicPlanGdParentDefineTable,
  riverBasicPlanHdDefineTable,
  riverBasicPlanIndexDefineTable,
  riverBasicPlanJdDefineTable,
  riverBasicPlanTabFromIndexDefineTable,
  type RiverBasicPlanTab,
} from '@/lib/riverBasicPlanMapAttachmentLayers';
import {
  getDefineTableKeyFieldName,
  resolveDefineTablePhysicalBaseName,
} from '@/service/standardService';

type RiverType = RiverBasicPlanTab;

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeTab(tab?: RiverType | string | null): RiverType {
  return tab === 'smallRiver' ? 'smallRiver' : 'river';
}

/** 표시용 천단위 콤마 제거 후 연장 매칭용 문자열 */
function normalizePlanLenParam(raw: unknown): string {
  return String(raw ?? '').trim().replace(/,/g, '');
}

/**
 * 기본계획 1건 식별 조건 (목록 GROUP BY: 연도·계획명·연장과 동일).
 * planLen 이 undefined 이면 연장 조건 생략.
 */
function planIdentityWhereParts(opts: {
  riverName: string;
  planYear: string;
  planName: string;
  planLen?: string;
}): string[] {
  const parts = [
    `river_name = '${esc(opts.riverName)}'`,
    opts.planYear ? `COALESCE(plan_year, '') = '${esc(opts.planYear)}'` : '',
    opts.planName ? `COALESCE(plan_name, '') = '${esc(opts.planName)}'` : '',
  ];
  if (opts.planLen !== undefined) {
    const len = normalizePlanLenParam(opts.planLen);
    if (len === '') {
      parts.push(`COALESCE(plan_len::text, '') = ''`);
    } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(len)) {
      parts.push(
        `(COALESCE(plan_len::text, '') ~ '^-?[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?$' AND plan_len::float8 = '${esc(len)}'::float8)`,
      );
    } else {
      parts.push(`COALESCE(plan_len::text, '') = '${esc(len)}'`);
    }
  }
  return parts.filter(Boolean);
}

async function resolveLayerTableName(wantedLower: string): Promise<string> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'layer' AND lower(table_name) = '${esc(wantedLower)}'
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_name?: string } | undefined;
  return String(row?.table_name ?? wantedLower);
}

/** layer 스키마에 테이블이 있을 때만 실제 이름 반환, 없으면 null */
async function resolveLayerTableNameOrNull(wantedLower: string): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'layer' AND lower(table_name) = '${esc(wantedLower)}'
       LIMIT 1`
    )
  );
  const row = res.rows?.[0] as { table_name?: string } | undefined;
  const name = String(row?.table_name ?? '').trim();
  return name || null;
}

export async function getRiverBasicPlanRiverList(params?: {
  tab?: RiverType;
  keyword?: string;
}): Promise<{
  rivers: { riverName: string; riverType: string | null; count: number }[];
}> {
  const tab = normalizeTab(params?.tab);
  const keyword = String(params?.keyword ?? '').trim();
  const logical = riverBasicPlanAsDefineTable(tab);
  const tableName = await resolveLayerTableNameOrNull(logical);
  /** 테이블 없음·조회 실패는 빈 목록(에러 아님) — 소하천 미구축 환경 등 */
  if (!tableName) {
    return { rivers: [] };
  }
  const keywordWhere = keyword ? ` AND COALESCE(river_name, '') ILIKE '%${esc(keyword)}%'` : '';

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT
           river_name AS "riverName",
           MAX(river_type) AS "riverType",
           COUNT(*)::int AS "count"
         FROM layer."${tableName.replace(/"/g, '""')}"
         WHERE COALESCE(river_name, '') <> ''
           ${keywordWhere}
         GROUP BY river_name
         ORDER BY river_name`
      )
    );

    return {
      rivers: (res.rows ?? []).map((r) => {
        const row = r as { riverName?: string; riverType?: string | null; count?: number | string };
        return {
          riverName: String(row.riverName ?? '').trim(),
          riverType: row.riverType == null ? null : String(row.riverType),
          count: Number(row.count ?? 0) || 0,
        };
      }).filter((r) => r.riverName),
    };
  } catch {
    return { rivers: [] };
  }
}

/**
 * 색인도 피처와 공간으로 겹치는 기본계획 1건을 찾아
 * 하천·연도·탭(지방/소하천)을 맞출 때 사용.
 * indexDefineTable: river_d_index | river_s_index
 */
export async function getRiverBasicPlanPickFromIndex(params?: {
  indexOgcFid?: number;
  indexDefineTable?: string;
}): Promise<{
  riverName: string;
  planYear: string;
  planName: string;
  tab: RiverType;
} | null> {
  const fid = Number(params?.indexOgcFid);
  if (!Number.isFinite(fid) || fid <= 0) return null;

  const indexLogical = String(params?.indexDefineTable ?? '').trim().toLowerCase();
  const tab = isRiverBasicPlanIndexDefineTable(indexLogical)
    ? riverBasicPlanTabFromIndexDefineTable(indexLogical)
    : 'river';
  const idxLogical = isRiverBasicPlanIndexDefineTable(indexLogical)
    ? indexLogical
    : riverBasicPlanIndexDefineTable(tab);

  const idxTable = await resolveLayerTableName(idxLogical);
  const asTable = await resolveLayerTableName(riverBasicPlanAsDefineTable(tab));
  const safeIdx = idxTable.replace(/"/g, '""');
  const safeAs = asTable.replace(/"/g, '""');

  const res = await db.execute(
    sql.raw(`SELECT
      COALESCE(p.river_name, '') AS "riverName",
      COALESCE(p.plan_year, '') AS "planYear",
      COALESCE(p.plan_name, '') AS "planName"
    FROM layer."${safeIdx}" i
    INNER JOIN layer."${safeAs}" p
      ON p.geom IS NOT NULL AND i.geom IS NOT NULL AND ST_Intersects(i.geom, p.geom)
    WHERE i.ogc_fid = ${Math.floor(fid)}
    ORDER BY
      CASE
        WHEN COALESCE(p.plan_year, '') ~ '^[0-9]+$' THEN COALESCE(p.plan_year, '')::int
        ELSE 0
      END DESC,
      COALESCE(p.plan_name, '')
    LIMIT 1`)
  );

  const row = res.rows?.[0] as
    | { riverName?: string; planYear?: string; planName?: string }
    | undefined;
  const riverName = String(row?.riverName ?? '').trim();
  if (!riverName) return null;

  return {
    riverName,
    planYear: String(row?.planYear ?? '').trim(),
    planName: String(row?.planName ?? '').trim(),
    tab,
  };
}

export async function getRiverBasicPlanYearList(params?: {
  tab?: RiverType;
  riverName?: string;
}): Promise<{ plans: { planYear: string; planName: string; planLen: string }[] }> {
  const tab = normalizeTab(params?.tab);
  const riverName = String(params?.riverName ?? '').trim();
  if (!riverName) return { plans: [] };
  const tableName = await resolveLayerTableNameOrNull(riverBasicPlanAsDefineTable(tab));
  if (!tableName) return { plans: [] };

  try {
    const res = await db.execute(
      sql.raw(
        `SELECT
           COALESCE(plan_year, '') AS "planYear",
           COALESCE(plan_name, '') AS "planName",
           COALESCE(plan_len::text, '') AS "planLen"
         FROM layer."${tableName.replace(/"/g, '""')}"
         WHERE river_name = '${esc(riverName)}'
         GROUP BY COALESCE(plan_year, ''), COALESCE(plan_name, ''), COALESCE(plan_len::text, '')
         ORDER BY
           CASE
             WHEN COALESCE(plan_year, '') ~ '^[0-9]+$' THEN COALESCE(plan_year, '')::int
             ELSE 0
           END DESC,
           COALESCE(plan_name, '')`
      )
    );

    return {
      plans: (res.rows ?? []).map((r) => {
        const row = r as { planYear?: string; planName?: string; planLen?: string | number | null };
        const rawLen = row.planLen == null ? '' : String(row.planLen).trim();
        return {
          planYear: String(row.planYear ?? '').trim(),
          planName: String(row.planName ?? '').trim(),
          // GROUP BY 원문 유지 — 상세/색인도 조회 시 연장 매칭용 (표시 포맷은 UI에서)
          planLen: rawLen,
        };
      }),
    };
  } catch {
    return { plans: [] };
  }
}

export async function getRiverBasicPlanDetail(params?: {
  tab?: RiverType;
  riverName?: string;
  planYear?: string;
  planName?: string;
  planLen?: string;
}): Promise<{ row: Record<string, unknown> | null }> {
  const tab = normalizeTab(params?.tab);
  const riverName = String(params?.riverName ?? '').trim();
  const planYear = String(params?.planYear ?? '').trim();
  const planName = String(params?.planName ?? '').trim();
  if (!riverName) return { row: null };
  const tableName = await resolveLayerTableName(riverBasicPlanAsDefineTable(tab));

  const where = planIdentityWhereParts({
    riverName,
    planYear,
    planName,
    planLen: params?.planLen,
  }).join(' AND ');

  const res = await db.execute(
    sql.raw(
      `SELECT row_to_json(t.*)::jsonb AS row
       FROM layer."${tableName.replace(/"/g, '""')}" t
       WHERE ${where}
       ORDER BY t.ogc_fid
       LIMIT 1`
    )
  );

  const row = (res.rows?.[0] as { row?: Record<string, unknown> } | undefined)?.row ?? null;
  return { row };
}

export async function getRiverBasicPlanExtent(params?: {
  tab?: RiverType;
  riverName?: string;
}): Promise<{ extent3857: [number, number, number, number] | null }> {
  const tab = normalizeTab(params?.tab);
  const riverName = String(params?.riverName ?? '').trim();
  if (!riverName) return { extent3857: null };
  const tableName = await resolveLayerTableName(riverBasicPlanAsDefineTable(tab));

  const res = await db.execute(
    sql.raw(
      `SELECT
         ST_XMin(ext)::float8 AS xmin,
         ST_YMin(ext)::float8 AS ymin,
         ST_XMax(ext)::float8 AS xmax,
         ST_YMax(ext)::float8 AS ymax
       FROM (
         SELECT ST_Extent(ST_Transform(geom, 3857))::box2d AS ext
         FROM layer."${tableName.replace(/"/g, '""')}"
         WHERE river_name = '${esc(riverName)}'
       ) s
       WHERE ext IS NOT NULL`
    )
  );

  const row = res.rows?.[0] as
    | { xmin?: number | string; ymin?: number | string; xmax?: number | string; ymax?: number | string }
    | undefined;
  const xmin = Number(row?.xmin);
  const ymin = Number(row?.ymin);
  const xmax = Number(row?.xmax);
  const ymax = Number(row?.ymax);
  if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) {
    return { extent3857: null };
  }
  return { extent3857: [xmin, ymin, xmax, ymax] };
}

/**
 * 하천명·탭(지방/소하천)에 해당하는 색인도 전체 피처의 3857 bbox.
 * (기본계획 polygon extent가 아닌, 색인도 도형 기준)
 */
export async function getRiverBasicPlanIndexExtent(params?: {
  tab?: RiverType;
  riverName?: string;
}): Promise<{ extent3857: [number, number, number, number] | null }> {
  const tab = normalizeTab(params?.tab);
  const riverName = String(params?.riverName ?? '').trim();
  if (!riverName) return { extent3857: null };
  const tableName = await resolveLayerTableName(riverBasicPlanIndexDefineTable(tab));

  const res = await db.execute(
    sql.raw(
      `SELECT
         ST_XMin(ext)::float8 AS xmin,
         ST_YMin(ext)::float8 AS ymin,
         ST_XMax(ext)::float8 AS xmax,
         ST_YMax(ext)::float8 AS ymax
       FROM (
         SELECT ST_Extent(ST_Transform(geom, 3857))::box2d AS ext
         FROM layer."${tableName.replace(/"/g, '""')}"
         WHERE COALESCE(river_name, '') = '${esc(riverName)}'
           AND geom IS NOT NULL
       ) s
       WHERE ext IS NOT NULL`
    )
  );

  const row = res.rows?.[0] as
    | { xmin?: number | string; ymin?: number | string; xmax?: number | string; ymax?: number | string }
    | undefined;
  const xmin = Number(row?.xmin);
  const ymin = Number(row?.ymin);
  const xmax = Number(row?.xmax);
  const ymax = Number(row?.ymax);
  if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) {
    return { extent3857: null };
  }
  return { extent3857: [xmin, ymin, xmax, ymax] };
}

/**
 * cons 관련 필드(프로젝트마다 `cons_code` / `cons_cdoe` 등) 문자열에서
 * 마지막 연속 숫자 구간만 사용(앞자리 0 제거) → 표시·정렬(1,2,3…)
 */
function indexNoFromConsCode(consCode: string, ogcFid: number): { label: string; order: number } {
  const s = String(consCode ?? '').trim();
  const groups = s.match(/\d+/g);
  if (!groups || groups.length === 0) {
    return { label: String(ogcFid), order: ogcFid };
  }
  const last = groups[groups.length - 1] ?? '';
  const n = parseInt(last, 10);
  if (!Number.isFinite(n)) {
    const stripped = last.replace(/^0+/, '') || '0';
    const ord = parseInt(stripped, 10);
    return { label: stripped, order: Number.isFinite(ord) ? ord : 0 };
  }
  return { label: String(n), order: n };
}

/**
 * 선택 기본계획 1건 (geom + 하천명·차수).
 * 색인도는 공간교차만 하면 타 하천·타 차수 시트가 섞여 같은 번호가 중복되므로
 * river_name·rivp_code 로 좁힌다.
 */
function planPickCteSql(safeAs: string, planWhere: string): string {
  return `plan_pick AS (
      SELECT
        geom,
        COALESCE(river_name, '') AS river_name,
        COALESCE(rivp_code, '') AS rivp_code
      FROM layer."${safeAs}" p
      WHERE ${planWhere}
      ORDER BY p.ogc_fid ASC
      LIMIT 1
    )`;
}

/** 색인도 ↔ 선택 기본계획: 교차 + 같은 하천(+ 차수코드가 있으면 동일 차수) */
function indexMatchesPlanSql(indexAlias = 'i', planAlias = 'pg'): string {
  return `${indexAlias}.geom IS NOT NULL
         AND ${planAlias}.geom IS NOT NULL
         AND ST_Intersects(${indexAlias}.geom, ${planAlias}.geom)
         AND COALESCE(${indexAlias}.river_name, '') = ${planAlias}.river_name
         AND (
           ${planAlias}.rivp_code = ''
           OR COALESCE(${indexAlias}.rivp_code, '') = ${planAlias}.rivp_code
         )`;
}

/**
 * 선택한 기본계획과 교차하는 색인도 목록.
 * 하천 상세에서 색인도 목록 UI에 사용.
 */
export async function getRiverBasicPlanIndexList(params?: {
  tab?: RiverType;
  riverName?: string;
  planYear?: string;
  planName?: string;
  planLen?: string;
}): Promise<{
  indexes: {
    ogcFid: number;
    label: string;
    order: number;
    badge: string;
    extent3857: [number, number, number, number] | null;
  }[];
}> {
  const tab = normalizeTab(params?.tab);
  const riverName = String(params?.riverName ?? '').trim();
  const planYear = String(params?.planYear ?? '').trim();
  const planName = String(params?.planName ?? '').trim();
  if (!riverName) return { indexes: [] };

  const asTable = await resolveLayerTableName(riverBasicPlanAsDefineTable(tab));
  const idxTable = await resolveLayerTableName(riverBasicPlanIndexDefineTable(tab));
  const safeAs = asTable.replace(/"/g, '""');
  const safeIdx = idxTable.replace(/"/g, '""');

  const planWhere = planIdentityWhereParts({
    riverName,
    planYear,
    planName,
    planLen: params?.planLen,
  }).join(' AND ');

  const res = await db.execute(
    sql.raw(
      `WITH ${planPickCteSql(safeAs, planWhere)}
       SELECT
         i.ogc_fid AS "ogcFid",
         TRIM(
           COALESCE(
             NULLIF((to_jsonb(i) - 'geom')->>'cons_code', ''),
             NULLIF((to_jsonb(i) - 'geom')->>'cons_cdoe', '')
           , '')
         ) AS "consCode",
         ST_XMin(ST_Transform(i.geom, 3857))::float8 AS xmin,
         ST_YMin(ST_Transform(i.geom, 3857))::float8 AS ymin,
         ST_XMax(ST_Transform(i.geom, 3857))::float8 AS xmax,
         ST_YMax(ST_Transform(i.geom, 3857))::float8 AS ymax
       FROM layer."${safeIdx}" i
       CROSS JOIN plan_pick pg
       WHERE ${indexMatchesPlanSql('i', 'pg')}
       ORDER BY i.ogc_fid ASC`
    )
  );

  const indexes = (res.rows ?? []).flatMap((row) => {
    const r = row as {
      ogcFid?: unknown;
      consCode?: unknown;
      xmin?: unknown;
      ymin?: unknown;
      xmax?: unknown;
      ymax?: unknown;
    };
    const fid = Number(r.ogcFid);
    if (!Number.isFinite(fid)) return [];
    const code = String(r.consCode ?? '').trim();
    const { label, order } = indexNoFromConsCode(code, fid);
    return [{
      ogcFid: fid,
      label,
      order,
      badge: '색인도',
      extent3857: parseExtent3857(r),
    }];
  });
  indexes.sort((a, b) => a.order - b.order || a.ogcFid - b.ogcFid);

  return { indexes };
}

/** define 키 컬럼명만 SQL 식별자로 허용 */
function safeSqlColumnName(name: string): string | null {
  const t = name.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) return null;
  return t;
}

/** 첨부 경로 키값 SELECT — define_field_is_key 컬럼, 없으면 ogc_fid */
function attachmentKeySelectSql(logicalDefineTable: string): string {
  const keyField = getDefineTableKeyFieldName(logicalDefineTable);
  const col = keyField ? safeSqlColumnName(keyField) : null;
  if (col) {
    const q = col.replace(/"/g, '""');
    return `TRIM(COALESCE(t."${q}"::text, '')) AS attachment_key`;
  }
  return `t.ogc_fid::text AS attachment_key`;
}

/** 식별 피처 row — ogc_fid 추출 시 컬럼명 대소문자 불일치 대비 */
function rowValueIgnoreCase(row: Record<string, unknown>, field: string): unknown {
  const f = field.trim();
  if (!f) return undefined;
  if (row[f] !== undefined && row[f] !== null) return row[f];
  const fl = f.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === fl) return row[k];
  }
  return undefined;
}

/**
 * 지도 식별 피처 → 색인도 상세목록 도면보기와 동일 첨부 경로.
 * 분할 레이어는 부모 define(물리 베이스) 기준으로 define_field_is_key 를 읽어야 상세목록과 fileKey 가 일치함.
 */
export async function getRiverBasicPlanDrawingPickFromIdentify(params?: {
  defineTableName?: string;
  /** 식별 피처 ogc_fid (권장) */
  ogcFid?: number;
  row?: Record<string, unknown> | null;
}): Promise<{ fileLayer: string; fileKey: string } | null> {
  const logical = String(params?.defineTableName ?? '').trim().toLowerCase();
  if (!logical || !isRiverBasicPlanMapAttachmentDefineTable(logical)) return null;

  let fid = Number(params?.ogcFid);
  if (!Number.isFinite(fid) || fid <= 0) {
    const row =
      params?.row && typeof params.row === 'object' && !Array.isArray(params.row)
        ? (params.row as Record<string, unknown>)
        : null;
    const raw =
      row != null
        ? rowValueIgnoreCase(row, 'ogc_fid') ?? rowValueIgnoreCase(row, 'gid')
        : undefined;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
    fid = Number.isFinite(n) && n > 0 ? Math.floor(n) : NaN;
  }
  if (!Number.isFinite(fid) || fid <= 0) return null;

  /** 식별은 분할 레이어일 때 부모 테이블에서 조회함 — 첨부 조회도 동일 물리 테이블을 써야 함 */
  const physicalBase = resolveDefineTablePhysicalBaseName(logical, 'layer');
  const fileLayer = await resolveLayerTableName(physicalBase);
  const safeT = fileLayer.replace(/"/g, '""');
  const keySql = attachmentKeySelectSql(physicalBase);
  const fidSql = Math.floor(fid);

  try {
    const q = `SELECT ${keySql} FROM layer."${safeT}" t WHERE t.ogc_fid = ${fidSql} LIMIT 1`;
    const res = await db.execute(sql.raw(q));
    const rr = res.rows?.[0] as { attachment_key?: unknown } | undefined;
    if (!rr) return null;
    const rawKey = String(rr.attachment_key ?? '').trim();
    const fileKey = rawKey || String(fidSql);
    return { fileLayer, fileKey };
  } catch {
    return null;
  }
}

function parseExtent3857(row: {
  xmin?: unknown;
  ymin?: unknown;
  xmax?: unknown;
  ymax?: unknown;
}): [number, number, number, number] | null {
  const xmin = Number(row.xmin);
  const ymin = Number(row.ymin);
  const xmax = Number(row.xmax);
  const ymax = Number(row.ymax);
  if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) return null;
  return [xmin, ymin, xmax, ymax];
}

/**
 * 선택한 기본계획 폴리곤과 교차하는 색인도 1건 + 해당 색인도 폴리곤과 교차하는 종단/횡단/구조물 시설 목록
 */
export async function getRiverBasicPlanIndexView(params?: {
  tab?: RiverType;
  riverName?: string;
  planYear?: string;
  planName?: string;
  planLen?: string;
  /** 지도에서 클릭한 색인도 피처 ogc_fid — 주어지면 해당 건만(선택 기본계획 폴리곤과 교차할 때) 사용 */
  indexOgcFid?: number;
}): Promise<{
  index: {
    row: Record<string, unknown>;
    extent3857: [number, number, number, number] | null;
    ogcFid: number;
  } | null;
  related: {
    kind: string;
    table: string;
    ogcFid: number;
    /** 표시 제목 — draw_name 우선, 없으면 종류#fid */
    label: string;
    /** 목록 배지: 종단/횡단은 종류명, 구조물은 gd_type(없으면 '구조물') */
    badge: string;
    /** file_data/{fileLayer}/{fileKey}/ 물리 테이블명 */
    fileLayer: string;
    /** 첨부 폴더 키(define 키 필드 값, 없으면 ogc_fid) */
    fileKey: string;
    extent3857: [number, number, number, number] | null;
  }[];
}> {
  const tab = normalizeTab(params?.tab);
  const riverName = String(params?.riverName ?? '').trim();
  const planYear = String(params?.planYear ?? '').trim();
  const planName = String(params?.planName ?? '').trim();
  if (!riverName) return { index: null, related: [] };

  const asTable = await resolveLayerTableName(riverBasicPlanAsDefineTable(tab));
  const idxTable = await resolveLayerTableName(riverBasicPlanIndexDefineTable(tab));
  const safeAs = asTable.replace(/"/g, '""');
  const safeIdx = idxTable.replace(/"/g, '""');

  const planWhere = planIdentityWhereParts({
    riverName,
    planYear,
    planName,
    planLen: params?.planLen,
  }).join(' AND ');

  const pinnedIdx = Number(params?.indexOgcFid);
  const usePinnedIdx = Number.isFinite(pinnedIdx) && pinnedIdx > 0;
  const pinnedSql = Math.floor(pinnedIdx);

  const idxHitSql = usePinnedIdx
    ? `idx_hit AS (
      SELECT i.ogc_fid AS iid
      FROM layer."${safeIdx}" i
      CROSS JOIN plan_pick pg
      WHERE ${indexMatchesPlanSql('i', 'pg')}
        AND i.ogc_fid = ${pinnedSql}
      LIMIT 1
    )`
    : `idx_hit AS (
      SELECT i.ogc_fid AS iid
      FROM layer."${safeIdx}" i
      CROSS JOIN plan_pick pg
      WHERE ${indexMatchesPlanSql('i', 'pg')}
      ORDER BY i.ogc_fid ASC
      LIMIT 1
    )`;

  const idxSql = `
    WITH ${planPickCteSql(safeAs, planWhere)},
    ${idxHitSql}
    SELECT
      (to_jsonb(i) - 'geom') AS idx_row,
      ST_XMin(ST_Transform(i.geom, 3857))::float8 AS xmin,
      ST_YMin(ST_Transform(i.geom, 3857))::float8 AS ymin,
      ST_XMax(ST_Transform(i.geom, 3857))::float8 AS xmax,
      ST_YMax(ST_Transform(i.geom, 3857))::float8 AS ymax,
      i.ogc_fid AS idx_ogc_fid
    FROM layer."${safeIdx}" i
    INNER JOIN idx_hit h ON i.ogc_fid = h.iid
  `;

  let idxRes: {
    idx_row?: Record<string, unknown>;
    xmin?: unknown;
    ymin?: unknown;
    xmax?: unknown;
    ymax?: unknown;
    idx_ogc_fid?: unknown;
  } | undefined;

  try {
    const res = await db.execute(sql.raw(idxSql));
    idxRes = res.rows?.[0] as typeof idxRes;
  } catch {
    return { index: null, related: [] };
  }

  if (!idxRes?.idx_ogc_fid) return { index: null, related: [] };

  const idxOgcFid = Number(idxRes.idx_ogc_fid);
  if (!Number.isFinite(idxOgcFid)) return { index: null, related: [] };

  const idxRow =
    typeof idxRes.idx_row === 'object' && idxRes.idx_row !== null && !Array.isArray(idxRes.idx_row)
      ? (idxRes.idx_row as Record<string, unknown>)
      : {};

  const indexExtent = parseExtent3857(idxRes);

  const related: {
    kind: string;
    table: string;
    ogcFid: number;
    label: string;
    badge: string;
    fileLayer: string;
    fileKey: string;
    extent3857: [number, number, number, number] | null;
  }[] = [];

  /** 종단·횡단: draw_name → 제목, 배지는 종류명 */
  const queryRelatedLm = async (logicalName: string, kindLabel: string) => {
    const t = await resolveLayerTableName(logicalName.toLowerCase());
    const safeT = t.replace(/"/g, '""');
    const keySql = attachmentKeySelectSql(logicalName);
    const q = `
      SELECT
        t.ogc_fid AS fid,
        TRIM(COALESCE(t.draw_name::text, '')) AS draw_name,
        ${keySql},
        ST_XMin(ST_Transform(t.geom, 3857))::float8 AS xmin,
        ST_YMin(ST_Transform(t.geom, 3857))::float8 AS ymin,
        ST_XMax(ST_Transform(t.geom, 3857))::float8 AS xmax,
        ST_YMax(ST_Transform(t.geom, 3857))::float8 AS ymax
      FROM layer."${safeT}" t
      INNER JOIN layer."${safeIdx}" idx ON idx.ogc_fid = ${idxOgcFid}
      WHERE idx.geom IS NOT NULL AND ST_Intersects(t.geom, idx.geom)
      ORDER BY t.ogc_fid ASC
    `;
    try {
      const r = await db.execute(sql.raw(q));
      for (const row of r.rows ?? []) {
        const rr = row as {
          fid?: unknown;
          draw_name?: unknown;
          attachment_key?: unknown;
          xmin?: unknown;
          ymin?: unknown;
          xmax?: unknown;
          ymax?: unknown;
        };
        const fid = Number(rr.fid);
        if (!Number.isFinite(fid)) continue;
        const dn = String(rr.draw_name ?? '').trim();
        const rawKey = String(rr.attachment_key ?? '').trim();
        const fileKey = rawKey || String(fid);
        related.push({
          kind: kindLabel,
          table: t,
          ogcFid: fid,
          label: dn || `${kindLabel} #${fid}`,
          badge: kindLabel,
          fileLayer: t,
          fileKey,
          extent3857: parseExtent3857(rr),
        });
      }
    } catch {
      /* 테이블 없음·draw_name 컬럼 없음 등 */
    }
  };

  /**
   * 구조물: 물리 테이블은 부모 하나(지방: river_plan_gd_ps / 소하천: river_plan_s_gd_ps).
   * 분할 define마다 동일 INTERSECT 쿼리를 반복하면 같은 ogc_fid가 중복되어 React key 충돌·DB 낭비가 난다 → 1회 조회.
   */
  const queryRelatedStructurePoints = async () => {
    const gdLogical = riverBasicPlanGdParentDefineTable(tab);
    const physicalBase = resolveDefineTablePhysicalBaseName(gdLogical, 'layer');
    const t = await resolveLayerTableName(physicalBase);
    const safeT = t.replace(/"/g, '""');
    const keySql = attachmentKeySelectSql(gdLogical);
    const q = `
      SELECT
        t.ogc_fid AS fid,
        TRIM(COALESCE(t.draw_name::text, '')) AS draw_name,
        TRIM(COALESCE(t.gd_type::text, '')) AS gd_type,
        ${keySql},
        ST_XMin(ST_Transform(t.geom, 3857))::float8 AS xmin,
        ST_YMin(ST_Transform(t.geom, 3857))::float8 AS ymin,
        ST_XMax(ST_Transform(t.geom, 3857))::float8 AS xmax,
        ST_YMax(ST_Transform(t.geom, 3857))::float8 AS ymax
      FROM layer."${safeT}" t
      INNER JOIN layer."${safeIdx}" idx ON idx.ogc_fid = ${idxOgcFid}
      WHERE idx.geom IS NOT NULL AND ST_Intersects(t.geom, idx.geom)
      ORDER BY t.ogc_fid ASC
    `;
    try {
      const r = await db.execute(sql.raw(q));
      for (const row of r.rows ?? []) {
        const rr = row as {
          fid?: unknown;
          draw_name?: unknown;
          gd_type?: unknown;
          attachment_key?: unknown;
          xmin?: unknown;
          ymin?: unknown;
          xmax?: unknown;
          ymax?: unknown;
        };
        const fid = Number(rr.fid);
        if (!Number.isFinite(fid)) continue;
        const dn = String(rr.draw_name ?? '').trim();
        const gt = String(rr.gd_type ?? '').trim();
        const rawKey = String(rr.attachment_key ?? '').trim();
        const fileKey = rawKey || String(fid);
        related.push({
          kind: '구조물',
          table: t,
          ogcFid: fid,
          label: dn || `구조물 #${fid}`,
          badge: gt || '구조물',
          fileLayer: t,
          fileKey,
          extent3857: parseExtent3857(rr),
        });
      }
    } catch {
      /* 테이블 없음·컬럼 오류 등 */
    }
  };

  await queryRelatedLm(riverBasicPlanJdDefineTable(tab), '종단면도');
  await queryRelatedLm(riverBasicPlanHdDefineTable(tab), '횡단면도');
  await queryRelatedStructurePoints();

  return {
    index: {
      row: idxRow,
      extent3857: indexExtent,
      ogcFid: idxOgcFid,
    },
    related,
  };
}

