/**
 * 필지분석 — 분석 영역(WKT 5181)과 교차하는 필지를 우리 DB에서 집계.
 * 연계 보강은 enrichParcelLandRows 로 분리(2단계·토지현황 행만).
 */
import { db, pool } from '@/database/db';
import { sql } from 'drizzle-orm';
import { applyEnrichmentToLandRows, type AnalyzeLandRow } from '@/lib/parcelLandNormalize';
import { fetchBuildingLedgersByPnus, type BuildingLedgerDisplayRow } from '@/lib/buildingLedgerFetch';
import {
  buildParcelAnalysisFacilityCatalogFromDbTables,
  resolveParcelAnalysisLayers,
  type ParcelAnalysisFacilityGroupDef,
  type ParcelAnalysisLayerDef,
} from '@/lib/parcelAnalysisCatalog';
import { getGeoServerLayerList, getLayerTableGeometryTypes, getLayerTableList } from '@/service/devTestService';
import { getParcelAnalysisMapConfig } from '@/service/configService';
import {
  resolveLayerPhysicalRelName,
  sanitizeDefineLayerRowFilter,
} from '@/service/standardService';
import {
  enrichParcelLandsByPnus,
  fetchLandUseZonesByPnus as fetchLandUseZonesByPnusLinkage,
  shouldMaskParcelOwners,
} from '@/service/landLinkageService';
import { toParcelAnalyzeUserError } from '@/lib/parcelAnalyzeUserError';
import {
  PARCEL_THEME_MAP_FULL_COLOR_LIMIT,
  PARCEL_THEME_MAP_OTHER_CATEGORY,
  PARCEL_THEME_MAP_SIMPLIFY_TOLERANCE_M,
  PARCEL_THEME_MAP_TOP_CATEGORY_COUNT,
  type ParcelThemeMapCategory,
  type ParcelThemeMapFeature,
  type ParcelThemeMapKind,
  type ParcelThemeMapPayload,
} from '@/lib/parcelAnalysisTheme';

const PARCEL_ANALYZE_DB_STATEMENT_TIMEOUT = '600s';

const JIJUK_SCHEMA = 'public_layer';
const JIJUK_GEOM_SRID = 5181;

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function buildHitCteSql(wkt: string): string {
  const searchGeom = `ST_SetSRID(ST_GeomFromText('${esc(wkt)}'), ${JIJUK_GEOM_SRID})`;
  const jijukGeom = `ST_SetSRID(j.geom, ${JIJUK_GEOM_SRID})`;
  const intersectGeom = `ST_Intersection(${jijukGeom}, ${searchGeom})`;
  const hitWhere = `j.geom IS NOT NULL
      AND ${jijukGeom} && ${searchGeom}
      AND ST_Intersects(${jijukGeom}, ${searchGeom})
      AND ST_Dimension(${intersectGeom}) = 2
      AND ST_Area(${intersectGeom}) > 1.0`;

  return `
    WITH hit AS (
      SELECT
        j.pnu::text AS pnu,
        j.jibun::text AS jibun,
        ST_Area(${jijukGeom}) AS area_sqm,
        NULLIF(TRIM(a.jimok), '') AS jimok,
        NULLIF(TRIM(a.ownship_se), '') AS ownship_se
      FROM ${JIJUK_SCHEMA}.jijuk j
      LEFT JOIN ${JIJUK_SCHEMA}.jijuk_land_attr a ON a.pnu = j.pnu
      WHERE ${hitWhere}
    )`;
}

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

type OwnerStatRaw = { label: string; count: number; areaSqm: number };
type JimokStatRaw = { jimok: string; count: number; areaSqm: number };

export type AnalyzeLandRowResult = {
  pnu: string;
  jibun: string;
  jimok: string;
  areaSqm: number;
  ownerName?: string;
  ownerType?: string;
  publicPrice?: number | null;
  source?: string;
};

export type AnalyzeParcelsResult = {
  ok: boolean;
  parcelCount: number;
  totalAreaSqm: number;
  ownerStats: OwnerStatRaw[];
  jimokStats: JimokStatRaw[];
  landRows: AnalyzeLandRowResult[];
  error?: string;
};

export type ListAnalyzeLandRowsResult = {
  ok: boolean;
  landRows: AnalyzeLandRowResult[];
  error?: string;
};

