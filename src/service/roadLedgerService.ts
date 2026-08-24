/**
 * 도로대장 — layer.a0020000 기반 목록 등
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import {
  getAllRoadLedgerDocLayerIds,
  ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT,
  ROAD_LEDGER_DOC_LAYERS,
  ROAD_LEDGER_RDID_JOIN_SEGMENT_LEN,
  ROAD_LEDGER_RDID_LAYER_LEN,
  ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN,
  type RoadLedgerDocButtonKey,
} from '@/app/(pages)/map/_mapContents/road/roadLedger/roadLedgerDocLayerMap';
import { getDefineLayerTables, getLayerTableList } from './devTestService';
import {
  getLayerTableRowByOgcFid,
  getTableData,
  resolveLayerPhysicalRelName,
  sanitizeDefineLayerRowFilter,
} from './standardService';

/** 시설 건수 조회 동시 실행 수 — 전체 레이어를 한꺼번에 열면 DB 연결이 고갈됨 */
const FACILITY_COUNT_CONCURRENCY = 3;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!);
      }
    })
  );
  return results;
}

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/** 목록 SQL bool — node 등에서 문자열 't'/'f'로 올 수 있음. 미인식 시 접미어 표시(보수적 true). */
function parseRoadLedgerShowSectSuffix(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 't' || v === 'true') return true;
  if (v === 'f' || v === 'false') return false;
  return true;
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

export type RoadLedgerListRow = {
  roadLedgerOgcFid: number;
  rdid: string;
  roadName: string;
  roadNo: string;
  sect: string;
  /** ROAD_RANK — 도로의종류 코드(원문), 목록 괄호 표시용 */
  roadRank: string;
  /** DSGDATE — 노선지정(인정)일 (원문) */
  roadLedgerDsgdate: string;
  /** LENTH — 노선연장 원문(숫자 문자열 등), 표시 시 m 단위는 클라이언트 */
  roadLedgerLenth: string;
  /**
   * 테이블 전체 기준 해당 노선에 숫자 구간이 1만 있으면 false(목록에서 `…1구간` 생략).
   * 2구간 등 다른 구간이 있으면 true(1구간도 표시).
   */
  roadLedgerShowSectSuffix: boolean;
};

/**
 * 도로대장(a0020000) 목록. 키워드는 도로명·노선번호·rdid·구간 등에 대해 ILIKE.
 */
