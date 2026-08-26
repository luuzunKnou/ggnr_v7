/**
 * 정사영상(GeoTIFF) → XYZ JPEG 타일.
 * 업로드: tiles_tif/{groupName}/...tif
 * 산출: tiles_jpg/{groupName}/z/x/y.jpg
 *
 * 변환은 항상 원본 좌표계 그대로(`gdal2tiles --profile=raster`). gdalwarp/좌표계 reprojection 없음.
 *
 * 기존 평면 구조 tiles_jpg/{tileSetId}/… 도 타일 API·resolve에서 지원(레거시).
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import iconv from 'iconv-lite';
import { pool } from '@/database/db';
import {
  appendUploadConvertHistory,
  ensureBaseStructure,
  listDirectory,
  type ListDirectoryResult,
} from './fileManagerService';
import { GGNR_DATA_PATHS } from '@/lib/ggnrDataPaths';
import { resolveGgnrDataDir, turbopackOpaquePath } from '@/lib/turbopackFsPath';

/** 무활동 감지 기본값 (ms) — stdout/stderr 수신 없이 이 시간이 지나면 kill */
const ORTHO_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

/** 절대 상한 24시간 고정 */
function getOrthoMaxTimeoutMs(): number {
  return 24 * 60 * 60 * 1000;
}

/** GGNR_DATA_DIR 아래 임시 작업 경로 (warp·타일 staging) */
function getOrthoDataWorkDir(): string {
  return path.join(getBaseDir(), '.tmp');
}

const PYTHON_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

// ─── 진행률 추적 ───────────────────────────────────────────────

export type OrthoJobPhase = 'queued' | 'vrt' | 'warp' | 'tiles' | 'copy' | 'done' | 'failed';

export interface OrthoJobProgress {
  groupName: string;
  phase: OrthoJobPhase;
  percent: number;
  startedAt: string;
  phaseStartedAt: string;
  updatedAt: string;
  message: string;
  /** 타일 장수 기준 예상 남은 초 (없으면 null) */
  etaSeconds: number | null;
  /** 예상 총 타일 장수 (warp 이후) */
  tilesExpected: number | null;
  /** 현재까지 생성된(또는 복사된) 타일 장수 */
  tilesCreated: number | null;
}

const orthoJobProgressMap = new Map<string, OrthoJobProgress>();

/** gdal2tiles --tilesize=512 mercator 와 동일한 타일 인덱스 산식 */
const ORTHO_TILE_SIZE = 512;
const ORTHO_ORIGIN_SHIFT = (2 * Math.PI * 6378137) / 2;

function orthoInitialResolution(tileSize: number): number {
  return (2 * Math.PI * 6378137) / tileSize;
}

function metersToOrthoTile(mx: number, my: number, zoom: number, tileSize = ORTHO_TILE_SIZE): { tx: number; ty: number } {
  const res = orthoInitialResolution(tileSize) / 2 ** zoom;
  return {
    tx: Math.floor((mx + ORTHO_ORIGIN_SHIFT) / (res * tileSize)),
    ty: Math.floor((ORTHO_ORIGIN_SHIFT - my) / (res * tileSize)),
  };
}

function estimateMercatorTileCount(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  zoomMin: number,
  zoomMax: number,
  tileSize = ORTHO_TILE_SIZE
): number {
  let total = 0;
  for (let z = zoomMin; z <= zoomMax; z++) {
    const nw = metersToOrthoTile(minX, maxY, z, tileSize);
    const se = metersToOrthoTile(maxX, minY, z, tileSize);
    const nx = Math.abs(se.tx - nw.tx) + 1;
    const ny = Math.abs(se.ty - nw.ty) + 1;
    total += nx * ny;
  }
  return total;
}

