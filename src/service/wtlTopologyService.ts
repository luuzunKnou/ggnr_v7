/**
 * 위상검증 — 접합 미연결 · 유수방향(양방향 만남 · 역방향 관로)
 */
import { sql } from 'drizzle-orm';
import db from '@/database/db';

const CONNECT_M = 30;
const NODE_SNAP_M = 2.5; // 끝점 동일 노드로 보는 반올림 단위(m)
const PIPE_MAX = 8000;
const ISSUE_MAX = 1500;
const GATE_FTR = 'SA200';

export type WtlTopoIssueKind = '접합확인필요' | '유수방향 확인필요';

export type WtlTopoIssueDto = {
  id: string;
  kind: WtlTopoIssueKind;
  /** 세부: 미연결 | 양방향만남 | 역방향관로 */
  code: 'orphan' | 'flow_meet' | 'flow_reverse';
  target: string;
  detail: string;
  point: [number, number]; // lon,lat
  /** 관로 오류일 때 표시용 */
  line?: [number, number][];
  table?: string;
  ogcFid?: number;
  geomKind?: 'point' | 'line';
};

const EDITABLE_TABLES = new Set([
  'wtl_pipe_lm',
  'wtl_sply_ls',
  'wtl_puri_as',
  'wtl_serv_ps',
  'wtl_valv_ps',
  'wtl_flow_ps',
  'wtl_meta_ps',
]);

export type WtlTopoResultDto = {
  at: string;
  issues: WtlTopoIssueDto[];
  counts: {
    orphan: number;
    flowMeet: number;
    flowReverse: number;
    total: number;
  };
};

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function asStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function nodeKey(x: number, y: number): string {
  const s = NODE_SNAP_M;
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

type FacilityDef = {
  label: string;
  table: string;
  nameExpr: string;
  extraWhere?: string;
};

const FACILITIES: FacilityDef[] = [
  {
    label: '정수장',
    table: 'wtl_puri_as',
    nameExpr: `COALESCE(NULLIF(trim(pur_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
  },
  {
    label: '배수지',
    table: 'wtl_serv_ps',
    nameExpr: `COALESCE(NULLIF(trim(srv_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
  },
  {
    label: '제수변',
    table: 'wtl_valv_ps',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    extraWhere: `ftr_cde = '${GATE_FTR}'`,
  },
  {
    label: '유량계',
    table: 'wtl_flow_ps',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
  },
  {
    label: '계량기',
    table: 'wtl_meta_ps',
    nameExpr: `COALESCE(NULLIF(trim(met_num),''), NULLIF(trim(hom_num),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
  },
];

type PipeRec = {
  id: number;
  table: string;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  startKey: string;
  endKey: string;
  geom4326: unknown;
};

type PointRec = { x: number; y: number; lon: number; lat: number; name: string };

async function loadPipes(): Promise<PipeRec[]> {
  const out: PipeRec[] = [];
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    if (!(await tableExists('layer', table))) continue;
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
           LIMIT ${PIPE_MAX}
         ) t
         WHERE GeometryType(t.line) IN ('LINESTRING', 'MULTILINESTRING')
            OR GeometryType(t.line) LIKE '%LINE%'`
      )
    );
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
        table,
        sx,
        sy,
        ex,
        ey,
        startKey: nodeKey(sx, sy),
        endKey: nodeKey(ex, ey),
        geom4326: r.geom,
      });
    }
  }
  return out;
}

