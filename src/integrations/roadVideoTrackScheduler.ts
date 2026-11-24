import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pool } from '@/database/db';
import { intervalSlotKey } from '@/integrations/integrationSchedule';
import { pipelinePythonSpawnEnv, resolvePipelinePythonBin } from '@/lib/pipelinePython';
import {
  ensureRoadVideoTrackTables,
  loadRoadVideoBranchLandmarks,
  loadRoadVideoCrossingZones,
  clearRoadVideoManualLandmarks,
  loadRoadVideoManualLandmarks,
  loadRoadVideoRoute,
  roadVideoTrackTablesExist,
  statRoadVideoFile,
  ROAD_VIDEO_ANALYZER_VERSION,
  ROAD_VIDEO_EXT_RE,
  ROAD_VIDEO_LAYER_ID,
  ROAD_VIDEO_SRID,
  type RoadVideoFile,
} from '@/lib/roadVideoTrack';
import { resolveGgnrDataDir } from '@/lib/turbopackFsPath';
import { shouldHideServiceFileDataFileName } from '@/lib/serviceFileData';

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
      /** videos 이어붙임 시 각 파일 길이(초) */
      partDurations?: number[];
    }
  | { ok: false; error: string };

/**
 * 상행=노선 시작→끝(forward), 하행=끝→시작(reverse).
 * 부야~소천 상행 초반(다리)이 노선 geom 시작(하행 출발) 쪽과 맞음.
 */
type VideoNameInfo = {
  group: 'up' | 'down' | 'other';
  part: number;
  preferDirection: 'forward' | 'reverse' | null;
};

function parseRoadVideoName(fileName: string): VideoNameInfo {
  if (/상행/.test(fileName)) {
    const m = fileName.match(/상행\s*(\d+)/);
    return { group: 'up', part: m ? Number(m[1]) : 1, preferDirection: 'forward' };
  }
  if (/하행/.test(fileName)) {
    const m = fileName.match(/하행\s*(\d+)/);
    return { group: 'down', part: m ? Number(m[1]) : 1, preferDirection: 'reverse' };
  }
  return { group: 'other', part: 1, preferDirection: null };
}

async function listRoadVideosInFolder(roadKey: string): Promise<RoadVideoFile[]> {
  const dir = path.join(resolveGgnrDataDir(), 'file_data', ROAD_VIDEO_LAYER_ID, roadKey);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: RoadVideoFile[] = [];
  for (const name of names) {
    if (!ROAD_VIDEO_EXT_RE.test(name) || shouldHideServiceFileDataFileName(name)) continue;
    const file = await statRoadVideoFile(roadKey, name);
    if (file) out.push(file);
  }
  return out;
}