/** z/x/y 구조 타일 파일 수 (전체 recursive 대신 2단 readdir) */
function countOrthoTileFiles(root: string): number {
  let n = 0;
  try {
    const zooms = fs.readdirSync(turbopackOpaquePath(root), { withFileTypes: true });
    for (const z of zooms) {
      if (!z.isDirectory() || !/^\d+$/.test(z.name)) continue;
      const zPath = path.join(root, z.name);
      let xs: fs.Dirent[];
      try {
        xs = fs.readdirSync(turbopackOpaquePath(zPath), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const x of xs) {
        if (x.isFile()) {
          n += 1;
          continue;
        }
        if (!x.isDirectory()) continue;
        try {
          n += fs.readdirSync(turbopackOpaquePath(path.join(zPath, x.name))).length;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    return n;
  }
  return n;
}

function formatTileCount(n: number): string {
  return n.toLocaleString('ko-KR');
}

function refreshOrthoEta(entry: OrthoJobProgress): void {
  if (entry.phase === 'failed' || entry.phase === 'done' || entry.percent >= 100) {
    entry.etaSeconds = null;
    return;
  }
  const elapsedMs = Date.now() - new Date(entry.phaseStartedAt).getTime();
  if (elapsedMs < 30_000) {
    entry.etaSeconds = null;
    return;
  }
  const elapsedSec = elapsedMs / 1000;

  // 타일링·복사: 장수 기준
  if (entry.phase === 'tiles' || entry.phase === 'copy') {
    const expected = entry.tilesExpected;
    const created = entry.tilesCreated;
    if (expected == null || expected <= 0 || created == null || created <= 0) {
      entry.etaSeconds = null;
      return;
    }
    if (created >= expected) {
      entry.etaSeconds = 0;
      return;
    }
    const rate = created / elapsedSec;
    if (!(rate > 0)) {
      entry.etaSeconds = null;
      return;
    }
    entry.etaSeconds = Math.max(0, Math.round((expected - created) / rate));
    return;
  }

  // VRT·좌표 변환: GDAL stdout % 기준
  if (entry.phase === 'warp' || entry.phase === 'vrt') {
    const pct = entry.percent;
    if (pct < 1) {
      entry.etaSeconds = null;
      return;
    }
    entry.etaSeconds = Math.max(0, Math.round((elapsedSec * (100 - pct)) / pct));
    return;
  }

  entry.etaSeconds = null;
}

function setOrthoPhase(groupName: string, phase: OrthoJobPhase, percent: number, message?: string) {
  const now = new Date().toISOString();
  const existing = orthoJobProgressMap.get(groupName);
  const phaseChanged = !existing || existing.phase !== phase;
  const entry: OrthoJobProgress = {
    groupName,
    phase,
    percent,
    startedAt: existing?.startedAt ?? now,
    phaseStartedAt: phaseChanged ? now : (existing?.phaseStartedAt ?? now),
    updatedAt: now,
    message: message ?? `${phase} ${percent}%`,
    etaSeconds: existing?.etaSeconds ?? null,
    tilesExpected: existing?.tilesExpected ?? null,
    tilesCreated: phaseChanged && (phase === 'tiles' || phase === 'copy') ? 0 : (existing?.tilesCreated ?? null),
  };
  if (phase === 'queued' || phase === 'vrt' || phase === 'warp') {
    entry.tilesCreated = null;
    if (phase === 'queued') entry.tilesExpected = null;
  }
  refreshOrthoEta(entry);
  orthoJobProgressMap.set(groupName, entry);
}

function setOrthoTilesExpected(groupName: string, tilesExpected: number) {
  const entry = orthoJobProgressMap.get(groupName);
  if (!entry) return;
  entry.tilesExpected = tilesExpected > 0 ? tilesExpected : null;
  entry.updatedAt = new Date().toISOString();
  orthoJobProgressMap.set(groupName, entry);
}

const orthoTileCountThrottleMs = new Map<string, number>();

/** 타일/복사 폴더 장수 → %·ETA·메시지 (예상 총 장수 기준) */
function updateOrthoTileCountProgress(
  groupName: string,
  tilesDir: string,
  label: '타일링' | '복사',
  force = false
) {
  const entry = orthoJobProgressMap.get(groupName);
  if (!entry || entry.phase === 'done' || entry.phase === 'failed') return;
  if (entry.phase !== 'tiles' && entry.phase !== 'copy') return;
  const now = Date.now();
  const last = orthoTileCountThrottleMs.get(groupName) ?? 0;
  // interval 폴러는 15초 — onActivity 폭주 시 최소 8초 간격
  if (!force && now - last < 8_000) return;
  orthoTileCountThrottleMs.set(groupName, now);
  const created = countOrthoTileFiles(tilesDir);
  entry.tilesCreated = created;
  entry.updatedAt = new Date().toISOString();
  const expected = entry.tilesExpected;
  if (expected != null && expected > 0) {
    entry.percent = Math.min(99, Math.max(0, Math.round((100 * created) / expected)));
    entry.message = `${label} ${formatTileCount(created)} / ${formatTileCount(expected)}장`;
  } else {
    entry.message = `${label} ${formatTileCount(created)}장`;
  }
  refreshOrthoEta(entry);
}

function updateOrthoJobProgress(groupName: string, stdoutChunk: string) {
  const entry = orthoJobProgressMap.get(groupName);
  if (!entry) return;
  // 타일·복사는 장수 기준 % 사용 — GDAL stdout % 로 덮지 않음
  if (entry.phase === 'tiles' || entry.phase === 'copy') return;
  const matches = [...stdoutChunk.matchAll(/(\d+)\.\.\.|(\d+)%/g)];
  if (!matches.length) return;
  const last = matches[matches.length - 1]!;
  const raw = parseInt((last[1] || last[2])!, 10);
  if (!Number.isFinite(raw)) return;
  const pct = Math.min(99, Math.max(0, raw));
  entry.updatedAt = new Date().toISOString();
  if (entry.phase === 'warp') {
    entry.percent = pct;
    entry.message = `좌표 변환 ${raw}%`;
    refreshOrthoEta(entry);
  } else if (entry.phase === 'vrt') {
    entry.percent = pct;
    entry.message = `VRT 합본 ${raw}%`;
    refreshOrthoEta(entry);
  }
}

/** 타일 폴더에 파일이 늘고 있을 때 stdout이 없어도 진행 중으로 표시 */
function touchOrthoJobActivity(groupName: string, detail?: string) {
  const entry = orthoJobProgressMap.get(groupName);
  if (!entry || entry.phase === 'done' || entry.phase === 'failed') return;
  entry.updatedAt = new Date().toISOString();
  if (detail && entry.phase === 'warp') {
    entry.message = detail;
  } else if (detail && entry.phase === 'tiles' && entry.tilesExpected == null && entry.tilesCreated == null) {
    entry.message = detail;
  }
}

export function getOrthoJobProgress(params?: { groupName?: string }): OrthoJobProgress | OrthoJobProgress[] | null {
  if (params?.groupName) {
    return orthoJobProgressMap.get(params.groupName) ?? null;
  }
  return [...orthoJobProgressMap.values()];
}

// ─── /진행률 ────────────────────────────────────────────────────

const TIF_EXT = /\.(tif|tiff)$/i;

function opaqueExists(p: string): boolean {
  return fs.existsSync(turbopackOpaquePath(p));
}

/** 프로젝트 python/env — path.join(cwd,'python','env') 정적 추적 회피 */
function projectPythonEnvRoot(): string {
  return [process.cwd(), 'python', 'env'].join(path.sep);
}

export type SatelliteTifGroupedFile = {
  /** 그룹(직계 하위 폴더명) */
  groupName: string;
  /** GGNR_DATA_DIR 기준 상대 경로, 슬래시 */
  relativePath: string;
  /** 파일명만 */
  name: string;
  size: number;
  modified?: string;
};

export type SatelliteTifGroupedUploadsResult = {
  groups: {
    groupName: string;
    sourceCrs: string | null;
    files: SatelliteTifGroupedFile[];
  }[];
};

export type OrthophotoCrsCandidate = {
  epsg: number;
  sourceCrs: string;
  intersectsEmd: boolean;
  overlapRatio: number;
  bboxWgs84: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  } | null;
  previewGeometry: Record<string, unknown> | null;
};

export type OrthophotoTileOutputsResult = {
  /** 그룹 폴더명, 그 아래 타일 루트 폴더명(원본 경로에서 유도된 outputSlug 등) */
  groups: { groupName: string; tileSetIds: string[] }[];
  /** 레거시: 2dtiles 바로 아래 tileSetId (중간 그룹 없음) */
  legacyTileSetIds: string[];
};

function getBaseDir(): string {
  return resolveGgnrDataDir();
}

function resolveSafeRelative(rel: string): string | null {
  const base = getBaseDir();
  const raw = rel.trim().replace(/^[/\\]+/, '');
  const resolved = path.normalize(path.join(base, raw));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

function getPythonExeResolved(): string | null {
  const raw = (process.env.GGNR_PIPELINE_PYTHON ?? '').trim();
  if (!raw || raw === 'python') return null;
  return path.resolve(process.cwd(), raw);
}

/**
 * GDAL 실행 파일 절대 경로 후보.
 * - GGNR_PIPELINE_PYTHON 옆 Scripts, (Windows conda-forge) Library\\bin
 * - 프로젝트 루트 python/env 동일
 * - 환경변수 GGNR_GDAL_SCRIPTS_DIR (폴더만, exe 이름은 자동)
 */
function gdalToolPath(
  toolBaseName: 'gdalwarp' | 'gdalinfo' | 'gdal2tiles' | 'gdalbuildvrt' | 'gdal_translate'
): string {
  const exeName =
    process.platform === 'win32' ? `${toolBaseName}${['.exe'].join('')}` : toolBaseName;
  const candidates: string[] = [];
  const pushCondaGdalDirs = (envRoot: string) => {
    candidates.push([envRoot, 'Scripts', exeName].join(path.sep));
    if (process.platform === 'win32') {
      candidates.push([envRoot, 'Library', 'bin', exeName].join(path.sep));
    } else {
      candidates.push([envRoot, 'bin', exeName].join(path.sep));
    }
  };
  const py = getPythonExeResolved();
  if (py) {
    pushCondaGdalDirs(path.dirname(py));
  }
  pushCondaGdalDirs(projectPythonEnvRoot());
  const gdalScriptsKey = ['GGNR', 'GDAL', 'SCRIPTS', 'DIR'].join('_');
  const gdalScripts = (process.env[gdalScriptsKey] ?? '').trim();
  if (gdalScripts) {
    candidates.push([path.normalize(gdalScripts), exeName].join(path.sep));
  }
  for (const c of candidates) {
    if (opaqueExists(c)) return c;
  }
  return exeName;
}

/**
 * Windows conda Scripts\\gdal2tiles.exe 는 env 이동 시 shebang이 깨져
 * "failed to create process" 가 난다. 프로젝트 python으로 모듈 실행한다.
 */
function resolveGdal2TilesInvoke(): { cmd: string; argsPrefix: string[]; label: string } {
  const pyCandidates = [
    getPythonExeResolved(),
    process.platform === 'win32'
      ? [projectPythonEnvRoot(), 'python.exe'].join(path.sep)
      : [projectPythonEnvRoot(), 'bin', 'python'].join(path.sep),
  ].filter((x): x is string => !!x);

  for (const py of pyCandidates) {
    if (!opaqueExists(py)) continue;
    return {
      cmd: py,
      argsPrefix: ['-m', 'osgeo_utils.gdal2tiles'],
      label: `${py} -m osgeo_utils.gdal2tiles`,
    };
  }

  const exe = gdalToolPath('gdal2tiles');
  return { cmd: exe, argsPrefix: [], label: exe };
}

/** gdalToolPath 가 실제 파일 경로인지(없으면 exe 이름만 반환됨) */
function isConcreteToolPath(p: string): boolean {
  if (process.platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.includes(path.sep);
  }
  return path.isAbsolute(p);
}

/** `…/Library/bin/foo.exe` 또는 `…/Scripts/foo.exe` 등에서 conda/env 루트 추출 */
function condaEnvRootFromResolvedTool(toolAbs: string): string | null {
  const norm = path.normalize(toolAbs);
  const low = norm.replace(/\\/g, '/').toLowerCase();
  const libBin = '/library/bin/';
  const i = low.lastIndexOf(libBin);
  if (i >= 0) return norm.slice(0, i);
  const scripts = '/scripts/';
  const j = low.lastIndexOf(scripts);
  if (j >= 0) return norm.slice(0, j);
  const unixBin = '/bin/';
  const k = low.lastIndexOf(unixBin);
  if (k >= 0) return norm.slice(0, k);
  return null;
}

function resolveCondaEnvRootForGdal(gdalExe: string): string | null {
  if (isConcreteToolPath(gdalExe)) {
    const fromTool = condaEnvRootFromResolvedTool(gdalExe);
    if (fromTool) return fromTool;
  }
  const py = getPythonExeResolved();
  if (py) return path.dirname(py);
  return projectPythonEnvRoot();
}

/**
 * PostGIS·시스템에 깔린 옛 PROJ(PROJ_LIB)를 물려받지 않도록, conda/OSGeo 환경의 DB만 쓰게 한다.
 */
function buildGdalChildEnv(gdalExe: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...PYTHON_ENV };
  const root = resolveCondaEnvRootForGdal(gdalExe);
  if (!root) return env;

  const projDirs = [path.join(root, 'Library', 'share', 'proj'), path.join(root, 'share', 'proj')];
  for (const d of projDirs) {
    if (opaqueExists(path.join(d, 'proj.db'))) {
      env.PROJ_LIB = d;
      env.PROJ_DATA = d;
      break;
    }
  }

  const gdalDirs = [path.join(root, 'Library', 'share', 'gdal'), path.join(root, 'share', 'gdal')];
  for (const d of gdalDirs) {
    if (opaqueExists(d)) {
      env.GDAL_DATA = d;
      break;
    }
  }

  return env;
}

function pushChunk(chunks: Buffer[], d: Buffer | string | Uint8Array): void {
  chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
}

/** Windows cmd stderr 등 CP949 → UTF-8 로그용 */
function decodeChildOutput(buf: Buffer, usedCmdShell: boolean): string {
  if (buf.length === 0) return '';
  if (usedCmdShell && process.platform === 'win32') {
    try {
      return iconv.decode(buf, 'cp949');
    } catch {
      return buf.toString('utf8');
    }
  }
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    try {
      return iconv.decode(buf, 'cp949');
    } catch {
      return utf8;
    }
  }
  return utf8;
}

interface RunProcessOpts {
  activityTimeoutMs?: number;
  maxTimeoutMs?: number;
  onStdout?: (chunk: string) => void;
  /** stdout이 없어도 이 경로의 파일/폴더가 변하면 활동으로 인정 */
  activityWatchPath?: string;
  onActivity?: () => void;
}

/** 네트워크 대용량에서도 가벼운 시그니처 (전체 파일 수 카운트 금지) */
function probePathActivitySignature(watchPath: string): string | null {
  try {
    const opaque = turbopackOpaquePath(watchPath);
    if (!fs.existsSync(opaque)) return null;
    const st = fs.statSync(opaque);
    if (st.isFile()) return `f:${st.size}:${Math.floor(st.mtimeMs)}`;

    const entries = fs.readdirSync(opaque, { withFileTypes: true });
    let newest = Math.floor(st.mtimeMs);
    let parts = `d:${entries.length}`;
    for (const e of entries) {
      if (!e.isDirectory() && !e.isFile()) continue;
      const child = path.join(watchPath, e.name);
      try {
        const cst = fs.statSync(turbopackOpaquePath(child));
        if (cst.mtimeMs > newest) newest = Math.floor(cst.mtimeMs);
        if (cst.isFile()) {
          parts += `|${e.name}:${cst.size}`;
          continue;
        }
        const xs = fs.readdirSync(turbopackOpaquePath(child));
        parts += `|${e.name}:${xs.length}`;
        if (!xs.length) continue;
        const lastX = xs[xs.length - 1]!;
        const xp = path.join(child, lastX);
        const xst = fs.statSync(turbopackOpaquePath(xp));
        if (xst.mtimeMs > newest) newest = Math.floor(xst.mtimeMs);
        if (xst.isDirectory()) {
          const ys = fs.readdirSync(turbopackOpaquePath(xp));
          parts += `/${ys.length}`;
          if (ys.length) {
            const fp = path.join(xp, ys[ys.length - 1]!);
            const fst = fs.statSync(turbopackOpaquePath(fp));
            if (fst.mtimeMs > newest) newest = Math.floor(fst.mtimeMs);
          }
        }
      } catch {
        /* ignore one child */
      }
    }
    return `${parts}@${newest}`;
  } catch {
    return null;
  }
}

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  childEnv: NodeJS.ProcessEnv = PYTHON_ENV,
  opts?: RunProcessOpts
): Promise<{ code: number; stdout: string; stderr: string }> {
  const activityTimeout = opts?.activityTimeoutMs ?? timeoutMs;
  const maxTimeout = opts?.maxTimeoutMs ?? getOrthoMaxTimeoutMs();

  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const exeLooksResolved =
      path.isAbsolute(cmd) || (isWin && /^[A-Za-z]:[\\/]/.test(cmd)) || cmd.includes(path.sep);
    const usedCmdShell = isWin && !exeLooksResolved;
    const child = usedCmdShell
      ? spawn('cmd.exe', ['/c', cmd, ...args], {
          cwd,
          windowsHide: true,
          shell: false,
          env: childEnv,
        })
      : isWin
        ? spawn(cmd, args, {
            cwd,
            windowsHide: true,
            shell: false,
            env: childEnv,
          })
        : spawn(cmd, args, { cwd, shell: false, env: childEnv });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let lastActivity = Date.now();
    const startTime = Date.now();
    let lastWatchSig = opts?.activityWatchPath
      ? probePathActivitySignature(opts.activityWatchPath)
      : null;

    const markActivity = () => {
      lastActivity = Date.now();
      try {
        opts?.onActivity?.();
      } catch {
        /* ignore */
      }
    };

    const killWithReason = (reason: string) => {
      child.kill('SIGTERM');
      const stdout = decodeChildOutput(Buffer.concat(outChunks), usedCmdShell);
      const stderr = decodeChildOutput(Buffer.concat(errChunks), usedCmdShell);
      resolve({ code: -1, stdout, stderr: `${stderr}\n[${reason}]`.trim() });
    };

    const activityCheck = setInterval(() => {
      const now = Date.now();
      if (opts?.activityWatchPath) {
        const sig = probePathActivitySignature(opts.activityWatchPath);
        if (sig != null && sig !== lastWatchSig) {
          lastWatchSig = sig;
          markActivity();
        }
      }
      if (now - startTime > maxTimeout) {
        clearInterval(activityCheck);
        killWithReason(`절대 상한 초과 ${Math.round(maxTimeout / 3600000)}h`);
      } else if (now - lastActivity > activityTimeout) {
        clearInterval(activityCheck);
        killWithReason(`무응답 ${Math.round(activityTimeout / 60000)}분 — 자동 종료`);
      }
    }, 30_000);

    if (child.stdout) child.stdout.on('data', (d) => {
      markActivity();
      pushChunk(outChunks, d as Buffer);
      if (opts?.onStdout) {
        try { opts.onStdout(Buffer.isBuffer(d) ? d.toString('utf8') : String(d)); } catch { /* */ }
      }
    });
    if (child.stderr) child.stderr.on('data', (d) => {
      markActivity();
      pushChunk(errChunks, d as Buffer);
    });

    child.on('close', (code) => {
      clearInterval(activityCheck);
      const stdout = decodeChildOutput(Buffer.concat(outChunks), usedCmdShell);
      const stderr = decodeChildOutput(Buffer.concat(errChunks), usedCmdShell);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (err) => {
      clearInterval(activityCheck);
      reject(err);
    });
  });
}

