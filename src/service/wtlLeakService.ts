/**
 * 누수분석 — 관망 스냅 위치에서 격리에 필요한 제수변(SA200) 탐색
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';

const GATE_FTR = 'SA200';
const SNAP_TOL_M = 25; // 클릭→관로 스냅 허용(레이어 SRID m)
const VALVE_NODE_M = 30; // 제수변↔노드/관로 판정
const TRACE_PAD_M = 2000;
const PIPE_MAX = 800;
const VALVE_MAX = 80;

export type WtlLeakSnapDto = {
  x: number; // 3857 (지도)
  y: number;
  lon: number;
  lat: number;
  pipeId: number;
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
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function gateIdOf(ogcFid: number): string {
  return `gate-${ogcFid}`;
}

function nodeKey(x: number, y: number): string {
  return `${Math.round(x)}_${Math.round(y)}`;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
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

type PipeRec = {
  id: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  startKey: string;
  endKey: string;
  geom4326: unknown;
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
  nodeKey: string;
};

/**
 * 지도 클릭(3857) → 가장 가까운 상수관로 위 스냅점
 */
export async function snapWtlLeakAtPoint(params: {
  x: number;
  y: number;
  tolerance?: number;
}): Promise<{ snap: WtlLeakSnapDto | null; error?: string }> {
  if (!(await tableExists('layer', 'wtl_pipe_lm'))) {
    return { snap: null, error: '상수관로 레이어가 없습니다.' };
  }
  const x = Number(params.x);
  const y = Number(params.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { snap: null, error: '좌표가 올바르지 않습니다.' };
  }
  const tol = Math.max(5, Number(params.tolerance) || SNAP_TOL_M);

  const res = await db.execute(
    sql.raw(
      `WITH srid AS (
         SELECT ST_SRID(geom) AS s FROM layer.wtl_pipe_lm WHERE geom IS NOT NULL LIMIT 1
       ),
       click AS (
         SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857), s.s) AS g FROM srid s
       ),
       cand AS (
         SELECT
           p.ogc_fid AS id,
           ST_Distance(p.geom, c.g) AS dist,
           ST_ClosestPoint(p.geom, c.g) AS closest
         FROM layer.wtl_pipe_lm p, click c
         WHERE p.geom IS NOT NULL
           AND ST_DWithin(p.geom, c.g, ${tol})
         ORDER BY dist
         LIMIT 1
       )
       SELECT
         id,
         dist,
         ST_X(ST_Transform(closest, 3857)) AS x3857,
         ST_Y(ST_Transform(closest, 3857)) AS y3857,
         ST_X(ST_Transform(closest, 4326)) AS lon,
         ST_Y(ST_Transform(closest, 4326)) AS lat
       FROM cand`
    )
  );

  const row = res.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) {
    return { snap: null, error: '근처 관로에 스냅할 수 없습니다. 관망을 클릭하세요.' };
  }
  const pipeId = Number(row.id);
  const sx = Number(row.x3857);
  const sy = Number(row.y3857);
  const lon = Number(row.lon);
  const lat = Number(row.lat);
  const distance = Number(row.dist);
  if (![pipeId, sx, sy, lon, lat].every((n) => Number.isFinite(n))) {
    return { snap: null, error: '스냅 결과를 읽지 못했습니다.' };
  }
  return {
    snap: {
      x: sx,
      y: sy,
      lon,
      lat,
      pipeId,
      distance: Number.isFinite(distance) ? distance : 0,
    },
  };
}

