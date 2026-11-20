/**
 * 송수경로 — 정수장·배수지에서 관로 유수방향(시작→끝) 하류 추적
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';

const SEED_PIPE_M = 80; // 시설↔시드 관로 (면형 시설이므로 여유)
const TRACE_PAD_M = 8000;
/** T자 접속 판정: 끝점이 다른 관로 선에서 이 거리(m) 이내면 접속으로 본다 */
const T_SPLIT_TOUCH_M = 0.05;
/** T자 접속 판정: 접속점이 그 관로의 양 끝에서 이 거리(m)보다 멀어야 «중간»으로 본다 */
const T_SPLIT_END_CLEAR_M = 0.3;
const VALVE_NODE_M = 30; // 송수 관로에 붙은 제수변 판정
const GATE_FTR = 'SA200';
const GATE_MAX = 200;

export type WtlSupplySourceKind = '정수장' | '배수지';

export type WtlSupplySourceDto = {
  id: string; // kind:ogc_fid
  kind: WtlSupplySourceKind;
  name: string;
  point: [number, number]; // lon,lat
  /** 면 시설의 외곽 도형(GeoJSON, EPSG:4326) — 목록 조회에서만 채워짐 */
  outline?: { type: string; coordinates: unknown };
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
  /** pipes[i]의 상류 관로 인덱스(시드는 null). 순차 재생에서 시설 기준 누적 거리 계산에 사용 */
  parentIndex?: (number | null)[];
  /** pipes[i]의 관경(mm). 없으면 null */
  pipeDiameters?: (number | null)[];
  /** 이 경로로 닿는 배수지 */
  destinations?: WtlSupplySourceDto[];
  /** 도착 배수지를 지정한 경우 그 id */
  destinationId?: string | null;
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function nodeKey(x: number, y: number, snapM = 1): string {
  const s = snapM;
  return `${Math.round(x / s) * s}_${Math.round(y / s) * s}`;
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

async function columnExists(schema: string, table: string, column: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}'
         AND lower(table_name) = '${esc(table.toLowerCase())}'
         AND lower(column_name) = '${esc(column.toLowerCase())}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

type PipeTable = 'wtl_pipe_lm' | 'wtl_sply_ls';

type PipeRec = {
  key: string; // table:ogc_fid (T자 분할 조각은 table:ogc_fid#조각번호)
  table: PipeTable;
  ogcFid: number;
  /** 원본 관로에서 이 조각의 시작·끝 비율(0~1). 분할하지 않았으면 0·1 */
  f0: number;
  f1: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  startKey: string;
  endKey: string;
  /** 추적이 끝난 뒤 추적된 관로에만 attachPipeGeometries 로 채운다 (속도: 전체 관로의 GeoJSON 변환 생략) */
  geom4326?: unknown;
  /** 관경(mm, std_dip). attachPipeGeometries 에서 함께 채운다. 없으면 null */
  dip?: number | null;
};

function kindToTable(kind: WtlSupplySourceKind): string {
  return kind === '정수장' ? 'wtl_puri_as' : 'wtl_serv_ps';
}

function kindToNameExpr(kind: WtlSupplySourceKind): string {
  return kind === '정수장'
    ? `COALESCE(NULLIF(trim(pur_nam),''), ogc_fid::text)`
    : `COALESCE(NULLIF(trim(srv_nam),''), ogc_fid::text)`;
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
         ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat,
         CASE WHEN GeometryType(t.geom) IN ('POLYGON', 'MULTIPOLYGON')
           THEN ST_AsGeoJSON(ST_Transform(t.geom, 4326), 6)::json
         END AS outline
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
      ...(r.outline ? { outline: r.outline as WtlSupplySourceDto['outline'] } : {}),
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

/**
 * 관로 테이블 전체를 추적 후보로 읽는다 (반경·개수 제한 없음).
 * 분할되지 않은 본관 중간에 다른 관로 끝이 닿은 T자 접속은 그 지점에서 나눠 노드로 만든다.
 */
async function loadPipesOfTable(table: PipeTable, snapM = 1): Promise<PipeRec[]> {
  if (!(await tableExists('layer', table))) return [];
  const baseSelect = `
         SELECT
           ogc_fid,
           CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END AS line
         FROM layer."${table}" pp
         WHERE pp.geom IS NOT NULL`;
  // T자 접속: 다른 관로의 끝점이 어떤 관로의 중간에 닿아 있으면(분할되지 않은 본관에 지관이 붙은 경우)
  // 그 지점에서 관로를 나눠 노드로 만든다. 나뉜 조각의 id 는 '<ogc_fid>#<조각번호>'.
  const splitSql = `WITH t AS (${baseSelect}
       ),
       lines AS (SELECT ogc_fid, line FROM t WHERE GeometryType(line) LIKE '%LINE%'),
       ends AS (
         SELECT ST_StartPoint(line) AS pt FROM lines
         UNION ALL
         SELECT ST_EndPoint(line) FROM lines
       ),
       cuts AS (
         -- 끝점마다 GiST 인덱스로 근처 관로만 찾는다 (LATERAL 로 원본 테이블을 직접 조회해야 인덱스를 탄다)
         -- (lines 와 조인하지 않는다: 구역 필터가 있으면 행 수 추정이 틀려 중첩 루프로 매우 느려짐.
         --  후보 밖 관로의 절단점은 아래 pieces 의 JOIN lines 에서 걸러진다)
         SELECT DISTINCT hit.ogc_fid,
                round(ST_LineLocatePoint(hit.line, e.pt)::numeric, 5)::double precision AS f
         FROM ends e
         CROSS JOIN LATERAL (
           SELECT m.ogc_fid,
                  CASE WHEN GeometryType(m.geom) LIKE 'MULTI%' THEN ST_GeometryN(m.geom, 1) ELSE m.geom END AS line
           FROM layer."${table}" m
           WHERE m.geom && ST_Expand(e.pt, ${T_SPLIT_TOUCH_M})
             AND ST_DWithin(m.geom, e.pt, ${T_SPLIT_TOUCH_M})
         ) hit
         WHERE GeometryType(hit.line) LIKE '%LINE%'
           AND ST_Distance(ST_StartPoint(hit.line), e.pt) > ${T_SPLIT_END_CLEAR_M}
           AND ST_Distance(ST_EndPoint(hit.line), e.pt) > ${T_SPLIT_END_CLEAR_M}
       ),
       breaks AS (
         -- cand: 후보 관로(lines)에서 온 행. 후보가 아닌 관로의 절단점은 아래에서 버린다
         SELECT ogc_fid, f, false AS cand FROM cuts
         UNION ALL SELECT ogc_fid, 0::double precision, true FROM lines
         UNION ALL SELECT ogc_fid, 1::double precision, true FROM lines
       ),
       seg AS (
         SELECT ogc_fid, f AS f0,
                lead(f) OVER w AS f1,
                row_number() OVER w - 1 AS piece,
                bool_or(cand) OVER (PARTITION BY ogc_fid) AS cand
         FROM breaks
         WINDOW w AS (PARTITION BY ogc_fid ORDER BY f)
       ),
       pieces AS (
         -- 조각 도형은 기본키로 원본 테이블에서 직접 읽는다 (lines CTE 와 조인하면 중첩 루프로 느려짐)
         SELECT s.ogc_fid, s.piece, s.f0, s.f1,
                CASE WHEN s.f0 = 0 AND s.f1 = 1 THEN l.line ELSE ST_LineSubstring(l.line, s.f0, s.f1) END AS line
         FROM seg s
         CROSS JOIN LATERAL (
           SELECT CASE WHEN GeometryType(m.geom) LIKE 'MULTI%' THEN ST_GeometryN(m.geom, 1) ELSE m.geom END AS line
           FROM layer."${table}" m
           WHERE m.ogc_fid = s.ogc_fid
         ) l
         WHERE s.cand AND s.f1 IS NOT NULL AND s.f1 - s.f0 > 0.000001
       )
       SELECT
         p.ogc_fid::text || CASE WHEN p.f0 = 0 AND p.f1 = 1 THEN '' ELSE '#' || p.piece::text END AS id,
         p.ogc_fid AS fid,
         p.f0,
         p.f1,
         ST_X(ST_StartPoint(p.line)) AS sx,
         ST_Y(ST_StartPoint(p.line)) AS sy,
         ST_X(ST_EndPoint(p.line)) AS ex,
         ST_Y(ST_EndPoint(p.line)) AS ey
       FROM pieces p
       WHERE GeometryType(p.line) LIKE '%LINE%'`;
  const res = await db.execute(sql.raw(splitSql));
  const out: PipeRec[] = [];
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const idText = String(r.id ?? '').trim();
    const ogcFid = Number(r.fid);
    const f0 = Number(r.f0);
    const f1 = Number(r.f1);
    const sx = Number(r.sx);
    const sy = Number(r.sy);
    const ex = Number(r.ex);
    const ey = Number(r.ey);
    if (!idText || ![ogcFid, f0, f1, sx, sy, ex, ey].every((n) => Number.isFinite(n))) continue;
    out.push({
      key: `${table}:${idText}`,
      table,
      ogcFid,
      f0,
      f1,
      sx,
      sy,
      ex,
      ey,
      startKey: nodeKey(sx, sy, snapM),
      endKey: nodeKey(ex, ey, snapM),
    });
  }
  return out;
}

/**
 * 추적된 관로에만 화면용 GeoJSON(EPSG:4326)을 붙인다.
 * T자 분할 조각은 원본 관로에서 f0~f1 구간을 잘라 낸다.
 */
async function attachPipeGeometries(pipes: PipeRec[]): Promise<void> {
  const byTable = new Map<PipeTable, PipeRec[]>();
  for (const p of pipes) {
    const list = byTable.get(p.table);
    if (list) list.push(p);
    else byTable.set(p.table, [p]);
  }
  const byKey = new Map(pipes.map((p) => [p.key, p]));
  for (const [table, list] of byTable) {
    // 관경(std_dip): 화면에서 본관·가지 굵기를 나누는 데 쓴다. 컬럼이 없는 테이블이면 null
    const dipSql = (await columnExists('layer', table, 'std_dip'))
      ? `NULLIF(regexp_replace(std_dip::text, '[^0-9.]', '', 'g'), '')::double precision`
      : 'NULL::double precision';
    const CHUNK = 2000;
    for (let i = 0; i < list.length; i += CHUNK) {
      const values = list
        .slice(i, i + CHUNK)
        .map(
          (p) =>
            `('${esc(p.key)}', ${Math.trunc(p.ogcFid)}, ${p.f0}::double precision, ${p.f1}::double precision)`
        )
        .join(',');
      const res = await db.execute(
        sql.raw(
          `WITH v(k, fid, f0, f1) AS (VALUES ${values})
           SELECT v.k,
                  ST_AsGeoJSON(ST_Transform(
                    CASE WHEN v.f0 = 0 AND v.f1 = 1 THEN l.line ELSE ST_LineSubstring(l.line, v.f0, v.f1) END,
                    4326
                  ))::json AS geom,
                  l.dip
           FROM v
           JOIN (
             SELECT ogc_fid,
                    CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END AS line,
                    ${dipSql} AS dip
             FROM layer."${table}"
             WHERE geom IS NOT NULL
           ) l ON l.ogc_fid = v.fid`
        )
      );
      for (const raw of res.rows ?? []) {
        const r = raw as { k?: unknown; geom?: unknown; dip?: unknown };
        const p = byKey.get(String(r.k ?? ''));
        if (!p) continue;
        p.geom4326 = r.geom;
        const dip = r.dip == null ? NaN : Number(r.dip);
        p.dip = Number.isFinite(dip) && dip > 0 ? dip : null;
      }
    }
  }
}

/**
 * 유수방향 = 관로 도형 시작→끝.
 * 시설 근처 관로를 시드로 잡고 끝점에서 «시작=이 노드»인 관로만 따라감.
 * 방문 순서대로 반환해 애니메이션에 사용.
 */
function traceDownstreamOrdered(
  pipes: PipeRec[],
  cx: number,
  cy: number,
  /** 관로 key → 그 관로 끝점에 닿은 시설(배수지) id. 닿은 관로는 거기서 추적을 멈춤 */
  endsAtFacility?: Map<string, string[]>
): { ordered: PipeRec[]; parent: Map<string, string | null> } {
  const byKey = new Map(pipes.map((p) => [p.key, p]));
  /** 관로 key → 그 관로로 흘러들어온 상류 관로 key (시드는 null) */
  const parent = new Map<string, string | null>();
  /** 노드 key → 그 노드로 흘러든 첫 관로 key (null = 시드 쪽 시작 노드) */
  const nodeOwner = new Map<string, string | null>();
  const stopsAt = (p: PipeRec) => (endsAtFacility?.get(p.key)?.length ?? 0) > 0;
  const outFromStart = new Map<string, PipeRec[]>();
  for (const p of pipes) {
    const list = outFromStart.get(p.startKey);
    if (list) list.push(p);
    else outFromStart.set(p.startKey, [p]);
  }

  const seedDist2 = SEED_PIPE_M * SEED_PIPE_M;
  const visited = new Set<string>();
  const ordered: PipeRec[] = [];
  const queued = new Set<string>();
  const queue: string[] = [];

  const enqueueNode = (k: string) => {
    if (!k || queued.has(k)) return;
    queued.add(k);
    queue.push(k);
  };

  // 시드: 시설 근처(SEED_PIPE_M)에서 «나가는» 관로 = 시작점이 끝점보다 시설에 가까운 관로.
  // 끝점이 시설 쪽인 관로는 시설로 들어오는 관로로 보고 시드에 넣지 않는다 (방향 보정 없음).
  const near = pipes
    .map((p) => {
      const dStart = dist2(cx, cy, p.sx, p.sy);
      const dEnd = dist2(cx, cy, p.ex, p.ey);
      const mx = (p.sx + p.ex) / 2;
      const my = (p.sy + p.ey) / 2;
      const dMid = dist2(cx, cy, mx, my);
      return { pipe: p, dLine: Math.min(dStart, dEnd, dMid), dStart, dEnd };
    })
    .filter((row) => row.dLine <= seedDist2 && row.dStart <= row.dEnd)
    .sort((a, b) => a.dLine - b.dLine)
    .slice(0, 20);

  for (const row of near) {
    const p = row.pipe;
    if (visited.has(p.key)) continue;
    visited.add(p.key);
    ordered.push(p);
    parent.set(p.key, null);
    if (stopsAt(p)) continue;
    if (!nodeOwner.has(p.endKey)) nodeOwner.set(p.endKey, p.key);
    enqueueNode(p.endKey);
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const p of outFromStart.get(node) ?? []) {
      if (visited.has(p.key)) continue;
      visited.add(p.key);
      ordered.push(p);
      parent.set(p.key, nodeOwner.get(node) ?? null);
      if (stopsAt(p)) continue; // 배수지에 닿으면 그 가지는 여기서 끝
      if (!nodeOwner.has(p.endKey)) nodeOwner.set(p.endKey, p.key);
      enqueueNode(p.endKey);
    }
  }

  return {
    ordered: ordered.map((p) => byKey.get(p.key)!).filter(Boolean),
    parent,
  };
}

/** 관로 끝점이 배수지에 닿았다고 보는 거리(m, EPSG:3857 단위) */
const FACILITY_REACH_M = 50;

/**
 * 후보 관로의 끝점이 닿는 배수지를 조회한다.
 * @returns ends: 관로 key → 닿은 배수지 id 목록, facilities: 배수지 id → 정보
 */
async function loadReservoirEnds(
  pipes: PipeRec[],
  excludeId: string,
  /** true 면 시작점도 조회 (방향 없는 추적용). startEnds 에 담긴다 */
  withStarts = false
): Promise<{
  ends: Map<string, string[]>;
  startEnds: Map<string, string[]>;
  facilities: Map<string, WtlSupplySourceDto>;
}> {
  const ends = new Map<string, string[]>();
  const startEnds = new Map<string, string[]>();
  const facilities = new Map<string, WtlSupplySourceDto>();
  const table = kindToTable('배수지');
  if (pipes.length === 0 || !(await tableExists('layer', table))) {
    return { ends, startEnds, facilities };
  }

  const add = (target: Map<string, string[]>, key: string, id: string) => {
    const list = target.get(key);
    if (list) {
      if (!list.includes(id)) list.push(id);
    } else {
      target.set(key, [id]);
    }
  };

  // 배수지(수십 곳)의 점 좌표를 관로 좌표계로 한 번만 받아 와 JS 에서 끝점과 거리 비교.
  // 관로 끝점 수만 건을 SQL 로 보내 비교하는 것보다 훨씬 빠르다.
  // 점이 아닌(면) 배수지가 섞여 있으면 정확한 거리 계산을 위해 SQL 경로를 쓴다.
  const pipeTable = pipes[0]!.table;
  const resv = await db.execute(
    sql.raw(
      `WITH ref AS (
         SELECT ST_SRID(geom) AS srid FROM layer."${pipeTable}" WHERE geom IS NOT NULL LIMIT 1
       )
       SELECT
         r.ogc_fid AS "ogcFid",
         ${kindToNameExpr('배수지').replace(/\b(srv_nam|ftr_idn|ogc_fid)\b/g, 'r.$1')} AS name,
         ST_X(ST_Transform(ST_Centroid(r.geom), 4326)) AS lon,
         ST_Y(ST_Transform(ST_Centroid(r.geom), 4326)) AS lat,
         GeometryType(r.geom) AS gt,
         (
           SELECT json_agg(json_build_array(ST_X(d.geom), ST_Y(d.geom)))
           FROM ST_DumpPoints(ST_Transform(r.geom, ref.srid)) d
         ) AS pts
       FROM layer."${table}" r, ref
       WHERE r.geom IS NOT NULL`
    )
  );
  type Resv = { id: string; info: WtlSupplySourceDto; pts: [number, number][]; isPoint: boolean };
  const reservoirs: Resv[] = [];
  for (const raw of resv.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const ogcFid = Number(r.ogcFid);
    const lon = Number(r.lon);
    const lat = Number(r.lat);
    if (![ogcFid, lon, lat].every((n) => Number.isFinite(n))) continue;
    const id = sourceId('배수지', ogcFid);
    if (id === excludeId) continue; // 출발 시설 자신은 제외
    const gt = String(r.gt ?? '').toUpperCase();
    const pts = (Array.isArray(r.pts) ? r.pts : [])
      .map((p) => [Number((p as unknown[])[0]), Number((p as unknown[])[1])] as [number, number])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    reservoirs.push({
      id,
      info: { id, kind: '배수지', name: asStr(r.name) || `배수지-${ogcFid}`, point: [lon, lat] },
      pts,
      isPoint: gt === 'POINT' || gt === 'MULTIPOINT',
    });
  }

  if (reservoirs.every((r) => r.isPoint)) {
    const reach2 = FACILITY_REACH_M * FACILITY_REACH_M;
    const hitsOf = (x: number, y: number): string[] => {
      const out: string[] = [];
      for (const r of reservoirs) {
        if (r.pts.some(([px, py]) => dist2(x, y, px, py) <= reach2)) out.push(r.id);
      }
      return out;
    };
    for (const p of pipes) {
      for (const id of hitsOf(p.ex, p.ey)) {
        add(ends, p.key, id);
        if (!facilities.has(id)) facilities.set(id, reservoirs.find((r) => r.id === id)!.info);
      }
      if (!withStarts) continue;
      for (const id of hitsOf(p.sx, p.sy)) {
        add(startEnds, p.key, id);
        if (!facilities.has(id)) facilities.set(id, reservoirs.find((r) => r.id === id)!.info);
      }
    }
    return { ends, startEnds, facilities };
  }

  // --- 면 배수지가 있을 때: SQL 로 정확한 거리 비교 (느림) ---
  // 키 접두 's|' 는 시작점 행
  const rows: string[] = [];
  for (const p of pipes) {
    if (Number.isFinite(p.ex) && Number.isFinite(p.ey)) {
      rows.push(`('${esc(p.key)}', ${p.ex}, ${p.ey})`);
    }
    if (withStarts && Number.isFinite(p.sx) && Number.isFinite(p.sy)) {
      rows.push(`('s|${esc(p.key)}', ${p.sx}, ${p.sy})`);
    }
  }
  const values = rows.join(',');
  if (!values) return { ends, startEnds, facilities };

  const res = await db.execute(
    sql.raw(
      `WITH pts(k, x, y) AS (VALUES ${values})
       SELECT pts.k AS k, r.ogc_fid AS "ogcFid"
       FROM pts
       JOIN layer."${table}" r
         ON r.geom IS NOT NULL
        AND ST_DWithin(
              r.geom,
              ST_SetSRID(ST_MakePoint(pts.x::double precision, pts.y::double precision), ST_SRID(r.geom)),
              ${FACILITY_REACH_M}
            )`
    )
  );
  const infoById = new Map(reservoirs.map((r) => [r.id, r.info]));
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const id = sourceId('배수지', Number(r.ogcFid));
    const info = infoById.get(id);
    if (!info) continue; // 출발 시설 자신 등
    const rawKey = String(r.k);
    const isStart = rawKey.startsWith('s|');
    add(isStart ? startEnds : ends, isStart ? rawKey.slice(2) : rawKey, id);
    if (!facilities.has(id)) facilities.set(id, info);
  }
  return { ends, startEnds, facilities };
}

