/**
 * 단수구역 — 제수변 잠금 후 관로 유수방향(도형 시작→끝)을 따라 하류 추적
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';

const GATE_FTR = 'SA200'; // 제수변
/** 제수변↔시드 관로 판정(레이어 SRID m) */
const SEED_PIPE_M = 30;
/** 추적 범위(제수변 주변 bbox pad, m) */
const TRACE_PAD_M = 2500;
const PIPE_MAX = 500;
const ZONE_BUFFER_M = 28;
const CUSTOMER_LIMIT = 800;

export type WtlOutageGateDto = {
  id: string;
  name: string;
  diameter: string;
  address: string;
  point: [number, number];
};

export type WtlOutageParcelDto = {
  id: string;
  jibun: string;
  jimok: string;
  area: string;
};

export type WtlOutageAddressDto = {
  id: string;
  road: string;
  jibun: string;
};

export type WtlOutageCustomerDto = {
  id: string;
  name: string;
  address: string;
  phone: string;
  meterNo: string;
};

export type WtlOutageResultDto = {
  gateId: string;
  ring: [number, number][];
  pipes: [number, number][][];
  parcels: WtlOutageParcelDto[];
  addresses: WtlOutageAddressDto[];
  customers: WtlOutageCustomerDto[];
};

type PipeTable = 'wtl_pipe_lm' | 'wtl_sply_ls';

type PipeRec = {
  key: string; // table:ogc_fid
  table: PipeTable;
  ogcFid: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  startKey: string;
  endKey: string;
  geom4326: unknown;
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function parseLonLat(raw: unknown): [number, number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { type?: string; coordinates?: unknown };
  if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return [Number(g.coordinates[0]), Number(g.coordinates[1])];
  }
  return null;
}

function parseLine(raw: unknown): [number, number][] | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { type?: string; coordinates?: unknown };
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    return (g.coordinates as number[][])
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    const first = (g.coordinates as number[][][])[0];
    if (!first) return null;
    return first
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
  }
  return null;
}

function parseRing(raw: unknown): [number, number][] {
  if (!raw || typeof raw !== 'object') return [];
  const g = raw as { type?: string; coordinates?: unknown };
  let ring: number[][] | null = null;
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    ring = (g.coordinates as number[][][])[0] ?? null;
  } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    ring = ((g.coordinates as number[][][][])[0] ?? [])[0] ?? null;
  }
  if (!ring) return [];
  return ring
    .filter((c) => Array.isArray(c) && c.length >= 2)
    .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
}

function gateIdOf(ogcFid: number): string {
  return `gate-${ogcFid}`;
}

