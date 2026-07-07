/**
 * 필지분석 — 분석 영역(WKT 5181)과 교차하는 필지를 우리 DB에서 집계.
 * 연계 보강은 enrichParcelLandRows 로 분리(2단계·토지현황 행만).
 */
import { db, pool } from '@/database/db';
import { sql } from 'drizzle-orm';
import { applyEnrichmentToLandRows } from '@/lib/parcelLandNormalize';
import { fetchBuildingLedgersByPnus, type BuildingLedgerDisplayRow } from '@/lib/buildingLedgerFetch';
import {
  buildParcelAnalysisFacilityCatalog,
  resolveParcelAnalysisLayers,
  type ParcelAnalysisFacilityGroupDef,
  type ParcelAnalysisLayerDef,
} from '@/lib/parcelAnalysisCatalog';
import { getEnabledSystemsRaw } from '@/service/configService';
import {
  enrichParcelLandsByPnus,
  fetchLandUseZonesByPnus as fetchLandUseZonesByPnusLinkage,
  shouldMaskParcelOwners,
} from '@/service/landLinkageService';
import { toParcelAnalyzeUserError } from '@/lib/parcelAnalyzeUserError';

const PARCEL_ANALYZE_DB_STATEMENT_TIMEOUT = '600s';

const JIJUK_SCHEMA = 'public_layer';
const JIJUK_GEOM_SRID = 5181;

function esc(value: string): string {
  return value.replace(/'/g, "''");
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

  const baseRows = input.map((r) => ({
    pnu: String(r.pnu ?? '').trim(),
    jibun: String(r.jibun ?? '').trim(),
    jimok: String(r.jimok ?? '미상'),
    areaSqm: toInt(r.areaSqm),
    ownerType: String(r.ownerType ?? '').trim() || '미상',
    ownerName: r.ownerName,
    publicPrice: r.publicPrice ?? null,
    source: r.source as AnalyzeLandRowResult['source'],
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

/** 시설목록 동적 카탈로그 (4-E) */
export async function getParcelAnalysisFacilityCatalog(): Promise<FacilityCatalogResult> {
  const groups = buildParcelAnalysisFacilityCatalog(getEnabledSystemsRaw());
  return { ok: true, groups };
}

/** 분석 영역과 교차하는 시설 레이어 통계 (4-D) */
export async function selectLayerStatsByWkt(params: {
  wkt5181?: string;
  layers?: Array<{ layerKey?: string; layerKorName?: string; geomType?: string; schema?: string }>;
}): Promise<SelectLayerStatsResult> {
  const empty: SelectLayerStatsResult = { ok: false, rows: [] };
  const wkt = String(params?.wkt5181 ?? '').trim();
  if (!wkt) return { ...empty, error: '분석 영역(WKT)이 필요합니다.' };

  const layers = resolveParcelAnalysisLayers(params?.layers ?? []);
  if (!layers.length) return { ok: true, rows: [] };

  const searchGeom = `ST_SetSRID(ST_GeomFromText('${esc(wkt)}'), ${JIJUK_GEOM_SRID})`;
  const parts: string[] = [];

  for (const layer of layers) {
    const schema = esc(layer.schema);
    const table = esc(layer.layerKey);
    const kor = esc(layer.layerKorName);
    const geomCol = `ST_SetSRID(geom, ${JIJUK_GEOM_SRID})`;
    const intersect = `ST_Intersection(${geomCol}, ST_MakeValid(${searchGeom}))`;

    let statsExpr: string;
    let unit: string;
    if (layer.geomType === 'POINT') {
      statsExpr = 'COUNT(*)::float8';
      unit = '개';
    } else if (layer.geomType === 'LINE') {
      statsExpr = `ROUND(COALESCE(SUM(ST_Length(${intersect})), 0)::numeric, 2)::float8`;
      unit = 'm';
    } else {
      statsExpr = `ROUND(COALESCE(SUM(ST_Area(${intersect})), 0)::numeric, 2)::float8`;
      unit = '㎡';
    }

    parts.push(`
      SELECT '${table}' AS layer_key, '${kor}' AS layer_kor_name, '${layer.geomType}' AS geom_type,
             ${statsExpr} AS stats, '${unit}' AS unit
      FROM ${schema}.${table}
      WHERE geom IS NOT NULL
        AND ${geomCol} && ${searchGeom}
        AND ST_Intersects(${geomCol}, ${searchGeom})
      HAVING COUNT(*) > 0`);
  }

  const queryStr = parts.join('\nUNION ALL\n') + '\nORDER BY stats DESC, layer_kor_name';

  try {
    const res = await db.execute(sql.raw(queryStr));
    const rows: LayerStatRow[] = (res.rows ?? []).map((r) => {
      const rec = r as Record<string, unknown>;
      const geom = String(rec.geom_type ?? 'POLYGON').toUpperCase();
      const geomType =
        geom === 'POINT' ? 'POINT' : geom === 'LINE' ? 'LINE' : 'POLYGON';
      return {
        layerKey: String(rec.layer_key ?? ''),
        layerKorName: String(rec.layer_kor_name ?? ''),
        geomType,
        stats: Number(rec.stats ?? 0) || 0,
        unit: String(rec.unit ?? ''),
      };
    });
    return { ok: true, rows };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: msg };
  }
}

/** 건축물대장 조회 (4-C) */
export async function fetchBuildingLedgersForParcels(params: {
  parcels?: Array<{ pnu?: string; jibun?: string }>;
}): Promise<BuildingLedgerResult> {
  return fetchBuildingLedgersByPnus(params);
}

export type { BuildingLedgerDisplayRow, ParcelAnalysisLayerDef };
