/**
 * 누수분석 — 관망 스냅 위치에서 격리에 필요한 제수변(SA200) 탐색
 * v6 ValveIsolationSearchService 핵심(관 위 부착·양방향 추적·반대편 봉인·강조 클립) 이식
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import { loadTraceCriterion, matchAppliedTraceAnswer, mergeAppliedTrace } from '@/service/wtlRequestService';

const GATE_FTR = 'SA200';
const SNAP_TOL_M = 25;
/**
 * 탐색 한도(한 방향).
 * - padM: 관로·제수변을 불러올 반경(탐색 한도보다 넉넉히)
 * - pipeMax: 테이블별 관로 로드 상한(가까운 순)
 * - maxHop: 관 건너뛰기 상한
 */
export const WTL_LEAK_SEARCH = { searchM: 1500, padM: 2000, pipeMax: 5000, maxHop: 40 } as const;
/** @deprecated WTL_LEAK_SEARCH 사용. 기존 import 호환 */
export const WTL_LEAK_SEARCH_LEVELS = { 1500: WTL_LEAK_SEARCH } as const;
const VALVE_MAX = 80;

/** v6 정합 — 절점 그리드·관 연결 */
const JOIN_TOL_M = 1.0;
/** 제수변↔관로 선분 부착 */
const VALVE_TOL_M = 3.0;
/** 끝점·접속점 제수변 판정 */
const JUNCTION_VALVE_TOL_M = 2.5;
/** 관로 선 위에 있다고 볼 거리. v6와 같음 */
const ENDPOINT_SEAL_M = 0.15;
/** 짧은 연결관·소프트 게이트 반경. v6 junctionClusterTol */
const JUNCTION_CLUSTER_TOL_M = 5;
/** 끝점에서 이어지는 긴 본선으로 볼 길이 */
const SOFT_MAJOR_SPUR_MIN_M = 50;
const TEE_PARALLEL_ABS_COS = Math.cos((25 * Math.PI) / 180);
const INDEX_EPS_M = 0.5;

export type WtlLeakSnapDto = {
  x: number; // 3857 (지도)
  y: number;
  lon: number;
  lat: number;
  pipeId: number;
  /** 스냅된 관로 테이블. 없으면 상수관로 */
  pipeTable?: 'wtl_pipe_lm' | 'wtl_sply_ls';
  distance: number;
};

export type WtlLeakGateDto = {
  id: string;
  name: string;
  diameter: string;
  address: string;
  point: [number, number]; // lon,lat
};

