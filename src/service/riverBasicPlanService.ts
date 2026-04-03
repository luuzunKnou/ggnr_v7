import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { isRiverBasicPlanMapAttachmentDefineTable } from '@/lib/riverBasicPlanMapAttachmentLayers';
import {
  getDefineTableKeyFieldName,
  resolveDefineTablePhysicalBaseName,
} from '@/service/standardService';

type RiverType = 'river' | 'smallRiver';

function esc(value: string): string {
  return value.replace(/'/g, "''");
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

function riverTypeWhere(tab: RiverType): string {
  if (tab === 'smallRiver') {
    return `COALESCE(river_type, '') LIKE '%소하천%'`;
  }
  return `COALESCE(river_type, '') NOT LIKE '%소하천%'`;
}

export async function getRiverBasicPlanRiverList(params?: {
  tab?: RiverType;
  keyword?: string;
}): Promise<{ rivers: { riverName: string; riverType: string | null; count: number }[] }> {
  const tab: RiverType = params?.tab === 'smallRiver' ? 'smallRiver' : 'river';
  const keyword = String(params?.keyword ?? '').trim();
  const tableName = await resolveLayerTableName('river_plan_as');
  const keywordWhere = keyword ? ` AND COALESCE(river_name, '') ILIKE '%${esc(keyword)}%'` : '';

  const res = await db.execute(
    sql.raw(
      `SELECT
         river_name AS "riverName",
         MAX(river_type) AS "riverType",
         COUNT(*)::int AS "count"
       FROM layer."${tableName.replace(/"/g, '""')}"
       WHERE COALESCE(river_name, '') <> ''
         AND ${riverTypeWhere(tab)}
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
}

/**
 * 색인도(river_d_index) 피처와 공간으로 겹치는 기본계획(river_plan_as) 1건을 찾아
 * 하천·연도·탭(지방/소하천)을 맞출 때 사용.
 */
export async function getRiverBasicPlanPickFromIndex(params?: {
  indexOgcFid?: number;
}): Promise<{
  riverName: string;
  planYear: string;
  planName: string;
  tab: RiverType;
} | null> {
  const fid = Number(params?.indexOgcFid);
  if (!Number.isFinite(fid) || fid <= 0) return null;

  const idxTable = await resolveLayerTableName('river_d_index');
  const asTable = await resolveLayerTableName('river_plan_as');
  const safeIdx = idxTable.replace(/"/g, '""');
  const safeAs = asTable.replace(/"/g, '""');

  const res = await db.execute(
    sql.raw(`SELECT
      COALESCE(p.river_name, '') AS "riverName",
      COALESCE(p.plan_year, '') AS "planYear",
      COALESCE(p.plan_name, '') AS "planName",
      COALESCE(i.river_type, '') AS "indexRiverType"
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
    | { riverName?: string; planYear?: string; planName?: string; indexRiverType?: string }
    | undefined;
  const riverName = String(row?.riverName ?? '').trim();
  if (!riverName) return null;

  const idxRt = String(row?.indexRiverType ?? '');
  const tab: RiverType = idxRt.includes('소하천') ? 'smallRiver' : 'river';

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
  const tab: RiverType = params?.tab === 'smallRiver' ? 'smallRiver' : 'river';
  const riverName = String(params?.riverName ?? '').trim();
  if (!riverName) return { plans: [] };
  const tableName = await resolveLayerTableName('river_plan_as');

  const res = await db.execute(
    sql.raw(
      `SELECT
         COALESCE(plan_year, '') AS "planYear",
         COALESCE(plan_name, '') AS "planName",
         COALESCE(plan_len::text, '') AS "planLen"
       FROM layer."${tableName.replace(/"/g, '""')}"
       WHERE river_name = '${esc(riverName)}'
         AND ${riverTypeWhere(tab)}
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
      return {
        planYear: String(row.planYear ?? '').trim(),
        planName: String(row.planName ?? '').trim(),
        planLen: row.planLen == null ? '' : String(row.planLen).trim(),
      };
    }),
  };
}

export async function getRiverBasicPlanDetail(params?: {
  tab?: RiverType;
  riverName?: string;
  planYear?: string;
  planName?: string;
}): Promise<{ row: Record<string, unknown> | null }> {
  const tab: RiverType = params?.tab === 'smallRiver' ? 'smallRiver' : 'river';
  const riverName = String(params?.riverName ?? '').trim();
  const planYear = String(params?.planYear ?? '').trim();
  const planName = String(params?.planName ?? '').trim();
  if (!riverName) return { row: null };
  const tableName = await resolveLayerTableName('river_plan_as');

  const where = [
    `river_name = '${esc(riverName)}'`,
    riverTypeWhere(tab),
    planYear ? `COALESCE(plan_year, '') = '${esc(planYear)}'` : '',
    planName ? `COALESCE(plan_name, '') = '${esc(planName)}'` : '',
  ].filter(Boolean).join(' AND ');

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
  const tab: RiverType = params?.tab === 'smallRiver' ? 'smallRiver' : 'river';
  const riverName = String(params?.riverName ?? '').trim();
  if (!riverName) return { extent3857: null };
  const tableName = await resolveLayerTableName('river_plan_as');

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
           AND ${riverTypeWhere(tab)}
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
 * 선택한 기본계획(river_plan_as) 폴리곤과 교차하는 색인도 1건 + 해당 색인도 폴리곤과 교차하는 종단/횡단/구조물 시설 목록
 */
export async function getRiverBasicPlanIndexView(params?: {
  tab?: RiverType;
  riverName?: string;
  planYear?: string;
  planName?: string;
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
    /** service_data/file_data/{fileLayer}/{fileKey}/ 물리 테이블명 */
    fileLayer: string;
    /** 첨부 폴더 키(define 키 필드 값, 없으면 ogc_fid) */
    fileKey: string;
    extent3857: [number, number, number, number] | null;
  }[];
}> {
  const tab: RiverType = params?.tab === 'smallRiver' ? 'smallRiver' : 'river';
  const riverName = String(params?.riverName ?? '').trim();
  const planYear = String(params?.planYear ?? '').trim();
  const planName = String(params?.planName ?? '').trim();
  if (!riverName) return { index: null, related: [] };

  const asTable = await resolveLayerTableName('river_plan_as');
  const idxTable = await resolveLayerTableName('river_d_index');
  const safeAs = asTable.replace(/"/g, '""');
  const safeIdx = idxTable.replace(/"/g, '""');

  const planWhere = [
    `river_name = '${esc(riverName)}'`,
    riverTypeWhere(tab),
    planYear ? `COALESCE(plan_year, '') = '${esc(planYear)}'` : '',
    planName ? `COALESCE(plan_name, '') = '${esc(planName)}'` : '',
  ]
    .filter(Boolean)
    .join(' AND ');

  const pinnedIdx = Number(params?.indexOgcFid);
  const usePinnedIdx = Number.isFinite(pinnedIdx) && pinnedIdx > 0;
  const pinnedSql = Math.floor(pinnedIdx);

  const idxHitSql = usePinnedIdx
    ? `idx_hit AS (
      SELECT i.ogc_fid AS iid
      FROM layer."${safeIdx}" i
      CROSS JOIN plan_geom pg
      WHERE pg.geom IS NOT NULL
        AND i.ogc_fid = ${pinnedSql}
        AND ST_Intersects(i.geom, pg.geom)
      LIMIT 1
    )`
    : `idx_hit AS (
      SELECT i.ogc_fid AS iid
      FROM layer."${safeIdx}" i
      CROSS JOIN plan_geom pg
      WHERE pg.geom IS NOT NULL AND ST_Intersects(i.geom, pg.geom)
      ORDER BY i.ogc_fid ASC
      LIMIT 1
    )`;

  const idxSql = `
    WITH plan_geom AS (
      SELECT geom FROM layer."${safeAs}" p
      WHERE ${planWhere}
      ORDER BY p.ogc_fid ASC
      LIMIT 1
    ),
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
   * 구조물: 물리 테이블은 부모 river_plan_gd_ps 하나.
   * 분할 define마다 동일 INTERSECT 쿼리를 반복하면 같은 ogc_fid가 중복되어 React key 충돌·DB 낭비가 난다 → 1회 조회.
   */
  const queryRelatedStructurePoints = async () => {
    const physicalBase = resolveDefineTablePhysicalBaseName('river_plan_gd_ps', 'layer');
    const t = await resolveLayerTableName(physicalBase);
    const safeT = t.replace(/"/g, '""');
    const keySql = attachmentKeySelectSql('river_plan_gd_ps');
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

  await queryRelatedLm('river_plan_jd_lm', '종단면도');
  await queryRelatedLm('river_plan_hd_lm', '횡단면도');
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

