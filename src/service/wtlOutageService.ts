/**
 * 단수구역 — 제수변 잠금 후 시드에서 절점 연결을 따라 단수 구간 추적.
 * 잠긴 밸브 절점은 탐색·대체급수 판정 모두에서 절단(시드 관만 빼면 절점에서 상·하류가 다시 붙어 하류가 전부 제외되던 문제 방지).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import db from '@/database/db';
import { fetchNormalizedJibunFromAddressSearch } from '@/lib/vworldAddressServer';
import { loadTraceCriterion, matchAppliedTraceAnswer, mergeAppliedTrace } from '@/service/wtlRequestService';
import { buildStopWaterHwpx, stopWaterHwpxFileName } from '@/lib/hwpx/stopWaterHwpx';

const GATE_FTR = 'SA200'; // 제수변
/** 제수변이 관로 선분 위에 앉았는지(레이어 SRID m) — v6 JUNCTION_VALVE_TOL */
const VALVE_ON_PIPE_M = 2.5;
/** 밸브 절점에 시작점이 붙은 출구만(구 12m 근처 전부 시드 금지) */
const OUTLET_START_M = 3;
/**
 * continuesOnMain 이어짐 판정 시 인정할 최소 본관 길이(m).
 * 3m짜리 짧은 본관만 붙은 출구를 «본관 이어짐»으로 보면 시드가 남고 급수로 아래가 칠해짐.
 */
const MAIN_CONTINUE_MIN_M = 12;
/**
 * 잠긴 밸브 절단 반경(m). 밸브에 붙은 절점만 막아 반대편으로 새지 않게 함.
 * 12m로 잡으면 짧은 출구 끝점까지 막혀 하류 BFS가 열리지 않음.
 */
const VALVE_CUT_M = VALVE_ON_PIPE_M;
/** 끝점 스냅 격자(m) — v6 TEE_JOIN_TOL 수준 */
const NODE_SNAP_M = 1.5;
/** 추적 범위(제수변 주변 bbox pad, m) */
const TRACE_PAD_M = 2500;
const PIPE_MAX = 500;
const ZONE_BUFFER_M = 28;
const CUSTOMER_LIMIT = 800;

/** 계량기 기준 초기 단수 면 — 관로 조각별 버퍼의 최소값(m, 3857 단위) */
const METER_PIPE_R_M = 5;
/**
 * 초기 단수 면에서 관로는 버퍼를 따로 넓히지 않고 관로를 따라서만 그린다(m, 3857 단위).
 * 계량기 쪽은 건물군 면·계량기 작은 원으로 덮는다.
 */
const PIPE_TRACE_BUFFER_M = 1;
/**
 * 단수 면 버퍼 모양 — 둥근 끝·모서리 대신 각지게(끝 사각, 모서리 뾰족, 너무 뾰족하면 2배에서 자름).
 * 둥글게 그리면 꼭짓점이 많아 도형 수정이 번거롭다.
 */
const ANGULAR_BUFFER = `'endcap=square join=mitre mitre_limit=2'`;
/**
 * 건물군 면을 단수 관로(또는 현재 단수 면)와 잇는 연결 띠 — 최단선에 관로와 같은 폭(PIPE_TRACE_BUFFER_M).
 * 이 거리(m, 3857)보다 멀면 잇지 않음(엉뚱하게 긴 띠 방지).
 */
const BUILDING_CONNECT_MAX_M = 60;
/** 건물군을 뺄 때 연결 띠를 이만큼(m) 더 넓게 빼서, 분석 때 붙인 1m 띠가 가늘게 남지 않게 */
const REMOVE_LINK_SLACK_M = 0.5;
/** 지우기·빼기 뒤 이보다 작은 조각(㎡)은 버림 — 경계에 남는 부스러기 방지 */
const ZONE_MIN_PIECE_M2 = 10;
/** 끊긴 관로에 물린 계량기가 없을 때(단수 대상 수용가 없음) 관로 버퍼(m) */
const NO_METER_BUFFER_M = PIPE_TRACE_BUFFER_M;
/** 계량기 중심을 덮고도 남기는 여유(m) */
const METER_COVER_MARGIN_M = 3;
/** 실폭도로(면) 테이블 — 초기 면 생성 시에만 버퍼를 도로 폭으로 자른다 */
const ROAD_SCHEMA = 'public_layer';
const ROAD_TABLE = 'tl_sprd_rw';
/** 도로 면 사이 틈을 이어 붙이는 거리(m): 약 2배 이내 틈·구멍을 메움 */
const ROAD_BRIDGE_M = 8;
/** 관로를 도로 위/밖으로 나눌 때 경계 오차 허용(m) — 아주 짧은 조각 방지 */
const ROAD_SPLIT_TOL_M = 1;
/** 도로 밖에 있는 계량기가 면에서 빠지지 않게 계량기마다 남기는 작은 원 반경(m, 3857 단위) */
const METER_KEEP_R_M = 3;
/** 한 조각 버퍼 산정에 반영할 계량기 거리 상한(m) — 멀리 떨어진 ID 매칭 한 건이 면을 키우는 것 방지 */
const METER_BUFFER_CAP_M = 60;
/** pip_idn 매칭이 안 될 때 단수 관로까지 허용하는 최대 거리(m) */
const METER_MAX_M = 30;
/** 단수 관로와 공급 관로까지 거리 차가 이 값 미만이면 «애매» */
const METER_AMBIG_M = 2;
/** 애매한 계량기를 단수에 넣을지(기본: 제외) */
const METER_AMBIG_INCLUDE = false;
/** 후보 계량기 조회 상한 */
const METER_CANDIDATE_LIMIT = 5000;
/** 건물군(도로명주소 건물군 면) — 계량기가 속하거나 인접하면 그 건물군 전체를 단수 면에 넣는다 */
const BUILDING_SCHEMA = 'public_layer';
const BUILDING_TABLE = 'tl_sgco_rnadr_mst';
/** 계량기와 건물군 «인접» 판정 거리(m, 건물군 SRID 기준) — 0이면 속한 경우만 */
const BUILDING_NEAR_M = 5;
/**
 * 건물군 표시 버퍼(m, 3857). 분석 시 붉은 면 = 건물군 + 이 버퍼.
 * 이웃 건물 붉은 면이 겹치면 하나의 Polygon으로 합친다.
 */
const BUILDING_MARGIN_M = 3;
/**
 * 지도 붉은 면 — 단수 면 사이 틈이 이 값(m) 이하면 한 면으로 합친다.
 * (건물 외곽 BUILDING_MARGIN_M과는 별개)
 */
const ZONE_MAP_CLUSTER_GAP_M = 15;
/**
 * 알림문(한글) 생성 시에만 — 면 사이 틈이 이 값(m) 이하면 구역도·대상지역 문구용으로 한 면으로 합친다.
 * 지도 화면의 단수 면(ZONE_MAP_CLUSTER_GAP_M)은 바꾸지 않는다.
 */
const AREA_LABEL_CLUSTER_GAP_M = 45;
/** 계량기 없는 건물군 후보: 단수 관로에서 이 거리(m) 안 */
const METERLESS_BUILDING_CAND_M = 30;
/**
 * 계량기 없는 건물군 판정: 급수 중인 관로가 (단수 관로 거리 + 이 값) 안에 없으면 단수.
 * 계량기 판정(METER_AMBIG_M)과 같은 기준.
 */
const METERLESS_BUILDING_AMBIG_M = METER_AMBIG_M;
/**
 * 계량기 없는 건물군은 근거가 약하므로 비율 조건도 둔다:
 * 급수 중인 관로가 (단수 관로 거리 × 이 값)보다도 멀어야 단수.
 * 둘 다 멀리 있을 때(예: 11.5m vs 13.5m) 2m 차이만으로 단수로 잡히는 것 방지.
 */
const METERLESS_BUILDING_RATIO = 1.5;
/**
 * 계량기 없는 건물군은 단수 «급수관»(wtl_sply_ls)이 이 거리(m) 안에 있어야 넣는다.
 * 본관만 가까운 길가 창고·축사 등은 수돗물과 무관한 경우가 많아 제외.
 */
const METERLESS_BUILDING_SPLY_MAX_M = 15;

/**
 * 시드 선정 정책 — 분기 로직은 코드에, 값은 여기 한곳에 모음.
 * 이후 학습(wtl_trace_criterion)으로 덮어쓸 때는 resolveOutagePolicy만 확장하면 된다.
 */
export type WtlOutagePolicy = {
  /**
   * 제수변이 관 선 위(seatOnLineM 이내)에 앉았고 관 끝은 접합점 쪽 outletStartM 안인데
   * 끝점에서 seatEndClearM 이상 떨어진 경우(접합점 직전에 앉음),
   * 이 관을 «유입»으로 버리지 않고 시드로 쓴다(본관 wtl_pipe_lm만, 막다른 끝이어도 허용). 끄면 기존 동작(옆 출구 관을 잠금).
   */
  seatBeforeJunctionAsSeed: boolean;
  seatOnLineM: number;
  seatEndClearM: number;
  /** 본관에 붙은 급수관의 끝점에서 이어지는 급수→급수 분기도 단수에 포함 */
  followSplyChain: boolean;
  /**
   * 잠근 제수변만 닫힌 것으로 보고 위상으로 고립 판정(루프로 물이 돌아오면 단수 아님).
   * 잠근 제수변 전체를 함께 판정하므로 2개 이상 잠그면 루프를 끊어 단수 구간이 생긴다.
   * 끄면 제수변별 하류 추적 + 대체급수 제외(구 방식).
   */
  isolateByLockedValves: boolean;
  /** 고립 판정 시 끝점이 다른 관 선 위(이 거리 이내)면 T자 분기로 연결. 0이면 끝점 스냅만 */
  teeJoinM: number;
};

export const WTL_OUTAGE_POLICY_DEFAULT: WtlOutagePolicy = {
  seatBeforeJunctionAsSeed: true,
  seatOnLineM: 0.5,
  seatEndClearM: 0.5,
  followSplyChain: true,
  isolateByLockedValves: true,
  teeJoinM: 1.5,
};

export function resolveOutagePolicy(overrides?: Partial<WtlOutagePolicy> | null): WtlOutagePolicy {
  return { ...WTL_OUTAGE_POLICY_DEFAULT, ...(overrides ?? {}) };
}

/** 탐색 방위 (도형 진행 각도 근사) */
export const WTL_OUTAGE_FLOW_DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'] as const;
export type WtlOutageFlowDir = (typeof WTL_OUTAGE_FLOW_DIRS)[number];

const FLOW_DIR_BEARING: Record<WtlOutageFlowDir, number> = {
  북: 0,
  북동: 45,
  동: 90,
  남동: 135,
  남: 180,
  남서: -135,
  서: -90,
  북서: -45,
};

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
  /** 필지 중심 [lon, lat] — 목록 클릭 이동용 */
  point?: [number, number];
};

export type WtlOutageAddressDto = {
  id: string;
  /** 도로명(수용가주소 설명) */
  road: string;
  /** 지번(필지) */
  jibun: string;
  /** 수용가번호 */
  customerNo: string;
  /** 대표 위치 [lon, lat] — 목록 클릭 이동용 */
  point?: [number, number];
  /** 대표 급수전 ogc_fid — wtl_meta_ps 스타일 표시용 */
  ogcFid?: number;
};

export type WtlOutageCustomerDto = {
  id: string;
  name: string;
  address: string;
  phone: string;
  meterNo: string;
  /** 수용가 위치 [lon, lat] — 목록 클릭 이동용 */
  point?: [number, number] | null;
  /** wtl_meta_ps ogc_fid */
  ogcFid?: number;
};

export type WtlOutageResultDto = {
  gateId: string;
  /** 첫 단수 면(도형편집·하위 호환) */
  ring: [number, number][];
  /** 잠금이 여러 개일 때 모든 단수 면 */
  rings?: [number, number][][];
  /** 단수 면(구멍 포함). 있으면 rings(바깥 고리)보다 우선 */
  polygons?: ZonePolygon[];
  pipes: [number, number][][];
  parcels: WtlOutageParcelDto[];
  addresses: WtlOutageAddressDto[];
  customers: WtlOutageCustomerDto[];
  /** 단수 면 생성에 쓴 관로 주변 버퍼(m) — 지도 편집 기본값 */
  bufferM?: number;
  /** pipes와 같은 순서의 선별 버퍼(m). 계량기 기준일 때만 내려감 */
  lineBuffers?: number[];
  /** 초기 면 생성 기준: 계량기(meter) 또는 관로 버퍼(pipe) */
  zoneBasis?: 'meter' | 'pipe';
  /** 계량기 기준일 때 단수 대상으로 고른 계량기 수 */
  meterCount?: number;
  /** 계량기가 속하거나 인접한 건물군 면(4326, 여유 포함) — 편집 재계산 시에도 합친다 */
  buildingRings?: [number, number][][];
  /** 건물군에 묶인 계량기 수 */
  buildingMeterCount?: number;
  /** 계량기는 없지만 주변에 급수 중인 관로가 없어 단수로 넣은 건물군 수 */
  meterlessBuildingCount?: number;
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
  /** 레이어 SRID 절점 (중간 분기 판정용). 없으면 시작~끝 직선 */
  coords: [number, number][];
  geom4326: unknown;
  /** ftr_idn (계량기 pip_idn 매칭용). 컬럼이 없으면 빈 문자열 */
  ftrIdn?: string;
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

function coordsToRing(ring: number[][] | null | undefined): [number, number][] {
  if (!ring) return [];
  return ring
    .filter((c) => Array.isArray(c) && c.length >= 2)
    .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
}

function parseRing(raw: unknown): [number, number][] {
  return parseRings(raw)[0] ?? [];
}

/** Polygon·MultiPolygon의 바깥 고리를 모두 반환 */
function parseRings(raw: unknown): [number, number][][] {
  if (!raw || typeof raw !== 'object') return [];
  const g = raw as { type?: string; coordinates?: unknown };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const ring = coordsToRing((g.coordinates as number[][][])[0]);
    return ring.length >= 3 ? [ring] : [];
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    const out: [number, number][][] = [];
    for (const poly of g.coordinates as number[][][][]) {
      const ring = coordsToRing(poly?.[0]);
      if (ring.length >= 3) out.push(ring);
    }
    return out;
  }
  return [];
}

/** 구멍이 있는 면: [바깥 고리, ...구멍 고리] (4326) */
export type ZonePolygon = [number, number][][];

/** Polygon·MultiPolygon을 구멍 포함 그대로 반환 */
function parsePolygons(raw: unknown): ZonePolygon[] {
  if (!raw || typeof raw !== 'object') return [];
  const g = raw as { type?: string; coordinates?: unknown };
  const one = (poly: number[][][] | undefined): ZonePolygon | null => {
    const rs = (poly ?? []).map(coordsToRing).filter((r) => r.length >= 3);
    return rs.length > 0 ? rs : null;
  };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const p = one(g.coordinates as number[][][]);
    return p ? [p] : [];
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    return (g.coordinates as number[][][][]).map(one).filter((p): p is ZonePolygon => p != null);
  }
  return [];
}

/** 입력 면 정리(숫자 검증·고리 닫기) */
function cleanPolygons(raw: unknown): ZonePolygon[] {
  if (!Array.isArray(raw)) return [];
  const out: ZonePolygon[] = [];
  for (const poly of raw) {
    if (!Array.isArray(poly)) continue;
    const rings: [number, number][][] = [];
    for (const ring of poly) {
      if (!Array.isArray(ring)) continue;
      const r = (ring as unknown[])
        .filter((c): c is unknown[] => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
        .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
      const closed = closeRing(r);
      if (closed.length >= 4) rings.push(closed);
    }
    if (rings.length > 0) out.push(rings);
  }
  return out;
}

function zoneGeoJsonFromPolygons(polys: ZonePolygon[]): unknown {
  const closed = polys
    .map((p) => p.map(closeRing).filter((r) => r.length >= 4))
    .filter((p) => p.length > 0);
  if (closed.length === 0) return null;
  if (closed.length === 1) return { type: 'Polygon', coordinates: closed[0] };
  return { type: 'MultiPolygon', coordinates: closed };
}

function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const closed = [...ring];
  const first = closed[0]!;
  const last = closed[closed.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) closed.push([first[0], first[1]]);
  return closed;
}

function zoneGeoJsonFromRings(rings: [number, number][][]): unknown {
  const closed = rings.map(closeRing).filter((r) => r.length >= 4);
  if (closed.length === 0) return null;
  if (closed.length === 1) return { type: 'Polygon', coordinates: [closed[0]] };
  return { type: 'MultiPolygon', coordinates: closed.map((r) => [r]) };
}

/** 고리 → POLYGON WKT(4326). SQL 합치기용 */
function ringToPolygonWkt(ring: [number, number][]): string | null {
  const closed = closeRing(
    ring
      .filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
      .map((c) => [Number(c[0]), Number(c[1])] as [number, number])
  );
  if (closed.length < 4) return null;
  return `POLYGON((${closed.map((c) => `${c[0]} ${c[1]}`).join(',')}))`;
}

/** 면(구멍 포함) → POLYGON WKT(4326) */
function polygonToWkt(poly: ZonePolygon): string | null {
  const rings = poly
    .map((ring) =>
      closeRing(
        ring
          .filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
          .map((c) => [Number(c[0]), Number(c[1])] as [number, number])
      )
    )
    .filter((r) => r.length >= 4);
  if (rings.length === 0) return null;
  return `POLYGON(${rings.map((r) => `(${r.map((c) => `${c[0]} ${c[1]}`).join(',')})`).join(',')})`;
}

/**
 * 알림문용 — 면 사이 틈이 AREA_LABEL_CLUSTER_GAP_M 이하면 갭을 메워 한 Polygon으로 합친다.
 * (팽창→합치기→수축). 구역도 캡처·대상지역 문구가 같은 면을 쓰도록.
 */
