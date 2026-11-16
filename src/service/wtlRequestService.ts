/**
 * 단수·누수 탐색 케이스 — 수정요청 저장, su 실행, 연결·절단 거리 갱신
 * 송수경로는 이력·탐색요청 대상이 아니다.
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import { getSessionUsrId } from '@/lib/auth/guard';

export type WtlTraceFeature = '단수' | '누수';
export type WtlTraceEditKind = '연결' | '제수변절단' | '탐색케이스';

const CONNECT_FLOOR_M = 1.5;
const VALVE_FLOOR_M = 2.5;
const CONNECT_CAP_M = 30;
const VALVE_CAP_M = 12;
const MIN_SAMPLES = 3;

const FEATURES = new Set<WtlTraceFeature>(['단수', '누수']);
const KINDS = new Set<WtlTraceEditKind>(['연결', '제수변절단', '탐색케이스']);

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function isWtlTraceExecutor(usrId: string | null | undefined): boolean {
  return asStr(usrId).toLowerCase() === 'su';
}

let ensureTablesDone = false;

/** DDL(IF NOT EXISTS)은 프로세스당 1회만 실행. 실패하면 다음 호출에서 재시도 */
async function ensureTables(): Promise<void> {
  if (ensureTablesDone) return;
  await ensureTablesRun();
  ensureTablesDone = true;
}

async function ensureTablesRun(): Promise<void> {
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS layer`));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS layer.wtl_request (
        request_id serial PRIMARY KEY,
        feature text NOT NULL,
        status text NOT NULL,
        memo text,
        request_user text,
        request_date timestamptz NOT NULL DEFAULT now(),
        execute_user text,
        execute_date timestamptz
      )
    `)
  );
  await db.execute(sql.raw(`ALTER TABLE layer.wtl_request ADD COLUMN IF NOT EXISTS origin_x double precision`));
  await db.execute(sql.raw(`ALTER TABLE layer.wtl_request ADD COLUMN IF NOT EXISTS origin_y double precision`));
  await db.execute(sql.raw(`ALTER TABLE layer.wtl_request ADD COLUMN IF NOT EXISTS origin_key text`));
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS layer.wtl_request_item (
        item_id serial PRIMARY KEY,
        request_id integer NOT NULL REFERENCES layer.wtl_request(request_id),
        asset_kind text,
        src_table text,
        ftr_idn text,
        edit_kind text NOT NULL,
        gap_m double precision,
        offset_m double precision,
        rule_code text
      )
    `)
  );
  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS layer.wtl_trace_criterion (
        criterion_id serial PRIMARY KEY,
        kind text NOT NULL UNIQUE,
        threshold_m double precision,
        sample_count integer NOT NULL DEFAULT 0,
        update_date timestamptz
      )
    `)
  );
}

function percentile80(values: number[]): number | null {
  const sorted = values.filter((n) => n > 0).sort((a, b) => a - b);
  if (sorted.length < MIN_SAMPLES) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.8 * sorted.length) - 1));
  return sorted[index] ?? null;
}

let traceCriterionCache: { connectM: number | null; valveM: number | null } | null = null;
let traceCriterionCacheAt = 0;
const TRACE_CRITERION_TTL_MS = 60_000;

export async function loadTraceCriterion(): Promise<{
  connectM: number | null;
  valveM: number | null;
}> {
  const now = Date.now();
  if (traceCriterionCache && now - traceCriterionCacheAt < TRACE_CRITERION_TTL_MS) {
    return traceCriterionCache;
  }
  try {
    await ensureTables();
    const res = await db.execute(
      sql.raw(
        `SELECT kind, threshold_m AS "thresholdM", sample_count AS "sampleCount"
         FROM layer.wtl_trace_criterion`
      )
    );
    let connectM: number | null = null;
    let valveM: number | null = null;
    for (const raw of res.rows ?? []) {
      const row = raw as { kind?: string; thresholdM?: unknown; sampleCount?: unknown };
      const count = Number(row.sampleCount);
      const threshold = num(row.thresholdM);
      if (!Number.isFinite(count) || count < MIN_SAMPLES || threshold == null) continue;
      if (row.kind === '연결') connectM = threshold;
      if (row.kind === '제수변절단') valveM = threshold;
    }
    traceCriterionCache = { connectM, valveM };
    traceCriterionCacheAt = now;
    return traceCriterionCache;
  } catch {
    return { connectM: null, valveM: null };
  }
}

