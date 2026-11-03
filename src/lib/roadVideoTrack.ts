/**
 * 도로영상 위치 맞춤 — 서버 공용 (테이블 확보, 노선 선형·교차시설 읽기).
 * 첨부: file_data/{ROAD_VIDEO_LAYER_ID}/{rdid 또는 ogc_fid}/*.mp4
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '@/database/db';
import {
  assertSafeFileDataSegment,
  assertSafeServiceFileBasename,
  shouldHideServiceFileDataFileName,
} from '@/lib/serviceFileData';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';

export const ROAD_VIDEO_LAYER_ID = 'a0020000';
/** 교차시설(면) — 교차로 한 바퀴 회전을 허용하는 노선 구간 */
const ROAD_VIDEO_CROSSING_LAYER_ID = 'a0080000';
export const ROAD_VIDEO_EXT_RE = /\.(mp4|mov|webm)$/i;
export const ROAD_VIDEO_SRID = 5181;
/** python/pipeline/road_video_track.py ANALYZER_VERSION 과 같게. 올리면 이전 결과는 다시 분석 */
export const ROAD_VIDEO_ANALYZER_VERSION = 2;

export type RoadVideoCoord = [number, number];

export type RoadVideoFile = { roadKey: string; fileName: string; abs: string; size: number; mtimeMs: number };

/** 첨부 폴더의 도로영상 1건 — 경로 검증 후 크기·수정시각. 없거나 영상이 아니면 null */
export async function statRoadVideoFile(roadKey: string, fileName: string): Promise<RoadVideoFile | null> {
  const key = assertSafeFileDataSegment(String(roadKey ?? ''));
  const name = assertSafeServiceFileBasename(String(fileName ?? ''));
  if (!key || !name || !ROAD_VIDEO_EXT_RE.test(name) || shouldHideServiceFileDataFileName(name)) return null;
  const abs = path.join(resolveGgnrDataDir(), 'file_data', ROAD_VIDEO_LAYER_ID, key, name);
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return null;
    return { roadKey: key, fileName: name, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
  } catch {
    return null;
  }
}

const ROAD_VIDEO_TRACK_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_video_track (
  id serial PRIMARY KEY,
  layer_id text NOT NULL,
  road_key text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  file_mtime timestamptz,
  status text NOT NULL,
  message text,
  direction text,
  duration_sec double precision,
  route_length_m double precision,
  fit_cost double precision,
  loops jsonb,
  elapsed_sec double precision,
  analyzer_ver integer,
  analyzed_at timestamptz DEFAULT now(),
  geom geometry(LineString, ${ROAD_VIDEO_SRID}),
  CONSTRAINT road_video_track_file_key UNIQUE (layer_id, road_key, file_name)
);
COMMENT ON TABLE layer.road_video_track IS '도로영상 위치맞춤 영상정보';
COMMENT ON COLUMN layer.road_video_track.road_key IS '노선 키(rdid, 없으면 ogc_fid)';
COMMENT ON COLUMN layer.road_video_track.status IS '분석 결과(done·failed)';
COMMENT ON COLUMN layer.road_video_track.direction IS '진행 방향(forward=노선 시작→끝, reverse=끝→시작)';
ALTER TABLE layer.road_video_track ADD COLUMN IF NOT EXISTS analyzer_ver integer;
ALTER TABLE layer.road_video_track ADD COLUMN IF NOT EXISTS requested_at timestamptz;
ALTER TABLE layer.road_video_track ADD COLUMN IF NOT EXISTS requested_by text;
COMMENT ON COLUMN layer.road_video_track.requested_at IS '분석 요청 일시(슈퍼 계정이 영상을 열 때). 값이 있으면 스케줄러가 분석';
COMMENT ON COLUMN layer.road_video_track.requested_by IS '분석 요청 계정';
COMMENT ON COLUMN layer.road_video_track.geom IS '분석에 쓴 노선 선형';
COMMENT ON COLUMN layer.road_video_track.analyzer_ver IS '분석 방식 버전(낮으면 다시 분석)';