async function clusterPolygonsForHwpx(polys: ZonePolygon[]): Promise<ZonePolygon[]> {
  if (polys.length <= 1) return polys;
  const wkts = polys.map(polygonToWkt).filter((w): w is string => Boolean(w));
  if (wkts.length <= 1) return polys;
  const halfGap = AREA_LABEL_CLUSTER_GAP_M / 2;
  const values = wkts.map((w, i) => `(${i}, '${w}')`).join(',');
  try {
    const res = await db.execute(
      sql.raw(
        `WITH parts AS (
           SELECT ST_MakeValid(ST_Transform(ST_GeomFromText(v.w, 4326), 3857)) AS g
           FROM (VALUES ${values}) AS v(i, w)
         ),
         closed AS (
           SELECT ST_MakeValid(
             ST_Buffer(
               ST_UnaryUnion(ST_Collect(ST_Buffer(g, ${halfGap}, ${ANGULAR_BUFFER}))),
               -${halfGap},
               ${ANGULAR_BUFFER}
             )
           ) AS g
           FROM parts
         )
         SELECT ST_AsGeoJSON(ST_Transform(
           ST_CollectionExtract(
             CASE
               WHEN g IS NULL OR ST_IsEmpty(g) THEN (
                 SELECT ST_UnaryUnion(ST_Collect(ST_Buffer(p.g, ${halfGap}, ${ANGULAR_BUFFER})))
                 FROM parts p
               )
               ELSE g
             END,
             3
           ),
           4326
         ))::json AS geom
         FROM closed`
      )
    );
    const geom = (res.rows?.[0] as { geom?: unknown } | undefined)?.geom;
    const out = parsePolygons(geom);
    if (out.length > 0) return out;
  } catch (e) {
    console.warn('[wtlOutage] clusterPolygonsForHwpx', e);
  }
  return polys;
}

/**
 * 알림문 구역도·대상지역용 면 — 지도 결과 면을 AREA_LABEL_CLUSTER_GAP_M으로 합친다.
 * 화면 지도는 바꾸지 않는다.
 */
export async function clusterWtlOutageHwpxPolygons(params: {
  polygons?: ZonePolygon[];
  rings?: [number, number][][];
  ring?: [number, number][];
}): Promise<{ polygons: ZonePolygon[]; error?: string }> {
  const fromPolys = cleanPolygons(params.polygons);
  const fromRings = (
    params.rings && params.rings.length > 0 ? params.rings : params.ring ? [params.ring] : []
  )
    .filter((r) => Array.isArray(r) && r.length >= 3)
    .map((r) => [r] as ZonePolygon);
  const raw = fromPolys.length > 0 ? fromPolys : fromRings;
  if (raw.length === 0) return { polygons: [], error: '단수 구역이 없습니다.' };
  return { polygons: await clusterPolygonsForHwpx(raw) };
}

/**
 * 분석으로 그린 붉은 면(건물군+버퍼)끼리 — 겹치면 하나의 Polygon으로 합친다.
 * 떨어져 있으면 MultiPolygon으로 남긴다.
 */