async function measurePipeGap(ftrIdn: string): Promise<{
  srcTable: string;
  gapM: number;
} | { error: string }> {
  const id = esc(ftrIdn);
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    const found = await db.execute(
      sql.raw(
        `SELECT ogc_fid
         FROM layer."${table}"
         WHERE geom IS NOT NULL AND btrim(ftr_idn::text) = '${id}'
         LIMIT 3`
      )
    );
    const rows = found.rows ?? [];
    if (rows.length > 1) return { error: '같은 레이어에 시설고유번호가 여러 개입니다.' };
    if (rows.length === 0) continue;
    const gapRes = await db.execute(
      sql.raw(
        `WITH target AS (
           SELECT ogc_fid,
             CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END AS line
           FROM layer."${table}"
           WHERE geom IS NOT NULL AND btrim(ftr_idn::text) = '${id}'
           LIMIT 1
         )
         SELECT MIN(LEAST(
           ST_Distance(ST_StartPoint(t.line), ST_StartPoint(o.line)),
           ST_Distance(ST_StartPoint(t.line), ST_EndPoint(o.line)),
           ST_Distance(ST_EndPoint(t.line), ST_StartPoint(o.line)),
           ST_Distance(ST_EndPoint(t.line), ST_EndPoint(o.line))
         )) AS gap
         FROM target t
         JOIN LATERAL (
           SELECT CASE WHEN GeometryType(p.geom) LIKE 'MULTI%' THEN ST_GeometryN(p.geom, 1) ELSE p.geom END AS line
           FROM layer."${table}" p
           WHERE p.geom IS NOT NULL
             AND p.ogc_fid <> t.ogc_fid
             AND ST_DWithin(p.geom, t.line, 80)
         ) o ON true`
      )
    );
    const gap = num((gapRes.rows?.[0] as { gap?: unknown } | undefined)?.gap);
    if (gap == null) return { error: '주변 관로와 끝점 간격을 재지 못했습니다.' };
    return { srcTable: table, gapM: Math.round(gap * 100) / 100 };
  }
  return { error: '시설고유번호에 맞는 관로가 없습니다.' };
}

async function pipeUnionSql(): Promise<string | null> {
  const existing: string[] = []
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls']) {
    const chk = await db.execute(
      sql.raw(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'layer' AND table_name = '${table}' LIMIT 1`
      )
    )
    if ((chk.rows ?? []).length > 0) existing.push(table)
  }
  if (existing.length === 0) return null
  return existing.map((table) => `SELECT geom FROM layer."${table}" WHERE geom IS NOT NULL`).join(' UNION ALL ')
}

async function refreshCriterion(): Promise<void> {
  const res = await db.execute(
    sql.raw(
      `SELECT i.edit_kind AS "editKind", i.gap_m AS "gapM", i.offset_m AS "offsetM"
       FROM layer.wtl_request_item i
       JOIN layer.wtl_request r ON r.request_id = i.request_id
       WHERE r.status = '반영'
         AND i.edit_kind IN ('연결', '제수변절단')`
    )
  );
  const connect: number[] = [];
  const valve: number[] = [];
  for (const raw of res.rows ?? []) {
    const row = raw as { editKind?: string; gapM?: unknown; offsetM?: unknown };
    if (row.editKind === '연결') {
      const gap = num(row.gapM);
      if (gap != null) connect.push(gap);
    }
    if (row.editKind === '제수변절단') {
      const offset = num(row.offsetM);
      if (offset != null) valve.push(offset);
    }
  }
  const specs: { kind: WtlTraceEditKind; values: number[]; floor: number; cap: number }[] = [
    { kind: '연결', values: connect, floor: CONNECT_FLOOR_M, cap: CONNECT_CAP_M },
    { kind: '제수변절단', values: valve, floor: VALVE_FLOOR_M, cap: VALVE_CAP_M },
  ];
  for (const spec of specs) {
    const p80 = percentile80(spec.values);
    const threshold = p80 == null ? null : Math.min(spec.cap, Math.max(spec.floor, p80));
    const thresholdSql = threshold == null ? 'NULL' : String(threshold);
    await db.execute(
      sql.raw(
        `INSERT INTO layer.wtl_trace_criterion (kind, threshold_m, sample_count, update_date)
         VALUES ('${spec.kind}', ${thresholdSql}, ${spec.values.length}, now())
         ON CONFLICT (kind) DO UPDATE
           SET threshold_m = EXCLUDED.threshold_m,
               sample_count = EXCLUDED.sample_count,
               update_date = now()`
      )
    );
  }
  // 임계값이 바뀌었으므로 분석용 캐시 무효화
  traceCriterionCache = null;
}

async function measureGapBetween(
  a: { srcTable: string; ftrIdn: string },
  b: { srcTable: string; ftrIdn: string }
): Promise<number | null> {
  const sqlText = `
    WITH a AS (
      SELECT CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END AS line
      FROM layer."${esc(a.srcTable)}"
      WHERE geom IS NOT NULL AND btrim(ftr_idn::text) = '${esc(a.ftrIdn)}'
      LIMIT 1
    ),
    b AS (
      SELECT CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END AS line
      FROM layer."${esc(b.srcTable)}"
      WHERE geom IS NOT NULL AND btrim(ftr_idn::text) = '${esc(b.ftrIdn)}'
      LIMIT 1
    )
    SELECT LEAST(
      ST_Distance(ST_StartPoint(a.line), ST_StartPoint(b.line)),
      ST_Distance(ST_StartPoint(a.line), ST_EndPoint(b.line)),
      ST_Distance(ST_EndPoint(a.line), ST_StartPoint(b.line)),
      ST_Distance(ST_EndPoint(a.line), ST_EndPoint(b.line))
    ) AS gap
    FROM a, b`
  const res = await db.execute(sql.raw(sqlText))
  return num((res.rows?.[0] as { gap?: unknown } | undefined)?.gap)
}

async function measureValveNearPoint(x: number, y: number): Promise<{
  ftrIdn: string
  offsetM: number
} | { error: string }> {
  const union = await pipeUnionSql()
  if (!union) return { error: '관로 레이어가 없습니다.' }
  const res = await db.execute(
    sql.raw(
      `WITH srid AS (
         SELECT ST_SRID(geom) AS s FROM layer.wtl_valv_ps WHERE geom IS NOT NULL LIMIT 1
       ),
       click AS (
         SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857), s.s) AS g FROM srid s
       ),
       hit AS (
         SELECT v.geom, btrim(v.ftr_idn::text) AS "ftrIdn"
         FROM layer.wtl_valv_ps v, click c
         WHERE v.geom IS NOT NULL
           AND btrim(COALESCE(v.ftr_idn::text, '')) <> ''
           AND ST_DWithin(v.geom, c.g, 40)
         ORDER BY ST_Distance(ST_Centroid(v.geom), c.g)
         LIMIT 1
       )
       SELECT "ftrIdn",
         (
           SELECT MIN(ST_Distance(ST_Centroid(hit.geom), p.geom))
           FROM (${union}) p
           WHERE ST_DWithin(p.geom, hit.geom, 80)
         ) AS offset
       FROM hit`
    )
  )
  const row = res.rows?.[0] as { ftrIdn?: unknown; offset?: unknown } | undefined
  const ftrIdn = asStr(row?.ftrIdn)
  const offset = num(row?.offset)
  if (!ftrIdn) return { error: '그린 시작점 근처에 제수변이 없습니다.' }
  if (offset == null) return { error: '제수변과 관로 사이 거리를 재지 못했습니다.' }
  return { ftrIdn, offsetM: Math.round(offset * 100) / 100 }
}

type StrokePipe = { srcTable?: string; ftrIdn?: string }

function strokePipes(raw: unknown): { srcTable: string; ftrIdn: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { srcTable: string; ftrIdn: string }[] = []
  const seen = new Set<string>()
  for (const item of raw as StrokePipe[]) {
    const srcTable = asStr(item?.srcTable)
    const ftrIdn = asStr(item?.ftrIdn)
    if (!srcTable || !ftrIdn) continue
    if (srcTable !== 'wtl_pipe_lm' && srcTable !== 'wtl_sply_ls') continue
    const key = `${srcTable}:${ftrIdn}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ srcTable, ftrIdn })
  }
  return out
}