/** 이어붙인 분석 결과를 파일별 로컬 시각으로 나눔 */
function splitGroupResult(
  out: Extract<AnalyzeOutput, { ok: true }>,
  partDurations: number[]
): Array<Extract<AnalyzeOutput, { ok: true }>> {
  if (partDurations.length <= 1) {
    return [{ ...out, durationSec: partDurations[0] ?? out.durationSec, partDurations: undefined }];
  }
  const parts: Array<Extract<AnalyzeOutput, { ok: true }>> = [];
  let t0 = 0;
  for (let i = 0; i < partDurations.length; i += 1) {
    const dur = Math.max(0, Number(partDurations[i]) || 0);
    const t1 = t0 + dur;
    const anchors = out.anchors
      .filter((a) => a[0] >= t0 - 1e-3 && a[0] <= t1 + 1e-3)
      .map((a) => {
        const row: [number, number, number?] = [
          Math.round((a[0] - t0) * 100) / 100,
          a[1],
        ];
        if (typeof a[2] === 'number' && Number.isFinite(a[2])) row[2] = a[2];
        return row;
      });
    // 구간 양끝 앵커 보강
    const first = out.anchors.find((a) => a[0] >= t0 - 1e-3) ?? out.anchors[0];
    const last =
      [...out.anchors].reverse().find((a) => a[0] <= t1 + 1e-3) ?? out.anchors[out.anchors.length - 1];
    if (anchors.length === 0 && first && last) {
      anchors.push([0, first[1], first[2]], [Math.round(dur * 100) / 100, last[1], last[2]]);
    } else {
      if (anchors[0] && anchors[0][0] > 0.05 && first) {
        anchors.unshift([0, first[1], first[2]]);
      }
      if (anchors.length && anchors[anchors.length - 1]![0] < dur - 0.05 && last) {
        anchors.push([Math.round(dur * 100) / 100, last[1], last[2]]);
      }
    }
    const loops = (out.loops ?? [])
      .map(([a, b]) => {
        const lo = Math.max(a, t0);
        const hi = Math.min(b, t1);
        if (hi - lo < 0.2) return null;
        return [Math.round((lo - t0) * 100) / 100, Math.round((hi - t0) * 100) / 100] as [number, number];
      })
      .filter((x): x is [number, number] => x != null);
    parts.push({
      ...out,
      durationSec: Math.round(dur * 100) / 100,
      anchors,
      loops,
      partDurations: undefined,
    });
    t0 = t1;
  }
  return parts;
}

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
        out.anchors.map((a) => Number(a[0])),
        out.anchors.map((a) => Number(a[1])),
        out.anchors.map((a) =>
          typeof a[2] === 'number' && Number.isFinite(a[2]) ? Number(a[2]) : null
        ),
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

/**
 * 상행1·2 / 하행1·2 는 같은 방향끼리 이어 붙여 한 번 맞춘 뒤 파일별로 나눈다.
 * @returns 이번에 처리한 파일명(스킵 집합에 넣을 키용)
 */
async function analyzeVideo(file: RoadVideoFile): Promise<string[]> {
  const startedAt = new Date();
  const info = parseRoadVideoName(file.fileName);
  const folderFiles = await listRoadVideosInFolder(file.roadKey);
  const groupFiles =
    info.group === 'other'
      ? [file]
      : folderFiles
          .filter((f) => parseRoadVideoName(f.fileName).group === info.group)
          .sort((a, b) => parseRoadVideoName(a.fileName).part - parseRoadVideoName(b.fileName).part);
  const files = groupFiles.length > 0 ? groupFiles : [file];
  const doneNames = files.map((f) => f.fileName);
  const label =
    files.length > 1
      ? `${file.roadKey}/[${files.map((f) => f.fileName).join(' + ')}]`
      : `${file.roadKey}/${file.fileName}`;

  const route = await loadRoadVideoRoute(file.roadKey);
  if (!route) {
    for (const f of files) await saveFailed(f, '도로대장 노선 선형이 없습니다.', startedAt);
    console.warn(`${LOG} ${label} failed: no route`);
    return doneNames;
  }
  const crossingZones = await loadRoadVideoCrossingZones(route.line);
  const branches = await loadRoadVideoBranchLandmarks(route.line);
  const zones = [...crossingZones, ...branches.zones];
  const manuals = await loadRoadVideoManualLandmarks(
    file.roadKey,
    files.map((f) => f.fileName)
  );
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(os.tmpdir(), `ggnr_road_video_${stamp}_in.json`);
  const outputPath = path.join(os.tmpdir(), `ggnr_road_video_${stamp}_out.json`);
  const prefer = info.preferDirection;
  console.info(
    `${LOG} ${label} start (route ${Math.round(route.lengthM)}m, crossings ${crossingZones.length}, branches ${branches.meters.length}, manual ${manuals.length}, parts ${files.length}${prefer ? `, prefer ${prefer}` : ''})`
  );
  try {
    // partDurations 는 분석 후에 알 수 있으므로, 수동점은 파일별로 두고 분석기에서 이어붙인 시각으로 합친다
    const manualByFile = files.map((f) =>
      manuals
        .filter((m) => m.fileName === f.fileName)
        .map((m) => ({ t: m.timeSec, m: m.routeM }))
    );
    const payload: Record<string, unknown> = {
      route: route.line,
      zones,
      ...(branches.meters.length ? { landmarks: branches.meters } : {}),
      ...(manuals.length ? { manualLandmarksByPart: manualByFile } : {}),
      ...(prefer ? { preferDirection: prefer } : {}),
    };
    if (files.length > 1) payload.videos = files.map((f) => f.abs);
    else payload.video = files[0]!.abs;

    await fs.writeFile(inputPath, JSON.stringify(payload), 'utf8');
    const out = await runAnalyzer(inputPath, outputPath, label);
    if (out.ok) {
      const durs =
        Array.isArray(out.partDurations) && out.partDurations.length === files.length
          ? out.partDurations.map((x) => Number(x) || 0)
          : files.length === 1
            ? [out.durationSec]
            : null;
      if (!durs) {
        for (const f of files) {
          await saveFailed(f, '분할 영상 길이 정보가 맞지 않습니다.', startedAt);
        }
        console.warn(`${LOG} ${label} failed: partDurations mismatch`);
        return doneNames;
      }
      const parts = splitGroupResult(out, durs);
      for (let i = 0; i < files.length; i += 1) {
        const partOut = parts[i]!;
        await saveDone(files[i]!, route.line, partOut, startedAt);
        console.info(
          `${LOG} ${files[i]!.fileName} done ${partOut.direction} anchors=${partOut.anchors.length} ${partOut.durationSec}s`
        );
      }
      // 수동 기준점은 재분석 입력용 — 맞춤에 반영된 뒤 목록·핀에서 제거
      if (manuals.length) {
        await clearRoadVideoManualLandmarks(
          file.roadKey,
          files.map((f) => f.fileName)
        );
        console.info(`${LOG} ${label} cleared ${manuals.length} manual landmarks`);
      }
    } else {
      for (const f of files) await saveFailed(f, out.error, startedAt);
      console.warn(`${LOG} ${label} failed: ${out.error}`);
    }
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => undefined);
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
  return doneNames;
}