CREATE TABLE IF NOT EXISTS layer.road_video_anchor (
  id serial PRIMARY KEY,
  track_id integer NOT NULL REFERENCES layer.road_video_track (id) ON DELETE CASCADE,
  time_sec double precision NOT NULL,
  route_m double precision NOT NULL,
  front_deg double precision,
  kind text NOT NULL DEFAULT 'auto'
);
ALTER TABLE layer.road_video_anchor ADD COLUMN IF NOT EXISTS front_deg double precision;
COMMENT ON COLUMN layer.road_video_anchor.front_deg IS '영상 속 차 정면 방향(도, 영상 가운데 0·오른쪽 +)';
CREATE INDEX IF NOT EXISTS road_video_anchor_track_time_idx
  ON layer.road_video_anchor (track_id, time_sec);
COMMENT ON TABLE layer.road_video_anchor IS '도로영상 위치맞춤 시각별 노선위치';
COMMENT ON COLUMN layer.road_video_anchor.route_m IS '노선 시작 기준 거리(m, track.geom 기준)';
COMMENT ON COLUMN layer.road_video_anchor.kind IS '구분(auto=자동, manual=수동 보정)';
`;

let ensurePromise: Promise<void> | null = null;

/** 분석 작업이 처음 돌 때만 만든다 (도로영상이 없는 사업에는 생기지 않음) */
export function ensureRoadVideoTrackTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = pool
      .query(ROAD_VIDEO_TRACK_SQL)
      .then(() => undefined)
      .catch((e) => {
        ensurePromise = null;
        throw e;
      });
  }
  return ensurePromise;
}

export async function roadVideoTrackTablesExist(): Promise<boolean> {
  const r = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass('layer.road_video_track') IS NOT NULL
        AND to_regclass('layer.road_video_anchor') IS NOT NULL AS ok`
  );
  return Boolean(r.rows[0]?.ok);
}

function geoJsonParts(raw: string | null | undefined): RoadVideoCoord[][] {
  if (!raw) return [];
  const g = JSON.parse(raw) as { type?: string; coordinates?: unknown };
  const toLine = (c: unknown): RoadVideoCoord[] =>
    Array.isArray(c)
      ? c
          .map((p) => (Array.isArray(p) ? ([Number(p[0]), Number(p[1])] as RoadVideoCoord) : null))
          .filter((p): p is RoadVideoCoord => p != null && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      : [];
  if (g.type === 'LineString') return [toLine(g.coordinates)].filter((l) => l.length >= 2);
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    return g.coordinates.map(toLine).filter((l) => l.length >= 2);
  }
  return [];
}

function lineLength(line: RoadVideoCoord[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i += 1) {
    s += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  }
  return s;
}

/** 가장 긴 조각에서 시작해 양 끝에 가장 가까운 조각을 차례로 붙인다 */
function chainOrder(parts: RoadVideoCoord[][]): Array<{ index: number; reversed: boolean }> {
  if (parts.length === 0) return [];
  const used = new Set<number>();
  let first = 0;
  for (let i = 1; i < parts.length; i += 1) {
    if (lineLength(parts[i]!) > lineLength(parts[first]!)) first = i;
  }
  used.add(first);
  const order: Array<{ index: number; reversed: boolean }> = [{ index: first, reversed: false }];
  const dist = (a: RoadVideoCoord, b: RoadVideoCoord) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const endOf = (o: { index: number; reversed: boolean }, atStart: boolean): RoadVideoCoord => {
    const p = parts[o.index]!;
    const head = o.reversed ? p[p.length - 1]! : p[0]!;
    const tail = o.reversed ? p[0]! : p[p.length - 1]!;
    return atStart ? head : tail;
  };
  while (used.size < parts.length) {
    const head = endOf(order[0]!, true);
    const tail = endOf(order[order.length - 1]!, false);
    let best: { index: number; atTail: boolean; reversed: boolean; d: number } | null = null;
    for (let i = 0; i < parts.length; i += 1) {
      if (used.has(i)) continue;
      const p = parts[i]!;
      const a = p[0]!;
      const b = p[p.length - 1]!;
      const options = [
        { atTail: true, reversed: false, d: dist(tail, a) },
        { atTail: true, reversed: true, d: dist(tail, b) },
        { atTail: false, reversed: false, d: dist(head, b) },
        { atTail: false, reversed: true, d: dist(head, a) },
      ];
      for (const o of options) {
        if (!best || o.d < best.d) best = { index: i, ...o };
      }
    }
    if (!best) break;
    used.add(best.index);
    const item = { index: best.index, reversed: best.reversed };
    if (best.atTail) order.push(item);
    else order.unshift(item);
  }
  return order;
}