async function unionBuildingGroupRings(
  rawRings: [number, number][][]
): Promise<{ rings: [number, number][][]; polygons: ZonePolygon[] }> {
  const wkts = rawRings
    .map(ringToPolygonWkt)
    .filter((w): w is string => Boolean(w));
  if (wkts.length === 0) return { rings: [], polygons: [] };
  if (wkts.length === 1) {
    const rings = rawRings
      .map((r) => closeRing(r))
      .filter((r) => r.length >= 4)
      .slice(0, 1);
    return { rings, polygons: rings.map((r) => [r]) };
  }
  const values = wkts.map((w, i) => `(${i}, '${w}')`).join(',');
  /** 틈 ≤ ZONE_MAP_CLUSTER_GAP_M 이면 붙도록 갭/2 팽창→합치기→수축(형태 닫기) */
  const halfGap = ZONE_MAP_CLUSTER_GAP_M / 2;
  try {
    const res = await db.execute(
      sql.raw(
        `WITH parts AS (
           SELECT ST_MakeValid(ST_Transform(ST_GeomFromText(v.w, 4326), 3857)) AS g
           FROM (VALUES ${values}) AS v(i, w)
         ),
         closed AS (
           SELECT ST_MakeValid(
             ST_Buffer(
               ST_UnaryUnion(ST_Collect(ST_Buffer(g, ${halfGap}, ${ANGULAR_BUFFER}))),
               -${halfGap},
               ${ANGULAR_BUFFER}
             )
           ) AS g
           FROM parts
         )
         SELECT ST_AsGeoJSON(ST_Transform(
           ST_CollectionExtract(
             CASE
               WHEN g IS NULL OR ST_IsEmpty(g) THEN (
                 SELECT ST_UnaryUnion(ST_Collect(ST_Buffer(p.g, ${halfGap}, ${ANGULAR_BUFFER})))
                 FROM parts p
               )
               ELSE g
             END,
             3
           ),
           4326
         ))::json AS geom
         FROM closed`
      )
    );
    const geom = (res.rows?.[0] as { geom?: unknown } | undefined)?.geom;
    const polygons = parsePolygons(geom);
    const rings = parseRings(geom);
    if (polygons.length > 0) {
      return {
        rings: rings.length > 0 ? rings : polygons.map((p) => p[0]!).filter(Boolean),
        polygons,
      };
    }
    if (rings.length > 0) return { rings, polygons: rings.map((r) => [r]) };
  } catch (e) {
    console.warn('[wtlOutage] union building rings', e);
  }
  const cleaned = rawRings
    .map((r) => closeRing(r))
    .filter((r) => r.length >= 4);
  return { rings: cleaned, polygons: cleaned.map((r) => [r]) };
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

/** 컬럼 존재(true)만 캐시 */
const columnExistsCache = new Set<string>();

async function columnExists(schema: string, table: string, column: string): Promise<boolean> {
  const key = `${schema}.${table.toLowerCase()}.${column.toLowerCase()}`;
  if (columnExistsCache.has(key)) return true;
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = '${esc(schema)}'
         AND lower(table_name) = '${esc(table.toLowerCase())}'
         AND lower(column_name) = '${esc(column.toLowerCase())}'
       LIMIT 1`
    )
  );
  const exists = (res.rows?.length ?? 0) > 0;
  if (exists) columnExistsCache.add(key);
  return exists;
}

function mapGateRow(row: Record<string, unknown>): WtlOutageGateDto | null {
  const ogcFid = Number(row.ogcFid);
  if (!Number.isFinite(ogcFid)) return null;
  const point = parseLonLat(row.geom);
  if (!point) return null;
  const name = String(ogcFid);
  const diameter = asStr(row.stdDip);
  return {
    id: gateIdOf(ogcFid),
    name,
    diameter: diameter ? `${diameter}mm` : '—',
    address: asStr(row.hjd) || '—',
    point,
  };
}

/** 끝점 스냅용 노드 키 (NODE_SNAP_M) */
function nodeKey(x: number, y: number, snapM = NODE_SNAP_M): string {
  const s = snapM;
  const nx = Math.round(x / s) * s;
  const ny = Math.round(y / s) * s;
  return `${nx}_${ny}`;
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
 * 지도 중심(경위도)에서 가장 가까운 제수변 1건 — 단수구역 최초 진입 시 이동용.
 */
export async function findNearestWtlOutageGate(params: {
  lon?: number;
  lat?: number;
} = {}): Promise<{ rows: WtlOutageGateDto[] }> {
  const lon = Number(params.lon);
  const lat = Number(params.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { rows: [] };
  if (!(await tableExists('layer', 'wtl_valv_ps'))) return { rows: [] };
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS "ogcFid",
         t.ftr_idn AS "ftrIdn",
         t.std_dip AS "stdDip",
         t.hjd_cde AS hjd,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom
       FROM layer.wtl_valv_ps t
       WHERE t.geom IS NOT NULL
         AND t.ftr_cde = '${GATE_FTR}'
       ORDER BY t.geom <-> ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), ST_SRID(t.geom))
       LIMIT 1`
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
 * 제수변 번호(ogc_fid)로 찾기 — 지도 이동용. 정확히 일치 우선, 없으면 앞부분 일치.
 */
export async function findWtlOutageGates(params: { query?: string; limit?: number } = {}): Promise<{
  rows: WtlOutageGateDto[];
}> {
  const query = asStr(params.query).replace(/\s+/g, '');
  if (!query || !(await tableExists('layer', 'wtl_valv_ps'))) return { rows: [] };
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
  const q = esc(query);
  const like = esc(query.replace(/[\\%_]/g, (c) => `\\${c}`));
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS "ogcFid",
         t.ftr_idn AS "ftrIdn",
         t.std_dip AS "stdDip",
         t.hjd_cde AS hjd,
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom
       FROM layer.wtl_valv_ps t
       WHERE t.geom IS NOT NULL
         AND t.ftr_cde = '${GATE_FTR}'
         AND (t.ogc_fid::text = '${q}' OR t.ogc_fid::text LIKE '${like}%')
       ORDER BY (t.ogc_fid::text = '${q}') DESC, length(t.ogc_fid::text), t.ogc_fid
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

/**
 * 화면 범위(3857) 안 관로 목록 — WMS 미가용 시 vector fallback
 */
export async function listWtlPipesInView(params: {
  bbox?: number[] | null;
  limit?: number;
} = {}): Promise<{
  pipes: { coords: [number, number][]; table: PipeTable }[];
}> {
  const pipes: { coords: [number, number][]; table: PipeTable }[] = [];
  if (!params.bbox || params.bbox.length !== 4) return { pipes };
  const [minX, minY, maxX, maxY] = params.bbox;
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return { pipes };
  const limit = Math.min(Math.max(Number(params.limit) || 3000, 1), 8000);
  for (const table of ['wtl_pipe_lm', 'wtl_sply_ls'] as const) {
    if (!(await tableExists('layer', table))) continue;
    try {
      const res = await db.execute(
        sql.raw(
          `WITH srid AS (
             SELECT ST_SRID(geom) AS s FROM layer."${table}" WHERE geom IS NOT NULL LIMIT 1
           )
           SELECT ST_AsGeoJSON(ST_Transform(line, 4326))::json AS geom
           FROM (
             SELECT
               CASE WHEN GeometryType(geom) LIKE 'MULTI%' THEN ST_GeometryN(geom, 1) ELSE geom END AS line
             FROM layer."${table}", srid
             WHERE geom IS NOT NULL
               AND ST_Intersects(geom, ST_Transform(ST_MakeEnvelope(${minX},${minY},${maxX},${maxY},3857), srid.s))
           ) t
           WHERE GeometryType(t.line) LIKE '%LINE%'
           LIMIT ${limit}`
        )
      );
      for (const raw of res.rows ?? []) {
        const r = raw as Record<string, unknown>;
        const coords = parseLineCoords(r.geom);
        if (coords.length >= 2) pipes.push({ coords, table });
      }
    } catch {
      /* skip table */
    }
  }
  return { pipes };
}

/** GeoJSON LineString/Multi → 좌표열 */
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
  return flatten((g as { coordinates?: unknown }).coordinates);
}

async function loadPipesInBbox(
  table: PipeTable,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  snapM = NODE_SNAP_M
): Promise<PipeRec[]> {
  if (!(await tableExists('layer', table))) return [];
  const hasFtr = await columnExists('layer', table, 'ftr_idn');
  const res = await db.execute(
    sql.raw(
      `SELECT
         t.ogc_fid AS id,
         t.ftr AS "ftrIdn",
         ST_X(ST_StartPoint(line)) AS sx,
         ST_Y(ST_StartPoint(line)) AS sy,
         ST_X(ST_EndPoint(line)) AS ex,
         ST_Y(ST_EndPoint(line)) AS ey,
         ST_AsGeoJSON(line)::json AS "geomNative",
         ST_AsGeoJSON(ST_Transform(line, 4326))::json AS geom
       FROM (
         SELECT
           ogc_fid,
           ${hasFtr ? `NULLIF(trim(ftr_idn::text), '')` : `NULL::text`} AS ftr,
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
    let coords = parseLineCoords(r.geomNative);
    if (coords.length < 2) coords = [
      [sx, sy],
      [ex, ey],
    ];
    out.push({
      key: `${table}:${ogcFid}`,
      table,
      ogcFid,
      sx,
      sy,
      ex,
      ey,
      startKey: nodeKey(sx, sy, snapM),
      endKey: nodeKey(ex, ey, snapM),
      coords,
      geom4326: r.geom,
      ftrIdn: asStr(r.ftrIdn),
    });
  }
  return out;
}

/** 시드 진행방향 군집·방위 허용 각도(도) — 디버그 표기용 */
const SEED_BEARING_DEG = 45;
/** 추적된 본관 선분 중간에 붙은 급수 판정(m) */
const MID_SPLY_ATTACH_M = 1.5;

export type SeedClusterScore = {
  keys: string[];
  bearings: number[];
  dir: string;
  chosen: boolean;
};

export type WtlOutageFlowDirOption = {
  dir: string;
  seedCount: number;
  bearings: number[];
};

type TraceOutage = {
  pipes: PipeRec[];
  seedKeys: Set<string>;
  seedChoice: SeedClusterScore[];
  /** 잠긴 밸브 절점 — 대체급수 판정 시 이 절점으로 급수가 새지 않게 절단 */
  cutNodes: Set<string>;
};

function pipeBearingDeg(p: PipeRec): number {
  return (Math.atan2(p.ex - p.sx, p.ey - p.sy) * 180) / Math.PI;
}

/** 점↔선분 거리² */
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

/** 점↔절점 폴리라인 최소 거리² */
function distPointPolyline2(px: number, py: number, coords: [number, number][]): number {
  if (coords.length < 2) {
    const c0 = coords[0];
    return c0 ? dist2(px, py, c0[0], c0[1]) : Number.POSITIVE_INFINITY;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const d = distPointSeg2(px, py, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

function angleDiffDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function bearingToFlowDir(deg: number): WtlOutageFlowDir {
  let best: WtlOutageFlowDir = '북';
  let bestD = Infinity;
  for (const dir of WTL_OUTAGE_FLOW_DIRS) {
    const d = angleDiffDeg(deg, FLOW_DIR_BEARING[dir]);
    if (d < bestD) {
      bestD = d;
      best = dir;
    }
  }
  return best;
}

/** 같은 진행방향(각도)끼리 묶기 — 디버그·케이스용 */
function clusterByBearing(cands: PipeRec[]): PipeRec[][] {
  const sorted = [...cands].sort((a, b) => pipeBearingDeg(a) - pipeBearingDeg(b));
  const clusters: PipeRec[][] = [];
  for (const p of sorted) {
    const b = pipeBearingDeg(p);
    let placed = false;
    for (const c of clusters) {
      const mean =
        c.reduce((s, x) => s + pipeBearingDeg(x), 0) / Math.max(c.length, 1);
      if (angleDiffDeg(b, mean) <= SEED_BEARING_DEG) {
        c.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([p]);
  }
  return clusters;
}

function meanBearing(cluster: PipeRec[]): number {
  if (cluster.length === 0) return 0;
  return cluster.reduce((s, p) => s + pipeBearingDeg(p), 0) / cluster.length;
}

/**
 * 고정 규칙 (둘 다 만족):
 * 1) 시드 먼쪽 끝에서 절점 연결을 탐 → 이어진 관(남서 등) 유지
 * 2) 잠긴 밸브 절점·밸브에 붙은 비서드 관은 다리로 쓰지 않음 → 밸브 너머 역방향 차단
 * 3) 대체급수 판정에서도 같은 절점 절단 (하류가 통째로 제외되던 오판 방지)
 * «밸브로 거리 감소면 스킵» 같은 조건은 쓰지 않음(이어진 관이 다시 끊김).
 */
function traceDownstreamPipes(
  pipes: PipeRec[],
  gateXy: { x: number; y: number }[],
  valveM = VALVE_CUT_M,
  policy: WtlOutagePolicy = WTL_OUTAGE_POLICY_DEFAULT
): TraceOutage {
  const byKey = new Map(pipes.map((p) => [p.key, p]));
  const atNode = new Map<string, PipeRec[]>();
  for (const p of pipes) {
    const add = (k: string) => {
      const list = atNode.get(k);
      if (list) list.push(p);
      else atNode.set(k, [p]);
    };
    add(p.startKey);
    add(p.endKey);
  }

  const onPipeDist2 = valveM * valveM;
  const outletStartDist2 = OUTLET_START_M * OUTLET_START_M;
  const cutDist2 = valveM * valveM;

  /** 잠긴 밸브에 붙은 절점만 절단(짧은 출구 먼쪽 끝은 열어둠) */
  const cutNodes = new Set<string>();
  for (const g of gateXy) {
    for (const p of pipes) {
      if (dist2(g.x, g.y, p.sx, p.sy) <= cutDist2) cutNodes.add(p.startKey);
      if (dist2(g.x, g.y, p.ex, p.ey) <= cutDist2) cutNodes.add(p.endKey);
    }
  }

  const minDistGate2 = (x: number, y: number): number => {
    let best = Infinity;
    for (const g of gateXy) {
      const d = dist2(g.x, g.y, x, y);
      if (d < best) best = d;
    }
    return best;
  };

  const pipeCoords = (p: PipeRec): [number, number][] =>
    p.coords.length >= 2
      ? p.coords
      : [
          [p.sx, p.sy],
          [p.ex, p.ey],
        ];

  /** 밸브가 앉은 관(끝만 닿으면 유입 → 제외). 본관 우선 */
  const seatedKeys = new Set<string>();
  const seatedCands: PipeRec[] = [];
  const pushSeated = (p: PipeRec) => {
    if (seatedKeys.has(p.key)) return;
    seatedKeys.add(p.key);
    seatedCands.push(p);
  };

  /** seatBeforeJunctionAsSeed 정책으로 시드가 된 관 — 막다른 끝이어도 continuesOnMain 면제 */
  const policySeatedKeys = new Set<string>();
  for (const g of gateXy) {
    const hits: { p: PipeRec; dLine: number; nearStart: boolean; nearEnd: boolean }[] = [];
    for (const p of pipes) {
      const dLine = distPointPolyline2(g.x, g.y, pipeCoords(p));
      if (dLine > onPipeDist2) continue;
      const dStart = dist2(g.x, g.y, p.sx, p.sy);
      const dEnd = dist2(g.x, g.y, p.ex, p.ey);
      const nearStart = dStart <= outletStartDist2;
      const nearEnd = dEnd <= outletStartDist2;
      // 끝점만 밸브 → 유입(상류 도착). 하류 시드 아님
      if (nearEnd && !nearStart) {
        // 단, 밸브가 이 관 선 위에 앉았고 끝점(접합점)보다 앞에 있으면 앉은 관을 시드로 인정
        const seatedBeforeJunction =
          policy.seatBeforeJunctionAsSeed &&
          p.table === 'wtl_pipe_lm' &&
          dLine <= policy.seatOnLineM * policy.seatOnLineM &&
          dEnd >= policy.seatEndClearM * policy.seatEndClearM;
        if (!seatedBeforeJunction) continue;
        policySeatedKeys.add(p.key);
      }
      hits.push({ p, dLine, nearStart, nearEnd });
    }
    const closest = Math.min(...hits.map((h) => h.dLine));
    /** 밸브가 실제로 올라앉은 선만. 1m 넘게 떨어진 본관을 같이 앉히면 본관 전체가 단수가 됨 */
    const sit2 = 0.5 * 0.5;
    const onValve = hits.filter((h) => h.dLine <= closest + sit2);
    const mainsOnValve = onValve.filter((h) => h.p.table === 'wtl_pipe_lm');
    if (mainsOnValve.length > 0) {
      for (const h of mainsOnValve) pushSeated(h.p);
    } else {
      onValve.sort((a, b) => a.dLine - b.dLine);
      for (const h of onValve) pushSeated(h.p);
    }
  }

  /** 밸브 절점에 시작이 붙은 출구(좁은 거리). 앉은 관과 별도 */
  const outletCands: PipeRec[] = [];
  const outletKeys = new Set<string>();
  for (const g of gateXy) {
    for (const p of pipes) {
      if (seatedKeys.has(p.key) || outletKeys.has(p.key)) continue;
      const dStart = dist2(g.x, g.y, p.sx, p.sy);
      const dEnd = dist2(g.x, g.y, p.ex, p.ey);
      if (dStart > outletStartDist2 || dStart > dEnd) continue;
      outletKeys.add(p.key);
      outletCands.push(p);
    }
  }

  const pipeLenM = (p: PipeRec): number => {
    if (p.coords.length >= 2) {
      let len = 0;
      for (let i = 1; i < p.coords.length; i++) {
        const a = p.coords[i - 1]!;
        const b = p.coords[i]!;
        len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      return len;
    }
    return Math.hypot(p.ex - p.sx, p.ey - p.sy);
  };

  /**
   * 시드 후보: 먼쪽 끝이 다른 본관(최소 길이 이상)으로 이어질 때만.
   * 밸브에 앉았거나 출구여도, 급수만·초단 본관만 붙는 가지는 시드에서 제외.
   */
  const continuesOnMain = (p: PipeRec): boolean => {
    const dStart = minDistGate2(p.sx, p.sy);
    const dEnd = minDistGate2(p.ex, p.ey);
    const farKey = dEnd >= dStart ? p.endKey : p.startKey;
    for (const q of atNode.get(farKey) ?? []) {
      if (q.key === p.key) continue;
      if (q.table !== 'wtl_pipe_lm') continue;
      if (pipeLenM(q) < MAIN_CONTINUE_MIN_M) continue;
      if (minDistGate2(q.sx, q.sy) <= cutDist2 || minDistGate2(q.ex, q.ey) <= cutDist2) {
        continue;
      }
      return true;
    }
    return false;
  };

  let seatedSeeds = seatedCands.filter((p) => policySeatedKeys.has(p.key) || continuesOnMain(p));
  /**
   * 짧은 연결관(T자 쪽)과 긴 가지가 함께 시드면, 짧은 관 먼 끝이 본관 접점이라
   * 반대 방향까지 단수가 열린다. 긴 시드가 있으면 초단 시드는 뺀다.
   */
  if (seatedSeeds.length > 1) {
    const longSeeds = seatedSeeds.filter((p) => pipeLenM(p) >= MAIN_CONTINUE_MIN_M);
    if (longSeeds.length > 0) seatedSeeds = longSeeds;
  }
  /**
   * 앉은 관 시드가 있으면 그 관만 사용.
   * T자 접점의 옆 본관 시작점이 3m 안이라고 출구 시드로 넣으면
   * 잠근 가지와 무관한 본관 방향까지 단수가 된다.
   */
  const outletSeeds =
    seatedSeeds.length > 0 ? [] : outletCands.filter(continuesOnMain);

  if (seatedSeeds.length === 0 && outletSeeds.length === 0) {
    let best: PipeRec | null = null;
    let bestD = Infinity;
    for (const g of gateXy) {
      for (const p of pipes) {
        const dStart = dist2(g.x, g.y, p.sx, p.sy);
        const dEnd = dist2(g.x, g.y, p.ex, p.ey);
        if (dEnd < dStart && dEnd <= outletStartDist2) continue;
        const dLine = distPointPolyline2(g.x, g.y, pipeCoords(p));
        if (dLine < bestD && dLine <= onPipeDist2 * 4) {
          bestD = dLine;
          best = p;
        }
      }
    }
    if (best) {
      pushSeated(best);
      seatedSeeds = [best];
    }
  }

  const allCands = [...seatedSeeds, ...outletSeeds];
  const chosenSeeds = allCands;

  const clusters = clusterByBearing(allCands);
  const seedChoice: SeedClusterScore[] = clusters.map((cluster) => {
    const bearings = cluster.map((p) => Math.round(pipeBearingDeg(p) * 10) / 10);
    const dir = bearingToFlowDir(meanBearing(cluster));
    return {
      keys: cluster.map((p) => p.key),
      bearings,
      dir,
      chosen: true,
    };
  });

  const visited = new Set<string>();
  const seedKeys = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];
  /** 초단 출구(<절단반경)라도 밸브에서 먼쪽 끝은 열어 하류로 이어짐 */
  const seedFarFrontier = new Set<string>();

  const enqueueNode = (k: string) => {
    if (!k || queued.has(k)) return;
    queued.add(k);
    queue.push(k);
  };

  /** 밸브에 붙은 비서드 관 — 상·하류를 잇는 다리로 쓰지 않음 */
  const touchesValveCut = (p: PipeRec): boolean =>
    minDistGate2(p.sx, p.sy) <= cutDist2 || minDistGate2(p.ex, p.ey) <= cutDist2;

  for (const p of chosenSeeds) {
    if (visited.has(p.key)) continue;
    visited.add(p.key);
    seedKeys.add(p.key);
    // 짧은 시드 관도 양 끝을 절단. 끝점이 밸브 2.5m 밖이면 절단이 비어
    // 하류 가지가 큰 망 루프로 «대체급수» 처리되며 단수에서 빠진다.
    cutNodes.add(p.startKey);
    cutNodes.add(p.endKey);
    const dStart = minDistGate2(p.sx, p.sy);
    const dEnd = minDistGate2(p.ex, p.ey);
    const ends: { key: string; d2: number }[] = [
      { key: p.startKey, d2: dStart },
      { key: p.endKey, d2: dEnd },
    ];
    ends.sort((a, b) => b.d2 - a.d2);
    const far = ends[0]!;
    // 밸브에서 먼 쪽(하류)만 연다. 가까운 쪽까지 열면 상류·본관까지 추적된 뒤
    // 루프 대체급수로 하류까지 통째로 제외된다.
    seedFarFrontier.add(far.key);
    enqueueNode(far.key);
  }

  while (queue.length > 0 && visited.size < PIPE_MAX) {
    const node = queue.shift()!;
    if (cutNodes.has(node) && !seedFarFrontier.has(node)) continue;
    for (const p of atNode.get(node) ?? []) {
      if (visited.has(p.key)) continue;
      // 시드가 아닌데 밸브에 붙어 있으면 역방향 다리 — 타지 않음
      if (!seedKeys.has(p.key) && touchesValveCut(p)) continue;
      const other = p.startKey === node ? p.endKey : p.startKey;
      if (cutNodes.has(other) && !seedFarFrontier.has(other)) continue;
      visited.add(p.key);
      enqueueNode(other);
    }
  }

  return {
    pipes: [...visited].map((k) => byKey.get(k)!).filter(Boolean),
    seedKeys,
    seedChoice,
    cutNodes,
  };
}

function pipeCoordsOf(p: PipeRec): [number, number][] {
  return p.coords.length >= 2
    ? p.coords
    : [
        [p.sx, p.sy],
        [p.ex, p.ey],
      ];
}

/**
 * 시드와 끝점으로 이어진 후보만 유지.
 * 대체급수로 본관이 빠진 뒤 남은 급수 섬(부분·부분 주황)을 제거.
 */
function retainConnectedToSeeds(candidates: PipeRec[], seedKeys: Set<string>): PipeRec[] {
  if (candidates.length === 0) return candidates;
  const byKey = new Map(candidates.map((p) => [p.key, p]));
  const atNode = new Map<string, PipeRec[]>();
  const addAt = (node: string, p: PipeRec) => {
    const list = atNode.get(node);
    if (list) list.push(p);
    else atNode.set(node, [p]);
  };
  for (const p of candidates) {
    addAt(p.startKey, p);
    addAt(p.endKey, p);
  }

  const kept = new Set<string>();
  const qNodes: string[] = [];
  const seenNode = new Set<string>();
  const enqueue = (node: string) => {
    if (!node || seenNode.has(node)) return;
    seenNode.add(node);
    qNodes.push(node);
  };

  for (const sk of seedKeys) {
    const p = byKey.get(sk);
    if (!p) continue;
    kept.add(p.key);
    enqueue(p.startKey);
    enqueue(p.endKey);
  }

  while (qNodes.length > 0) {
    const node = qNodes.shift()!;
    for (const p of atNode.get(node) ?? []) {
      if (kept.has(p.key)) continue;
      kept.add(p.key);
      enqueue(p.startKey);
      enqueue(p.endKey);
    }
  }

  return candidates.filter((p) => kept.has(p.key));
}

/**
 * 단수로 남은 본관 선분에 시작점이 붙은 급수만 추가.
 * 추적 중 전 본관에 뿌리거나 끝점 역enqueue 하지 않음.
 */
function attachMidSplyOnKeptMains(kept: PipeRec[], allPipes: PipeRec[]): PipeRec[] {
  if (kept.length === 0) return kept;
  const keptKeys = new Set(kept.map((p) => p.key));
  const attachDist2 = MID_SPLY_ATTACH_M * MID_SPLY_ATTACH_M;
  const mains = kept.filter((p) => p.table === 'wtl_pipe_lm');
  if (mains.length === 0) return kept;

  const added: PipeRec[] = [];
  for (const trunk of mains) {
    const coords = pipeCoordsOf(trunk);
    for (const sp of allPipes) {
      if (sp.table !== 'wtl_sply_ls' || keptKeys.has(sp.key)) continue;
      if (kept.length + added.length >= PIPE_MAX) break;
      if (distPointPolyline2(sp.sx, sp.sy, coords) > attachDist2) continue;
      keptKeys.add(sp.key);
      added.push(sp);
    }
  }
  if (added.length === 0) return kept;
  if (!WTL_OUTAGE_POLICY_DEFAULT.followSplyChain) return [...kept, ...added];

  // 본관에 붙은 급수관의 끝점에서 다시 시작하는 급수관(급수→급수 분기)도 따라간다.
  // 급수관끼리만 잇고, 이미 단수인 본관·다른 본관 노드는 건드리지 않는다.
  const splyAtNode = new Map<string, PipeRec[]>();
  for (const sp of allPipes) {
    if (sp.table !== 'wtl_sply_ls') continue;
    for (const k of [sp.startKey, sp.endKey]) {
      const list = splyAtNode.get(k);
      if (list) list.push(sp);
      else splyAtNode.set(k, [sp]);
    }
  }
  const queue = [...added];
  while (queue.length > 0 && kept.length + added.length < PIPE_MAX) {
    const cur = queue.shift()!;
    for (const k of [cur.startKey, cur.endKey]) {
      for (const sp of splyAtNode.get(k) ?? []) {
        if (keptKeys.has(sp.key)) continue;
        if (kept.length + added.length >= PIPE_MAX) break;
        keptKeys.add(sp.key);
        added.push(sp);
        queue.push(sp);
      }
    }
  }
  return [...kept, ...added];
}

/**
 * 잠근 시드·밸브 절점을 끊은 뒤, 살아 있는 관망에서 이어지면 단수에서 제외.
 * 시드 관만 빼면 밸브 절점에서 상·하류가 다시 붙어 하류 전체가 «급수됨»으로 잘못 빠지므로,
 * cutNodes에 닿는 관 연결도 함께 끊는다.
 */
function excludeStillSupplied(
  candidates: PipeRec[],
  allPipes: PipeRec[],
  seedKeys: Set<string>,
  cutNodes: Set<string>
): PipeRec[] {
  if (candidates.length === 0) return candidates;
  const candidateKeys = new Set(candidates.map((p) => p.key));

  type Edge = { key: string; a: string; b: string };
  const edges: Edge[] = [];
  for (const p of allPipes) {
    if (seedKeys.has(p.key)) continue;
    // 잠긴 밸브 절점을 지나는 연결은 급수 경로로 쓰지 않음
    if (cutNodes.has(p.startKey) || cutNodes.has(p.endKey)) continue;
    edges.push({ key: p.key, a: p.startKey, b: p.endKey });
  }

  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const la = adj.get(a);
    if (la) la.push(b);
    else adj.set(a, [b]);
  };
  for (const e of edges) {
    link(e.a, e.b);
    link(e.b, e.a);
  }

  const wet = new Set<string>();
  const q: string[] = [];
  for (const e of edges) {
    if (candidateKeys.has(e.key)) continue;
    if (!wet.has(e.a)) {
      wet.add(e.a);
      q.push(e.a);
    }
    if (!wet.has(e.b)) {
      wet.add(e.b);
      q.push(e.b);
    }
  }

  while (q.length > 0) {
    const n = q.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (wet.has(m)) continue;
      wet.add(m);
      q.push(m);
    }
  }

  // 시드(잠근 출구)는 항상 단수.
  // 그 외: 양쪽 끝이 모두 살아 있는 망에 닿을 때만 대체급수로 제외.
  return candidates.filter((p) => {
    if (seedKeys.has(p.key)) return true;
    const bothWet = wet.has(p.startKey) && wet.has(p.endKey);
    return !bothWet;
  });
}

const ISOLATE_GRID_M = 20;
/** 이 관 수 이상이거나 조회 범위 밖으로 이어지는 관망은 «물이 공급되는 본망»으로 본다 */
const LIVE_MIN_PIPES = PIPE_MAX;

/** 단수 판정 조각: 관 전체 또는 제수변 위치에서 잘린 일부 */
type OutagePiece = {
  rec: PipeRec;
  /** 레이어 SRID 좌표 */
  native: [number, number][];
  /** 4326 좌표(표시·면 생성). 꼭짓점 수가 안 맞으면 null → 원본 사용 */
  wgs: [number, number][] | null;
  /** 이 끝이 잠긴 제수변 위치(절단)면 true — 그 끝으로는 연결하지 않음 */
  cutStart: boolean;
  cutEnd: boolean;
  /** 원본 관을 자른 조각인지 */
  partial: boolean;
};

type LineCut = { seg: number; r: number; along: number };

function polylineProject(coords: [number, number][], x: number, y: number): LineCut & { d2: number } {
  let best = { seg: 0, r: 0, along: 0, d2: Number.POSITIVE_INFINITY };
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    let t = len2 <= 1e-12 ? 0 : ((x - a[0]) * dx + (y - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d2 = dist2(x, y, a[0] + dx * t, a[1] + dy * t);
    if (d2 < best.d2) best = { seg: i, r: t, along: acc + len * t, d2 };
    acc += len;
  }
  return best;
}

function polylineLength(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += Math.hypot(coords[i]![0] - coords[i - 1]![0], coords[i]![1] - coords[i - 1]![1]);
  }
  return len;
}

function lerpAt(coords: [number, number][], cut: LineCut): [number, number] {
  const a = coords[cut.seg]!;
  const b = coords[cut.seg + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * cut.r, a[1] + (b[1] - a[1]) * cut.r];
}

/** from~to 절단 사이 조각(같은 seg·r 규칙으로 native·wgs 동시 적용) */
function sliceBetween(
  coords: [number, number][],
  from: LineCut | null,
  to: LineCut | null
): [number, number][] {
  const out: [number, number][] = [];
  const startPt = from ? lerpAt(coords, from) : coords[0]!;
  out.push(startPt);
  const firstIdx = from ? from.seg + 1 : 1;
  const lastIdx = to ? to.seg : coords.length - 1;
  for (let i = firstIdx; i <= lastIdx; i++) out.push(coords[i]!);
  if (to) out.push(lerpAt(coords, to));
  return out;
}

/** 제수변 끝점 판정 여유(m): 이 안이면 관 끝에 있는 제수변으로 보고 자르지 않고 끝을 끊는다 */
const VALVE_END_M = 0.3;
/**
 * 같은 제수변에 «앉은» 관 인정 폭(m): 가장 가까운 관 + 이 값까지.
 * 제수변이 관 접점에 있으면 두 관이 모두 0m라 함께 잘림(=접점 절단).
 * 0.5m로 두면 접합부 옆을 지나는 다른 관까지 잘려 단수가 과대해짐.
 */
const VALVE_SEAT_SLACK_M = 0.1;

/**
 * 잠근 제수변만 닫힌 상태에서 물이 들어올 수 없는 관 조각을 위상으로 판정(방향 개념 없음).
 * 1) 각 제수변이 실제로 앉은 관(가장 가까운 관 + 0.5m)을 제수변 위치에서 자른다.
 *    관 끝에 있으면 그 끝을 끊고, 중간이면 두 조각으로 나눠 안쪽 끝을 끊는다.
 * 2) 조각을 끝점 스냅 + T자 분기로 연결해 관망 성분을 만든다(끊긴 끝은 연결 안 함).
 * 3) 큰 관망(LIVE_MIN_PIPES 이상)·조회 범위 밖으로 이어지는 관망은 «공급됨».
 * 4) 제수변에서 끊긴 끝을 가진 성분 중 공급되지 않는 성분이 단수.
 * 제수변 사이에 갇힌 구간은 2개 이상 잠갔을 때 단수로 잡힌다.
 */
function isolateByLockedValves(
  allPipes: PipeRec[],
  gateXy: { x: number; y: number }[],
  bbox: [number, number, number, number],
  snapM: number,
  teeJoinM: number
): { pieces: OutagePiece[]; cutPipeKeys: Set<string> } {
  // 1) 관별 절단 위치 수집
  const cutsByPipe = new Map<string, LineCut[]>();
  const cutPoints: [number, number][] = [];
  for (const g of gateXy) {
    const hits: { p: PipeRec; cut: LineCut; d: number }[] = [];
    for (const p of allPipes) {
      const cs = pipeCoordsOf(p);
      const pr = polylineProject(cs, g.x, g.y);
      const d = Math.sqrt(pr.d2);
      if (d > VALVE_ON_PIPE_M) continue;
      hits.push({ p, cut: { seg: pr.seg, r: pr.r, along: pr.along }, d });
    }
    if (hits.length === 0) continue;
    const closest = Math.min(...hits.map((h) => h.d));
    const seated = hits.filter((h) => h.d <= closest + VALVE_SEAT_SLACK_M);
    // 본관에 앉았으면 근처 급수관은 자르지 않음
    const mains = seated.filter((h) => h.p.table === 'wtl_pipe_lm');
    for (const h of mains.length > 0 ? mains : seated) {
      const list = cutsByPipe.get(h.p.key);
      if (list) list.push(h.cut);
      else cutsByPipe.set(h.p.key, [h.cut]);
      cutPoints.push(lerpAt(pipeCoordsOf(h.p), h.cut));
    }
  }

  // 조각 만들기
  const pieces: OutagePiece[] = [];
  for (const p of allPipes) {
    const native = pipeCoordsOf(p);
    const wgsRaw = parseLine(p.geom4326);
    const wgs = wgsRaw && wgsRaw.length === native.length ? wgsRaw : null;
    const cuts = cutsByPipe.get(p.key);
    if (!cuts) {
      pieces.push({ rec: p, native, wgs: wgsRaw, cutStart: false, cutEnd: false, partial: false });
      continue;
    }
    const total = polylineLength(native);
    let cutStart = false;
    let cutEnd = false;
    const inner: LineCut[] = [];
    for (const c of cuts) {
      if (c.along <= VALVE_END_M) cutStart = true;
      else if (c.along >= total - VALVE_END_M) cutEnd = true;
      else inner.push(c);
    }
    inner.sort((a, b) => a.along - b.along);
    if (inner.length === 0) {
      pieces.push({ rec: p, native, wgs: wgsRaw, cutStart, cutEnd, partial: false });
      continue;
    }
    const bounds: (LineCut | null)[] = [null, ...inner, null];
    for (let i = 0; i < bounds.length - 1; i++) {
      const from = bounds[i]!;
      const to = bounds[i + 1]!;
      pieces.push({
        rec: p,
        native: sliceBetween(native, from, to),
        wgs: wgs ? sliceBetween(wgs, from, to) : null,
        cutStart: i === 0 ? cutStart : true,
        cutEnd: i === bounds.length - 2 ? cutEnd : true,
        partial: true,
      });
    }
  }

  // 2) 연결 성분
  const parent = pieces.map((_, i) => i);
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
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const ends = (pc: OutagePiece) => {
    const s = pc.native[0]!;
    const e = pc.native[pc.native.length - 1]!;
    return [
      { x: s[0], y: s[1], cut: pc.cutStart },
      { x: e[0], y: e[1], cut: pc.cutEnd },
    ];
  };

  const atNode = new Map<string, number>();
  pieces.forEach((pc, i) => {
    for (const end of ends(pc)) {
      if (end.cut) continue;
      const k = nodeKey(end.x, end.y, snapM);
      const j = atNode.get(k);
      if (j == null) atNode.set(k, i);
      else union(i, j);
    }
  });

  const cellOf = (v: number) => Math.floor(v / ISOLATE_GRID_M);
  const grid = new Map<string, number[]>();
  pieces.forEach((pc, i) => {
    const seen = new Set<string>();
    const cs = pc.native;
    for (let s = 0; s < cs.length - 1; s++) {
      const a = cs[s]!;
      const b = cs[s + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (ISOLATE_GRID_M / 2)));
      for (let t = 0; t <= n; t++) {
        const key = `${cellOf(a[0] + ((b[0] - a[0]) * t) / n)}_${cellOf(a[1] + ((b[1] - a[1]) * t) / n)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  });
  const nearCut = (x: number, y: number, tol: number) =>
    cutPoints.some((c) => dist2(c[0], c[1], x, y) <= tol * tol);

  if (teeJoinM > 0) {
    const tol2 = teeJoinM * teeJoinM;
    pieces.forEach((pc, i) => {
      for (const end of ends(pc)) {
        if (end.cut) continue;
        // 제수변 바로 옆 끝점은 T자로 잇지 않음(절단 너머로 다시 붙는 것 방지)
        if (nearCut(end.x, end.y, teeJoinM)) continue;
        const cx = cellOf(end.x);
        const cy = cellOf(end.y);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const j of grid.get(`${cx + dx}_${cy + dy}`) ?? []) {
              if (j === i) continue;
              if (distPointPolyline2(end.x, end.y, pieces[j]!.native) <= tol2) union(i, j);
            }
          }
        }
      }
    });
  }

  // 3) 공급되는 관망
  const [minX, minY, maxX, maxY] = bbox;
  const outside = (x: number, y: number) => x < minX || x > maxX || y < minY || y > maxY;
  const size = new Map<number, number>();
  const edge = new Set<number>();
  pieces.forEach((pc, i) => {
    const r = find(i);
    size.set(r, (size.get(r) ?? 0) + 1);
    if (ends(pc).some((e) => outside(e.x, e.y))) edge.add(r);
  });
  const live = new Set<number>();
  let largest = -1;
  let largestSize = 0;
  for (const [r, n] of size) {
    if (n >= LIVE_MIN_PIPES || edge.has(r)) live.add(r);
    if (n > largestSize) {
      largestSize = n;
      largest = r;
    }
  }
  if (live.size === 0 && largest >= 0) live.add(largest);

  // 4) 제수변에서 끊긴 끝을 가진 비공급 성분 = 단수
  //    제수변이 관 끝 사이에 살짝 떠 있으면(디지타이징 오차) 반대편 관은 «앉은 관»에 못 들어가
  //    cut 표시가 없다. 그래도 절단 반대편으로 분리돼 있으므로, 제수변 근처에 끝이 닿은
  //    비공급 성분도 단수로 본다(안 그러면 «단수 구간 없음»으로 잘못 판정됨).
  const valveNear2 = VALVE_ON_PIPE_M * VALVE_ON_PIPE_M;
  const endNearValve = (pc: OutagePiece): boolean =>
    ends(pc).some((e) => gateXy.some((g) => dist2(g.x, g.y, e.x, e.y) <= valveNear2));
  const dry = new Set<number>();
  pieces.forEach((pc, i) => {
    if (!(pc.cutStart || pc.cutEnd || endNearValve(pc))) return;
    const r = find(i);
    if (!live.has(r)) dry.add(r);
  });
  const out: OutagePiece[] = [];
  for (let i = 0; i < pieces.length && out.length < PIPE_MAX; i++) {
    if (dry.has(find(i))) out.push(pieces[i]!);
  }
  return { pieces: out, cutPipeKeys: new Set(cutsByPipe.keys()) };
}

