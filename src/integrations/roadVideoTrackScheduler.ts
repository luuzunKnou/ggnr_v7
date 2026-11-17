import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pool } from '@/database/db';
import { intervalSlotKey } from '@/integrations/integrationSchedule';
import { pipelinePythonSpawnEnv, resolvePipelinePythonBin } from '@/lib/pipelinePython';
import {
  ensureRoadVideoTrackTables,
  loadRoadVideoCrossingZones,
  loadRoadVideoRoute,
  roadVideoTrackTablesExist,
  statRoadVideoFile,
  ROAD_VIDEO_ANALYZER_VERSION,
  ROAD_VIDEO_LAYER_ID,
  ROAD_VIDEO_SRID,
  type RoadVideoFile,
} from '@/lib/roadVideoTrack';

const LOG = '[road-video-track]';
const SCHEDULE = { mode: 'interval' as const, minutes: 1 };
const ANALYZE_TIMEOUT_MS = 90 * 60 * 1000;
/** 올리는 중인 파일 제외 — 마지막 수정 후 이만큼 지나야 분석 */
const UPLOAD_SETTLE_MS = 2 * 60 * 1000;

type AnalyzeOutput =
  | {
      ok: true;
      direction: 'forward' | 'reverse';
      durationSec: number;
      routeLengthM: number;
      cost: number;
      analyzerVersion?: number;
      /** [초, 노선 m, 영상 속 차 정면(도)] */
      anchors: [number, number, number?][];
      loops: [number, number][];
      elapsedSec?: number;
    }
  | { ok: false; error: string };

/** python/env 에 분석 도구가 없을 때 — 파일을 실패로 남기지 않고 이번 기동 동안 멈춘다 */
class AnalyzerUnavailableError extends Error {}

/** 분석 요청이 걸린 영상(요청 순) 중 파일이 있고 올리기가 끝난 첫 번째. 파일이 없어진 요청은 실패로 정리 */
async function findRequestedVideo(skip: Set<string>): Promise<RoadVideoFile | null> {
  const r = await pool.query<{ road_key: string; file_name: string }>(
    `SELECT road_key, file_name FROM layer.road_video_track
      WHERE layer_id = $1 AND requested_at IS NOT NULL
      ORDER BY requested_at`,
    [ROAD_VIDEO_LAYER_ID]
  );
  const settledBefore = Date.now() - UPLOAD_SETTLE_MS;
  for (const row of r.rows) {
    if (skip.has(`${row.road_key}\u0000${row.file_name}`)) continue;
    const file = await statRoadVideoFile(row.road_key, row.file_name);
    if (!file) {
      await pool.query(
        `UPDATE layer.road_video_track SET status = 'failed', message = '영상 파일이 없습니다.', requested_at = NULL,
                analyzed_at = now()
          WHERE layer_id = $1 AND road_key = $2 AND file_name = $3`,
        [ROAD_VIDEO_LAYER_ID, row.road_key, row.file_name]
      );
      continue;
    }
    if (file.mtimeMs < settledBefore) return file;
  }
  return null;
}

function runAnalyzer(inputPath: string, outputPath: string, label: string): Promise<AnalyzeOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolvePipelinePythonBin(),
      ['-m', 'pipeline.road_video_track', '--input', inputPath, '--output', outputPath],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: pipelinePythonSpawnEnv() }
    );
    let stderr = '';
    let lastLogged = -1;
    child.stdout?.on('data', (d: Buffer) => {
      for (const m of d.toString('utf8').matchAll(/PROGRESS:(\d+)/g)) {
        const pct = Number(m[1]);
        if (pct >= lastLogged + 25 && pct < 100) {
          lastLogged = pct;
          console.info(`${LOG} ${label} ${pct}%`);
        }
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-4000);
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), ANALYZE_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new AnalyzerUnavailableError(`Python 실행 실패: ${err.message}`));
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (/No module named ['"]?(cv2|numpy|pipeline)/.test(stderr)) {
        reject(new AnalyzerUnavailableError(stderr.trim().split(/\r?\n/).pop() ?? 'Python 모듈 없음'));
        return;
      }
      try {
        resolve(JSON.parse(await fs.readFile(outputPath, 'utf8')) as AnalyzeOutput);
      } catch {
        const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' ');
        resolve({ ok: false, error: code === null ? '분석 시간 초과' : tail || `분석 종료 코드 ${code}` });
      }
    });
  });
}