function applyOrder(parts: RoadVideoCoord[][], order: Array<{ index: number; reversed: boolean }>) {
  const out: RoadVideoCoord[] = [];
  for (const o of order) {
    const p = parts[o.index];
    if (!p) continue;
    const seq = o.reversed ? [...p].reverse() : p;
    for (const c of seq) {
      const last = out[out.length - 1];
      if (last && last[0] === c[0] && last[1] === c[1]) continue;
      out.push(c);
    }
  }
  return out;
}

/** 도로대장 노선 선형 — 미터 좌표(5181)와 경위도(4326)를 같은 순서로 이어 붙인 한 줄 */
export async function loadRoadVideoRoute(
  roadKey: string
): Promise<{ line: RoadVideoCoord[]; lineLonLat: RoadVideoCoord[]; lengthM: number } | null> {
  const key = String(roadKey ?? '').trim();
  if (!key) return null;
  const r = await pool.query<{ g: string | null; ll: string | null }>(
    `SELECT ST_AsGeoJSON(ST_Transform(ST_LineMerge(geom), ${ROAD_VIDEO_SRID})) AS g,
            ST_AsGeoJSON(ST_Transform(ST_LineMerge(geom), 4326)) AS ll
       FROM layer.${ROAD_VIDEO_LAYER_ID}
      WHERE rdid = $1 OR ogc_fid::text = $1
      ORDER BY (rdid = $1) DESC
      LIMIT 1`,
    [key]
  );
  const row = r.rows[0];
  const parts = geoJsonParts(row?.g);
  const partsLonLat = geoJsonParts(row?.ll);
  if (parts.length === 0 || parts.length !== partsLonLat.length) return null;
  const order = chainOrder(parts);
  const line = applyOrder(parts, order);
  const lineLonLat = applyOrder(partsLonLat, order);
  if (line.length < 2) return null;
  return { line, lineLonLat, lengthM: lineLength(line) };
}

/** 노선과 겹치는 교차시설 면의 바깥 고리(5181) */
export async function loadRoadVideoCrossingZones(line: RoadVideoCoord[]): Promise<RoadVideoCoord[][]> {
  const exists = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass('layer.${ROAD_VIDEO_CROSSING_LAYER_ID}') IS NOT NULL AS ok`
  );
  if (!exists.rows[0]?.ok) return [];
  const lineJson = JSON.stringify({ type: 'LineString', coordinates: line });
  const r = await pool.query<{ ring: string | null }>(
    `WITH a AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), ${ROAD_VIDEO_SRID}) AS g),
          s AS (SELECT ST_SRID(geom) AS srid FROM layer.${ROAD_VIDEO_CROSSING_LAYER_ID} WHERE geom IS NOT NULL LIMIT 1)
     SELECT ST_AsGeoJSON(ST_ExteriorRing(d.geom)) AS ring
       FROM layer.${ROAD_VIDEO_CROSSING_LAYER_ID} x, a, s,
            LATERAL (SELECT (ST_Dump(ST_Transform(x.geom, ${ROAD_VIDEO_SRID}))).geom) d
      WHERE ST_Intersects(x.geom, ST_Transform(a.g, s.srid))
        AND GeometryType(d.geom) = 'POLYGON'`,
    [lineJson]
  );
  return r.rows.flatMap((row) => geoJsonParts(row.ring));
}