export type FetchLandUseZonesResult = {
  ok: boolean;
  zonesByPnu: Record<string, string[]>;
  error?: string;
};

export type EnrichParcelLandRowsResult = {
  ok: boolean;
  landRows: AnalyzeLandRowResult[];
  enrichmentSource?: string;
  error?: string;
};

function normalizeStatRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapLandRowResults(
  rows: Array<{
    pnu: string;
    jibun: string;
    jimok: string;
    areaSqm: number;
    ownerName?: string;
    ownerType?: string;
    publicPrice?: number | null;
    source?: string;
  }>
): AnalyzeLandRowResult[] {
  return rows.map((r) => ({
    pnu: r.pnu,
    jibun: r.jibun,
    jimok: r.jimok,
    areaSqm: r.areaSqm,
    ownerName: r.ownerName,
    ownerType: r.ownerType,
    publicPrice: r.publicPrice ?? null,
    source: r.source,
  }));
}

/**
 * 분석 영역(WKT 5181)과 교차하는 필지의 필지수·면적 합계와
 * 소유구분별·지목별 통계를 반환. (DB만, 연계 없음 — 목록은 listAnalyzeLandRows)
 */
export async function analyzeParcels(params: {
  wkt5181?: string;
}): Promise<AnalyzeParcelsResult> {
  const empty: AnalyzeParcelsResult = {
    ok: false,
    parcelCount: 0,
    totalAreaSqm: 0,
    ownerStats: [],
    jimokStats: [],
    landRows: [],
  };

  const wkt = String(params?.wkt5181 ?? '').trim();
  if (!wkt) return { ...empty, error: '분석 영역(WKT)이 필요합니다.' };

  const queryStr = `${buildHitCteSql(wkt)}
    SELECT
      (SELECT COUNT(*) FROM hit) AS parcel_count,
      (SELECT COALESCE(SUM(area_sqm), 0) FROM hit) AS total_area,
      (SELECT json_agg(o) FROM (
        SELECT COALESCE(ownship_se, '미상') AS label,
               COUNT(*)::int AS count,
               COALESCE(SUM(area_sqm), 0)::float8 AS area_sqm
        FROM hit GROUP BY 1 ORDER BY 3 DESC
      ) o) AS owner_stats,
      (SELECT json_agg(m) FROM (
        SELECT COALESCE(jimok, '미상') AS jimok,
               COUNT(*)::int AS count,
               COALESCE(SUM(area_sqm), 0)::float8 AS area_sqm
        FROM hit GROUP BY 1 ORDER BY 3 DESC
      ) m) AS jimok_stats`;

  try {
    const client = await pool.connect();
    let row:
      | {
          parcel_count?: unknown;
          total_area?: unknown;
          owner_stats?: unknown;
          jimok_stats?: unknown;
        }
      | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${PARCEL_ANALYZE_DB_STATEMENT_TIMEOUT}'`);
      const res = await client.query(queryStr);
      await client.query('COMMIT');
      row = res.rows?.[0] as typeof row;
    } catch (inner: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw inner;
    } finally {
      client.release();
    }

    if (!row) return { ...empty, ok: true };

    const ownerStats: OwnerStatRaw[] = normalizeStatRows(row.owner_stats).map((r) => ({
      label: String(r.label ?? '미상'),
      count: toInt(r.count),
      areaSqm: toInt(r.area_sqm),
    }));
    const jimokStats: JimokStatRaw[] = normalizeStatRows(row.jimok_stats).map((r) => ({
      jimok: String(r.jimok ?? '미상'),
      count: toInt(r.count),
      areaSqm: toInt(r.area_sqm),
    }));
    return {
      ok: true,
      parcelCount: toInt(row.parcel_count),
      totalAreaSqm: toInt(row.total_area),
      ownerStats,
      jimokStats,
      landRows: [],
    };
  } catch (e: unknown) {
    return { ...empty, error: toParcelAnalyzeUserError(e) };
  }
}