async function saveFailed(file: RoadVideoFile, message: string, startedAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO layer.road_video_track
       (layer_id, road_key, file_name, file_size, file_mtime, status, message, analyzer_ver, analyzed_at)
     VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7, now())
     ON CONFLICT (layer_id, road_key, file_name) DO UPDATE SET
       file_size = EXCLUDED.file_size, file_mtime = EXCLUDED.file_mtime, status = 'failed',
       message = EXCLUDED.message, direction = NULL, duration_sec = NULL, route_length_m = NULL,
       fit_cost = NULL, loops = NULL, elapsed_sec = NULL, geom = NULL,
       analyzer_ver = EXCLUDED.analyzer_ver, analyzed_at = now(),
       requested_at = CASE WHEN layer.road_video_track.requested_at > $8 THEN layer.road_video_track.requested_at END`,
    [
      ROAD_VIDEO_LAYER_ID,
      file.roadKey,
      file.fileName,
      file.size,
      new Date(file.mtimeMs),
      message.slice(0, 1000),
      ROAD_VIDEO_ANALYZER_VERSION,
      startedAt,
    ]
  );
  await pool.query(
    `DELETE FROM layer.road_video_anchor a USING layer.road_video_track t
      WHERE a.track_id = t.id AND t.layer_id = $1 AND t.road_key = $2 AND t.file_name = $3`,
    [ROAD_VIDEO_LAYER_ID, file.roadKey, file.fileName]
  );
}

async function saveDone(
  file: RoadVideoFile,
  line: [number, number][],
  out: Extract<AnalyzeOutput, { ok: true }>,
  startedAt: Date
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ id: number }>(
      `INSERT INTO layer.road_video_track
         (layer_id, road_key, file_name, file_size, file_mtime, status, message, direction, duration_sec,
          route_length_m, fit_cost, loops, elapsed_sec, analyzer_ver, analyzed_at, geom)
       VALUES ($1, $2, $3, $4, $5, 'done', NULL, $6, $7, $8, $9, $10::jsonb, $11, $13, now(),
               ST_SetSRID(ST_GeomFromGeoJSON($12), ${ROAD_VIDEO_SRID}))
       ON CONFLICT (layer_id, road_key, file_name) DO UPDATE SET
         file_size = EXCLUDED.file_size, file_mtime = EXCLUDED.file_mtime, status = 'done', message = NULL,
         direction = EXCLUDED.direction, duration_sec = EXCLUDED.duration_sec,
         route_length_m = EXCLUDED.route_length_m, fit_cost = EXCLUDED.fit_cost, loops = EXCLUDED.loops,
         elapsed_sec = EXCLUDED.elapsed_sec, analyzer_ver = EXCLUDED.analyzer_ver, analyzed_at = now(),
         geom = EXCLUDED.geom,
         requested_at = CASE WHEN layer.road_video_track.requested_at > $14 THEN layer.road_video_track.requested_at END
       RETURNING id`,
      [
        ROAD_VIDEO_LAYER_ID,
        file.roadKey,
        file.fileName,
        file.size,
        new Date(file.mtimeMs),
        out.direction,
        out.durationSec,
        out.routeLengthM,
        out.cost,
        JSON.stringify(out.loops ?? []),
        out.elapsedSec ?? null,
        JSON.stringify({ type: 'LineString', coordinates: line }),
        out.analyzerVersion ?? ROAD_VIDEO_ANALYZER_VERSION,
        startedAt,
      ]
    );
    const trackId = r.rows[0]!.id;
    await client.query(`DELETE FROM layer.road_video_anchor WHERE track_id = $1`, [trackId]);
    await client.query(
      `INSERT INTO layer.road_video_anchor (track_id, time_sec, route_m, front_deg, kind)
       SELECT $1, u.t, u.m, u.f, 'auto' FROM unnest($2::float8[], $3::float8[], $4::float8[]) AS u(t, m, f)`,
      [
        trackId,
        out.anchors.map((a) => a[0]),
        out.anchors.map((a) => a[1]),
        out.anchors.map((a) => (typeof a[2] === 'number' && Number.isFinite(a[2]) ? a[2] : null)),
      ]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function analyzeVideo(file: RoadVideoFile): Promise<void> {
  const startedAt = new Date();
  const label = `${file.roadKey}/${file.fileName}`;
  const route = await loadRoadVideoRoute(file.roadKey);
  if (!route) {
    await saveFailed(file, '도로대장 노선 선형이 없습니다.', startedAt);
    console.warn(`${LOG} ${label} failed: no route`);
    return;
  }
  const zones = await loadRoadVideoCrossingZones(route.line);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(os.tmpdir(), `ggnr_road_video_${stamp}_in.json`);
  const outputPath = path.join(os.tmpdir(), `ggnr_road_video_${stamp}_out.json`);
  console.info(`${LOG} ${label} start (route ${Math.round(route.lengthM)}m, crossings ${zones.length})`);
  try {
    await fs.writeFile(inputPath, JSON.stringify({ video: file.abs, route: route.line, zones }), 'utf8');
    const out = await runAnalyzer(inputPath, outputPath, label);
    if (out.ok) {
      await saveDone(file, route.line, out, startedAt);
      console.info(
        `${LOG} ${label} done ${out.direction} anchors=${out.anchors.length} loops=${out.loops.length} ${out.elapsedSec ?? '?'}s`
      );
    } else {
      await saveFailed(file, out.error, startedAt);
      console.warn(`${LOG} ${label} failed: ${out.error}`);
    }
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => undefined);
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

/**
 * 분석 요청(슈퍼 계정이 영상을 열 때 남김)이 걸린 도로영상을 요청 순서대로 하나씩 이어서 모두 분석한다.
 * 같은 파일을 한 번 실행에서 두 번 고르지 않는다. 테이블이 없으면(요청이 한 번도 없던 사업) 아무것도 하지 않는다.
 */
async function runRequestedRoadVideoTracks(): Promise<void> {
  if (!(await roadVideoTrackTablesExist())) return;
  await ensureRoadVideoTrackTables();
  const attempted = new Set<string>();
  for (;;) {
    const next = await findRequestedVideo(attempted);
    if (!next) return;
    attempted.add(`${next.roadKey}\u0000${next.fileName}`);
    await analyzeVideo(next);
  }
}

/**
 * 1분마다 분석 요청이 걸린 도로영상을 하나씩 이어서 모두 분석(분석 중이면 그 사이 격자는 건너뜀). 기동 직후 실행 없음.
 * DISABLE_ROAD_VIDEO_TRACK_SCHEDULER=1 또는 DISABLED_SCHEDULERS=roadVideoTrack 로 끈다.
 */
export function startRoadVideoTrackScheduler(): void {
  console.info(`${LOG} registered: every ${SCHEDULE.minutes} min, no run on startup`);
  let lastSlot: string | null = null;
  let running = false;
  let stopped = false;

  setInterval(() => {
    if (stopped || running) return;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const slot = intervalSlotKey(SCHEDULE, now);
    if (!slot || lastSlot === slot) return;
    lastSlot = slot;
    running = true;
    void runRequestedRoadVideoTracks()
      .catch((e) => {
        if (e instanceof AnalyzerUnavailableError) {
          stopped = true;
          console.warn(
            `${LOG} stopped until restart — 분석 도구 없음(python/env 에 opencv-python-headless 설치 필요): ${e.message}`
          );
          return;
        }
        console.warn(`${LOG} fail:`, e instanceof Error ? e.message : e);
      })
      .finally(() => {
        running = false;
      });
  }, 15_000);
}