/** 영문·숫자·하이픈·밑줄 (그룹명·URL 경로 세그먼트 공통) */
function isSafeOrthoSegment(s: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(s);
}

const SATELLITE_TIF_PREFIX = 'tiles_tif/';
const ORTHO_GROUP_CRS_META_FILE = '.meta/orthophoto_group_crs.json';
const EMD_SCHEMA = 'public_layer';
const EMD_TABLE = 'emd';
const KOREA_CRS_CANDIDATES = [5181, 5185, 5186, 5187, 5179, 5174];

/** 좌표계 선택 모달용 저해상도 미리보기 (3857 PNG/JPEG) */
const ORTHO_CRS_PREVIEW_SUBDIR = '.tmp/ortho_crs_preview';
const ORTHO_CRS_PREVIEW_MAX_DIM = 480;
const ORTHO_CRS_PREVIEW_TIMEOUT_MS = 180_000;

type ParsedOrthoGroupName = {
  year: string;
  sourceCrs: string;
  layerName: string | null;
};

function parseOrthoGroupNameLoose(groupName: string): ParsedOrthoGroupName | null {
  const m = /^satellite_(\d{4})(?:_(\d{4,5})(?:_(.+))?)?$/i.exec(groupName.trim());
  if (!m) return null;
  const year = m[1]!;
  const sourceCrs = (m[2] ?? '').trim() ? `EPSG:${m[2]!.trim()}` : '';
  const layerName = (m[3] ?? '').trim() || null;
  return { year, sourceCrs, layerName };
}

async function readOrthoGroupCrsMeta(): Promise<Record<string, string>> {
  const base = getBaseDir();
  const fp = path.join(base, ORTHO_GROUP_CRS_META_FILE);
  try {
    const raw = await fsPromises.readFile(fp, 'utf8');
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!isSafeOrthoSegment(k)) continue;
      const s = String(v ?? '').trim().toUpperCase();
      if (/^EPSG:\d{4,5}$/.test(s)) out[k] = s;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeOrthoGroupCrsMeta(meta: Record<string, string>): Promise<void> {
  const base = getBaseDir();
  const dir = path.join(base, path.dirname(ORTHO_GROUP_CRS_META_FILE));
  const fp = path.join(base, ORTHO_GROUP_CRS_META_FILE);
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.writeFile(fp, JSON.stringify(meta), 'utf8');
}

async function resolveGroupSourceCrs(groupName: string): Promise<string | null> {
  const parsed = parseOrthoGroupNameLoose(groupName);
  if (parsed?.sourceCrs) return parsed.sourceCrs;
  const meta = await readOrthoGroupCrsMeta();
  return meta[groupName] ?? null;
}

/** 업로드 상위 폴더명(그룹 바로 아래 직계 부모) 또는 그룹 루트 파일이면 파일명 stem → URL/폴더용 슬러그 */
function sanitizeOrthoOutputFolderName(raw: string): string {
  const t = raw.trim().replace(/\.(tiff|tif)$/i, '');
  const s = t.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 120);
  if (!s) return 'ortho_tiles';
  if (/^\d+$/.test(s)) return `tiles_${s}`;
  return s;
}

/**
 * 변환 산출: `tiles_jpg/{groupName}/z/x/y.*`
 * - 같은 그룹 내 여러 소스는 동일 그룹 타일 루트에 누적/갱신됨.
 * - outputSlug 는 로그/호환 메시지용으로만 유지.
 */
export function computeOrthoOutputSlugFromSourceRelativePath(sourceRelativePath: string): {
  groupName: string;
  outputSlug: string;
} {
  const norm = sourceRelativePath.replace(/\\/g, '/').trim();
  if (!norm.startsWith(SATELLITE_TIF_PREFIX)) {
    throw new Error('sourceRelativePath는 tiles_tif/ 로 시작해야 합니다.');
  }
  const tail = norm.slice(SATELLITE_TIF_PREFIX.length);
  const segments = tail.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('tiles_tif/{그룹}/파일.tif 형태가 필요합니다.');
  }
  const groupName = segments[0]!;
  if (!isSafeOrthoSegment(groupName)) {
    throw new Error('그룹 폴더명은 영문·숫자·하이픈(-)·밑줄(_)만 사용할 수 있습니다.');
  }
  const under = segments.slice(1);
  const fileName = under[under.length - 1]!;
  const dirParts = under.slice(0, -1);
  const stem = fileName.replace(/\.(tiff|tif)$/i, '');
  const rawFolder = dirParts.length === 0 ? stem : dirParts[dirParts.length - 1]!;
  const outputSlug = sanitizeOrthoOutputFolderName(rawFolder);
  if (!isSafeOrthoSegment(outputSlug)) {
    throw new Error(`출력 폴더명으로 쓸 수 없습니다: ${outputSlug}`);
  }
  return { groupName, outputSlug };
}

export function orthoOutputRel(groupName: string, _outputSlug?: string): string {
  return `tiles_jpg/${groupName}`.replace(/\\/g, '/');
}