/** 토지현황 목록 페이지(면적 큰 순) — DB만 */
export async function listAnalyzeLandRows(params: {
  wkt5181?: string;
  offset?: number;
  limit?: number;
}): Promise<ListAnalyzeLandRowsResult> {
  const empty: ListAnalyzeLandRowsResult = { ok: false, landRows: [] };
  const wkt = String(params?.wkt5181 ?? '').trim();
  if (!wkt) return { ...empty, error: '분석 영역(WKT)이 필요합니다.' };

  const offset = Math.max(Math.floor(params?.offset ?? 0), 0);
  const limit = Math.min(Math.max(Math.floor(params?.limit ?? 100), 1), 500);

  const queryStr = `${buildHitCteSql(wkt)}
    SELECT pnu, jibun, COALESCE(jimok, '미상') AS jimok, area_sqm::float8 AS area_sqm
    FROM hit
    ORDER BY area_sqm DESC
    OFFSET ${offset} LIMIT ${limit}`;

  try {
    const client = await pool.connect();
    let rows: Array<Record<string, unknown>> = [];
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${PARCEL_ANALYZE_DB_STATEMENT_TIMEOUT}'`);
      const res = await client.query(queryStr);
      await client.query('COMMIT');
      rows = (res.rows ?? []) as Array<Record<string, unknown>>;
    } catch (inner: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw inner;
    } finally {
      client.release();
    }

    const landRows: AnalyzeLandRowResult[] = rows.map((r) => ({
      pnu: String(r.pnu ?? '').trim(),
      jibun: String(r.jibun ?? '').trim(),
      jimok: String(r.jimok ?? '미상'),
      areaSqm: toInt(r.area_sqm),
    }));
    return { ok: true, landRows };
  } catch (e: unknown) {
    return { ...empty, error: toParcelAnalyzeUserError(e) };
  }
}

/** 토지이용계획 — 행망(KRAS000025) 우선, 실패 시 캐시·브이월드 (landLinkageService) */
export async function fetchLandUseZonesByPnus(params: {
  pnus?: string[];
}): Promise<FetchLandUseZonesResult> {
  return fetchLandUseZonesByPnusLinkage(params);
}

/** 토지현황 표시 행만 연계 보강 — 통계는 analyzeParcels DB 결과 유지 */
export async function enrichParcelLandRows(params: {
  landRows?: AnalyzeLandRowResult[];
}): Promise<EnrichParcelLandRowsResult> {
  const empty: EnrichParcelLandRowsResult = { ok: false, landRows: [] };
  const input = Array.isArray(params?.landRows) ? params.landRows : [];
  if (!input.length) return { ok: true, landRows: [] };

  const baseRows: AnalyzeLandRow[] = input.map((r) => ({
    pnu: String(r.pnu ?? '').trim(),
    jibun: String(r.jibun ?? '').trim(),
    jimok: String(r.jimok ?? '미상'),
    areaSqm: toInt(r.areaSqm),
    ownerType: String(r.ownerType ?? '').trim() || '미상',
    ownerName: r.ownerName,
    publicPrice: r.publicPrice ?? null,
    source:
      r.source === 'db' || r.source === 'kras' || r.source === 'vworld' || r.source === 'cache'
        ? r.source
        : undefined,
  }));

  const pnus = baseRows.map((r) => r.pnu).filter((p) => /^\d{19}$/.test(p));
  if (!pnus.length) return { ok: true, landRows: input };

  try {
    const { enrichments, source } = await enrichParcelLandsByPnus({ pnus });
    const merged = applyEnrichmentToLandRows(baseRows, enrichments, shouldMaskParcelOwners());
    return {
      ok: true,
      landRows: mapLandRowResults(merged),
      enrichmentSource: Object.keys(enrichments).length ? String(source) : 'db',
    };
  } catch (e: unknown) {
    return { ...empty, landRows: input, error: toParcelAnalyzeUserError(e) };
  }
}

export type LayerStatRow = {
  layerKey: string;
  layerKorName: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON';
  stats: number;
  unit: string;
};

export type SelectLayerStatsResult = {
  ok: boolean;
  rows: LayerStatRow[];
  error?: string;
};

export type FacilityCatalogResult = {
  ok: boolean;
  groups: ParcelAnalysisFacilityGroupDef[];
};

export type BuildingLedgerResult = {
  ok: boolean;
  rows: BuildingLedgerDisplayRow[];
  error?: string;
};