export type WtlLeakResultDto = {
  snap: WtlLeakSnapDto;
  gates: WtlLeakGateDto[];
  pipes: [number, number][][]; // 격리 구간 관로 (4326)
  /** 탐색 거리·건너뛰기·관 로드 한도에 걸려 일부 방향의 제수변을 찾지 못했을 수 있음 */
  truncated?: boolean;
  /** 이번 탐색에 쓴 한 방향 거리 한도(m) */
  searchM?: number;
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

type PipeTable = 'wtl_pipe_lm' | 'wtl_sply_ls';

const PIPE_TABLES: PipeTable[] = ['wtl_pipe_lm', 'wtl_sply_ls'];

function pipeKey(table: PipeTable, ogcFid: number): string {
  return `${table}:${ogcFid}`;
}

async function existingPipeTables(): Promise<PipeTable[]> {
  const out: PipeTable[] = [];
  for (const table of PIPE_TABLES) {
    if (await tableExists('layer', table)) out.push(table);
  }
  return out;
}

function gateIdOf(ogcFid: number): string {
  return `gate-${ogcFid}`;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

/** 존재(true)만 캐시. false는 나중에 생길 수 있어 캐시하지 않음 */
const tableExistsCache = new Set<string>();

async function tableExists(schema: string, table: string): Promise<boolean> {
  const key = `${schema}.${table.toLowerCase()}`;
  if (tableExistsCache.has(key)) return true;
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = '${esc(schema)}' AND lower(table_name) = '${esc(table.toLowerCase())}'
       LIMIT 1`
    )
  );
  const exists = (res.rows?.length ?? 0) > 0;
  if (exists) tableExistsCache.add(key);
  return exists;
}

function parseLineCoords(raw: unknown): [number, number][] {
  if (!raw || typeof raw !== 'object') return [];
  const g = raw as { type?: string; coordinates?: unknown };
  const flatten = (coords: unknown): [number, number][] => {
    if (!Array.isArray(coords) || coords.length === 0) return [];
    if (typeof coords[0] === 'number') {
      const x = Number(coords[0]);
      const y = Number(coords[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? [[x, y]] : [];
    }
    const out: [number, number][] = [];
    for (const c of coords) out.push(...flatten(c));
    return out;
  };
  if (g.type === 'LineString' || g.type === 'MultiLineString') {
    return flatten(g.coordinates);
  }
  return flatten(g.coordinates);
}

function polylineLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    len += dist(a[0], a[1], b[0], b[1]);
  }
  return len;
}

function distPointSeg2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-12) return dist2(px, py, ax, ay);
  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return dist2(px, py, ax + abx * t, ay + aby * t);
}

function distPointPolyline(px: number, py: number, coords: [number, number][]): number {
  if (coords.length < 2) {
    const c0 = coords[0];
    return c0 ? dist(px, py, c0[0], c0[1]) : Number.POSITIVE_INFINITY;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const d = Math.sqrt(distPointSeg2(px, py, a[0], a[1], b[0], b[1]));
    if (d < best) best = d;
  }
  return best;
}

/** 점 → 폴리라인 length-index (누적 현 길이) */
function projectIndex(coords: [number, number][], px: number, py: number): number {
  if (coords.length < 2) return 0;
  let bestD = Number.POSITIVE_INFINITY;
  let bestIdx = 0;
  let walked = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const segLen = Math.sqrt(abx * abx + aby * aby);
    let t = 0;
    if (segLen > 1e-12) {
      t = ((px - a[0]) * abx + (py - a[1]) * aby) / (segLen * segLen);
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const cx = a[0] + abx * t;
    const cy = a[1] + aby * t;
    const d = dist2(px, py, cx, cy);
    if (d < bestD) {
      bestD = d;
      bestIdx = walked + segLen * t;
    }
    walked += segLen;
  }
  return bestIdx;
}

function pointAtMeter(coords: [number, number][], target: number): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0]!;
  let walked = 0;
  const t = Math.max(0, target);
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i]!;
    const p1 = coords[i + 1]!;
    const seg = dist(p0[0], p0[1], p1[0], p1[1]);
    if (walked + seg >= t || i === coords.length - 2) {
      const u = seg > 1e-12 ? (t - walked) / seg : 0;
      const tt = Math.max(0, Math.min(1, u));
      return [p0[0] + (p1[0] - p0[0]) * tt, p0[1] + (p1[1] - p0[1]) * tt];
    }
    walked += seg;
  }
  return coords[coords.length - 1]!;
}

function sliceByFraction(
  coords: [number, number][],
  fracFrom: number,
  fracTo: number
): [number, number][] {
  if (coords.length < 2) return [];
  let a = Math.min(fracFrom, fracTo);
  let b = Math.max(fracFrom, fracTo);
  if (a < 0) a = 0;
  if (b > 1) b = 1;
  if (b - a < 1e-9) return [];

  const total = polylineLength(coords);
  if (total <= 1e-9) return [coords[0]!, coords[coords.length - 1]!];
  const fromM = a * total;
  const toM = b * total;

  const out: [number, number][] = [pointAtMeter(coords, fromM)];
  let walked = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i + 1]!;
    const p0 = coords[i]!;
    const seg = dist(p0[0], p0[1], p1[0], p1[1]);
    const next = walked + seg;
    if (next > fromM + 1e-9 && walked < toM - 1e-9 && next <= toM + 1e-9) {
      out.push(p1);
    }
    walked = next;
  }
  const end = pointAtMeter(coords, toM);
  const last = out[out.length - 1]!;
  if (dist(last[0], last[1], end[0], end[1]) > 1e-6) out.push(end);
  return out.length >= 2 ? out : [pointAtMeter(coords, fromM), pointAtMeter(coords, toM)];
}

type PipeEdge = {
  id: string;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  coords: [number, number][];
  coords4326: [number, number][];
  length: number;
  startNode: number;
  endNode: number;
  valves: ValveOnPipe[];
};

type ValveOnPipe = {
  ogcFid: number;
  name: string;
  diameter: string;
  address: string;
  x: number;
  y: number;
  lon: number;
  lat: number;
  pipeId: string;
  index: number;
};

type GateRec = {
  ogcFid: number;
  name: string;
  diameter: string;
  address: string;
  x: number;
  y: number;
  lon: number;
  lat: number;
};

/**
 * 화면 bbox(3857) 안 제수변(SA200) — 누수분석 탭에서 SLD 축척과 무관하게 표시
 */
export async function listWtlSa200ValvesInView(params: {
  bbox?: number[] | null;
  limit?: number;
} = {}): Promise<{
  valves: { ogcFid: number; lon: number; lat: number; name: string }[];
}> {
  const valves: { ogcFid: number; lon: number; lat: number; name: string }[] = [];
  if (!params.bbox || params.bbox.length !== 4) return { valves };
  const [minX, minY, maxX, maxY] = params.bbox;
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return { valves };
  if (!(await tableExists('layer', 'wtl_valv_ps'))) return { valves };
  const limit = Math.min(Math.max(Number(params.limit) || 4000, 1), 8000);
  try {
    const res = await db.execute(
      sql.raw(
        `WITH srid AS (
           SELECT ST_SRID(geom) AS s FROM layer.wtl_valv_ps WHERE geom IS NOT NULL LIMIT 1
         )
         SELECT
           t.ogc_fid AS "ogcFid",
           t.ftr_idn AS "ftrIdn",
           ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
           ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
         FROM layer.wtl_valv_ps t, srid
         WHERE t.geom IS NOT NULL
           AND upper(t.ftr_cde) = '${GATE_FTR}'
           AND ST_Intersects(
             t.geom,
             ST_Transform(ST_MakeEnvelope(${minX},${minY},${maxX},${maxY},3857), srid.s)
           )
         LIMIT ${limit}`
      )
    );
    for (const raw of res.rows ?? []) {
      const r = raw as Record<string, unknown>;
      const ogcFid = Number(r.ogcFid);
      const lon = Number(r.lon);
      const lat = Number(r.lat);
      if (![ogcFid, lon, lat].every((n) => Number.isFinite(n))) continue;
      valves.push({
        ogcFid,
        lon,
        lat,
        name: String(ogcFid),
      });
    }
  } catch {
    /* skip */
  }
  return { valves };
}

/**
 * 지도 클릭(3857) → 가장 가까운 상수관로·급수관로 위 스냅점
 */
export async function snapWtlLeakAtPoint(params: {
  x: number;
  y: number;
  tolerance?: number;
}): Promise<{ snap: WtlLeakSnapDto | null; error?: string }> {
  const tables = await existingPipeTables();
  if (tables.length === 0) {
    return { snap: null, error: '관로 레이어가 없습니다.' };
  }
  const x = Number(params.x);
  const y = Number(params.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { snap: null, error: '좌표가 올바르지 않습니다.' };
  }
  const tol = Math.max(5, Number(params.tolerance) || SNAP_TOL_M);
  const parts = tables.map(
    (table) => `SELECT '${table}' AS src, p.ogc_fid AS id, ST_Distance(p.geom, c.g) AS dist, ST_ClosestPoint(p.geom, c.g) AS closest
       FROM layer.${table} p
       CROSS JOIN (
         SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857), s.s) AS g
         FROM (SELECT ST_SRID(geom) AS s FROM layer.${table} WHERE geom IS NOT NULL LIMIT 1) s
       ) c
       WHERE p.geom IS NOT NULL AND ST_DWithin(p.geom, c.g, ${tol})`
  );
  const res = await db.execute(
    sql.raw(
      `WITH cand AS (
         ${parts.join(' UNION ALL ')}
       )
       SELECT src, id, dist,
         ST_X(ST_Transform(closest, 3857)) AS x3857,
         ST_Y(ST_Transform(closest, 3857)) AS y3857,
         ST_X(ST_Transform(closest, 4326)) AS lon,
         ST_Y(ST_Transform(closest, 4326)) AS lat
       FROM cand
       ORDER BY dist
       LIMIT 1`
    )
  );

  const row = res.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) {
    return { snap: null, error: '근처 관로에 누수 위치를 지정할 수 없습니다. 관망을 클릭하세요.' };
  }
  const pipeId = Number(row.id);
  const pipeTable = row.src === 'wtl_sply_ls' ? 'wtl_sply_ls' : 'wtl_pipe_lm';
  const sx = Number(row.x3857);
  const sy = Number(row.y3857);
  const lon = Number(row.lon);
  const lat = Number(row.lat);
  const distance = Number(row.dist);
  if (![pipeId, sx, sy, lon, lat].every((n) => Number.isFinite(n))) {
    return { snap: null, error: '누수 위치를 읽지 못했습니다.' };
  }
  return {
    snap: {
      x: sx,
      y: sy,
      lon,
      lat,
      pipeId,
      pipeTable,
      distance: Number.isFinite(distance) ? distance : 0,
    },
  };
}

async function loadPipesNear(
  x3857: number,
  y3857: number,
  pad: number,
  ensure?: { table: PipeTable; ogcFid: number },
  pipeMax: number = WTL_LEAK_SEARCH.pipeMax
): Promise<PipeEdge[]> {
  const tables = await existingPipeTables();
  const out: PipeEdge[] = [];
  for (const table of tables) {
    const ensureSql =
      ensure?.table === table && Number.isFinite(ensure.ogcFid) ? ` OR p.ogc_fid = ${ensure.ogcFid}` : '';
  const res = await db.execute(
    sql.raw(
        `WITH srid AS (
           SELECT ST_SRID(geom) AS s FROM layer.${table} WHERE geom IS NOT NULL LIMIT 1
         ),
         click AS (
           SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${x3857}, ${y3857}), 3857), s.s) AS g FROM srid s
         )
         SELECT
         t.ogc_fid AS id,
         ST_X(ST_StartPoint(line)) AS sx,
         ST_Y(ST_StartPoint(line)) AS sy,
         ST_X(ST_EndPoint(line)) AS ex,
         ST_Y(ST_EndPoint(line)) AS ey,
           ST_AsGeoJSON(line)::json AS "geomNative",
         ST_AsGeoJSON(ST_Transform(line, 4326))::json AS geom
       FROM (
         SELECT
             p.ogc_fid,
             CASE WHEN GeometryType(p.geom) LIKE 'MULTI%' THEN ST_GeometryN(p.geom, 1) ELSE p.geom END AS line
           FROM layer.${table} p, click c
           WHERE p.geom IS NOT NULL
             AND (ST_DWithin(p.geom, c.g, ${pad})${ensureSql})
           ORDER BY ${
             ensure?.table === table && Number.isFinite(ensure.ogcFid)
               ? `CASE WHEN p.ogc_fid = ${ensure.ogcFid} THEN 0 ELSE 1 END, `
               : ''
           }ST_Distance(p.geom, c.g)
           LIMIT ${pipeMax}
       ) t`
    )
  );
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
      const ogcFid = Number(r.id);
    const sx = Number(r.sx);
    const sy = Number(r.sy);
    const ex = Number(r.ex);
    const ey = Number(r.ey);
      if (![ogcFid, sx, sy, ex, ey].every((n) => Number.isFinite(n))) continue;
      let coords = parseLineCoords(r.geomNative);
      if (coords.length < 2) coords = [
        [sx, sy],
        [ex, ey],
      ];
      let coords4326 = parseLineCoords(r.geom);
      if (coords4326.length < 2) coords4326 = coords;
      const length = polylineLength(coords);
    out.push({
        id: pipeKey(table, ogcFid),
      sx,
      sy,
      ex,
      ey,
        coords,
        coords4326,
        length: length > 0 ? length : dist(sx, sy, ex, ey),
        startNode: -1,
        endNode: -1,
        valves: [],
      });
    }
  }
  return out;
}

async function loadGatesNear(cx: number, cy: number, pad: number): Promise<GateRec[]> {
  if (!(await tableExists('layer', 'wtl_valv_ps'))) return [];
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS "ogcFid",
         t.ftr_idn AS "ftrIdn",
         t.std_dip AS "stdDip",
         t.hjd_cde AS hjd,
         ST_X(ST_Centroid(t.geom)) AS x,
         ST_Y(ST_Centroid(t.geom)) AS y,
         ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
         ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
       FROM layer.wtl_valv_ps t
       WHERE t.geom IS NOT NULL
         AND t.ftr_cde = '${GATE_FTR}'
         AND ST_DWithin(
           t.geom,
           ST_SetSRID(ST_MakePoint(${cx}, ${cy}), ST_SRID(t.geom)),
           ${pad}
         )
       ORDER BY ST_Distance(t.geom, ST_SetSRID(ST_MakePoint(${cx}, ${cy}), ST_SRID(t.geom)))
       LIMIT 2000`
    )
  );
  const out: GateRec[] = [];
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const ogcFid = Number(r.ogcFid);
    const x = Number(r.x);
    const y = Number(r.y);
    const lon = Number(r.lon);
    const lat = Number(r.lat);
    if (![ogcFid, x, y, lon, lat].every((n) => Number.isFinite(n))) continue;
    const diameter = asStr(r.stdDip);
    out.push({
      ogcFid,
      name: String(ogcFid),
      diameter: diameter ? `${diameter}mm` : '—',
      address: asStr(r.hjd) || '—',
      x,
      y,
      lon,
      lat,
    });
  }
  return out;
}

