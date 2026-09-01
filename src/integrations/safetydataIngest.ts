import { pool } from '@/database/db';
import { fetchWithRetry, withAdvisoryLock } from '@/integrations/core';
import { createOrUpdateGeoServerLayer, resetGeoServerCaches } from '@/service/devTestService';
import type { Pool, PoolClient } from 'pg';

/** CREATE/DROP/INSERT를 같은 DB 트랜잭션에서 실행하기 위한 실행자 */
type PgQueryExec = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

let logSafetydataTableEnsured = false;

async function ensureLogSafetydataTable(): Promise<void> {
  if (logSafetydataTableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "log_safetydata" (
      "log_safetydata_key" serial PRIMARY KEY NOT NULL,
      "log_safetydata_dataset_id" varchar(80) NOT NULL,
      "log_safetydata_name" varchar(500) NOT NULL,
      "log_safetydata_date" varchar(8) NOT NULL,
      "log_safetydata_request_date" timestamp DEFAULT now() NOT NULL,
      "log_safetydata_result_code" varchar(50),
      "log_safetydata_response_code" varchar(50),
      "log_safetydata_response_msg" text,
      "log_safetydata_status" varchar(500) NOT NULL
    );
  `);
  logSafetydataTableEnsured = true;
}

function formatYmdKst(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');
}

async function insertLogSafetydata(params: {
  datasetId: string;
  name: string;
  date: string;
  resultCode?: string | null;
  responseCode?: string | null;
  responseMsg?: string | null;
  status: string;
}): Promise<void> {
  await ensureLogSafetydataTable();
  await pool.query(
    `insert into log_safetydata (
      log_safetydata_dataset_id,
      log_safetydata_name,
      log_safetydata_date,
      log_safetydata_request_date,
      log_safetydata_result_code,
      log_safetydata_response_code,
      log_safetydata_response_msg,
      log_safetydata_status
    ) values ($1,$2,$3,now(),$4,$5,$6,$7)`,
    [
      params.datasetId,
      params.name,
      params.date,
      params.resultCode ?? null,
      params.responseCode ?? null,
      params.responseMsg ?? null,
      params.status,
    ]
  );
}
import {
  getSafetydataDatasetById,
  type SafetydataApiColumnSpec,
  type SafetydataDatasetConfig,
} from '@/integrations/safetydata.config';
import { buildSafetydataFetchUrl, getSafetydataTargetSchema } from '@/integrations/safetydataHttp';
import { fetchNormalizedJibunFromAddressSearch } from '@/lib/vworldAddressServer';

const TARGET_SRID = 5181;
const EMD_SCHEMA = (process.env.SAFETYDATA_EMD_SCHEMA ?? 'public_layer').trim() || 'public_layer';
const EMD_TABLE = (process.env.SAFETYDATA_EMD_TABLE ?? 'emd').trim() || 'emd';

const SAFE_IDENT = /^[a-z][a-z0-9_]*$/;

function qi(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function assertSafeRelationName(name: string): string {
  const n = name.trim().toLowerCase();
  if (!SAFE_IDENT.test(n)) throw new Error(`Invalid table name: ${name}`);
  return n;
}

function assertSafeSchema(name: string): string {
  const n = name.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`Invalid schema: ${name}`);
  return n;
}

/** JSON 키 → SQL 컬럼명 (소문자·안전 문자만) */
export function safetydataJsonKeyToColumn(key: string): string {
  let s = key.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  if (s.length === 0) s = 'col';
  if (/^[0-9]/.test(s)) s = `c_${s}`;
  if (!SAFE_IDENT.test(s)) throw new Error(`Cannot map key to column: ${key}`);
  return s;
}

function normalizeItemsNode(items: unknown): Record<string, unknown>[] {
  if (items == null) return [];
  if (Array.isArray(items)) return items as Record<string, unknown>[];
  if (typeof items === 'object') {
    const it = (items as Record<string, unknown>).item;
    if (Array.isArray(it)) return it as Record<string, unknown>[];
    if (it != null && typeof it === 'object') return [it as Record<string, unknown>];
  }
  return [];
}

/**
 * 포털 응답 래퍼: (1) V2 평면 `{ header, body[], totalCount, ... }` (2) 구형 `{ response: { header, body } }`
 */
function resolveSafetydataPayload(data: unknown): Record<string, unknown> | null {
  if (data == null || typeof data !== 'object') return null;
  const root = data as Record<string, unknown>;
  const nested = root.response ?? root.Response;
  if (nested != null && typeof nested === 'object') {
    const r = nested as Record<string, unknown>;
    if (r.header != null || r.Header != null) return r;
  }
  if (root.header != null || root.Header != null) return root;
  return null;
}

/** response.body(또는 Body) 안에서 레코드 배열 후보 탐색 */
function extractRecordsFromBody(body: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];

  const items = body.items ?? body.Items;
  if (items != null) {
    const out = normalizeItemsNode(items);
    if (out.length > 0) return out;
  }

  const item = body.item ?? body.Item;
  if (item != null) {
    const out = normalizeItemsNode({ item });
    if (out.length > 0) return out;
  }

  for (const k of ['rows', 'Rows', 'list', 'List', 'data', 'content', 'result']) {
    const v = body[k];
    if (v == null) continue;
    if (Array.isArray(v)) return v as Record<string, unknown>[];
    if (typeof v === 'object') {
      const out = normalizeItemsNode(v);
      if (out.length > 0) return out;
    }
  }
  return [];
}

/** 재난안전데이터 JSON에서 레코드 배열 추출 (V2: body가 배열 / 구형: body.items.item 등) */
export function extractSafetydataItems(data: unknown): Record<string, unknown>[] {
  const payload = resolveSafetydataPayload(data);
  if (payload != null) {
    const body = payload.body ?? payload.Body;
    if (body != null) {
      if (Array.isArray(body)) return body as Record<string, unknown>[];
      if (typeof body === 'object') {
        const fromBody = extractRecordsFromBody(body as Record<string, unknown>);
        if (fromBody.length > 0) return fromBody;
      }
    }
  }
  if (data != null && typeof data === 'object') {
    const root = data as Record<string, unknown>;
    if (Array.isArray(root.data)) return root.data as Record<string, unknown>[];
    return normalizeItemsNode(root.items);
  }
  return [];
}

function parseTotalCount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function getSafetydataTotalCount(data: unknown): number | null {
  const payload = resolveSafetydataPayload(data);
  if (payload != null) {
    const ptc = payload.totalCount ?? payload.TotalCount;
    const pn = parseTotalCount(ptc);
    if (pn != null) return pn;
    const body = payload.body ?? payload.Body;
    if (body != null && typeof body === 'object' && !Array.isArray(body)) {
      const b = body as Record<string, unknown>;
      const tc = b.totalCount ?? b.TotalCount ?? b.total_count;
      const n = parseTotalCount(tc);
      if (n != null) return n;
    }
  }
  return null;
}

/** API 헤더 resultCode 00 정상 확인 */
export function assertSafetydataResponseOk(data: unknown): void {
  if (data == null || typeof data !== 'object') return;
  const payload = resolveSafetydataPayload(data);
  if (payload == null) return;
  const header = (payload.header ?? payload.Header) as unknown;
  if (header == null || typeof header !== 'object') return;
  const h = header as Record<string, unknown>;
  const code = h.resultCode ?? h.resultcode ?? h.ResultCode;
  if (code == null) return;
  const c = String(code).trim();
  if (c === '00' || c === '0') return;
  const msg = h.resultMsg ?? h.resultmsg ?? h.ResultMsg ?? code;
  throw new Error(`Safetydata API resultCode=${c} ${String(msg)}`);
}

function specToPgType(spec: SafetydataApiColumnSpec): string {
  const t = spec.type.toUpperCase();
  if (t === 'GEOMETRY') return `geometry(Geometry,${TARGET_SRID})`;
  // 재난안전데이터는 숫자처럼 보이지만 문자열 값(예: "없음", "상습")이 섞여 들어오는 케이스가 많아서
  // geometry 외 모든 컬럼은 text로 저장한다.
  return 'text';
}

function isWktLike(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim().toUpperCase();
  return (
    s.startsWith('POINT') ||
    s.startsWith('LINESTRING') ||
    s.startsWith('POLYGON') ||
    s.startsWith('MULTIPOINT') ||
    s.startsWith('MULTILINESTRING') ||
    s.startsWith('MULTIPOLYGON') ||
    s.startsWith('GEOMETRYCOLLECTION')
  );
}

/** WKT 내 좌표 최대 절댓값 (위경도는 |값|≤180) */
function wktMaxAbsNumber(wkt: string): number {
  let maxAbs = 0;
  const re = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wkt)) !== null) {
    maxAbs = Math.max(maxAbs, Math.abs(parseFloat(m[0])));
  }
  return maxAbs;
}

function inferPgType(col: string, sampleValues: unknown[]): string {
  const lower = col.toLowerCase();
  if (lower === 'geom' || lower === 'geometry' || lower === 'the_geom') {
    const hasWkt = sampleValues.some(isWktLike);
    if (hasWkt) return `geometry(Geometry,${TARGET_SRID})`;
  }
  // geometry 외는 전부 text
  return 'text';
}

type ColumnDef = { sqlName: string; pgType: string; sourceKeys: string[] };

type SpatialResolved =
  | { mode: 'none'; publishGeoserver: boolean; geomColumn: string }
  | {
      mode: 'wkt';
      publishGeoserver: boolean;
      geomColumn: string;
      wktField: string;
      sourceSrid: number | 'auto';
    }
  | {
      mode: 'xy';
      publishGeoserver: boolean;
      geomColumn: string;
      xField: string;
      yField: string;
      sourceSrid: number | 'auto';
    }
  | { mode: 'auto'; publishGeoserver: boolean; geomColumn: string; sourceSrid: number | 'auto' };

function resolveSpatialConfig(cfg: SafetydataDatasetConfig, sampleRows: Record<string, unknown>[]): SpatialResolved {
  const spatial = cfg.spatial;
  const publishGeoserver = spatial?.publishGeoserver ?? true;
  const geomColumn = (spatial?.geomColumn ?? 'geom').trim() || 'geom';
  const mode = spatial?.mode ?? 'auto';

  if (mode === 'none') return { mode: 'none', publishGeoserver, geomColumn };
  if (mode === 'wkt') {
    const wktField = (spatial?.wktField ?? 'GEOM').trim() || 'GEOM';
    return { mode: 'wkt', publishGeoserver, geomColumn, wktField, sourceSrid: spatial?.sourceSrid ?? 'auto' };
  }
  if (mode === 'xy') {
    const xField = (spatial?.xField ?? 'X').trim() || 'X';
    const yField = (spatial?.yField ?? 'Y').trim() || 'Y';
    return {
      mode: 'xy',
      publishGeoserver,
      geomColumn,
      xField,
      yField,
      sourceSrid: spatial?.sourceSrid ?? 'auto',
    };
  }
  if (mode === 'auto') {
    return { mode: 'auto', publishGeoserver, geomColumn, sourceSrid: spatial?.sourceSrid ?? 'auto' };
  }
  return { mode: 'auto', publishGeoserver, geomColumn, sourceSrid: 'auto' };
}

function hasOwnCaseInsensitive(obj: Record<string, unknown>, key: string): string | null {
  if (key in obj) return key;
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return k;
  }
  return null;
}

function autoSpatialFromSample(
  cfg: SafetydataDatasetConfig,
  sampleRows: Record<string, unknown>[]
): SpatialResolved | null {
  const base = resolveSpatialConfig(cfg, sampleRows);
  if (base.mode !== 'auto') return base;
  const row = sampleRows[0];
  if (!row) return base;

  // Prefer WKT field
  const wktKey = hasOwnCaseInsensitive(row, 'GEOM') ?? hasOwnCaseInsensitive(row, 'geom') ?? hasOwnCaseInsensitive(row, 'the_geom');
  if (wktKey) {
    const v = row[wktKey];
    if (typeof v === 'string' && isWktLike(v)) {
      return {
        mode: 'wkt',
        publishGeoserver: base.publishGeoserver,
        geomColumn: base.geomColumn,
        wktField: wktKey,
        sourceSrid: base.sourceSrid,
      };
    }
  }

  // Try XY candidates
  const xCand = ['x', 'X', 'lon', 'LON', 'lng', 'LNG', 'longitude', 'LONGITUDE', 'lot', 'LOT'];
  const yCand = ['y', 'Y', 'lat', 'LAT', 'latitude', 'LATITUDE'];
  let xKey: string | null = null;
  let yKey: string | null = null;
  for (const k of xCand) {
    xKey = hasOwnCaseInsensitive(row, k);
    if (xKey) break;
  }
  for (const k of yCand) {
    yKey = hasOwnCaseInsensitive(row, k);
    if (yKey) break;
  }
  if (xKey && yKey) {
    return {
      mode: 'xy',
      publishGeoserver: base.publishGeoserver,
      geomColumn: base.geomColumn,
      xField: xKey,
      yField: yKey,
      sourceSrid: base.sourceSrid,
    };
  }

  return base;
}

function sridFromWktOrXyAuto(maxAbs: number): number {
  if (maxAbs <= 180) return 4326;
  // heuristic: very large => WebMercator meters
  if (maxAbs > 1_000_000) return 3857;
  // otherwise assume KR 2000 / Central Belt (common in local datasets)
  return 5186;
}

function parseMaybeNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeSridOrTarget(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return TARGET_SRID;
  return Math.floor(n);
}

type EmdGeomMeta = {
  schema: string;
  table: string;
  geomColumn: string;
  srid: number;
};

async function resolveEmdGeomMeta(): Promise<EmdGeomMeta | null> {
  const schema = assertSafeSchema(EMD_SCHEMA);
  const table = assertSafeRelationName(EMD_TABLE);
  const esc = (s: string) => s.replace(/'/g, "''");
  const gcRes = await pool.query<{
    name?: string;
    srid?: number | string;
  }>(
    `SELECT f_geometry_column AS name, srid
     FROM geometry_columns
     WHERE f_table_schema = '${esc(schema)}' AND f_table_name = '${esc(table)}'
     LIMIT 1`
  );
  const row = gcRes.rows?.[0];
  const geomColumn = String(row?.name ?? '').trim();
  if (!geomColumn) return null;
  return {
    schema,
    table,
    geomColumn,
    srid: normalizeSridOrTarget(row?.srid),
  };
}

function shouldFilterWithinEmd(cfg: SafetydataDatasetConfig): boolean {
  const force = (process.env.SAFETYDATA_FILTER_TO_EMD ?? '').trim().toLowerCase();
  if (force === '1' || force === 'true' || force === 'yes') return true;
  if (force === '0' || force === 'false' || force === 'no') return false;
  if (cfg.filterWithinEmdViaPoiJoin) return true;
  /**
   * 기본 정책:
   * - geometry를 생성하는 데이터셋(mode !== 'none')은 모두 emd 필터 적용
   * - geometry 없음 + filterWithinEmdViaPoiJoin 이면 POI 조인(옵션으로 EMD까지) 필터
   * - 그 외 mode === 'none' 은 공간 필터 생략
   */
  const mode = cfg.spatial?.mode ?? 'auto';
  return mode !== 'none';
}

function buildEmdGeomExpr(meta: EmdGeomMeta): string {
  const g = `e.${qi(meta.geomColumn)}`;
  /**
   * EMD는 운영 기준 EPSG:5181로 관리한다고 가정.
   * - SRID=5181: 그대로 사용
   * - SRID=0: 5181로만 태깅
   * (다른 SRID는 사전에 오류로 중단)
   */
  return `CASE WHEN ST_SRID(${g}) = 0 THEN ST_SetSRID(${g}, ${TARGET_SRID}) ELSE ${g} END`;
}

function buildEmdUnionSql(meta: EmdGeomMeta): string {
  const emdGeomExpr = buildEmdGeomExpr(meta);
  return `(
    SELECT ST_UnaryUnion(ST_Collect(${emdGeomExpr})) AS geom
    FROM ${qi(meta.schema)}.${qi(meta.table)} e
    WHERE e.${qi(meta.geomColumn)} IS NOT NULL
  )`;
}

async function ensureEmdUnionAvailable(meta: EmdGeomMeta): Promise<void> {
  const badSridQ = `
    SELECT COUNT(*)::int AS c
    FROM ${qi(meta.schema)}.${qi(meta.table)} e
    WHERE e.${qi(meta.geomColumn)} IS NOT NULL
      AND ST_SRID(e.${qi(meta.geomColumn)}) NOT IN (0, ${TARGET_SRID})
  `;
  const badSridRes = await pool.query<{ c?: number | string }>(badSridQ);
  const badSridCount = Number(badSridRes.rows?.[0]?.c ?? 0);
  if (badSridCount > 0) {
    throw new Error(
      `EMD 좌표계 오류: ${meta.schema}.${meta.table}.${meta.geomColumn}에 EPSG:${TARGET_SRID}이 아닌 도형 ${badSridCount}건`
    );
  }

  const q = `
    SELECT
      u.g IS NOT NULL AS has_geom,
      COALESCE(ST_IsEmpty(u.g), true) AS is_empty
    FROM (${buildEmdUnionSql(meta)}) u(g)
  `;
  const r = await pool.query<{ has_geom?: boolean; is_empty?: boolean }>(q);
  const row = r.rows?.[0];
  const hasGeom = Boolean(row?.has_geom);
  const isEmpty = row?.is_empty !== undefined ? Boolean(row.is_empty) : true;
  if (!hasGeom || isEmpty) {
    throw new Error(
      `EMD 합집합을 계산할 수 없습니다: ${meta.schema}.${meta.table}.${meta.geomColumn}`
    );
  }
}

function isValidCoordForSrid(srid: number, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (srid === 4326) return x >= -180 && x <= 180 && y >= -90 && y <= 90;
  if (srid === 3857) return Math.abs(x) <= 20_037_508.34 && Math.abs(y) <= 20_037_508.34;
  // 5186 등은 범위를 엄격히 잡기 어려워서 통과(변환 실패 시 NULL 처리 로직을 위에서 막음)
  return true;
}

function mergeDerivedColumns(cfg: SafetydataDatasetConfig, defs: ColumnDef[]): ColumnDef[] {
  const extra = cfg.derivedColumns ?? [];
  for (const col of extra) {
    const sqlName = safetydataJsonKeyToColumn(col.name);
    if (defs.some((d) => d.sqlName === sqlName)) continue;
    defs.push({
      sqlName,
      pgType: (col.pgType ?? 'text').trim() || 'text',
      sourceKeys: [],
    });
  }
  return defs;
}

/** responseFields 우선, 없으면 첫 페이지 행으로 컬럼 추론 */
function buildColumnDefs(
  cfg: SafetydataDatasetConfig,
  sampleRows: Record<string, unknown>[]
): ColumnDef[] {
  if (cfg.responseFields != null && cfg.responseFields.length > 0) {
    const base = cfg.responseFields.map((spec) => {
      const sqlName = safetydataJsonKeyToColumn(spec.nameEn);
      const pgType = specToPgType(spec);
      return { sqlName, pgType, sourceKeys: [spec.nameEn] };
    });
    const spatial = resolveSpatialConfig(cfg, sampleRows);
    if (spatial.mode !== 'none') {
      const geomCol = safetydataJsonKeyToColumn(spatial.geomColumn);
      if (!base.some((d) => d.sqlName === geomCol)) {
        base.push({ sqlName: geomCol, pgType: `geometry(Geometry,${TARGET_SRID})`, sourceKeys: [] });
      }
    }
    return mergeDerivedColumns(cfg, base);
  }
  const keySet = new Map<string, Set<string>>();
  for (const row of sampleRows) {
    for (const k of Object.keys(row)) {
      const sql = safetydataJsonKeyToColumn(k);
      if (!keySet.has(sql)) keySet.set(sql, new Set());
      keySet.get(sql)!.add(k);
    }
  }
  const samplesBySql = new Map<string, unknown[]>();
  for (const row of sampleRows) {
    for (const [jsonKey, val] of Object.entries(row)) {
      const sql = safetydataJsonKeyToColumn(jsonKey);
      if (!samplesBySql.has(sql)) samplesBySql.set(sql, []);
      samplesBySql.get(sql)!.push(val);
    }
  }
  const defs: ColumnDef[] = [];
  for (const sqlName of [...keySet.keys()].sort()) {
    const pgType = inferPgType(sqlName, samplesBySql.get(sqlName) ?? []);
    defs.push({ sqlName, pgType, sourceKeys: [...(keySet.get(sqlName) ?? [])] });
  }

  const spatial = resolveSpatialConfig(cfg, sampleRows);
  if (spatial.mode !== 'none') {
    const geomCol = safetydataJsonKeyToColumn(spatial.geomColumn);
    if (!defs.some((d) => d.sqlName === geomCol)) {
      defs.push({ sqlName: geomCol, pgType: `geometry(Geometry,${TARGET_SRID})`, sourceKeys: [] });
    }
  }

  return mergeDerivedColumns(cfg, defs);
}

function pickValue(row: Record<string, unknown>, sourceKeys: string[]): unknown {
  for (const k of sourceKeys) {
    if (k in row) return row[k];
    const lower = k.toLowerCase();
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === lower) return row[rk];
    }
  }
  return null;
}

async function ensureSchemaAndPostgis(schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${qi(schema)}`);
  await pool.query('CREATE EXTENSION IF NOT EXISTS postgis').catch(() => {
    /* 권한 없으면 geometry 컬럼 생성 시 실패할 수 있음 */
  });
}