type OutageMeterSelection = {
  fids: number[];
  /** fids와 같은 순서: 가장 가까운 단수 조각 index(pieces 기준)와 거리(m, 레이어 SRID) */
  pieceIdx: number[];
  distM: number[];
  /** fids와 같은 순서: 계량기 위도(3857 m 보정용) */
  lat: number[];
  /** fids와 같은 순서: 계량기 [lon, lat] */
  points: [number, number][];
};

/**
 * 단수 관로 조각에 실제로 물려 있는 계량기(wtl_meta_ps)만 고른다.
 * 1) meta.pip_idn 이 관로 ftr_idn 과 같으면 그 관이 단수 조각인지로 판정(잠근 밸브 뒤 관이면 제외)
 * 2) 매칭 관이 없거나 중간이 잘린 관이면 거리로 판정: 단수 조각이 가장 가깝고
 *    공급 중인 관보다 METER_AMBIG_M 이상 가까울 때만 포함
 */
async function selectOutageMeters(
  allPipes: PipeRec[],
  pieces: OutagePiece[]
): Promise<OutageMeterSelection | null> {
  if (pieces.length === 0 || allPipes.length === 0) return null;
  if (!(await tableExists('layer', 'wtl_meta_ps'))) return null;
  const hasPip = await columnExists('layer', 'wtl_meta_ps', 'pip_idn');

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pc of pieces) {
    for (const c of pc.native) {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const pad = METER_MAX_M + METER_AMBIG_M + 5;
  const srcTable = pieces[0]!.rec.table;

  const res = await db.execute(
    sql.raw(
      `WITH srid AS (
         SELECT ST_SRID(geom) AS s FROM layer."${srcTable}" WHERE geom IS NOT NULL LIMIT 1
       )
       SELECT
         t.ogc_fid AS id,
         ${hasPip ? `NULLIF(trim(t.pip_idn::text), '')` : `NULL::text`} AS pip,
         ST_X(ST_Transform(ST_Centroid(t.geom), srid.s)) AS x,
         ST_Y(ST_Transform(ST_Centroid(t.geom), srid.s)) AS y,
         ST_X(ST_Transform(ST_Centroid(t.geom), 4326)) AS lon,
         ST_Y(ST_Transform(ST_Centroid(t.geom), 4326)) AS lat
       FROM layer.wtl_meta_ps t, srid
       WHERE t.geom IS NOT NULL
         AND t.geom && ST_Transform(
           ST_MakeEnvelope(${minX - pad}, ${minY - pad}, ${maxX + pad}, ${maxY + pad}, srid.s),
           ST_SRID(t.geom)
         )
       LIMIT ${METER_CANDIDATE_LIMIT}`
    )
  );

  const dryKeys = new Set<string>();
  const partialKeys = new Set<string>();
  const dryByKey = new Map<string, [number, number][][]>();
  for (const pc of pieces) {
    const k = pc.rec.key;
    dryKeys.add(k);
    if (pc.partial) partialKeys.add(k);
    const list = dryByKey.get(k);
    if (list) list.push(pc.native);
    else dryByKey.set(k, [pc.native]);
  }
  const byFtr = new Map<string, PipeRec[]>();
  for (const p of allPipes) {
    if (!p.ftrIdn) continue;
    const list = byFtr.get(p.ftrIdn);
    if (list) list.push(p);
    else byFtr.set(p.ftrIdn, [p]);
  }
  const pipeBoxes = allPipes.map((p) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of pipeCoordsOf(p)) {
      if (c[0] < x0) x0 = c[0];
      if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1];
      if (c[1] > y1) y1 = c[1];
    }
    return { p, x0, y0, x1, y1 };
  });

  const nearestPiece = (x: number, y: number): { idx: number; d: number } => {
    let best = Infinity;
    let idx = -1;
    pieces.forEach((pc, i) => {
      const d2 = distPointPolyline2(x, y, pc.native);
      if (d2 < best) {
        best = d2;
        idx = i;
      }
    });
    return { idx, d: Math.sqrt(best) };
  };

  const distToDryPieces = (x: number, y: number, key?: string): number => {
    let best = Infinity;
    const lists = key ? (dryByKey.get(key) ?? []) : [...dryByKey.values()].flat();
    for (const native of lists) {
      const d2 = distPointPolyline2(x, y, native);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };

  const fids: number[] = [];
  const pieceIdx: number[] = [];
  const distM: number[] = [];
  const latList: number[] = [];
  const pointList: [number, number][] = [];
  const seen = new Set<number>();
  for (const raw of res.rows ?? []) {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id);
    const x = Number(r.x);
    const y = Number(r.y);
    const lon = Number(r.lon);
    const lat = Number(r.lat);
    if (![id, x, y, lon, lat].every(Number.isFinite) || seen.has(id)) continue;
    seen.add(id);

    let inside: boolean | null = null;
    const pip = asStr(r.pip);
    const matched = pip ? byFtr.get(pip) : undefined;
    if (matched && matched.length > 0) {
      if (matched.some((p) => dryKeys.has(p.key) && !partialKeys.has(p.key))) inside = true;
      else if (matched.every((p) => !dryKeys.has(p.key))) inside = false;
      // 일부만 잘린 관이면 아래 거리 판정
    }
    if (inside == null) {
      const dDry = distToDryPieces(x, y);
      if (!(dDry <= METER_MAX_M)) {
        inside = false;
      } else {
        const reach = dDry + METER_AMBIG_M;
        let dLive = Infinity;
        for (const b of pipeBoxes) {
          if (x < b.x0 - reach || x > b.x1 + reach || y < b.y0 - reach || y > b.y1 + reach) continue;
          const dFull = Math.sqrt(distPointPolyline2(x, y, pipeCoordsOf(b.p)));
          const dryOwn = dryByKey.has(b.p.key) ? distToDryPieces(x, y, b.p.key) : Infinity;
          // 단수 조각이 있는 관은 가장 가까운 점이 살아있는 부분일 때만 경쟁자
          if (dryOwn !== Infinity && dFull >= dryOwn - 0.01) continue;
          if (dFull < dLive) dLive = dFull;
        }
        inside = dLive - dDry >= METER_AMBIG_M || (METER_AMBIG_INCLUDE && dLive >= dDry);
      }
    }
    if (!inside) continue;
    const near = nearestPiece(x, y);
    if (near.idx < 0) continue;
    fids.push(id);
    pieceIdx.push(near.idx);
    distM.push(near.d);
    latList.push(lat);
    pointList.push([lon, lat]);
  }
  return { fids, pieceIdx, distM, lat: latList, points: pointList };
}

/**
 * 초기 단수 면 — 조각별 버퍼를 만들되, 관로가 실폭도로 면 위에 있으면 그 도로 면으로 자른다.
 * 도로 밖 관로는 자르지 않고(기존 방식), 도로 밖 계량기는 작은 원으로 면에 남긴다.
 * 편집 화면의 재계산(buildWtlOutageZone)은 자르지 않으므로 수정은 자유롭다.
 */
// 보관: 이전 초기 면(계량기까지 넓힌 관로 버퍼 + 실폭도로 자르기). 현재는 관로를 따라서만 그림
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function buildInitialZoneClippedToRoad(
  pipes: [number, number][][],
  lineBuffers: number[],
  meterPoints: [number, number][],
  /** 건물군 면(4326) — 자르지 않고 그대로 합침 */
  extraRings: [number, number][][] = []
): Promise<[number, number][][]> {
  if (pipes.length === 0 || (meterPoints.length === 0 && extraRings.length === 0)) return [];
  if (!(await tableExists(ROAD_SCHEMA, ROAD_TABLE))) return [];
  const values = pipes
    .map((line, i) => {
      const b = Math.min(ZONE_BUFFER_MAX_M, Math.max(ZONE_BUFFER_MIN_M, Math.round(Number(lineBuffers[i]))));
      return `('LINESTRING(${line.map((c) => `${Number(c[0])} ${Number(c[1])}`).join(',')})', ${b})`;
    })
    .join(',');
  const keepParts: string[] = [];
  if (meterPoints.length > 0) {
    const mp = `MULTIPOINT(${meterPoints.map((p) => `(${Number(p[0])} ${Number(p[1])})`).join(',')})`;
    keepParts.push(`ST_Buffer(ST_Transform(ST_GeomFromText('${mp}', 4326), 3857), ${METER_KEEP_R_M})`);
  }
  const extraJson = zoneGeoJsonFromRings(extraRings);
  if (extraJson) {
    keepParts.push(
      `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(extraJson))}'), 4326), 3857)`
    );
  }
  const res = await db.execute(
    sql.raw(
      `WITH v AS (
         SELECT ST_Transform(ST_GeomFromText(t.w, 4326), 3857) AS g, t.b AS b
         FROM (VALUES ${values}) AS t(w, b)
       ),
       raw_road AS (
         SELECT ST_UnaryUnion(ST_Collect(ST_MakeValid(ST_Transform(r.geom, 3857)))) AS g
         FROM ${ROAD_SCHEMA}.${ROAD_TABLE} r,
              (SELECT ST_SetSRID(ST_Extent(ST_Buffer(g, b))::geometry, 3857) AS e FROM v) bb
         WHERE r.geom IS NOT NULL
           AND r.geom && ST_Transform(bb.e, ST_SRID(r.geom))
       ),
       -- 애매하게 끊긴 도로(짧은 틈·조각 사이)는 닫기(+N 후 -N)로 이어 붙인다
       road AS (
         SELECT CASE WHEN g IS NULL THEN NULL
                ELSE ST_Buffer(ST_Buffer(g, ${ROAD_BRIDGE_M}), -${ROAD_BRIDGE_M}) END AS g,
                CASE WHEN g IS NULL THEN NULL
                ELSE ST_Buffer(ST_Buffer(ST_Buffer(g, ${ROAD_BRIDGE_M}), -${ROAD_BRIDGE_M}), ${ROAD_SPLIT_TOL_M}) END AS tol
         FROM raw_road
       ),
       -- 관로를 도로 위 구간 / 도로 밖(긴 틈 포함) 구간으로 나눠 위는 도로로 자르고 밖은 그대로 버퍼
       z AS (
         SELECT CASE
             WHEN road.g IS NULL THEN ST_Buffer(v.g, v.b)
             ELSE ST_Union(
               ST_CollectionExtract(
                 ST_Intersection(
                   ST_Buffer(ST_CollectionExtract(ST_Intersection(v.g, road.tol), 2), v.b),
                   road.g
                 ),
                 3
               ),
               ST_Buffer(ST_CollectionExtract(ST_Difference(v.g, road.tol), 2), v.b)
             )
           END AS g
         FROM v CROSS JOIN road
       )
       SELECT ST_AsGeoJSON(ST_Transform(
         ST_CollectionExtract(
           ST_UnaryUnion(ST_Collect(ARRAY[
             (SELECT ST_Collect(z.g) FROM z),
             ${keepParts.join(', ')}
           ])),
           3
         ),
         4326
       ))::json AS geom`
    )
  );
  return parseRings((res.rows?.[0] as { geom?: unknown } | undefined)?.geom);
}