async function collectTifsUnderDir(
  dirAbs: string,
  baseRel: string
): Promise<SatelliteTifGroupedFile[]> {
  const out: SatelliteTifGroupedFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dirAbs, e.name);
    const relJoin = `${baseRel}/${e.name}`.replace(/\\/g, '/');
    if (e.isDirectory()) {
      const sub = await collectTifsUnderDir(full, relJoin);
      out.push(...sub);
    } else if (e.isFile() && TIF_EXT.test(e.name)) {
      try {
        const st = await fsPromises.stat(full);
        out.push({
          groupName: baseRel.split('/')[0] ?? '',
          relativePath: `tiles_tif/${relJoin}`.replace(/\\/g, '/'),
          name: e.name,
          size: st.size,
          modified: st.mtime?.toISOString?.(),
        });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/**
 * tiles_tif/{그룹폴더}/… 하위 모든 tif 수집 (그룹명 = 직계 하위 폴더명).
 */
export async function listSatelliteTifGroupedUploads(): Promise<SatelliteTifGroupedUploadsResult> {
  await ensureBaseStructure();
  const base = getBaseDir();
  const root = path.join(base, 'tiles_tif');
  const groups: SatelliteTifGroupedUploadsResult['groups'] = [];
  let top: fs.Dirent[];
  try {
    top = await fsPromises.readdir(root, { withFileTypes: true });
  } catch {
    return { groups: [] };
  }
  for (const e of top) {
    if (!e.isDirectory()) continue;
    const groupName = e.name;
    if (!isSafeOrthoSegment(groupName)) continue;
    const groupDir = path.join(root, groupName);
    const files = await collectTifsUnderDir(groupDir, groupName);
    if (files.length) groups.push({ groupName, sourceCrs: null, files });
  }
  const crsMeta = await readOrthoGroupCrsMeta();
  for (const g of groups) {
    const fromName = parseOrthoGroupNameLoose(g.groupName)?.sourceCrs || null;
    g.sourceCrs = fromName || crsMeta[g.groupName] || null;
  }
  groups.sort((a, b) => a.groupName.localeCompare(b.groupName));
  return { groups };
}

type SourceCornerBox = { minX: number; minY: number; maxX: number; maxY: number };

async function getSourceCornerBoxFromTif(absSource: string): Promise<SourceCornerBox> {
  const gdalinfo = gdalToolPath('gdalinfo');
  if (!isConcreteToolPath(gdalinfo) || !opaqueExists(gdalinfo)) {
    throw new Error('gdalinfo 실행 파일을 찾을 수 없습니다.');
  }
  const env = buildGdalChildEnv(gdalinfo);
  const p = await runProcess(gdalinfo, ['-json', absSource], getBaseDir(), 5 * 60 * 1000, env);
  if (p.code !== 0) {
    throw new Error(`gdalinfo 실패: ${p.stderr.slice(-500)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(p.stdout);
  } catch {
    throw new Error('gdalinfo JSON 파싱에 실패했습니다.');
  }
  const cc = (parsed as { cornerCoordinates?: Record<string, [number, number]> })?.cornerCoordinates;
  if (!cc) throw new Error('cornerCoordinates를 찾을 수 없습니다.');
  const pts = ['upperLeft', 'upperRight', 'lowerRight', 'lowerLeft']
    .map((k) => cc[k])
    .filter((v): v is [number, number] => Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]));
  if (pts.length < 2) throw new Error('cornerCoordinates 값이 유효하지 않습니다.');
  const xs = pts.map((p0) => p0[0]);
  const ys = pts.map((p0) => p0[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

async function getEmdUnionSqlParts(): Promise<{ geomExpr: string; srid: number }> {
  const gc = await pool.query(
    `SELECT f_geometry_column AS name, srid
       FROM geometry_columns
      WHERE f_table_schema = $1 AND f_table_name = $2
      LIMIT 1`,
    [EMD_SCHEMA, EMD_TABLE]
  );
  const row = gc.rows?.[0] as { name?: string; srid?: number } | undefined;
  if (!row?.name) throw new Error('emd geometry column을 찾을 수 없습니다.');
  const geomCol = `"${String(row.name).replace(/"/g, '""')}"`;
  const srid = Number(row.srid ?? 0);
  const safeSrid = Number.isFinite(srid) && srid > 0 ? srid : 5181;
  const geomExpr =
    safeSrid === 5181
      ? `ST_SetSRID(ST_Union(${geomCol}), 5181)`
      : `ST_Transform(ST_SetSRID(ST_Union(${geomCol}), ${safeSrid}), 5181)`;
  return { geomExpr, srid: safeSrid };
}

export async function setOrthophotoGroupSourceCrs(params: {
  groupName: string;
  sourceCrs: string;
}): Promise<{ ok: true; groupName: string; sourceCrs: string }> {
  const groupName = String(params?.groupName ?? '').trim();
  const sourceCrs = String(params?.sourceCrs ?? '').trim().toUpperCase();
  if (!isSafeOrthoSegment(groupName)) throw new Error('유효하지 않은 그룹명입니다.');
  if (!/^EPSG:\d{4,5}$/.test(sourceCrs)) throw new Error('sourceCrs는 EPSG:XXXX 형식이어야 합니다.');
  const meta = await readOrthoGroupCrsMeta();
  meta[groupName] = sourceCrs;
  await writeOrthoGroupCrsMeta(meta);
  return { ok: true, groupName, sourceCrs };
}

export async function detectOrthophotoGroupCrsCandidates(params: {
  groupName: string;
}): Promise<{ groupName: string; sampleFile: string; candidates: OrthophotoCrsCandidate[] }> {
  const groupName = String(params?.groupName ?? '').trim();
  if (!isSafeOrthoSegment(groupName)) throw new Error('유효하지 않은 그룹명입니다.');
  const { groups } = await listSatelliteTifGroupedUploads();
  const grp = groups.find((g) => g.groupName === groupName);
  if (!grp?.files.length) throw new Error(`그룹 '${groupName}' 에 tif가 없습니다.`);
  const sorted = [...grp.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const sample = sorted[0]!;
  const absSample = resolveSafeRelative(sample.relativePath);
  if (!absSample) throw new Error('샘플 파일 경로가 유효하지 않습니다.');
  const box = await getSourceCornerBoxFromTif(absSample);
  const emd = await getEmdUnionSqlParts();

  const candidates: OrthophotoCrsCandidate[] = [];
  for (const epsg of KOREA_CRS_CANDIDATES) {
    const sourceCrs = `EPSG:${epsg}`;
    const q = await pool.query(
      `
      WITH src AS (
        SELECT
          ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), $5), 5181) AS p1,
          ST_Transform(ST_SetSRID(ST_MakePoint($3, $2), $5), 5181) AS p2,
          ST_Transform(ST_SetSRID(ST_MakePoint($3, $4), $5), 5181) AS p3,
          ST_Transform(ST_SetSRID(ST_MakePoint($1, $4), $5), 5181) AS p4
      ),
      env AS (
        SELECT ST_MakeEnvelope(
          LEAST(ST_X(p1), ST_X(p2), ST_X(p3), ST_X(p4)),
          LEAST(ST_Y(p1), ST_Y(p2), ST_Y(p3), ST_Y(p4)),
          GREATEST(ST_X(p1), ST_X(p2), ST_X(p3), ST_X(p4)),
          GREATEST(ST_Y(p1), ST_Y(p2), ST_Y(p3), ST_Y(p4)),
          5181
        ) AS g
        FROM src
      ),
      emd AS (
        SELECT ${emd.geomExpr} AS g
        FROM "${EMD_SCHEMA}"."${EMD_TABLE}"
      )
      SELECT
        ST_Intersects(env.g, emd.g) AS intersects_emd,
        CASE
          WHEN ST_Area(env.g) <= 0 THEN 0
          ELSE ST_Area(ST_Intersection(env.g, emd.g)) / ST_Area(env.g)
        END AS overlap_ratio,
        ST_AsGeoJSON(ST_Transform(env.g, 4326)) AS preview_geojson,
        ST_XMin(ST_Transform(env.g, 4326)) AS min_lon,
        ST_YMin(ST_Transform(env.g, 4326)) AS min_lat,
        ST_XMax(ST_Transform(env.g, 4326)) AS max_lon,
        ST_YMax(ST_Transform(env.g, 4326)) AS max_lat
      FROM env, emd
      `,
      [box.minX, box.minY, box.maxX, box.maxY, epsg]
    );
    const row = q.rows?.[0] as
      | {
          intersects_emd?: boolean;
          overlap_ratio?: number;
          preview_geojson?: string;
          min_lon?: number;
          min_lat?: number;
          max_lon?: number;
          max_lat?: number;
        }
      | undefined;
    const intersectsEmd = !!row?.intersects_emd;
    const overlapRatio = Number(row?.overlap_ratio ?? 0);
    let previewGeometry: Record<string, unknown> | null = null;
    try {
      previewGeometry = row?.preview_geojson ? (JSON.parse(String(row.preview_geojson)) as Record<string, unknown>) : null;
    } catch {
      previewGeometry = null;
    }
    const bboxWgs84 =
      Number.isFinite(row?.min_lon) &&
      Number.isFinite(row?.min_lat) &&
      Number.isFinite(row?.max_lon) &&
      Number.isFinite(row?.max_lat)
        ? {
            minLon: Number(row!.min_lon),
            minLat: Number(row!.min_lat),
            maxLon: Number(row!.max_lon),
            maxLat: Number(row!.max_lat),
          }
        : null;
    if (intersectsEmd) {
      candidates.push({ epsg, sourceCrs, intersectsEmd, overlapRatio, bboxWgs84, previewGeometry });
    }
  }
  candidates.sort((a, b) => b.overlapRatio - a.overlapRatio);
  return { groupName, sampleFile: sample.relativePath, candidates };
}

/**
 * 샘플 GeoTIFF를 가정 원본 CRS로 EPSG:3857에 맞춘 뒤 저해상도 이미지로 저장 (좌표계 선택 모달 미리보기).
 * 캐시: 원본 샘플보다 최신이면 재사용합니다.
 */
export type OrthophotoCrsPreviewOk = {
  ok: true;
  imagePath: string;
  contentType: 'image/png' | 'image/jpeg';
  /** 워프 미리보기 이미지가 덮는 범위 (EPSG:3857, 미터) — ol/ImageStatic.imageExtent */
  extent3857: [number, number, number, number];
};

export async function ensureOrthophotoCrsPreviewImage(params: {
  groupName: string;
  epsg: number;
}): Promise<OrthophotoCrsPreviewOk | { ok: false; error: string }> {
  const groupName = String(params?.groupName ?? '').trim();
  const epsg = Math.floor(Number(params?.epsg));
  if (!isSafeOrthoSegment(groupName)) return { ok: false, error: '유효하지 않은 그룹명입니다.' };
  if (!KOREA_CRS_CANDIDATES.includes(epsg)) return { ok: false, error: '허용되지 않은 좌표계입니다.' };

  await ensureBaseStructure();
  const base = getBaseDir();
  const { groups } = await listSatelliteTifGroupedUploads();
  const grp = groups.find((g) => g.groupName === groupName);
  if (!grp?.files.length) return { ok: false, error: `그룹 '${groupName}' 에 tif가 없습니다.` };
  const sorted = [...grp.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const sample = sorted[0]!;
  const absSample = resolveSafeRelative(sample.relativePath);
  if (!absSample) return { ok: false, error: '샘플 파일 경로가 유효하지 않습니다.' };

  let sampleStat: fs.Stats;
  try {
    sampleStat = await fsPromises.stat(absSample);
  } catch {
    return { ok: false, error: '샘플 파일을 읽을 수 없습니다.' };
  }

  const previewDir = path.join(base, ORTHO_CRS_PREVIEW_SUBDIR);
  await fsPromises.mkdir(previewDir, { recursive: true });
  const pngPath = path.join(previewDir, `${groupName}_${epsg}.png`);
  const jpgPath = path.join(previewDir, `${groupName}_${epsg}.jpg`);
  const extentPath = path.join(previewDir, `${groupName}_${epsg}_extent.json`);

  const readCachedExtent = async (): Promise<[number, number, number, number] | null> => {
    try {
      const raw = await fsPromises.readFile(extentPath, 'utf8');
      const j = JSON.parse(raw) as { extent3857?: unknown };
      const e = j.extent3857;
      if (Array.isArray(e) && e.length === 4 && e.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        return [e[0]!, e[1]!, e[2]!, e[3]!];
      }
    } catch {
      /* no extent file */
    }
    return null;
  };

  const pngStat = await fsPromises.stat(pngPath).catch(() => null);
  if (pngStat && pngStat.mtimeMs >= sampleStat.mtimeMs) {
    const ext = await readCachedExtent();
    if (ext) return { ok: true, imagePath: pngPath, contentType: 'image/png', extent3857: ext };
    await fsPromises.rm(pngPath, { force: true }).catch(() => {});
  }
  const jpgStat = await fsPromises.stat(jpgPath).catch(() => null);
  if (jpgStat && jpgStat.mtimeMs >= sampleStat.mtimeMs) {
    const ext = await readCachedExtent();
    if (ext) return { ok: true, imagePath: jpgPath, contentType: 'image/jpeg', extent3857: ext };
    await fsPromises.rm(jpgPath, { force: true }).catch(() => {});
  }

  const gdalwarp = gdalToolPath('gdalwarp');
  const gdalTranslate = gdalToolPath('gdal_translate');
  if (!isConcreteToolPath(gdalwarp) || !opaqueExists(gdalwarp)) {
    return { ok: false, error: 'gdalwarp 를 찾을 수 없습니다.' };
  }
  if (!isConcreteToolPath(gdalTranslate) || !opaqueExists(gdalTranslate)) {
    return { ok: false, error: 'gdal_translate 를 찾을 수 없습니다.' };
  }

  const warpPath = path.join(previewDir, `_warp_${groupName}_${epsg}_${Date.now()}.tif`);
  const sourceCrs = `EPSG:${epsg}`;
  const warpArgs: string[] = [
    '-overwrite',
    '-s_srs',
    sourceCrs,
    '-t_srs',
    'EPSG:3857',
    '-ts',
    String(ORTHO_CRS_PREVIEW_MAX_DIM),
    '0',
    '-r',
    'bilinear',
    '-of',
    'GTiff',
    '-co',
    'BIGTIFF=IF_SAFER',
    absSample,
    warpPath,
  ];

  const gdalEnv = buildGdalChildEnv(gdalwarp);
  const sampleBase = path.basename(absSample);
  const w = await runProcess(gdalwarp, warpArgs, base, ORTHO_CRS_PREVIEW_TIMEOUT_MS, gdalEnv);
  if (w.stdout.trim()) console.info(`[orthophoto] preview gdalwarp stdout group=${groupName} epsg=${epsg}\n${w.stdout}`);
  if (w.stderr.trim()) console.error(`[orthophoto] preview gdalwarp stderr group=${groupName} epsg=${epsg}\n${w.stderr}`);
  if (w.code !== 0) {
    await fsPromises.rm(warpPath, { force: true }).catch(() => {});
    return {
      ok: false,
      error: `미리보기 워프 실패(code=${w.code}): ${w.stderr.slice(-800)}`,
    };
  }

  let extent3857: [number, number, number, number];
  try {
    const box = await getSourceCornerBoxFromTif(warpPath);
    extent3857 = [box.minX, box.minY, box.maxX, box.maxY];
  } catch (e) {
    await fsPromises.rm(warpPath, { force: true }).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `워프 결과 범위를 읽을 수 없습니다: ${msg}` };
  }

  const writeExtentFile = async () => {
    await fsPromises.writeFile(extentPath, JSON.stringify({ extent3857 }), 'utf8');
  };

  const trEnv = buildGdalChildEnv(gdalTranslate);
  const tryPng = await runProcess(
    gdalTranslate,
    ['-of', 'PNG', '-ot', 'Byte', warpPath, pngPath],
    base,
    ORTHO_CRS_PREVIEW_TIMEOUT_MS,
    trEnv
  );
  if (tryPng.stdout.trim()) console.info(`[orthophoto] preview translate png stdout ${sampleBase}\n${tryPng.stdout}`);
  if (tryPng.stderr.trim()) console.error(`[orthophoto] preview translate png stderr ${sampleBase}\n${tryPng.stderr}`);

  if (tryPng.code === 0) {
    try {
      await fsPromises.access(pngPath);
      await writeExtentFile();
      await fsPromises.rm(warpPath, { force: true }).catch(() => {});
      return { ok: true, imagePath: pngPath, contentType: 'image/png', extent3857 };
    } catch {
      /* jpeg 시도 */
    }
  }

  const tryJpg = await runProcess(
    gdalTranslate,
    ['-of', 'JPEG', '-co', 'QUALITY=85', '-ot', 'Byte', warpPath, jpgPath],
    base,
    ORTHO_CRS_PREVIEW_TIMEOUT_MS,
    trEnv
  );
  await fsPromises.rm(warpPath, { force: true }).catch(() => {});
  if (tryJpg.stdout.trim()) console.info(`[orthophoto] preview translate jpeg stdout ${sampleBase}\n${tryJpg.stdout}`);
  if (tryJpg.stderr.trim()) console.error(`[orthophoto] preview translate jpeg stderr ${sampleBase}\n${tryJpg.stderr}`);

  if (tryJpg.code !== 0) {
    return {
      ok: false,
      error: `미리보기 이미지 변환 실패(PNG/JPEG): ${tryJpg.stderr.slice(-600)}`,
    };
  }
  try {
    await fsPromises.access(jpgPath);
    await writeExtentFile();
    return { ok: true, imagePath: jpgPath, contentType: 'image/jpeg', extent3857 };
  } catch {
    return { ok: false, error: '미리보기 JPEG 파일을 확인할 수 없습니다.' };
  }
}

/** 하위 폴더에 숫자 이름(zoom)이 있으면 타일 세트 루트로 간주 */
async function dirLooksLikeTileRoot(dirAbs: string): Promise<boolean> {
  try {
    const names = await fsPromises.readdir(dirAbs);
    return names.some((n) => /^\d+$/.test(n));
  } catch {
    return false;
  }
}

export async function listOrthophotoTileOutputs(): Promise<OrthophotoTileOutputsResult> {
  await ensureBaseStructure();
  const base = getBaseDir();
  const tilesRoot = path.join(base, 'tiles_jpg');
  const groups: OrthophotoTileOutputsResult['groups'] = [];
  const legacyTileSetIds: string[] = [];
  let top: fs.Dirent[];
  try {
    top = await fsPromises.readdir(tilesRoot, { withFileTypes: true });
  } catch {
    return { groups: [], legacyTileSetIds: [] };
  }
  for (const e of top) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const p = path.join(tilesRoot, name);
    const isTileSetDirect = await dirLooksLikeTileRoot(p);
    if (isTileSetDirect) {
      legacyTileSetIds.push(name);
      continue;
    }
    if (!isSafeOrthoSegment(name)) continue;
    let subs: fs.Dirent[];
    try {
      subs = await fsPromises.readdir(p, { withFileTypes: true });
    } catch {
      continue;
    }
    const tileSetIds: string[] = [];
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      if (!isSafeOrthoSegment(s.name)) continue;
      const sp = path.join(p, s.name);
      if (await dirLooksLikeTileRoot(sp)) tileSetIds.push(s.name);
    }
    if (tileSetIds.length) {
      tileSetIds.sort((a, b) => a.localeCompare(b));
      groups.push({ groupName: name, tileSetIds });
    }
  }
  groups.sort((a, b) => a.groupName.localeCompare(b.groupName));
  legacyTileSetIds.sort((a, b) => a.localeCompare(b));
  return { groups, legacyTileSetIds };
}

/**
 * 배경지도 UI id(tileSetId)에 해당하는 그룹 폴더 탐색.
 * - 레거시(평면)면 group 빈 문자열.
 * - 신규 산출은 `…/그룹/{outputSlug}/z/…` 이라 UI id와 폴더명이 다를 수 있음 → 보통 미매칭(null).
 *   맵 타일 URL은 브라우저 LS(`ggnr_ortho_tileset_group` + `ggnr_ortho_tileset_output_slug`)를 씁니다.
 */
export async function resolveOrthoGroupForTileset(params: {
  tileSetId: string;
}): Promise<{ group: string | null }> {
  await ensureBaseStructure();
  const tileSetId = params.tileSetId.trim();
  if (!isSafeOrthoSegment(tileSetId)) return { group: null };
  const { groups, legacyTileSetIds } = await listOrthophotoTileOutputs();
  if (legacyTileSetIds.includes(tileSetId)) return { group: '' };
  const hits: string[] = [];
  for (const g of groups) {
    if (g.tileSetIds.includes(tileSetId)) hits.push(g.groupName);
  }
  if (hits.length === 0) return { group: null };
  hits.sort((a, b) => a.localeCompare(b));
  return { group: hits[0] ?? null };
}

/** 루트 목록 (빈 폴더 등) 호환용 — 필요 시 유지 */
export async function listSatelliteTifUploads(): Promise<ListDirectoryResult> {
  await ensureBaseStructure();
  return listDirectory({ relativePath: 'tiles_tif' });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 서버 콘솔용 정사영상 변환 단계 로그 */
function orthoJobLog(
  ctx: { groupName: string; outputSlug: string; sourceFile: string; tileSetUi?: string },
  phase: string,
  detail?: string
): void {
  const ui = ctx.tileSetUi ? ` uiTileSet=${ctx.tileSetUi}` : '';
  const head = `[orthophoto] group=${ctx.groupName} out=${ctx.outputSlug} file=${ctx.sourceFile}${ui}`;
  const body = detail ? ` | ${phase}: ${detail}` : ` | ${phase}`;
  console.info(`${head}${body}`);
}

function logProcessStreams(
  ctx: { groupName: string; outputSlug: string; sourceFile: string; tileSetUi?: string },
  phase: string,
  output: { stdout: string; stderr: string }
): void {
  if (output.stdout.trim()) {
    console.info(
      `[orthophoto][${phase}] group=${ctx.groupName} out=${ctx.outputSlug} file=${ctx.sourceFile} stdout\n${output.stdout}`
    );
  }
  if (output.stderr.trim()) {
    console.error(
      `[orthophoto][${phase}] group=${ctx.groupName} out=${ctx.outputSlug} file=${ctx.sourceFile} stderr\n${output.stderr}`
    );
  }
}

async function runOrthophotoJob(params: {
  absSource: string;
  sourceRelativePath: string;
  sourceBaseName: string;
  groupName: string;
  sourceCrs: string;
  tileSetId: string;
  zoomMin: number;
  zoomMax: number;
  jpegQuality: number;
  /** VRT 등 sourceRelativePath 가 합성일 때 출력 슬러그 강제(그 외에는 경로에서 계산) */
  outputSlugOverride?: string;
  /**
   * 지정 시 tiles_jpg 가 아닌 이 상대 경로에 XYZ 타일을 기록.
   * (드론영상 aerial/ortho/.../xyz/... — 자체항공영상 목록과 분리)
   */
  finalOutputDirRel?: string;
  /**
   * JPEG는 알파 없음 → 투명 영역이 검정으로 보임.
   * 드론영상 오버레이는 PNG(알파 유지) 권장.
   */
  tileDriver?: 'JPEG' | 'PNG';
}): Promise<void> {
  const {
    absSource,
    sourceRelativePath,
    sourceBaseName,
    groupName,
    sourceCrs,
    tileSetId,
    zoomMin,
    zoomMax,
    jpegQuality,
    outputSlugOverride,
    finalOutputDirRel,
    tileDriver = 'JPEG',
  } = params;
  let gFromPath: string;
  let outputSlug: string;
  const customOut = (finalOutputDirRel ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (customOut) {
    if (customOut.includes('..') || !customOut.startsWith('aerial/ortho/')) {
      throw new Error('finalOutputDirRel 은 aerial/ortho/ 아래여야 합니다.');
    }
    gFromPath = groupName;
    outputSlug = outputSlugOverride && isSafeOrthoSegment(outputSlugOverride) ? outputSlugOverride : 'xyz';
  } else if (outputSlugOverride && isSafeOrthoSegment(outputSlugOverride)) {
    gFromPath = groupName;
    outputSlug = outputSlugOverride;
  } else {
    const c = computeOrthoOutputSlugFromSourceRelativePath(sourceRelativePath);
    gFromPath = c.groupName;
    outputSlug = c.outputSlug;
    if (gFromPath !== groupName) {
      console.warn(
        `[orthophoto] 경로 그룹(${gFromPath})과 인자 groupName(${groupName}) 불일치 — 경로 기준으로 출력합니다.`
      );
    }
  }
  const base = getBaseDir();
  const atStart = new Date().toISOString();
  const finalRel = customOut || orthoOutputRel(gFromPath, outputSlug);
  const fmtNote = `jpeg q=${jpegQuality} z=${zoomMin}-${zoomMax}`;
  await appendUploadConvertHistory({
    at: atStart,
    kind: 'convert_orthophoto_xyz',
    sourceFile: sourceBaseName,
    pathOrResult: finalRel,
    status: '변환 중',
    note: `group=${gFromPath} out=${outputSlug} uiTileSet=${tileSetId} ${fmtNote}`,
  }).catch((e) => console.error('[orthophotoService] history start:', e));

  const gdalwarp = gdalToolPath('gdalwarp');
  const gdal2tilesInvoke = resolveGdal2TilesInvoke();

  const logCtx = { groupName: gFromPath, outputSlug, sourceFile: sourceBaseName, tileSetUi: tileSetId };

  const fail = async (note: string, cleanupRoot?: string) => {
    setOrthoPhase(groupName, 'failed', 0, note.slice(0, 200));
    console.error(
      `[orthophoto] FAIL group=${gFromPath} out=${outputSlug} file=${sourceBaseName} | ${note.slice(0, 800)}`
    );
    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: 'convert_orthophoto_xyz',
      sourceFile: sourceBaseName,
      pathOrResult: sourceRelativePath,
      status: '실패',
      note: note.slice(0, 500),
    }).catch((e) => console.error('[orthophotoService] history fail:', e));
    if (cleanupRoot) {
      await fsPromises.rm(cleanupRoot, { recursive: true, force: true }).catch(() => {});
    }
  };

  if (!isConcreteToolPath(gdalwarp) || !opaqueExists(gdalwarp)) {
    const hint =
      'GDAL gdalwarp 실행 파일을 찾을 수 없습니다. conda 환경에 gdal 설치 또는 GGNR_GDAL_SCRIPTS_DIR 를 확인하세요.';
    console.error(`[orthophoto] ${hint} (resolve 결과: gdalwarp=${gdalwarp})`);
    await fail(hint);
    return;
  }
  if (!isConcreteToolPath(gdal2tilesInvoke.cmd) || !opaqueExists(gdal2tilesInvoke.cmd)) {
    const hint =
      'gdal2tiles 실행용 Python을 찾을 수 없습니다. GGNR_PIPELINE_PYTHON 또는 python/env 를 확인하세요.';
    console.error(`[orthophoto] ${hint} (resolve 결과: ${gdal2tilesInvoke.label})`);
    await fail(hint);
    return;
  }
  orthoJobLog(logCtx, 'GDAL 경로 확인', `gdalwarp=${gdalwarp} gdal2tiles=${gdal2tilesInvoke.label}`);
  const gdalChildEnv = buildGdalChildEnv(gdalwarp);
  if (gdalChildEnv.PROJ_LIB) {
    orthoJobLog(logCtx, 'GDAL/PROJ 환경', `PROJ_LIB=${gdalChildEnv.PROJ_LIB}${gdalChildEnv.GDAL_DATA ? ` GDAL_DATA=${gdalChildEnv.GDAL_DATA}` : ''}`);
  }

  const workBase = getOrthoDataWorkDir();
  const finalAbs = customOut
    ? path.join(base, ...customOut.split('/').filter(Boolean))
    : path.join(base, 'tiles_jpg', gFromPath);

  orthoJobLog(
    logCtx,
    '작업 시작',
    `src=${sourceRelativePath}(${sourceCrs}) → ${finalRel} z=${zoomMin}-${zoomMax} ${tileDriver}${
      tileDriver === 'JPEG' ? ` q=${jpegQuality}` : ''
    } (EPSG:3857 타일) work=${workBase}`
  );

  const tmpRoot = path.join(workBase, `ortho_xyz_${gFromPath}_${outputSlug}_${Date.now()}`);
  const warp3857 = path.join(tmpRoot, 'warp_3857.tif');
  const tilesStaging = path.join(tmpRoot, 'tiles_staging');
  let tileProgressTimer: ReturnType<typeof setInterval> | null = null;
  const stopTileProgressPoll = () => {
    if (tileProgressTimer) {
      clearInterval(tileProgressTimer);
      tileProgressTimer = null;
    }
  };
  const startTileProgressPoll = (dir: string, label: '타일링' | '복사') => {
    stopTileProgressPoll();
    updateOrthoTileCountProgress(groupName, dir, label, true);
    tileProgressTimer = setInterval(() => {
      updateOrthoTileCountProgress(groupName, dir, label, true);
    }, 15_000);
  };

  try {
    orthoJobLog(logCtx, '임시 폴더 생성', tmpRoot);

    await fsPromises.mkdir(tmpRoot, { recursive: true });
    await fsPromises.mkdir(tilesStaging, { recursive: true });

    const warpArgs: string[] = [
      '-overwrite',
      '-of',
      'GTiff',
      '-s_srs',
      sourceCrs,
      '-t_srs',
      'EPSG:3857',
      '-r',
      'bilinear',
      '-multi',
      '-wo',
      'NUM_THREADS=ALL_CPUS',
      '-co',
      'BIGTIFF=YES',
      absSource,
      warp3857,
    ];
    setOrthoPhase(groupName, 'warp', 0, '좌표 변환 중');
    orthoJobLog(logCtx, '1/3 gdalwarp 시작', `${gdalwarp} ${sourceCrs} -> EPSG:3857`);
    const warpStarted = Date.now();
    const w = await runProcess(gdalwarp, warpArgs, base, ORTHO_ACTIVITY_TIMEOUT_MS, gdalChildEnv, {
      activityTimeoutMs: ORTHO_ACTIVITY_TIMEOUT_MS,
      activityWatchPath: warp3857,
      onStdout: (chunk) => updateOrthoJobProgress(groupName, chunk),
      onActivity: () => touchOrthoJobActivity(groupName, '좌표 변환 중 (파일 기록)'),
    });
    const warpMs = Date.now() - warpStarted;
    logProcessStreams(logCtx, 'gdalwarp', w);
    if (w.code !== 0) {
      orthoJobLog(logCtx, '1/3 gdalwarp 실패', `code=${w.code} ${warpMs}ms stderr_tail=${w.stderr.slice(-400).replace(/\s+/g, ' ')}`);
      await fail(`gdalwarp 실패 code=${w.code}\n${w.stderr.slice(-2000)}`, tmpRoot);
      return;
    }
    orthoJobLog(logCtx, '1/3 gdalwarp 완료', `${warpMs}ms -> ${warp3857}`);

    try {
      const box = await getSourceCornerBoxFromTif(warp3857);
      const expected = estimateMercatorTileCount(box.minX, box.minY, box.maxX, box.maxY, zoomMin, zoomMax);
      setOrthoTilesExpected(groupName, expected);
      orthoJobLog(logCtx, '예상 타일 장수', `${expected.toLocaleString('ko-KR')} (z=${zoomMin}-${zoomMax}, tilesize=${ORTHO_TILE_SIZE})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[orthophoto] 예상 타일 장수 산출 실패: ${msg}`);
    }

    setOrthoPhase(groupName, 'tiles', 0, '타일링 시작');

    const zArg = `${zoomMin}-${zoomMax}`;
    const tileArgs: string[] = [
      '--profile=mercator',
      '--xyz',
      '--tilesize=512',
      `--zoom=${zArg}`,
      '--webviewer=none',
      `--tiledriver=${tileDriver}`,
      ...(tileDriver === 'JPEG' ? [`--jpeg-quality=${String(jpegQuality)}`] : []),
      '--processes=4',
      warp3857,
      tilesStaging,
    ];
    orthoJobLog(
      logCtx,
      '2/3 gdal2tiles 시작',
      `${gdal2tilesInvoke.label} profile=mercator ${tileDriver.toLowerCase()} zoom=${zArg} → ${tilesStaging}`
    );
    startTileProgressPoll(tilesStaging, '타일링');
    const tileStarted = Date.now();
    const t = await runProcess(
      gdal2tilesInvoke.cmd,
      [...gdal2tilesInvoke.argsPrefix, ...tileArgs],
      base,
      ORTHO_ACTIVITY_TIMEOUT_MS,
      gdalChildEnv,
      {
        activityTimeoutMs: ORTHO_ACTIVITY_TIMEOUT_MS,
        activityWatchPath: tilesStaging,
        onStdout: (chunk) => {
          updateOrthoJobProgress(groupName, chunk);
        },
        onActivity: () => {
          updateOrthoTileCountProgress(groupName, tilesStaging, '타일링');
        },
      }
    );
    stopTileProgressPoll();
    updateOrthoTileCountProgress(groupName, tilesStaging, '타일링', true);
    const tileMs = Date.now() - tileStarted;
    logProcessStreams(logCtx, 'gdal2tiles', t);
    const tileFailHint = `${t.stderr}\n${t.stdout}`;
    if (t.code !== 0 || tileFailHint.toLowerCase().includes('failed to create process')) {
      orthoJobLog(logCtx, '2/3 gdal2tiles 실패', `code=${t.code} ${tileMs}ms stderr_tail=${t.stderr.slice(-400).replace(/\s+/g, ' ')}`);
      await fail(`gdal2tiles 실패 code=${t.code}\n${t.stderr.slice(-2000) || t.stdout.slice(-2000)}`, tmpRoot);
      return;
    }
    orthoJobLog(logCtx, '2/3 gdal2tiles 완료', `${tileMs}ms`);

    setOrthoPhase(groupName, 'copy', 0, '결과 복사 중');
    orthoJobLog(logCtx, '3/3 결과 복사 시작', `${tilesStaging} → ${finalAbs}`);
    startTileProgressPoll(finalAbs, '복사');
    const copyStarted = Date.now();
    await fsPromises.mkdir(path.dirname(finalAbs), { recursive: true });
    await fsPromises.rm(finalAbs, { recursive: true, force: true }).catch(() => {});
    await fsPromises.cp(tilesStaging, finalAbs, { recursive: true });
    stopTileProgressPoll();
    updateOrthoTileCountProgress(groupName, finalAbs, '복사', true);
    orthoJobLog(logCtx, '3/3 결과 복사 완료', `${Date.now() - copyStarted}ms → ${finalRel}`);

    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: 'convert_orthophoto_xyz',
      sourceFile: sourceBaseName,
      pathOrResult: finalRel,
      status: '완료',
    }).catch((e) => console.error('[orthophotoService] history ok:', e));
    setOrthoPhase(groupName, 'done', 100, '완료');
    const doneEntry = orthoJobProgressMap.get(groupName);
    if (doneEntry) {
      doneEntry.tilesCreated = doneEntry.tilesExpected ?? doneEntry.tilesCreated;
      doneEntry.etaSeconds = null;
      doneEntry.message = doneEntry.tilesExpected
        ? `완료 ${formatTileCount(doneEntry.tilesExpected)}장`
        : '완료';
    }
    orthoJobLog(logCtx, '작업 전체 완료', finalRel);
    await fsPromises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    orthoJobLog(logCtx, '임시 폴더 정리', tmpRoot);
  } catch (e) {
    stopTileProgressPoll();
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[orthophoto] EXCEPTION group=${gFromPath} out=${outputSlug} | ${msg}`);
    await fail(msg, tmpRoot);
  } finally {
    stopTileProgressPoll();
  }
}

/** 그룹 내 GeoTIFF를 VRT 합성 후 한 번에 타일링(원본 좌표계 그대로 raster JPEG). */
export async function runSatelliteTifGroupToXyz(params: {
  groupName: string;
  tileSetId: string;
  sourceCrs?: string;
  zoomMin?: number;
  zoomMax?: number;
  jpegQuality?: number;
}): Promise<{ started: boolean; message: string; fileCount: number; outputSlug: string }> {
  const prepared = await prepareSatelliteTifGroupConversion(params);
  setOrthoPhase(prepared.groupName, 'queued', 0, '대기 중');
  setImmediate(() => {
    void executeSatelliteTifGroupConversion(prepared).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[orthophoto] 그룹 변환 예외 group=${prepared.groupName}`, e);
      setOrthoPhase(prepared.groupName, 'failed', 0, msg.slice(0, 200));
    });
  });
  const outRel = orthoOutputRel(prepared.groupName, prepared.groupOutputSlug);
  return {
    started: true,
    fileCount: prepared.sorted.length,
    outputSlug: prepared.groupOutputSlug,
    message: `그룹 ${prepared.groupName}: ${prepared.sorted.length}개 원본→${prepared.sorted.length > 1 ? 'VRT 합본 후 ' : ''}XYZ JPEG(q${prepared.jpegQuality}) 변환을 시작했습니다. (srcCrs=${prepared.sourceCrs}, UI tileSet=${prepared.tileSetId}, z=${prepared.zoomMin}-${prepared.zoomMax}) → ${outRel}.`,
  };
}