function parseGateOgcFids(gateIds: string[]): number[] {
  const out: number[] = [];
  for (const raw of gateIds) {
    for (const part of String(raw).split(',')) {
      const id = part.trim();
      const m = /^gate-(\d+)$/.exec(id);
      if (m) out.push(Number(m[1]));
      else if (/^\d+$/.test(id)) out.push(Number(id));
    }
  }
  return [...new Set(out.filter((n) => Number.isFinite(n)))];
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

function mapGateRow(row: Record<string, unknown>): WtlOutageGateDto | null {
  const ogcFid = Number(row.ogcFid);
  if (!Number.isFinite(ogcFid)) return null;
  const point = parseLonLat(row.geom);
  if (!point) return null;
  const name = asStr(row.ftrIdn) || `GV-${ogcFid}`;
  const diameter = asStr(row.stdDip);
  return {
    id: gateIdOf(ogcFid),
    name,
    diameter: diameter ? `${diameter}mm` : '—',
    address: asStr(row.hjd) || '—',
    point,
  };
}

/** 끝점 스냅용 노드 키 (약 1m) */
function nodeKey(x: number, y: number): string {
  return `${Math.round(x)}_${Math.round(y)}`;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * 화면 범위(3857) 안 제수변 목록
 */
export async function listWtlOutageGates(params: {
  bbox?: number[] | null;
  limit?: number;
} = {}): Promise<{ rows: WtlOutageGateDto[] }> {
  if (!(await tableExists('layer', 'wtl_valv_ps'))) return { rows: [] };
  const limit = Math.min(Math.max(Number(params.limit) || 400, 1), 800);
  const wheres = [`t.geom IS NOT NULL`, `t.ftr_cde = '${GATE_FTR}'`];
  if (params.bbox && params.bbox.length === 4) {
    const [minX, minY, maxX, maxY] = params.bbox;
    wheres.push(
      `ST_Intersects(t.geom, ST_Transform(ST_MakeEnvelope(${minX},${minY},${maxX},${maxY},3857), ST_SRID(t.geom)))`
    );
  }
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS "ogcFid",
         t.ftr_idn AS "ftrIdn",
         t.std_dip AS "stdDip",
         t.hjd_cde AS hjd,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom
       FROM layer.wtl_valv_ps t
       WHERE ${wheres.join(' AND ')}
       ORDER BY t.ogc_fid
       LIMIT ${limit}`
    )
  );
  const rows: WtlOutageGateDto[] = [];
  for (const raw of res.rows ?? []) {
    const gate = mapGateRow(raw as Record<string, unknown>);
    if (gate) rows.push(gate);
  }
  return { rows };
}

/**
 * 지도 클릭(3857) 근처 제수변 1건
 */
export async function getWtlOutageGateAtPoint(params: {
  x: number;
  y: number;
  tolerance?: number;
}): Promise<{ row: WtlOutageGateDto | null }> {
  if (!(await tableExists('layer', 'wtl_valv_ps'))) return { row: null };
  const x = Number(params.x);
  const y = Number(params.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { row: null };
  const tol = Math.max(2, Number(params.tolerance) || 14);
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS "ogcFid",
         t.ftr_idn AS "ftrIdn",
         t.std_dip AS "stdDip",
         t.hjd_cde AS hjd,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom,
         ST_Distance(ST_Transform(t.geom, 3857), ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857)) AS dist
       FROM layer.wtl_valv_ps t
       WHERE t.geom IS NOT NULL
         AND t.ftr_cde = '${GATE_FTR}'
         AND ST_DWithin(
           ST_Transform(t.geom, 3857),
           ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857),
           ${tol}
         )
       ORDER BY dist
       LIMIT 1`
    )
  );
  const raw = res.rows?.[0] as Record<string, unknown> | undefined;
  if (!raw) return { row: null };
  return { row: mapGateRow(raw) };
}