export async function getRoadLedgerList(params?: {
  keyword?: string;
}): Promise<{ rows: RoadLedgerListRow[]; error?: string }> {
  const keyword = String(params?.keyword ?? '').trim();
  try {
  const tableName = await resolveLayerTableName('a0020000');
  const safeTbl = tableName.replace(/"/g, '""');

  const kwClause = keyword
    ? ` AND (
        COALESCE(road_name::text, '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(road_no::text, '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(rdid::text, '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(sect::text, '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(dsgdate::text, '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(lenth::text, '') ILIKE '%${esc(keyword)}%'
        OR COALESCE(road_rank::text, '') ILIKE '%${esc(keyword)}%'
      )`
    : '';

  const res = await db.execute(
    sql.raw(
      `WITH road_sect_meta AS (
         SELECT
           LOWER(TRIM(BOTH FROM COALESCE(t.road_name::text, ''))) AS gk_name,
           LOWER(TRIM(BOTH FROM COALESCE(t.road_no::text, ''))) AS gk_no,
           BOOL_OR(
             TRIM(BOTH FROM COALESCE(t.sect::text, '')) <> ''
             AND TRIM(BOTH FROM COALESCE(t.sect::text, '')) !~ '^[0-9]+$'
           ) AS has_nonnumeric_sect,
           COUNT(DISTINCT CASE
             WHEN TRIM(BOTH FROM COALESCE(t.sect::text, '')) ~ '^[0-9]+$'
             THEN (TRIM(BOTH FROM t.sect::text))::bigint
             ELSE NULL
           END) AS dist_numeric_sect_count,
           MAX(CASE
             WHEN TRIM(BOTH FROM COALESCE(t.sect::text, '')) ~ '^[0-9]+$'
             THEN (TRIM(BOTH FROM t.sect::text))::bigint
             ELSE NULL
           END) AS max_numeric_sect,
           MIN(CASE
             WHEN TRIM(BOTH FROM COALESCE(t.sect::text, '')) ~ '^[0-9]+$'
             THEN (TRIM(BOTH FROM t.sect::text))::bigint
             ELSE NULL
           END) AS min_numeric_sect
         FROM layer."${safeTbl}" t
         GROUP BY 1, 2
       )
       SELECT
         t.ogc_fid AS "roadLedgerOgcFid",
         COALESCE(t.rdid::text, '') AS "rdid",
         COALESCE(t.road_name::text, '') AS "roadName",
         COALESCE(t.road_no::text, '') AS "roadNo",
         COALESCE(t.sect::text, '') AS "sect",
         COALESCE(NULLIF(trim(both from t.road_rank::text), ''), '') AS "roadRank",
         COALESCE(NULLIF(trim(both from t.dsgdate::text), ''), '') AS "roadLedgerDsgdate",
         COALESCE(NULLIF(trim(both from t.lenth::text), ''), '') AS "roadLedgerLenth",
         CASE
           WHEN m.has_nonnumeric_sect THEN TRUE
           WHEN COALESCE(m.dist_numeric_sect_count, 0) > 1 THEN TRUE
           WHEN COALESCE(m.dist_numeric_sect_count, 0) = 1
             AND m.max_numeric_sect = 1
             AND m.min_numeric_sect = 1
           THEN FALSE
           ELSE TRUE
         END AS "roadLedgerShowSectSuffix"
       FROM layer."${safeTbl}" t
       INNER JOIN road_sect_meta m
         ON m.gk_name = LOWER(TRIM(BOTH FROM COALESCE(t.road_name::text, '')))
        AND m.gk_no = LOWER(TRIM(BOTH FROM COALESCE(t.road_no::text, '')))
       WHERE 1=1 ${kwClause}
       ORDER BY COALESCE(t.road_name::text, ''), COALESCE(t.road_no::text, ''), t.ogc_fid
       LIMIT 5000`
    )
  );

  const rows = (res.rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const roadRankRaw = row.roadRank ?? row.road_rank ?? row.roadrank;
    return {
      roadLedgerOgcFid: Number(row.roadLedgerOgcFid ?? 0) || 0,
      rdid: String(row.rdid ?? '').trim(),
      roadName: String(row.roadName ?? '').trim(),
      roadNo: String(row.roadNo ?? '').trim(),
      sect: String(row.sect ?? '').trim(),
      roadRank: String(roadRankRaw ?? '').trim(),
      roadLedgerDsgdate: String(row.roadLedgerDsgdate ?? '').trim(),
      roadLedgerLenth: String(row.roadLedgerLenth ?? '').trim(),
      roadLedgerShowSectSuffix: parseRoadLedgerShowSectSuffix(row.roadLedgerShowSectSuffix),
    };
  });

  return { rows };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rows: [], error: msg };
  }
}