export type WtlTraceDrawPipe = {
  srcTable: string
  ftrIdn: string
  coords: [number, number][]
}

export type WtlTraceDrawValve = {
  ftrIdn: string
  x: number
  y: number
  ogcFid?: number
  lon?: number
  lat?: number
  diameter?: string
  address?: string
}

function finiteBox(params: { minX?: number; minY?: number; maxX?: number; maxY?: number }) {
  const minX = Number(params.minX)
  const minY = Number(params.minY)
  const maxX = Number(params.maxX)
  const maxY = Number(params.maxY)
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null
  return { minX, minY, maxX, maxY }
}

function lineCoords(raw: unknown): [number, number][] {
  const geom = typeof raw === 'string' ? (JSON.parse(raw) as { coordinates?: unknown }) : (raw as { coordinates?: unknown })
  const coords = geom?.coordinates
  if (!Array.isArray(coords)) return []
  return coords
    .map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null
      const x = Number(pair[0])
      const y = Number(pair[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return [x, y] as [number, number]
    })
    .filter((pair): pair is [number, number] => pair != null)
}

export async function listWtlTraceDrawContext(params: {
  minX?: number
  minY?: number
  maxX?: number
  maxY?: number
  /** 테이블별 관로 최대 개수(기본 400). 선 편집처럼 관망 연결이 필요하면 크게 */
  pipeLimit?: number
}): Promise<{ pipes: WtlTraceDrawPipe[]; valves: WtlTraceDrawValve[]; error?: string }> {
  const usrId = await getSessionUsrId()
  if (!usrId) return { pipes: [], valves: [], error: '로그인이 필요합니다.' }
  const box = finiteBox(params)
  if (!box) return { pipes: [], valves: [], error: '지도 범위를 읽지 못했습니다.' }
  const env = `${box.minX}, ${box.minY}, ${box.maxX}, ${box.maxY}`
  const pipeLimit = Math.min(Math.max(Math.trunc(Number(params.pipeLimit)) || 400, 1), 5000)
  const pipes: WtlTraceDrawPipe[] = []
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    const chk = await db.execute(
      sql.raw(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'layer' AND table_name = '${table}' LIMIT 1`
      )
    )
    if ((chk.rows ?? []).length === 0) continue
    const res = await db.execute(
      sql.raw(
        `WITH srid AS (
           SELECT ST_SRID(geom) AS s FROM layer."${table}" WHERE geom IS NOT NULL LIMIT 1
         )
         SELECT btrim(p.ftr_idn::text) AS "ftrIdn",
           ST_AsGeoJSON(ST_Transform(
             CASE WHEN GeometryType(p.geom) LIKE 'MULTI%' THEN ST_GeometryN(p.geom, 1) ELSE p.geom END,
             3857
           )) AS geom
         FROM layer."${table}" p, srid s
         WHERE p.geom IS NOT NULL
           AND btrim(COALESCE(p.ftr_idn::text, '')) <> ''
           AND ST_Intersects(
             p.geom,
             ST_Transform(ST_MakeEnvelope(${env}, 3857), s.s)
           )
         LIMIT ${pipeLimit}`
      )
    )
    for (const raw of res.rows ?? []) {
      const row = raw as { ftrIdn?: unknown; geom?: unknown }
      const ftrIdn = asStr(row.ftrIdn)
      const coords = lineCoords(row.geom)
      if (!ftrIdn || coords.length < 2) continue
      pipes.push({ srcTable: table, ftrIdn, coords })
    }
  }
  const valves: WtlTraceDrawValve[] = []
  const valvChk = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'layer' AND table_name = 'wtl_valv_ps' LIMIT 1`
    )
  )
  if ((valvChk.rows ?? []).length > 0) {
    const res = await db.execute(
      sql.raw(
        `WITH srid AS (
           SELECT ST_SRID(geom) AS s FROM layer.wtl_valv_ps WHERE geom IS NOT NULL LIMIT 1
         )
         SELECT v.ogc_fid AS "ogcFid",
           btrim(v.ftr_idn::text) AS "ftrIdn",
           v.std_dip AS "stdDip",
           v.hjd_cde AS hjd,
           ST_X(ST_Transform(ST_Centroid(v.geom), 3857)) AS x,
           ST_Y(ST_Transform(ST_Centroid(v.geom), 3857)) AS y,
           ST_X(ST_Transform(ST_Centroid(v.geom), 4326)) AS lon,
           ST_Y(ST_Transform(ST_Centroid(v.geom), 4326)) AS lat
         FROM layer.wtl_valv_ps v, srid s
         WHERE v.geom IS NOT NULL
           AND btrim(COALESCE(v.ftr_idn::text, '')) <> ''
           AND ST_Intersects(v.geom, ST_Transform(ST_MakeEnvelope(${env}, 3857), s.s))
         LIMIT 200`
      )
    )
    for (const raw of res.rows ?? []) {
      const row = raw as {
        ogcFid?: unknown
        ftrIdn?: unknown
        stdDip?: unknown
        hjd?: unknown
        x?: unknown
        y?: unknown
        lon?: unknown
        lat?: unknown
      }
      const ftrIdn = asStr(row.ftrIdn)
      const x = num(row.x)
      const y = num(row.y)
      const ogcFid = Number(row.ogcFid)
      if (!ftrIdn || x == null || y == null) continue
      const diameter = asStr(row.stdDip)
      valves.push({
        ftrIdn,
        x,
        y,
        ogcFid: Number.isFinite(ogcFid) ? ogcFid : undefined,
        lon: num(row.lon) ?? undefined,
        lat: num(row.lat) ?? undefined,
        diameter: diameter ? `${diameter}mm` : '—',
        address: asStr(row.hjd) || '—',
      })
    }
  }
  return { pipes, valves }
}