async function loadPipesInBbox(
  table: PipeTable,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): Promise<PipeRec[]> {
  if (!(await tableExists('layer', table))) return [];
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS id,
         ST_X(ST_StartPoint(line)) AS sx,
         ST_Y(ST_StartPoint(line)) AS sy,
         ST_X(ST_EndPoint(line)) AS ex,
         ST_Y(ST_EndPoint(line)) AS ey,
         ST_AsGeoJSON(ST_Transform(line, 4326))::json AS geom
       FROM (
         SELECT
           ogc_fid,
           CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END AS line
         FROM layer."${table}"
         WHERE geom IS NOT NULL
           AND ST_Intersects(
             geom,
             ST_MakeEnvelope(${minX}, ${minY}, ${maxX}, ${maxY}, ST_SRID(geom))
           )
       ) t
       WHERE GeometryType(t.line) IN ('LINESTRING', 'MULTILINESTRING')
          OR GeometryType(t.line) LIKE '%LINE%'
       LIMIT 8000`
    )
  );
  const out: PipeRec[] = [];
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const ogcFid = Number(r.id);
    const sx = Number(r.sx);
    const sy = Number(r.sy);
    const ex = Number(r.ex);
    const ey = Number(r.ey);
    if (![ogcFid, sx, sy, ex, ey].every((n) => Number.isFinite(n))) continue;
    out.push({
      key: `${table}:${ogcFid}`,
      table,
      ogcFid,
      sx,
      sy,
      ex,
      ey,
      startKey: nodeKey(sx, sy),
      endKey: nodeKey(ex, ey),
      geom4326: r.geom,
    });
  }
  return out;
}

/**
 * 유수방향 = 관로 도형 시작→끝.
 * 잠긴 제수변 근처 관로를 시드로 잡고, 끝점(하류)에서
 * «시작점이 이 노드인 관로»만 따라가며 단수 관로를 모은다.
 * 다른 잠금 제수변 끝점에서는 더 이상 진행하지 않는다.
 */
function traceDownstreamPipes(
  pipes: PipeRec[],
  gateXy: { x: number; y: number }[]
): PipeRec[] {
  const byKey = new Map(pipes.map((p) => [p.key, p]));
  /** 유수방향: 시작 노드 → 나가는 관로 */
  const outFromStart = new Map<string, PipeRec[]>();

  for (const p of pipes) {
    const list = outFromStart.get(p.startKey);
    if (list) list.push(p);
    else outFromStart.set(p.startKey, [p]);
  }

  const seedDist2 = SEED_PIPE_M * SEED_PIPE_M;
  const visited = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];

  const enqueueNode = (k: string) => {
    if (!k || queued.has(k)) return;
    queued.add(k);
    queue.push(k);
  };

  for (const g of gateXy) {
    const near = pipes
      .map((p) => {
        const dStart = dist2(g.x, g.y, p.sx, p.sy);
        const dEnd = dist2(g.x, g.y, p.ex, p.ey);
        const mx = (p.sx + p.ex) / 2;
        const my = (p.sy + p.ey) / 2;
        const dMid = dist2(g.x, g.y, mx, my);
        return { pipe: p, dStart, dEnd, dLine: Math.min(dStart, dEnd, dMid) };
      })
      .filter((row) => row.dLine <= seedDist2)
      .sort((a, b) => a.dLine - b.dLine)
      .slice(0, 12);

    for (const row of near) {
      if (visited.has(row.pipe.key)) continue;
      visited.add(row.pipe.key);
      // 하류 = 도형 끝점 방향 → 끝 노드에서 «시작=이 노드»인 다음 관로로 이어감
      enqueueNode(row.pipe.endKey);
    }
  }

  while (queue.length > 0 && visited.size < PIPE_MAX) {
    const node = queue.shift()!;
    for (const p of outFromStart.get(node) ?? []) {
      if (visited.has(p.key)) continue;
      visited.add(p.key);
      enqueueNode(p.endKey);
    }
  }

  return [...visited].map((k) => byKey.get(k)!).filter(Boolean);
}

/**
 * 잠긴 제수변 기준 단수 범위·관로·수용가 분석 (유수방향 라인 추적)
 */
export async function analyzeWtlOutage(params: {
  gateIds?: string[];
}): Promise<{ result: WtlOutageResultDto | null; gates: WtlOutageGateDto[]; error?: string }> {
  const gateFids = parseGateOgcFids(params.gateIds ?? []);
  if (gateFids.length === 0) {
    return { result: null, gates: [], error: '잠긴 제수변이 없습니다.' };
  }
  if (!(await tableExists('layer', 'wtl_valv_ps'))) {
    return { result: null, gates: [], error: '제수변 레이어가 없습니다.' };
  }

  const gateRes = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS "ogcFid",
         t.ftr_idn AS "ftrIdn",
         t.std_dip AS "stdDip",
         t.hjd_cde AS hjd,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom,
         ST_X(ST_Centroid(t.geom)) AS x,
         ST_Y(ST_Centroid(t.geom)) AS y
       FROM layer.wtl_valv_ps t
       WHERE t.ogc_fid IN (${gateFids.join(',')})`
    )
  );
  const gates: WtlOutageGateDto[] = [];
  const gateXy: { x: number; y: number }[] = [];
  for (const raw of gateRes.rows ?? []) {
    const row = raw as Record<string, unknown>;
    const g = mapGateRow(row);
    if (g) gates.push(g);
    const x = Number(row.x);
    const y = Number(row.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      gateXy.push({ x, y });
    }
  }
  if (gates.length === 0 || gateXy.length === 0) {
    return { result: null, gates: [], error: '제수변을 찾을 수 없습니다.' };
  }

  const xs = gateXy.map((g) => g.x);
  const ys = gateXy.map((g) => g.y);
  const minX = Math.min(...xs) - TRACE_PAD_M;
  const minY = Math.min(...ys) - TRACE_PAD_M;
  const maxX = Math.max(...xs) + TRACE_PAD_M;
  const maxY = Math.max(...ys) + TRACE_PAD_M;

  const pipeLm = await loadPipesInBbox('wtl_pipe_lm', minX, minY, maxX, maxY);
  const sply = await loadPipesInBbox('wtl_sply_ls', minX, minY, maxX, maxY);
  const allPipes = [...pipeLm, ...sply];

  const traced = traceDownstreamPipes(allPipes, gateXy);

  const pipes: [number, number][][] = [];
  const geomParts: string[] = [];
  const byTable = new Map<PipeTable, number[]>();
  for (const p of traced) {
    const line = parseLine(p.geom4326);
    if (line && line.length >= 2) pipes.push(line);
    const list = byTable.get(p.table) ?? [];
    list.push(p.ogcFid);
    byTable.set(p.table, list);
  }
  for (const [table, ids] of byTable) {
    if (ids.length === 0) continue;
    geomParts.push(
      `SELECT geom FROM layer."${table}" WHERE ogc_fid IN (${ids.join(',')}) AND geom IS NOT NULL`
    );
  }

  if (geomParts.length === 0) {
    geomParts.push(
      `SELECT ST_Buffer(ST_Transform(ST_Centroid(geom), 3857), ${ZONE_BUFFER_M * 2}) AS geom
       FROM layer.wtl_valv_ps WHERE ogc_fid IN (${gateFids.join(',')})`
    );
  }

  const zoneSql =
    geomParts[0]?.includes('ST_Buffer')
      ? `SELECT ST_AsGeoJSON(ST_Transform(ST_UnaryUnion(ST_Collect(geom)), 4326))::json AS geom FROM (
           ${geomParts.join('\nUNION ALL\n')}
         ) z`
      : `SELECT ST_AsGeoJSON(ST_Transform(
           ST_Buffer(ST_Transform(ST_UnaryUnion(ST_Collect(geom)), 3857), ${ZONE_BUFFER_M}),
           4326
         ))::json AS geom
         FROM (
           ${geomParts.join('\nUNION ALL\n')}
         ) z`;

  const zoneRes = await db.execute(sql.raw(zoneSql));
  const ring = parseRing((zoneRes.rows?.[0] as { geom?: unknown } | undefined)?.geom);

  const { customers, addresses } = await queryCustomersInRing(ring);

  const parcels: WtlOutageParcelDto[] = [];

  const result: WtlOutageResultDto = {
    gateId: gates.map((g) => g.id).join(','),
    ring,
    pipes,
    parcels,
    addresses,
    customers,
  };

  return { result, gates };
}