/** 건물군 테이블 도형 컬럼·SRID(프로세스당 1회) */
let buildingGeomCache: { col: string; srid: number } | null | undefined;
async function buildingGeomInfo(): Promise<{ col: string; srid: number } | null> {
  if (buildingGeomCache !== undefined) return buildingGeomCache;
  if (!(await tableExists(BUILDING_SCHEMA, BUILDING_TABLE))) return null; // 나중에 생길 수 있어 캐시 안 함
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT f_geometry_column AS col, srid FROM geometry_columns
         WHERE f_table_schema = '${BUILDING_SCHEMA}' AND f_table_name = '${BUILDING_TABLE}' LIMIT 1`
      )
    );
    const row = res.rows?.[0] as { col?: unknown; srid?: unknown } | undefined;
    const col = asStr(row?.col);
    buildingGeomCache = col ? { col, srid: Number(row?.srid) || 0 } : null;
  } catch {
    buildingGeomCache = null;
  }
  return buildingGeomCache;
}

/**
 * 계량기별로 속하거나(BUILDING_NEAR_M 이내) 인접한 건물군을 찾는다.
 * 반환: 건물군이 있는 계량기 index(points 기준) + 그 건물군들을 합친 면(4326, 여유 포함).
 */
async function queryMeterBuildings(
  points: [number, number][]
): Promise<{ withBuilding: Set<number>; rings: [number, number][][] }> {
  const empty = { withBuilding: new Set<number>(), rings: [] as [number, number][][] };
  if (points.length === 0) return empty;
  const info = await buildingGeomInfo();
  if (!info) return empty;
  const col = `"${info.col.replace(/"/g, '""')}"`;
  // SRID가 비어 있으면(0) 지적·도로와 같은 5181로 간주
  const srid = info.srid > 0 ? info.srid : 5181;
  const bGeom = info.srid > 0 ? `b.${col}` : `ST_SetSRID(b.${col}, 5181)`;
  const values = points
    .map((p, i) => `(${i}, ${Number(p[0])}, ${Number(p[1])})`)
    .join(',');
  const res = await db.execute(
    sql.raw(
      `WITH m AS (
         SELECT v.i, ST_Transform(ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326), ${srid}) AS g
         FROM (VALUES ${values}) AS v(i, lon, lat)
       ),
       hit AS (
         SELECT m.i, ${bGeom} AS g
         FROM m
         JOIN ${BUILDING_SCHEMA}.${BUILDING_TABLE} b
           ON b.${col} IS NOT NULL
          AND ST_DWithin(${bGeom}, m.g, ${BUILDING_NEAR_M})
       )
       SELECT
         (SELECT COALESCE(array_agg(DISTINCT hit.i), '{}') FROM hit) AS idx,
         -- 건물마다 버퍼를 준 뒤, 그 그린 면이 겹치면 합친다
         (SELECT ST_AsGeoJSON(ST_Transform(
            ST_CollectionExtract(
              ST_UnaryUnion(ST_Collect(
                ST_Buffer(ST_Transform(ST_MakeValid(hit.g), 3857), ${BUILDING_MARGIN_M}, ${ANGULAR_BUFFER})
              )),
              3
            ),
            4326
          ))::json FROM hit) AS geom`
    )
  );
  const row = res.rows?.[0] as { idx?: unknown; geom?: unknown } | undefined;
  const idxRaw = Array.isArray(row?.idx) ? row!.idx : [];
  const withBuilding = new Set(idxRaw.map(Number).filter((n) => Number.isInteger(n)));
  return { withBuilding, rings: parseRings(row?.geom) };
}

/**
 * 건물군 면(4326 고리들)마다 단수 관로(4326 선들)까지 최단선 연결 띠(폭 PIPE_TRACE_BUFFER_M, 각지게).
 * 이미 관로 띠에 닿은 건물군·BUILDING_CONNECT_MAX_M보다 먼 건물군은 잇지 않는다.
 */
async function connectBuildingsToLines(
  buildingRings: [number, number][][],
  lines: [number, number][][]
): Promise<[number, number][][]> {
  const bldJson = zoneGeoJsonFromRings(buildingRings);
  const ls = lines.filter((l) => l.length >= 2);
  if (!bldJson || ls.length === 0) return [];
  const wkt = `MULTILINESTRING(${ls
    .map((l) => `(${l.map((c) => `${Number(c[0])} ${Number(c[1])}`).join(',')})`)
    .join(',')})`;
  const res = await db.execute(
    sql.raw(
      `WITH b AS (
         SELECT (ST_Dump(ST_MakeValid(ST_Transform(
           ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(bldJson))}'), 4326), 3857
         )))).geom AS g
       ),
       p AS (SELECT ST_Transform(ST_GeomFromText('${wkt}', 4326), 3857) AS g),
       pt AS (SELECT p.g, ST_Buffer(p.g, ${PIPE_TRACE_BUFFER_M}, ${ANGULAR_BUFFER}) AS face FROM p)
       SELECT ST_AsGeoJSON(ST_Transform(ST_UnaryUnion(ST_Collect(
         ST_Buffer(ST_ShortestLine(b.g, pt.g), ${PIPE_TRACE_BUFFER_M}, ${ANGULAR_BUFFER})
       )), 4326))::json AS geom
       FROM b, pt
       WHERE NOT ST_Intersects(b.g, pt.face)
         AND ST_Distance(b.g, pt.g) <= ${BUILDING_CONNECT_MAX_M}`
    )
  );
  return parseRings((res.rows?.[0] as { geom?: unknown } | undefined)?.geom);
}

/** 관로 레이어 SRID(테이블별, 프로세스당 1회) */
const pipeSridCache = new Map<PipeTable, number>();
async function pipeTableSrid(table: PipeTable): Promise<number> {
  const hit = pipeSridCache.get(table);
  if (hit != null) return hit;
  const res = await db.execute(
    sql.raw(`SELECT ST_SRID(geom) AS s FROM layer."${table}" WHERE geom IS NOT NULL LIMIT 1`)
  );
  const srid = Number((res.rows?.[0] as { s?: unknown } | undefined)?.s) || 0;
  if (srid > 0) pipeSridCache.set(table, srid);
  return srid;
}

/**
 * 계량기가 없는 건물군 중 단수로 봐야 하는 것.
 * - 단수 관로(outageLines, 4326)에서 METERLESS_BUILDING_CAND_M 안, 단수 급수관에서 METERLESS_BUILDING_SPLY_MAX_M 안
 * - 안에 계량기(wtl_meta_ps)가 하나도 없음(계량기가 있으면 계량기 판정을 따름)
 * - 급수 중인 관로(단수 조각을 뺀 급수관·본관)가 max(단수 관로 거리 + AMBIG, 단수 관로 거리 × RATIO) 안에 없음
 * excludeRings(이미 넣은 건물군 면)와 겹치는 건물군은 다시 넣지 않는다.
 */
async function queryMeterlessOutageBuildings(
  outageLines: [number, number][][],
  /** outageLines와 같은 순서: 급수관(wtl_sply_ls) 조각이면 true */
  isSply: boolean[],
  excludeRings: [number, number][][]
): Promise<{ rings: [number, number][][]; count: number }> {
  const empty = { rings: [] as [number, number][][], count: 0 };
  const lines = outageLines.filter((l) => l.length >= 2);
  const splyLines = outageLines.filter((l, i) => l.length >= 2 && isSply[i]);
  // 단수 급수관이 없으면 계량기 없는 건물군을 넣을 근거가 없음
  if (lines.length === 0 || splyLines.length === 0) return empty;
  const info = await buildingGeomInfo();
  if (!info) return empty;
  const hasMeta = await tableExists('layer', 'wtl_meta_ps');
  const pipeTables: PipeTable[] = [];
  for (const t of ['wtl_sply_ls', 'wtl_pipe_lm'] as const) {
    if (await tableExists('layer', t)) pipeTables.push(t);
  }
  const col = `"${info.col.replace(/"/g, '""')}"`;
  const bs = info.srid > 0 ? info.srid : 5181;
  const bGeom = info.srid > 0 ? `b.${col}` : `ST_SetSRID(b.${col}, 5181)`;
  const toWkt = (ls: [number, number][][]) =>
    `MULTILINESTRING(${ls
      .map((l) => `(${l.map((c) => `${Number(c[0])} ${Number(c[1])}`).join(',')})`)
      .join(',')})`;
  const wkt = toWkt(lines);
  const splyWkt = toWkt(splyLines);

  const metaSrid = hasMeta
    ? Number(
        ((await db.execute(sql.raw(`SELECT ST_SRID(geom) AS s FROM layer.wtl_meta_ps WHERE geom IS NOT NULL LIMIT 1`)))
          .rows?.[0] as { s?: unknown } | undefined)?.s
      ) || bs
    : bs;
  const noMeter = hasMeta
    ? `AND NOT EXISTS (
         SELECT 1 FROM layer.wtl_meta_ps m
         WHERE m.geom && ST_Transform(c.g, ${metaSrid})
           AND ST_Intersects(ST_Transform(m.geom, ${bs}), c.g)
       )`
    : '';
  // 급수 중인 관로 = 관로에서 단수 조각(0.3m 폭)을 뺀 나머지
  const liveChecks: string[] = [];
  for (const t of pipeTables) {
    const ps = (await pipeTableSrid(t)) || bs;
    liveChecks.push(`AND NOT EXISTS (
         SELECT 1 FROM layer."${t}" p
         WHERE p.geom && ST_Transform(
             ST_Expand(c.g, GREATEST(c.d + ${METERLESS_BUILDING_AMBIG_M}, c.d * ${METERLESS_BUILDING_RATIO})),
             ${ps}
           )
           AND ST_DWithin(
             ST_Difference(ST_Transform(p.geom, ${bs}), outl.cut),
             c.g,
             GREATEST(c.d + ${METERLESS_BUILDING_AMBIG_M}, c.d * ${METERLESS_BUILDING_RATIO})
           )
       )`);
  }
  const excludeJson = zoneGeoJsonFromRings(excludeRings);
  // 이미 넣은 건물군 면에 거의 다 덮인 것만 건너뜀(옆에 맞닿기만 한 건물군은 판정 대상)
  const notIncluded = excludeJson
    ? `AND COALESCE(
         ST_Area(ST_Intersection(
           c.g,
           ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(excludeJson))}'), 4326), ${bs})
         )) / NULLIF(ST_Area(c.g), 0),
         0
       ) < 0.9`
    : '';

  const res = await db.execute(
    sql.raw(
      `WITH outl AS (
         SELECT ST_Transform(ST_GeomFromText('${wkt}', 4326), ${bs}) AS g
       ),
       outc AS (
         SELECT g, ST_Buffer(g, 0.3) AS cut,
                ST_Transform(ST_GeomFromText('${splyWkt}', 4326), ${bs}) AS sply
         FROM outl
       ),
       c AS (
         SELECT ${bGeom} AS g, ST_Distance(${bGeom}, outc.g) AS d
         FROM ${BUILDING_SCHEMA}.${BUILDING_TABLE} b, outc
         WHERE b.${col} IS NOT NULL
           AND ST_DWithin(${bGeom}, outc.g, ${METERLESS_BUILDING_CAND_M})
           -- 급수관 근거: 단수 급수관이 가까이 있어야 함(본관만 가까우면 제외)
           AND ST_DWithin(${bGeom}, outc.sply, ${METERLESS_BUILDING_SPLY_MAX_M})
       ),
       hit AS (
         SELECT c.g FROM c, outc AS outl
         WHERE TRUE
           ${noMeter}
           ${notIncluded}
           ${liveChecks.join(' ')}
       )
       SELECT
         (SELECT count(*) FROM hit) AS n,
         -- 건물마다 버퍼를 준 뒤, 그 그린 면이 겹치면 합친다
         (SELECT ST_AsGeoJSON(ST_Transform(
            ST_CollectionExtract(
              ST_UnaryUnion(ST_Collect(
                ST_Buffer(ST_Transform(ST_MakeValid(hit.g), 3857), ${BUILDING_MARGIN_M}, ${ANGULAR_BUFFER})
              )),
              3
            ),
            4326
          ))::json FROM hit) AS geom`
    )
  );
  const row = res.rows?.[0] as { n?: unknown; geom?: unknown } | undefined;
  const count = Number(row?.n) || 0;
  return count > 0 ? { rings: parseRings(row?.geom), count } : empty;
}

/**
 * 단수 조각별 버퍼(m) — 조각에 배정된 계량기 중 가장 먼 것까지 덮는 값(최소 METER_PIPE_R_M).
 * 면 계산이 3857 기준이라 위도 보정(1/cos)을 곱한다. 편집 화면의 선별 버퍼와 같은 단위.
 */
// 보관: 이전 초기 면용 — 현재 미사용
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function lineBuffersFromMeters(pieceCount: number, sel: OutageMeterSelection): number[] {
  const out: number[] = new Array(pieceCount).fill(METER_PIPE_R_M);
  sel.fids.forEach((_, i) => {
    const idx = sel.pieceIdx[i]!;
    const cos = Math.max(0.2, Math.cos((sel.lat[i]! * Math.PI) / 180));
    const need = Math.ceil((Math.min(sel.distM[i]!, METER_BUFFER_CAP_M) + METER_COVER_MARGIN_M) / cos);
    if (need > out[idx]!) out[idx] = need;
  });
  return out.map((b) => Math.min(ZONE_BUFFER_MAX_M, Math.max(ZONE_BUFFER_MIN_M, b)));
}

/**
 * 잠긴 제수변 기준 단수 범위·관로·수용가 분석
 */
export type WtlOutageAnalyzeDebug = {
  algo: {
    seedRule: string;
    nodeSnapM: number;
    valveOnPipeM: number;
    outletStartM: number;
    valveCutM: number;
    mainContinueMinM: number;
  };
  bbox: [number, number, number, number];
  pipeCountInBbox: { pipeLm: number; sply: number; total: number };
  seedKeys: string[];
  seedChoice: SeedClusterScore[];
  tracedKeys: string[];
  outageKeys: string[];
  excludedKeys: string[];
  seedPipes: { key: string; table: string; ogcFid: number; sx: number; sy: number; ex: number; ey: number }[];
  outagePipes: { key: string; table: string; ogcFid: number; sx: number; sy: number; ex: number; ey: number }[];
  gateXy: { x: number; y: number }[];
};