/**
 * CLI/배치용 — 그룹 변환이 끝날 때까지 await (dev 서버와 별도 프로세스에서 사용).
 */
export async function runSatelliteTifGroupToXyzAndWait(params: {
  groupName: string;
  tileSetId: string;
  sourceCrs?: string;
  zoomMin?: number;
  zoomMax?: number;
  jpegQuality?: number;
}): Promise<{
  ok: boolean;
  phase: OrthoJobPhase;
  message: string;
  fileCount: number;
  outputSlug: string;
}> {
  const prepared = await prepareSatelliteTifGroupConversion(params);
  setOrthoPhase(prepared.groupName, 'queued', 0, '대기 중');
  try {
    await executeSatelliteTifGroupConversion(prepared);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[orthophoto] 그룹 변환 예외 group=${prepared.groupName}`, e);
    setOrthoPhase(prepared.groupName, 'failed', 0, msg.slice(0, 200));
  }
  const prog = getOrthoJobProgress({ groupName: prepared.groupName });
  const entry = prog && !Array.isArray(prog) ? prog : null;
  const phase: OrthoJobPhase = entry?.phase ?? 'failed';
  return {
    ok: phase === 'done',
    phase,
    message: entry?.message ?? '',
    fileCount: prepared.sorted.length,
    outputSlug: prepared.groupOutputSlug,
  };
}

type PreparedSatelliteGroupConversion = {
  groupName: string;
  tileSetId: string;
  sourceCrs: string;
  zoomMin: number;
  zoomMax: number;
  jpegQuality: number;
  groupOutputSlug: string;
  sorted: SatelliteTifGroupedFile[];
};

async function prepareSatelliteTifGroupConversion(params: {
  groupName: string;
  tileSetId: string;
  sourceCrs?: string;
  zoomMin?: number;
  zoomMax?: number;
  jpegQuality?: number;
}): Promise<PreparedSatelliteGroupConversion> {
  await ensureBaseStructure();
  const groupName = params.groupName.trim();
  const tileSetId = params.tileSetId.trim();
  if (!isSafeOrthoSegment(groupName)) {
    throw new Error('그룹명은 영문·숫자·하이픈(-)·밑줄(_)만 사용할 수 있습니다.');
  }
  if (!isSafeOrthoSegment(tileSetId)) {
    throw new Error('tileSetId는 영문·숫자·하이픈(-)·밑줄(_)만 사용할 수 있습니다.');
  }
  const sourceCrsRaw = String(params?.sourceCrs ?? '').trim().toUpperCase();
  const sourceCrs = sourceCrsRaw || (await resolveGroupSourceCrs(groupName)) || '';
  if (!/^EPSG:\d{4,5}$/.test(sourceCrs)) {
    throw new Error(
      `그룹 '${groupName}' 의 원본 좌표계를 찾을 수 없습니다. 좌표계 선택 후 다시 시도하세요.`
    );
  }
  const { groups } = await listSatelliteTifGroupedUploads();
  const grp = groups.find((g) => g.groupName === groupName);
  if (!grp?.files.length) {
    throw new Error(`그룹 '${groupName}' 에 변환할 tif가 없습니다.`);
  }

  const sorted = [...grp.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const { outputSlug: groupOutputSlug, groupName: slugPathGroup } = computeOrthoOutputSlugFromSourceRelativePath(
    sorted[0]!.relativePath
  );
  if (slugPathGroup !== groupName) {
    throw new Error('그룹 내 파일 경로가 요청 그룹과 일치하지 않습니다.');
  }
  const zoomMin = clamp(Math.floor(params.zoomMin ?? 6), 0, 22);
  const zoomMax = clamp(Math.floor(params.zoomMax ?? 19), zoomMin, 22);
  const jpegQuality = clamp(Math.floor(params.jpegQuality ?? 80), 1, 100);

  console.info(
    `[orthophoto] 큐 등록 그룹 전체: [그룹 ${groupName}] ${sorted.length}개 파일 → ${tileSetId} z=${zoomMin}-${zoomMax}`
  );

  return {
    groupName,
    tileSetId,
    sourceCrs,
    zoomMin,
    zoomMax,
    jpegQuality,
    groupOutputSlug,
    sorted,
  };
}

async function executeSatelliteTifGroupConversion(prepared: PreparedSatelliteGroupConversion): Promise<void> {
  const {
    groupName,
    tileSetId,
    sourceCrs,
    zoomMin,
    zoomMax,
    jpegQuality,
    groupOutputSlug,
    sorted,
  } = prepared;
  const base = getBaseDir();
  const absPaths = sorted.map((f) => resolveSafeRelative(f.relativePath)).filter((x): x is string => !!x);

  const runSingle = async (absSrc: string, rel: string, baseName: string) => {
    await runOrthophotoJob({
      absSource: absSrc,
      sourceRelativePath: rel,
      sourceBaseName: baseName,
      groupName,
      sourceCrs,
      tileSetId,
      zoomMin,
      zoomMax,
      jpegQuality,
    });
  };

  if (absPaths.length === 1) {
    await runSingle(absPaths[0]!, sorted[0]!.relativePath, path.basename(sorted[0]!.relativePath));
    return;
  }

  const bundleDir = path.join(getOrthoDataWorkDir(), `ortho_group_${groupName}_${groupOutputSlug}_${Date.now()}`);
  let vrtPath = '';
  try {
    await fsPromises.mkdir(bundleDir, { recursive: true });
    vrtPath = path.join(bundleDir, 'mosaic.vrt');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[orthophoto] 그룹 VRT 폴더 생성 실패: ${bundleDir}`, e);
    setOrthoPhase(groupName, 'failed', 0, `VRT 폴더 생성 실패: ${msg.slice(0, 120)}`);
    return;
  }
  if (!vrtPath) {
    setOrthoPhase(groupName, 'failed', 0, 'VRT 작업 경로를 만들 수 없습니다.');
    return;
  }

  const gdalbuildvrt = gdalToolPath('gdalbuildvrt');

  if (!isConcreteToolPath(gdalbuildvrt) || !opaqueExists(gdalbuildvrt)) {
    console.error('[orthophoto] gdalbuildvrt 를 찾을 수 없습니다. GDAL 설치 경로를 확인하세요.', gdalbuildvrt);
    setOrthoPhase(groupName, 'failed', 0, 'gdalbuildvrt 를 찾을 수 없습니다.');
    return;
  }

  const gbEnv = buildGdalChildEnv(gdalbuildvrt);
  const gbArgs: string[] = ['-overwrite', '-allow_projection_difference', vrtPath, ...absPaths];
  setOrthoPhase(groupName, 'vrt', 0, 'VRT 합본 중');
  orthoJobLog(
    { groupName, outputSlug: groupOutputSlug, sourceFile: 'mosaic.vrt', tileSetUi: tileSetId },
    '0/3 gdalbuildvrt 시작',
    gdalbuildvrt
  );
  const gb = await runProcess(gdalbuildvrt, gbArgs, base, ORTHO_ACTIVITY_TIMEOUT_MS, gbEnv, {
    activityTimeoutMs: ORTHO_ACTIVITY_TIMEOUT_MS,
    onStdout: (chunk) => updateOrthoJobProgress(groupName, chunk),
  });
  logProcessStreams(
    { groupName, outputSlug: groupOutputSlug, sourceFile: 'mosaic.vrt', tileSetUi: tileSetId },
    'gdalbuildvrt',
    gb
  );
  if (gb.code !== 0) {
    console.error(
      `[orthophoto] gdalbuildvrt 실패 group=${groupName} code=${gb.code}`,
      gb.stderr.slice(-1500)
    );
    await fsPromises.rm(bundleDir, { recursive: true, force: true }).catch(() => {});
    setOrthoPhase(groupName, 'failed', 0, `VRT 합본 실패 code=${gb.code}`);
    return;
  }
  orthoJobLog(
    { groupName, outputSlug: groupOutputSlug, sourceFile: 'mosaic.vrt', tileSetUi: tileSetId },
    '0/3 gdalbuildvrt 완료',
    vrtPath
  );

  const syntheticRel = `tiles_tif/${groupName}/(mosaic_${sorted.length}files.vrt)`;
  try {
    await runOrthophotoJob({
      absSource: vrtPath,
      sourceRelativePath: syntheticRel,
      sourceBaseName: `mosaic_${sorted.length}files.vrt`,
      groupName,
      sourceCrs,
      tileSetId,
      zoomMin,
      zoomMax,
      jpegQuality,
      outputSlugOverride: groupOutputSlug,
    });
  } finally {
    await fsPromises.rm(bundleDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 정사영상 그룹의 WGS84(경위도) bbox.
 * - tilemapresource.xml(있으면) 의 mercator BoundingBox 우선
 * - 없으면 가장 작은 zoom 폴더의 x/y 인덱스 범위로 mercator extent 산출 후 4326 변환
 */
export type OrthoTileSetExtentSource = 'tilemapresource' | 'pyramid' | 'none';
export type OrthoTileSetExtentWgs84 = {
  groupName: string;
  minLon: number | null;
  maxLon: number | null;
  minLat: number | null;
  maxLat: number | null;
  source: OrthoTileSetExtentSource;
  zoomUsed?: number;
  error?: string;
};

const WEBMERCATOR_HALF = 20037508.342789244;

function mercatorToLonLat(mx: number, my: number): { lon: number; lat: number } {
  const lon = (mx / WEBMERCATOR_HALF) * 180;
  const ly = (my / WEBMERCATOR_HALF) * 180;
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((ly * Math.PI) / 180)) - Math.PI / 2);
  return { lon, lat };
}