function joinNodeKey(x: number, y: number, joinM = JOIN_TOL_M): string {
  return `${Math.round(x / joinM)}_${Math.round(y / joinM)}`;
}

function assignEndpointNodes(pipes: PipeEdge[], joinM = JOIN_TOL_M): void {
  const keyToId = new Map<string, number>();
  let nextId = 0;
  for (const p of pipes) {
    const sk = joinNodeKey(p.sx, p.sy, joinM);
    const ek = joinNodeKey(p.ex, p.ey, joinM);
    if (!keyToId.has(sk)) keyToId.set(sk, nextId++);
    if (!keyToId.has(ek)) keyToId.set(ek, nextId++);
    p.startNode = keyToId.get(sk)!;
    p.endNode = keyToId.get(ek)!;
  }
}

function pipeGid(id: string): number {
  const n = Number(id.slice(id.lastIndexOf(':') + 1));
  return Number.isFinite(n) ? n : 0;
}

function attachValvesToPipes(pipes: PipeEdge[], gates: GateRec[], valveM = VALVE_TOL_M): ValveOnPipe[] {
  const ordered = [...pipes].sort((a, b) => pipeGid(a.id) - pipeGid(b.id));
  const valves: ValveOnPipe[] = [];
  for (const g of gates) {
    let best: PipeEdge | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestIndex = 0;
    for (const p of ordered) {
      const d = distPointPolyline(g.x, g.y, p.coords);
      if (d > valveM || d >= bestDist) continue;
      bestDist = d;
      best = p;
      bestIndex = projectIndex(p.coords, g.x, g.y);
    }
    if (!best) continue;
    // T자 접속점: 제수변이 한 관의 끝점이면서 다른 관(본관)의 중간 위에도 똑같이(동률) 놓여 있으면 본관에 붙인다.
    // 끝점 쪽(지관)에만 붙이면 본관 탐색이 이 제수변을 지나쳐 계속 나간다.
    // 본관에서 조금이라도 더 떨어져 있으면(예: 0.12m) 지관용 제수변으로 보고 그대로 둔다.
    const atEnd = (p: PipeEdge, idx: number) => idx <= INDEX_EPS_M || idx >= p.length - INDEX_EPS_M;
    if (bestDist <= ENDPOINT_SEAL_M && atEnd(best, bestIndex)) {
      for (const p of ordered) {
        if (p === best) continue;
        if (distPointPolyline(g.x, g.y, p.coords) > bestDist + OFF_LINE_NEAREST_TIE_M) continue;
        const idx = projectIndex(p.coords, g.x, g.y);
        if (atEnd(p, idx)) continue;
        best = p;
        bestIndex = idx;
        break;
      }
    }
    const v: ValveOnPipe = {
      ogcFid: g.ogcFid,
      name: g.name,
      diameter: g.diameter,
      address: g.address,
      x: g.x,
      y: g.y,
      lon: g.lon,
      lat: g.lat,
      pipeId: best.id,
      index: bestIndex,
    };
    best.valves.push(v);
    valves.push(v);
  }
  return valves;
}

/**
 * 관로 밖에 찍힌 제수변(어느 관로에서도 ENDPOINT_SEAL_M 초과) 중, OFF_LINE_NEIGHBOR_M 안에
 * 관로 위 제수변이 따로 있으면 탐색에서 뺀다. 관로 위 제수변이 그 자리를 대신하므로
 * 관로 밖 점을 허용오차(VALVE_TOL_M)로 관에 붙여 먼저 멈추지 않게 한다.
 * 옆에 관로 위 제수변이 없으면 그대로 둔다(기존 허용오차로 사용).
 */
const OFF_LINE_NEIGHBOR_M = JUNCTION_VALVE_TOL_M;

/** 관로 밖 제수변이 "가장 가까운 관로"로 볼 거리 차(동률) */
const OFF_LINE_NEAREST_TIE_M = 0.01;