async function dropTableIfExists(schema: string, table: string, exec: PgQueryExec = pool): Promise<void> {
  await exec.query(`DROP TABLE IF EXISTS ${qi(schema)}.${qi(table)} CASCADE`);
}

async function createTable(
  schema: string,
  table: string,
  defs: ColumnDef[],
  exec: PgQueryExec = pool
): Promise<void> {
  const cols = ['ogc_fid SERIAL PRIMARY KEY'];
  for (const d of defs) {
    cols.push(`${qi(d.sqlName)} ${d.pgType}`);
  }
  const sql = `CREATE TABLE ${qi(schema)}.${qi(table)} (${cols.join(', ')})`;
  await exec.query(sql);
}

type InsertRowFilterOpts = {
  /** EMD·부모테이블 조인 WHERE 생략(개발용 전건 적재) */
  bypassEmdAndParentJoinFilters?: boolean;
};

async function insertRows(
  schema: string,
  table: string,
  cfg: SafetydataDatasetConfig,
  defs: ColumnDef[],
  rows: Record<string, unknown>[],
  pageNo: number,
  exec: PgQueryExec = pool,
  filterOpts?: InsertRowFilterOpts
): Promise<number> {
  if (rows.length === 0) return 0;
  const spatial = autoSpatialFromSample(cfg, rows);
  const spatialGeomCol = spatial ? safetydataJsonKeyToColumn(spatial.geomColumn) : null;
  const hasGeomInDefs = defs.some((d) => d.pgType.startsWith('geometry'));
  const canGeomEmdFilter = hasGeomInDefs && spatial != null && spatial.mode !== 'none';
  const poiJoinSpec = cfg.filterWithinEmdViaPoiJoin;
  const canPoiJoinFilter = Boolean(poiJoinSpec) && !hasGeomInDefs;
  const poiJoinUsesEmdSpatial = poiJoinSpec?.requirePoiWithinEmd !== false;

  const filterRequired =
    !filterOpts?.bypassEmdAndParentJoinFilters && shouldFilterWithinEmd(cfg);
  console.log(
    `[SAFETYDATA FILTER] dataset=${cfg.id} mode=${spatial?.mode ?? 'none'} filterRequired=${filterRequired} bypassUnfiltered=${Boolean(filterOpts?.bypassEmdAndParentJoinFilters)} geomCol=${spatialGeomCol ?? '-'} geomFilter=${canGeomEmdFilter} poiJoinFilter=${canPoiJoinFilter} poiJoinEmdSpatial=${poiJoinUsesEmdSpatial}`
  );
  if (filterRequired && !canGeomEmdFilter && !canPoiJoinFilter) {
    throw new Error(
      `EMD 필터가 필요한데 geometry 생성 불가이고 POI 조인 설정도 없습니다: ${cfg.id} (${cfg.tableNameEn})`
    );
  }

  const applyGeomEmdFilter = filterRequired && canGeomEmdFilter;
  const applyPoiJoinFilter = filterRequired && canPoiJoinFilter;
  const emdMetaNeeded = applyGeomEmdFilter || (applyPoiJoinFilter && poiJoinUsesEmdSpatial);
  const emdMeta = emdMetaNeeded ? await resolveEmdGeomMeta() : null;
  if (emdMetaNeeded && !emdMeta) {
    throw new Error(
      `EMD 도형 메타를 찾을 수 없습니다: schema=${EMD_SCHEMA}, table=${EMD_TABLE}`
    );
  }
  if (emdMeta) {
    await ensureEmdUnionAvailable(emdMeta);
  }
  const emdUnionSql = emdMeta ? buildEmdUnionSql(emdMeta) : null;

  let poiJoinLocalCol: string | null = null;
  let poiJoinPoiCol: string | null = null;
  let poiJoinTable: string | null = null;
  if (applyPoiJoinFilter && poiJoinSpec) {
    poiJoinTable = assertSafeRelationName(poiJoinSpec.poiTable);
    poiJoinLocalCol = safetydataJsonKeyToColumn(poiJoinSpec.localJoinColumn);
    poiJoinPoiCol = safetydataJsonKeyToColumn(poiJoinSpec.poiJoinColumn);
    const hasLocal = defs.some((d) => d.sqlName === poiJoinLocalCol);
    if (!hasLocal) {
      throw new Error(
        `filterWithinEmdViaPoiJoin: 적재 테이블에 조인 컬럼이 없습니다: ${cfg.id} ${poiJoinLocalCol}`
      );
    }
  }
  const colNames = defs.map((d) => qi(d.sqlName)).join(', ');
  const colAliasList = defs.map((d) => qi(d.sqlName)).join(', ');
  /** VALUES 별칭은 컬럼명만 허용(`"geom" geometry` 는 구문 오류). 타입은 표현식·NULL::geometry 로 맞춘다. */
  const valueAliasList = defs.map((d) => qi(d.sqlName)).join(', ');
  let insertedTotal = 0;

  const chunkSize = Math.max(
    1,
    Math.min(1000, Number(process.env.SAFETYDATA_INSERT_CHUNK ?? '300') || 300)
  );
  const totalChunks = Math.max(1, Math.ceil(rows.length / chunkSize));

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunkNo = Math.floor(i / chunkSize) + 1;
    const chunk = rows.slice(i, i + chunkSize);
    const attemptCount = chunk.length;
    const values: unknown[] = [];
    const tupleSqls: string[] = [];
    let param = 1;

    for (const row of chunk) {
      const fragments: string[] = [];
      for (const d of defs) {
        const raw = pickValue(row, d.sourceKeys);
        if (d.pgType.startsWith('geometry')) {
          // Special case: our generated geom column
          if (spatialGeomCol && d.sqlName === spatialGeomCol && spatial && spatial.mode !== 'none') {
            if (spatial.mode === 'wkt') {
              const key = hasOwnCaseInsensitive(row, spatial.wktField) ?? spatial.wktField;
              const v = (key in row ? row[key] : null) as unknown;
              if (typeof v === 'string' && isWktLike(v)) {
                const w = v.trim();
                const srid =
                  spatial.sourceSrid === 'auto' ? sridFromWktOrXyAuto(wktMaxAbsNumber(w)) : spatial.sourceSrid;
                fragments.push(`ST_Transform(ST_GeomFromText($${param++}, ${srid}), ${TARGET_SRID})`);
                values.push(w);
              } else {
                fragments.push('NULL::geometry');
              }
            } else if (spatial.mode === 'xy') {
              const xk = hasOwnCaseInsensitive(row, spatial.xField) ?? spatial.xField;
              const yk = hasOwnCaseInsensitive(row, spatial.yField) ?? spatial.yField;
              const xv = parseMaybeNumber((xk in row ? row[xk] : null) as unknown);
              const yv = parseMaybeNumber((yk in row ? row[yk] : null) as unknown);
              if (xv != null && yv != null) {
                const maxAbs = Math.max(Math.abs(xv), Math.abs(yv));
                const srid = spatial.sourceSrid === 'auto' ? sridFromWktOrXyAuto(maxAbs) : spatial.sourceSrid;
                if (isValidCoordForSrid(srid, xv, yv)) {
                  fragments.push(
                    `ST_Transform(ST_SetSRID(ST_MakePoint($${param++}, $${param++}), ${srid}), ${TARGET_SRID})`
                  );
                  values.push(xv, yv);
                } else {
                  fragments.push('NULL::geometry');
                }
              } else {
                fragments.push('NULL::geometry');
              }
            } else {
              fragments.push('NULL::geometry');
            }
          } else if (raw != null && typeof raw === 'string' && isWktLike(raw)) {
            // Any other geometry-like column: normalize to TARGET_SRID
            const w = raw.trim();
            const src = sridFromWktOrXyAuto(wktMaxAbsNumber(w));
            fragments.push(`ST_Transform(ST_GeomFromText($${param++}, ${src}), ${TARGET_SRID})`);
            values.push(w);
          } else {
            fragments.push('NULL::geometry');
          }
        } else {
          fragments.push(`$${param++}`);
          values.push(coerceTextOrNum(raw));
        }
      }
      tupleSqls.push(`(${fragments.join(', ')})`);
    }

    let sql = `INSERT INTO ${qi(schema)}.${qi(table)} (${colNames})
      SELECT ${colAliasList}
      FROM (VALUES ${tupleSqls.join(', ')}) AS v(${valueAliasList})`;
    if (applyGeomEmdFilter && spatialGeomCol && emdUnionSql) {
      sql += `
      WHERE v.${qi(spatialGeomCol)} IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM ${emdUnionSql} u
          WHERE u.geom IS NOT NULL
            AND NOT ST_IsEmpty(u.geom)
            AND v.${qi(spatialGeomCol)}::geometry && u.geom
            AND ST_Intersects(v.${qi(spatialGeomCol)}::geometry, u.geom)
        )`;
    } else if (applyPoiJoinFilter && poiJoinUsesEmdSpatial && emdUnionSql && poiJoinTable && poiJoinLocalCol && poiJoinPoiCol) {
      sql += `
      WHERE trim(coalesce(v.${qi(poiJoinLocalCol)}::text, '')) <> ''
        AND EXISTS (
          SELECT 1
          FROM ${qi(schema)}.${qi(poiJoinTable)} p
          CROSS JOIN ${emdUnionSql} u
          WHERE p.${qi('geom')} IS NOT NULL
            AND trim(coalesce(p.${qi(poiJoinPoiCol)}::text, '')) <> ''
            AND trim(p.${qi(poiJoinPoiCol)}::text) = trim(v.${qi(poiJoinLocalCol)}::text)
            AND u.geom IS NOT NULL
            AND NOT ST_IsEmpty(u.geom)
            AND p.${qi('geom')}::geometry && u.geom
            AND ST_Intersects(p.${qi('geom')}::geometry, u.geom)
        )`;
    } else if (applyPoiJoinFilter && !poiJoinUsesEmdSpatial && poiJoinTable && poiJoinLocalCol && poiJoinPoiCol) {
      sql += `
      WHERE trim(coalesce(v.${qi(poiJoinLocalCol)}::text, '')) <> ''
        AND EXISTS (
          SELECT 1
          FROM ${qi(schema)}.${qi(poiJoinTable)} p
          WHERE trim(coalesce(p.${qi(poiJoinPoiCol)}::text, '')) <> ''
            AND trim(p.${qi(poiJoinPoiCol)}::text) = trim(v.${qi(poiJoinLocalCol)}::text)
        )`;
    }
    const result = await exec.query(sql, values);
    const insertedCount = result.rowCount ?? 0;
    const filteredOutCount = Math.max(0, attemptCount - insertedCount);
    insertedTotal += insertedCount;
    console.log(
      `[SAFETYDATA INSERT] dataset=${cfg.id} table=${schema}.${table} page=${pageNo} chunk=${chunkNo}/${totalChunks} attempted=${attemptCount} inserted=${insertedCount} filteredOut=${filteredOutCount}`
    );
  }
  return insertedTotal;
}

