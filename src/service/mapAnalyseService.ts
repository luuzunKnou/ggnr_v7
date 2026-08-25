/**
 * 필지분석 — 분석 영역(WKT 5181)과 교차하는 필지를 우리 DB에서 집계.
 * 연계 보강은 enrichParcelLandRows 로 분리(2단계·토지현황 행만).
 */
import { db, pool } from '@/database/db';
import { sql } from 'drizzle-orm';
import { applyEnrichmentToLandRows, type AnalyzeLandRow } from '@/lib/parcelLandNormalize';
import {
  fetchBuildingLedgersByPnus,
  fetchPortalBuildingFloorList,
  fetchPortalBuildingRegisterByDong,
  fetchPortalBuildingRegisterForLandInfo,
  type BuildingLedgerDisplayRow,
  type BuildingLedgerFetchDebug,
} from '@/lib/buildingLedgerFetch';
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
} from '@/service/landLinkageService';
import { resolvePlatLocAndLotByPnus } from '@/service/layerRowService';
import { toParcelAnalyzeUserError } from '@/lib/parcelAnalyzeUserError';
import {
  PARCEL_THEME_MAP_SIMPLIFY_TOLERANCE_M,
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
        -- jibun = 지번+지목(예: 634-1도, 240답) → 끝 한글을 지목으로
        NULLIF(TRIM(SUBSTRING(j.jibun::text FROM '(?:산?[0-9]+(?:-[0-9]+)?)[[:space:]]*([가-힣]+)$')), '') AS jimok,
        NULL::text AS ownship_se
      FROM ${JIJUK_SCHEMA}.jijuk j
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
  linkageFailed?: boolean;
  linkageFailReason?: string;
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
    linkageFailed?: boolean;
    linkageFailReason?: string;
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
    linkageFailed: r.linkageFailed,
    linkageFailReason: r.linkageFailReason,
  }));
}

/** 지적 jibun(예: 452-4대)에서 지번 숫자만 — 주소 표시용 */
function lotLabelFromJijukJibun(jibunRaw: string): string {
  const s = String(jibunRaw ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(산?\d+(?:-\d+)?)/u);
  return m?.[1]?.trim() ?? '';
}

/** 지적 jibun(예: 634-1도)에서 지목만 */
function jimokFromJijukJibun(jibunRaw: string): string {
  const s = String(jibunRaw ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(?:산?\d+(?:-\d+)?)[\s]*([가-힣]+)$/u);
  return m?.[1]?.trim() ?? '';
}

function isUnknownJimok(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return !s || s === '미상';
}

/**
 * 토지현황 표시용 주소: «영양읍 서부리 452-4» (PNU·읍면동리명 + 지번).
 * jibun 필드에 주소 문자열을 넣어 클라 addr 매핑과 맞춘다.
 * 지목은 연계 전·후 비어 있으면 지적 jibun 끝 글자(도·대·답 등)로 채운다.
 */
async function applyLandRowDisplayAddresses(
  landRows: AnalyzeLandRowResult[]
): Promise<AnalyzeLandRowResult[]> {
  if (!landRows.length) return landRows;

  const withJimokFallback = (r: AnalyzeLandRowResult, rawJibun: string): AnalyzeLandRowResult => {
    const fromJibun = jimokFromJijukJibun(rawJibun);
    const jimok = isUnknownJimok(r.jimok) && fromJibun ? fromJibun : r.jimok;
    return jimok === r.jimok ? r : { ...r, jimok };
  };

  try {
    const addrByPnu = await resolvePlatLocAndLotByPnus(landRows.map((r) => r.pnu));
    return landRows.map((r) => {
      const rawJibun = r.jibun;
      const base = withJimokFallback(r, rawJibun);
      const resolved = addrByPnu.get(String(r.pnu ?? '').trim());
      const lot =
        (resolved?.jibunLot ?? '').trim() || lotLabelFromJijukJibun(rawJibun) || '';
      const plat = (resolved?.platLoc ?? '').trim();
      const addr = [plat, lot].filter(Boolean).join(' ');
      return { ...base, jibun: addr || lot || rawJibun || r.pnu };
    });
  } catch {
    return landRows.map((r) => {
      const rawJibun = r.jibun;
      const base = withJimokFallback(r, rawJibun);
      const lot = lotLabelFromJijukJibun(rawJibun);
      return { ...base, jibun: lot || rawJibun || r.pnu };
    });
  }
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

    const landRowsRaw: AnalyzeLandRowResult[] = rows.map((r) => ({
      pnu: String(r.pnu ?? '').trim(),
      jibun: String(r.jibun ?? '').trim(),
      jimok: String(r.jimok ?? '미상'),
      areaSqm: toInt(r.area_sqm),
    }));
    const landRows = await applyLandRowDisplayAddresses(landRowsRaw);
    return { ok: true, landRows };
  } catch (e: unknown) {
    return { ...empty, error: toParcelAnalyzeUserError(e) };
  }
}