/** 시설목록 동적 카탈로그 (4-E) — 데이터조회와 동일하게 DB layer 테이블 기준 그룹 */
export async function getParcelAnalysisFacilityCatalog(): Promise<FacilityCatalogResult> {
  const listRes = await getLayerTableList();
  const dbSet = new Set(
    (listRes.tables ?? [])
      .filter((t) => (t.schema || 'layer').toLowerCase() === 'layer')
      .map((t) => String(t.table).toLowerCase())
  );

  const mapConfig = getParcelAnalysisMapConfig();
  const geoRes = await getGeoServerLayerList({
    url: mapConfig.geoserverUrl,
    workspace: mapConfig.workspace,
  });
  const publishedSet =
    geoRes.success && (geoRes.layers?.length ?? 0) > 0
      ? new Set((geoRes.layers ?? []).map((name) => String(name).toLowerCase()))
      : undefined;

  const geomRes = await getLayerTableGeometryTypes();
  const geomTypes = geomRes.success ? geomRes.types : undefined;

  const groups = buildParcelAnalysisFacilityCatalogFromDbTables(dbSet, publishedSet, geomTypes);
  return { ok: true, groups };
}

/** 분석 영역(5181)·레이어 도형 — standardService 공간검색과 동일한 SRID·교차 규칙 */
function buildLayerStatSpatialSql(
  safeGeomCol: string,
  wkt: string,
  geomType: ParcelAnalysisLayerDef['geomType'],
  rowFilterSql: string | null,
  tableSrid: number
): { whereSql: string; statsExpr: string; unit: string } {
  const geomFromText = `ST_GeomFromText('${esc(wkt)}', ${JIJUK_GEOM_SRID})`;
  const searchGeom =
    tableSrid !== JIJUK_GEOM_SRID ? `ST_Transform(${geomFromText}, ${tableSrid})` : geomFromText;
  const geomRef = `"${safeGeomCol}"`;
  const intersect = `ST_Intersection(${geomRef}, ST_MakeValid(${searchGeom}))`;
  const filterClause = rowFilterSql ? ` AND (${rowFilterSql})` : '';
  const whereSql = `WHERE ${geomRef} IS NOT NULL
        AND ${geomRef} && ${searchGeom}
        AND ST_Intersects(${geomRef}, ${searchGeom})${filterClause}`;

  if (geomType === 'POINT') {
    return { whereSql, statsExpr: 'COUNT(*)::float8', unit: '개' };
  }
  if (geomType === 'LINE') {
    return {
      whereSql,
      statsExpr: `ROUND(COALESCE(SUM(ST_Length(${intersect})), 0)::numeric, 2)::float8`,
      unit: 'm',
    };
  }
  return {
    whereSql,
    statsExpr: `ROUND(COALESCE(SUM(ST_Area(${intersect})), 0)::numeric, 2)::float8`,
    unit: '㎡',
  };
}