function dropOffLineGatesWithOnLineNeighbor(gates: GateRec[], pipes: PipeEdge[]): GateRec[] {
  const near = (g: GateRec) => pipes.filter((p) => distPointPolyline(g.x, g.y, p.coords) <= VALVE_TOL_M);
  const onLineOf = (g: GateRec, list: PipeEdge[]) =>
    list.filter((p) => distPointPolyline(g.x, g.y, p.coords) <= ENDPOINT_SEAL_M);
  const nearPipes = gates.map(near);
  const onLine = gates.map((g, i) => onLineOf(g, nearPipes[i]!).length > 0);
  return gates.filter((g, i) => {
    if (onLine[i]) return true;
    const list = nearPipes[i]!;
    if (list.length === 0) return true;
    // 관로 밖 제수변이 붙을 관로(가장 가까운 관, 동률 포함)
    const ds = list.map((p) => distPointPolyline(g.x, g.y, p.coords));
    const minD = Math.min(...ds);
    const attachTo = new Set(list.filter((_, k) => ds[k]! <= minD + OFF_LINE_NEAREST_TIE_M).map((p) => p.id));
    // 바로 옆 관로 위 제수변이 "같은 관로" 위에 있을 때만 중복 표시로 보고 뺀다.
    // 다른 갈래 관 위 제수변이면 그 갈래용 제수변일 수 있어 그대로 둔다.
    return !gates.some(
      (o, j) =>
        j !== i &&
        onLine[j] &&
        dist(o.x, o.y, g.x, g.y) <= OFF_LINE_NEIGHBOR_M &&
        onLineOf(o, nearPipes[j]!).some((p) => attachTo.has(p.id))
    );
  });
}

function isValveAhead(
  v: ValveOnPipe,
  baseIndex: number,
  len: number,
  towardStart: boolean,
  hop: number
): boolean {
  if (hop > 0) {
    const enteredAtStart = baseIndex <= INDEX_EPS_M;
    const enteredAtEnd = baseIndex >= len - INDEX_EPS_M;
    if ((enteredAtStart || enteredAtEnd) && Math.abs(v.index - baseIndex) <= INDEX_EPS_M) {
      return true;
    }
  }
  if (towardStart) return v.index < baseIndex - 1e-9;
  return v.index > baseIndex + 1e-9;
}

function addExploredRange(
  ranges: Map<string, [number, number][]>,
  pipeId: string,
  fromIdx: number,
  toIdx: number
): void {
  const a = Math.min(fromIdx, toIdx);
  const b = Math.max(fromIdx, toIdx);
  if (b - a < 0.05) return;
  const list = ranges.get(pipeId);
  if (list) list.push([a, b]);
  else ranges.set(pipeId, [[a, b]]);
}

function mergeIntervals(ivs: [number, number][]): [number, number][] {
  if (ivs.length === 0) return [];
  const sorted = [...ivs].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur: [number, number] = [sorted[0]![0], sorted[0]![1]];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n[0] <= cur[1] + 0.05) cur[1] = Math.max(cur[1], n[1]);
    else {
      out.push(cur);
      cur = [n[0], n[1]];
    }
  }
  out.push(cur);
  return out;
}

/**
 * 스냅점 기준 관로를 양쪽으로 따라가며 경로별 첫 제수변 = 격리용 잠금 대상
 */
