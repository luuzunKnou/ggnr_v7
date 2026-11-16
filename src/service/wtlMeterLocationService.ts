/**
 * 계량기위치 — 계량기번호(met_num)로 위치 조회
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import { getEmdGeometry, getRiGeometry } from './devTestService';
import { getWtlSupplyBlockGeometry } from './wtlNetworkService';

export type WtlMeterByNumberDto = {
  input: string;
  meterNo: string;
  address: string;
  point: [number, number] | null;
  found: boolean;
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function parseLonLat(raw: unknown): [number, number] | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const g = value as { type?: string; coordinates?: unknown };
  const pair = (coords: unknown): [number, number] | null => {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  };
  if (g.type === 'Point') return pair(g.coordinates);
  if (g.type === 'MultiPoint' && Array.isArray(g.coordinates)) return pair(g.coordinates[0]);
  return null;
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = '${esc(schema)}' AND lower(table_name) = '${esc(table.toLowerCase())}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

/**
 * 계량기번호를 한 줄씩 받아 급수전계량기 위치(4326)를 조회한다.
 */
export async function locateMetersByNumbers(params: {
  numbers?: string[] | null;
}): Promise<{ rows: WtlMeterByNumberDto[] }> {
  const numbers = (params.numbers ?? [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  if (numbers.length === 0) return { rows: [] };
  if (!(await tableExists('layer', 'wtl_meta_ps'))) {
    return {
      rows: numbers.map((input) => ({
        input,
        meterNo: input,
        address: '',
        point: null,
        found: false,
      })),
    };
  }

  const unique = [...new Set(numbers)];
  const inList = unique.map((n) => `'${esc(n)}'`).join(',');
  const res = await db.execute(
    sql.raw(
      `SELECT DISTINCT ON (trim(t.met_num))
         trim(t.met_num) AS "meterNo",
         COALESCE(NULLIF(trim(t.hom_adr),''), '') AS address,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom
       FROM layer.wtl_meta_ps t
       WHERE t.geom IS NOT NULL
         AND NULLIF(trim(t.met_num),'') IS NOT NULL
         AND trim(t.met_num) IN (${inList})
       ORDER BY trim(t.met_num), t.ogc_fid`
    )
  );

  const byNo = new Map<string, { meterNo: string; address: string; point: [number, number] | null }>();
  for (const row of res.rows ?? []) {
    const r = row as Record<string, unknown>;
    const meterNo = asStr(r.meterNo);
    if (!meterNo) continue;
    byNo.set(meterNo, {
      meterNo,
      address: asStr(r.address),
      point: parseLonLat(r.geom),
    });
  }

  return {
    rows: numbers.map((input) => {
      const hit = byNo.get(input);
      if (!hit || !hit.point) {
        return {
          input,
          meterNo: input,
          address: hit?.address ?? '',
          point: null,
          found: false,
        };
      }
      return {
        input,
        meterNo: hit.meterNo,
        address: hit.address,
        point: hit.point,
        found: true,
      };
    }),
  };
}

export type WtlMeterSuggestDto = {
  meterNo: string;
  address: string;
};

/**
 * 계량기번호(met_num) 자동완성 — prefix ILIKE.
 */
export async function suggestMeterNumbers(params: {
  keyword?: string | null;
  limit?: number | null;
}): Promise<{ rows: WtlMeterSuggestDto[] }> {
  const keyword = String(params.keyword ?? '').trim();
  if (!keyword) return { rows: [] };
  if (!(await tableExists('layer', 'wtl_meta_ps'))) return { rows: [] };

  const lim = Math.min(50, Math.max(1, Number(params.limit) || 30));
  const res = await db.execute(
    sql.raw(
      `SELECT DISTINCT trim(t.met_num) AS "meterNo",
         COALESCE(NULLIF(trim(t.hom_adr),''), '') AS address
       FROM layer.wtl_meta_ps t
       WHERE NULLIF(trim(t.met_num),'') IS NOT NULL
         AND trim(t.met_num) ILIKE '${esc(keyword)}%'
       ORDER BY 1
       LIMIT ${lim}`
    )
  );

  const rows: WtlMeterSuggestDto[] = [];
  for (const row of res.rows ?? []) {
    const r = row as Record<string, unknown>;
    const meterNo = asStr(r.meterNo);
    if (!meterNo) continue;
    rows.push({ meterNo, address: asStr(r.address) });
  }
  return { rows };
}

export type WtlMeterAreaRowDto = {
  meterNo: string;
  address: string;
  point: [number, number] | null;
};

/**
 * 읍면동·리·급수블록 경계(5181)와 교차하는 급수전계량기 목록.
 * 리 > 읍면동 우선, 급수블록은 AND.
 */
export async function listMetersByArea(params: {
  emdCode?: string | null;
  riCode?: string | null;
  block?: string | null;
  limit?: number | null;
}): Promise<{ rows: WtlMeterAreaRowDto[]; error?: string }> {
  const emdCode = String(params.emdCode ?? '').trim();
  const riCode = String(params.riCode ?? '').trim();
  const block = String(params.block ?? '').trim();
  if (!emdCode && !riCode && !block) {
    return { rows: [], error: '읍면동·리·급수블록 중 하나 이상 선택하세요.' };
  }
  if (!(await tableExists('layer', 'wtl_meta_ps'))) {
    return { rows: [], error: '급수전계량기 테이블이 없습니다.' };
  }

  const wkts: string[] = [];
  if (riCode) {
    const geo = await getRiGeometry({ riCode });
    const w = asStr(geo.wkt);
    if (!w) return { rows: [], error: geo.error || '리 경계를 찾지 못했습니다.' };
    wkts.push(w);
  } else if (emdCode) {
    const geo = await getEmdGeometry({ emdCode });
    const w = asStr(geo.wkt);
    if (!w) return { rows: [], error: geo.error || '읍면동 경계를 찾지 못했습니다.' };
    wkts.push(w);
  }
  if (block) {
    const geo = await getWtlSupplyBlockGeometry({ block });
    const w = asStr(geo.wkt);
    if (!w) return { rows: [], error: geo.error || '급수블록 경계를 찾지 못했습니다.' };
    wkts.push(w);
  }
  if (wkts.length === 0) return { rows: [] };

  const lim = Math.min(5000, Math.max(1, Number(params.limit) || 3000));
  const sridRes = await db.execute(
    sql.raw(
      `SELECT COALESCE(ST_SRID(geom), 0)::int AS srid
       FROM layer.wtl_meta_ps
       WHERE geom IS NOT NULL
       LIMIT 1`
    )
  );
  const storedSrid = Number((sridRes.rows?.[0] as { srid?: number } | undefined)?.srid) || 0;
  const meterSrid = storedSrid > 0 ? storedSrid : 5181;
  const meterGeom = storedSrid > 0 ? 't.geom' : `ST_SetSRID(t.geom, ${meterSrid})`;
  let filterExpr = `ST_Transform(ST_GeomFromText('${esc(wkts[0] ?? '')}', 5181), ${meterSrid})`;
  for (let i = 1; i < wkts.length; i++) {
    filterExpr = `ST_Intersection(${filterExpr}, ST_Transform(ST_GeomFromText('${esc(wkts[i] ?? '')}', 5181), ${meterSrid}))`;
  }

  const res = await db.execute(
    sql.raw(
      `WITH flt AS (
         SELECT ${filterExpr} AS g
       )
       SELECT DISTINCT ON (trim(t.met_num))
         trim(t.met_num) AS "meterNo",
         COALESCE(NULLIF(trim(t.hom_adr),''), '') AS address,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(${meterGeom}), 4326))::json AS geom
       FROM layer.wtl_meta_ps t
       CROSS JOIN flt
       WHERE t.geom IS NOT NULL
         AND NULLIF(trim(t.met_num),'') IS NOT NULL
         AND ${meterGeom} && flt.g
         AND ST_Intersects(${meterGeom}, flt.g)
       ORDER BY trim(t.met_num), t.ogc_fid
       LIMIT ${lim}`
    )
  );

  const rows: WtlMeterAreaRowDto[] = [];
  for (const row of res.rows ?? []) {
    const r = row as Record<string, unknown>;
    const meterNo = asStr(r.meterNo);
    if (!meterNo) continue;
    rows.push({
      meterNo,
      address: asStr(r.address),
      point: parseLonLat(r.geom),
    });
  }
  return { rows };
}

export type WtlJijukParcelResolveDto = {
  index: number;
  pnu: string | null;
  geometry4326: Record<string, unknown> | null;
};

/**
 * 계량기 좌표(4326) 목록 → public_layer.jijuk 교차 필지의 PNU만 일괄 조회.
 * 도형은 내려받지 않고, 좌표 변환은 점 쪽에만 해서 지적 인덱스 조회를 쓴다.
 */
export async function resolveJijukParcelsByLonLat(params: {
  points?: Array<{ lon?: number; lat?: number } | null> | null;
}): Promise<{ rows: WtlJijukParcelResolveDto[] }> {
  const raw = params.points ?? [];
  const pts: Array<{ index: number; lon: number; lat: number }> = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const lon = Number(p?.lon);
    const lat = Number(p?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    pts.push({ index: i, lon, lat });
  }
  if (pts.length === 0) return { rows: [] };

  const jijukExists = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public_layer' AND lower(table_name) = 'jijuk'
       LIMIT 1`
    )
  );
  if ((jijukExists.rows?.length ?? 0) === 0) {
    return {
      rows: pts.map((p) => ({ index: p.index, pnu: null, geometry4326: null })),
    };
  }

  const sridRes = await db.execute(
    sql.raw(
      `SELECT COALESCE(ST_SRID(geom), 0)::int AS srid
       FROM public_layer.jijuk
       WHERE geom IS NOT NULL
       LIMIT 1`
    )
  );
  const storedSrid = Number((sridRes.rows?.[0] as { srid?: number } | undefined)?.srid) || 0;
  const jijukSrid = storedSrid > 0 ? storedSrid : 5181;
  const jijukGeom = storedSrid > 0 ? 'j.geom' : 'ST_SetSRID(j.geom, 5181)';

  const valuesSql = pts
    .map((p) => `(${p.index}::int, ${p.lon}::float8, ${p.lat}::float8)`)
    .join(',');

  try {
    const res = await db.execute(
      sql.raw(
        `WITH pts(idx, lon, lat) AS (VALUES ${valuesSql}),
         projected AS (
           SELECT idx, ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), ${jijukSrid}) AS g
           FROM pts
         )
         SELECT DISTINCT ON (p.idx)
           p.idx AS "index",
           NULLIF(trim(j.pnu::text), '') AS pnu
         FROM projected p
         JOIN public_layer.jijuk j
           ON ${jijukGeom} && p.g
          AND ST_Intersects(${jijukGeom}, p.g)
         WHERE j.geom IS NOT NULL
         ORDER BY p.idx, j.pnu`
      )
    );

    const byIndex = new Map<number, WtlJijukParcelResolveDto>();
    for (const row of res.rows ?? []) {
      const r = row as Record<string, unknown>;
      const index = Number(r.index);
      if (!Number.isFinite(index)) continue;
      const pnuRaw = asStr(r.pnu).replace(/\D/g, '').slice(0, 19);
      byIndex.set(index, {
        index,
        pnu: pnuRaw || null,
        geometry4326: null,
      });
    }

    return {
      rows: pts.map(
        (p) =>
          byIndex.get(p.index) ?? {
            index: p.index,
            pnu: null,
            geometry4326: null,
          }
      ),
    };
  } catch {
    return {
      rows: pts.map((p) => ({ index: p.index, pnu: null, geometry4326: null })),
    };
  }
}

/** 급수전 격자 구역 — 가로 420m × 세로 210m (EPSG:5181) */
const METER_GRID_W_M = 420;
const METER_GRID_H_M = 210;
const METER_GRID_SRID = 5181;
const METER_GRID_SCHEMA = 'layer';
const METER_GRID_META = 'wtl_meter_grid_meta';
const METER_GRID_CELL = 'wtl_meter_grid_cell';
const METER_GRID_CELL_IDX = 'wtl_meter_grid_cell_xy_idx';
const METER_GRID_MET_IDX = 'wtl_meter_grid_cell_met_idx';

async function indexExists(schema: string, indexName: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname = '${esc(schema)}'
         AND indexname = '${esc(indexName)}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

/** 테이블·머티리얼라이즈드 뷰 모두 */
async function relationExists(schema: string, name: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT to_regclass('${esc(schema)}.${esc(name)}') IS NOT NULL AS ok`
    )
  );
  return (res.rows?.[0] as { ok?: boolean } | undefined)?.ok === true;
}

