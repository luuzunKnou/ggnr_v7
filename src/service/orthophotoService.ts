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

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';

/** gdal2tiles 대용량 대비 (ms) */
const ORTHO_JOB_TIMEOUT_MS = 3 * 60 * 60 * 1000;

const PYTHON_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

const TIF_EXT = /\.(tif|tiff)$/i;

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
  return path.normalize(GGNR_DATA_DIR);
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
  const exeName = process.platform === 'win32' ? `${toolBaseName}.exe` : toolBaseName;
  const candidates: string[] = [];
  const pushCondaGdalDirs = (envRoot: string) => {
    candidates.push(path.join(envRoot, 'Scripts', exeName));
    if (process.platform === 'win32') {
      candidates.push(path.join(envRoot, 'Library', 'bin', exeName));
    } else {
      candidates.push(path.join(envRoot, 'bin', exeName));
    }
  };
  const py = getPythonExeResolved();
  if (py) {
    pushCondaGdalDirs(path.dirname(py));
  }
  pushCondaGdalDirs(path.join(process.cwd(), 'python', 'env'));
  const gdalScripts = (process.env.GGNR_GDAL_SCRIPTS_DIR ?? '').trim();
  if (gdalScripts) {
    candidates.push(path.join(path.normalize(gdalScripts), exeName));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return exeName;
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
  return path.join(process.cwd(), 'python', 'env');
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
    if (fs.existsSync(path.join(d, 'proj.db'))) {
      env.PROJ_LIB = d;
      env.PROJ_DATA = d;
      break;
    }
  }

  const gdalDirs = [path.join(root, 'Library', 'share', 'gdal'), path.join(root, 'share', 'gdal')];
  for (const d of gdalDirs) {
    if (fs.existsSync(d)) {
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

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  childEnv: NodeJS.ProcessEnv = PYTHON_ENV
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    /** 절대·상대 경로로 exe가 지정된 경우 cmd.exe 없이 spawn (PATH 의존 제거, 인코딩도 유리) */
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
    if (child.stdout) child.stdout.on('data', (d) => pushChunk(outChunks, d as Buffer));
    if (child.stderr) child.stderr.on('data', (d) => pushChunk(errChunks, d as Buffer));
    const t = setTimeout(() => {
      child.kill('SIGTERM');
      const stdout = decodeChildOutput(Buffer.concat(outChunks), usedCmdShell);
      const stderr = decodeChildOutput(Buffer.concat(errChunks), usedCmdShell);
      resolve({ code: -1, stdout, stderr: `${stderr}\n[타임아웃 ${timeoutMs}ms]`.trim() });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      const stdout = decodeChildOutput(Buffer.concat(outChunks), usedCmdShell);
      const stderr = decodeChildOutput(Buffer.concat(errChunks), usedCmdShell);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(t);
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
  if (!isConcreteToolPath(gdalinfo) || !fs.existsSync(gdalinfo)) {
    throw new Error('gdalinfo 실행 파일을 찾을 수 없습니다.');
  }
  const env = buildGdalChildEnv(gdalinfo);
  const p = await runProcess(gdalinfo, ['-json', absSource], getBaseDir(), ORTHO_JOB_TIMEOUT_MS, env);
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
  if (!isConcreteToolPath(gdalwarp) || !fs.existsSync(gdalwarp)) {
    return { ok: false, error: 'gdalwarp 를 찾을 수 없습니다.' };
  }
  if (!isConcreteToolPath(gdalTranslate) || !fs.existsSync(gdalTranslate)) {
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
  } = params;
  let gFromPath: string;
  let outputSlug: string;
  if (outputSlugOverride && isSafeOrthoSegment(outputSlugOverride)) {
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
  const finalRel = orthoOutputRel(gFromPath, outputSlug);
  const fmtNote = `jpeg q=${jpegQuality} z=${zoomMin}-${zoomMax}`;
  await appendUploadConvertHistory({
    at: atStart,
    kind: 'convert_orthophoto_xyz',
    sourceFile: sourceBaseName,
    pathOrResult: finalRel,
    status: '변환 중',
    note: `group=${gFromPath} out=${outputSlug} uiTileSet=${tileSetId} ${fmtNote}`,
  }).catch((e) => console.error('[orthophotoService] history start:', e));

  const tmpRoot = path.join(base, '.tmp', `ortho_xyz_${gFromPath}_${outputSlug}_${Date.now()}`);
  const warp3857 = path.join(tmpRoot, 'warp_3857.tif');
  const tilesStaging = path.join(tmpRoot, 'tiles_staging');
  const finalAbs = path.join(base, 'tiles_jpg', gFromPath);

  const gdalwarp = gdalToolPath('gdalwarp');
  const gdal2tiles = gdalToolPath('gdal2tiles');

  const logCtx = { groupName: gFromPath, outputSlug, sourceFile: sourceBaseName, tileSetUi: tileSetId };

  const fail = async (note: string) => {
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
    await fsPromises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  };

  if (!isConcreteToolPath(gdalwarp) || !fs.existsSync(gdalwarp)) {
    const hint =
      'GDAL gdalwarp 실행 파일을 찾을 수 없습니다. conda 환경에 gdal 설치 또는 GGNR_GDAL_SCRIPTS_DIR 를 확인하세요.';
    console.error(`[orthophoto] ${hint} (resolve 결과: gdalwarp=${gdalwarp})`);
    await fail(hint);
    return;
  }
  if (!isConcreteToolPath(gdal2tiles) || !fs.existsSync(gdal2tiles)) {
    const hint =
      'GDAL gdal2tiles 실행 파일을 찾을 수 없습니다. conda 환경에 gdal 설치 또는 GGNR_GDAL_SCRIPTS_DIR 를 확인하세요.';
    console.error(`[orthophoto] ${hint} (resolve 결과: gdal2tiles=${gdal2tiles})`);
    await fail(hint);
    return;
  }
  orthoJobLog(logCtx, 'GDAL 경로 확인', `gdalwarp=${gdalwarp} gdal2tiles=${gdal2tiles}`);
  const gdalChildEnv = buildGdalChildEnv(gdalwarp);
  if (gdalChildEnv.PROJ_LIB) {
    orthoJobLog(logCtx, 'GDAL/PROJ 환경', `PROJ_LIB=${gdalChildEnv.PROJ_LIB}${gdalChildEnv.GDAL_DATA ? ` GDAL_DATA=${gdalChildEnv.GDAL_DATA}` : ''}`);
  }

  try {
    orthoJobLog(
      logCtx,
      '작업 시작',
      `src=${sourceRelativePath}(${sourceCrs}) → ${finalRel} z=${zoomMin}-${zoomMax} JPEG q=${jpegQuality} (EPSG:3857 타일)`
    );
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
    orthoJobLog(logCtx, '1/3 gdalwarp 시작', `${gdalwarp} ${sourceCrs} -> EPSG:3857`);
    const warpStarted = Date.now();
    const w = await runProcess(gdalwarp, warpArgs, base, ORTHO_JOB_TIMEOUT_MS, gdalChildEnv);
    const warpMs = Date.now() - warpStarted;
    logProcessStreams(logCtx, 'gdalwarp', w);
    if (w.code !== 0) {
      orthoJobLog(logCtx, '1/3 gdalwarp 실패', `code=${w.code} ${warpMs}ms stderr_tail=${w.stderr.slice(-400).replace(/\s+/g, ' ')}`);
      await fail(`gdalwarp 실패 code=${w.code}\n${w.stderr.slice(-2000)}`);
      return;
    }
    orthoJobLog(logCtx, '1/3 gdalwarp 완료', `${warpMs}ms -> ${warp3857}`);

    const zArg = `${zoomMin}-${zoomMax}`;
    const tileArgs: string[] = [
      '--profile=mercator',
      '--xyz',
      '--tilesize=512',
      `--zoom=${zArg}`,
      '--quiet',
      '--webviewer=none',
      '--tiledriver=JPEG',
      `--jpeg-quality=${String(jpegQuality)}`,
      '--processes=4',
      warp3857,
      tilesStaging,
    ];
    orthoJobLog(
      logCtx,
      '2/3 gdal2tiles 시작',
      `${gdal2tiles} profile=mercator jpeg zoom=${zArg} → ${tilesStaging}`
    );
    const tileStarted = Date.now();
    const t = await runProcess(gdal2tiles, tileArgs, base, ORTHO_JOB_TIMEOUT_MS, gdalChildEnv);
    const tileMs = Date.now() - tileStarted;
    logProcessStreams(logCtx, 'gdal2tiles', t);
    if (t.code !== 0) {
      orthoJobLog(logCtx, '2/3 gdal2tiles 실패', `code=${t.code} ${tileMs}ms stderr_tail=${t.stderr.slice(-400).replace(/\s+/g, ' ')}`);
      await fail(`gdal2tiles 실패 code=${t.code}\n${t.stderr.slice(-2000)}`);
      return;
    }
    orthoJobLog(logCtx, '2/3 gdal2tiles 완료', `${tileMs}ms`);

    orthoJobLog(logCtx, '3/3 결과 복사 시작', `${tilesStaging} → ${finalAbs}`);
    const copyStarted = Date.now();
    await fsPromises.mkdir(path.dirname(finalAbs), { recursive: true });
    await fsPromises.rm(finalAbs, { recursive: true, force: true }).catch(() => {});
    await fsPromises.cp(tilesStaging, finalAbs, { recursive: true });
    orthoJobLog(logCtx, '3/3 결과 복사 완료', `${Date.now() - copyStarted}ms → ${finalRel}`);

    await appendUploadConvertHistory({
      at: new Date().toISOString(),
      kind: 'convert_orthophoto_xyz',
      sourceFile: sourceBaseName,
      pathOrResult: finalRel,
      status: '완료',
    }).catch((e) => console.error('[orthophotoService] history ok:', e));
    orthoJobLog(logCtx, '작업 전체 완료', finalRel);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[orthophoto] EXCEPTION group=${gFromPath} out=${outputSlug} | ${msg}`);
    await fail(msg);
  } finally {
    await fsPromises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    orthoJobLog(logCtx, '임시 폴더 정리', tmpRoot);
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

  const srcLabel = `[그룹 ${groupName}] ${sorted.length}개 파일 → ${tileSetId}`;
  console.info(
    `[orthophoto] 큐 등록 그룹 전체: ${srcLabel} z=${zoomMin}-${zoomMax}`
  );

  setImmediate(() => {
    void (async () => {
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

      const bundleDir = path.join(base, '.tmp', `ortho_group_${groupName}_${groupOutputSlug}_${Date.now()}`);
      const vrtPath = path.join(bundleDir, 'mosaic.vrt');
      try {
        await fsPromises.mkdir(bundleDir, { recursive: true });
      } catch (e) {
        console.error(`[orthophoto] 그룹 VRT 폴더 생성 실패: ${bundleDir}`, e);
        return;
      }

      const gdalbuildvrt = gdalToolPath('gdalbuildvrt');

      if (!isConcreteToolPath(gdalbuildvrt) || !fs.existsSync(gdalbuildvrt)) {
        console.error('[orthophoto] gdalbuildvrt 를 찾을 수 없습니다. GDAL 설치 경로를 확인하세요.', gdalbuildvrt);
        return;
      }

      const gbEnv = buildGdalChildEnv(gdalbuildvrt);
      const gbArgs: string[] = ['-overwrite', '-allow_projection_difference', vrtPath, ...absPaths];
      orthoJobLog(
        { groupName, outputSlug: groupOutputSlug, sourceFile: 'mosaic.vrt', tileSetUi: tileSetId },
        '0/3 gdalbuildvrt 시작',
        gdalbuildvrt
      );
      const gb = await runProcess(gdalbuildvrt, gbArgs, base, ORTHO_JOB_TIMEOUT_MS, gbEnv);
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
    })();
  });

  const outRel = orthoOutputRel(groupName, groupOutputSlug);
  return {
    started: true,
    fileCount: sorted.length,
    outputSlug: groupOutputSlug,
    message: `그룹 ${groupName}: ${sorted.length}개 원본→${sorted.length > 1 ? 'VRT 합본 후 ' : ''}XYZ JPEG(q${jpegQuality}) 변환을 시작했습니다. (srcCrs=${sourceCrs}, UI tileSet=${tileSetId}, z=${zoomMin}-${zoomMax}) → ${outRel}.`,
  };
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