function tileXyzToMercatorExtent(z: number, x: number, y: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const n = 2 ** z;
  const res = (WEBMERCATOR_HALF * 2) / n;
  const minX = -WEBMERCATOR_HALF + x * res;
  const maxX = minX + res;
  const maxY = WEBMERCATOR_HALF - y * res;
  const minY = maxY - res;
  return { minX, minY, maxX, maxY };
}

function parseTilemapresourceBoundingBox(xml: string): { minx: number; maxx: number; miny: number; maxy: number } | null {
  const m = xml.match(/<BoundingBox\s+([^>]+?)\/?>/i);
  if (!m) return null;
  const attrs = m[1] ?? '';
  const grab = (name: string) => {
    const r = new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i').exec(attrs);
    return r ? Number(r[1]) : NaN;
  };
  const minx = grab('minx');
  const maxx = grab('maxx');
  const miny = grab('miny');
  const maxy = grab('maxy');
  if (![minx, maxx, miny, maxy].every(Number.isFinite)) return null;
  return { minx, maxx, miny, maxy };
}

/**
 * `--xyz` profile=mercator 산출은 tilemapresource.xml 의 BoundingBox 가 mercator(EPSG:3857) 단위.
 * profile=raster(원본 CRS) 케이스는 좌표가 mercator 가 아니므로 본 함수에서 변환하지 못해 폴리미드 폴백/에러로 둠.
 */
