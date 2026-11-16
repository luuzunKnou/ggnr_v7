/**
 * 위상검증 — 접합 미연결 · 유수방향(양방향 만남 · 역방향 관로)
 */
import { sql } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import db from '@/database/db';
import { getGeoServerInternalBase } from '@/lib/geoserverUrl';
import { readWtlLayerLineColor, readWtlPipeLmMapStrokeColor } from '@/lib/geoserverStyleFillColor';

const CONNECT_M = 30;
/** 접합확인필요: 시설이 관로에 붙었다고 보는 거리(m). 도화 어긋남 여유. CONNECT_M보다 짧게. */
const ORPHAN_CONNECT_M = 1.5;
const NODE_SNAP_M = 2.5; // 끝점 동일 노드로 보는 반올림 단위(m)
const GATE_FTR = 'SA200';
/** 서로 갈라짐 제외: 제수변·유량계·계량기가 이 거리(m) 안에 있으면 정상 분기 */
const SPLIT_FACILITY_NEAR_M = 5;
/**
 * 물이 흐르지 않는 상수관 용도 — 위상검증(연결·방향·중복)에서 제외한다.
 * SAA917 폐관: 신관 옆에 남아 겹쳐 보이거나 끊긴 채로 남아 오탐을 만든다.
 */
const OUT_OF_SERVICE_SAA = ['SAA917'];
/** 막힌 끝 판정: 이 거리(m) 안에 다른 상수관이 있으면 끊김으로 보고 방향을 판단하지 않는다 */
const DEAD_END_GAP_M = 10;
/** 운영 중인 상수관만 고르는 SQL 조건 (alias는 'm.' 처럼 점까지) */
function activeMainSql(alias = ''): string {
  const list = OUT_OF_SERVICE_SAA.map((c) => `'${c}'`).join(', ');
  return `COALESCE(upper(trim(${alias}saa_cde::text)), '') NOT IN (${list})`;
}
/** 송수관 방향 판정: 관로 길이 대비 이 비율 이상 뚜렷해야 방향 신호로 본다 */
const TRUNK_STRONG = 0.9;
/** 다른 신호가 이 비율까지는 반대로 가도 허용 */
const TRUNK_TOLERANT = 0.5;

export type WtlTopoIssueKind = '접합확인필요' | '유수방향 확인필요';

/** 양방향 만남 목록 라벨용 */
export type WtlTopoMeetSubtype =
  | 'head_on'
  | 'multi_merge'
  | 'one_flip'
  | 'dead_end'
  /** 상수관이 한 점에서 모두 시작(유입 없음) */
  | 'split';

/** 방향 판정 근거 */
export type WtlTopoBasis = 'main' | 'meter' | 'continuity' | 'facility' | 'unknown';

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
  /** 양방향 만남 세부 유형 (목록 라벨) */
  meetSubtype?: WtlTopoMeetSubtype;
  meetSubtypeLabel?: string;
  /** 방향 판정 근거 (main=상수관 접합, meter=계량기, continuity=이웃 관 연속성, facility=정수장→배수지 흐름, unknown=근거 없음) */
  basis?: WtlTopoBasis;
  /** 접합점에 모인 유입 관로 전부 */
  relatedPipes?: {
    table: string;
    ogcFid: number;
    /** 반전 추천(표시만, 자동 확정 아님) */
    recommended?: boolean;
  }[];
};

/** 위상검증에서 관로 추가 시 고를 수 있는 상수관 용도코드 (송수관·배수관·기타) */
const TOPO_INSERT_SAA_CODES = new Set(['SAA003', 'SAA004', 'SAA999']);

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

/**
 * 끝점 클러스터링 — 거리 NODE_SNAP_M 이내 끝점을 같은 노드로 묶는다.
 * 단순 반올림 격자는 경계에 걸린 가까운 점이 서로 다른 노드가 되므로,
 * 격자 셀 + 인접 8셀 후보를 거리로 비교하고 union-find로 연결 성분을 만든다.
 * 좌표는 미터 단위 투영좌표(layer 테이블 SRID, 예: 5181)를 가정한다.
 */