/**
 * 지정 파일(상·하행 그룹 포함)을 지금 코드로 바로 분석. 대기열·분 스케줄러와 무관.
 * 수동 기준점이 있으면 반영 후 삭제한다.
 */
export async function runRoadVideoTrackForFiles(roadKey: string, fileNames: string[]): Promise<string[]> {
  await ensureRoadVideoTrackTables();
  const key = String(roadKey ?? '').trim();
  const names = [...new Set(fileNames.map((n) => String(n).trim()).filter(Boolean))];
  if (!key || names.length === 0) return [];
  const attempted = new Set<string>();
  const done: string[] = [];
  for (const name of names) {
    if (attempted.has(name)) continue;
    const file = await statRoadVideoFile(key, name);
    if (!file) {
      console.warn(`${LOG} skip missing file ${key}/${name}`);
      continue;
    }
    const processed = await analyzeVideo(file);
    for (const n of processed) {
      attempted.add(n);
      done.push(n);
    }
  }
  // 스케줄러가 같은 요청을 옛 코드로 다시 돌리지 않게
  if (done.length) {
    await pool.query(
      `UPDATE layer.road_video_track SET requested_at = NULL
        WHERE layer_id = $1 AND road_key = $2 AND file_name = ANY($3)`,
      [ROAD_VIDEO_LAYER_ID, key, done]
    );
  }
  return done;
}

/**
 * 분석 요청(슈퍼 계정이 영상을 열 때 남김)이 걸린 도로영상을 요청 순서대로 하나씩 이어서 모두 분석한다.
 * 같은 파일을 한 번 실행에서 두 번 고르지 않는다. 테이블이 없으면(요청이 한 번도 없던 사업) 아무것도 하지 않는다.
 */
export async function runRequestedRoadVideoTracks(): Promise<void> {
  if (!(await roadVideoTrackTablesExist())) return;
  await ensureRoadVideoTrackTables();
  const attempted = new Set<string>();
  for (;;) {
    const next = await findRequestedVideo(attempted);
    if (!next) return;
    const names = await analyzeVideo(next);
    for (const name of names) attempted.add(`${next.roadKey}\u0000${name}`);
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
