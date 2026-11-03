/**
 * 도로영상 위치 맞춤 — 화면용 조회와 분석 요청(슈퍼 계정만).
 * 분석 실행은 @/integrations/roadVideoTrackScheduler (요청된 영상만, API로 노출하지 않음).
 */
import { pool } from '@/database/db';
import { getSessionUsrId } from '@/lib/auth/guard';
import { isSuperUser } from '@/lib/auth/superUser';
import {
  ensureRoadVideoTrackTables,
  loadRoadVideoRoute,
  roadVideoTrackTablesExist,
  statRoadVideoFile,
  ROAD_VIDEO_ANALYZER_VERSION,
  ROAD_VIDEO_LAYER_ID,
  type RoadVideoCoord,
} from '@/lib/roadVideoTrack';

export type RoadVideoTrackDto = {
  /** done=자동 맞춤 완료, failed=분석 실패, none=분석 전 */
  status: 'done' | 'failed' | 'none';
  /** 분석 요청이 걸려 있어 스케줄러가 곧 (다시) 분석함 */
  queued?: boolean;
  /** forward=노선 시작→끝, reverse=끝→시작. 분석 전이면 없음 */
  direction?: 'forward' | 'reverse';
  durationSec?: number;
  routeLengthM: number;
  /** 경위도 노선 — anchors 의 노선 거리 기준선 */
  line: RoadVideoCoord[];
  /** [영상 초, 노선 시작 기준 m] */
  anchors: RoadVideoCoord[];
  /** anchors 와 같은 순서 — 영상 속 차 정면(도, 영상 가운데 0·오른쪽 +). 이전 분석이면 없음 */
  fronts?: number[];
  loops: RoadVideoCoord[];
  message?: string;
  analyzedAt?: string;
};

export async function getRoadVideoTrack(params: {
  roadKey?: string | number;
  fileName?: string;
}): Promise<{ track: RoadVideoTrackDto | null; error?: string }> {
  const roadKey = String(params?.roadKey ?? '').trim();
  const fileName = String(params?.fileName ?? '').trim();
  if (!roadKey || !fileName) return { track: null, error: '노선 키와 파일명이 필요합니다.' };

  try {
    let queued = false;
    if (await roadVideoTrackTablesExist()) {
      // front_deg·requested_at 은 나중에 붙은 칸 — 아직 없는 DB 에서도 읽히게 jsonb 로 꺼냄
      const r = await pool.query<{
        id: number;
        status: string;
        message: string | null;
        direction: string | null;
        duration_sec: number | null;
        route_length_m: number | null;
        loops: RoadVideoCoord[] | null;
        analyzed_at: Date | null;
        requested_at: string | null;
        line: string | null;
      }>(
        `SELECT t.id, t.status, t.message, t.direction, t.duration_sec, t.route_length_m, t.loops, t.analyzed_at,
                to_jsonb(t) ->> 'requested_at' AS requested_at,
                ST_AsGeoJSON(ST_Transform(t.geom, 4326)) AS line
           FROM layer.road_video_track t
          WHERE t.layer_id = $1 AND t.road_key = $2 AND t.file_name = $3
          LIMIT 1`,
        [ROAD_VIDEO_LAYER_ID, roadKey, fileName]
      );
      const row = r.rows[0];
      queued = Boolean(row?.requested_at);
      if (row?.status === 'done' && row.line) {
        const a = await pool.query<{ time_sec: number; route_m: number; front_deg: number | null }>(
          `SELECT time_sec, route_m, (to_jsonb(a) ->> 'front_deg')::float8 AS front_deg
             FROM layer.road_video_anchor a WHERE track_id = $1 ORDER BY time_sec`,
          [row.id]
        );
        const line = (JSON.parse(row.line) as { coordinates?: RoadVideoCoord[] }).coordinates ?? [];
        if (line.length >= 2 && a.rows.length >= 2) {
          return {
            track: {
              status: 'done',
              queued,
              direction: row.direction === 'reverse' ? 'reverse' : 'forward',
              durationSec: row.duration_sec ?? undefined,
              routeLengthM: Number(row.route_length_m ?? 0),
              line,
              anchors: a.rows.map((x) => [Number(x.time_sec), Number(x.route_m)]),
              fronts: a.rows.some((x) => x.front_deg != null)
                ? a.rows.map((x) => (x.front_deg == null ? 0 : Number(x.front_deg)))
                : undefined,
              loops: Array.isArray(row.loops) ? row.loops : [],
              analyzedAt: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : undefined,
            },
          };
        }
      }
      if (row?.status === 'failed') {
        const route = await loadRoadVideoRoute(roadKey);
        return {
          track: route
            ? {
                status: 'failed',
                queued,
                routeLengthM: route.lengthM,
                line: route.lineLonLat,
                anchors: [],
                loops: [],
                message: row.message ?? undefined,
                analyzedAt: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : undefined,
              }
            : null,
        };
      }
    }

    const route = await loadRoadVideoRoute(roadKey);
    if (!route) return { track: null, error: '노선 선형이 없습니다.' };
    return {
      track: {
        status: 'none',
        queued,
        routeLengthM: route.lengthM,
        line: route.lineLonLat,
        anchors: [],
        loops: [],
      },
    };
  } catch (e) {
    return { track: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 슈퍼 계정(su·admin)이 도로영상을 열 때 — 분석 결과가 없거나, 파일이 바뀌었거나, 분석 방식이 예전 판이면
 * 분석 요청을 남긴다. 다른 계정은 아무것도 하지 않는다. 이전 결과는 다시 분석이 끝날 때까지 그대로 보인다.
 */
export async function requestRoadVideoTrack(params: {
  roadKey?: string | number;
  fileName?: string;
}): Promise<{ queued: boolean; reason?: 'not-super' | 'up-to-date' | 'no-file' }> {
  const usrId = await getSessionUsrId();
  if (!isSuperUser(usrId)) return { queued: false, reason: 'not-super' };
  const file = await statRoadVideoFile(String(params?.roadKey ?? ''), String(params?.fileName ?? ''));
  if (!file) return { queued: false, reason: 'no-file' };

  await ensureRoadVideoTrackTables();
  const r = await pool.query<{
    status: string;
    file_size: string | null;
    file_mtime: Date | null;
    analyzer_ver: number | null;
    requested_at: Date | null;
  }>(
    `SELECT status, file_size, file_mtime, analyzer_ver, requested_at
       FROM layer.road_video_track WHERE layer_id = $1 AND road_key = $2 AND file_name = $3`,
    [ROAD_VIDEO_LAYER_ID, file.roadKey, file.fileName]
  );
  const row = r.rows[0];
  if (row?.requested_at) return { queued: true };
  const sameFile =
    row != null &&
    Number(row.file_size ?? -1) === file.size &&
    (row.file_mtime ? new Date(row.file_mtime).getTime() : -1) === file.mtimeMs;
  const current = (row?.analyzer_ver ?? 0) >= ROAD_VIDEO_ANALYZER_VERSION;
  if (row && row.status === 'done' && sameFile && current) return { queued: false, reason: 'up-to-date' };

  await pool.query(
    `INSERT INTO layer.road_video_track (layer_id, road_key, file_name, status, requested_at, requested_by)
     VALUES ($1, $2, $3, 'queued', now(), $4)
     ON CONFLICT (layer_id, road_key, file_name) DO UPDATE SET requested_at = now(), requested_by = EXCLUDED.requested_by`,
    [ROAD_VIDEO_LAYER_ID, file.roadKey, file.fileName, usrId]
  );
  return { queued: true };
}