async function insertRequestItem(
  requestId: number,
  assetKind: string,
  srcTable: string,
  ftrIdn: string,
  editKind: string,
  gapM: number | null,
  offsetM: number | null,
  ruleCode: string
) {
  const gapSql = gapM == null ? 'NULL' : String(Math.round(gapM * 100) / 100)
  const offsetSql = offsetM == null ? 'NULL' : String(Math.round(offsetM * 100) / 100)
  await db.execute(
    sql.raw(
      `INSERT INTO layer.wtl_request_item
         (request_id, asset_kind, src_table, ftr_idn, edit_kind, gap_m, offset_m, rule_code)
       VALUES (
         ${requestId},
         '${esc(assetKind)}',
         '${esc(srcTable)}',
         '${esc(ftrIdn)}',
         '${esc(editKind)}',
         ${gapSql},
         ${offsetSql},
         '${esc(ruleCode)}'
       )`
    )
  )
}

const APPLY_M = 30
const LEAF_M = 1
const LEAF_VALVE_M = 3

async function attachLeafValves(requestId: number, pipes: StrokePipe[]): Promise<void> {
  const ends: { x: number; y: number }[] = []
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    const ids = pipes
      .filter((pipe) => pipe.srcTable === table && asStr(pipe.ftrIdn))
      .map((pipe) => `'${esc(asStr(pipe.ftrIdn))}'`)
    if (ids.length === 0) continue
    const res = await db.execute(
      sql.raw(
        `SELECT ST_X(ST_StartPoint(g)) AS sx, ST_Y(ST_StartPoint(g)) AS sy,
                ST_X(ST_EndPoint(g)) AS ex, ST_Y(ST_EndPoint(g)) AS ey
         FROM (
           SELECT ST_Transform(
             CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END,
             3857
           ) AS g
           FROM layer."${table}"
           WHERE geom IS NOT NULL AND btrim(ftr_idn::text) IN (${ids.join(',')})
         ) q`
      )
    )
    for (const raw of res.rows ?? []) {
      const row = raw as { sx?: unknown; sy?: unknown; ex?: unknown; ey?: unknown }
      const sx = num(row.sx)
      const sy = num(row.sy)
      const ex = num(row.ex)
      const ey = num(row.ey)
      if (sx != null && sy != null) ends.push({ x: sx, y: sy })
      if (ex != null && ey != null) ends.push({ x: ex, y: ey })
    }
  }
  const leaves = ends.filter((end) => ends.filter((other) => Math.hypot(end.x - other.x, end.y - other.y) <= LEAF_M).length === 1)
  const seen = new Set<string>()
  for (const leaf of leaves) {
    if (await touchesKeptPipe(leaf.x, leaf.y, pipes)) continue
    const res = await db.execute(
      sql.raw(
        `SELECT btrim(v.ftr_idn::text) AS "ftrIdn"
         FROM layer.wtl_valv_ps v
         WHERE v.geom IS NOT NULL
           AND btrim(COALESCE(v.ftr_idn::text, '')) <> ''
           AND ST_DWithin(
             ST_Transform(ST_Centroid(v.geom), 3857),
             ST_SetSRID(ST_MakePoint(${leaf.x}, ${leaf.y}), 3857),
             ${LEAF_VALVE_M}
           )
         ORDER BY ST_Distance(
           ST_Transform(ST_Centroid(v.geom), 3857),
           ST_SetSRID(ST_MakePoint(${leaf.x}, ${leaf.y}), 3857)
         )
         LIMIT 1`
      )
    )
    const ftrIdn = asStr((res.rows?.[0] as { ftrIdn?: unknown } | undefined)?.ftrIdn)
    if (!ftrIdn || seen.has(ftrIdn)) continue
    seen.add(ftrIdn)
    await insertRequestItem(requestId, '제수변', 'wtl_valv_ps', ftrIdn, '탐색케이스', null, null, '미정')
  }
}