function assignNodeKeys(pipes: PipeRec[]): void {
  const s = NODE_SNAP_M;
  const pts: { x: number; y: number }[] = [];
  for (const p of pipes) {
    pts.push({ x: p.sx, y: p.sy }, { x: p.ex, y: p.ey });
  }
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[i] !== r) {
      const n = parent[i]!;
      parent[i] = r;
      i = n;
    }
    return r;
  };
  const cells = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / s);
  pts.forEach((pt, i) => {
    const k = `${cellOf(pt.x)}_${cellOf(pt.y)}`;
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  });
  pts.forEach((pt, i) => {
    const cx = cellOf(pt.x);
    const cy = cellOf(pt.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = cells.get(`${cx + dx}_${cy + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const o = pts[j]!;
          if (Math.hypot(o.x - pt.x, o.y - pt.y) <= s) {
            const a = find(i);
            const b = find(j);
            if (a !== b) parent[b] = a;
          }
        }
      }
    }
  });
  pipes.forEach((p, idx) => {
    p.startKey = `n${find(idx * 2)}`;
    p.endKey = `n${find(idx * 2 + 1)}`;
  });
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
    nameExpr: `COALESCE(NULLIF(trim(pur_nam),''), ogc_fid::text)`,
  },
  {
    label: '배수지',
    table: 'wtl_serv_ps',
    nameExpr: `COALESCE(NULLIF(trim(srv_nam),''), ogc_fid::text)`,
  },
  {
    label: '제수변',
    table: 'wtl_valv_ps',
    nameExpr: `ogc_fid::text`,
    extraWhere: `upper(trim(ftr_cde::text)) = 'SA200'`,
  },
  {
    label: '이토변',
    table: 'wtl_valv_ps',
    nameExpr: `ogc_fid::text`,
    extraWhere: `upper(trim(ftr_cde::text)) = 'SA202'`,
  },
  {
    label: '배기변',
    table: 'wtl_valv_ps',
    nameExpr: `ogc_fid::text`,
    extraWhere: `upper(trim(ftr_cde::text)) = 'SA203'`,
  },
  {
    label: '감압변',
    table: 'wtl_valv_ps',
    nameExpr: `ogc_fid::text`,
    extraWhere: `upper(trim(ftr_cde::text)) = 'SA204'`,
  },
  {
    label: '변류시설',
    table: 'wtl_valv_ps',
    nameExpr: `ogc_fid::text`,
    /** 코드표에 한글명이 없는 기타 변류(예: SA207) */
    extraWhere: `upper(trim(ftr_cde::text)) NOT IN ('SA200','SA202','SA203','SA204')
      AND nullif(trim(ftr_cde::text), '') IS NOT NULL`,
  },
  {
    label: '유량계',
    table: 'wtl_flow_ps',
    nameExpr: `ogc_fid::text`,
  },
  {
    label: '계량기',
    table: 'wtl_meta_ps',
    nameExpr: `COALESCE(NULLIF(trim(met_num),''), NULLIF(trim(hom_num),''), ogc_fid::text)`,
  },
];

/**
 * 관로 선 파트 쿼리 조각.
 * 이어진 멀티라인은 ST_LineMerge로 한 줄로 합치고, 끊어진 파트는 ST_Dump로 각각 한 레코드로 만든다.
 * (ogc_fid, ftr_idn, saa, part, line) 반환.
 */
function linePartsSql(table: string): string {
  // 상수관용도(saa_cde)는 상수관 테이블에만 있다
  const saaExpr =
    table === 'wtl_pipe_lm' ? `NULLIF(upper(trim(saa_cde::text)), '')` : `NULL::text`;
  return `(
    SELECT s.ogc_fid, s.ftr_idn, s.saa, COALESCE((s.d).path[1], 1) AS part, (s.d).geom AS line
    FROM (
      SELECT ogc_fid, NULLIF(trim(ftr_idn::text), '') AS ftr_idn, ${saaExpr} AS saa, ST_Dump(ST_LineMerge(geom)) AS d
      FROM layer."${table}"
      WHERE geom IS NOT NULL AND GeometryType(geom) LIKE '%LINESTRING%'
        ${table === 'wtl_pipe_lm' ? `AND ${activeMainSql()}` : ''}
    ) s
    WHERE GeometryType((s.d).geom) LIKE '%LINESTRING%'
  )`;
}

type PipeRec = {
  /** `${table}:${id}:${part}` — 파트 단위 고유 키 */
  key: string;
  id: number;
  /** 멀티라인에서 합쳐지지 않은 파트 번호(1부터) */
  part: number;
  /** 관리번호(ftr_idn) — 화면 표시용. 없으면 null */
  ftrIdn: string | null;
  /** 상수관용도(saa_cde, 대문자). 급수관·미분류는 null */
  saa: string | null;
  table: string;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  startKey: string;
  endKey: string;
  geom4326: unknown;
};

async function loadPipes(): Promise<PipeRec[]> {
  const out: PipeRec[] = [];
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    if (!(await tableExists('layer', table))) continue;
    const res = await db.execute(
      sql.raw(
        `SELECT
           t.ogc_fid AS id,
           t.part AS part,
           t.ftr_idn AS ftr_idn,
           t.saa AS saa,
           ST_X(ST_StartPoint(t.line)) AS sx,
           ST_Y(ST_StartPoint(t.line)) AS sy,
           ST_X(ST_EndPoint(t.line)) AS ex,
           ST_Y(ST_EndPoint(t.line)) AS ey,
           ST_AsGeoJSON(ST_Transform(t.line, 4326))::json AS geom
         FROM ${linePartsSql(table)} t`
      )
    );
    for (const raw of res.rows ?? []) {
      const r = raw as Record<string, unknown>;
      const id = Number(r.id);
      const part = Number(r.part) || 1;
      const sx = Number(r.sx);
      const sy = Number(r.sy);
      const ex = Number(r.ex);
      const ey = Number(r.ey);
      if (![id, sx, sy, ex, ey].every((n) => Number.isFinite(n))) continue;
      out.push({
        key: `${table}:${id}:${part}`,
        id,
        part,
        ftrIdn: r.ftr_idn == null ? null : String(r.ftr_idn),
        saa: r.saa == null ? null : String(r.saa),
        table,
        sx,
        sy,
        ex,
        ey,
        startKey: '',
        endKey: '',
        geom4326: r.geom,
      });
    }
  }
  assignNodeKeys(out);
  return out;
}

async function findOrphans(issues: WtlTopoIssueDto[]): Promise<void> {
  const pipeExists = (await tableExists('layer', 'wtl_pipe_lm'))
    ? `EXISTS (
         SELECT 1 FROM layer.wtl_pipe_lm p
         WHERE p.geom IS NOT NULL
           AND ${activeMainSql('p.')}
           AND ST_DWithin(p.geom, ST_Centroid(t.geom), ${ORPHAN_CONNECT_M})
       )`
    : 'FALSE';
  const splyExists = (await tableExists('layer', 'wtl_sply_ls'))
    ? `EXISTS (
         SELECT 1 FROM layer.wtl_sply_ls p
         WHERE p.geom IS NOT NULL
           AND ST_DWithin(p.geom, ST_Centroid(t.geom), ${ORPHAN_CONNECT_M})
       )`
    : 'FALSE';

  for (const fac of FACILITIES) {
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

function inboundUnit(p: PipeRec): [number, number] | null {
  const dx = p.ex - p.sx;
  const dy = p.ey - p.sy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return null;
  return [dx / len, dy / len];
}

type MeterTouch = { dStart: number; dEnd: number };

/**
 * 급수관에 맞닿은 계량기만.
 * 맞닿은 계량기가 없으면 null. 끝점 쪽이 더 가까우면 end, 시작점만이면 start.
 */
function supplyMeterSide(touches: MeterTouch[] | undefined): 'start' | 'end' | null {
  if (!touches || touches.length === 0) return null;
  // 선 중간에 있는 계량기는 방향 근거가 아니다 → 더 가까운 끝점이 NODE_SNAP_M 이내일 때만 인정
  if (supplyEndTouchesMeter(touches)) return 'end';
  if (supplyStartTouchesMeter(touches)) return 'start';
  return null;
}

/** 급수관 도형에 맞닿은 계량기 (선과 2.5m 이내) */
async function loadSupplyMeterTouches(): Promise<Map<string, MeterTouch[]>> {
  const map = new Map<string, MeterTouch[]>();
  if (!(await tableExists('layer', 'wtl_sply_ls'))) return map;
  if (!(await tableExists('layer', 'wtl_meta_ps'))) return map;
  const res = await db.execute(
    sql.raw(
      `SELECT
         p.ogc_fid AS id,
         p.part AS part,
         ST_Distance(ST_StartPoint(p.line), m.geom) AS d_start,
         ST_Distance(ST_EndPoint(p.line), m.geom) AS d_end
       FROM ${linePartsSql('wtl_sply_ls')} p
       JOIN layer.wtl_meta_ps m
         ON m.geom IS NOT NULL
        AND ST_DWithin(p.line, m.geom, ${NODE_SNAP_M})`
    )
  );
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id);
    const part = Number(r.part) || 1;
    const dStart = Number(r.d_start);
    const dEnd = Number(r.d_end);
    if (![id, dStart, dEnd].every((n) => Number.isFinite(n))) continue;
    const k = `${id}:${part}`;
    const list = map.get(k);
    const touch = { dStart, dEnd };
    if (list) list.push(touch);
    else map.set(k, [touch]);
  }
  return map;
}

type MainAttach = { start: boolean; end: boolean };

/** 급수관 끝점에서 가장 가까운 상수관까지 거리(NODE_SNAP_M 밖이면 null) */
type MainAttachRaw = { dStart: number | null; dEnd: number | null };

/**
 * 상수관과 "정확히 닿은" 것으로 보는 거리(m).
 * 이보다 멀면서 다른 급수관과 이어진 끝점은, 상수관이 근처를 지날 뿐 접합이 아니라고 본다.
 */
const MAIN_EXACT_M = 0.3;
/** 양끝이 모두 상수관 근처일 때, 두 거리 차가 이 값 이하면 어느 쪽이 접합인지 구분할 수 없다. */
const MAIN_TIE_M = 0.05;

/** 급수관 양끝에서 상수관까지의 최단 거리 (판정은 resolveMainAttach) */
async function loadSupplyMainAttachRaw(): Promise<Map<string, MainAttachRaw>> {
  const map = new Map<string, MainAttachRaw>();
  if (!(await tableExists('layer', 'wtl_sply_ls'))) return map;
  if (!(await tableExists('layer', 'wtl_pipe_lm'))) return map;
  const res = await db.execute(
    sql.raw(
      `SELECT
         p.ogc_fid AS id,
         p.part AS part,
         (SELECT MIN(ST_Distance(ST_StartPoint(p.line), m.geom))
            FROM layer.wtl_pipe_lm m
           WHERE m.geom IS NOT NULL
             AND ${activeMainSql('m.')}
             AND ST_DWithin(ST_StartPoint(p.line), m.geom, ${NODE_SNAP_M})) AS d_start,
         (SELECT MIN(ST_Distance(ST_EndPoint(p.line), m.geom))
            FROM layer.wtl_pipe_lm m
           WHERE m.geom IS NOT NULL
             AND ${activeMainSql('m.')}
             AND ST_DWithin(ST_EndPoint(p.line), m.geom, ${NODE_SNAP_M})) AS d_end
       FROM ${linePartsSql('wtl_sply_ls')} p`
    )
  );
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id);
    if (!Number.isFinite(id)) continue;
    const part = Number(r.part) || 1;
    const dStart = r.d_start == null ? null : Number(r.d_start);
    const dEnd = r.d_end == null ? null : Number(r.d_end);
    if (dStart == null && dEnd == null) continue;
    map.set(`${id}:${part}`, { dStart, dEnd });
  }
  return map;
}

/**
 * 급수관 끝이 상수관에 접합했는지 확정한다. 붙은 쪽이 시작점이어야 정상.
 * 2.5m 근접만으로는 상수관 옆을 지나는 급수관의 반대쪽 끝이 접합으로 잡히므로 두 가지를 보정한다.
 * 1) 끝점이 상수관에서 MAIN_EXACT_M보다 멀고 다른 급수관과 이어져 있으면 접합이 아니다(급수관끼리 연결).
 * 2) 양끝이 모두 남으면 상수관에 더 가까운 쪽만 접합으로 본다. 거리 차가 MAIN_TIE_M 이하면 양쪽 유지(판단 불가).
 */
function resolveMainAttach(
  pipes: PipeRec[],
  idx: NodeIndex,
  raw: Map<string, MainAttachRaw>
): Map<string, MainAttach> {
  const out = new Map<string, MainAttach>();
  for (const p of pipes) {
    if (p.table !== 'wtl_sply_ls') continue;
    const k = supplyKey(p);
    const r = raw.get(k);
    if (!r) continue;
    const joinsSply = (nodeKey: string) =>
      [...othersAt(idx.startsAt, nodeKey, p), ...othersAt(idx.endsAt, nodeKey, p)].some(
        (o) => o.table === 'wtl_sply_ls'
      );
    let ds = r.dStart;
    let de = r.dEnd;
    if (ds != null && ds > MAIN_EXACT_M && joinsSply(p.startKey)) ds = null;
    if (de != null && de > MAIN_EXACT_M && joinsSply(p.endKey)) de = null;
    let start = ds != null;
    let end = de != null;
    if (start && end && Math.abs(ds! - de!) > MAIN_TIE_M) {
      if (ds! < de!) end = false;
      else start = false;
    }
    if (!start && !end) continue;
    out.set(k, { start, end });
  }
  return out;
}

/** 노드 인덱스: 노드 키별로 그 점에서 시작/끝나는 관로 */
type NodeIndex = {
  startsAt: Map<string, PipeRec[]>;
  endsAt: Map<string, PipeRec[]>;
};

function buildNodeIndex(pipes: PipeRec[]): NodeIndex {
  const startsAt = new Map<string, PipeRec[]>();
  const endsAt = new Map<string, PipeRec[]>();
  const add = (m: Map<string, PipeRec[]>, k: string, p: PipeRec) => {
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  };
  for (const p of pipes) {
    add(endsAt, p.endKey, p);
    add(startsAt, p.startKey, p);
  }
  return { startsAt, endsAt };
}

type FlowCtx = NodeIndex & {
  supplyTouches: Map<string, MeterTouch[]>;
  mainAttach: Map<string, MainAttach>;
  /** 송수관(SAA003) 파트별 방향 판정: 정수장→배수지 흐름 기준 */
  trunk: Map<string, 'reverse' | 'ok'>;
  /** 한쪽 끝이 막힌 상수관 방향 판정: 연결된 끝 → 막힌 끝 */
  deadEnd: Map<string, 'reverse' | 'ok'>;
};

/** 급수관 파트 단위 조회 키 (supplyTouches · mainAttach) */
function supplyKey(p: PipeRec): string {
  return `${p.id}:${p.part}`;
}

/** 해당 노드에 모인 관로 중 자기 자신을 뺀 것 */
function othersAt(map: Map<string, PipeRec[]>, nodeKey: string, self: PipeRec): PipeRec[] {
  return (map.get(nodeKey) ?? []).filter((o) => o.key !== self.key);
}

/**
 * 끝만 상수관이면 반전, 시작만 상수관이면 정상, 둘 다·둘 다 아니면 판단 안 함.
 * 급수관은 상수관에서 물을 받아 나가므로, 시작점에 다른 관이 붙어 있어도 상수관 쪽이 끝점이면 역방향이다.
 */
function supplyMainSide(att: MainAttach | undefined): 'reverse' | 'ok' | null {
  if (!att) return null;
  if (att.end && !att.start) return 'reverse';
  if (att.start && !att.end) return 'ok';
  return null;
}

/** 접합점(끝점)이 계량기에 맞닿으면 계량기로 모이는 정상 흐름이다. */
function supplyEndTouchesMeter(touches: MeterTouch[] | undefined): boolean {
  if (!touches) return false;
  return touches.some((t) => t.dEnd <= NODE_SNAP_M && t.dEnd <= t.dStart);
}

/** 시작점 2.5m 안에 계량기가 있고, 그 계량기가 끝점보다 시작점에 가깝다. */
function supplyStartTouchesMeter(touches: MeterTouch[] | undefined): boolean {
  if (!touches) return false;
  return touches.some((t) => t.dStart <= NODE_SNAP_M && t.dStart < t.dEnd);
}

type SupplyVerdict = { verdict: 'reverse' | 'ok' | 'unknown'; basis: WtlTopoBasis };

/**
 * 급수관 방향 판정 — 역방향 탐지와 반전 추천이 같은 기준을 쓰도록 한 곳에 둔다.
 * 1) 상수관 접합 2) 계량기 위치. 둘 다 근거가 없으면 unknown.
 */
function supplyVerdict(p: PipeRec, ctx: FlowCtx): SupplyVerdict {
  const main = supplyMainSide(ctx.mainAttach.get(supplyKey(p)));
  if (main === 'reverse') return { verdict: 'reverse', basis: 'main' };
  if (main === 'ok') return { verdict: 'ok', basis: 'main' };
  const side = supplyMeterSide(ctx.supplyTouches.get(supplyKey(p)));
  if (side === 'start') return { verdict: 'reverse', basis: 'meter' };
  if (side === 'end') return { verdict: 'ok', basis: 'meter' };
  return { verdict: 'unknown', basis: 'unknown' };
}

/** 송수관(SAA003)에서 정수장·배수지에 닿은 노드 (끝점이 시설 CONNECT_M 이내) */
async function loadTrunkTerminals(
  trunkPipes: PipeRec[]
): Promise<{ sources: Set<string>; sinks: Set<string> }> {
  const sources = new Set<string>();
  const sinks = new Set<string>();
  if (trunkPipes.length === 0) return { sources, sinks };
  const touch = async (table: string, end: 'StartPoint' | 'EndPoint'): Promise<string> =>
    (await tableExists('layer', table))
      ? `EXISTS (SELECT 1 FROM layer.${table} f WHERE f.geom IS NOT NULL AND ST_DWithin(f.geom, ST_${end}(p.line), ${CONNECT_M}))`
      : 'FALSE';
  const res = await db.execute(
    sql.raw(
      `SELECT p.ogc_fid AS id, p.part AS part,
         ${await touch('wtl_puri_as', 'StartPoint')} AS s_puri,
         ${await touch('wtl_puri_as', 'EndPoint')} AS e_puri,
         ${await touch('wtl_serv_ps', 'StartPoint')} AS s_serv,
         ${await touch('wtl_serv_ps', 'EndPoint')} AS e_serv
       FROM ${linePartsSql('wtl_pipe_lm')} p
       WHERE p.saa = 'SAA003'`
    )
  );
  const byKey = new Map(trunkPipes.map((p) => [`${p.id}:${p.part}`, p]));
  const yes = (v: unknown) => v === true || v === 't';
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const p = byKey.get(`${Number(r.id)}:${Number(r.part) || 1}`);
    if (!p) continue;
    if (yes(r.s_puri)) sources.add(p.startKey);
    if (yes(r.e_puri)) sources.add(p.endKey);
    if (yes(r.s_serv)) sinks.add(p.startKey);
    if (yes(r.e_serv)) sinks.add(p.endKey);
  }
  return { sources, sinks };
}

/** 송수관 그래프(무방향)에서 시작 노드들로부터의 최단 거리(m, 선 양끝 직선거리 기준) */
function trunkDistances(
  adj: Map<string, { to: string; w: number }[]>,
  starts: Set<string>
): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const n of starts) {
    dist.set(n, 0);
    queue.push(n);
  }
  // SPFA — 송수관 망은 작아서 충분하다
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]!;
    const du = dist.get(u)!;
    for (const { to, w } of adj.get(u) ?? []) {
      const nd = du + w;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        queue.push(to);
      }
    }
  }
  return dist;
}

/**
 * 송수관(SAA003) 방향 판정 — 정수장에서 배수지 쪽으로 흘러야 정상.
 * 송수관 망에서 정수장 노드·배수지 노드까지의 최단 거리를 구해,
 * 한 관로가 최단 경로 위에서 정수장 쪽으로 향하거나 배수지에서 멀어지면 역방향으로 본다.
 * 그물망/분기로 한쪽 신호만 뚜렷하고 다른 쪽이 반대로 강하게 말하면 판단하지 않는다.
 */
function computeTrunkVerdicts(
  pipes: PipeRec[],
  terminals: { sources: Set<string>; sinks: Set<string> }
): Map<string, 'reverse' | 'ok'> {
  const out = new Map<string, 'reverse' | 'ok'>();
  const trunk = pipes.filter((p) => p.table === 'wtl_pipe_lm' && p.saa === 'SAA003');
  if (trunk.length === 0) return out;
  if (terminals.sources.size === 0 && terminals.sinks.size === 0) return out;

  const adj = new Map<string, { to: string; w: number }[]>();
  const chord = (p: PipeRec) => Math.max(Math.hypot(p.ex - p.sx, p.ey - p.sy), 1);
  for (const p of trunk) {
    const w = chord(p);
    for (const [a, b] of [
      [p.startKey, p.endKey],
      [p.endKey, p.startKey],
    ] as const) {
      const list = adj.get(a);
      if (list) list.push({ to: b, w });
      else adj.set(a, [{ to: b, w }]);
    }
  }
  const dSrc = terminals.sources.size > 0 ? trunkDistances(adj, terminals.sources) : null;
  const dSink = terminals.sinks.size > 0 ? trunkDistances(adj, terminals.sinks) : null;
  // 양수 = 이 관로의 진행 방향(시작→끝)이 기대 방향과 같다. 단위: 관로 길이 대비
  const signal = (d: Map<string, number> | null, from: string, to: string, w: number) => {
    if (!d) return null;
    const a = d.get(from);
    const b = d.get(to);
    if (a == null || b == null) return null;
    return (b - a) / w;
  };
  for (const p of trunk) {
    const w = chord(p);
    const sigs = [
      signal(dSrc, p.startKey, p.endKey, w), // 정수장에서 멀어짐
      signal(dSink, p.endKey, p.startKey, w), // 배수지에 가까워짐
    ].filter((x): x is number => x != null);
    if (sigs.length === 0) continue;
    if (sigs.some((x) => x <= -TRUNK_STRONG) && sigs.every((x) => x <= TRUNK_TOLERANT)) {
      out.set(p.key, 'reverse');
    } else if (sigs.some((x) => x >= TRUNK_STRONG) && sigs.every((x) => x >= -TRUNK_TOLERANT)) {
      out.set(p.key, 'ok');
    }
  }
  return out;
}

/**
 * 급수관은 상수관·계량기, 송수관은 정수장→배수지 흐름,
 * 한쪽 끝이 막힌 상수관은 연결된 끝 → 막힌 끝 방향으로 판정한다. 그 외는 unknown.
 */
function flowVerdict(p: PipeRec, ctx: FlowCtx): SupplyVerdict {
  if (p.table === 'wtl_sply_ls') return supplyVerdict(p, ctx);
  const t = ctx.trunk.get(p.key);
  if (t) return { verdict: t, basis: 'facility' };
  const d = ctx.deadEnd.get(p.key);
  if (d) return { verdict: d, basis: 'main' };
  return { verdict: 'unknown', basis: 'unknown' };
}

type MainEndAttach = {
  sOn: boolean;
  eOn: boolean;
  sSrc: boolean;
  eSrc: boolean;
  /** 끝점이 다른 상수관에 닿지는 않지만 DEAD_END_GAP_M 안에 있음(연결 누락 가능성) */
  sGap: boolean;
  eGap: boolean;
};

/**
 * 상수관 양끝이 다른 운영 상수관(끝점·선 위 모두)에 닿는지, 정수장·배수지 근처인지.
 * 선 위 T자 접합도 잡으려고 노드 대신 도형 거리로 본다.
 */
async function loadMainEndAttach(): Promise<Map<string, MainEndAttach>> {
  const map = new Map<string, MainEndAttach>();
  if (!(await tableExists('layer', 'wtl_pipe_lm'))) return map;
  const near = async (table: string, end: 'StartPoint' | 'EndPoint'): Promise<string> =>
    (await tableExists('layer', table))
      ? `EXISTS (SELECT 1 FROM layer.${table} f WHERE f.geom IS NOT NULL AND ST_DWithin(f.geom, ST_${end}(p.line), ${CONNECT_M}))`
      : 'FALSE';
  const onMain = (end: 'StartPoint' | 'EndPoint', dist: number) =>
    `EXISTS (SELECT 1 FROM layer.wtl_pipe_lm m
             WHERE m.geom IS NOT NULL AND m.ogc_fid <> p.ogc_fid AND ${activeMainSql('m.')}
               AND ST_DWithin(ST_${end}(p.line), m.geom, ${dist}))`;
  // 막힌 끝 근처의 "다른" 상수관 — 반대쪽 끝이 붙은 관은 빼야 짧은 가지관이 끊김으로 오인되지 않는다
  const nearOtherMain = (end: 'StartPoint' | 'EndPoint', other: 'StartPoint' | 'EndPoint') =>
    `EXISTS (SELECT 1 FROM layer.wtl_pipe_lm m
             WHERE m.geom IS NOT NULL AND m.ogc_fid <> p.ogc_fid AND ${activeMainSql('m.')}
               AND ST_DWithin(ST_${end}(p.line), m.geom, ${DEAD_END_GAP_M})
               AND NOT ST_DWithin(ST_${other}(p.line), m.geom, ${NODE_SNAP_M}))`;
  const res = await db.execute(
    sql.raw(
      `SELECT p.ogc_fid AS id, p.part AS part,
         ${onMain('StartPoint', NODE_SNAP_M)} AS s_on,
         ${onMain('EndPoint', NODE_SNAP_M)} AS e_on,
         ${nearOtherMain('StartPoint', 'EndPoint')} AS s_near,
         ${nearOtherMain('EndPoint', 'StartPoint')} AS e_near,
         (${await near('wtl_puri_as', 'StartPoint')} OR ${await near('wtl_serv_ps', 'StartPoint')}) AS s_src,
         (${await near('wtl_puri_as', 'EndPoint')} OR ${await near('wtl_serv_ps', 'EndPoint')}) AS e_src
       FROM ${linePartsSql('wtl_pipe_lm')} p`
    )
  );
  const yes = (v: unknown) => v === true || v === 't';
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id);
    if (!Number.isFinite(id)) continue;
    map.set(`wtl_pipe_lm:${id}:${Number(r.part) || 1}`, {
      sOn: yes(r.s_on),
      eOn: yes(r.e_on),
      sSrc: yes(r.s_src),
      eSrc: yes(r.e_src),
      sGap: !yes(r.s_on) && yes(r.s_near),
      eGap: !yes(r.e_on) && yes(r.e_near),
    });
  }
  return map;
}

/**
 * 한쪽 끝이 막힌 상수관(가지 끝) — 물은 연결된 끝에서 막힌 끝으로 흘러야 한다.
 * 막힌 끝: 다른 운영 상수관에 닿지 않고(DEAD_END_GAP_M 안에도 없음) 정수장·배수지 근처도 아님. 송수관은 별도 판정이라 제외.
 * 양끝이 모두 막혔거나 모두 연결된 관은 판단하지 않는다.
 */
function computeDeadEndVerdicts(
  pipes: PipeRec[],
  attach: Map<string, MainEndAttach>
): Map<string, 'reverse' | 'ok'> {
  const out = new Map<string, 'reverse' | 'ok'>();
  for (const p of pipes) {
    if (p.table !== 'wtl_pipe_lm' || p.saa === 'SAA003') continue;
    const a = attach.get(p.key);
    if (!a) continue;
    // 막힌 끝 근처(DEAD_END_GAP_M)에 다른 상수관이 있으면 끊김(연결 누락)일 수 있어 판단하지 않는다
    const startDead = !a.sOn && !a.sSrc && !a.sGap;
    const endDead = !a.eOn && !a.eSrc && !a.eGap;
    if (startDead && a.eOn) out.set(p.key, 'reverse');
    else if (endDead && a.sOn) out.set(p.key, 'ok');
  }
  return out;
}

/**
 * 반전했을 때 먼 쪽 끝의 상태 점수 (0=새 충돌, 1=열린 끝, 2=이웃 흐름과 이어짐).
 * meet : 반전하면 시작점 노드가 끝점이 된다 → 그곳에 유입 관이 이미 있으면 새 만남이 생긴다.
 * split: 반전하면 끝점 노드가 시작점이 된다 → 그곳에서 이미 시작하는 관이 있으면 새 분기가 생긴다.
 */
function reverseScore(p: PipeRec, mode: 'meet' | 'split', idx: NodeIndex): number {
  // 반전하면 먼 쪽 노드에서 이 관의 역할이 바뀐다(meet: 나감→들어옴, split: 들어옴→나감).
  // 접합점은 들어오는 관과 나가는 관이 함께 있으면 정상이므로,
  // 반전 후 그 노드에 반대 역할의 관이 하나도 남지 않을 때만 새 충돌로 본다.
  const far = mode === 'meet' ? p.startKey : p.endKey;
  const sameRole = mode === 'meet' ? idx.endsAt : idx.startsAt; // 반전 후 이 관과 같은 역할
  const otherRole = mode === 'meet' ? idx.startsAt : idx.endsAt; // 반전 후 이 관과 반대 역할
  if (othersAt(otherRole, far, p).length > 0) return 2; // 흐름이 이어진다
  if (othersAt(sameRole, far, p).length > 0) return 0; // 새 만남/갈라짐이 생긴다
  return 1; // 열린 끝
}

/** 점수가 가장 높은 후보가 정확히 하나일 때만 추천한다. 동점·전부 충돌이면 추천하지 않는다(임의 선택 금지). */
function pickByContinuity(
  candidates: number[],
  pipes: PipeRec[],
  mode: 'meet' | 'split',
  idx: NodeIndex
): Set<number> {
  if (candidates.length === 0) return new Set();
  const scored = candidates.map((i) => ({ i, s: reverseScore(pipes[i]!, mode, idx) }));
  const max = Math.max(...scored.map((x) => x.s));
  if (max === 0) return new Set();
  const top = scored.filter((x) => x.s === max);
  return top.length === 1 ? new Set([top[0]!.i]) : new Set();
}

type MeetRecommend = { rec: Set<number>; basis: WtlTopoBasis };

/**
 * 반전 추천(표시만, 자동 확정 아님).
 * 1) 급수관은 supplyVerdict(상수관·계량기)로 판정 — 하나라도 근거가 있으면 그 결과만 쓴다.
 * 2) 근거 없는 급수관이 상수관과 합류하면 그 급수관을 추천한다.
 * 3) 두 관만 만날 때는 반전해도 새 만남/분기가 생기지 않는 쪽을 추천한다(후보가 하나일 때만).
 */
function recommendMeetPipeIndexes(incoming: PipeRec[], ctx: FlowCtx): MeetRecommend {
  const out = new Set<number>();
  const undecided: number[] = [];
  let ruled = false;
  let ruledBasis: WtlTopoBasis = 'unknown';
  incoming.forEach((p, idx) => {
    const v = flowVerdict(p, ctx);
    if (v.verdict === 'reverse') {
      ruled = true;
      ruledBasis = v.basis;
      out.add(idx);
    } else if (v.verdict === 'ok') {
      ruled = true;
    } else {
      undecided.push(idx);
    }
  });
  if (ruled) return { rec: out, basis: out.size > 0 ? ruledBasis : 'unknown' };

  const undecidedSply = undecided.filter((i) => incoming[i]!.table === 'wtl_sply_ls');
  if (undecidedSply.length > 0 && incoming.some((p) => p.table === 'wtl_pipe_lm')) {
    return { rec: new Set(undecidedSply), basis: 'main' };
  }
  if (incoming.length === 2) {
    const rec = pickByContinuity(undecided, incoming, 'meet', ctx);
    return { rec, basis: rec.size > 0 ? 'continuity' : 'unknown' };
  }
  return { rec: out, basis: 'unknown' };
}

/** 양방향 만남 유형 — 목록 라벨용 (자동 일괄 반전 기준 아님) */
function classifyFlowMeet(incoming: PipeRec[]): {
  meetSubtype: WtlTopoMeetSubtype;
  meetSubtypeLabel: string;
  detail: string;
} {
  if (incoming.length >= 3) {
    return {
      meetSubtype: 'multi_merge',
      meetSubtypeLabel: '다수 합류',
      detail: '여러 관로가 한 점에서 끝나고 하류로 이어지지 않습니다.',
    };
  }
  const a = inboundUnit(incoming[0]!);
  const b = inboundUnit(incoming[1]!);
  if (a && b) {
    const dot = a[0]! * b[0]! + a[1]! * b[1]!;
    // 유입 방향이 대략 반대(서로 마주 봄)
    if (dot < -0.5) {
      return {
        meetSubtype: 'head_on',
        meetSubtypeLabel: '서로 마주 봄',
        detail: '두 관로가 서로 마주 보며 끝나고 하류로 이어지지 않습니다.',
      };
    }
    // 한쪽으로 이어질 여지가 있는 합류
    return {
      meetSubtype: 'one_flip',
      meetSubtypeLabel: '한쪽 반전 후보',
      detail: '한쪽 관로만 반전하면 유수방향이 이어질 수 있습니다.',
    };
  }
  return {
    meetSubtype: 'dead_end',
    meetSubtypeLabel: '하류 없음',
    detail: '유수방향이 한쪽으로 이어지지 않고 양쪽에서 만납니다.',
  };
}

/** 같은 feature의 여러 파트는 하나로 합치고, 한 파트라도 추천이면 추천으로 본다. */
function buildRelatedPipes(
  pipes: PipeRec[],
  rec: Set<number>
): NonNullable<WtlTopoIssueDto['relatedPipes']> {
  const map = new Map<string, { table: string; ogcFid: number; recommended: boolean }>();
  pipes.forEach((p, idx) => {
    const k = `${p.table}:${p.id}`;
    const prev = map.get(k);
    const recommended = rec.has(idx);
    if (prev) prev.recommended = prev.recommended || recommended;
    else map.set(k, { table: p.table, ogcFid: p.id, recommended });
  });
  return [...map.values()];
}

/** 목록 표시 이름 — ogc_fid (ftr_idn은 중복이 많아 쓰지 않음) */
function pipeLabel(p: PipeRec, label: string): string {
  return `${label} #${p.id}${p.part > 1 ? ` (파트 ${p.part})` : ''}`;
}

/**
 * 노드에 모인 관로 끝점 중 하나라도 계량기 NODE_SNAP_M 안에 있는 노드.
 * 계량기는 흐름이 끝나는 곳이라, 관 종류(상수관·급수관)와 상관없이 그곳에서 끝나는 만남은 정상이다.
 */
async function loadMeetNodesAtMeter(
  cands: { node: string; incoming: PipeRec[] }[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (cands.length === 0) return out;
  if (!(await tableExists('layer', 'wtl_meta_ps'))) return out;
  const pts: { node: string; x: number; y: number }[] = [];
  for (const c of cands) for (const p of c.incoming) pts.push({ node: c.node, x: p.ex, y: p.ey });
  const CHUNK = 500;
  for (let off = 0; off < pts.length; off += CHUNK) {
    const part = pts.slice(off, off + CHUNK);
    const values = part.map((pt, i) => `(${i}, ${pt.x}::float8, ${pt.y}::float8)`).join(',');
    const res = await db.execute(
      sql.raw(
        `WITH srid AS (
           SELECT ST_SRID(geom) AS s FROM layer.wtl_meta_ps WHERE geom IS NOT NULL LIMIT 1
         ),
         c(i, x, y) AS (VALUES ${values}),
         pt AS (SELECT c.i, ST_SetSRID(ST_MakePoint(c.x, c.y), srid.s) AS g FROM c, srid)
         SELECT pt.i AS i FROM pt
         WHERE EXISTS (
           SELECT 1 FROM layer.wtl_meta_ps m
           WHERE m.geom IS NOT NULL AND ST_DWithin(m.geom, pt.g, ${NODE_SNAP_M})
         )`
      )
    );
    for (const raw of res.rows ?? []) {
      const pt = part[Number((raw as { i?: unknown }).i)];
      if (pt) out.add(pt.node);
    }
  }
  return out;
}

async function findFlowMeet(ctx: FlowCtx, issues: WtlTopoIssueDto[]): Promise<void> {
  // 양쪽(이상)에서 유입만 되고 하류로 이어지지 않음 = 양쪽에서 만남
  const cands: { node: string; incoming: PipeRec[] }[] = [];
  for (const [node, incoming] of ctx.endsAt) {
    if (incoming.length < 2) continue;
    if ((ctx.startsAt.get(node)?.length ?? 0) > 0) continue;
    cands.push({ node, incoming });
  }
  let atMeter: Set<string>;
  try {
    atMeter = await loadMeetNodesAtMeter(cands);
  } catch (e) {
    // 조회 실패 시 기존 규칙(급수관만 모이고 그 끝점이 계량기)으로 대신한다
    console.error('[wtlTopology] meter exclusion query failed', e);
    atMeter = new Set(
      cands
        .filter(
          (c) =>
            c.incoming.every((p) => p.table === 'wtl_sply_ls') &&
            c.incoming.some((p) => supplyEndTouchesMeter(ctx.supplyTouches.get(supplyKey(p))))
        )
        .map((c) => c.node)
    );
  }
  for (const { node: key, incoming } of cands) {
    // 계량기에서 끝나는 만남은 관 종류와 상관없이 정상 흐름
    if (atMeter.has(key)) continue;
    const sample = incoming[0]!;
    const sampleLine = parseLine(sample.geom4326);
    const lonLat = sampleLine && sampleLine.length >= 2 ? sampleLine[sampleLine.length - 1]! : null;
    if (!lonLat) continue;

    const { rec, basis } = recommendMeetPipeIndexes(incoming, ctx);
    let cls = classifyFlowMeet(incoming);
    // 추천할 근거가 없으면 "반전 후보"라고 표시하지 않는다.
    if (rec.size === 0 && cls.meetSubtype === 'one_flip') {
      cls = {
        meetSubtype: 'dead_end',
        meetSubtypeLabel: '방향 판단 필요',
        detail: '유수방향 근거가 부족해 반전 대상을 추천하지 못했습니다.',
      };
    }
    issues.push({
      id: `meet-${key}`,
      kind: '유수방향 확인필요',
      code: 'flow_meet',
      target: `관로 접합점 (${incoming.length}개 유입) · ${cls.meetSubtypeLabel}`,
      detail: cls.detail,
      point: lonLat,
      line: sampleLine ?? undefined,
      table: sample.table,
      ogcFid: sample.id,
      geomKind: 'line',
      meetSubtype: cls.meetSubtype,
      meetSubtypeLabel: cls.meetSubtypeLabel,
      basis,
      relatedPipes: buildRelatedPipes(incoming, rec),
    });
  }
}

/**
 * 상수관 서로 갈라짐 — 한 점에서 상수관이 2개 이상 시작하고 유입 관로가 없다.
 * 정수장·배수지 근처, 제수변·유량계·계량기 위, 다른 상수관 선 위의 T자 분기는 정상으로 보고 제외한다.
 */
async function findFlowSplit(ctx: FlowCtx, issues: WtlTopoIssueDto[]): Promise<void> {
  const cands: { node: string; starts: PipeRec[] }[] = [];
  for (const [node, starts] of ctx.startsAt) {
    if (starts.length < 2) continue;
    if ((ctx.endsAt.get(node)?.length ?? 0) > 0) continue;
    if (!starts.every((p) => p.table === 'wtl_pipe_lm')) continue;
    cands.push({ node, starts });
  }
  if (cands.length === 0) return;

  let excluded: Set<string>;
  try {
    excluded = await loadSplitExcludedNodes(cands);
  } catch (e) {
    // 제외 판정 실패 시 오탐이 쏟아지므로 분기 탐지는 건너뛴다.
    console.error('[wtlTopology] split exclusion query failed', e);
    return;
  }

  for (const { node, starts } of cands) {
    if (excluded.has(node)) continue;
    const sample = starts[0]!;
    const line = parseLine(sample.geom4326);
    if (!line || line.length < 2) continue;
    // 송수관은 정수장→배수지 흐름이 우선 근거. 근거가 없으면 이웃 연속성.
    const verdicts = starts.map((p) => flowVerdict(p, ctx));
    const byFacility = new Set<number>();
    verdicts.forEach((v, i) => {
      if (v.verdict === 'reverse') byFacility.add(i);
    });
    const ruled = verdicts.some((v) => v.verdict !== 'unknown');
    const rec = ruled
      ? byFacility
      : starts.length === 2
        ? pickByContinuity([0, 1], starts, 'split', ctx)
        : new Set<number>();
    issues.push({
      id: `split-${node}`,
      kind: '유수방향 확인필요',
      code: 'flow_meet',
      target: `관로 접합점 (${starts.length}개 시작) · 서로 갈라짐`,
      detail: '여러 상수관이 한 점에서 시작하며 유입 관로가 없습니다.',
      point: line[0]!,
      line,
      table: sample.table,
      ogcFid: sample.id,
      geomKind: 'line',
      meetSubtype: 'split',
      meetSubtypeLabel: '서로 갈라짐',
      basis: rec.size > 0 ? (ruled ? 'facility' : 'continuity') : 'unknown',
      relatedPipes: buildRelatedPipes(starts, rec),
    });
  }
}

/** 분기 후보 노드 중 정상으로 볼 노드(정수장·배수지·제수변·유량계·계량기 근처, 다른 상수관 선 위)를 찾는다. */
async function loadSplitExcludedNodes(
  cands: { node: string; starts: PipeRec[] }[]
): Promise<Set<string>> {
  const excluded = new Set<string>();
  const facilityClauses: string[] = [];
  // 정수장·배수지는 넓게(30m), 제수변·유량계·계량기는 선을 시설 위치에서 나눠 그린 정상 입력이므로 좁게(5m) 제외
  const nearTables: { table: string; dist: number }[] = [
    { table: 'wtl_puri_as', dist: CONNECT_M },
    { table: 'wtl_serv_ps', dist: CONNECT_M },
    { table: 'wtl_valv_ps', dist: SPLIT_FACILITY_NEAR_M },
    { table: 'wtl_flow_ps', dist: SPLIT_FACILITY_NEAR_M },
    { table: 'wtl_meta_ps', dist: SPLIT_FACILITY_NEAR_M },
  ];
  for (const { table, dist } of nearTables) {
    if (await tableExists('layer', table)) {
      facilityClauses.push(
        `EXISTS (SELECT 1 FROM layer.${table} f WHERE f.geom IS NOT NULL AND ST_DWithin(f.geom, pt.g, ${dist}))`
      );
    }
  }
  const CHUNK = 400;
  for (let off = 0; off < cands.length; off += CHUNK) {
    const part = cands.slice(off, off + CHUNK);
    const values = part
      .map((c, i) => {
        const s = c.starts[0]!;
        const ids = [...new Set(c.starts.map((p) => p.id))].join(',');
        return `(${i}, ${s.sx}::float8, ${s.sy}::float8, ARRAY[${ids}]::bigint[])`;
      })
      .join(',');
    const res = await db.execute(
      sql.raw(
        `WITH srid AS (
           SELECT ST_SRID(geom) AS s FROM layer.wtl_pipe_lm WHERE geom IS NOT NULL LIMIT 1
         ),
         c(i, x, y, ids) AS (VALUES ${values}),
         pt AS (
           SELECT c.i, c.ids, ST_SetSRID(ST_MakePoint(c.x, c.y), srid.s) AS g FROM c, srid
         )
         SELECT pt.i AS i FROM pt
         WHERE EXISTS (
                 SELECT 1 FROM layer.wtl_pipe_lm m
                 WHERE m.geom IS NOT NULL
                   AND ${activeMainSql('m.')}
                   AND ST_DWithin(m.geom, pt.g, ${NODE_SNAP_M})
                   AND m.ogc_fid::bigint <> ALL(pt.ids)
               )
               ${facilityClauses.map((cl) => `OR ${cl}`).join('\n')}`
      )
    );
    for (const raw of res.rows ?? []) {
      const i = Number((raw as { i?: unknown }).i);
      const c = part[i];
      if (c) excluded.add(c.node);
    }
  }
  return excluded;
}

function midOfLine(line: [number, number][]): [number, number] {
  return line[Math.floor(line.length / 2)]!;
}

function pushFlowReverse(
  issues: WtlTopoIssueDto[],
  p: PipeRec,
  detail: string,
  label: string,
  basis: WtlTopoBasis
): void {
  const line = parseLine(p.geom4326);
  if (!line || line.length < 2) return;
  issues.push({
    id: `rev-${p.table}-${p.id}-${p.part}`,
    kind: '유수방향 확인필요',
    code: 'flow_reverse',
    target: `${pipeLabel(p, label)} · 역방향`,
    detail,
    point: midOfLine(line),
    line,
    table: p.table,
    ogcFid: p.id,
    geomKind: 'line',
    basis,
  });
}

/**
 * 역방향 판정 — 급수관(상수관 접합·계량기)과 송수관(정수장→배수지 흐름).
 * 계량기 위치는 급수관에만 쓰고, 상수관은 계량기로 역방향을 올리지 않는다.
 */
function findFlowReverse(pipes: PipeRec[], ctx: FlowCtx, issues: WtlTopoIssueDto[]): void {
  for (const p of pipes) {
    if (p.table === 'wtl_pipe_lm' && !ctx.trunk.has(p.key) && ctx.deadEnd.get(p.key) === 'reverse') {
      pushFlowReverse(
        issues,
        p,
        '끝이 막힌 상수관은 연결된 관 쪽이 시작점이어야 합니다.',
        '관로',
        'main'
      );
      continue;
    }
    if (p.table === 'wtl_pipe_lm' && ctx.trunk.get(p.key) === 'reverse') {
      pushFlowReverse(
        issues,
        p,
        '송수관은 정수장에서 배수지 방향이어야 합니다.',
        '관로',
        'facility'
      );
      continue;
    }
    if (p.table !== 'wtl_sply_ls') continue;
    const v = supplyVerdict(p, ctx);
    if (v.verdict === 'reverse') {
      pushFlowReverse(
        issues,
        p,
        v.basis === 'main'
          ? '상수관에 붙은 쪽이 시작점이어야 합니다.'
          : '계량기 쪽이 끝점이어야 합니다.',
        '급수관',
        v.basis
      );
      continue;
    }
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

  const [supplyTouches, mainAttachRaw] = await Promise.all([
    loadSupplyMeterTouches(),
    loadSupplyMainAttachRaw(),
  ]);
  const nodeIdx = buildNodeIndex(pipes);
  const mainAttach = resolveMainAttach(pipes, nodeIdx, mainAttachRaw);
  const trunkPipes = pipes.filter((p) => p.table === 'wtl_pipe_lm' && p.saa === 'SAA003');
  const trunk = computeTrunkVerdicts(pipes, await loadTrunkTerminals(trunkPipes));
  let deadEnd = new Map<string, 'reverse' | 'ok'>();
  try {
    deadEnd = computeDeadEndVerdicts(pipes, await loadMainEndAttach());
  } catch (e) {
    console.error('[wtlTopology] dead-end main check failed', e);
  }
  const ctx: FlowCtx = { ...nodeIdx, supplyTouches, mainAttach, trunk, deadEnd };
  await findFlowMeet(ctx, issues);
  await findFlowSplit(ctx, issues);
  findFlowReverse(pipes, ctx, issues);

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
 * 접합점 검토 — 선택 관로 여러 개 유수방향 반전
 */
export async function reverseWtlTopoPipes(params: {
  pipes?: { table?: string; ogcFid?: number }[];
}): Promise<{ ok: boolean; reversed: number; error?: string }> {
  const list = Array.isArray(params.pipes) ? params.pipes : [];
  if (list.length === 0) return { ok: false, reversed: 0, error: '반전할 관로를 선택하세요.' };
  let reversed = 0;
  for (const item of list.slice(0, 40)) {
    const res = await reverseWtlTopoPipe({
      table: item.table,
      ogcFid: item.ogcFid,
    });
    if (!res.ok) {
      return {
        ok: false,
        reversed,
        error: res.error ?? `관로 반전 실패 (${reversed}건까지 반영)`,
      };
    }
    reversed += 1;
  }
  return { ok: true, reversed };
}

/**
 * 접합점 검토용 관로 도형(4326) 조회
 */
export async function loadWtlTopoPipeLines(params: {
  pipes?: { table?: string; ogcFid?: number }[];
}): Promise<{
  pipes: { table: string; ogcFid: number; ftrIdn: string | null; line: [number, number][]; color: string }[];
  error?: string;
}> {
  const list = Array.isArray(params.pipes) ? params.pipes : [];
  const out: { table: string; ogcFid: number; ftrIdn: string | null; line: [number, number][]; color: string }[] = [];
  for (const item of list.slice(0, 40)) {
    const table = String(item.table ?? '');
    const ogcFid = Number(item.ogcFid);
    if (!['wtl_pipe_lm', 'wtl_sply_ls'].includes(table) || !Number.isFinite(ogcFid)) continue;
    if (!(await tableExists('layer', table))) continue;
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsGeoJSON(ST_Transform(
           CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(ST_LineMerge(geom), 1) ELSE geom END
         , 4326))::json AS geom,
         ${table === 'wtl_pipe_lm' ? 'saa_cde::text' : 'NULL::text'} AS saa,
         NULLIF(trim(ftr_idn::text), '') AS ftr_idn
         FROM layer."${esc(table)}"
         WHERE ogc_fid = ${ogcFid}
           AND geom IS NOT NULL
         LIMIT 1`
      )
    );
    const row = res.rows?.[0] as
      | { geom?: unknown; saa?: string | null; ftr_idn?: string | null }
      | undefined;
    const line = parseLine(row?.geom);
    if (!line || line.length < 2) continue;
    // 지도 관로와 같은 색: 상수관은 saa_cde별 GeoServer 스타일, 급수관은 급수관 스타일
    const color =
      table === 'wtl_pipe_lm'
        ? readWtlPipeLmMapStrokeColor(row?.saa ?? null)
        : readWtlLayerLineColor('wtl_sply_ls', '#26A3D1');
    out.push({ table, ogcFid, ftrIdn: row?.ftr_idn ?? null, line, color });
  }
  return { pipes: out };
}

/**
 * GeoJSON(4326) → 테이블 SRID 도형 SQL.
 * 기존 데이터가 MULTI 형식(MULTIPOINT·MULTILINESTRING)이면 새 도형도 ST_Multi로 맞춘다.
 */
function geomFromGeoJsonSql(geoText: string, table: string, multi: boolean): string {
  const g = `ST_Transform(
    ST_SetSRID(ST_GeomFromGeoJSON('${geoText}'), 4326),
    COALESCE((SELECT ST_SRID(geom) FROM layer."${esc(table)}" WHERE geom IS NOT NULL LIMIT 1), 5181)
  )`;
  return multi ? `ST_Multi(${g})` : g;
}

/** 테이블의 기존 도형이 MULTI 형식인지 (표본 1건) */
async function tableUsesMulti(table: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT GeometryType(geom) LIKE 'MULTI%' AS m FROM layer."${esc(table)}" WHERE geom IS NOT NULL LIMIT 1`
    )
  );
  const v = (res.rows?.[0] as { m?: unknown } | undefined)?.m;
  return v === true || v === 't';
}

/**
 * 기존 시설·관로 도형 즉시 수정 (GeoJSON 4326)
 * 원래 도형이 MULTI 형식이면 새 도형도 MULTI로 저장한다.
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
  const g = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${geoText}'), 4326), ST_SRID(geom))`;
  await db.execute(
    sql.raw(
      `UPDATE layer."${esc(table)}"
       SET geom = CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_Multi(${g}) ELSE ${g} END
       WHERE ogc_fid = ${ogcFid}
         AND geom IS NOT NULL`
    )
  );
  return { ok: true };
}

/** 위상검증에서 추가할 수 있는 시설 — 테이블별 허용 지형지물부호(ftr_cde). 첫 값이 기본 */
const TOPO_INSERT_FTR_CODES: Record<string, string[]> = {
  wtl_pipe_lm: ['SA001'],
  wtl_sply_ls: ['SA001'],
  wtl_valv_ps: ['SA200', 'SA202', 'SA203', 'SA204'],
  wtl_flow_ps: ['SA117'],
  wtl_meta_ps: ['SA122'],
  wtl_serv_ps: ['SA114'],
};

/**
 * 관로·시설 추가 (즉시) — 도형 + 지형지물부호(ftr_cde), 상수관은 용도코드(saa_cde)까지 넣는다.
 * 기존 데이터 형식(MULTI)에 맞춰 저장한다. 관경·재질 등 나머지 속성은 비워 둔다.
 */
export async function insertWtlTopoFeature(params: {
  table?: string;
  geojson?: unknown;
  /** 상수관(wtl_pipe_lm) 추가 시 용도코드 — 지도 스타일(송수·배수·기타)이 이 값으로 갈린다 */
  saaCde?: string;
  /** 지형지물부호. 생략하면 테이블 기본값(관로 SA001, 제수변 SA200 등) */
  ftrCde?: string;
}): Promise<{ ok: boolean; ogcFid?: number; error?: string }> {
  const table = String(params.table ?? '');
  const allowedFtr = TOPO_INSERT_FTR_CODES[table];
  if (!EDITABLE_TABLES.has(table) || !allowedFtr) {
    return { ok: false, error: '추가할 수 있는 레이어가 아닙니다.' };
  }
  const saaCde = String(params.saaCde ?? '').trim().toUpperCase();
  if (saaCde && (table !== 'wtl_pipe_lm' || !TOPO_INSERT_SAA_CODES.has(saaCde))) {
    return { ok: false, error: '관로 종류가 올바르지 않습니다.' };
  }
  const ftrCde = String(params.ftrCde ?? '').trim().toUpperCase() || allowedFtr[0]!;
  if (!allowedFtr.includes(ftrCde)) {
    return { ok: false, error: '시설 종류가 올바르지 않습니다.' };
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
    const multi = await tableUsesMulti(table);
    const cols = ['geom', 'ftr_cde', ...(saaCde ? ['saa_cde'] : [])];
    const vals = [
      geomFromGeoJsonSql(geoText, table, multi),
      `'${esc(ftrCde)}'`,
      ...(saaCde ? [`'${esc(saaCde)}'`] : []),
    ];
    const res = await db.execute(
      sql.raw(
        `INSERT INTO layer."${esc(table)}" (${cols.join(', ')})
         SELECT ${vals.join(', ')}
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

/** 지도에서 클릭으로 고를 수 있는 시설(점) 테이블과 이름 */
const TOPO_PICK_POINT_TABLES: { table: string; label: string }[] = [
  { table: 'wtl_valv_ps', label: '변류시설' },
  { table: 'wtl_flow_ps', label: '유량계' },
  { table: 'wtl_meta_ps', label: '계량기' },
  { table: 'wtl_serv_ps', label: '배수지' },
];

export type WtlTopoPickedFeature = {
  table: string;
  ogcFid: number;
  geomKind: 'line' | 'point';
  /** 이름 (예: 관로 #123, 제수변 #45) */
  label: string;
  line?: [number, number][];
  point?: [number, number];
  /** 관로 실제 레이어 색 */
  color?: string;
};

/**
 * 지도 클릭 위치(경위도 EPSG:4326)에서 가장 가까운 관로·시설 1건 — 도구모음의 수정·방향 반전 대상 고르기용.
 * 점 시설과 관로가 겹치면 시설을 먼저 고른다(시설은 관로 위에 놓이므로).
 * pipesOnly면 관로(상수관·급수관)만 찾는다. 폐관은 제외한다.
 */
export async function findWtlTopoFeatureAt(params: {
  /** 클릭 위치 경위도 — 지도 좌표계(3857·5181)와 무관하게 받는다 */
  lon?: number;
  lat?: number;
  /** 허용 거리(m) — 호출측에서 화면 해상도(m/px) × 픽셀로 넘긴다. 테이블 좌표계(5181, m)에서 잰다 */
  tolerance?: number;
  pipesOnly?: boolean;
}): Promise<{ feature: WtlTopoPickedFeature | null; error?: string }> {
  const x = Number(params.lon);
  const y = Number(params.lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { feature: null, error: '위치가 올바르지 않습니다.' };
  const tol = Math.min(50, Math.max(0.5, Number(params.tolerance) || 5));
  type Cand = WtlTopoPickedFeature & { d: number };
  const cands: Cand[] = [];
  const pointSql = (table: string) =>
    `ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326),
       COALESCE((SELECT ST_SRID(geom) FROM layer."${table}" WHERE geom IS NOT NULL LIMIT 1), 5181))`;

  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    if (!(await tableExists('layer', table))) continue;
    const active = table === 'wtl_pipe_lm' ? `AND ${activeMainSql('t.')}` : '';
    const saa = table === 'wtl_pipe_lm' ? `upper(trim(t.saa_cde::text))` : 'NULL::text';
    const res = await db.execute(
      sql.raw(
        `WITH pt AS (SELECT ${pointSql(table)} AS g)
         SELECT t.ogc_fid AS id, ${saa} AS saa, ST_Distance(t.geom, pt.g) AS d,
           ST_AsGeoJSON(ST_Transform(
             CASE WHEN GeometryType(t.geom) LIKE 'MULTI%' THEN ST_GeometryN(ST_LineMerge(t.geom), 1) ELSE t.geom END,
             4326))::json AS geom
         FROM layer."${table}" t, pt
         WHERE t.geom IS NOT NULL ${active} AND ST_DWithin(t.geom, pt.g, ${tol})
         ORDER BY d LIMIT 1`
      )
    );
    const r = res.rows?.[0] as { id?: unknown; saa?: string | null; d?: unknown; geom?: unknown } | undefined;
    const line = r ? parseLine(r.geom) : null;
    if (!r || !line || line.length < 2) continue;
    const id = Number(r.id);
    cands.push({
      table,
      ogcFid: id,
      geomKind: 'line',
      label: `${table === 'wtl_sply_ls' ? '급수관' : '관로'} #${id}`,
      line,
      color:
        table === 'wtl_pipe_lm'
          ? readWtlPipeLmMapStrokeColor(r.saa ?? null)
          : readWtlLayerLineColor('wtl_sply_ls', '#26A3D1'),
      d: Number(r.d),
    });
  }

  if (!params.pipesOnly) {
    for (const { table, label } of TOPO_PICK_POINT_TABLES) {
      if (!(await tableExists('layer', table))) continue;
      const res = await db.execute(
        sql.raw(
          `WITH pt AS (SELECT ${pointSql(table)} AS g)
           SELECT t.ogc_fid AS id, ST_Distance(t.geom, pt.g) AS d,
             ST_X(ST_Transform(ST_PointOnSurface(t.geom), 4326)) AS lon,
             ST_Y(ST_Transform(ST_PointOnSurface(t.geom), 4326)) AS lat
           FROM layer."${table}" t, pt
           WHERE t.geom IS NOT NULL AND ST_DWithin(t.geom, pt.g, ${tol})
           ORDER BY d LIMIT 1`
        )
      );
      const r = res.rows?.[0] as { id?: unknown; d?: unknown; lon?: unknown; lat?: unknown } | undefined;
      if (!r) continue;
      const id = Number(r.id);
      const lon = Number(r.lon);
      const lat = Number(r.lat);
      if (![id, lon, lat].every(Number.isFinite)) continue;
      // 시설은 관로 위에 놓이므로 허용 거리의 절반만큼 우선한다
      cands.push({ table, ogcFid: id, geomKind: 'point', label: `${label} #${id}`, point: [lon, lat], d: Number(r.d) - tol / 2 });
    }
  }

  cands.sort((a, b) => a.d - b.d);
  const best = cands[0];
  if (!best) return { feature: null };
  const { d: _d, ...feature } = best;
  void _d;
  return { feature };
}

/** 위상검증 배경에서 축척과 무관하게 보여 줄 시설 레이어 (계량기는 수가 많아 원래 축척 제한 유지) */
const TOPO_FACILITY_STYLE_TABLES = new Set([
  'wtl_valv_ps',
  'wtl_flow_ps',
  'wtl_serv_ps',
  'wtl_puri_as',
]);

/**
 * 위상검증 배경 관로(분할 레이어) — 스타일 굵기가 고정값(테두리 3·선 2)이라 ENV로 못 바꾼다.
 * 누수분석·단수구역 관로(선 3px)와 맞추려고 SLD의 stroke-width를 모두 +1px 한다(색은 원본 그대로).
 */
const TOPO_PIPE_WIDEN_TABLES = new Set(['wtl_pipe_lm_etc', 'wtl_pipe_lm_saa004', 'wtl_pipe_lm_saa003']);
const TOPO_PIPE_WIDEN_PX = 1;

/**
 * 위상검증 배경용 시설 SLD — GeoServer 스타일에서 축척 제한(Min/MaxScaleDenominator)만 뺀다.
 * 관로 분할 레이어(TOPO_PIPE_WIDEN_TABLES)는 선 굵기만 키운다.
 * WMS SLD_BODY로 쓰므로
 * - NamedLayer 이름을 레이어명으로 맞추고(다르면 GeoServer가 기본 스타일로 그린다)
 * - 상대 심볼 경로(/www/...)를 GeoServer 절대 URL로 바꾼다(SLD_BODY에서는 상대 경로를 못 푼다).
 */
export async function loadWtlTopoFacilitySlds(params: {
  tables?: string[];
}): Promise<{ slds: Record<string, string> }> {
  const list = (Array.isArray(params.tables) ? params.tables : []).filter(
    (t) => TOPO_FACILITY_STYLE_TABLES.has(String(t)) || TOPO_PIPE_WIDEN_TABLES.has(String(t))
  );
  const stylesDir = path.join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles');
  const gsBase = getGeoServerInternalBase();
  const slds: Record<string, string> = {};
  for (const table of list) {
    try {
      let raw = await fs.readFile(path.join(stylesDir, `${table}.sld`), 'utf8');
      if (TOPO_PIPE_WIDEN_TABLES.has(table)) {
        raw = raw.replace(
          /(<(?:sld:)?CssParameter name="stroke-width">)\s*([0-9.]+)\s*(<\/(?:sld:)?CssParameter>)/g,
          (_m, a: string, w: string, b: string) => `${a}${Number(w) + TOPO_PIPE_WIDEN_PX}${b}`
        );
      }
      slds[table] = raw
        .replace(/<(sld:)?(Min|Max)ScaleDenominator>[^<]*<\/(sld:)?(Min|Max)ScaleDenominator>\s*/g, '')
        .replace(/(<(?:sld:)?NamedLayer>\s*<(?:sld:)?Name>)[^<]*(<\/(?:sld:)?Name>)/, `$1${table}$2`)
        .replace(/xlink:href="\/www\//g, `xlink:href="${gsBase}/www/`);
    } catch {
      // 스타일 파일이 없으면 원래 스타일(축척 제한 포함)로 둔다
    }
  }
  return { slds };
}

/**
 * 관로 추가 미리보기용 선 색 — 지도 레이어(GeoServer 스타일)와 같은 색.
 * 키: 상수관 용도코드(SAA003·SAA004·SAA999), 급수관은 'wtl_sply_ls'.
 */
export async function getWtlTopoAddPipeColors(): Promise<{ colors: Record<string, string> }> {
  const colors: Record<string, string> = {};
  for (const code of TOPO_INSERT_SAA_CODES) colors[code] = readWtlPipeLmMapStrokeColor(code);
  colors.wtl_sply_ls = readWtlLayerLineColor('wtl_sply_ls', '#26A3D1');
  return { colors };
}