export async function analyzeWtlOutage(params: {
  gateIds?: string[];
  /** 임시: 오류 케이스 수집용 디버그 */
  debug?: boolean;
  ignoreCaseRule?: boolean;
}): Promise<{
  result: WtlOutageResultDto | null;
  gates: WtlOutageGateDto[];
  error?: string;
  /** 패널 배너용 — 예: 고립 불가(no_isolation) */
  errorCode?: 'no_isolation';
  debug?: WtlOutageAnalyzeDebug;
}> {
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

  const learned = await loadTraceCriterion();
  const snapM = Math.max(NODE_SNAP_M, learned.connectM ?? 0);
  const valveM = Math.max(VALVE_CUT_M, learned.valveM ?? 0);
  const [pipeLm, sply] = await Promise.all([
    loadPipesInBbox('wtl_pipe_lm', minX, minY, maxX, maxY, snapM),
    loadPipesInBbox('wtl_sply_ls', minX, minY, maxX, maxY, snapM),
  ]);
  const allPipes = [...pipeLm, ...sply];
  const allPipeByKey = new Map(allPipes.map((p) => [p.key, p]));

  /**
   * 제수변마다 따로 추적한 뒤 합친다.
   * 여러 잠금을 한 번에 추적하면 가까운 제수변이 서로의 시드·절단을 막아
   * 한쪽 결과만 남는다.
   */
  const seedKeys = new Set<string>();
  const seedChoice: SeedClusterScore[] = [];
  const tracedKeys = new Set<string>();
  const cutNodes = new Set<string>();
  const outageByKey = new Map<string, PipeRec>();

  const policy = WTL_OUTAGE_POLICY_DEFAULT;
  /** 위상 판정(신 방식) 결과 조각 — null이면 구 방식 */
  let isoPieces: OutagePiece[] | null = null;
  if (policy.isolateByLockedValves) {
    const iso = isolateByLockedValves(allPipes, gateXy, [minX, minY, maxX, maxY], snapM, policy.teeJoinM);
    if (iso.cutPipeKeys.size === 0) {
      return { result: null, gates, error: '잠근 제수변이 놓인 관로를 찾지 못했습니다.' };
    }
    if (iso.pieces.length === 0) {
      return {
        result: null,
        gates,
        /** 지도 상단은 패널에서 짧은 안내로 표시. 여기 error는 패널용 부가 설명만 */
        errorCode: 'no_isolation' as const,
        error:
          gateXy.length === 1
            ? '다른 관로로 물이 돌아 들어옵니다. 주변 제수변을 함께 잠가 보세요.'
            : '다른 관로로 물이 돌아 들어옵니다. 제수변을 추가로 잠가 보세요.',
      };
    }
    isoPieces = iso.pieces;
    for (const k of iso.cutPipeKeys) seedKeys.add(k);
    for (const pc of iso.pieces) {
      outageByKey.set(pc.rec.key, pc.rec);
      tracedKeys.add(pc.rec.key);
    }
  }
  for (const gate of isoPieces ? [] : gateXy) {
    const traced = traceDownstreamPipes(allPipes, [gate], valveM, policy);
    if (traced.seedKeys.size === 0) continue;
    for (const k of traced.seedKeys) seedKeys.add(k);
    for (const c of traced.seedChoice) seedChoice.push(c);
    for (const p of traced.pipes) tracedKeys.add(p.key);
    for (const n of traced.cutNodes) cutNodes.add(n);

    const afterExclude = excludeStillSupplied(
      traced.pipes,
      allPipes,
      traced.seedKeys,
      traced.cutNodes
    );
    const connected = retainConnectedToSeeds(afterExclude, traced.seedKeys);
    const kept = attachMidSplyOnKeptMains(connected, allPipes);
    for (const p of kept) outageByKey.set(p.key, p);
  }

  if (seedKeys.size === 0) {
    return {
      result: null,
      gates,
      error: '잠근 제수변에 맞닿은 출구 관로를 찾지 못했습니다.',
    };
  }

  const outagePipes = [...outageByKey.values()];
  const traced = {
    pipes: [...tracedKeys].map((k) => allPipeByKey.get(k)!).filter(Boolean),
    seedKeys,
    seedChoice,
    cutNodes,
  };

  const pipes: [number, number][][] = [];
  const geomParts: string[] = [];
  const isoLineWkt: string[] = [];
  /** pipes[i]가 만들어진 isoPieces index */
  const lineOfPiece: number[] = [];
  if (isoPieces) {
    // 잘린 조각 기준으로 관로·면 생성(제수변 바깥쪽 구간은 단수 면에 넣지 않음)
    const wkt = isoLineWkt;
    for (const [pieceIndex, pc] of isoPieces.entries()) {
      const line = pc.wgs ?? parseLine(pc.rec.geom4326);
      if (!line || line.length < 2) continue;
      lineOfPiece.push(pieceIndex);
      pipes.push(line);
      wkt.push(`(${line.map((c) => `${c[0]} ${c[1]}`).join(',')})`);
    }
    if (wkt.length > 0) {
      geomParts.push(
        `SELECT ST_Transform(ST_GeomFromText('MULTILINESTRING(${wkt.join(',')})', 4326), 3857) AS geom`
      );
    }
  } else {
    const byTable = new Map<PipeTable, number[]>();
    for (const p of outagePipes) {
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
  }

  if (geomParts.length === 0) {
    geomParts.push(
      `SELECT ST_Buffer(ST_Transform(ST_Centroid(geom), 3857), ${ZONE_BUFFER_M * 2}, ${ANGULAR_BUFFER}) AS geom
       FROM layer.wtl_valv_ps WHERE ogc_fid IN (${gateFids.join(',')})`
    );
  }

  // 단수 조각에 실제로 물린 계량기 기준으로 초기 면 생성(없으면 관로 버퍼로 폴백)
  let meterSel: OutageMeterSelection | null = null;
  /** 계량기 판정을 실제로 수행했는지(레이어 없음·오류면 false → 관로 버퍼 28m 폴백) */
  let meterJudged = false;
  if (isoPieces) {
    try {
      const sel = await selectOutageMeters(allPipes, isoPieces);
      if (sel) {
        meterJudged = true;
        if (sel.fids.length > 0) meterSel = sel;
      }
    } catch (e) {
      console.warn('[wtlOutage] selectOutageMeters', e);
    }
  }

  // 계량기 기준: 관로 조각별 버퍼를 계량기까지 덮도록 계산 → 편집 화면과 같은 buildWtlOutageZone 경로로 면 생성
  let lineBuffers: number[] | undefined;
  let rings: [number, number][][] = [];
  /** 합친 뒤의 단수 면(겹친 건물군은 한 Polygon). 없으면 rings로 구성 */
  let zonePolygonsMerged: ZonePolygon[] | null = null;
  /** 계량기가 속하거나 인접한 건물군 면 — 있으면 그 계량기는 관로 버퍼·작은 원 대신 건물군 전체로 덮음 */
  let buildingRings: [number, number][][] = [];
  let buildingMeterCount = 0;
  let meterlessBuildingCount = 0;
  if (meterSel && isoPieces) {
    try {
      const bld = await queryMeterBuildings(meterSel.points);
      if (bld.rings.length > 0 && bld.withBuilding.size > 0) {
        buildingRings = bld.rings;
        buildingMeterCount = bld.withBuilding.size;
      }
    } catch (e) {
      console.warn('[wtlOutage] meter buildings', e);
    }
    // 계량기 없는 건물군 — 주변에 급수 중인 관로가 없으면 단수
    try {
      const isSply = lineOfPiece.map((pi) => isoPieces[pi]!.rec.table === 'wtl_sply_ls');
      const extra = await queryMeterlessOutageBuildings(pipes, isSply, buildingRings);
      if (extra.count > 0 && extra.rings.length > 0) {
        buildingRings = [...buildingRings, ...extra.rings];
        meterlessBuildingCount = extra.count;
      }
    } catch (e) {
      console.warn('[wtlOutage] meterless buildings', e);
    }
    // 표시용 단수구역 = 수용가(건물군) 면만. 겹치면 합침. 관로 버퍼·연결 띠는 넣지 않음.
    lineBuffers = pipes.map(() => PIPE_TRACE_BUFFER_M);
    const united = await unionBuildingGroupRings(buildingRings);
    rings = united.rings;
    zonePolygonsMerged = united.polygons.length > 0 ? united.polygons : null;
    // 저장·편집용 건물군도 합친 면과 맞춤
    if (rings.length > 0) buildingRings = rings;
    if (rings.length === 0) {
      // 건물군이 없으면 관로 버퍼 방식으로 폴백
      meterSel = null;
      lineBuffers = undefined;
      buildingRings = [];
      buildingMeterCount = 0;
      meterlessBuildingCount = 0;
      zonePolygonsMerged = null;
    }
  }
  /**
   * 판정은 했는데 단수 계량기가 0개 → «단수 대상 수용가 없음».
   * 28m 폴백으로 넘어가면 넓은 면이 급수 중인 이웃 계량기를 다시 덮어 수용가로 잡으므로,
   * 계량기 기준 최소 폭으로만 그리고 수용가는 넣지 않는다.
   */
  const noOutageMeters = meterJudged && !meterSel && Boolean(isoPieces);
  if (noOutageMeters && isoPieces) {
    lineBuffers = pipes.map(() => NO_METER_BUFFER_M);
    try {
      const isSply = lineOfPiece.map((pi) => isoPieces[pi]!.rec.table === 'wtl_sply_ls');
      const extra = await queryMeterlessOutageBuildings(pipes, isSply, []);
      if (extra.count > 0 && extra.rings.length > 0) {
        buildingRings = extra.rings;
        meterlessBuildingCount = extra.count;
      }
    } catch (e) {
      console.warn('[wtlOutage] meterless buildings', e);
    }
    const united = await unionBuildingGroupRings(buildingRings);
    rings = united.rings;
    zonePolygonsMerged = united.polygons.length > 0 ? united.polygons : null;
    if (rings.length > 0) buildingRings = rings;
  }
  const narrowZone = noOutageMeters && rings.length > 0;
  if (!meterSel && !narrowZone) {
    lineBuffers = undefined;
    buildingRings = [];
    meterlessBuildingCount = 0;
    zonePolygonsMerged = null;
    const zoneSql = geomParts[0]?.includes('ST_Buffer')
      ? `SELECT ST_AsGeoJSON(ST_Transform(ST_UnaryUnion(ST_Collect(geom)), 4326))::json AS geom FROM (
           ${geomParts.join('\nUNION ALL\n')}
         ) z`
      : `SELECT ST_AsGeoJSON(ST_Transform(
           ST_Buffer(ST_Transform(ST_UnaryUnion(ST_Collect(geom)), 3857), ${ZONE_BUFFER_M}, ${ANGULAR_BUFFER}),
           4326
         ))::json AS geom
         FROM (
           ${geomParts.join('\nUNION ALL\n')}
         ) z`;
    const zoneRes = await db.execute(sql.raw(zoneSql));
    rings = parseRings((zoneRes.rows?.[0] as { geom?: unknown } | undefined)?.geom);
  }
  const ring = rings[0] ?? [];

  // 건물군 합친 면 우선. 떨어지면 MultiPolygon 여러 조각. 구멍은 «지우기»로만.
  const zonePolygons: ZonePolygon[] =
    zonePolygonsMerged && zonePolygonsMerged.length > 0
      ? zonePolygonsMerged
      : rings.map((r) => [r]);
  const zoneJsonOut = zoneGeoJsonFromPolygons(zonePolygons);

  const originKey = gates
    .map((g) => g.id)
    .sort()
    .join(',');
  const [{ customers, addresses }, parcels, applied] = await Promise.all([
    // 단수 계량기 0개면 수용가 없음(빈 fid 목록은 «필터 없음»이라 조회 자체를 건너뜀)
    narrowZone
      ? Promise.resolve({ customers: [] as WtlOutageCustomerDto[], addresses: [] as WtlOutageAddressDto[] })
      : queryCustomersInZone(zoneJsonOut, meterSel?.fids, Boolean(meterSel)),
    queryParcelsInZone(zoneJsonOut),
    params.ignoreCaseRule
      ? Promise.resolve(null)
      : matchAppliedTraceAnswer({ feature: '단수', originKey }),
  ]);
  const pipesOut = mergeAppliedTrace(pipes, [], applied).pipes;

  const result: WtlOutageResultDto = {
    gateId: gates.map((g) => g.id).join(','),
    ring,
    rings,
    polygons: zonePolygons,
    pipes: pipesOut,
    parcels,
    addresses,
    customers,
    bufferM: meterSel ? PIPE_TRACE_BUFFER_M : narrowZone ? NO_METER_BUFFER_M : ZONE_BUFFER_M,
    // 학습 답안 병합으로 관로 개수가 달라지면 선별 버퍼 순서가 어긋나므로 내리지 않는다
    ...(lineBuffers && pipesOut.length === lineBuffers.length ? { lineBuffers } : {}),
    zoneBasis: meterSel || narrowZone ? 'meter' : 'pipe',
    meterCount: meterSel ? meterSel.fids.length : narrowZone ? 0 : undefined,
    ...(buildingRings.length > 0 ? { buildingRings, buildingMeterCount, meterlessBuildingCount } : {}),
  };

  const outageKeySet = new Set(outagePipes.map((p) => p.key));
  const excludedKeys = traced.pipes.map((p) => p.key).filter((k) => !outageKeySet.has(k));
  const debug: WtlOutageAnalyzeDebug | undefined = params.debug
    ? {
        algo: {
          seedRule: 'seated-main-or-node-outlet-start',
          nodeSnapM: NODE_SNAP_M,
          valveOnPipeM: VALVE_ON_PIPE_M,
          outletStartM: OUTLET_START_M,
          valveCutM: VALVE_CUT_M,
          mainContinueMinM: MAIN_CONTINUE_MIN_M,
        },
        bbox: [minX, minY, maxX, maxY],
        pipeCountInBbox: {
          pipeLm: pipeLm.length,
          sply: sply.length,
          total: allPipes.length,
        },
        seedKeys: [...traced.seedKeys],
        seedChoice: traced.seedChoice,
        tracedKeys: traced.pipes.map((p) => p.key),
        outageKeys: [...outageKeySet],
        excludedKeys,
        seedPipes: traced.pipes
          .filter((p) => traced.seedKeys.has(p.key))
          .map((p) => ({
            key: p.key,
            table: p.table,
            ogcFid: p.ogcFid,
            sx: p.sx,
            sy: p.sy,
            ex: p.ex,
            ey: p.ey,
          })),
        outagePipes: outagePipes.map((p) => ({
          key: p.key,
          table: p.table,
          ogcFid: p.ogcFid,
          sx: p.sx,
          sy: p.sy,
          ex: p.ex,
          ey: p.ey,
        })),
        gateXy,
      }
    : undefined;

  return {
    result,
    gates,
    debug,
  };
}

/** 지적 레이어 SRID (프로세스당 1회). 0/미확인이면 0 → 기존 CASE 경로 */
let jijukSridCache: number | null = null;
async function getJijukSrid(): Promise<number> {
  if (jijukSridCache != null) return jijukSridCache;
  try {
    const res = await db.execute(
      sql.raw(`SELECT ST_SRID(geom) AS srid FROM public_layer.jijuk WHERE geom IS NOT NULL LIMIT 1`)
    );
    const n = Number((res.rows?.[0] as { srid?: unknown } | undefined)?.srid);
    jijukSridCache = Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
  return jijukSridCache;
}

async function queryCustomersInRings(
  rings: [number, number][][],
  onlyFids?: number[],
  fidsOnly = false
) {
  return queryCustomersInZone(zoneGeoJsonFromRings(rings), onlyFids, fidsOnly);
}

/** 단수 면(GeoJSON, 구멍 포함 가능) 안 수용가 */
async function queryCustomersInZone(
  zoneJson: unknown,
  /** 지정하면 이 계량기(ogc_fid)만 조회 — 면 안에 걸친 인접 구역 계량기 제외 */
  onlyFids?: number[],
  /** true면 onlyFids를 면 안 여부와 상관없이 그대로 조회(분석에서 판정한 단수 계량기) */
  fidsOnly = false
): Promise<{
  customers: WtlOutageCustomerDto[];
  addresses: WtlOutageAddressDto[];
}> {
  const customers: WtlOutageCustomerDto[] = [];
  const addresses: WtlOutageAddressDto[] = [];
  if (!zoneJson || !(await tableExists('layer', 'wtl_meta_ps'))) {
    return { customers, addresses };
  }
  const metaRes = await db.execute(
    sql.raw(
      `WITH zone AS (
         SELECT ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(zoneJson))}'), 4326) AS g
       )
       SELECT
         t.ogc_fid AS id,
         COALESCE(NULLIF(trim(t.hom_nam),''), NULLIF(trim(t.met_num),''), t.ogc_fid::text) AS name,
         COALESCE(NULLIF(trim(t.hom_adr),''), '') AS address,
         COALESCE(NULLIF(trim(t.met_num),''), '') AS "meterNo",
         COALESCE(NULLIF(trim(t.hom_num),''), '') AS "homNum",
         ST_AsGeoJSON(ST_Transform(ST_Centroid(t.geom), 4326))::json AS geom
       FROM layer.wtl_meta_ps t
       CROSS JOIN zone
       WHERE t.geom IS NOT NULL
         AND ${
           fidsOnly && onlyFids && onlyFids.length > 0 ? 'TRUE' : 'ST_Intersects(ST_Transform(t.geom, 4326), zone.g)'
         }${
           onlyFids && onlyFids.length > 0
             ? `
         AND t.ogc_fid IN (${onlyFids.filter((n) => Number.isFinite(n)).join(',')})`
             : ''
         }
       LIMIT ${CUSTOMER_LIMIT}`
    )
  );
  for (const row of metaRes.rows ?? []) {
    const r = row as Record<string, unknown>;
    const id = `c-${asStr(r.id)}`;
    const address = asStr(r.address);
    const meterNo = asStr(r.meterNo);
    const homNum = asStr(r.homNum);
    const point = parseLonLat(r.geom) ?? undefined;
    const ogcFid = Number(r.id);
    const metaFid = Number.isFinite(ogcFid) ? ogcFid : undefined;
    customers.push({
      id,
      name: asStr(r.name) || meterNo || id,
      address: address || '—',
      phone: '',
      meterNo: meterNo || '—',
      point,
      ogcFid: metaFid,
    });
    addresses.push({
      id: `a-${asStr(r.id)}`,
      road: address || '—',
      jibun: '—',
      customerNo: homNum || '—',
      point,
      ogcFid: metaFid,
    });
  }
  await fillAddressJibunFromRoad(addresses);
  return { customers, addresses };
}

const roadToJibunCache = new Map<string, string | null>();
const ROAD_JIBUN_CONCURRENCY = 8;

/** 도로명주소(road) → 해당 주소의 지번 주소(시·도·시·군·구 제외). 필지 지번이 아님 */
async function fillAddressJibunFromRoad(addresses: WtlOutageAddressDto[]): Promise<void> {
  const targets = [
    ...new Set(addresses.map((a) => a.road.trim()).filter((v) => v && v !== '—')),
  ].filter((v) => !roadToJibunCache.has(v));

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const road = targets[cursor++]!;
      try {
        roadToJibunCache.set(road, await fetchNormalizedJibunFromAddressSearch(road));
      } catch {
        roadToJibunCache.set(road, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ROAD_JIBUN_CONCURRENCY, targets.length) }, worker));

  for (const a of addresses) {
    a.jibun = roadToJibunCache.get(a.road.trim()) || '—';
  }
}

const PARCEL_LIMIT = 800;

async function queryParcelsInRings(rings: [number, number][][]): Promise<WtlOutageParcelDto[]> {
  return queryParcelsInZone(zoneGeoJsonFromRings(rings));
}

/** 단수 면(GeoJSON, 구멍 포함 가능)과 겹치는 필지 */
async function queryParcelsInZone(zoneJson: unknown): Promise<WtlOutageParcelDto[]> {
  const parcels: WtlOutageParcelDto[] = [];
  if (!zoneJson || !(await tableExists('public_layer', 'jijuk'))) {
    return parcels;
  }
  try {
    const jijukSrid = await getJijukSrid();
    const res = await db.execute(
      sql.raw(
        `WITH zone AS (
           SELECT ST_Transform(
             ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(zoneJson))}'), 4326),
             ${jijukSrid > 0 ? jijukSrid : 5181}
           ) AS g
         )
         SELECT
           COALESCE(NULLIF(trim(j.pnu::text), ''), j.ctid::text) AS id,
           COALESCE(NULLIF(trim(j.jibun::text), ''), '—') AS jibun,
           NULLIF(TRIM(SUBSTRING(j.jibun::text FROM '(?:산?[0-9]+(?:-[0-9]+)?)[[:space:]]*([가-힣]+)$')), '') AS jimok,
           ROUND(ST_Area(
             CASE
               WHEN ST_SRID(j.geom) = 0 THEN ST_SetSRID(j.geom, 5181)
               WHEN ST_SRID(j.geom) = 5181 THEN j.geom
               ELSE ST_Transform(j.geom, 5181)
             END
           )::numeric, 1) AS area_sqm,
           ST_AsGeoJSON(ST_Transform(
             ST_Centroid(
               CASE
                 WHEN ST_SRID(j.geom) = 0 THEN ST_SetSRID(j.geom, 5181)
                 WHEN ST_SRID(j.geom) = 5181 THEN j.geom
                 ELSE ST_Transform(j.geom, 5181)
               END
             ),
             4326
           ))::json AS geom
         FROM public_layer.jijuk j, zone
         WHERE j.geom IS NOT NULL
           AND ${
             jijukSrid > 0
               ? `ST_Intersects(j.geom, zone.g)`
               : `ST_Intersects(
             CASE
               WHEN ST_SRID(j.geom) = 0 THEN ST_SetSRID(j.geom, 5181)
               WHEN ST_SRID(j.geom) = 5181 THEN j.geom
               ELSE ST_Transform(j.geom, 5181)
             END,
             zone.g
           )`
           }
         ORDER BY j.jibun
         LIMIT ${PARCEL_LIMIT}`
      )
    );
    for (const raw of res.rows ?? []) {
      const r = raw as Record<string, unknown>;
      const areaNum = Number(r.area_sqm);
      parcels.push({
        id: `p-${asStr(r.id)}`,
        jibun: asStr(r.jibun) || '—',
        jimok: asStr(r.jimok) || '—',
        area: Number.isFinite(areaNum) ? `${areaNum}㎡` : '—',
        point: parseLonLat(r.geom) ?? undefined,
      });
    }
  } catch (e) {
    console.warn('[wtlOutage] queryParcelsInRing', e);
  }
  return parcels;
}

/**
 * 도형편집 후 단수 면(4326 ring) 기준 수용가·주소·필지 재조회
 */