/**
 * 급수전 격자 인덱스(뷰·메타) 제거.
 * wtl_meta_ps DROP … CASCADE 시 셀 뷰는 같이 사라지고, 메타는 여기서 정리한다.
 */
export async function dropWtlMeterGridArtifacts(): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.execute(
      sql.raw(
        `DROP MATERIALIZED VIEW IF EXISTS ${METER_GRID_SCHEMA}.${METER_GRID_CELL} CASCADE`
      )
    );
    await db.execute(
      sql.raw(`DROP TABLE IF EXISTS ${METER_GRID_SCHEMA}.${METER_GRID_CELL} CASCADE`)
    );
    await db.execute(
      sql.raw(`DROP TABLE IF EXISTS ${METER_GRID_SCHEMA}.${METER_GRID_META} CASCADE`)
    );
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : '격자 인덱스 삭제 실패',
    };
  }
}

type MeterGridOrigin = { originX: number; originY: number };

/**
 * sgg(또는 급수전 extent) 기준으로 격자 원점을 잡는다.
 */
async function resolveMeterGridOrigin(): Promise<MeterGridOrigin | null> {
  if (await tableExists('public_layer', 'sgg')) {
    try {
      const res = await db.execute(
        sql.raw(
          `SELECT
             floor(ST_XMin(e) / ${METER_GRID_W_M}) * ${METER_GRID_W_M} AS ox,
             floor(ST_YMin(e) / ${METER_GRID_H_M}) * ${METER_GRID_H_M} AS oy
           FROM (
             SELECT ST_Extent(
               ST_Transform(
                 ST_SetSRID(geom, COALESCE(NULLIF(ST_SRID(geom), 0), ${METER_GRID_SRID})),
                 ${METER_GRID_SRID}
               )
             ) AS e
             FROM public_layer.sgg
             WHERE geom IS NOT NULL
           ) t`
        )
      );
      const row = res.rows?.[0] as { ox?: number; oy?: number } | undefined;
      const ox = Number(row?.ox);
      const oy = Number(row?.oy);
      if (Number.isFinite(ox) && Number.isFinite(oy)) return { originX: ox, originY: oy };
    } catch {
      /* fall through */
    }
  }
  if (!(await tableExists('layer', 'wtl_meta_ps'))) return null;
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT
           floor(ST_XMin(e) / ${METER_GRID_W_M}) * ${METER_GRID_W_M} AS ox,
           floor(ST_YMin(e) / ${METER_GRID_H_M}) * ${METER_GRID_H_M} AS oy
         FROM (
           SELECT ST_Extent(
             ST_Transform(
               ST_SetSRID(geom, COALESCE(NULLIF(ST_SRID(geom), 0), ${METER_GRID_SRID})),
               ${METER_GRID_SRID}
             )
           ) AS e
           FROM layer.wtl_meta_ps
           WHERE geom IS NOT NULL
         ) t`
      )
    );
    const row = res.rows?.[0] as { ox?: number; oy?: number } | undefined;
    const ox = Number(row?.ox);
    const oy = Number(row?.oy);
    if (Number.isFinite(ox) && Number.isFinite(oy)) return { originX: ox, originY: oy };
  } catch {
    return null;
  }
  return null;
}

/**
 * 급수전 → 격자칸 매핑(머티리얼라이즈드 뷰)·인덱스 보장.
 * 셀 뷰는 wtl_meta_ps에 의존 → `DROP TABLE wtl_meta_ps CASCADE` 시 함께 삭제된다.
 */
export async function ensureWtlMeterGridCellIndex(): Promise<{
  ok: boolean;
  created: boolean;
  rowCount: number;
  error?: string;
}> {
  if (!(await tableExists('layer', 'wtl_meta_ps'))) {
    await dropWtlMeterGridArtifacts();
    return { ok: false, created: false, rowCount: 0, error: '급수전계량기 테이블이 없습니다.' };
  }

  const metaExists = await relationExists(METER_GRID_SCHEMA, METER_GRID_META);
  const cellExists = await relationExists(METER_GRID_SCHEMA, METER_GRID_CELL);
  const xyIdx = await indexExists(METER_GRID_SCHEMA, METER_GRID_CELL_IDX);
  const metIdx = await indexExists(METER_GRID_SCHEMA, METER_GRID_MET_IDX);

  if (metaExists && cellExists && xyIdx && metIdx) {
    try {
      const cnt = await db.execute(
        sql.raw(`SELECT count(*)::int AS n FROM ${METER_GRID_SCHEMA}.${METER_GRID_CELL}`)
      );
      const n = Number((cnt.rows?.[0] as { n?: number } | undefined)?.n) || 0;
      return { ok: true, created: false, rowCount: n };
    } catch (e) {
      return {
        ok: false,
        created: false,
        rowCount: 0,
        error: e instanceof Error ? e.message : '격자 인덱스 확인 실패',
      };
    }
  }

  const origin = await resolveMeterGridOrigin();
  if (!origin) {
    return { ok: false, created: false, rowCount: 0, error: '격자 원점을 계산하지 못했습니다.' };
  }

  try {
    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS ${METER_GRID_SCHEMA}.${METER_GRID_META} (
           id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
           origin_x float8 NOT NULL,
           origin_y float8 NOT NULL,
           cell_w float8 NOT NULL,
           cell_h float8 NOT NULL,
           srid int NOT NULL
         )`
      )
    );
    await db.execute(
      sql.raw(
        `INSERT INTO ${METER_GRID_SCHEMA}.${METER_GRID_META}
           (id, origin_x, origin_y, cell_w, cell_h, srid)
         VALUES (1, ${origin.originX}, ${origin.originY}, ${METER_GRID_W_M}, ${METER_GRID_H_M}, ${METER_GRID_SRID})
         ON CONFLICT (id) DO UPDATE SET
           origin_x = EXCLUDED.origin_x,
           origin_y = EXCLUDED.origin_y,
           cell_w = EXCLUDED.cell_w,
           cell_h = EXCLUDED.cell_h,
           srid = EXCLUDED.srid`
      )
    );

    // 구버전 일반 테이블 → 뷰로 교체. CASCADE로 wtl_meta_ps 삭제 시 셀도 제거되게 함.
    await db.execute(
      sql.raw(`DROP TABLE IF EXISTS ${METER_GRID_SCHEMA}.${METER_GRID_CELL} CASCADE`)
    );
    await db.execute(
      sql.raw(
        `DROP MATERIALIZED VIEW IF EXISTS ${METER_GRID_SCHEMA}.${METER_GRID_CELL} CASCADE`
      )
    );
    await db.execute(
      sql.raw(
        `CREATE MATERIALIZED VIEW ${METER_GRID_SCHEMA}.${METER_GRID_CELL} AS
         SELECT
           trim(t.met_num) AS met_num,
           floor(
             (ST_X(ST_Transform(
               ST_SetSRID(ST_Centroid(t.geom), COALESCE(NULLIF(ST_SRID(t.geom), 0), ${METER_GRID_SRID})),
               ${METER_GRID_SRID}
             )) - ${origin.originX}) / ${METER_GRID_W_M}
           )::int AS cell_x,
           floor(
             (ST_Y(ST_Transform(
               ST_SetSRID(ST_Centroid(t.geom), COALESCE(NULLIF(ST_SRID(t.geom), 0), ${METER_GRID_SRID})),
               ${METER_GRID_SRID}
             )) - ${origin.originY}) / ${METER_GRID_H_M}
           )::int AS cell_y
         FROM layer.wtl_meta_ps t
         WHERE t.geom IS NOT NULL
           AND NULLIF(trim(t.met_num), '') IS NOT NULL`
      )
    );
    await db.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS ${METER_GRID_CELL_IDX}
         ON ${METER_GRID_SCHEMA}.${METER_GRID_CELL} (cell_x, cell_y)`
      )
    );
    await db.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS ${METER_GRID_MET_IDX}
         ON ${METER_GRID_SCHEMA}.${METER_GRID_CELL} (met_num)`
      )
    );

    const cnt = await db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM ${METER_GRID_SCHEMA}.${METER_GRID_CELL}`)
    );
    const n = Number((cnt.rows?.[0] as { n?: number } | undefined)?.n) || 0;
    return { ok: true, created: true, rowCount: n };
  } catch (e) {
    return {
      ok: false,
      created: false,
      rowCount: 0,
      error: e instanceof Error ? e.message : '격자 인덱스 생성 실패',
    };
  }
}

export type WtlMeterGridZoneDto = {
  zoneId: string;
  label: string;
  cellX: number;
  cellY: number;
  rowIds: string[];
  /** EPSG:3857 [xmin,ymin,xmax,ymax] — 격자칸 envelope */
  extent3857: [number, number, number, number];
};

/**
 * 선택한 급수전 좌표를 420×210m 격자칸으로 묶어 구역을 만든다.
 * 조회 전 격자 인덱스(메타·셀 테이블) 존재를 확인하고 없으면 생성한다.
 */
export async function assignMetersToGridZones(params: {
  meters?: Array<{ id?: string; lon?: number; lat?: number } | null> | null;
}): Promise<{
  zones: WtlMeterGridZoneDto[];
  missedIds: string[];
  error?: string;
}> {
  const raw = params.meters ?? [];
  const meters: Array<{ id: string; lon: number; lat: number }> = [];
  for (const m of raw) {
    const id = asStr(m?.id);
    const lon = Number(m?.lon);
    const lat = Number(m?.lat);
    if (!id || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    meters.push({ id, lon, lat });
  }
  if (meters.length === 0) return { zones: [], missedIds: [] };

  const ensured = await ensureWtlMeterGridCellIndex();
  if (!ensured.ok) {
    return {
      zones: [],
      missedIds: meters.map((m) => m.id),
      error: ensured.error || '격자 인덱스를 준비하지 못했습니다.',
    };
  }

  let originX = 0;
  let originY = 0;
  let cellW = METER_GRID_W_M;
  let cellH = METER_GRID_H_M;
  try {
    const meta = await db.execute(
      sql.raw(
        `SELECT origin_x AS ox, origin_y AS oy, cell_w AS cw, cell_h AS ch
         FROM ${METER_GRID_SCHEMA}.${METER_GRID_META}
         WHERE id = 1
         LIMIT 1`
      )
    );
    const row = meta.rows?.[0] as
      | { ox?: number; oy?: number; cw?: number; ch?: number }
      | undefined;
    originX = Number(row?.ox);
    originY = Number(row?.oy);
    cellW = Number(row?.cw) || METER_GRID_W_M;
    cellH = Number(row?.ch) || METER_GRID_H_M;
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
      return {
        zones: [],
        missedIds: meters.map((m) => m.id),
        error: '격자 원점 메타가 없습니다.',
      };
    }
  } catch (e) {
    return {
      zones: [],
      missedIds: meters.map((m) => m.id),
      error: e instanceof Error ? e.message : '격자 메타 조회 실패',
    };
  }

  const valuesSql = meters
    .map(
      (m, i) =>
        `('${esc(m.id)}', ${m.lon}::float8, ${m.lat}::float8, ${i}::int)`
    )
    .join(',');

  try {
    const res = await db.execute(
      sql.raw(
        `WITH pts(id, lon, lat, ord) AS (VALUES ${valuesSql}),
         projected AS (
           SELECT
             pts.id,
             pts.ord,
             ST_Transform(ST_SetSRID(ST_MakePoint(pts.lon, pts.lat), 4326), ${METER_GRID_SRID}) AS g
           FROM pts
         ),
         cells AS (
           SELECT
             id,
             ord,
             floor((ST_X(g) - ${originX}) / ${cellW})::int AS cell_x,
             floor((ST_Y(g) - ${originY}) / ${cellH})::int AS cell_y
           FROM projected
         )
         SELECT
           c.cell_x AS "cellX",
           c.cell_y AS "cellY",
           array_agg(c.id ORDER BY c.ord) AS "rowIds",
           ST_XMin(ST_Transform(
             ST_SetSRID(
               ST_MakeEnvelope(
                 ${originX} + c.cell_x * ${cellW},
                 ${originY} + c.cell_y * ${cellH},
                 ${originX} + (c.cell_x + 1) * ${cellW},
                 ${originY} + (c.cell_y + 1) * ${cellH},
                 ${METER_GRID_SRID}
               ),
               ${METER_GRID_SRID}
             ),
             3857
           )) AS xmin,
           ST_YMin(ST_Transform(
             ST_SetSRID(
               ST_MakeEnvelope(
                 ${originX} + c.cell_x * ${cellW},
                 ${originY} + c.cell_y * ${cellH},
                 ${originX} + (c.cell_x + 1) * ${cellW},
                 ${originY} + (c.cell_y + 1) * ${cellH},
                 ${METER_GRID_SRID}
               ),
               ${METER_GRID_SRID}
             ),
             3857
           )) AS ymin,
           ST_XMax(ST_Transform(
             ST_SetSRID(
               ST_MakeEnvelope(
                 ${originX} + c.cell_x * ${cellW},
                 ${originY} + c.cell_y * ${cellH},
                 ${originX} + (c.cell_x + 1) * ${cellW},
                 ${originY} + (c.cell_y + 1) * ${cellH},
                 ${METER_GRID_SRID}
               ),
               ${METER_GRID_SRID}
             ),
             3857
           )) AS xmax,
           ST_YMax(ST_Transform(
             ST_SetSRID(
               ST_MakeEnvelope(
                 ${originX} + c.cell_x * ${cellW},
                 ${originY} + c.cell_y * ${cellH},
                 ${originX} + (c.cell_x + 1) * ${cellW},
                 ${originY} + (c.cell_y + 1) * ${cellH},
                 ${METER_GRID_SRID}
               ),
               ${METER_GRID_SRID}
             ),
             3857
           )) AS ymax
         FROM cells c
         GROUP BY c.cell_x, c.cell_y
         ORDER BY c.cell_y, c.cell_x`
      )
    );

    const parseRowIds = (raw: unknown): string[] => {
      if (Array.isArray(raw)) return raw.map((v) => asStr(v)).filter(Boolean);
      if (typeof raw === 'string') {
        const s = raw.trim();
        if (s.startsWith('{') && s.endsWith('}')) {
          return s
            .slice(1, -1)
            .split(',')
            .map((v) => asStr(v.replace(/^"|"$/g, '')))
            .filter(Boolean);
        }
      }
      return [];
    };

    const zones: WtlMeterGridZoneDto[] = [];
    const assigned = new Set<string>();
    let zoneIdx = 1;
    for (const row of res.rows ?? []) {
      const r = row as Record<string, unknown>;
      const cellX = Number(r.cellX);
      const cellY = Number(r.cellY);
      const xmin = Number(r.xmin);
      const ymin = Number(r.ymin);
      const xmax = Number(r.xmax);
      const ymax = Number(r.ymax);
      const rowIds = parseRowIds(r.rowIds);
      if (
        !rowIds.length ||
        ![cellX, cellY, xmin, ymin, xmax, ymax].every(Number.isFinite)
      ) {
        continue;
      }
      for (const id of rowIds) assigned.add(id);
      zones.push({
        zoneId: `zone-${zoneIdx}`,
        label: `구역${zoneIdx}`,
        cellX,
        cellY,
        rowIds,
        extent3857: [xmin, ymin, xmax, ymax],
      });
      zoneIdx += 1;
    }

    const missedIds = meters.map((m) => m.id).filter((id) => !assigned.has(id));
    return { zones, missedIds };
  } catch (e) {
    return {
      zones: [],
      missedIds: meters.map((m) => m.id),
      error: e instanceof Error ? e.message : '격자 구역 배정 실패',
    };
  }
}