/** 도로대장 레이어 전체 범위(3857) — 패널 진입 시 맞춤 줌용 */
export async function getRoadLedgerLayerExtent(): Promise<{
  extent3857: [number, number, number, number] | null;
}> {
  const tableName = await resolveLayerTableName('a0020000');
  const safeTbl = tableName.replace(/"/g, '""');

  const res = await db.execute(
    sql.raw(
      `SELECT
         ST_XMin(ext)::float8 AS xmin,
         ST_YMin(ext)::float8 AS ymin,
         ST_XMax(ext)::float8 AS xmax,
         ST_YMax(ext)::float8 AS ymax
       FROM (
         SELECT ST_Extent(ST_Transform(geom, 3857))::box2d AS ext
         FROM layer."${safeTbl}"
         WHERE geom IS NOT NULL
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
 * 도로대장 1건 — identifyFeatures와 동일한 SELECT(전 컬럼 + geom WGS84 GeoJSON).
 * 목록 클릭·지도 식별 모두 같은 스키마로 상세 패널에 표시.
 */
export async function getRoadLedgerFeatureByOgcFid(params: {
  ogcFid: number | string;
}): Promise<{ row: Record<string, unknown> | null }> {
  const tableName = await resolveLayerTableName('a0020000');
  return getLayerTableRowByOgcFid({
    schema: 'layer',
    table: tableName,
    ogcFid: params.ogcFid,
  });
}

/**
 * 주요시설~기타시설 define 테이블 1건 — 전 컬럼 + geom WGS84 GeoJSON (getLayerTableRowByOgcFid).
 * 분할 레이어는 부모 물리 테이블 기준으로 조회.
 */
export async function getRoadLedgerFacilityFeatureByOgcFid(params: {
  defineTableName: string;
  ogcFid: number | string;
}): Promise<{ row: Record<string, unknown> | null; defineTableKorName: string }> {
  const dn = String(params.defineTableName ?? '').trim().toLowerCase();
  if (!dn) {
    return { row: null, defineTableKorName: '' };
  }
  const existing = await getRoadLedgerExistingDefineLayerIdSet();
  if (!existing.has(dn)) {
    return { row: null, defineTableKorName: '' };
  }

  const defineRes = await getDefineLayerTables();
  const defineRows = (defineRes.tables ?? []) as DefineLayerRowLite[];
  const defineMap = new Map<string, DefineLayerRowLite>();
  for (const row of defineRows) {
    const n = String(row.define_table_name ?? '').trim().toLowerCase();
    if (n) defineMap.set(n, row);
  }
  const def = defineMap.get(dn);
  const kor = String(def?.define_table_kor_name ?? '').trim();
  const { schema, table } = resolvePhysicalTableForDefineLayer(dn, defineMap);
  const { row } = await getLayerTableRowByOgcFid({
    schema,
    table,
    ogcFid: params.ogcFid,
  });
  return { row, defineTableKorName: kor };
}

const FACILITY_GROUP_KEYS = new Set<string>(ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT);

type DefineLayerRowLite = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

/** geometry_columns에 등록된 layer/public_layer 물리 테이블 (스키마::소문자테이블명) */
async function buildDbLayerKeySet(): Promise<Set<string>> {
  const listRes = await getLayerTableList();
  const s = new Set<string>();
  for (const t of listRes.tables ?? []) {
    s.add(`${String(t.schema).toLowerCase()}::${String(t.table).toLowerCase()}`);
  }
  return s;
}

/** define 분할 레이어는 부모 물리 테이블 기준으로 존재 여부 판단 */
function resolvePhysicalTableForDefineLayer(
  defineIdLower: string,
  defineMap: Map<string, DefineLayerRowLite>
): { schema: 'layer' | 'public_layer'; table: string } {
  const def = defineMap.get(defineIdLower);
  let physical = defineIdLower;
  let schema: 'layer' | 'public_layer' = 'layer';
  if (def) {
    const parent = String(def.define_table_parents_layer ?? '').trim();
    const divQ = String(def.define_table_div_query ?? '').trim();
    const isSplit = Boolean(parent && divQ);
    physical = (isSplit ? parent : String(def.define_table_name ?? defineIdLower)).trim().toLowerCase();
    const sch = String(def.define_table_schema ?? 'layer').trim().toLowerCase();
    if (sch === 'public_layer') schema = 'public_layer';
  }
  return { schema, table: physical };
}

async function computeRoadLedgerExistingDefineLayerIdSet(): Promise<Set<string>> {
  const [dbKeys, defineRes] = await Promise.all([buildDbLayerKeySet(), getDefineLayerTables()]);
  const defineRows = (defineRes.tables ?? []) as DefineLayerRowLite[];
  const defineMap = new Map<string, DefineLayerRowLite>();
  for (const row of defineRows) {
    const n = String(row.define_table_name ?? '').trim().toLowerCase();
    if (n) defineMap.set(n, row);
  }

  const out = new Set<string>();
  for (const id of getAllRoadLedgerDocLayerIds()) {
    const phys = resolvePhysicalTableForDefineLayer(id, defineMap);
    const key = `${phys.schema}::${phys.table}`;
    if (dbKeys.has(key)) out.add(id);
  }
  return out;
}

let roadLedgerExistingDefineLayerIdCache: { set: Set<string>; at: number } | null = null;
const ROAD_LEDGER_EXISTING_IDS_TTL_MS = 60_000;

async function getRoadLedgerExistingDefineLayerIdSet(): Promise<Set<string>> {
  const now = Date.now();
  if (
    roadLedgerExistingDefineLayerIdCache &&
    now - roadLedgerExistingDefineLayerIdCache.at < ROAD_LEDGER_EXISTING_IDS_TTL_MS
  ) {
    return roadLedgerExistingDefineLayerIdCache.set;
  }
  const set = await computeRoadLedgerExistingDefineLayerIdSet();
  roadLedgerExistingDefineLayerIdCache = { set, at: now };
  return set;
}

/**
 * 도로대장 문서 버튼에 연결된 define_table_name 중 DB에 물리 테이블이 있는 것만.
 * 클라이언트 레이어 토글·시설 API 필터에 사용.
 */
export async function getRoadLedgerExistingDefineLayerIds(): Promise<{ ids: string[] }> {
  const set = await getRoadLedgerExistingDefineLayerIdSet();
  return { ids: [...set].sort() };
}

/**
 * 도로대장총괄 RDID와 시설 `rdid` 조인: 레이어(3) 제외, 1-based 4~19번째 = 16자(도로등급~구간번호) 동일.
 */
function buildRoadLedgerFacilityRdidJoinFilter(masterRdid: string): string | null {
  const t = String(masterRdid ?? '').trim();
  if (t.length < ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN) return null;
  const segment = t.slice(
    ROAD_LEDGER_RDID_LAYER_LEN,
    ROAD_LEDGER_RDID_LAYER_LEN + ROAD_LEDGER_RDID_JOIN_SEGMENT_LEN
  );
  const p = esc(segment);
  const start1 = ROAD_LEDGER_RDID_LAYER_LEN + 1;
  const len = ROAD_LEDGER_RDID_JOIN_SEGMENT_LEN;
  return `(SUBSTRING(TRIM(BOTH FROM COALESCE("rdid"::text, '')) FROM ${start1} FOR ${len}) = '${p}')`;
}

/**
 * 시설 행의 RDID로 도로대장총괄(a0020000) 노선 1건 — 목록만 열린 채 지도에서 시설을 고를 때 상세 패널을 열기 위해 사용.
 * RDID 조인 규칙은 시설 하위 목록과 동일.
 */
export async function getRoadLedgerMasterRowForFacilityRdid(params: {
  facilityRdid: string;
}): Promise<{ row: Record<string, unknown> | null }> {
  const facilityRdid = String(params.facilityRdid ?? '').trim();
  const filterRaw = buildRoadLedgerFacilityRdidJoinFilter(facilityRdid);
  if (!filterRaw) return { row: null };
  const safeFilter = sanitizeDefineLayerRowFilter(filterRaw);
  if (!safeFilter) return { row: null };
  const tableName = await resolveLayerTableName('a0020000');
  const res = await getTableData({
    table: tableName,
    schema: 'layer',
    rowFilter: safeFilter,
    limit: 1,
    offset: 0,
  });
  if (typeof (res as { error?: string }).error === 'string' && (res as { error: string }).error) {
    return { row: null };
  }
  const rows = res.rows;
  if (!Array.isArray(rows) || rows.length === 0) return { row: null };
  return { row: rows[0] as Record<string, unknown> };
}

function omitGeomFromRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const o: Record<string, unknown> = { ...row };
    for (const k of Object.keys(o)) {
      if (k.toLowerCase() === 'geom') delete o[k];
    }
    return o;
  });
}

export type RoadLedgerFacilityTableBlock = {
  defineTableName: string;
  title: string;
  rows: Record<string, unknown>[];
  total: number;
  error?: string;
};

export type RoadLedgerFacilitySection = {
  groupKey: RoadLedgerDocButtonKey;
  tables: RoadLedgerFacilityTableBlock[];
};

/**
 * 도로대장총괄 RDID prefix(19자)로 시설 하위 테이블 조회용 fetcher(캐시 공유).
 * define 분할 레이어는 부모 테이블 + div_query + RDID 조건을 AND로 결합.
 */
async function createRoadLedgerFacilityTableFetcher(masterRdid: string): Promise<{
  fetchTableRows: (defineTableName: string) => Promise<{
    rows: Record<string, unknown>[];
    total: number;
    error?: string;
  }>;
  fetchTableCount: (defineTableName: string) => Promise<{ total: number; error?: string }>;
  defineMap: Map<string, DefineLayerRowLite>;
}> {
  const rdidJoinBuilt = buildRoadLedgerFacilityRdidJoinFilter(masterRdid);
  if (!rdidJoinBuilt) {
    throw new Error('RDID가 비었거나 조인 최소 길이 미만입니다.');
  }
  const rdidJoinSql: string = rdidJoinBuilt;

  const defineRes = await getDefineLayerTables();
  const defineRows = (defineRes.tables ?? []) as DefineLayerRowLite[];
  const defineMap = new Map<string, DefineLayerRowLite>();
  for (const row of defineRows) {
    const n = String(row.define_table_name ?? '').trim().toLowerCase();
    if (n) defineMap.set(n, row);
  }

  const rowCache = new Map<string, { rows: Record<string, unknown>[]; total: number; error?: string }>();
  const countCache = new Map<string, { total: number; error?: string }>();

  function resolveFacilityTarget(defineTableName: string): {
    schema: 'layer' | 'public_layer';
    physical: string;
    safeCombined: string;
    cacheKey: string;
  } | { error: string } {
    const tn = defineTableName.trim().toLowerCase();
    const def = defineMap.get(tn);
    let physical = tn;
    let schema: 'layer' | 'public_layer' = 'layer';
    let divPart: string | null = null;

    if (def) {
      const parent = String(def.define_table_parents_layer ?? '').trim();
      const divQ = String(def.define_table_div_query ?? '').trim();
      const isSplit = Boolean(parent && divQ);
      physical = (isSplit ? parent : String(def.define_table_name ?? tn)).trim().toLowerCase();
      if (isSplit) {
        divPart = sanitizeDefineLayerRowFilter(divQ);
      }
      const sch = String(def.define_table_schema ?? 'layer').trim().toLowerCase();
      if (sch === 'public_layer') schema = 'public_layer';
    }

    let combined = rdidJoinSql;
    if (divPart) {
      combined = `(${divPart}) AND ${rdidJoinSql}`;
    }
    const safeCombined = sanitizeDefineLayerRowFilter(combined);
    if (!safeCombined) {
      return { error: '행 필터 구성 실패(CQL/길이)' };
    }
    return {
      schema,
      physical,
      safeCombined,
      cacheKey: `${schema}::${physical}::${safeCombined}`,
    };
  }

  async function fetchTableCount(
    defineTableName: string
  ): Promise<{ total: number; error?: string }> {
    const target = resolveFacilityTarget(defineTableName);
    if ('error' in target) return { total: 0, error: target.error };

    const rowHit = rowCache.get(target.cacheKey);
    if (rowHit) return { total: rowHit.total, ...(rowHit.error ? { error: rowHit.error } : {}) };
    const countHit = countCache.get(target.cacheKey);
    if (countHit) return countHit;

    const physicalName = await resolveLayerPhysicalRelName(target.schema, target.physical);
    if (!physicalName) {
      const out = { total: 0 };
      countCache.set(target.cacheKey, out);
      return out;
    }
    const safeSchema = target.schema.replace(/"/g, '""');
    const safeTable = physicalName.replace(/"/g, '""');
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT COUNT(*)::int AS total FROM "${safeSchema}"."${safeTable}" WHERE ${target.safeCombined}`
        )
      );
      const total = Number((res.rows?.[0] as { total?: number } | undefined)?.total ?? 0);
      const out = { total: Number.isFinite(total) ? total : 0 };
      countCache.set(target.cacheKey, out);
      return out;
    } catch (e: unknown) {
      const out = { total: 0, error: e instanceof Error ? e.message : String(e) };
      countCache.set(target.cacheKey, out);
      return out;
    }
  }

  async function fetchTableRows(
    defineTableName: string
  ): Promise<{ rows: Record<string, unknown>[]; total: number; error?: string }> {
    const target = resolveFacilityTarget(defineTableName);
    if ('error' in target) return { rows: [], total: 0, error: target.error };

    const hit = rowCache.get(target.cacheKey);
    if (hit) return hit;

    const res = await getTableData({
      table: target.physical,
      schema: target.schema,
      rowFilter: target.safeCombined,
      limit: 500,
      offset: 0,
    });
    const out = {
      rows: omitGeomFromRows((res.rows ?? []) as Record<string, unknown>[]),
      total: typeof res.total === 'number' ? res.total : 0,
      ...(res.error ? { error: res.error } : {}),
    };
    rowCache.set(target.cacheKey, out);
    countCache.set(target.cacheKey, {
      total: out.total,
      ...(out.error ? { error: out.error } : {}),
    });
    return out;
  }

  return { fetchTableRows, fetchTableCount, defineMap };
}