async function findOrphans(issues: WtlTopoIssueDto[]): Promise<void> {
  const pipeExists = (await tableExists('layer', 'wtl_pipe_lm'))
    ? `EXISTS (
         SELECT 1 FROM layer.wtl_pipe_lm p
         WHERE p.geom IS NOT NULL
           AND ST_DWithin(p.geom, ST_Centroid(t.geom), ${CONNECT_M})
       )`
    : 'FALSE';
  const splyExists = (await tableExists('layer', 'wtl_sply_ls'))
    ? `EXISTS (
         SELECT 1 FROM layer.wtl_sply_ls p
         WHERE p.geom IS NOT NULL
           AND ST_DWithin(p.geom, ST_Centroid(t.geom), ${CONNECT_M})
       )`
    : 'FALSE';

  for (const fac of FACILITIES) {
    if (issues.length >= ISSUE_MAX) return;
    if (!(await tableExists('layer', fac.table))) continue;
    const whereExtra = fac.extraWhere ? `AND ${fac.extraWhere}` : '';
    const limit = fac.table === 'wtl_meta_ps' ? 800 : 500;
    const res = await db.execute(
      sql.raw(
        `SELECT
           t.ogc_fid AS "ogcFid",
           ${fac.nameExpr} AS name,
           ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
           ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
         FROM layer."${fac.table}" t
         WHERE t.geom IS NOT NULL
           ${whereExtra}
           AND NOT (${pipeExists})
           AND NOT (${splyExists})
         ORDER BY t.ogc_fid
         LIMIT ${limit}`
      )
    );
    for (const raw of res.rows ?? []) {
      if (issues.length >= ISSUE_MAX) return;
      const r = raw as Record<string, unknown>;
      const ogcFid = Number(r.ogcFid);
      const lon = Number(r.lon);
      const lat = Number(r.lat);
      if (![ogcFid, lon, lat].every((n) => Number.isFinite(n))) continue;
      const name = asStr(r.name) || `${fac.label}-${ogcFid}`;
      issues.push({
        id: `orphan-${fac.table}-${ogcFid}`,
        kind: '접합확인필요',
        code: 'orphan',
        target: `${fac.label} ${name}`,
        detail: '연결된 관로가 없습니다.',
        point: [lon, lat],
        table: fac.table,
        ogcFid,
        geomKind: 'point',
      });
    }
  }
}

function findFlowMeet(pipes: PipeRec[], issues: WtlTopoIssueDto[]): void {
  const endsAt = new Map<string, PipeRec[]>();
  const startsAt = new Map<string, PipeRec[]>();
  const add = (m: Map<string, PipeRec[]>, k: string, p: PipeRec) => {
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  };
  for (const p of pipes) {
    add(endsAt, p.endKey, p);
    add(startsAt, p.startKey, p);
  }

  for (const [key, incoming] of endsAt) {
    if (issues.length >= ISSUE_MAX) return;
    if (incoming.length < 2) continue;
    const outgoing = startsAt.get(key) ?? [];
    // 양쪽(이상)에서 유입만 되고 하류로 이어지지 않음 = 양쪽에서 만남
    if (outgoing.length > 0) continue;
    const sample = incoming[0]!;
    const lonLat = (() => {
      // end point in 4326 from geom
      const line = parseLine(sample.geom4326);
      if (line && line.length >= 2) return line[line.length - 1]!;
      return null;
    })();
    if (!lonLat) continue;
    issues.push({
      id: `meet-${key}`,
      kind: '유수방향 확인필요',
      code: 'flow_meet',
      target: `관로 접합점 (${incoming.length}개 유입)`,
      detail: '유수방향이 한쪽으로 이어지지 않고 양쪽에서 만납니다.',
      point: lonLat,
      line: parseLine(sample.geom4326) ?? undefined,
      table: sample.table,
      ogcFid: sample.id,
      geomKind: 'line',
    });
  }
}

