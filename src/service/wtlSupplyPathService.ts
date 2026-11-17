/**
 * 송수경로 — 정수장·배수지에서 관로 유수방향(시작→끝) 하류 추적
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';

const SEED_PIPE_M = 80; // 시설↔시드 관로 (면형 시설이므로 여유)
const TRACE_PAD_M = 8000;
const PIPE_MAX = 1200;
const VALVE_NODE_M = 30; // 송수 관로에 붙은 제수변 판정
const GATE_FTR = 'SA200';
const GATE_MAX = 200;

export type WtlSupplySourceKind = '정수장' | '배수지';

export type WtlSupplySourceDto = {
  id: string; // kind:ogc_fid
  kind: WtlSupplySourceKind;
  name: string;
  point: [number, number]; // lon,lat
};

export type WtlSupplyGateDto = {
  id: string;
  name: string;
  diameter: string;
  address: string;
  point: [number, number]; // lon,lat
};

export type WtlSupplyPathResultDto = {
  source: WtlSupplySourceDto;
  pipes: [number, number][][]; // 4326, 유수방향(시작→끝) 좌표
  pipeCount: number;
  /** 송수 관로에 붙은 제수변(SA200) */
  gates: WtlSupplyGateDto[];
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
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

function kindToTable(kind: WtlSupplySourceKind): string {
  return kind === '정수장' ? 'wtl_puri_as' : 'wtl_serv_ps';
}

function kindToNameExpr(kind: WtlSupplySourceKind): string {
  return kind === '정수장'
    ? `COALESCE(NULLIF(trim(pur_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`
    : `COALESCE(NULLIF(trim(srv_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`;
}

function sourceId(kind: WtlSupplySourceKind, ogcFid: number): string {
  return `${kind}:${ogcFid}`;
}

function parseSourceId(id: string): { kind: WtlSupplySourceKind; ogcFid: number } | null {
  const idx = id.indexOf(':');
  if (idx < 0) return null;
  const kind = id.slice(0, idx) as WtlSupplySourceKind;
  const ogcFid = Number(id.slice(idx + 1));
  if ((kind !== '정수장' && kind !== '배수지') || !Number.isFinite(ogcFid)) return null;
  return { kind, ogcFid };
}

async function loadSourcesOfKind(kind: WtlSupplySourceKind): Promise<WtlSupplySourceDto[]> {
  const table = kindToTable(kind);
  if (!(await tableExists('layer', table))) return [];
  const nameExpr = kindToNameExpr(kind);
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS "ogcFid",
         ${nameExpr} AS name,
         ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
         ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
       FROM layer."${table}" t
       WHERE t.geom IS NOT NULL
       ORDER BY name
       LIMIT 500`
    )
  );
  const out: WtlSupplySourceDto[] = [];
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const ogcFid = Number(r.ogcFid);
    const lon = Number(r.lon);
    const lat = Number(r.lat);
    if (![ogcFid, lon, lat].every((n) => Number.isFinite(n))) continue;
    out.push({
      id: sourceId(kind, ogcFid),
      kind,
      name: asStr(r.name) || `${kind}-${ogcFid}`,
      point: [lon, lat],
    });
  }
  return out;
}

/**
 * 정수장·배수지 목록
 */
export async function listWtlSupplySources(): Promise<{
  sources: WtlSupplySourceDto[];
  error?: string;
}> {
  const [plants, reservoirs] = await Promise.all([
    loadSourcesOfKind('정수장'),
    loadSourcesOfKind('배수지'),
  ]);
  const sources = [...plants, ...reservoirs];
  if (sources.length === 0) {
    return { sources: [], error: '정수장·배수지 레이어가 없거나 비어 있습니다.' };
  }
  return { sources };
}

async function loadSourcePoint(
  kind: WtlSupplySourceKind,
  ogcFid: number
): Promise<{ source: WtlSupplySourceDto; x: number; y: number } | null> {
  const table = kindToTable(kind);
  if (!(await tableExists('layer', table))) return null;
  const nameExpr = kindToNameExpr(kind);
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS "ogcFid",
         ${nameExpr} AS name,
         ST_X(ST_Centroid(t.geom)) AS x,
         ST_Y(ST_Centroid(t.geom)) AS y,
         ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
         ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
       FROM layer."${table}" t
       WHERE t.ogc_fid = ${ogcFid}
         AND t.geom IS NOT NULL
       LIMIT 1`
    )
  );
  const r = res.rows?.[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const x = Number(r.x);
  const y = Number(r.y);
  const lon = Number(r.lon);
  const lat = Number(r.lat);
  if (![x, y, lon, lat].every((n) => Number.isFinite(n))) return null;
  return {
    source: {
      id: sourceId(kind, ogcFid),
      kind,
      name: asStr(r.name) || `${kind}-${ogcFid}`,
      point: [lon, lat],
    },
    x,
    y,
  };
}