/**
 * 주요시설~기타시설 하위 define 레이어(테이블)별로 도로대장총괄 RDID prefix(19자) 일치 행 조회.
 */
export async function getRoadLedgerFacilityFilteredLists(params: {
  rdid?: string;
  activeFacilityGroups?: string[];
}): Promise<{ sections: RoadLedgerFacilitySection[]; error?: string }> {
  const rdid = String(params?.rdid ?? '').trim();
  const rawGroups = Array.isArray(params?.activeFacilityGroups) ? params.activeFacilityGroups : [];
  const activeFacilityGroups = rawGroups.filter((g) => FACILITY_GROUP_KEYS.has(String(g)));

  if (activeFacilityGroups.length === 0) {
    return { sections: [] };
  }
  if (!rdid || rdid.length < ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN) {
    return {
      sections: [],
      error: `도로대장 RDID가 필요합니다(최소 ${ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN}자, 구간번호까지 포함).`,
    };
  }

  const existingDefineIds = await getRoadLedgerExistingDefineLayerIdSet();
  let fetchTableRows: (defineTableName: string) => Promise<{
    rows: Record<string, unknown>[];
    total: number;
    error?: string;
  }>;
  let defineMap: Map<string, DefineLayerRowLite>;
  try {
    const created = await createRoadLedgerFacilityTableFetcher(rdid);
    fetchTableRows = created.fetchTableRows;
    defineMap = created.defineMap;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { sections: [], error: msg };
  }

  const sections: RoadLedgerFacilitySection[] = [];

  for (const groupKey of activeFacilityGroups as RoadLedgerDocButtonKey[]) {
    const layerNames = (ROAD_LEDGER_DOC_LAYERS[groupKey] ?? []).filter((dn) =>
      existingDefineIds.has(String(dn ?? '').trim().toLowerCase())
    );

    const tables = (
      await Promise.all(
        layerNames.map(async (defineTableName) => {
          const dn = String(defineTableName ?? '').trim().toLowerCase();
          if (!dn) return null;
          const def = defineMap.get(dn);
          const title = String(def?.define_table_kor_name ?? '').trim() || dn;
          const { rows, total, error } = await fetchTableRows(dn);
          const block: RoadLedgerFacilityTableBlock = {
            defineTableName: dn,
            title,
            rows,
            total,
            ...(error ? { error } : {}),
          };
          return block;
        })
      )
    )
      .filter((t): t is RoadLedgerFacilityTableBlock => t != null)
      /** 0건이면서 조회 오류도 없는 테이블은 목록에서 제외 */
      .filter((t) => (t.total ?? 0) > 0 || Boolean(t.error));

    if (tables.length > 0) {
      sections.push({ groupKey, tables });
    }
  }

  return { sections };
}