/** 분할 레이어·숫자 시작 테이블명 — standardService와 동일 인용·geometry_columns 조회 */
async function queryLayerStatInWkt(
  layer: ParcelAnalysisLayerDef,
  wkt: string
): Promise<LayerStatRow | null> {
  const schema = String(layer.schema ?? 'layer').trim().toLowerCase() || 'layer';
  const tableGuess = (layer.physicalTableName ?? layer.layerKey).toLowerCase();
  const rowFilterRaw = String(layer.rowFilterSql ?? '').trim();
  let rowFilterSql: string | null = null;
  if (rowFilterRaw) {
    rowFilterSql = sanitizeDefineLayerRowFilter(rowFilterRaw);
    if (!rowFilterSql) return null;
  }

  const resolvedRel = await resolveLayerPhysicalRelName(schema, tableGuess);
  if (!resolvedRel) return null;

  const safeSchema = schema.replace(/"/g, '""');
  const safeTable = resolvedRel.replace(/"/g, '""');

  let geomCol: string;
  let tableSrid = JIJUK_GEOM_SRID;
  try {
    const gcRes = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS name, srid FROM geometry_columns
         WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(resolvedRel)}'
         LIMIT 1`
      )
    );
    const gcRow = gcRes.rows?.[0] as { name?: string; srid?: number } | undefined;
    geomCol = gcRow?.name ? String(gcRow.name).trim() : 'geom';
    if (gcRow?.srid != null && Number.isFinite(Number(gcRow.srid))) {
      tableSrid = Number(gcRow.srid);
    }
  } catch {
    geomCol = 'geom';
  }

  const safeGeomCol = geomCol.replace(/"/g, '""');
  const { whereSql, statsExpr, unit } = buildLayerStatSpatialSql(
    safeGeomCol,
    wkt,
    layer.geomType,
    rowFilterSql,
    tableSrid
  );

  const queryStr = `
      SELECT ${statsExpr} AS stats
      FROM "${safeSchema}"."${safeTable}"
      ${whereSql}
      HAVING COUNT(*) > 0`;

  try {
    const res = await db.execute(sql.raw(queryStr));
    const row = res.rows?.[0] as { stats?: string | number } | undefined;
    if (!row) return null;
    const stats = Number(row.stats ?? 0);
    if (!Number.isFinite(stats) || stats <= 0) return null;
    return {
      layerKey: layer.layerKey.toLowerCase(),
      layerKorName: layer.layerKorName,
      geomType: layer.geomType,
      stats,
      unit,
    };
  } catch {
    return null;
  }
}

/** 분석 영역과 교차하는 시설 레이어 통계 (4-D) */
export async function selectLayerStatsByWkt(params: {
  wkt5181?: string;
  layers?: Array<{
    layerKey?: string;
    layerKorName?: string;
    geomType?: string;
    schema?: string;
    physicalTableName?: string;
    rowFilterSql?: string | null;
  }>;
}): Promise<SelectLayerStatsResult> {
  const empty: SelectLayerStatsResult = { ok: false, rows: [] };
  const wkt = String(params?.wkt5181 ?? '').trim();
  if (!wkt) return { ...empty, error: '분석 영역(WKT)이 필요합니다.' };

  const geomRes = await getLayerTableGeometryTypes();
  const layers = resolveParcelAnalysisLayers(
    params?.layers ?? [],
    geomRes.success ? geomRes.types : undefined
  );
  if (!layers.length) return { ok: true, rows: [] };

  const statResults = await mapWithConcurrency(layers, 8, (layer) =>
    queryLayerStatInWkt(layer, wkt)
  );
  const rows: LayerStatRow[] = statResults.filter((r): r is LayerStatRow => r != null);

  rows.sort((a, b) => b.stats - a.stats || a.layerKorName.localeCompare(b.layerKorName, 'ko'));
  return { ok: true, rows };
}

/** 건축물대장 조회 (4-C) */
export async function fetchBuildingLedgersForParcels(params: {
  parcels?: Array<{ pnu?: string; jibun?: string }>;
}): Promise<BuildingLedgerResult> {
  return fetchBuildingLedgersByPnus(params);
}

function themeCategoryExpr(theme: ParcelThemeMapKind): string {
  if (theme === 'owner') {
    return `COALESCE(NULLIF(TRIM(ownship_se), ''), '미상')`;
  }
  return `COALESCE(NULLIF(TRIM(jimok), ''), '미상')`;
}

function parseGeoJsonGeometry(value: unknown): GeoJSON.Geometry | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as GeoJSON.Geometry;
      return parsed?.type ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value !== null && 'type' in value) {
    return value as GeoJSON.Geometry;
  }
  return null;
}

/**
 * 소유·지목 테마 지도용 필지 도형(GeoJSON).
 * 필지 > 500이면 면적 상위 5구분만 고유 색, 나머지 구분은 회색(그 외)으로 반환.
 */
export async function listAnalyzeThemeMapFeatures(params: {
  wkt5181?: string;
  theme?: ParcelThemeMapKind;
}): Promise<ParcelThemeMapPayload> {
  const empty: ParcelThemeMapPayload = { ok: false, features: [], categories: [] };
  const wkt = String(params?.wkt5181 ?? '').trim();
  const theme = params?.theme === 'jimok' ? 'jimok' : params?.theme === 'owner' ? 'owner' : null;
  if (!wkt) return { ...empty, error: '분석 영역(WKT)이 필요합니다.' };
  if (!theme) return { ...empty, error: '테마 종류(owner|jimok)가 필요합니다.' };

  const catExpr = themeCategoryExpr(theme);
  const fullLimit = PARCEL_THEME_MAP_FULL_COLOR_LIMIT;
  const topN = PARCEL_THEME_MAP_TOP_CATEGORY_COUNT;
  const simplify = PARCEL_THEME_MAP_SIMPLIFY_TOLERANCE_M;

  const queryStr = `${buildHitCteSql(wkt)},
    hit_cat AS (
      SELECT pnu, area_sqm, ${catExpr} AS category
      FROM hit
    ),
    parcel_total AS (
      SELECT COUNT(*)::int AS cnt FROM hit_cat
    ),
    ranked AS (
      SELECT category,
             COUNT(*)::int AS count,
             COALESCE(SUM(area_sqm), 0)::float8 AS area_sqm,
             ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(area_sqm), 0) DESC) AS rn
      FROM hit_cat
      GROUP BY category
    ),
    allowed AS (
      SELECT category
      FROM ranked r, parcel_total t
      WHERE t.cnt <= ${fullLimit} OR r.rn <= ${topN}
    ),
    cat_rows AS (
      SELECT r.category,
             r.count,
             r.area_sqm,
             (a.category IS NOT NULL) AS on_map
      FROM ranked r
      LEFT JOIN allowed a ON a.category = r.category
      ORDER BY r.area_sqm DESC
    ),
    parcel_geoms AS (
      SELECT h.category,
             ST_SimplifyPreserveTopology(
               ST_SetSRID(j.geom, ${JIJUK_GEOM_SRID}),
               ${simplify}
             ) AS geom
      FROM hit_cat h
      INNER JOIN ${JIJUK_SCHEMA}.jijuk j ON j.pnu = h.pnu
      WHERE j.geom IS NOT NULL
    ),
    feat_rows AS (
      SELECT pg.category,
             ST_AsGeoJSON(ST_Collect(pg.geom)) AS geom_json
      FROM parcel_geoms pg
      INNER JOIN allowed a ON a.category = pg.category
      GROUP BY pg.category
      UNION ALL
      SELECT '${esc(PARCEL_THEME_MAP_OTHER_CATEGORY)}' AS category,
             ST_AsGeoJSON(ST_Collect(pg.geom)) AS geom_json
      FROM parcel_geoms pg
      WHERE NOT EXISTS (
        SELECT 1 FROM allowed a WHERE a.category = pg.category
      )
      HAVING COUNT(*) > 0
    )
    SELECT
      (SELECT cnt FROM parcel_total) AS parcel_count,
      (SELECT cnt > ${fullLimit} FROM parcel_total) AS map_category_limit_applied,
      (SELECT json_agg(c) FROM (
        SELECT category AS label, count, area_sqm, on_map
        FROM cat_rows
        ORDER BY area_sqm DESC
      ) c) AS categories,
      (SELECT json_agg(f) FROM (
        SELECT category, geom_json
        FROM feat_rows
      ) f) AS features`;

  try {
    const client = await pool.connect();
    let row: Record<string, unknown> | undefined;
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${PARCEL_ANALYZE_DB_STATEMENT_TIMEOUT}'`);
      const res = await client.query(queryStr);
      await client.query('COMMIT');
      row = res.rows?.[0] as Record<string, unknown> | undefined;
    } catch (inner: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw inner;
    } finally {
      client.release();
    }

    if (!row) return { ...empty, ok: true, theme, parcelCount: 0, mapCategoryLimitApplied: false };

    const categoriesRaw = normalizeStatRows(row.categories);
    const featuresRaw = normalizeStatRows(row.features);

    const categories: ParcelThemeMapCategory[] = categoriesRaw.map((r) => ({
      label: String(r.label ?? '미상'),
      count: toInt(r.count),
      areaSqm: toInt(r.area_sqm),
      onMap: r.on_map === true || r.on_map === 'true' || r.on_map === 1,
    }));

    const features: ParcelThemeMapFeature[] = [];
    for (const r of featuresRaw) {
      const geometry = parseGeoJsonGeometry(r.geom_json);
      if (!geometry) continue;
      features.push({
        category: String(r.category ?? '미상'),
        geometry,
      });
    }

    return {
      ok: true,
      theme,
      parcelCount: toInt(row.parcel_count),
      mapCategoryLimitApplied: row.map_category_limit_applied === true,
      categories,
      features,
    };
  } catch (e: unknown) {
    return { ...empty, error: toParcelAnalyzeUserError(e) };
  }
}

export type { BuildingLedgerDisplayRow, ParcelAnalysisLayerDef };