async function loadPipesNear(cx: number, cy: number, pad: number): Promise<PipeRec[]> {
  if (!(await tableExists('layer', 'wtl_pipe_lm'))) return [];
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
         LIMIT ${PIPE_MAX * 2}
       ) t
       WHERE GeometryType(t.line) IN ('LINESTRING', 'MULTILINESTRING')
          OR GeometryType(t.line) LIKE '%LINE%'
       LIMIT ${PIPE_MAX * 2}`
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

/**
 * 유수방향 = 관로 도형 시작→끝.
 * 시설 근처 관로를 시드로 잡고 끝점에서 «시작=이 노드»인 관로만 따라감.
 * 방문 순서대로 반환해 애니메이션에 사용.
 */
function traceDownstreamOrdered(pipes: PipeRec[], cx: number, cy: number): PipeRec[] {
  const byId = new Map(pipes.map((p) => [p.id, p]));
  const outFromStart = new Map<string, PipeRec[]>();
  for (const p of pipes) {
    const list = outFromStart.get(p.startKey);
    if (list) list.push(p);
    else outFromStart.set(p.startKey, [p]);
  }

  const seedDist2 = SEED_PIPE_M * SEED_PIPE_M;
  const visited = new Set<number>();
  const ordered: PipeRec[] = [];
  const queued = new Set<string>();
  const queue: string[] = [];

  const enqueueNode = (k: string) => {
    if (!k || queued.has(k)) return;
    queued.add(k);
    queue.push(k);
  };

  const near = pipes
    .map((p) => {
      const dStart = dist2(cx, cy, p.sx, p.sy);
      const dEnd = dist2(cx, cy, p.ex, p.ey);
      const mx = (p.sx + p.ex) / 2;
      const my = (p.sy + p.ey) / 2;
      const dMid = dist2(cx, cy, mx, my);
      return { pipe: p, dLine: Math.min(dStart, dEnd, dMid), dStart };
    })
    .filter((row) => row.dLine <= seedDist2)
    .sort((a, b) => a.dLine - b.dLine)
    .slice(0, 20);

  // 시드: 시설에 가까운 쪽을 상류로 보고, 하류(끝)로 흘러가게 방향 보정
  for (const row of near) {
    if (visited.has(row.pipe.id)) continue;
    visited.add(row.pipe.id);
    const p = row.pipe;
    // 시설이 끝에 더 가까우면 역방향 관로 → 시작 노드에서 하류 탐색만 (시드 자체는 포함)
    ordered.push(p);
    if (row.dStart <= dist2(cx, cy, p.ex, p.ey)) {
      enqueueNode(p.endKey);
    } else {
      // 끝점이 시설에 가까움 = 도형이 역방향일 수 있음 → 시작점으로도 하류 시도
      enqueueNode(p.startKey);
      enqueueNode(p.endKey);
    }
  }

  while (queue.length > 0 && ordered.length < PIPE_MAX) {
    const node = queue.shift()!;
    for (const p of outFromStart.get(node) ?? []) {
      if (visited.has(p.id)) continue;
      visited.add(p.id);
      ordered.push(p);
      enqueueNode(p.endKey);
    }
  }

  return ordered.map((p) => byId.get(p.id)!).filter(Boolean);
}

function gateIdOf(ogcFid: number): string {
  return `gate-${ogcFid}`;
}

/** 추적 관로 끝점·중점에 붙은 제수변만 */
async function loadGatesOnPipes(
  pipes: PipeRec[],
  cx: number,
  cy: number,
  pad: number
): Promise<WtlSupplyGateDto[]> {
  if (pipes.length === 0 || !(await tableExists('layer', 'wtl_valv_ps'))) return [];
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
       LIMIT 3000`
    )
  );
  const tol2 = VALVE_NODE_M * VALVE_NODE_M;
  const out: WtlSupplyGateDto[] = [];
  const seen = new Set<number>();
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const ogcFid = Number(r.ogcFid);
    const x = Number(r.x);
    const y = Number(r.y);
    const lon = Number(r.lon);
    const lat = Number(r.lat);
    if (![ogcFid, x, y, lon, lat].every((n) => Number.isFinite(n))) continue;
    if (seen.has(ogcFid)) continue;
    let attached = false;
    for (const p of pipes) {
      const mx = (p.sx + p.ex) / 2;
      const my = (p.sy + p.ey) / 2;
      if (
        dist2(x, y, p.sx, p.sy) <= tol2 ||
        dist2(x, y, p.ex, p.ey) <= tol2 ||
        dist2(x, y, mx, my) <= tol2
      ) {
        attached = true;
        break;
      }
    }
    if (!attached) continue;
    seen.add(ogcFid);
    const diameter = asStr(r.stdDip);
    out.push({
      id: gateIdOf(ogcFid),
      name: asStr(r.ftrIdn) || `GV-${ogcFid}`,
      diameter: diameter ? `${diameter}mm` : '—',
      address: asStr(r.hjd) || '—',
      point: [lon, lat],
    });
    if (out.length >= GATE_MAX) break;
  }
  return out;
}