/**
 * 주요시설~기타시설: 현재 RDID(19자 prefix)에 해당하는 하위 테이블 행 수 합계(버튼 괄호 표시용).
 */
export async function getRoadLedgerFacilityGroupDataCounts(params: {
  rdid?: string;
}): Promise<{ counts: Partial<Record<RoadLedgerDocButtonKey, number>>; error?: string }> {
  const rdid = String(params?.rdid ?? '').trim();
  if (!rdid || rdid.length < ROAD_LEDGER_RDID_MIN_LEN_FOR_FACILITY_JOIN) {
    return { counts: {} };
  }

  try {
    const existingDefineIds = await getRoadLedgerExistingDefineLayerIdSet();
    const { fetchTableCount } = await createRoadLedgerFacilityTableFetcher(rdid);
    const counts: Partial<Record<RoadLedgerDocButtonKey, number>> = {};
    for (const groupKey of ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT) {
      counts[groupKey] = 0;
    }

    const jobs: { groupKey: RoadLedgerDocButtonKey; dn: string }[] = [];
    for (const groupKey of ROAD_LEDGER_DOC_LABELS_WITH_LAYER_COUNT) {
      for (const raw of ROAD_LEDGER_DOC_LAYERS[groupKey] ?? []) {
        const dn = String(raw ?? '').trim().toLowerCase();
        if (dn && existingDefineIds.has(dn)) jobs.push({ groupKey, dn });
      }
    }

    const parts = await mapLimit(jobs, FACILITY_COUNT_CONCURRENCY, (job) => fetchTableCount(job.dn));
    jobs.forEach((job, i) => {
      const p = parts[i];
      if (p && !p.error) counts[job.groupKey] = (counts[job.groupKey] ?? 0) + p.total;
    });

    return { counts };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { counts: {}, error: msg };
  }
}