function gateIdOf(ogcFid: number): string {
  return `gate-${ogcFid}`;
}

/** 추적 관로 끝점·중점에 붙은 제수변만 */
async function loadGatesOnPipes(
  pipes: PipeRec[],
  cx: number,
  cy: number,
  pad: number,
  /** true 면 조회 반경·개수 제한 없이 추적 관로에 붙은 제수변을 모두 반환 */
  unlimited = false
): Promise<WtlSupplyGateDto[]> {
  if (pipes.length === 0 || !(await tableExists('layer', 'wtl_valv_ps'))) return [];
  // 관로 시작·끝·중점에서 VALVE_NODE_M 이내만 붙으므로, 추적 관로 범위(+여유) 밖 제수변은 볼 필요가 없다.
  // (반경·개수 제한을 푼 경우에도 결과는 같고 조회량만 줄어든다)
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pipes) {
    minX = Math.min(minX, p.sx, p.ex);
    minY = Math.min(minY, p.sy, p.ey);
    maxX = Math.max(maxX, p.sx, p.ex);
    maxY = Math.max(maxY, p.sy, p.ey);
  }
  const m = VALVE_NODE_M;
  const bboxWhere = `AND t.geom && ST_MakeEnvelope(${minX - m}, ${minY - m}, ${maxX + m}, ${maxY + m}, ST_SRID(t.geom))`;
  // 초기(legacy, 제한 있음)는 비교용이라 기존 조건 그대로 둔다
  const radiusWhere = unlimited
    ? bboxWhere
    : `AND ST_DWithin(
           t.geom,
           ST_SetSRID(ST_MakePoint(${cx}, ${cy}), ST_SRID(t.geom)),
           ${pad}
         )`;
  const limitSql = unlimited ? '' : 'LIMIT 3000';
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
         ${radiusWhere}
       ${limitSql}`
    )
  );
  const tol2 = VALVE_NODE_M * VALVE_NODE_M;
  // 관로의 시작·끝·중점을 VALVE_NODE_M 크기 격자에 넣어 두고, 제수변은 주변 9칸만 확인한다
  const cell = VALVE_NODE_M;
  const grid = new Map<string, [number, number][]>();
  const put = (x: number, y: number) => {
    const k = `${Math.floor(x / cell)}_${Math.floor(y / cell)}`;
    const list = grid.get(k);
    if (list) list.push([x, y]);
    else grid.set(k, [[x, y]]);
  };
  for (const p of pipes) {
    put(p.sx, p.sy);
    put(p.ex, p.ey);
    put((p.sx + p.ex) / 2, (p.sy + p.ey) / 2);
  }
  const nearPipePoint = (x: number, y: number): boolean => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [px, py] of grid.get(`${gx + dx}_${gy + dy}`) ?? []) {
          if (dist2(x, y, px, py) <= tol2) return true;
        }
      }
    }
    return false;
  };
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
    if (!nearPipePoint(x, y)) continue;
    seen.add(ogcFid);
    const diameter = asStr(r.stdDip);
    out.push({
      id: gateIdOf(ogcFid),
      name: String(ogcFid),
      diameter: diameter ? `${diameter}mm` : '—',
      address: asStr(r.hjd) || '—',
      point: [lon, lat],
    });
    if (!unlimited && out.length >= GATE_MAX) break;
  }
  return out;
}

/**
 * 선택한 정수장·배수지에서 하류 송수경로.
 * 관로 도형 방향(시작→끝)을 유수 방향으로 보고 하류만 따라간다.
 * 방향 보정(역방향 관로 뒤집기)·학습된 연결 허용거리·케이스 보정은 적용하지 않는다.
 * 배수지에 닿은 가지는 거기서 끝난다.
 */
export async function analyzeWtlSupplyPath(params: {
  sourceId?: string;
  /** 도착 배수지 id. 지정하면 그 배수지로 이어지는 가지만 남김 */
  destinationId?: string;
}): Promise<{ result: WtlSupplyPathResultDto | null; error?: string }> {
  const parsed = parseSourceId(String(params.sourceId ?? ''));
  if (!parsed) {
    return { result: null, error: '시설을 선택하세요.' };
  }

  const loaded = await loadSourcePoint(parsed.kind, parsed.ogcFid);
  if (!loaded) {
    return { result: null, error: '선택한 시설을 찾을 수 없습니다.' };
  }

  // 송수경로는 정수장→배수지 본관 구간이므로 급수관(wtl_sply_ls)은 제외
  const pipes = await loadPipesOfTable('wtl_pipe_lm');
  if (pipes.length === 0) {
    return { result: null, error: '상수관로가 없습니다.' };
  }

  const reservoir = await loadReservoirEnds(pipes, loaded.source.id);
  const { ordered: tracedAll, parent } = traceDownstreamOrdered(
    pipes,
    loaded.x,
    loaded.y,
    reservoir.ends
  );
  if (tracedAll.length === 0) {
    return { result: null, error: '시설에서 나가는 하류 관로를 찾지 못했습니다.' };
  }

  // 추적 결과가 닿은 배수지 목록
  const destinations: WtlSupplySourceDto[] = [];
  const seenDest = new Set<string>();
  for (const p of tracedAll) {
    for (const id of reservoir.ends.get(p.key) ?? []) {
      if (seenDest.has(id)) continue;
      seenDest.add(id);
      const info = reservoir.facilities.get(id);
      if (info) destinations.push(info);
    }
  }

  // 도착 배수지를 지정하면 그 배수지에 닿은 관로의 상류 가지만 남김
  const destinationId = params.destinationId ? String(params.destinationId) : null;
  let traced = tracedAll;
  if (destinationId) {
    const terminals = tracedAll.filter((p) => reservoir.ends.get(p.key)?.includes(destinationId));
    if (terminals.length === 0) {
      return {
        result: null,
        error: '선택한 배수지까지 이어지는 송수 관로를 찾지 못했습니다.',
      };
    }
    const keep = new Set<string>();
    for (const t of terminals) {
      let k: string | null | undefined = t.key;
      while (k && !keep.has(k)) {
        keep.add(k);
        k = parent.get(k);
      }
    }
    traced = tracedAll.filter((p) => keep.has(p.key));
  }

  // 화면용 도형은 추적된 관로에만 조회 (후보 전체를 GeoJSON 으로 바꾸지 않음)
  await attachPipeGeometries(traced);

  // 좌표는 도형 방향(시작→끝) 그대로 = 유수 방향
  const lines: [number, number][][] = [];
  /** lines 와 같은 순서의 관로 key (순차 재생용 상류 관계 계산) */
  const lineKeys: string[] = [];
  for (const p of traced) {
    const line = parseLine(p.geom4326);
    if (!line || line.length < 2) continue;
    lineKeys.push(p.key);
    lines.push(line);
  }

  if (lines.length === 0) {
    return { result: null, error: '관로 도형을 읽지 못했습니다.' };
  }

  const gates = await loadGatesOnPipes(traced, loaded.x, loaded.y, TRACE_PAD_M, true);

  // 순차 재생용: 각 관로의 상류 관로 인덱스(lines 기준). 시드는 null.
  // 상류 관로가 도형 오류로 빠졌으면 그 위 조상으로 올라가 연결한다.
  const indexByKey = new Map(lineKeys.map((k, i) => [k, i]));
  const tracedByKey = new Map(traced.map((p) => [p.key, p]));
  const parentIndex: (number | null)[] = lineKeys.map((k) => {
    let up = parent.get(k) ?? null;
    let guard = 0;
    while (up && !indexByKey.has(up) && guard++ < 10000) up = parent.get(up) ?? null;
    return up ? (indexByKey.get(up) ?? null) : null;
  });

  return {
    result: {
      source: loaded.source,
      pipes: lines,
      pipeCount: lines.length,
      gates,
      parentIndex,
      pipeDiameters: lineKeys.map((k) => tracedByKey.get(k)?.dip ?? null),
      // 도착 배수지를 지정하면 그 배수지만 돌려준다.
      // (전체 목록을 주면 남은 가지가 닿지 않는 배수지에도 도착 강조가 생긴다.
      //  패널의 도착 배수지 버튼 목록은 «전체» 결과에서 받은 목록을 그대로 쓴다)
      destinations: destinationId
        ? destinations.filter((d) => d.id === destinationId)
        : destinations,
      destinationId,
    },
  };
}