/**
 * 선택한 정수장·배수지에서 하류 송수경로
 */
export async function analyzeWtlSupplyPath(params: {
  sourceId?: string;
}): Promise<{ result: WtlSupplyPathResultDto | null; error?: string }> {
  const parsed = parseSourceId(String(params.sourceId ?? ''));
  if (!parsed) {
    return { result: null, error: '시설을 선택하세요.' };
  }

  const loaded = await loadSourcePoint(parsed.kind, parsed.ogcFid);
  if (!loaded) {
    return { result: null, error: '선택한 시설을 찾을 수 없습니다.' };
  }

  const pipes = await loadPipesNear(loaded.x, loaded.y, TRACE_PAD_M);
  if (pipes.length === 0) {
    return { result: null, error: '주변 상수관로가 없습니다.' };
  }

  const traced = traceDownstreamOrdered(pipes, loaded.x, loaded.y);
  if (traced.length === 0) {
    return { result: null, error: '시설 근처에서 하류 관로를 찾지 못했습니다.' };
  }

  const lines: [number, number][][] = [];
  for (const p of traced) {
    const line = parseLine(p.geom4326);
    if (!line || line.length < 2) continue;
    // 유수방향: 시작→끝. 시설이 끝에 더 가까우면 좌표 뒤집어 표시
    const dStart = dist2(loaded.x, loaded.y, p.sx, p.sy);
    const dEnd = dist2(loaded.x, loaded.y, p.ex, p.ey);
    if (dEnd < dStart && lines.length === 0) {
      // 첫 시드만 방향 보정; 이후는 도형 시작→끝 유지
      lines.push([...line].reverse());
    } else {
      lines.push(line);
    }
  }

  if (lines.length === 0) {
    return { result: null, error: '관로 도형을 읽지 못했습니다.' };
  }

  const gates = await loadGatesOnPipes(traced, loaded.x, loaded.y, TRACE_PAD_M);

  return {
    result: {
      source: loaded.source,
      pipes: lines,
      pipeCount: lines.length,
      gates,
    },
  };
}