async function touchesKeptPipe(x: number, y: number, pipes: StrokePipe[]): Promise<boolean> {
  const point = `ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857)`
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    const ids = pipes
      .filter((pipe) => pipe.srcTable === table && asStr(pipe.ftrIdn))
      .map((pipe) => `'${esc(asStr(pipe.ftrIdn))}'`)
    const skip = ids.length > 0 ? `AND btrim(p.ftr_idn::text) NOT IN (${ids.join(',')})` : ''
    const res = await db.execute(
      sql.raw(
        `SELECT 1
         FROM layer."${table}" p
         WHERE p.geom IS NOT NULL
           ${skip}
           AND (
             ST_DWithin(
               ST_Transform(ST_StartPoint(CASE WHEN GeometryType(p.geom) LIKE 'MULTI%' THEN ST_GeometryN(p.geom, 1) ELSE p.geom END), 3857),
               ${point},
               ${LEAF_M}
             )
             OR ST_DWithin(
               ST_Transform(ST_EndPoint(CASE WHEN GeometryType(p.geom) LIKE 'MULTI%' THEN ST_GeometryN(p.geom, 1) ELSE p.geom END), 3857),
               ${point},
               ${LEAF_M}
             )
           )
         LIMIT 1`
      )
    )
    if ((res.rows ?? []).length > 0) return true
  }
  return false
}

export type AppliedTraceAnswer = {
  pipes: [number, number][][]
  gates: { id: string; name: string; diameter: string; address: string; point: [number, number] }[]
}