function addrCacheKey(addr: string): string {
  return addr.trim().replace(/\s+/g, ' ');
}

export type FillGeomAddrResult = {
  attempted: number;
  updated: number;
  skipped: number;
  failed: number;
};

/** addr → VWorld search 지번 주소 → jibun_addr UPDATE */
export async function fillGeomAddrColumn(
  schema: string,
  table: string,
  exec: PgQueryExec = pool
): Promise<FillGeomAddrResult> {
  const safeSchema = assertSafeSchema(schema);
  const safeTable = assertSafeRelationName(table);

  const res = await exec.query<{ ogc_fid: number | string; addr: string | null }>(
    `SELECT ogc_fid, addr
     FROM ${qi(safeSchema)}.${qi(safeTable)}
     WHERE trim(coalesce(addr, '')) <> ''`
  );

  const rows = res.rows ?? [];
  const cache = new Map<string, string | null>();
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const concurrency = Math.max(1, Math.min(8, Number(process.env.SAFETYDATA_GEOCODE_CONCURRENCY ?? '5') || 5));

  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (row) => {
        const ogcFid = Number(row.ogc_fid);
        const sourceAddr = String(row.addr ?? '').trim();
        if (!Number.isFinite(ogcFid) || !sourceAddr) {
          skipped += 1;
          return;
        }

        const key = addrCacheKey(sourceAddr);
        if (!cache.has(key)) {
          cache.set(key, await fetchNormalizedJibunFromAddressSearch(sourceAddr));
        }
        const jibunAddr = cache.get(key);
        if (!jibunAddr) {
          skipped += 1;
          return;
        }

        try {
          const upd = await exec.query(
            `UPDATE ${qi(safeSchema)}.${qi(safeTable)} SET ${qi('jibun_addr')} = $1 WHERE ogc_fid = $2`,
            [jibunAddr, ogcFid]
          );
          if ((upd.rowCount ?? 0) > 0) updated += 1;
          else skipped += 1;
        } catch {
          failed += 1;
        }
      })
    );
  }

  const result: FillGeomAddrResult = {
    attempted: rows.length,
    updated,
    skipped,
    failed,
  };
  console.log(
    `[SAFETYDATA GEOADDR] table=${safeSchema}.${safeTable} attempted=${result.attempted} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`
  );
  return result;
}