export async function refreshWtlOutageZone(params: {
  ring?: [number, number][];
  /** 여러 조각(도형 수정) — 있으면 ring 대신 사용 */
  rings?: [number, number][][];
}): Promise<{
  customers: WtlOutageCustomerDto[];
  addresses: WtlOutageAddressDto[];
  parcels: WtlOutageParcelDto[];
  /** 겹친 조각을 합치고 꼬인 도형을 바로잡은 면(4326) */
  ring?: [number, number][];
  rings?: [number, number][][];
  error?: string;
}> {
  const clean = (raw: unknown): [number, number][] => {
    if (!Array.isArray(raw)) return [];
    const ring = raw
      .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
      .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
    if (ring.length < 3) return [];
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    return ring.length >= 4 ? ring : [];
  };
  const input = (params.rings && params.rings.length > 0 ? params.rings : [params.ring ?? []])
    .map(clean)
    .filter((r) => r.length > 0);
  if (input.length === 0) {
    return { customers: [], addresses: [], parcels: [], error: '단수 구역 도형이 없습니다.' };
  }
  // 겹친 조각은 하나로 합치고, 꼭짓점을 끌다 꼬인 도형은 바로잡는다(좌표는 숫자 검증 후 사용)
  let rings = input;
  try {
    const wkts = input
      .map((r) => `('POLYGON((${r.map((c) => `${c[0]} ${c[1]}`).join(',')}))')`)
      .join(',');
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsGeoJSON(ST_CollectionExtract(
           ST_UnaryUnion(ST_Collect(ST_MakeValid(ST_GeomFromText(v.w, 4326)))),
           3
         ))::json AS geom
         FROM (VALUES ${wkts}) AS v(w)`
      )
    );
    const merged = parseRings((res.rows?.[0] as { geom?: unknown } | undefined)?.geom);
    if (merged.length > 0) rings = merged;
  } catch (e) {
    console.warn('[wtlOutage] refresh zone merge', e);
  }
  const [{ customers, addresses }, parcels] = await Promise.all([
    queryCustomersInRings(rings),
    queryParcelsInRings(rings),
  ]);
  return { customers, addresses, parcels, ring: rings[0], rings };
}

/** 지도 편집 버퍼 허용 범위(m) — 수용가 없는 단수(1m)도 편집 후 유지되게 1m부터 */
const ZONE_BUFFER_MIN_M = 1;
const ZONE_BUFFER_MAX_M = 200;
const ZONE_EDIT_PIPE_MAX = 2000;

/**
 * 지도에서 관로를 늘리거나 줄이고 버퍼를 조정한 뒤 단수 면을 다시 만든다.
 * pipes: 4326 선 목록. withTargets=false면 면(rings)만 계산(드래그 미리보기용).
 */
export async function buildWtlOutageZone(params: {
  pipes?: [number, number][][];
  bufferM?: number;
  /** pipes와 같은 순서의 선별 버퍼(m). 없거나 모자라면 bufferM */
  bufferMs?: number[];
  /** 관로 버퍼에 더 합칠 면(4326 고리) — 건물군 등 */
  extraRings?: [number, number][][];
  /** 면에 남길 점(4326) — 건물군 없는 계량기 */
  keepPoints?: [number, number][];
  /** keepPoints 원 반경(m, 3857 단위) */
  keepRadiusM?: number;
  withTargets?: boolean;
}): Promise<{
  ring: [number, number][];
  rings: [number, number][][];
  /** 단수 면(구멍 포함) */
  polygons: ZonePolygon[];
  bufferM: number;
  customers: WtlOutageCustomerDto[];
  addresses: WtlOutageAddressDto[];
  parcels: WtlOutageParcelDto[];
  error?: string;
}> {
  const bufferM = Math.min(
    ZONE_BUFFER_MAX_M,
    Math.max(ZONE_BUFFER_MIN_M, Math.round(Number(params.bufferM) || ZONE_BUFFER_M))
  );
  const clampBuf = (v: unknown) =>
    Math.min(ZONE_BUFFER_MAX_M, Math.max(ZONE_BUFFER_MIN_M, Math.round(Number(v))));
  const empty = {
    ring: [] as [number, number][],
    rings: [] as [number, number][][],
    polygons: [] as ZonePolygon[],
    bufferM,
    customers: [] as WtlOutageCustomerDto[],
    addresses: [] as WtlOutageAddressDto[],
    parcels: [] as WtlOutageParcelDto[],
  };
  const lines: { line: [number, number][]; buf: number }[] = [];
  (params.pipes ?? []).slice(0, ZONE_EDIT_PIPE_MAX).forEach((raw, i) => {
    if (!Array.isArray(raw)) return;
    const line = raw
      .filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
      .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
    if (line.length < 2) return;
    const own = params.bufferMs?.[i];
    const buf = own != null && Number.isFinite(Number(own)) ? clampBuf(own) : bufferM;
    lines.push({ line, buf });
  });
  if (lines.length === 0) {
    return { ...empty, error: '단수 관로가 없어 구역을 만들 수 없습니다.' };
  }
  // 좌표·버퍼는 모두 숫자로 검증된 값만 SQL에 넣는다. 선별 버퍼로 각각 띄운 뒤 합친다.
  const values = lines
    .map(
      ({ line, buf }) =>
        `('LINESTRING(${line.map((c) => `${c[0]} ${c[1]}`).join(',')})', ${buf})`
    )
    .join(',');
  const extraRings = (params.extraRings ?? [])
    .filter((r) => Array.isArray(r))
    .map((r) =>
      r
        .filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
        .map((c) => [Number(c[0]), Number(c[1])] as [number, number])
    )
    .filter((r) => r.length >= 3);
  const extraJson = zoneGeoJsonFromRings(extraRings);
  const keepPoints = (params.keepPoints ?? []).filter(
    (p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))
  );
  const keepR = Math.max(0.5, Number(params.keepRadiusM) || METER_KEEP_R_M);
  const extraSql =
    (extraJson
      ? `UNION ALL SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(extraJson))}'), 4326), 3857)`
      : '') +
    (keepPoints.length > 0
      ? ` UNION ALL SELECT ST_Buffer(ST_Transform(ST_GeomFromText('MULTIPOINT(${keepPoints
          .map((p) => `(${Number(p[0])} ${Number(p[1])})`)
          .join(',')})', 4326), 3857), ${keepR}, ${ANGULAR_BUFFER})`
      : '');
  const res = await db.execute(
    sql.raw(
      `SELECT ST_AsGeoJSON(ST_Transform(ST_UnaryUnion(ST_Collect(z.g)), 4326))::json AS geom
       FROM (
         SELECT ST_Buffer(ST_Transform(ST_GeomFromText(v.w, 4326), 3857), v.b, ${ANGULAR_BUFFER}) AS g
         FROM (VALUES ${values}) AS v(w, b)
         ${extraSql}
       ) z`
    )
  );
  const zoneGeom = (res.rows?.[0] as { geom?: unknown } | undefined)?.geom;
  const rings = parseRings(zoneGeom);
  const polygons = parsePolygons(zoneGeom);
  if (rings.length === 0) {
    return { ...empty, error: '단수 구역 면을 만들지 못했습니다.' };
  }
  if (params.withTargets === false) {
    return { ...empty, ring: rings[0] ?? [], rings, polygons };
  }
  const zoneJson = zoneGeoJsonFromPolygons(polygons);
  const [{ customers, addresses }, parcels] = await Promise.all([
    queryCustomersInZone(zoneJson),
    queryParcelsInZone(zoneJson),
  ]);
  return { ring: rings[0] ?? [], rings, polygons, bufferM, customers, addresses, parcels };
}

/** 건물 선택 모드에서 한 번에 불러올 건물군 상한 */
const BUILDING_VIEW_LIMIT = 3000;

/**
 * 화면 범위(3857) 건물군 — 단수구역 «건물» 모드에서 지도에 그리고 골라 합치기용.
 * 반환 geom은 4326 GeoJSON(외곽선 그대로, 여유 없음).
 */
export async function listWtlOutageBuildingsInView(
  params: { bbox?: number[]; polygons?: ZonePolygon[] } = {}
): Promise<{
  /** covered: 현재 단수 면에 거의 다(99% 이상) 들어 있는 건물군 */
  rows: { id: number; geom: unknown; covered: boolean }[];
  truncated?: boolean;
  error?: string;
}> {
  const b = (params.bbox ?? []).map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) return { rows: [], error: '지도 범위를 읽지 못했습니다.' };
  const info = await buildingGeomInfo();
  if (!info) return { rows: [], error: '건물군 레이어가 없습니다.' };
  const col = `"${info.col.replace(/"/g, '""')}"`;
  const bs = info.srid > 0 ? info.srid : 5181;
  const bGeom = info.srid > 0 ? `t.${col}` : `ST_SetSRID(t.${col}, 5181)`;
  const zoneJson = zoneGeoJsonFromPolygons(cleanPolygons(params.polygons));
  // 포함 여부는 클릭 판정(getWtlOutageBuildingAt)과 같은 기준: 건물군 면적의 99% 이상이 단수 면 안
  const coveredSql = zoneJson
    ? `COALESCE(ST_Area(ST_Intersection(ST_MakeValid(${bGeom}), z.g)) / NULLIF(ST_Area(${bGeom}), 0), 0) >= 0.99`
    : 'FALSE';
  const res = await db.execute(
    sql.raw(
      `WITH z AS (
         SELECT ${
           zoneJson
             ? `ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(zoneJson))}'), 4326), ${bs}))`
             : 'NULL::geometry'
         } AS g
       )
       SELECT t.ogc_fid AS id, ST_AsGeoJSON(ST_Transform(${bGeom}, 4326), 7)::json AS geom,
         ${coveredSql} AS covered
       FROM ${BUILDING_SCHEMA}.${BUILDING_TABLE} t, z
       WHERE t.${col} IS NOT NULL
         AND t.${col} && ST_Transform(ST_MakeEnvelope(${b[0]}, ${b[1]}, ${b[2]}, ${b[3]}, 3857), ${bs})
       LIMIT ${BUILDING_VIEW_LIMIT + 1}`
    )
  );
  const all = (res.rows ?? []) as { id?: unknown; geom?: unknown; covered?: unknown }[];
  const rows = all
    .slice(0, BUILDING_VIEW_LIMIT)
    .map((r) => ({ id: Number(r.id), geom: r.geom, covered: r.covered === true || r.covered === 't' }))
    .filter((r) => Number.isFinite(r.id) && r.geom);
  return { rows, truncated: all.length > BUILDING_VIEW_LIMIT };
}

/** 그리기·지우기 도형 꼭짓점 상한(자유곡선 포함) */
const ZONE_EDIT_SHAPE_MAX_PTS = 5000;

/**
 * 단수 면 그리기·지우기 — 그린 다각형(shape)을 단수 면에 합치거나(union) 빼고(difference),
 * 그 면 기준으로 수용가·도로명주소·필지를 다시 조회한다. 결과 면은 구멍을 포함할 수 있다.
 */
export async function editWtlOutageZone(params: {
  polygons?: ZonePolygon[];
  op?: 'union' | 'difference';
  /** 그린 다각형 바깥 고리(4326) */
  shape?: [number, number][];
  /**
   * difference일 때 이 관로(4326 선)의 1m 띠는 빼기 전 단수 면 안에 있던 만큼 되살림 —
   * 건물군을 뺄 때 그 옆을 지나는 단수 관로 띠까지 잘려 면이 끊기지 않게.
   */
  keepPipes?: [number, number][][];
  /** keepPipes 띠를 되살리지 않을 영역(4326 고리) — 뺀 건물군 면 안쪽 급수관까지 살아나 수용가가 남지 않게 */
  keepExclude?: [number, number][];
}): Promise<{
  polygons?: ZonePolygon[];
  rings?: [number, number][][];
  ring?: [number, number][];
  customers?: WtlOutageCustomerDto[];
  addresses?: WtlOutageAddressDto[];
  parcels?: WtlOutageParcelDto[];
  error?: string;
}> {
  const op = params.op === 'difference' ? 'difference' : 'union';
  const shape = cleanPolygons([[params.shape ?? []]])[0];
  if (!shape || shape[0]!.length < 4) return { error: '그린 도형이 너무 작습니다.' };
  if (shape[0]!.length > ZONE_EDIT_SHAPE_MAX_PTS) return { error: '그린 도형의 점이 너무 많습니다.' };
  const zonePolys = cleanPolygons(params.polygons);
  const zoneJson = zoneGeoJsonFromPolygons(zonePolys);
  if (!zoneJson && op === 'difference') return { error: '지울 단수 면이 없습니다.' };
  const shapeJson = esc(JSON.stringify({ type: 'Polygon', coordinates: shape }));
  const zoneSql = zoneJson
    ? `ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(zoneJson))}'), 4326))`
    : `ST_GeomFromText('POLYGON EMPTY', 4326)`;
  const shapeSql = `ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('${shapeJson}'), 4326))`;
  const keepLines = (params.keepPipes ?? [])
    .filter((l) => Array.isArray(l))
    .map((l) =>
      l
        .filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
        .map((c) => [Number(c[0]), Number(c[1])] as [number, number])
    )
    .filter((l) => l.length >= 2);
  const keepSql =
    op === 'difference' && keepLines.length > 0 && zoneJson
      ? `ST_Intersection(
           ST_Transform(ST_Buffer(ST_Transform(ST_GeomFromText('MULTILINESTRING(${keepLines
             .map((l) => `(${l.map((c) => `${c[0]} ${c[1]}`).join(',')})`)
             .join(',')})', 4326), 3857), ${PIPE_TRACE_BUFFER_M}, ${ANGULAR_BUFFER}), 4326),
           ${zoneSql}
         )`
      : null;
  const exclude = cleanPolygons([[params.keepExclude ?? []]])[0];
  const keepFinalSql =
    keepSql && exclude
      ? `ST_Difference(${keepSql}, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('${esc(
          JSON.stringify({ type: 'Polygon', coordinates: exclude })
        )}'), 4326)))`
      : keepSql;
  const diffSql = `ST_Difference(${zoneSql}, ${shapeSql})`;
  const opSql =
    op === 'union'
      ? `ST_UnaryUnion(ST_Collect(ARRAY[${zoneSql}, ${shapeSql}]))`
      : keepFinalSql
        ? `ST_UnaryUnion(ST_Collect(ARRAY[${diffSql}, ST_CollectionExtract(${keepFinalSql}, 3)]))`
        : diffSql;
  // 빼기 뒤 경계 부스러기(ZONE_MIN_PIECE_M2 미만 조각)는 버린다
  const res = await db.execute(
    sql.raw(
      op === 'union'
        ? `SELECT ST_AsGeoJSON(ST_CollectionExtract(${opSql}, 3))::json AS geom`
        : `WITH r AS (SELECT (ST_Dump(ST_CollectionExtract(${opSql}, 3))).geom AS g)
           SELECT ST_AsGeoJSON(ST_Collect(r.g))::json AS geom
           FROM r WHERE ST_Area(r.g::geography) >= ${ZONE_MIN_PIECE_M2}`
    )
  );
  const polygons = parsePolygons((res.rows?.[0] as { geom?: unknown } | undefined)?.geom);
  if (polygons.length === 0) {
    return { error: op === 'difference' ? '단수 면이 모두 지워져 반영하지 않았습니다.' : '면을 합치지 못했습니다.' };
  }
  const outJson = zoneGeoJsonFromPolygons(polygons);
  const [{ customers, addresses }, parcels] = await Promise.all([
    queryCustomersInZone(outJson),
    queryParcelsInZone(outJson),
  ]);
  const rings = polygons.map((p) => p[0]!);
  return { polygons, rings, ring: rings[0], customers, addresses, parcels };
}

/** 도형 수정 중 건물 클릭 허용 거리(m, 건물군 SRID) — 건물 바로 옆 클릭도 잡히게 */
const BUILDING_PICK_TOL_M = 2;

/**
 * 지도 클릭(3857) 위치의 건물군 면 — 도형 수정에서 단수 면에 합칠 때 사용.
 * 반환 ring은 분석과 같은 외곽 여유(BUILDING_MARGIN_M)·각진 버퍼를 둔 4326 고리.
 * covered: 그 건물군이 rings(현재 단수 면) 안에 들어 있는 비율(0~1).
 */