async function loadCaseAnswer(requestId: number): Promise<AppliedTraceAnswer> {
  const items = await db.execute(
    sql.raw(
      `SELECT asset_kind AS "assetKind", src_table AS "srcTable", ftr_idn AS "ftrIdn"
       FROM layer.wtl_request_item
       WHERE request_id = ${requestId} AND edit_kind = '탐색케이스'
       ORDER BY item_id`
    )
  )
  const pipes: [number, number][][] = []
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    const ids = (items.rows ?? [])
      .map((raw) => raw as { assetKind?: unknown; srcTable?: unknown; ftrIdn?: unknown })
      .filter((row) => asStr(row.assetKind) === '관로' && asStr(row.srcTable) === table)
      .map((row) => `'${esc(asStr(row.ftrIdn))}'`)
    if (ids.length === 0) continue
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsGeoJSON(ST_Transform(
            CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END,
            4326
          )) AS geom
         FROM layer."${table}"
         WHERE geom IS NOT NULL AND btrim(ftr_idn::text) IN (${ids.join(',')})`
      )
    )
    for (const raw of res.rows ?? []) {
      const line = lineCoords((raw as { geom?: unknown }).geom)
      if (line.length >= 2) pipes.push(line)
    }
  }
  const valveIds = (items.rows ?? [])
    .map((raw) => raw as { assetKind?: unknown; ftrIdn?: unknown })
    .filter((row) => asStr(row.assetKind) === '제수변')
    .map((row) => `'${esc(asStr(row.ftrIdn))}'`)
  const gates: AppliedTraceAnswer['gates'] = []
  if (valveIds.length > 0) {
    const res = await db.execute(
      sql.raw(
        `SELECT t.ogc_fid AS "ogcFid", btrim(t.ftr_idn::text) AS "ftrIdn", t.std_dip AS "stdDip", t.hjd_cde AS hjd,
                ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
                ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
         FROM layer.wtl_valv_ps t
         WHERE t.geom IS NOT NULL AND btrim(t.ftr_idn::text) IN (${valveIds.join(',')})`
      )
    )
    for (const raw of res.rows ?? []) {
      const row = raw as { ogcFid?: unknown; ftrIdn?: unknown; stdDip?: unknown; hjd?: unknown; lon?: unknown; lat?: unknown }
      const ogcFid = Number(row.ogcFid)
      const lon = num(row.lon)
      const lat = num(row.lat)
      if (!Number.isFinite(ogcFid) || lon == null || lat == null) continue
      const diameter = asStr(row.stdDip)
      gates.push({
        id: `gate-${ogcFid}`,
        name: asStr(row.ftrIdn) || `GV-${ogcFid}`,
        diameter: diameter ? `${diameter}mm` : '—',
        address: asStr(row.hjd) || '—',
        point: [lon, lat],
      })
    }
  }
  return { pipes, gates }
}

export async function matchAppliedTraceAnswer(params: {
  feature?: string
  x?: number
  y?: number
  originKey?: string
}): Promise<AppliedTraceAnswer | null> {
  const feature = asStr(params.feature)
  if (!FEATURES.has(feature as WtlTraceFeature)) return null
  await ensureTables()
  const key = asStr(params.originKey)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(',')
  const x = Number(params.x)
  const y = Number(params.y)
  const keySql = key ? `r.origin_key = '${esc(key)}'` : 'false'
  const nearSql =
    feature === '누수' && Number.isFinite(x) && Number.isFinite(y)
      ? `ST_DWithin(
           ST_SetSRID(ST_MakePoint(r.origin_x, r.origin_y), 3857),
           ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857),
           ${APPLY_M}
         )`
      : 'false'
  const res = await db.execute(
    sql.raw(
      `SELECT r.request_id AS "requestId"
       FROM layer.wtl_request r
       WHERE r.feature = '${esc(feature)}'
         AND r.status = '규칙'
         AND (${keySql} OR ${nearSql})
       ORDER BY r.request_id DESC
       LIMIT 1`
    )
  )
  const requestId = Number((res.rows?.[0] as { requestId?: unknown } | undefined)?.requestId)
  if (!Number.isFinite(requestId)) return null
  const answer = await loadCaseAnswer(requestId)
  if (answer.pipes.length === 0) return null
  return answer
}

export function mergeAppliedTrace<G extends { id: string }>(
  pipes: [number, number][][],
  gates: G[],
  applied: AppliedTraceAnswer | null
): { pipes: [number, number][][]; gates: G[] } {
  if (!applied) return { pipes, gates }
  const seen = new Set(gates.map((gate) => gate.id))
  const extra = applied.gates.filter((gate) => !seen.has(gate.id)) as G[]
  return { pipes: [...pipes, ...applied.pipes], gates: [...gates, ...extra] }
}

export async function submitWtlTraceCase(params: {
  feature?: string
  editKind?: string
  pipes?: StrokePipe[]
  startX?: number
  startY?: number
  originX?: number
  originY?: number
  originKey?: string
  memo?: string
}): Promise<{ requestId?: number; pipeCount?: number; valveCount?: number; error?: string }> {
  const usrId = await getSessionUsrId()
  if (!usrId) return { error: '로그인이 필요합니다.' }
  const feature = asStr(params.feature) as WtlTraceFeature
  const editKind = asStr(params.editKind) as WtlTraceEditKind
  if (!FEATURES.has(feature)) return { error: '기능을 확인할 수 없습니다.' }
  if (!KINDS.has(editKind)) return { error: '연결 또는 제수변 절단을 선택하세요.' }

  await ensureTables()
  const pipes = strokePipes(params.pipes)
  if (pipes.length === 0) return { error: '관로를 따라 드래그하세요.' }

  if (editKind === '탐색케이스') {
    const originX = Number(params.originX)
    const originY = Number(params.originY)
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) return { error: '탐색 시작 지점이 없습니다.' }
    const memo = asStr(params.memo)
    const originKey = asStr(params.originKey)
    const inserted = await db.execute(
      sql.raw(
        `INSERT INTO layer.wtl_request
           (feature, status, memo, request_user, request_date, origin_x, origin_y, origin_key)
         VALUES (
           '${esc(feature)}', '수집', ${memo ? `'${esc(memo)}'` : 'NULL'}, '${esc(usrId)}', now(),
           ${originX}, ${originY}, ${originKey ? `'${esc(originKey)}'` : 'NULL'}
         )
         RETURNING request_id AS "requestId"`
      )
    )
    const requestId = Number((inserted.rows?.[0] as { requestId?: unknown } | undefined)?.requestId)
    if (!Number.isFinite(requestId)) return { error: '케이스를 저장하지 못했습니다.' }
    for (const pipe of pipes) {
      await insertRequestItem(requestId, '관로', pipe.srcTable, pipe.ftrIdn, editKind, null, null, '미정')
    }
    await attachLeafValves(requestId, pipes)
    return { requestId, pipeCount: pipes.length }
  }

  let valve: { ftrIdn: string; offsetM: number } | null = null
  if (editKind === '제수변절단') {
    const x = Number(params.startX)
    const y = Number(params.startY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: '제수변에서 드래그를 시작하세요.' }
    const measured = await measureValveNearPoint(x, y)
    if ('error' in measured) return { error: measured.error }
    valve = measured
  }

  const learned = await loadTraceCriterion()
  const ruleCode =
    editKind === '연결'
      ? `connect:${learned.connectM ?? CONNECT_FLOOR_M}`
      : `valve:${learned.valveM ?? VALVE_FLOOR_M}`
  const memo = asStr(params.memo)

  const inserted = await db.execute(
    sql.raw(
      `INSERT INTO layer.wtl_request (feature, status, memo, request_user, request_date)
       VALUES ('${esc(feature)}', '요청', ${memo ? `'${esc(memo)}'` : 'NULL'}, '${esc(usrId)}', now())
       RETURNING request_id AS "requestId"`
    )
  )
  const requestId = Number((inserted.rows?.[0] as { requestId?: unknown } | undefined)?.requestId)
  if (!Number.isFinite(requestId)) return { error: '수정요청을 저장하지 못했습니다.' }

  if (editKind === '연결') {
    for (let i = 0; i < pipes.length; i += 1) {
      const pipe = pipes[i]
      const next = pipes[i + 1]
      let gap: number | null = null
      if (next) gap = await measureGapBetween(pipe, next)
      else if (pipes.length === 1) {
        const measured = await measurePipeGap(pipe.ftrIdn)
        gap = 'error' in measured ? null : measured.gapM
      }
      await insertRequestItem(requestId, '관로', pipe.srcTable, pipe.ftrIdn, editKind, gap, null, ruleCode)
    }
  } else if (valve) {
    await insertRequestItem(requestId, '제수변', 'wtl_valv_ps', valve.ftrIdn, editKind, null, valve.offsetM, ruleCode)
    for (const pipe of pipes) {
      await insertRequestItem(requestId, '관로', pipe.srcTable, pipe.ftrIdn, editKind, null, null, ruleCode)
    }
  }
  return { requestId, pipeCount: pipes.length }
}

export type WtlTraceCaseRow = {
  requestId: number;
  feature: string;
  status: string;
  memo: string;
  ruleLabel: string;
  pipes: string;
  valves: string;
  requestUser: string;
};

export async function listWtlTraceCases(params: {
  feature?: string;
}): Promise<{ rows: WtlTraceCaseRow[]; connectM: number | null; valveM: number | null; canExecute: boolean; error?: string }> {
  const usrId = await getSessionUsrId();
  if (!usrId) return { rows: [], connectM: null, valveM: null, canExecute: false, error: '로그인이 필요합니다.' };
  const feature = asStr(params.feature);
  await ensureTables();
  const featureWhere = FEATURES.has(feature as WtlTraceFeature) ? `AND r.feature = '${esc(feature)}'` : '';
  const res = await db.execute(
    sql.raw(
      `SELECT r.request_id AS "requestId", r.feature, r.status, r.memo,
         r.request_user AS "requestUser",
         min(i.rule_code) AS "ruleLabel",
         string_agg(i.ftr_idn, ', ' ORDER BY i.item_id) FILTER (WHERE i.asset_kind = '관로') AS pipes,
         string_agg(i.ftr_idn, ', ' ORDER BY i.item_id) FILTER (WHERE i.asset_kind = '제수변') AS valves
       FROM layer.wtl_request r
       JOIN layer.wtl_request_item i ON i.request_id = r.request_id
       WHERE i.edit_kind = '탐색케이스'
         ${featureWhere}
       GROUP BY r.request_id, r.feature, r.status, r.memo, r.request_user
       ORDER BY r.request_id DESC
       LIMIT 12`
    )
  );
  const learned = await loadTraceCriterion();
  const rows: WtlTraceCaseRow[] = (res.rows ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      requestId: Number(row.requestId),
      feature: asStr(row.feature),
      status: asStr(row.status),
      memo: asStr(row.memo),
      ruleLabel: asStr(row.ruleLabel),
      pipes: asStr(row.pipes),
      valves: asStr(row.valves),
      requestUser: asStr(row.requestUser),
    };
  });
  return { rows, ...learned, canExecute: isWtlTraceExecutor(usrId) };
}

export async function assignWtlTraceCaseRule(params: {
  requestId?: number;
  ruleLabel?: string;
  newRule?: boolean;
}): Promise<{ ok?: boolean; error?: string }> {
  const usrId = await getSessionUsrId();
  if (!isWtlTraceExecutor(usrId)) return { error: '규칙 지정은 su 계정만 할 수 있습니다.' };
  const requestId = Number(params.requestId);
  if (!Number.isFinite(requestId)) return { error: '케이스를 선택하세요.' };
  const ruleLabel = params.newRule ? '새규칙' : asStr(params.ruleLabel);
  if (!ruleLabel) return { error: '규칙 이름을 입력하세요.' };
  await ensureTables();
  if (params.newRule) {
    const located = await db.execute(
      sql.raw(
        `SELECT origin_x AS x FROM layer.wtl_request WHERE request_id = ${requestId}`
      )
    );
    const originX = num((located.rows?.[0] as { x?: unknown } | undefined)?.x);
    if (originX == null) return { error: '지점이 없어 이 케이스로 규칙을 만들 수 없습니다.' };
    await db.execute(
      sql.raw(`UPDATE layer.wtl_request SET status = '규칙' WHERE request_id = ${requestId}`)
    );
  }
  const updated = await db.execute(
    sql.raw(
      `UPDATE layer.wtl_request_item
       SET rule_code = '${esc(ruleLabel)}'
       WHERE request_id = ${requestId} AND edit_kind = '탐색케이스'
       RETURNING item_id`
    )
  );
  if ((updated.rows ?? []).length === 0) return { error: '규칙을 지정할 케이스가 없습니다.' };
  return { ok: true };
}

function idSet(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).sort().join('|');
}

export async function previewWtlTraceCase(params: {
  requestId?: number;
}): Promise<{
  originX?: number;
  originY?: number;
  savedValves?: string;
  currentValves?: string;
  savedPipes?: [number, number][][];
  currentPipes?: [number, number][][];
  same?: boolean;
  error?: string;
}> {
  const usrId = await getSessionUsrId();
  if (!usrId) return { error: '로그인이 필요합니다.' };
  const requestId = Number(params.requestId);
  if (!Number.isFinite(requestId)) return { error: '케이스를 선택하세요.' };
  await ensureTables();
  const head = await db.execute(
    sql.raw(
      `SELECT feature, origin_x AS "originX", origin_y AS "originY", origin_key AS "originKey"
       FROM layer.wtl_request WHERE request_id = ${requestId}`
    )
  );
  const row = head.rows?.[0] as
    | { feature?: unknown; originX?: unknown; originY?: unknown; originKey?: unknown }
    | undefined;
  const originX = num(row?.originX);
  const originY = num(row?.originY);
  if (!row || originX == null || originY == null) return { error: '이 케이스에는 탐색 지점이 없습니다.' };
  const saved = await loadCaseAnswer(requestId);
  const feature = asStr(row.feature);
  const originKey = asStr(row.originKey);
  let currentPipes: [number, number][][] = [];
  let currentValves: string[] = [];
  if (feature === '누수') {
    const { analyzeWtlLeak } = await import('@/service/wtlLeakService');
    const current = await analyzeWtlLeak({ x: originX, y: originY, tolerance: 30, ignoreCaseRule: true });
    currentPipes = current.result?.pipes ?? [];
    currentValves = (current.result?.gates ?? []).map((gate) => gate.name);
  } else if (feature === '단수' && originKey) {
    const { analyzeWtlOutage } = await import('@/service/wtlOutageService');
    const current = await analyzeWtlOutage({ gateIds: originKey.split(','), ignoreCaseRule: true });
    currentPipes = current.result?.pipes ?? [];
    currentValves = (current.gates ?? []).map((gate) => gate.name);
  }
  const savedValves = saved.gates.map((gate) => gate.name);
  const same = idSet(savedValves) === idSet(currentValves) && saved.pipes.length === currentPipes.length;
  return {
    originX,
    originY,
    savedValves: savedValves.join(', '),
    currentValves: currentValves.join(', '),
    savedPipes: saved.pipes,
    currentPipes,
    same,
  };
}

export async function executeWtlTraceCase(params: {
  requestId?: number;
}): Promise<{ ok?: boolean; connectM?: number | null; valveM?: number | null; error?: string }> {
  const usrId = await getSessionUsrId();
  if (!isWtlTraceExecutor(usrId)) return { error: '실행은 su 계정만 할 수 있습니다.' };
  const requestId = Number(params.requestId);
  if (!Number.isFinite(requestId)) return { error: '요청을 선택하세요.' };
  await ensureTables();
  const updated = await db.execute(
    sql.raw(
      `UPDATE layer.wtl_request
       SET status = '반영', execute_user = '${esc(usrId!)}', execute_date = now()
       WHERE request_id = ${requestId} AND status = '요청'
       RETURNING request_id`
    )
  );
  if ((updated.rows ?? []).length === 0) return { error: '반영할 요청이 없습니다.' };
  await refreshCriterion();
  const learned = await loadTraceCriterion();
  return { ok: true, ...learned };
}