function coerceTextOrNum(v: unknown): string | number | null {
  if (v == null) return null;
  // geometry 외 컬럼은 전부 text로 저장
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v).trim();
  if (s === '') return null;
  return s;
}

export type SafetydataIngestResult = {
  datasetId: string;
  tableNameKo: string;
  tableNameEn: string;
  schema: string;
  rowsFetched: number;
  rowsInserted: number;
  rowsFilteredOut: number;
  pagesFetched: number;
};

export type SafetydataIngestOptions = {
  /** 페이지당 건수 (기본 500) */
  numOfRows?: number;
  /** 최대 페이지 수 (기본 무제한) */
  maxPages?: number;
  /**
   * true면 `ingestPrerequisiteDatasetIds` 선행 적재 생략.
   * 전체 배치에서 부모가 이미 같은 실행에서 앞서 돌았을 때 사용.
   */
  skipPrerequisites?: boolean;
  /**
   * true면 INSERT 시 EMD 교차·filterWithinEmdViaPoiJoin 부모 조건을 붙이지 않고 API 건수만큼 적재.
   * 개발용; 운영 정책과 다를 수 있음.
   */
  bypassEmdAndParentJoinFilters?: boolean;
};

/**
 * OpenAPI 호출 → `layer`(또는 SAFETYDATA_TARGET_SCHEMA)에 테이블 생성 후 전체 페이지 적재.
 * 기존 동일 이름 테이블은 DROP 후 재생성합니다.
 */