export async function getWtlOutageBuildingAt(params: {
  x?: number;
  y?: number;
  /** 건물군 ogc_fid — 있으면 클릭 위치 대신 이 건물군 */
  id?: number;
  /**
   * remove: 단수 면에서 뺄 도형 — 건물군 면 + 그 건물군에서 단수 관로(pipes)까지의 연결 띠(조금 넓게).
   * 기본(add): 건물군 면 + 현재 단수 면까지의 연결 띠
   */
  purpose?: 'add' | 'remove';
  /** remove일 때 연결 띠를 찾을 단수 관로(4326 선) */
  pipes?: [number, number][][];
  rings?: [number, number][][];
  /** 현재 단수 면(구멍 포함) — 있으면 rings 대신 포함 비율 계산에 사용 */
  polygons?: ZonePolygon[];
}): Promise<{
  ring?: [number, number][];
  /** 연결 띠를 뺀 건물군 면만(외곽 여유 포함) */
  face?: [number, number][];
  covered?: number;
  connected?: boolean;
  error?: string;
}> {
  const x = Number(params.x);
  const y = Number(params.y);
  const id = Number(params.id);
  const byId = Number.isInteger(id) && id > 0;
  if (!byId && (!Number.isFinite(x) || !Number.isFinite(y))) return { error: '클릭 위치를 읽지 못했습니다.' };
  const info = await buildingGeomInfo();
  if (!info) return { error: '건물군 레이어가 없습니다.' };
  const col = `"${info.col.replace(/"/g, '""')}"`;
  const bs = info.srid > 0 ? info.srid : 5181;
  const bGeom = info.srid > 0 ? `b.${col}` : `ST_SetSRID(b.${col}, 5181)`;
  const removePipes = (params.pipes ?? [])
    .filter((l) => Array.isArray(l))
    .map((l) =>
      l
        .filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
        .map((c) => [Number(c[0]), Number(c[1])] as [number, number])
    )
    .filter((l) => l.length >= 2);
  const removePipesWkt =
    removePipes.length > 0
      ? `MULTILINESTRING(${removePipes.map((l) => `(${l.map((c) => `${c[0]} ${c[1]}`).join(',')})`).join(',')})`
      : null;
  const polys = cleanPolygons(params.polygons);
  const zoneJson =
    polys.length > 0
      ? zoneGeoJsonFromPolygons(polys)
      : zoneGeoJsonFromRings((params.rings ?? []).filter((r) => Array.isArray(r) && r.length >= 3));
  const coveredSql = zoneJson
    ? `COALESCE(ST_Area(ST_Intersection(
         hit.g,
         ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(zoneJson))}'), 4326), ${bs}))
       )) / NULLIF(ST_Area(hit.g), 0), 0)`
    : '0';
  const res = await db.execute(
    sql.raw(
      `WITH ${
         byId
           ? `hit AS (
         SELECT ST_MakeValid(${bGeom}) AS g
         FROM ${BUILDING_SCHEMA}.${BUILDING_TABLE} b
         WHERE b.${col} IS NOT NULL AND b.ogc_fid = ${id}
         LIMIT 1
       )`
           : `p AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 3857), ${bs}) AS g),
       hit AS (
         SELECT ST_MakeValid(${bGeom}) AS g
         FROM ${BUILDING_SCHEMA}.${BUILDING_TABLE} b, p
         WHERE b.${col} IS NOT NULL AND ST_DWithin(${bGeom}, p.g, ${BUILDING_PICK_TOL_M})
         ORDER BY ST_Distance(${bGeom}, p.g)
         LIMIT 1
       )`
       }
,
       hb AS (SELECT ST_Buffer(ST_Transform(hit.g, 3857), ${BUILDING_MARGIN_M}, ${ANGULAR_BUFFER}) AS g FROM hit),
       zz AS (SELECT ${
         zoneJson
           ? `ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(zoneJson))}'), 4326), 3857))`
           : 'NULL::geometry'
       } AS g),
       ${
         params.purpose === 'remove'
           ? `pp AS (SELECT ${
               removePipesWkt
                 ? `ST_Transform(ST_GeomFromText('${removePipesWkt}', 4326), 3857)`
                 : 'NULL::geometry'
             } AS g),
       -- 뺄 도형: 건물군 면 + 단수 관로까지 연결 띠(분석 때 붙인 띠를 덮도록 조금 넓게)
       linked AS (
         SELECT CASE
             WHEN pp.g IS NULL OR ST_Intersects(hb.g, ST_Buffer(pp.g, ${PIPE_TRACE_BUFFER_M}))
               OR ST_Distance(hb.g, pp.g) > ${BUILDING_CONNECT_MAX_M} THEN hb.g
             ELSE ST_Union(hb.g, ST_Buffer(ST_ShortestLine(hb.g, pp.g), ${PIPE_TRACE_BUFFER_M + REMOVE_LINK_SLACK_M}, ${ANGULAR_BUFFER}))
           END AS g,
           FALSE AS connected
         FROM hb, pp
       )`
           : `-- 현재 단수 면과 떨어져 있으면 최단선 연결 띠(관로와 같은 폭)를 붙여 이어지게
       linked AS (`
       }${params.purpose === 'remove' ? '' : `
         SELECT CASE
             WHEN zz.g IS NULL OR ST_IsEmpty(zz.g) OR ST_Intersects(hb.g, zz.g)
               OR ST_Distance(hb.g, zz.g) > ${BUILDING_CONNECT_MAX_M} THEN hb.g
             ELSE ST_Union(hb.g, ST_Buffer(ST_ShortestLine(hb.g, zz.g), ${PIPE_TRACE_BUFFER_M}, ${ANGULAR_BUFFER}))
           END AS g,
           (zz.g IS NOT NULL AND NOT ST_IsEmpty(zz.g) AND NOT ST_Intersects(hb.g, zz.g)
             AND ST_Distance(hb.g, zz.g) <= ${BUILDING_CONNECT_MAX_M}) AS connected
         FROM hb, zz
       )`}
       SELECT
         ST_AsGeoJSON(ST_Transform(linked.g, 4326))::json AS geom,
         (SELECT ST_AsGeoJSON(ST_Transform(hb.g, 4326))::json FROM hb) AS face,
         linked.connected AS connected,
         ${coveredSql} AS covered
       FROM hit, linked`
    )
  );
  const row = res.rows?.[0] as { geom?: unknown; face?: unknown; covered?: unknown; connected?: unknown } | undefined;
  if (!row) return {};
  const ring = parseRings(row.geom)[0];
  const face = parseRings(row.face)[0];
  const connected = row.connected === true || row.connected === 't';
  return ring ? { ring, face, covered: Number(row.covered) || 0, connected } : {};
}

/** 단수구역도 PNG 최대 크기(디코딩 후) */
const HWPX_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 리 경계 테이블의 이름 컬럼(ri_nm 우선) */
async function riNameColumn(): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public_layer' AND table_name = 'ri'
         AND column_name IN ('ri_nm', 'li_kor_nm', 'li_nm', 'name')`
    )
  );
  const cols = new Set((res.rows ?? []).map((r) => String((r as { column_name?: unknown }).column_name)));
  return ['ri_nm', 'li_kor_nm', 'li_nm', 'name'].find((c) => cols.has(c)) ?? null;
}

/** 읍·면·동 경계 테이블의 이름 컬럼 */
async function emdNameColumn(): Promise<string | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public_layer' AND table_name = 'emd'
         AND column_name IN ('emd_kor_nm', 'emd_nm', 'adm_nm', 'name')`
    )
  );
  const cols = new Set((res.rows ?? []).map((r) => String((r as { column_name?: unknown }).column_name)));
  return ['emd_kor_nm', 'emd_nm', 'adm_nm', 'name'].find((c) => cols.has(c)) ?? null;
}

/**
 * 단수 면과 겹치는 리 이름(하위 호환·필지 라벨 실패 시 폴백)
 */
async function queryOutageAreaNames(rings: [number, number][][]): Promise<string[]> {
  const zoneJson = zoneGeoJsonFromRings(rings);
  if (!zoneJson || !(await tableExists('public_layer', 'ri'))) return [];
  const col = await riNameColumn();
  if (!col) return [];
  try {
    const res = await db.execute(
      sql.raw(
        `WITH zone AS (
           SELECT ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(zoneJson))}'), 4326) AS g
         )
         SELECT DISTINCT NULLIF(TRIM(r."${col}"::text), '') AS nm
         FROM public_layer.ri r, zone
         WHERE r.geom IS NOT NULL
           AND ST_Intersects(
             CASE WHEN ST_SRID(r.geom) = 0 THEN ST_SetSRID(r.geom, 5181) ELSE r.geom END,
             ST_Transform(zone.g, CASE WHEN ST_SRID(r.geom) = 0 THEN 5181 ELSE ST_SRID(r.geom) END)
           )
         ORDER BY 1`
      )
    );
    return (res.rows ?? [])
      .map((r) => asStr((r as { nm?: unknown }).nm))
      .filter(Boolean);
  } catch (e) {
    console.warn('[wtlOutage] queryOutageAreaNames', e);
    return [];
  }
}

type OutageAreaParcelLabel = { myeon: string; ri: string; bunji: string };

/** 한 단수 면(그룹)에서 면적이 가장 큰 필지 → 면·리·지번 */
async function queryLargestParcelLabelForZone(zoneJson: unknown): Promise<OutageAreaParcelLabel | null> {
  if (!zoneJson || !(await tableExists('public_layer', 'jijuk'))) return null;
  const jijukSrid = await getJijukSrid();
  const targetSrid = jijukSrid > 0 ? jijukSrid : 5181;
  const emdCol = (await tableExists('public_layer', 'emd')) ? await emdNameColumn() : null;
  const riCol = (await tableExists('public_layer', 'ri')) ? await riNameColumn() : null;
  const myeonSql = emdCol
    ? `(SELECT NULLIF(TRIM(e."${emdCol}"::text), '')
        FROM public_layer.emd e
        WHERE e.geom IS NOT NULL
          AND ST_Intersects(
            CASE WHEN ST_SRID(e.geom) = 0 THEN ST_SetSRID(e.geom, ${targetSrid}) ELSE e.geom END,
            ST_Transform(cand.pt, CASE WHEN ST_SRID(e.geom) = 0 THEN ${targetSrid} ELSE ST_SRID(e.geom) END)
          )
        LIMIT 1)`
    : `NULL`;
  const riSql = riCol
    ? `(SELECT NULLIF(TRIM(r."${riCol}"::text), '')
        FROM public_layer.ri r
        WHERE r.geom IS NOT NULL
          AND ST_Intersects(
            CASE WHEN ST_SRID(r.geom) = 0 THEN ST_SetSRID(r.geom, ${targetSrid}) ELSE r.geom END,
            ST_Transform(cand.pt, CASE WHEN ST_SRID(r.geom) = 0 THEN ${targetSrid} ELSE ST_SRID(r.geom) END)
          )
        LIMIT 1)`
    : `NULL`;
  try {
    const res = await db.execute(
      sql.raw(
        `WITH zone AS (
           SELECT ST_Transform(
             ST_SetSRID(ST_GeomFromGeoJSON('${esc(JSON.stringify(zoneJson))}'), 4326),
             ${targetSrid}
           ) AS g
         ),
         cand AS (
           SELECT
             ST_Centroid(
               CASE WHEN ST_SRID(j.geom) = 0 THEN ST_SetSRID(j.geom, ${targetSrid}) ELSE j.geom END
             ) AS pt,
             COALESCE(
               NULLIF(TRIM(SUBSTRING(j.jibun::text FROM '(산?[0-9]+(?:-[0-9]+)?)')), ''),
               NULLIF(TRIM(regexp_replace(j.jibun::text, '[[:space:]]*[가-힣]+$', '')), ''),
               NULLIF(TRIM(j.jibun::text), '')
             ) AS bunji,
             ST_Area(
               CASE
                 WHEN ST_SRID(j.geom) = 0 THEN ST_SetSRID(j.geom, 5181)
                 WHEN ST_SRID(j.geom) = 5181 THEN j.geom
                 ELSE ST_Transform(j.geom, 5181)
               END
             ) AS area_sqm
           FROM public_layer.jijuk j, zone
           WHERE j.geom IS NOT NULL
             AND ST_Intersects(
               CASE WHEN ST_SRID(j.geom) = 0 THEN ST_SetSRID(j.geom, ${targetSrid}) ELSE j.geom END,
               zone.g
             )
           ORDER BY area_sqm DESC NULLS LAST
           LIMIT 1
         )
         SELECT
           COALESCE(${myeonSql}, '') AS myeon,
           COALESCE(${riSql}, '') AS ri,
           COALESCE(cand.bunji, '') AS bunji
         FROM cand`
      )
    );
    const row = res.rows?.[0] as { myeon?: unknown; ri?: unknown; bunji?: unknown } | undefined;
    if (!row) return null;
    const myeon = asStr(row.myeon);
    const ri = asStr(row.ri);
    const bunji = asStr(row.bunji);
    if (!myeon && !ri && !bunji) return null;
    return { myeon, ri, bunji };
  } catch (e) {
    console.warn('[wtlOutage] queryLargestParcelLabelForZone', e);
    return null;
  }
}

/** 구역별 «면 리 지번 일대» — 같은 면이면 면 이름 생략, 동일 지번 중복 제거 */
function formatOutageAreaLabels(parts: OutageAreaParcelLabel[]): string {
  let prevMyeon = '';
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const key = `${p.myeon}\0${p.ri}\0${p.bunji}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const omitMyeon = Boolean(p.myeon) && p.myeon === prevMyeon;
    const bits = [omitMyeon ? '' : p.myeon, p.ri, p.bunji].filter(Boolean);
    if (bits.length === 0) continue;
    labels.push(`${bits.join(' ')} 일대`);
    if (p.myeon) prevMyeon = p.myeon;
  }
  return labels.join(', ');
}

/**
 * 알림문용으로 합친 면마다 가장 큰 필지 지번으로 대상지역 문구 생성.
 * polygons가 이미 clusterWtlOutageHwpxPolygons 결과면 그대로 쓰고, 아니면 여기서 합친다.
 * 필지 없으면 리 이름 폴백. 지도 표시면은 바꾸지 않음.
 */
async function queryOutageAreaLabels(polygons: ZonePolygon[], ringsFallback: [number, number][][]): Promise<string> {
  const raw =
    polygons.length > 0
      ? polygons
      : ringsFallback.map((r) => [r] as ZonePolygon).filter((p) => (p[0]?.length ?? 0) >= 3);
  const polys = await clusterPolygonsForHwpx(raw);
  const parts: OutageAreaParcelLabel[] = [];
  for (const poly of polys) {
    const zoneJson = zoneGeoJsonFromPolygons([poly]);
    if (!zoneJson) continue;
    const label = await queryLargestParcelLabelForZone(zoneJson);
    if (label) parts.push(label);
  }
  const formatted = formatOutageAreaLabels(parts);
  if (formatted) return formatted;
  const names = await queryOutageAreaNames(
    raw.map((p) => p[0]!).filter((r) => r && r.length >= 3)
  );
  return names.join(',');
}

/**
 * 단수 알림문 한글(HWPX) — v6 stopWater «한글 다운로드»와 같은 양식.
 * 제목·사유·단수일시·대상지역(구역별 최대 필지 지번 일대)·단수구역도(지도 캡처 PNG).
 */
export async function exportWtlOutageHwpx(params: {
  title?: string;
  reason?: string;
  startAt?: string;
  endAt?: string;
  ring?: [number, number][];
  rings?: [number, number][][];
  /** 단수 면(구멍 포함). 있으면 구역별 대상지역에 사용 */
  polygons?: ZonePolygon[];
  /** data URL 또는 순수 base64 PNG */
  imageBase64?: string;
}): Promise<{ fileName?: string; base64?: string; areas?: string; error?: string }> {
  const title = asStr(params.title);
  const reason = asStr(params.reason);
  const startAt = asStr(params.startAt);
  const endAt = asStr(params.endAt);
  if (!title) return { error: '알림 제목을 입력해주세요.' };
  if (!reason) return { error: '단수 사유를 입력해주세요.' };
  if (!startAt) return { error: '시작일을 입력해주세요.' };
  if (!endAt) return { error: '종료일을 입력해주세요.' };
  if (endAt.replace('T', ' ') < startAt.replace('T', ' ')) {
    return { error: '종료일은 시작일 이후로 입력해주세요.' };
  }

  const cleanRing = (ring: unknown): [number, number][] =>
    Array.isArray(ring)
      ? (ring as unknown[])
          .filter((c): c is [number, number] => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
          .map((c) => [Number(c[0]), Number(c[1])] as [number, number])
      : [];
  const rings = (params.rings && params.rings.length > 0 ? params.rings : [params.ring ?? []])
    .map(cleanRing)
    .filter((r) => r.length >= 3);
  const polygons = cleanPolygons(params.polygons);
  if (rings.length === 0 && polygons.length === 0) {
    return { error: '단수 구역이 없습니다. 먼저 분석해 주세요.' };
  }

  let image: Buffer | null = null;
  const raw = asStr(params.imageBase64).replace(/^data:image\/png;base64,/, '');
  if (raw) {
    image = Buffer.from(raw, 'base64');
    if (image.length > HWPX_IMAGE_MAX_BYTES) return { error: '단수구역도 이미지가 너무 큽니다.' };
    if (!image.subarray(0, 8).equals(PNG_SIGNATURE)) return { error: '단수구역도 이미지 형식이 올바르지 않습니다.' };
  }

  const areas = await queryOutageAreaLabels(polygons, rings);
  try {
    const bytes = await buildStopWaterHwpx({ title, reason, startAt, endAt, areas, image });
    return { fileName: stopWaterHwpxFileName(), base64: bytes.toString('base64'), areas };
  } catch (e) {
    console.error('[wtlOutage] exportWtlOutageHwpx', e);
    return { error: '한글 파일 생성에 실패했습니다.' };
  }
}

/** 선택 필지 강조 — 지적(jijuk) 기본 스타일 대비 외곽선 굵기(px) */
const OUTAGE_PARCEL_STROKE_WIDTH = 3;

/**
 * 단수구역 선택 필지용 지적 SLD — GeoServer jijuk 스타일을 기반으로
 * - 외곽선을 굵게(OUTAGE_PARCEL_STROKE_WIDTH)
 * - 지번 라벨은 글자 #000, halo #fff(불투명, 반경 2)
 * WMS SLD_BODY로 쓰므로 NamedLayer 이름을 레이어명(jijuk)으로 맞춘다(다르면 기본 스타일로 그림).
 * 스타일 파일을 못 읽으면 null → 화면은 원래 jijuk 스타일 유지.
 */
export async function loadWtlOutageParcelSld(): Promise<{ sld: string | null }> {
  try {
    const file = path.join(process.cwd(), 'geoserver_modules', 'data_dir', 'styles', 'jijuk.sld');
    let sld = await fs.readFile(file, 'utf8');
    sld = sld.replace(/(<(?:sld:)?NamedLayer>\s*<(?:sld:)?Name>)[^<]*(<\/(?:sld:)?Name>)/, '$1jijuk$2');
    // 면 외곽선 — 기존 stroke-width는 지우고 새 굵기를 넣는다
    sld = sld.replace(
      /<((?:sld:)?)PolygonSymbolizer>([\s\S]*?)<\/(?:sld:)?PolygonSymbolizer>/g,
      (_m: string, ns: string, body: string) => {
        const nextBody = body
          .replace(/\s*<(?:sld:)?CssParameter name="stroke-width">[^<]*<\/(?:sld:)?CssParameter>/g, '')
          .replace(
            /(<(?:sld:)?Stroke>)/,
            `$1<${ns}CssParameter name="stroke-width">${OUTAGE_PARCEL_STROKE_WIDTH}</${ns}CssParameter>`
          );
        return `<${ns}PolygonSymbolizer>${nextBody}</${ns}PolygonSymbolizer>`;
      }
    );
    // 지번 라벨 — halo #fff(불투명·반경 2), 글자 #000
    sld = sld.replace(
      /<((?:sld:)?)TextSymbolizer>([\s\S]*?)<\/(?:sld:)?TextSymbolizer>/g,
      (_m: string, ns: string, body: string) => {
        let nextBody = body.replace(
          /<(?:sld:)?Halo>[\s\S]*?<\/(?:sld:)?Halo>/,
          `<${ns}Halo><${ns}Radius>2</${ns}Radius><${ns}Fill>` +
            `<${ns}CssParameter name="fill">#FFFFFF</${ns}CssParameter>` +
            `<${ns}CssParameter name="fill-opacity">1</${ns}CssParameter>` +
            `</${ns}Fill></${ns}Halo>`
        );
        // 글자 Fill — jijuk.sld는 Halo 바로 뒤에 온다. Halo가 없으면 첫 Fill
        const afterHalo = /(<\/(?:sld:)?Halo>\s*<(?:sld:)?Fill>\s*<(?:sld:)?CssParameter name="fill">)[^<]*/;
        nextBody = afterHalo.test(nextBody)
          ? nextBody.replace(afterHalo, '$1#000000')
          : nextBody.replace(/(<(?:sld:)?Fill>\s*<(?:sld:)?CssParameter name="fill">)[^<]*/, '$1#000000');
        return `<${ns}TextSymbolizer>${nextBody}</${ns}TextSymbolizer>`;
      }
    );
    return { sld };
  } catch {
    return { sld: null };
  }
}