export async function analyzeWtlLeak(params: {
  x: number;
  y: number;
  tolerance?: number;
  ignoreCaseRule?: boolean;
  /** @deprecated 무시됨. 탐색 한도는 WTL_LEAK_SEARCH.searchM 고정 */
  searchM?: number;
}): Promise<{ result: WtlLeakResultDto | null; error?: string }> {
  const searchM = WTL_LEAK_SEARCH.searchM;
  const level = WTL_LEAK_SEARCH;
  const MAX_SEARCH_M = searchM;
  const MAX_HOP = level.maxHop;
  const snapped = await snapWtlLeakAtPoint(params);
  if (!snapped.snap) {
    return { result: null, error: snapped.error || '누수 위치 지정에 실패했습니다.' };
  }
  const snap = snapped.snap;

  const table: PipeTable = snap.pipeTable === 'wtl_sply_ls' ? 'wtl_sply_ls' : 'wtl_pipe_lm';
  const originRes = await db.execute(
    sql.raw(
      `SELECT
         ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(${snap.x}, ${snap.y}), 3857), ST_SRID(geom))) AS cx,
         ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(${snap.x}, ${snap.y}), 3857), ST_SRID(geom))) AS cy
       FROM layer.${table}
       WHERE geom IS NOT NULL
       LIMIT 1`
    )
  );
  const origin = originRes.rows?.[0] as { cx?: number; cy?: number } | undefined;
  const cx = Number(origin?.cx);
  const cy = Number(origin?.cy);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    return { result: null, error: '좌표계 변환에 실패했습니다.' };
  }

  const pipes = await loadPipesNear(snap.x, snap.y, level.padM, { table, ogcFid: snap.pipeId }, level.pipeMax);
  if (pipes.length === 0) {
    return { result: null, error: '주변 관로가 없습니다.' };
  }
  const learned = await loadTraceCriterion();
  const joinM = Math.max(JOIN_TOL_M, learned.connectM ?? 0);
  const valveM = Math.max(VALVE_TOL_M, learned.valveM ?? 0);
  const gates = dropOffLineGatesWithOnLineNeighbor(await loadGatesNear(cx, cy, level.padM), pipes);
  assignEndpointNodes(pipes, joinM);
  const valves = attachValvesToPipes(pipes, gates, valveM);

  const pipeById = new Map(pipes.map((p) => [p.id, p]));
  const nodeToPipes = new Map<number, PipeEdge[]>();
  for (const p of pipes) {
    const a = nodeToPipes.get(p.startNode);
    if (a) a.push(p);
    else nodeToPipes.set(p.startNode, [p]);
    const b = nodeToPipes.get(p.endNode);
    if (b) b.push(p);
    else nodeToPipes.set(p.endNode, [p]);
  }

  const seed = pipeById.get(pipeKey(table, snap.pipeId));
  if (!seed) {
    return { result: null, error: '지정한 관로를 찾지 못했습니다.' };
  }
  const leakIndex = projectIndex(seed.coords, cx, cy);

  const isolationGates = new Map<number, ValveOnPipe>();
  const exploredRanges = new Map<string, [number, number][]>();
  const visitedDirected = new Set<string>();
  const sealedPipeEntries = new Set<string>();
  let truncated = false;

  const acceptValve = (v: ValveOnPipe) => {
    if (isolationGates.size >= VALVE_MAX && !isolationGates.has(v.ogcFid)) return;
    isolationGates.set(v.ogcFid, v);
  };

  /**
   * 관 위 제수변에서 멈추면 그 관의 반대쪽 끝에서 다시 들어오지 않게 막는다(같은 제수변을 되짚는 중복 방지).
   * 단, 잠근 제수변과 반대쪽 끝 사이에 다른 제수변이 있으면 막지 않는다 —
   * 다른 경로(나란한 관·고리)로 반대쪽 끝에 닿으면 그 제수변이 먼저 막아야 하기 때문.
   * (탐색 순서에 따라 이 제수변이 빠지던 문제: 누수지점이 멀면 이쪽 끝에 먼저 닿음)
   */
  const sealFarSide = (pipe: PipeEdge, towardStart: boolean, valve: ValveOnPipe | null = null) => {
    if (valve && valve.pipeId === pipe.id) {
      const between = pipe.valves.some(
        (v) =>
          v.ogcFid !== valve.ogcFid &&
          (towardStart ? v.index < valve.index - INDEX_EPS_M : v.index > valve.index + INDEX_EPS_M)
      );
      if (between) return;
    }
    const farNode = towardStart ? pipe.startNode : pipe.endNode;
    sealedPipeEntries.add(`${pipe.id}@${farNode}`);
  };

  /**
   * hard/tight로 잠근 제수변 주변 교차점: JOIN 안 관 끝 입구를 막아
   * 짧은 연결관으로 옆 갈래·반대쪽 본선이 새지 않게 한다.
   */
  /** 제수변 근처 관 입구 봉인 — hard/tight 잠금 후 너머 진입 차단 */
  const sealJunctionNearValve = (valve: ValveOnPipe) => {
    for (const p of pipes) {
      if (dist(p.sx, p.sy, valve.x, valve.y) <= JOIN_TOL_M) {
        sealedPipeEntries.add(`${p.id}@${p.startNode}`);
      }
      if (dist(p.ex, p.ey, valve.x, valve.y) <= JOIN_TOL_M) {
        sealedPipeEntries.add(`${p.id}@${p.endNode}`);
      }
    }
  };

  const markRange = (pipe: PipeEdge, fromIdx: number, toIdx: number) => {
    addExploredRange(exploredRanges, pipe.id, fromIdx, toIdx);
  };

  type EpKind = 'soft' | 'tight' | 'hard' | 'peer';

  const attachedOf = (v: ValveOnPipe) => pipeById.get(v.pipeId);

  const hasShortStubAttach = (valve: ValveOnPipe, exitX: number, exitY: number, traveledId: string) => {
    const attached = attachedOf(valve);
    if (attached && attached.id === traveledId) return false;
    if (attached && attached.id !== traveledId && attached.length > JUNCTION_VALVE_TOL_M) return false;
    if (attached && attached.id !== traveledId && attached.length <= JUNCTION_VALVE_TOL_M) return true;
    for (const other of pipes) {
      if (other.id === traveledId || other.length > JUNCTION_VALVE_TOL_M) continue;
      if (distPointPolyline(valve.x, valve.y, other.coords) > VALVE_TOL_M) continue;
      if (
        dist(other.sx, other.sy, exitX, exitY) <= JOIN_TOL_M ||
        dist(other.ex, other.ey, exitX, exitY) <= JOIN_TOL_M
      ) {
        return true;
      }
    }
    return false;
  };

  const hasPeerLong = (exitX: number, exitY: number, traveledId: string, excludeId: string) => {
    for (const other of pipes) {
      if (other.id === traveledId || other.id === excludeId) continue;
      if (other.length < SOFT_MAJOR_SPUR_MIN_M) continue;
      if (
        dist(other.sx, other.sy, exitX, exitY) <= JOIN_TOL_M ||
        dist(other.ex, other.ey, exitX, exitY) <= JOIN_TOL_M
      ) {
        return true;
      }
    }
    return false;
  };

  const classifyEnd = (valve: ValveOnPipe, traveled: PipeEdge, exitX: number, exitY: number) => {
    const attached = attachedOf(valve);
    const onTraveled =
      (attached != null && attached.id === traveled.id) ||
      distPointPolyline(valve.x, valve.y, traveled.coords) <= ENDPOINT_SEAL_M;
    const onShort = hasShortStubAttach(valve, exitX, exitY, traveled.id);
    const dExit = dist(valve.x, valve.y, exitX, exitY);
    const tight = dExit <= ENDPOINT_SEAL_M;
    const hardSeal = tight || onTraveled || !onShort;
    const peer = hasPeerLong(exitX, exitY, traveled.id, attached?.id ?? '');
    const stopHere = tight || (onTraveled && !onShort) || (onTraveled && onShort && !peer);
    let kind: EpKind;
    if (tight) kind = 'tight';
    else if (!hardSeal) kind = 'soft';
    else if (stopHere) kind = 'hard';
    else kind = 'peer';
    return { kind, dExit };
  };

  const blockedBySoft = (
    candidate: ValveOnPipe,
    soft: ValveOnPipe | null,
    fromX: number,
    fromY: number,
    entered: PipeEdge
  ) => {
    if (!soft || candidate.ogcFid === soft.ogcFid) return false;
    const dGate = dist(candidate.x, candidate.y, soft.x, soft.y);
    if (dGate > JUNCTION_CLUSTER_TOL_M) return false;
    if (dist(fromX, fromY, soft.x, soft.y) <= JUNCTION_VALVE_TOL_M) {
      if (
        entered.length > JUNCTION_CLUSTER_TOL_M &&
        candidate.pipeId === entered.id &&
        soft.pipeId !== entered.id
      ) {
        return false;
      }
      return true;
    }
    const dCand = dist(candidate.x, candidate.y, fromX, fromY);
    const dSoft = dist(soft.x, soft.y, fromX, fromY);
    if (dGate <= JUNCTION_VALVE_TOL_M) return dCand >= dSoft - 0.05;
    if (Math.abs(dCand - dSoft) <= JUNCTION_VALVE_TOL_M) return false;
    return dCand >= dSoft - 0.05;
  };

  const gateAfter = (soft: ValveOnPipe | null, next: PipeEdge) => {
    if (!soft) return null;
    return next.length <= JUNCTION_CLUSTER_TOL_M ? soft : null;
  };

  const hasMajorSpur = (valve: ValveOnPipe, traveledId: string, nextId: string) => {
    // 제수변이 짧은 연결관이 아닌 별도 갈래 관(예: 소구경 분기관) 위에 있으면 그 갈래를 막는 밸브다.
    // 다음 관(본선 연장)까지 막지 않는다.
    const attached = attachedOf(valve);
    if (
      attached &&
      attached.id !== traveledId &&
      attached.id !== nextId &&
      attached.length > JUNCTION_CLUSTER_TOL_M
    ) {
      return true;
    }
    for (const other of pipes) {
      if (other.id === traveledId || other.id === nextId) continue;
      if (other.length < SOFT_MAJOR_SPUR_MIN_M) continue;
      if (distPointPolyline(valve.x, valve.y, other.coords) <= JOIN_TOL_M) return true;
    }
    return false;
  };

  const softBlocks = (
    soft: ValveOnPipe | null,
    fromPipe: PipeEdge,
    next: PipeEdge,
    enterX: number,
    enterY: number
  ) => {
    if (!soft || next.length <= JUNCTION_CLUSTER_TOL_M) return false;
    if (dist(enterX, enterY, soft.x, soft.y) > JOIN_TOL_M) return false;
    return !hasMajorSpur(soft, fromPipe.id, next.id);
  };

  const foreignLong = (candidate: ValveOnPipe, traveledId: string, blocking: ValveOnPipe) => {
    const attached = attachedOf(candidate);
    if (!attached) return false;
    if (attached.id === traveledId || attached.id === blocking.pipeId) return false;
    return attached.length > JUNCTION_CLUSTER_TOL_M;
  };

  /**
   * 출구(교차점)에서 잠근 제수변까지, 제수변이 놓인 관의 구간을 결과선으로 그린다.
   * v6처럼 교차점을 관 위에 투영해 투영점→제수변을 칠한다(겹침·몸통 접속 포함).
   */
  const paintStub = (valve: ValveOnPipe, exitX: number, exitY: number) => {
    const attached = attachedOf(valve);
    if (!attached) return;
    if (distPointPolyline(exitX, exitY, attached.coords) > VALVE_TOL_M) return;

    const fromIdx = projectIndex(attached.coords, exitX, exitY);
    if (Math.abs(valve.index - fromIdx) >= 0.05) {
      markRange(attached, fromIdx, valve.index);
      return;
    }
    // 제수변이 교차점과 거의 같으면 짧은 연결관만 전체 칠함
    if (attached.length > 0.05 && attached.length <= JUNCTION_VALVE_TOL_M + 0.5) {
      markRange(attached, 0, attached.length);
    }
  };

  /** 탐색 중인 관(또는 잠근 제수변이 앉은 관) 위에 있는 제수변만 — 옆 평행관 근접 제외 */
  const onExploredPipe = (v: ValveOnPipe, ...pipeIds: string[]) =>
    pipeIds.some((id) => v.pipeId === id);

  const acceptSiblings = (
    exitX: number,
    exitY: number,
    fromX: number,
    fromY: number,
    blocking: ValveOnPipe,
    traveledId: string,
    excludeForeign: boolean
  ) => {
    const blockFrom = dist(blocking.x, blocking.y, fromX, fromY);
    for (const v of valves) {
      if (v.ogcFid === blocking.ogcFid) continue;
      if (!onExploredPipe(v, traveledId, blocking.pipeId)) continue;
      if (dist(v.x, v.y, exitX, exitY) > JUNCTION_VALVE_TOL_M) continue;
      if (excludeForeign && foreignLong(v, traveledId, blocking)) continue;
      if (dist(v.x, v.y, fromX, fromY) >= blockFrom - 0.05) continue;
      if (isolationGates.has(v.ogcFid)) continue;
      acceptValve(v);
      paintStub(v, exitX, exitY);
    }
  };

  const tangent = (edge: PipeEdge, index: number): [number, number] => {
    const eps = Math.min(1, Math.max(0.2, edge.length * 0.02));
    const i = Math.max(0, Math.min(edge.length, index));
    const i0 = i + eps <= edge.length ? i : Math.max(0, i - eps);
    const i1 = i + eps <= edge.length ? i + eps : i;
    const p0 = pointAtMeter(edge.coords, i0);
    const p1 = pointAtMeter(edge.coords, i1);
    return [p1[0] - p0[0], p1[1] - p0[1]];
  };

  const nearlyParallel = (host: PipeEdge, hostIdx: number, branch: PipeEdge, branchIdx: number) => {
    const ta = tangent(host, hostIdx);
    const tb = tangent(branch, branchIdx);
    const la = Math.hypot(ta[0], ta[1]);
    const lb = Math.hypot(tb[0], tb[1]);
    if (la < 1e-9 || lb < 1e-9) return false;
    return Math.abs((ta[0] * tb[0] + ta[1] * tb[1]) / (la * lb)) >= TEE_PARALLEL_ABS_COS;
  };

  const lineGap = (a: PipeEdge, b: PipeEdge) => {
    let best = Number.POSITIVE_INFINITY;
    for (const [x, y] of a.coords) {
      const d = distPointPolyline(x, y, b.coords);
      if (d < best) best = d;
    }
    return best;
  };

  const branchPrimary = (branch: PipeEdge, host: PipeEdge) => {
    const dHost = lineGap(branch, host);
    for (const other of pipes) {
      if (other.id === host.id || other.id === branch.id) continue;
      if (other.length <= JUNCTION_VALVE_TOL_M) continue;
      if (lineGap(branch, other) + 0.05 < dHost) return false;
    }
    return true;
  };

  type Orient = {
    towardStart: boolean;
    fromIndex: number;
    enterNode: number;
    enterX: number;
    enterY: number;
    farX: number;
    farY: number;
  };

  const orientAt = (next: PipeEdge, exitX: number, exitY: number): Orient | null => {
    const ds = dist(next.sx, next.sy, exitX, exitY);
    const de = dist(next.ex, next.ey, exitX, exitY);
    if (ds > JOIN_TOL_M && de > JOIN_TOL_M) return null;
    const towardStart = de <= ds;
    return {
      towardStart,
      fromIndex: towardStart ? next.length : 0,
      enterNode: towardStart ? next.endNode : next.startNode,
      enterX: towardStart ? next.ex : next.sx,
      enterY: towardStart ? next.ey : next.sy,
      farX: towardStart ? next.sx : next.ex,
      farY: towardStart ? next.sy : next.ey,
    };
  };

  const awayFrom = (next: PipeEdge, exitX: number, exitY: number, valve: ValveOnPipe) => {
    if (next.id === valve.pipeId) return false;
    const o = orientAt(next, exitX, exitY);
    if (!o) return false;
    if (distPointPolyline(valve.x, valve.y, next.coords) <= ENDPOINT_SEAL_M) return false;
    return dist(o.farX, o.farY, valve.x, valve.y) > dist(o.enterX, o.enterY, valve.x, valve.y) + 0.05;
  };

  const towardValvePipe = (next: PipeEdge, exitX: number, exitY: number, valve: ValveOnPipe) => {
    if (next.length > JUNCTION_CLUSTER_TOL_M) return false;
    if (distPointPolyline(valve.x, valve.y, next.coords) <= JOIN_TOL_M) return true;
    const o = orientAt(next, exitX, exitY);
    if (!o) return false;
    return dist(o.farX, o.farY, valve.x, valve.y) <= JOIN_TOL_M;
  };

  /**
   * 진입 관 위에 있고 출구점과 떨어진 제수변이 입구에 있으면 잠그고 true(진입 안 함).
   * 옆 평행관에만 앉은 근접 제수변은 제외한다.
   */
  function gateBeforeEntry(o: Orient, exitX: number, exitY: number, next: PipeEdge): boolean {
    const g = valves.find(
      (v) =>
        onExploredPipe(v, next.id) &&
        dist(v.x, v.y, o.enterX, o.enterY) <= ENDPOINT_SEAL_M &&
        dist(v.x, v.y, exitX, exitY) > ENDPOINT_SEAL_M
    );
    if (!g) return false;
    acceptValve(g);
    markRange(next, o.fromIndex, projectIndex(next.coords, g.x, g.y));
    paintStub(g, exitX, exitY);
    sealJunctionNearValve(g);
    return true;
  }

  function hopInterior(
    host: PipeEdge,
    fromIndex: number,
    toIndex: number,
    accumAtFrom: number,
    hop: number,
    excludeFarEnd: boolean,
    soft: ValveOnPipe | null
  ) {
    const lo = Math.min(fromIndex, toIndex);
    const hi = Math.max(fromIndex, toIndex);
    if (hi - lo < 0.05) return;
    for (const branch of pipes) {
      if (branch.id === host.id) continue;
      enterBranch(branch, branch.sx, branch.sy, false);
      enterBranch(branch, branch.ex, branch.ey, true);
    }

    function enterBranch(branch: PipeEdge, x: number, y: number, branchTowardStart: boolean) {
      if (distPointPolyline(x, y, host.coords) > JOIN_TOL_M) return;
      const idx = projectIndex(host.coords, x, y);
      if (idx < lo - 0.05 || idx > hi + 0.05) return;
      if (excludeFarEnd && Math.abs(idx - toIndex) <= JOIN_TOL_M) return;
      if (hop > 0 && Math.abs(idx - fromIndex) <= INDEX_EPS_M) return;
      const branchIdx = branchTowardStart ? branch.length : 0;
      if (nearlyParallel(host, idx, branch, branchIdx)) return;
      if (!branchPrimary(branch, host)) return;
      if (softBlocks(soft, host, branch, x, y)) return;
      const key = `${branch.id}@ibranch@${branchTowardStart ? 'E' : 'S'}`;
      if (visitedDirected.has(key)) return;
      visitedDirected.add(key);
      const nextAccum = accumAtFrom + Math.abs(idx - fromIndex);
      if (nextAccum > MAX_SEARCH_M) return;
      searchAlong(branch, branchIdx, branchTowardStart, nextAccum, hop + 1, gateAfter(soft, branch));
    }
  }

  function hopToward(
    fromPipe: PipeEdge,
    exitX: number,
    exitY: number,
    nextAccum: number,
    hop: number,
    valve: ValveOnPipe
  ) {
    for (const next of pipes) {
      if (next.id === fromPipe.id || !towardValvePipe(next, exitX, exitY, valve)) continue;
      const o = orientAt(next, exitX, exitY);
      if (!o || sealedPipeEntries.has(`${next.id}@${o.enterNode}`)) continue;
      if (dist(o.enterX, o.enterY, valve.x, valve.y) <= JOIN_TOL_M) {
        markRange(next, o.fromIndex, projectIndex(next.coords, valve.x, valve.y));
        continue;
      }
      if (dist(o.farX, o.farY, valve.x, valve.y) >= dist(o.enterX, o.enterY, valve.x, valve.y) - 0.05) {
        continue;
      }
      const key = `${next.id}@shortValve@${o.towardStart ? 'E' : 'S'}`;
      if (visitedDirected.has(key)) continue;
      visitedDirected.add(key);
      searchAlong(next, o.fromIndex, o.towardStart, nextAccum, hop + 1, gateAfter(valve, next));
    }
  }

  function hopAway(
    fromPipe: PipeEdge,
    exitX: number,
    exitY: number,
    nextAccum: number,
    hop: number,
    valve: ValveOnPipe
  ) {
    for (const next of pipes) {
      if (!awayFrom(next, exitX, exitY, valve)) continue;
      const o = orientAt(next, exitX, exitY);
      if (!o || sealedPipeEntries.has(`${next.id}@${o.enterNode}`)) continue;
      // 진입 끝에 다른 제수변이 있으면(출구점과 떨어져 있어도 연결 허용오차 1m로 이어진 것으로 보이는 경우)
      // 건너뛰어 들어가지 않고 그 제수변에서 멈춘다 — hopLinked·hopShort와 같은 처리
      if (gateBeforeEntry(o, exitX, exitY, next)) continue;
      const key = `${next.id}@softAway@${o.towardStart ? 'E' : 'S'}`;
      if (visitedDirected.has(key)) continue;
      visitedDirected.add(key);
      // 제수변에서 멀어지는 갈래는 그 제수변이 막지 못한다 → soft 게이트를 넘기지 않음(hopShort의 spur와 같음).
      // 넘기면 짧은 연결관을 거쳐 옆 갈래의 제수변까지 "같은 교차점 묶음"으로 보고 건너뛴다.
      searchAlong(next, o.fromIndex, o.towardStart, nextAccum, hop + 1, null);
    }
  }

  function hopShort(
    fromPipe: PipeEdge,
    exitX: number,
    exitY: number,
    nextAccum: number,
    hop: number,
    valve: ValveOnPipe
  ) {
    for (const next of pipes) {
      if (next.id === fromPipe.id || next.length > JUNCTION_CLUSTER_TOL_M) continue;
      const o = orientAt(next, exitX, exitY);
      if (!o || sealedPipeEntries.has(`${next.id}@${o.enterNode}`)) continue;
      if (gateBeforeEntry(o, exitX, exitY, next)) continue;
      const key = `${next.id}@shortExit@${o.towardStart ? 'E' : 'S'}`;
      if (visitedDirected.has(key)) continue;
      visitedDirected.add(key);
      const spur = awayFrom(next, exitX, exitY, valve);
      searchAlong(next, o.fromIndex, o.towardStart, nextAccum, hop + 1, spur ? null : gateAfter(valve, next));
    }
  }

  function hopLinked(
    fromPipe: PipeEdge,
    exitX: number,
    exitY: number,
    nextAccum: number,
    hop: number,
    soft: ValveOnPipe | null,
    onlyPeer: boolean,
    corridor: ValveOnPipe | null
  ) {
    for (const next of pipes) {
      if (next.id === fromPipe.id) continue;
      const o = orientAt(next, exitX, exitY);
      if (!o || sealedPipeEntries.has(`${next.id}@${o.enterNode}`)) continue;
      // 다음 관의 진입 끝에 제수변이 있고 그 제수변이 출구점과 떨어져 있으면,
      // 연결 허용오차로 건너뛰어 들어가지 않고 그 제수변에서 탐색을 멈춘다.
      if (gateBeforeEntry(o, exitX, exitY, next)) continue;
      const spur =
        !!corridor && next.length <= JUNCTION_CLUSTER_TOL_M && awayFrom(next, exitX, exitY, corridor);
      if (onlyPeer && next.length <= JUNCTION_CLUSTER_TOL_M && !spur) continue;
      if (softBlocks(soft, fromPipe, next, o.enterX, o.enterY)) continue;
      const key = `${fromPipe.id}>${next.id}@${o.towardStart ? 'E' : 'S'}`;
      if (visitedDirected.has(key)) continue;
      visitedDirected.add(key);
      const child = spur ? null : onlyPeer ? soft : gateAfter(soft, next);
      searchAlong(next, o.fromIndex, o.towardStart, nextAccum, hop + 1, child);
    }
  }

  function searchAlong(
    pipe: PipeEdge,
    fromIndex: number,
    towardStart: boolean,
    accumDist: number,
    hop: number,
    softGate: ValveOnPipe | null
  ) {
    if (hop > MAX_HOP || accumDist > MAX_SEARCH_M) {
      truncated = true;
      return;
    }

    const len = pipe.length;
    const baseIndex = Math.max(0, Math.min(len, fromIndex));
    const from = pointAtMeter(pipe.coords, baseIndex);
    const exitIndex = towardStart ? 0 : len;
    const exitX = towardStart ? pipe.sx : pipe.ex;
    const exitY = towardStart ? pipe.sy : pipe.ey;

    const ahead = pipe.valves
      .filter((v) => isValveAhead(v, baseIndex, len, towardStart, hop))
      .sort((a, b) => Math.abs(a.index - baseIndex) - Math.abs(b.index - baseIndex));

    if (ahead.length > 0) {
      const first = ahead[0]!;
      if (blockedBySoft(first, softGate, from[0], from[1], pipe)) return;
      markRange(pipe, baseIndex, first.index);
      acceptValve(first);
      sealFarSide(pipe, towardStart, first);
      const distAlong = accumDist + Math.abs(first.index - baseIndex);
      if (Math.abs(first.index - exitIndex) <= JUNCTION_VALVE_TOL_M) {
        const ep = classifyEnd(first, pipe, exitX, exitY);
        acceptSiblings(exitX, exitY, from[0], from[1], first, pipe.id, ep.kind !== 'soft');
        if (ep.kind === 'soft') {
          hopToward(pipe, exitX, exitY, distAlong, hop, first);
          hopAway(pipe, exitX, exitY, distAlong, hop, first);
        } else if (ep.kind === 'tight' || ep.kind === 'hard') {
          sealJunctionNearValve(first);
        }
      }
      hopInterior(pipe, baseIndex, first.index, accumDist, hop, true, softGate);
      return;
    }

    const travelToEnd = towardStart ? baseIndex : len - baseIndex;
    const nextAccum = accumDist + travelToEnd;
    if (nextAccum > MAX_SEARCH_M) {
      truncated = true;
      const remain = MAX_SEARCH_M - accumDist;
      if (remain > INDEX_EPS_M) {
        const endIdx = towardStart ? baseIndex - remain : baseIndex + remain;
        markRange(pipe, baseIndex, endIdx);
        hopInterior(pipe, baseIndex, endIdx, accumDist, hop, false, softGate);
      }
      return;
    }

    markRange(pipe, baseIndex, exitIndex);
    hopInterior(pipe, baseIndex, exitIndex, accumDist, hop, true, softGate);

    const exitNode = towardStart ? pipe.startNode : pipe.endNode;
    const visitKey = `${pipe.id}>${exitNode}`;
    if (visitedDirected.has(visitKey)) return;
    visitedDirected.add(visitKey);

    if (pipe.id.startsWith('wtl_sply_ls:')) {
      for (const main of pipes) {
        if (!main.id.startsWith('wtl_pipe_lm:')) continue;
        if (distPointPolyline(exitX, exitY, main.coords) > JOIN_TOL_M) continue;
        const teeKey = `tee:${pipe.id}:${exitNode}:${main.id}`;
        if (visitedDirected.has(teeKey)) continue;
        visitedDirected.add(teeKey);
        const index = projectIndex(main.coords, exitX, exitY);
        searchAlong(main, index, true, nextAccum, hop + 1, null);
        searchAlong(main, index, false, nextAccum, hop + 1, null);
      }
    }

    let nodeValve: ValveOnPipe | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const v of valves) {
      // 지금 탐색 중인 관 위 제수변만 — 평행관 근접으로 잠그지 않음
      if (!onExploredPipe(v, pipe.id)) continue;
      const dExit = dist(v.x, v.y, exitX, exitY);
      if (dExit > JUNCTION_VALVE_TOL_M) continue;
      if (dist(v.x, v.y, from[0], from[1]) <= dExit) continue;
      if (dExit < bestD) {
        bestD = dExit;
        nodeValve = v;
      }
    }

    if (nodeValve && blockedBySoft(nodeValve, softGate, from[0], from[1], pipe)) return;

    let onlyPeer = false;
    let childGate = softGate;
    if (nodeValve) {
      const ep = classifyEnd(nodeValve, pipe, exitX, exitY);
      acceptValve(nodeValve);
      sealFarSide(pipe, towardStart);
      paintStub(nodeValve, exitX, exitY);
      acceptSiblings(exitX, exitY, from[0], from[1], nodeValve, pipe.id, ep.kind !== 'soft');
      if (ep.kind === 'soft') {
        hopToward(pipe, exitX, exitY, nextAccum, hop, nodeValve);
        hopAway(pipe, exitX, exitY, nextAccum, hop, nodeValve);
        return;
      }
      if (ep.kind === 'tight' || ep.kind === 'hard') {
        sealJunctionNearValve(nodeValve);
        return;
      }
      onlyPeer = true;
      childGate = nodeValve;
      hopShort(pipe, exitX, exitY, nextAccum, hop, nodeValve);
    }

    hopLinked(pipe, exitX, exitY, nextAccum, hop, childGate, onlyPeer, nodeValve);
  }

  searchAlong(seed, leakIndex, true, 0, 0, null);
  searchAlong(seed, leakIndex, false, 0, 0, null);

  // 시드 관에 누수가 있을 때: 채택 제수변 기준으로 누수 쪽만 남김
  if (isolationGates.size > 0) {
    const blocks: number[] = [];
    for (const v of valves) {
      if (!isolationGates.has(v.ogcFid) || v.pipeId !== seed.id) continue;
      blocks.push(v.index);
    }
    if (blocks.length > 0) {
      blocks.sort((a, b) => a - b);
      let nearestLo: number | null = null;
      let nearestHi: number | null = null;
      for (const bi of blocks) {
        if (bi < leakIndex - INDEX_EPS_M) nearestLo = bi;
        else if (bi > leakIndex + INDEX_EPS_M && nearestHi == null) nearestHi = bi;
      }
      const allowed: [number, number][] = [];
      allowed.push(nearestLo != null ? [nearestLo, leakIndex] : [0, leakIndex]);
      allowed.push(nearestHi != null ? [leakIndex, nearestHi] : [leakIndex, seed.length]);
      const ranges = exploredRanges.get(seed.id) ?? [];
      const clipped: [number, number][] = [];
      for (const iv of mergeIntervals(ranges)) {
        for (const al of allowed) {
          const lo = Math.max(iv[0], al[0]);
          const hi = Math.min(iv[1], al[1]);
          if (hi - lo >= 0.05) clipped.push([lo, hi]);
        }
      }
      if (clipped.length > 0) exploredRanges.set(seed.id, clipped);
    }
  }

  // 이어진 관로에서 제수변을 하나도 못 찾으면 그대로 0개로 둔다(끊긴 관로 등 데이터 그대로).
  // 예전에는 누수지점에서 가까운 제수변 4개를 대신 넣었는데, 탐색과 무관한 제수변이 나와 오해를 줬다.

  const gateDtos: WtlLeakGateDto[] = [...isolationGates.values()].map((g) => ({
    id: gateIdOf(g.ogcFid),
    name: g.name,
    diameter: g.diameter,
    address: g.address,
    point: [g.lon, g.lat],
  }));

  const pipeLines: [number, number][][] = [];
  for (const [pipeId, ranges] of exploredRanges) {
    const p = pipeById.get(pipeId);
    if (!p || p.length <= 0) continue;
    for (const [a, b] of mergeIntervals(ranges)) {
      const line = sliceByFraction(p.coords4326, a / p.length, b / p.length);
      if (line.length >= 2) pipeLines.push(line);
    }
  }

  const applied = params.ignoreCaseRule
    ? null
    : await matchAppliedTraceAnswer({ feature: '누수', x: snap.x, y: snap.y });
  const merged = mergeAppliedTrace(pipeLines, gateDtos, applied);
  const pipesOut = merged.pipes;
  const gatesOut = merged.gates;

  return {
    result: {
      snap,
      gates: gatesOut,
      pipes: pipesOut,
      truncated,
      searchM,
    },
  };
}