export async function ingestSafetydataDatasetToLayer(
  datasetId: string,
  options: SafetydataIngestOptions = {}
): Promise<SafetydataIngestResult> {
  const cfg = getSafetydataDatasetById(datasetId);
  if (!cfg) throw new Error(`Unknown safetydata dataset: ${datasetId}`);

  const prereqs = cfg.ingestPrerequisiteDatasetIds ?? [];
  if (!options.skipPrerequisites && prereqs.length > 0) {
    const forward: SafetydataIngestOptions = {
      numOfRows: options.numOfRows,
      maxPages: options.maxPages,
    };
    for (const pid of prereqs) {
      await ingestSafetydataDatasetToLayer(pid, forward);
    }
  }

  const schema = assertSafeSchema(getSafetydataTargetSchema());
  const table = assertSafeRelationName(cfg.tableNameEn);
  const numOfRows = options.numOfRows ?? 500;
  const maxPages = options.maxPages ?? 10_000;

  const lockKey = `safetydata_ingest:${datasetId}`;
  const ymd = formatYmdKst();
  const nameKo = cfg.tableNameKo;

  const bypassRowFilters = options.bypassEmdAndParentJoinFilters === true;

  return withAdvisoryLock(lockKey, async () => {
    console.log(`[SAFETYDATA INGEST START] dataset=${cfg.id} table=${schema}.${table}`);
    await insertLogSafetydata({
      datasetId: cfg.id,
      name: nameKo,
      date: ymd,
      status: 'STARTED',
    });

    const client = await pool.connect();
    try {
      await ensureSchemaAndPostgis(schema);
      await client.query('BEGIN');

      let page = 1;
      let totalFetched = 0;
      let totalInserted = 0;
      let defs: ColumnDef[] | null = null;
      let pagesFetched = 0;

      while (page <= maxPages) {
        const url = buildSafetydataFetchUrl(cfg, { pageNo: page, numOfRows });
        const res = await fetchWithRetry(url, { method: 'GET' });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(`Safetydata HTTP ${res.status} page ${page}: ${text.slice(0, 400)}`);
        }
        let data: unknown;
        try {
          data = JSON.parse(text) as unknown;
        } catch {
          throw new Error(`Safetydata response is not JSON (page ${page})`);
        }
        assertSafetydataResponseOk(data);
        const items = extractSafetydataItems(data);
        pagesFetched += 1;
        totalFetched += items.length;
        console.log(
          `[SAFETYDATA PAGE] dataset=${cfg.id} table=${schema}.${table} page=${page} items=${items.length}`
        );

        if (items.length === 0) {
          const totalCount = getSafetydataTotalCount(data);
          if (page === 1 && totalCount === 0) {
            defs = buildColumnDefs(cfg, []);
            await dropTableIfExists(schema, table, client);
            await createTable(schema, table, defs, client);
            break;
          }
          if (page === 1 && cfg.responseFields != null && cfg.responseFields.length > 0) {
            defs = buildColumnDefs(cfg, []);
            await dropTableIfExists(schema, table, client);
            await createTable(schema, table, defs, client);
            break;
          }
          if (page === 1) throw new Error(`Safetydata: no items on first page (${datasetId})`);
          break;
        }

        if (defs == null) {
          defs = buildColumnDefs(cfg, items);
          await dropTableIfExists(schema, table, client);
          await createTable(schema, table, defs, client);
        }

        const insertedCount = await insertRows(schema, table, cfg, defs, items, page, client, {
          bypassEmdAndParentJoinFilters: bypassRowFilters,
        });
        totalInserted += insertedCount;

        const totalCount = getSafetydataTotalCount(data);
        if (totalCount != null && totalInserted >= totalCount) break;
        if (items.length < numOfRows) break;
        page += 1;
      }

      if (defs == null) {
        throw new Error(`Safetydata: could not build table (${datasetId})`);
      }

      const result = {
        datasetId,
        tableNameKo: nameKo,
        tableNameEn: table,
        schema,
        rowsFetched: totalFetched,
        rowsInserted: totalInserted,
        rowsFilteredOut: Math.max(0, totalFetched - totalInserted),
        pagesFetched,
      };

      await insertLogSafetydata({
        datasetId: cfg.id,
        name: nameKo,
        date: ymd,
        status: 'SUCCESS',
        responseMsg:
          `table=${schema}.${table}` +
          ` fetched=${result.rowsFetched}` +
          ` inserted=${result.rowsInserted}` +
          ` filteredOut=${result.rowsFilteredOut}` +
          ` pages=${pagesFetched}`,
      });
      console.log(
        `[SAFETYDATA INGEST DONE] dataset=${cfg.id} table=${schema}.${table} fetched=${result.rowsFetched} inserted=${result.rowsInserted} filteredOut=${result.rowsFilteredOut} pages=${result.pagesFetched}`
      );

      await client.query('COMMIT');

      if (cfg.fillGeomAddr) {
        await fillGeomAddrColumn(schema, table);
      }

      const spatial = resolveSpatialConfig(cfg, []);
      if (spatial.publishGeoserver && spatial.mode !== 'none') {
        try {
          const layerRes = await createOrUpdateGeoServerLayer({ layerName: table });
          if (!layerRes.success) {
            console.warn(
              `[SAFETYDATA GEOSERVER] ${table}: ${'error' in layerRes ? layerRes.error : '레이어 재발행 실패'}`
            );
          } else {
            const reset = await resetGeoServerCaches();
            if (!reset.success) {
              console.warn(
                `[SAFETYDATA GEOSERVER] ${table}: ${'error' in reset ? reset.error : '캐시 초기화 실패'}`
              );
            }
          }
        } catch (e) {
          console.warn(`[SAFETYDATA GEOSERVER] ${table}:`, e instanceof Error ? e.message : e);
        }
      }

      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await client.query('ROLLBACK').catch(() => {});
      console.log(
        `[SAFETYDATA INGEST FAIL] dataset=${cfg.id} table=${schema}.${table} message=${msg}`
      );
      await insertLogSafetydata({
        datasetId: cfg.id,
        name: nameKo,
        date: ymd,
        status: 'FAILED',
        responseMsg: msg,
      });
      throw e;
    } finally {
      client.release();
    }
  });
}