/** 토지이용계획 — 서버는 행망(KRAS000025). 브이월드는 클라 점진 로딩 */
export async function fetchLandUseZonesByPnus(params: {
  pnus?: string[];
}): Promise<FetchLandUseZonesResult> {
  return fetchLandUseZonesByPnusLinkage(params);
}

/** 토지현황 표시 행만 연계 보강 — 소유·지목 통계는 점진 로딩에서 재집계 */
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
    ownerType: String(r.ownerType ?? '').trim(),
    ownerName: r.ownerName,
    publicPrice: r.publicPrice ?? null,
    source: r.source as AnalyzeLandRow['source'],
  }));

  const pnus = baseRows.map((r) => r.pnu).filter((p) => /^\d{19}$/.test(p));
  if (!pnus.length) return { ok: true, landRows: input };

  try {
    const { enrichments, source } = await enrichParcelLandsByPnus({ pnus });
    const merged = applyEnrichmentToLandRows(baseRows, enrichments);
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
  /** GeoServer 발행 레이어명(소문자) — 기본도·시설 캡처 공통 */
  publishedLayerKeys?: string[];
};

export type BuildingLedgerResult = {
  ok: boolean;
  rows: BuildingLedgerDisplayRow[];
  error?: string;
  notice?: string;
  portalQuotaExceeded?: boolean;
  debug?: BuildingLedgerFetchDebug;
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
  return {
    ok: true,
    groups,
    publishedLayerKeys: publishedSet ? [...publishedSet] : undefined,
  };
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

export {
  fetchPortalBuildingFloorList,
  fetchPortalBuildingRegisterByDong,
  fetchPortalBuildingRegisterForLandInfo,
};

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
 * 소유·지목 테마 지도용 필지 도형(PNU 단위 GeoJSON).
 * 색 구분(범주)은 클라이언트 보강 결과로 칠한다.
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

  const simplify = PARCEL_THEME_MAP_SIMPLIFY_TOLERANCE_M;

  const queryStr = `${buildHitCteSql(wkt)},
    parcel_geoms AS (
      SELECT
        h.pnu::text AS pnu,
        ST_AsGeoJSON(
          ST_SimplifyPreserveTopology(
            ST_SetSRID(j.geom, ${JIJUK_GEOM_SRID}),
            ${simplify}
          )
        ) AS geom_json
      FROM hit h
      INNER JOIN ${JIJUK_SCHEMA}.jijuk j ON j.pnu = h.pnu
      WHERE j.geom IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*)::int FROM hit) AS parcel_count,
      (SELECT json_agg(f) FROM (
        SELECT pnu, geom_json FROM parcel_geoms
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

    const featuresRaw = normalizeStatRows(row.features);
    const features: ParcelThemeMapFeature[] = [];
    for (const r of featuresRaw) {
      const geometry = parseGeoJsonGeometry(r.geom_json);
      if (!geometry) continue;
      const pnu = String(r.pnu ?? '').trim();
      features.push({
        pnu: pnu || undefined,
        category: '미상',
        geometry,
      });
    }

    return {
      ok: true,
      theme,
      parcelCount: toInt(row.parcel_count),
      mapCategoryLimitApplied: false,
      categories: [],
      features,
    };
  } catch (e: unknown) {
    return { ...empty, error: toParcelAnalyzeUserError(e) };
  }
}

export type { BuildingLedgerDisplayRow, ParcelAnalysisLayerDef };