async function loadPipesNear(
  cx: number,
  cy: number,
  pad: number
): Promise<PipeRec[]> {
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
         FROM layer.wtl_pipe_lm
         WHERE geom IS NOT NULL
           AND ST_DWithin(
             geom,
             ST_SetSRID(ST_MakePoint(${cx}, ${cy}), ST_SRID(geom)),
             ${pad}
           )
         LIMIT ${PIPE_MAX}
       ) t`
    )
  );
  const out: PipeRec[] = [];
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id);
    const sx = Number(r.sx);
    const sy = Number(r.sy);
    const ex = Number(r.ex);
    const ey = Number(r.ey);
    if (![id, sx, sy, ex, ey].every((n) => Number.isFinite(n))) continue;
    out.push({
      id,
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
      name: asStr(r.ftrIdn) || `GV-${ogcFid}`,
      diameter: diameter ? `${diameter}mm` : '—',
      address: asStr(r.hjd) || '—',
      x,
      y,
      lon,
      lat,
      nodeKey: nodeKey(x, y),
    });
  }
  return out;
}

/**
 * 스냅점 기준 관로를 양쪽으로 따라가며 만나는 제수변 = 격리용 잠금 대상
 */
export async function analyzeWtlLeak(params: {
  x: number;
  y: number;
  tolerance?: number;
}): Promise<{ result: WtlLeakResultDto | null; error?: string }> {
  const snapped = await snapWtlLeakAtPoint(params);
  if (!snapped.snap) {
    return { result: null, error: snapped.error || '스냅에 실패했습니다.' };
  }
  const snap = snapped.snap;

  // 레이어 좌표로 변환해 주변 관로·제수변 로드
  const originRes = await db.execute(
    sql.raw(
      `SELECT
         ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(${snap.x}, ${snap.y}), 3857), ST_SRID(geom))) AS cx,
         ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(${snap.x}, ${snap.y}), 3857), ST_SRID(geom))) AS cy
       FROM layer.wtl_pipe_lm
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

  const pipes = await loadPipesNear(cx, cy, TRACE_PAD_M);
  const gates = await loadGatesNear(cx, cy, TRACE_PAD_M);
  if (pipes.length === 0) {
    return { result: null, error: '주변 관로가 없습니다.' };
  }

  const byId = new Map(pipes.map((p) => [p.id, p]));
  const atNode = new Map<string, PipeRec[]>();
  const addAt = (k: string, p: PipeRec) => {
    const list = atNode.get(k);
    if (list) list.push(p);
    else atNode.set(k, [p]);
  };
  for (const p of pipes) {
    addAt(p.startKey, p);
    addAt(p.endKey, p);
  }

  // 제수변 → 가장 가까운 관로 노드
  const valveTol2 = VALVE_NODE_M * VALVE_NODE_M;
  const valvesAtNode = new Map<string, GateRec[]>();
  for (const g of gates) {
    let bestKey: string | null = null;
    let bestD = valveTol2;
    for (const p of pipes) {
      const ds = dist2(g.x, g.y, p.sx, p.sy);
      const de = dist2(g.x, g.y, p.ex, p.ey);
      if (ds <= bestD) {
        bestD = ds;
        bestKey = p.startKey;
      }
      if (de <= bestD) {
        bestD = de;
        bestKey = p.endKey;
      }
    }
    // 중점 근접도 허용
    if (!bestKey) {
      for (const p of pipes) {
        const mx = (p.sx + p.ex) / 2;
        const my = (p.sy + p.ey) / 2;
        const dm = dist2(g.x, g.y, mx, my);
        if (dm <= valveTol2 && dm <= bestD) {
          bestD = dm;
          // 중점이면 양끝 중 가까운 쪽
          bestKey =
            dist2(g.x, g.y, p.sx, p.sy) <= dist2(g.x, g.y, p.ex, p.ey) ? p.startKey : p.endKey;
        }
      }
    }
    if (!bestKey) continue;
    const list = valvesAtNode.get(bestKey);
    if (list) list.push(g);
    else valvesAtNode.set(bestKey, [g]);
  }

  const seedPipe = byId.get(snap.pipeId) ?? pipes[0];
  if (!seedPipe) {
    return { result: null, error: '시드 관로를 찾지 못했습니다.' };
  }

  const visitedPipes = new Set<number>();
  const isolationGates = new Map<number, GateRec>();
  const queued = new Set<string>();
  const queue: string[] = [];

  const enqueue = (k: string) => {
    if (!k || queued.has(k)) return;
    // 제수변이 있는 노드면 잠금 대상으로 추가하고 더 이상 진행하지 않음
    const vs = valvesAtNode.get(k);
    if (vs && vs.length > 0) {
      for (const v of vs) {
        if (isolationGates.size < VALVE_MAX) isolationGates.set(v.ogcFid, v);
      }
      return;
    }
    queued.add(k);
    queue.push(k);
  };

  visitedPipes.add(seedPipe.id);
  enqueue(seedPipe.startKey);
  enqueue(seedPipe.endKey);

  while (queue.length > 0 && visitedPipes.size < PIPE_MAX) {
    const node = queue.shift()!;
    for (const p of atNode.get(node) ?? []) {
      if (visitedPipes.has(p.id)) continue;
      visitedPipes.add(p.id);
      const other = p.startKey === node ? p.endKey : p.startKey;
      enqueue(other);
    }
  }

  // 시드 관로에 직접 붙은 제수변(끝점)이 없으면 근처 제수변 fallback
  if (isolationGates.size === 0) {
    const near = [...gates]
      .map((g) => ({ g, d: dist2(g.x, g.y, cx, cy) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    for (const row of near) isolationGates.set(row.g.ogcFid, row.g);
  }

  const gateDtos: WtlLeakGateDto[] = [...isolationGates.values()].map((g) => ({
    id: gateIdOf(g.ogcFid),
    name: g.name,
    diameter: g.diameter,
    address: g.address,
    point: [g.lon, g.lat],
  }));

  const pipeLines: [number, number][][] = [];
  for (const id of visitedPipes) {
    const p = byId.get(id);
    if (!p) continue;
    const line = parseLine(p.geom4326);
    if (line && line.length >= 2) pipeLines.push(line);
  }

  return {
    result: {
      snap,
      gates: gateDtos,
      pipes: pipeLines,
    },
  };
}