async function readTilemapresourceWgs84(groupDir: string): Promise<OrthoTileSetExtentWgs84 | null> {
  const xmlPath = path.join(groupDir, 'tilemapresource.xml');
  let xml: string;
  try {
    xml = await fsPromises.readFile(xmlPath, 'utf8');
  } catch {
    return null;
  }
  const srs = (/<SRS>([^<]+)<\/SRS>/i.exec(xml)?.[1] ?? '').trim().toLowerCase();
  if (srs && !srs.includes('3857') && !srs.includes('900913') && !srs.includes('mercator')) {
    return null;
  }
  const bb = parseTilemapresourceBoundingBox(xml);
  if (!bb) return null;
  if (bb.minx >= bb.maxx || bb.miny >= bb.maxy) return null;
  const lo = mercatorToLonLat(bb.minx, bb.miny);
  const hi = mercatorToLonLat(bb.maxx, bb.maxy);
  return {
    groupName: '',
    minLon: lo.lon,
    maxLon: hi.lon,
    minLat: lo.lat,
    maxLat: hi.lat,
    source: 'tilemapresource',
  };
}

async function readPyramidWgs84(groupDir: string): Promise<OrthoTileSetExtentWgs84 | null> {
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(groupDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const zooms: number[] = [];
  for (const e of entries) {
    if (e.isDirectory() && /^\d+$/.test(e.name)) zooms.push(Number(e.name));
  }
  if (zooms.length === 0) return null;
  const z = Math.min(...zooms);
  const zDir = path.join(groupDir, String(z));
  let xDirs: fs.Dirent[];
  try {
    xDirs = await fsPromises.readdir(zDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const xs: number[] = [];
  for (const xe of xDirs) {
    if (xe.isDirectory() && /^\d+$/.test(xe.name)) xs.push(Number(xe.name));
  }
  if (xs.length === 0) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  const collectYs = async (xName: string): Promise<number[]> => {
    const out: number[] = [];
    try {
      const yEntries = await fsPromises.readdir(path.join(zDir, xName));
      for (const yf of yEntries) {
        const m = /^(\d+)\.[^.]+$/.exec(yf);
        if (m) out.push(Number(m[1]));
      }
    } catch {
      /* ignore */
    }
    return out;
  };
  const yMinCandidates = await collectYs(String(minX));
  const yMaxCandidates = minX === maxX ? yMinCandidates : await collectYs(String(maxX));
  const allYs = [...yMinCandidates, ...yMaxCandidates];
  if (allYs.length === 0) {
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const xe of xDirs) {
      if (!xe.isDirectory() || !/^\d+$/.test(xe.name)) continue;
      const ys = await collectYs(xe.name);
      for (const yv of ys) {
        if (yv < yMin) yMin = yv;
        if (yv > yMax) yMax = yv;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
    const a = tileXyzToMercatorExtent(z, minX, yMin);
    const b = tileXyzToMercatorExtent(z, maxX, yMax);
    const lo = mercatorToLonLat(Math.min(a.minX, b.minX), Math.min(a.minY, b.minY));
    const hi = mercatorToLonLat(Math.max(a.maxX, b.maxX), Math.max(a.maxY, b.maxY));
    return { groupName: '', minLon: lo.lon, maxLon: hi.lon, minLat: lo.lat, maxLat: hi.lat, source: 'pyramid', zoomUsed: z };
  }
  const yMin = Math.min(...allYs);
  const yMax = Math.max(...allYs);
  const a = tileXyzToMercatorExtent(z, minX, yMin);
  const b = tileXyzToMercatorExtent(z, maxX, yMax);
  const lo = mercatorToLonLat(Math.min(a.minX, b.minX), Math.min(a.minY, b.minY));
  const hi = mercatorToLonLat(Math.max(a.maxX, b.maxX), Math.max(a.maxY, b.maxY));
  return { groupName: '', minLon: lo.lon, maxLon: hi.lon, minLat: lo.lat, maxLat: hi.lat, source: 'pyramid', zoomUsed: z };
}

export async function getOrthoTileSetExtentWgs84(params: { groupName: string }): Promise<OrthoTileSetExtentWgs84> {
  const groupName = (params?.groupName ?? '').trim();
  const empty: OrthoTileSetExtentWgs84 = {
    groupName,
    minLon: null,
    maxLon: null,
    minLat: null,
    maxLat: null,
    source: 'none',
  };
  if (!groupName || !isSafeOrthoSegment(groupName)) {
    return { ...empty, error: 'invalid groupName' };
  }
  await ensureBaseStructure();
  const base = getBaseDir();
  const groupDir = path.join(base, GGNR_DATA_PATHS.tilesJpg, groupName);
  try {
    const st = await fsPromises.stat(groupDir);
    if (!st.isDirectory()) return { ...empty, error: 'group folder not found' };
  } catch {
    return { ...empty, error: 'group folder not found' };
  }

  const tmr = await readTilemapresourceWgs84(groupDir);
  if (tmr) return { ...tmr, groupName };

  const pyr = await readPyramidWgs84(groupDir);
  if (pyr) return { ...pyr, groupName };

  return { ...empty, error: 'no extent could be derived' };
}

/**
 * GeoTIFF 내부 좌표계에서 EPSG:XXXX 추출.
 * 폴더명 CRS보다 파일 메타를 우선할 때 사용.
 */
export async function detectTifSourceCrs(absSource: string): Promise<string | null> {
  const gdalinfo = gdalToolPath('gdalinfo');
  if (!isConcreteToolPath(gdalinfo) || !fs.existsSync(gdalinfo)) return null;
  const env = buildGdalChildEnv(gdalinfo);
  const p = await runProcess(gdalinfo, ['-json', absSource], getBaseDir(), 120_000, env);
  if (p.code !== 0 || !p.stdout.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(p.stdout);
  } catch {
    return null;
  }
  const root = parsed as {
    stac?: { 'proj:epsg'?: number };
    coordinateSystem?: { wkt?: string; projjson?: { id?: { authority?: string; code?: number | string } } };
    metadata?: Record<string, Record<string, string>>;
  };
  const stacEpsg = root.stac?.['proj:epsg'];
  if (typeof stacEpsg === 'number' && Number.isFinite(stacEpsg)) {
    return `EPSG:${stacEpsg}`;
  }
  const projId = root.coordinateSystem?.projjson?.id;
  if (projId?.authority?.toUpperCase() === 'EPSG' && projId.code != null) {
    const code = Number(projId.code);
    if (Number.isFinite(code)) return `EPSG:${code}`;
  }
  const wkt = root.coordinateSystem?.wkt ?? '';
  const auth = /AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d{4,5})"\s*\]/gi.exec(wkt);
  if (auth?.[1]) return `EPSG:${auth[1]}`;
  // 마지막 AUTHORITY 가 축 단위일 수 있어 모든 EPSG 후보 중 518x/517x 우선
  const all = [...wkt.matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d{4,5})"\s*\]/gi)].map((m) => m[1]!);
  const korea = all.find((c) => /^518[0-9]$/.test(c) || /^517[0-9]$/.test(c));
  if (korea) return `EPSG:${korea}`;
  if (all.length) return `EPSG:${all[all.length - 1]}`;
  return null;
}

/**
 * 드론영상(TIF) → XYZ JPEG.
 * 산출은 aerial/ortho/... 아래(자체항공 tiles_jpg 와 분리).
 */
export async function runAerialOrthoTifToXyz(params: {
  absSource: string;
  sourceRelativePath: string;
  sourceCrs: string;
  /** aerial/ortho/{folder}/xyz/{slug} */
  outputRelativeDir: string;
  zoomMin?: number;
  zoomMax?: number;
  jpegQuality?: number;
}): Promise<{ success: boolean; error?: string; outputRelativeDir: string }> {
  const outputRelativeDir = params.outputRelativeDir.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const sourceBaseName = path.basename(params.absSource);
  try {
    await runOrthophotoJob({
      absSource: params.absSource,
      sourceRelativePath: params.sourceRelativePath,
      sourceBaseName,
      groupName: 'aerial_ortho',
      sourceCrs: params.sourceCrs,
      tileSetId: 'aerial-ortho',
      zoomMin: params.zoomMin ?? 6,
      zoomMax: params.zoomMax ?? 19,
      jpegQuality: params.jpegQuality ?? 80,
      outputSlugOverride: 'xyz',
      finalOutputDirRel: outputRelativeDir,
      /** 알파(투명) 유지 — JPEG면 nodata가 검정 사각형으로 보임 */
      tileDriver: 'PNG',
    });
    const absOut = path.join(getBaseDir(), ...outputRelativeDir.split('/').filter(Boolean));
    const hasZoom = fs.existsSync(absOut) && (await fsPromises.readdir(absOut)).some((n) => /^\d+$/.test(n));
    if (!hasZoom) {
      return { success: false, error: '변환 결과 타일 폴더가 없습니다.', outputRelativeDir };
    }
    return { success: true, outputRelativeDir };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, outputRelativeDir };
  }
}

/**
 * 항공영상(TIF) → 자체항공영상 XYZ JPEG.
 * 산출: tiles_jpg/{groupName}/z/x/y.jpg (배경지도 «자체항공영상» 등록)
 * groupName 예: satellite_2026_5181_siteA
 */
export async function runAerialSatelliteTifToXyz(params: {
  absSource: string;
  sourceRelativePath: string;
  sourceCrs: string;
  groupName: string;
  zoomMin?: number;
  zoomMax?: number;
  jpegQuality?: number;
}): Promise<{ success: boolean; error?: string; outputRelativeDir: string }> {
  const groupName = params.groupName.trim();
  const outputRelativeDir = `tiles_jpg/${groupName}`;
  if (!isSafeOrthoSegment(groupName) || !/^satellite_\d{4}/i.test(groupName)) {
    return {
      success: false,
      error: '자체항공영상 그룹명이 올바르지 않습니다.',
      outputRelativeDir,
    };
  }
  const sourceBaseName = path.basename(params.absSource);
  try {
    await runOrthophotoJob({
      absSource: params.absSource,
      sourceRelativePath: params.sourceRelativePath,
      sourceBaseName,
      groupName,
      sourceCrs: params.sourceCrs,
      tileSetId: groupName,
      zoomMin: params.zoomMin ?? 6,
      zoomMax: params.zoomMax ?? 19,
      jpegQuality: params.jpegQuality ?? 80,
      outputSlugOverride: 'main',
      tileDriver: 'JPEG',
    });
    const absOut = path.join(getBaseDir(), ...outputRelativeDir.split('/').filter(Boolean));
    const hasZoom = fs.existsSync(absOut) && (await fsPromises.readdir(absOut)).some((n) => /^\d+$/.test(n));
    if (!hasZoom) {
      return { success: false, error: '변환 결과 타일 폴더가 없습니다.', outputRelativeDir };
    }
    return { success: true, outputRelativeDir };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, outputRelativeDir };
  }
}