async function queryCustomersInRing(ring: [number, number][]): Promise<{
  customers: WtlOutageCustomerDto[];
  addresses: WtlOutageAddressDto[];
}> {
  const customers: WtlOutageCustomerDto[] = [];
  const addresses: WtlOutageAddressDto[] = [];
  if (ring.length < 3 || !(await tableExists('layer', 'wtl_meta_ps'))) {
    return { customers, addresses };
  }
  const metaRes = await db.execute(
    sql.raw(
      `WITH zone AS (
         SELECT ST_SetSRID(ST_GeomFromGeoJSON('${esc(
           JSON.stringify({ type: 'Polygon', coordinates: [ring] })
         )}'), 4326) AS g
       )
       SELECT
         t.ogc_fid AS id,
         COALESCE(NULLIF(trim(t.hom_nam),''), NULLIF(trim(t.met_num),''), t.ogc_fid::text) AS name,
         COALESCE(NULLIF(trim(t.hom_adr),''), '') AS address,
         COALESCE(NULLIF(trim(t.met_num),''), '') AS "meterNo",
         COALESCE(NULLIF(trim(t.hom_num),''), '') AS "homNum"
       FROM layer.wtl_meta_ps t, zone
       WHERE t.geom IS NOT NULL
         AND ST_Intersects(ST_Transform(t.geom, 4326), zone.g)
       LIMIT ${CUSTOMER_LIMIT}`
    )
  );
  const addrMap = new Map<string, WtlOutageAddressDto>();
  for (const row of metaRes.rows ?? []) {
    const r = row as Record<string, unknown>;
    const id = `c-${asStr(r.id)}`;
    const address = asStr(r.address);
    const meterNo = asStr(r.meterNo);
    customers.push({
      id,
      name: asStr(r.name) || meterNo || id,
      address: address || '—',
      phone: '',
      meterNo: meterNo || '—',
    });
    if (address) {
      addrMap.set(address, {
        id: `a-${addrMap.size + 1}`,
        road: address,
        jibun: asStr(r.homNum) || '—',
      });
    }
  }
  addresses.push(...addrMap.values());
  return { customers, addresses };
}

/**
 * 도형편집 후 단수 면(4326 ring) 기준 수용가·주소 재조회
 */
export async function refreshWtlOutageZone(params: {
  ring?: [number, number][];
}): Promise<{
  customers: WtlOutageCustomerDto[];
  addresses: WtlOutageAddressDto[];
  error?: string;
}> {
  const ring = (params.ring ?? []).filter(
    (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
  ) as [number, number][];
  if (ring.length < 3) {
    return { customers: [], addresses: [], error: '단수 구역 도형이 없습니다.' };
  }
  // 닫힌 링 보장
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  return queryCustomersInRing(ring);
}