async function loadPlantPoints(): Promise<PointRec[]> {
  const out: PointRec[] = [];
  const defs = [
    {
      table: 'wtl_puri_as',
      nameExpr: `COALESCE(NULLIF(trim(pur_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    },
    {
      table: 'wtl_serv_ps',
      nameExpr: `COALESCE(NULLIF(trim(srv_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    },
  ];
  for (const d of defs) {
    if (!(await tableExists('layer', d.table))) continue;
    const res = await db.execute(
      sql.raw(
        `SELECT
           ${d.nameExpr} AS name,
           ST_X(ST_Centroid(t.geom)) AS x,
           ST_Y(ST_Centroid(t.geom)) AS y,
           ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
           ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
         FROM layer."${d.table}" t
         WHERE t.geom IS NOT NULL
         LIMIT 200`
      )
    );
    for (const raw of res.rows ?? []) {
      const r = raw as Record<string, unknown>;
      const x = Number(r.x);
      const y = Number(r.y);
      const lon = Number(r.lon);
      const lat = Number(r.lat);
      if (![x, y, lon, lat].every((n) => Number.isFinite(n))) continue;
      out.push({ x, y, lon, lat, name: asStr(r.name) });
    }
  }
  return out;
}

async function loadMeterPoints(): Promise<PointRec[]> {
  if (!(await tableExists('layer', 'wtl_meta_ps'))) return [];
  const res = await db.execute(
    sql.raw(
      `SELECT
         COALESCE(NULLIF(trim(met_num),''), NULLIF(trim(hom_num),''), NULLIF(trim(ftr_idn),''), ogc_fid::text) AS name,
         ST_X(ST_Centroid(t.geom)) AS x,
         ST_Y(ST_Centroid(t.geom)) AS y,
         ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
         ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
       FROM layer.wtl_meta_ps t
       WHERE t.geom IS NOT NULL
       LIMIT 4000`
    )
  );
  const out: PointRec[] = [];
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const x = Number(r.x);
    const y = Number(r.y);
    const lon = Number(r.lon);
    const lat = Number(r.lat);
    if (![x, y, lon, lat].every((n) => Number.isFinite(n))) continue;
    out.push({ x, y, lon, lat, name: asStr(r.name) });
  }
  return out;
}

function nearestDist2(px: number, py: number, pts: PointRec[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of pts) {
    const d = dist2(px, py, p.x, p.y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 정수장·배수지 → 계량기 방향이어야 하는데,
 * 계량기 쪽에서 시작(시작점이 계량기에 가깝고) 정수장·배수지 쪽으로 흘러가는 관로 = 역방향
 */
function findFlowReverse(
  pipes: PipeRec[],
  plants: PointRec[],
  meters: PointRec[],
  issues: WtlTopoIssueDto[]
): void {
  if (plants.length === 0 || meters.length === 0) return;
  const nearMeter2 = CONNECT_M * CONNECT_M * 4; // 계량기 근처 관로만

  for (const p of pipes) {
    if (issues.length >= ISSUE_MAX) return;
    const dStartMeter = nearestDist2(p.sx, p.sy, meters);
    const dEndMeter = nearestDist2(p.ex, p.ey, meters);
    // 계량기와 무관한 관로는 스킵
    if (Math.min(dStartMeter, dEndMeter) > nearMeter2) continue;

    const dStartPlant = nearestDist2(p.sx, p.sy, plants);
    const dEndPlant = nearestDist2(p.ex, p.ey, plants);

    // 정상: 시작이 정수장쪽에 가깝고 끝이 계량기쪽에 가깝다
    // 역방향: 시작이 계량기에 더 가깝고, 끝이 정수장·배수쪽에 더 가깝다
    const startCloserToMeter = dStartMeter < dEndMeter;
    const endCloserToPlant = dEndPlant < dStartPlant;
    if (!(startCloserToMeter && endCloserToPlant)) continue;

    const line = parseLine(p.geom4326);
    if (!line || line.length < 2) continue;
    const mid = line[Math.floor(line.length / 2)]!;
    issues.push({
      id: `rev-${p.table}-${p.id}`,
      kind: '유수방향 확인필요',
      code: 'flow_reverse',
      target: `관로 #${p.id}`,
      detail: '정수장·배수지 → 계량기 방향과 반대로 도화되어 있습니다.',
      point: mid,
      line,
      table: p.table,
      ogcFid: p.id,
      geomKind: 'line',
    });
  }
}

/**
 * 위상검증 실행
 */
export async function analyzeWtlTopology(): Promise<{
  result: WtlTopoResultDto | null;
  error?: string;
}> {
  const pipes = await loadPipes();
  if (pipes.length === 0) {
    return { result: null, error: '상수관로 레이어가 없거나 비어 있습니다.' };
  }

  const issues: WtlTopoIssueDto[] = [];
  await findOrphans(issues);
  findFlowMeet(pipes, issues);

  const [plants, meters] = await Promise.all([loadPlantPoints(), loadMeterPoints()]);
  findFlowReverse(pipes, plants, meters, issues);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const orphan = issues.filter((i) => i.code === 'orphan').length;
  const flowMeet = issues.filter((i) => i.code === 'flow_meet').length;
  const flowReverse = issues.filter((i) => i.code === 'flow_reverse').length;

  return {
    result: {
      at,
      issues,
      counts: {
        orphan,
        flowMeet,
        flowReverse,
        total: issues.length,
      },
    },
  };
}

/**
 * 관로 유수방향 반전 (도형 ST_Reverse)
 */
export async function reverseWtlTopoPipe(params: {
  table?: string;
  ogcFid?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const table = String(params.table ?? '');
  const ogcFid = Number(params.ogcFid);
  if (!EDITABLE_TABLES.has(table) || !['wtl_pipe_lm', 'wtl_sply_ls'].includes(table)) {
    return { ok: false, error: '반전할 수 있는 관로가 아닙니다.' };
  }
  if (!Number.isFinite(ogcFid)) return { ok: false, error: '관로 식별자가 올바르지 않습니다.' };
  if (!(await tableExists('layer', table))) {
    return { ok: false, error: '관로 테이블이 없습니다.' };
  }
  await db.execute(
    sql.raw(
      `UPDATE layer."${esc(table)}"
       SET geom = ST_Reverse(geom)
       WHERE ogc_fid = ${ogcFid}
         AND geom IS NOT NULL`
    )
  );
  return { ok: true };
}

/**
 * 기존 시설·관로 도형 즉시 수정 (GeoJSON 4326)
 */
export async function updateWtlTopoGeom(params: {
  table?: string;
  ogcFid?: number;
  geojson?: unknown;
}): Promise<{ ok: boolean; error?: string }> {
  const table = String(params.table ?? '');
  const ogcFid = Number(params.ogcFid);
  if (!EDITABLE_TABLES.has(table) || !Number.isFinite(ogcFid)) {
    return { ok: false, error: '수정 대상이 올바르지 않습니다.' };
  }
  if (!(await tableExists('layer', table))) {
    return { ok: false, error: '대상 테이블이 없습니다.' };
  }
  const geo = params.geojson;
  if (!geo || typeof geo !== 'object') {
    return { ok: false, error: '도형 정보가 없습니다.' };
  }
  const geoText = JSON.stringify(geo).replace(/'/g, "''");
  await db.execute(
    sql.raw(
      `UPDATE layer."${esc(table)}"
       SET geom = ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${geoText}'), 4326), ST_SRID(geom))
       WHERE ogc_fid = ${ogcFid}
         AND geom IS NOT NULL`
    )
  );
  return { ok: true };
}

/**
 * 관로·시설 추가 (즉시) — geom만 넣은 최소 INSERT
 * 필수 속성이 많은 테이블은 실패할 수 있음 → 호출측에서 반영요청으로 유도
 */
export async function insertWtlTopoFeature(params: {
  table?: string;
  geojson?: unknown;
}): Promise<{ ok: boolean; ogcFid?: number; error?: string }> {
  const table = String(params.table ?? '');
  if (!EDITABLE_TABLES.has(table)) {
    return { ok: false, error: '추가할 수 있는 레이어가 아닙니다.' };
  }
  if (!(await tableExists('layer', table))) {
    return { ok: false, error: '대상 테이블이 없습니다.' };
  }
  const geo = params.geojson;
  if (!geo || typeof geo !== 'object') {
    return { ok: false, error: '도형 정보가 없습니다.' };
  }
  const geoText = JSON.stringify(geo).replace(/'/g, "''");
  try {
    const res = await db.execute(
      sql.raw(
        `INSERT INTO layer."${esc(table)}" (geom)
         SELECT ST_Transform(
           ST_SetSRID(ST_GeomFromGeoJSON('${geoText}'), 4326),
           COALESCE((SELECT ST_SRID(geom) FROM layer."${esc(table)}" WHERE geom IS NOT NULL LIMIT 1), 5181)
         )
         RETURNING ogc_fid AS "ogcFid"`
      )
    );
    const ogcFid = Number((res.rows?.[0] as { ogcFid?: number } | undefined)?.ogcFid);
    if (!Number.isFinite(ogcFid)) {
      return { ok: false, error: '추가됐으나 식별자를 읽지 못했습니다.' };
    }
    return { ok: true, ogcFid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '추가에 실패했습니다.';
    return { ok: false, error: msg };
  }
}
