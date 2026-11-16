/**
 * 레이어 관리 — 선택 벡터 테이블을 단일 DXF/DWG로 합본.
 * bbox가 있으면 화면 범위만, 없으면 테이블 전체.
 * PG → 임시 SHP → ogr2ogr DXF(-update/-append) → (선택) QCAD DWG.
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import iconv from 'iconv-lite';
import { sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { convertDxfFileToDwg, isQcadDwgConverterAvailable } from '@/lib/dwgToDxf';

export type LayerCadFormat = 'dxf' | 'dwg';

export type LayerCadBbox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type LayerCadExportItem = {
  tableName: string;
  schema?: 'layer' | 'public_layer';
  /** 선택 시 해당 속성값을 TEXT로 도형과 함께 표시 */
  labelField?: string | null;
};

export type LayerCadExportResult =
  | {
      success: true;
      /** 디스크 경로 — 호출측에서 다운로드 후 삭제 */
      filePath: string;
      fileName: string;
      format: LayerCadFormat;
      included: string[];
      skipped: { tableName: string; reason: string }[];
      byteLength: number;
    }
  | { success: false; error: string };

export type LayerCadJobStatus =
  | { status: 'pending' }
  | {
      status: 'done';
      filePath: string;
      fileName: string;
      format: LayerCadFormat;
      included: string[];
      skipped: { tableName: string; reason: string }[];
      byteLength: number;
    }
  | { status: 'error'; error: string };

type LayerCadJobRecord = LayerCadJobStatus & { createdAt: number };

const CAD_JOB_TTL_MS = 60 * 60 * 1000;

/**
 * 잡 메타는 프로젝트 로컬에 둔다.
 * GGNR_DATA_DIR(G:) 권한/마운트 이슈·워커 간 메모리 불일치를 피한다.
 */
function getCadJobsDir(): string {
  return path.join(process.cwd(), '.cad-export-jobs');
}

function assertSafeJobId(jobId: string): string {
  const id = String(jobId ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('잘못된 작업 ID입니다.');
  }
  return id;
}

function jobMetaPath(jobId: string): string {
  return path.join(getCadJobsDir(), `${assertSafeJobId(jobId)}.json`);
}

function writeCadJobSync(jobId: string, record: LayerCadJobRecord): void {
  const dir = getCadJobsDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${jobMetaPath(jobId)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record), 'utf8');
  fs.renameSync(tmp, jobMetaPath(jobId));
}

function readCadJobSync(jobId: string): LayerCadJobRecord | null {
  try {
    const raw = fs.readFileSync(jobMetaPath(jobId), 'utf8');
    const parsed = JSON.parse(raw) as LayerCadJobRecord;
    if (!parsed || typeof parsed !== 'object' || !('status' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function deleteCadJobMetaSync(jobId: string): void {
  try {
    fs.unlinkSync(jobMetaPath(jobId));
  } catch {
    /* ignore */
  }
}

const MAX_LAYERS = 10;
const PER_LAYER_TIMEOUT_MS = 5 * 60 * 1000;
/** 레이어당 라벨 상한(전수 표시, 폭주 방지용) */
const MAX_LABELS_PER_LAYER = 100_000;
/** 선 왼쪽 직교 오프셋(m) — 선과 글자 겹침 완화 */
const LABEL_LINE_OFFSET_M = 1.2;
/** 글자 높이(m, EPSG:5181) — 전수 표시용으로 축소 */
const LABEL_TEXT_HEIGHT = 1.6;
/** 가로 비율(group 41) — 1보다 크면 살짝 굵게 보임 */
const LABEL_WIDTH_FACTOR = 1.25;
/** 라벨 글자색 검정 */
const LABEL_FILL_COLOR = 0x000000;
/** 관로 선 색 #E98D44 (지도 SLD stroke) */
const LAYER_STROKE_COLOR = 0xe98d44;

function getDbConfig(): { host: string; port: number; database: string; user: string; password: string } {
  return {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'postgres',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
  };
}

function buildGdalEnv(envDir: string): NodeJS.ProcessEnv {
  const isWin = process.platform === 'win32';
  const shareDir = isWin ? path.join(envDir, 'Library', 'share') : path.join(envDir, 'share');
  const binDir = isWin ? path.join(envDir, 'Library', 'bin') : path.join(envDir, 'bin');
  const pluginDir = isWin
    ? path.join(envDir, 'Library', 'lib', 'gdalplugins')
    : path.join(envDir, 'lib', 'gdalplugins');
  const pathKey = isWin ? 'Path' : 'PATH';
  const existingPath = process.env[pathKey] ?? process.env.PATH ?? '';
  return {
    ...process.env,
    GDAL_DATA: path.join(shareDir, 'gdal'),
    GDAL_DRIVER_PATH: pluginDir,
    PROJ_DATA: path.join(shareDir, 'proj'),
    PROJ_LIB: path.join(shareDir, 'proj'),
    [pathKey]: `${binDir}${path.delimiter}${existingPath}`,
  };
}

function resolveOgr2ogrRun(): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } {
  const root = process.cwd();
  if (process.env.GGNR_GDAL_OGR2OGR) {
    const custom = path.resolve(root, process.env.GGNR_GDAL_OGR2OGR);
    const bin = fs.existsSync(custom) ? custom : process.env.GGNR_GDAL_OGR2OGR;
    return { cmd: bin, args: [] };
  }
  const pyEnv = process.env.GGNR_PIPELINE_PYTHON;
  if (pyEnv && pyEnv !== 'python') {
    const envDir = path.dirname(path.resolve(root, pyEnv));
    const isWin = process.platform === 'win32';
    const candidate = isWin
      ? path.join(envDir, 'Library', 'bin', 'ogr2ogr.exe')
      : path.join(envDir, 'bin', 'ogr2ogr');
    if (fs.existsSync(candidate)) {
      return { cmd: candidate, args: [], env: buildGdalEnv(envDir) };
    }
  }
  return { cmd: 'ogr2ogr', args: [] };
}

function decodeStderr(chunk: Buffer | string): string {
  const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
  if (buf.length === 0) return '';
  if (process.platform === 'win32') {
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

function runOgr2ogr(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      shell: false,
      env,
    });
    const stderrChunks: Buffer[] = [];
    if (child.stderr) {
      child.stderr.on('data', (d) => stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        code: -1,
        stderr: `${decodeStderr(Buffer.concat(stderrChunks))}\n[타임아웃 ${timeoutMs}ms]`.trim(),
      });
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stderr: decodeStderr(Buffer.concat(stderrChunks)),
      });
    });
  });
}

function sanitizeTableName(raw: string): string | null {
  const cleaned = String(raw ?? '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
  return cleaned || null;
}

/** 컬럼명 — 영문·숫자·밑줄·한글만 허용 후 식별자로 인용 */
function sanitizeFieldName(raw: string): string | null {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned || cleaned.length > 63) return null;
  if (!/^[A-Za-z0-9_가-힣]+$/.test(cleaned)) return null;
  return cleaned;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '')}"`;
}

function sanitizeDxfLayerName(basename: string): string {
  const cleaned = basename.replace(/[<>/\\":;?*|=,]/g, '_').trim();
  return (cleaned || 'layer').slice(0, 255);
}

function sanitizeDxfText(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\0/g, '')
    .trim()
    .slice(0, 250);
}

function geomExpr5181(schema: 'layer' | 'public_layer'): string {
  if (schema === 'public_layer') {
    return 'ST_MakeValid(ST_Force2D(ST_SetSRID(geom, 5181)))';
  }
  return `ST_MakeValid(ST_Force2D(CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 5181) ELSE ST_Transform(geom, 5181) END))`;
}

type CadLabelPoint = { x: number; y: number; text: string; angleDeg: number };

/** PostGIS 방위각(북 기준 시계) → DXF TEXT 각도(+X 기준 반시계), 뒤집히지 않게 보정 */
function azimuthToDxfTextAngle(azDeg: number): number {
  let dxf = (90 - azDeg + 360) % 360;
  // 글자가 거꾸로 읽히면 180° 회전 (QGIS 라벨과 동일 취지)
  if (dxf > 90 && dxf <= 270) dxf = (dxf + 180) % 360;
  return dxf;
}

function padCode(code: number | string): string {
  const s = String(code);
  return s.length >= 3 ? s : s.padStart(3, ' ');
}

async function fetchLabelPoints(params: {
  schema: 'layer' | 'public_layer';
  tableName: string;
  labelField: string;
  bbox: LayerCadBbox | null;
}): Promise<CadLabelPoint[]> {
  const field = sanitizeFieldName(params.labelField);
  if (!field) return [];
  const table = sanitizeTableName(params.tableName);
  if (!table) return [];

  const g = geomExpr5181(params.schema);
  const fieldRef = quoteIdent(field);
  const schemaRef = quoteIdent(params.schema);
  const tableRef = quoteIdent(table);

  let whereExtra = '';
  if (params.bbox) {
    const { minX, minY, maxX, maxY } = params.bbox;
    whereExtra = ` AND ST_Intersects(${g}, ST_MakeEnvelope(${minX}, ${minY}, ${maxX}, ${maxY}, 5181))`;
  }

  /** 선: 중점 + 접선 각도 + 직교 오프셋. 면/점: PointOnSurface. 라벨 값 있는 피처 전부. */
  const q = `
    SELECT
      ST_X(pt) AS x,
      ST_Y(pt) AS y,
      lbl AS text,
      az_deg
    FROM (
      SELECT
        CASE
          WHEN mid_pt IS NOT NULL AND is_line THEN
            ST_Translate(
              mid_pt,
              ${LABEL_LINE_OFFSET_M} * -cos(radians(az_deg)),
              ${LABEL_LINE_OFFSET_M} * sin(radians(az_deg))
            )
          ELSE mid_pt
        END AS pt,
        az_deg,
        lbl
      FROM (
        SELECT
          CASE
            WHEN line_geom IS NOT NULL AND NOT ST_IsEmpty(line_geom) THEN
              ST_LineInterpolatePoint(line_geom, 0.5)
            WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL
            ELSE ST_PointOnSurface(g)
          END AS mid_pt,
          CASE
            WHEN line_geom IS NOT NULL AND NOT ST_IsEmpty(line_geom) AND ST_Length(line_geom) > 0 THEN
              degrees(
                ST_Azimuth(
                  ST_LineInterpolatePoint(line_geom, GREATEST(0.0, 0.5 - 0.01)),
                  ST_LineInterpolatePoint(line_geom, LEAST(1.0, 0.5 + 0.01))
                )
              )
            ELSE 90
          END AS az_deg,
          lbl,
          is_line
        FROM (
          SELECT
            g,
            GeometryType(g) IN ('LINESTRING', 'MULTILINESTRING') AS is_line,
            CASE
              WHEN GeometryType(g) IN ('LINESTRING', 'MULTILINESTRING') THEN
                ST_GeometryN(ST_LineMerge(g), 1)
              ELSE NULL
            END AS line_geom,
            lbl
          FROM (
            SELECT
              ${g} AS g,
              NULLIF(TRIM(CAST(${fieldRef} AS text)), '') AS lbl
            FROM ${schemaRef}.${tableRef}
            WHERE geom IS NOT NULL
              AND NOT ST_IsEmpty(geom)
              AND ${fieldRef} IS NOT NULL
              AND TRIM(CAST(${fieldRef} AS text)) <> ''
              ${whereExtra}
          ) s
        ) m
      ) u
    ) t
    WHERE pt IS NOT NULL AND lbl IS NOT NULL
    LIMIT ${MAX_LABELS_PER_LAYER}
  `;

  const res = await db.execute(sql.raw(q));
  const list = (res.rows ?? []) as Record<string, unknown>[];
  const out: CadLabelPoint[] = [];
  for (const row of list) {
    const x = Number(row.x);
    const y = Number(row.y);
    const text = sanitizeDxfText(String(row.text ?? ''));
    const az = Number(row.az_deg);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !text) continue;
    const angleDeg = Number.isFinite(az) ? azimuthToDxfTextAngle(az) : 0;
    out.push({ x, y, text, angleDeg });
  }
  console.log(
    `[layerCadExport] labels ${params.schema}.${table}.${field}: ${out.length}건 (전수, 높이 ${LABEL_TEXT_HEIGHT}m)`
  );
  return out;
}

/** DXF TEXT 한 개 (검정, 가로비율로 살짝 굵게) */
function formatDxfTextEntity(params: {
  layerName: string;
  handle: number;
  x: number;
  y: number;
  text: string;
  angleDeg: number;
  color: number;
  height?: number;
  widthFactor?: number;
}): string {
  return [
    padCode(0),
    'TEXT',
    padCode(5),
    params.handle.toString(16),
    padCode(100),
    'AcDbEntity',
    padCode(100),
    'AcDbText',
    padCode(8),
    params.layerName,
    padCode(420),
    String(params.color),
    padCode(10),
    params.x.toFixed(14),
    padCode(20),
    params.y.toFixed(14),
    padCode(40),
    String(params.height ?? LABEL_TEXT_HEIGHT),
    padCode(41),
    String(params.widthFactor ?? LABEL_WIDTH_FACTOR),
    padCode(1),
    params.text,
    padCode(50),
    params.angleDeg.toFixed(14),
    padCode(7),
    'STANDARD',
    padCode(100),
    'AcDbText',
  ].join('\n');
}

/** 전수 라벨: 선 따라 회전·오프셋·검정·살짝 굵게 */
function buildDxfTextEntities(
  layerName: string,
  points: CadLabelPoint[],
  handleStart: number
): { block: string; nextHandle: number } {
  const parts: string[] = [];
  let handle = handleStart;
  for (const p of points) {
    parts.push(
      formatDxfTextEntity({
        layerName,
        handle: handle++,
        x: p.x,
        y: p.y,
        text: p.text,
        angleDeg: p.angleDeg,
        color: LABEL_FILL_COLOR,
      })
    );
  }
  return { block: parts.join('\n'), nextHandle: handle };
}

function readDxfAsText(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  if (utf8.includes('SECTION') && !utf8.includes('\uFFFD')) return utf8;
  try {
    return iconv.decode(buf, 'cp949');
  } catch {
    return utf8;
  }
}

/** HEADER의 $DWGCODEPAGE 를 ANSI_949 로 맞춤 (QGIS와 동일) */
function ensureDwgCodePageAnsi949(content: string, nl: string): string {
  if (/\$DWGCODEPAGE/i.test(content)) {
    return content.replace(
      /(\$DWGCODEPAGE\r?\n[ \t]*3\r?\n)[^\r\n]*/i,
      `$1ANSI_949`
    );
  }
  // HEADER 섹션 안에 삽입
  return content.replace(
    /(HEADER\r?\n)/i,
    `$1${padCode(9)}${nl}$DWGCODEPAGE${nl}${padCode(3)}${nl}ANSI_949${nl}`
  );
}

/** SLD stroke #E98D44 — 해당 레이어 도형에 TrueColor가 없으면 넣음 */
function applyLayerStrokeTrueColor(
  content: string,
  layerNames: string[],
  color: number = LAYER_STROKE_COLOR
): string {
  if (!layerNames.length) return content;
  const wanted = new Set(layerNames.map((n) => n.toLowerCase()));
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  const parts = content.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts[i]);
    if (parts[i].trim() !== '8' || i + 1 >= parts.length) continue;
    const layer = parts[i + 1].trim();
    out.push(parts[++i]);
    const next = (parts[i + 1] ?? '').trim();
    if (wanted.has(layer.toLowerCase()) && next !== '420') {
      out.push(padCode(420), String(color));
    }
  }
  return out.join(nl);
}

/**
 * SLD stroke 색 적용 + TEXT를 ENTITIES에 삽입.
 * 저장은 CP949(ANSI_949).
 */
async function finalizeDxfWithLabelsAndStyle(
  dxfAbs: string,
  params: { entitiesBlock?: string; strokeLayerNames: string[] }
): Promise<void> {
  const buf = await fsPromises.readFile(dxfAbs);
  let content = readDxfAsText(buf);
  const nl = content.includes('\r\n') ? '\r\n' : '\n';

  content = applyLayerStrokeTrueColor(content, params.strokeLayerNames);

  const entitiesBlock = (params.entitiesBlock ?? '').trim();
  if (entitiesBlock) {
    const block = entitiesBlock.replace(/\r?\n/g, nl);
    const entitiesStartRe =
      /(^|\r?\n)[ \t]*0[ \t]*\r?\n[ \t]*SECTION[ \t]*\r?\n[ \t]*2[ \t]*\r?\n[ \t]*ENTITIES[ \t]*(?=\r?\n)/i;
    const startMatch = entitiesStartRe.exec(content);
    if (!startMatch) {
      throw new Error('DXF ENTITIES 섹션을 찾지 못해 라벨을 넣지 못했습니다.');
    }

    const afterHeader = startMatch.index + startMatch[0].length;
    const endSecRe = /\r?\n[ \t]*0[ \t]*\r?\n[ \t]*ENDSEC[ \t]*(?=\r?\n)/i;
    const rest = content.slice(afterHeader);
    const endMatch = endSecRe.exec(rest);
    if (!endMatch) {
      throw new Error('DXF ENTITIES 섹션을 닫는 ENDSEC를 찾지 못했습니다.');
    }
    const insertAt = afterHeader + endMatch.index;
    content = `${content.slice(0, insertAt)}${nl}${block}${content.slice(insertAt)}`;
  }

  content = ensureDwgCodePageAnsi949(content, nl);
  await fsPromises.writeFile(dxfAbs, encodeDxfCp949(content));
}

function encodeDxfCp949(content: string): Buffer {
  try {
    return iconv.encode(content, 'cp949');
  } catch (e) {
    console.warn('[layerCadExport] CP949 encode fallback', e instanceof Error ? e.message : e);
    const safe = content.replace(/[^\x09\x0A\x0D\x20-\x7E\u3131-\u318E\uAC00-\uD7A3]/g, '?');
    return iconv.encode(safe, 'cp949');
  }
}

function ogrSqlLayerRef(basename: string): string {
  return `"${basename.replace(/"/g, '""')}"`;
}

function isOnlyDxfFieldCreationNoise(stderr: string): boolean {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/\[타임아웃/i.test(line));
  if (!lines.length) return true;
  return lines.every((line) => /DXF layer does not support arbitrary field creation/i.test(line));
}

function normalizeFormat(raw?: string | null): LayerCadFormat {
  return String(raw ?? '').trim().toLowerCase() === 'dwg' ? 'dwg' : 'dxf';
}

function validateBbox(bbox: LayerCadBbox | null | undefined): LayerCadBbox | null {
  if (!bbox) return null;
  const minX = Number(bbox.minX);
  const minY = Number(bbox.minY);
  const maxX = Number(bbox.maxX);
  const maxY = Number(bbox.maxY);
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null;
  if (!(maxX > minX && maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

export function getLayerCadExportCapabilities(): { dwgConverterAvailable: boolean; maxLayers: number } {
  return {
    dwgConverterAvailable: isQcadDwgConverterAvailable(),
    maxLayers: MAX_LAYERS,
  };
}

async function exportOneLayerToShp(params: {
  schema: 'layer' | 'public_layer';
  tableName: string;
  bbox: LayerCadBbox | null;
  outShp: string;
  cmd: string;
  prefix: string[];
  env: NodeJS.ProcessEnv;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { schema, tableName, bbox, outShp, cmd, prefix, env } = params;
  const dbCfg = getDbConfig();
  const pgConn = `PG:host=${dbCfg.host} port=${dbCfg.port} dbname=${dbCfg.database} user=${dbCfg.user} password=${dbCfg.password}`;
  const dbfEncoding = 'CP949';
  const ogrEnv: NodeJS.ProcessEnv = { ...env, SHAPE_ENCODING: dbfEncoding, DXF_WRITE_HATCH: 'FALSE' };

  let sql: string;
  if (bbox) {
    /** 필터는 5181 envelope 기준. public_layer는 SRID=0인 경우가 많아 SetSRID만 적용 */
    const geomExpr =
      schema === 'public_layer'
        ? 'ST_SetSRID(geom, 5181)'
        : 'CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 5181) ELSE ST_Transform(ST_Force2D(geom), 5181) END';
    sql = `SELECT * FROM ${schema}."${tableName}" WHERE geom IS NOT NULL AND ST_Intersects(${geomExpr}, ST_MakeEnvelope(${bbox.minX}, ${bbox.minY}, ${bbox.maxX}, ${bbox.maxY}, 5181))`;
  } else {
    sql = `SELECT * FROM ${schema}."${tableName}" WHERE geom IS NOT NULL`;
  }

  const ogrArgs = [
    '--config',
    'SHAPE_ENCODING',
    dbfEncoding,
    '-f',
    'ESRI Shapefile',
    '-lco',
    'ENCODING=LDID/77',
    outShp,
    pgConn,
    '-sql',
    sql,
  ];
  if (schema === 'public_layer') {
    ogrArgs.push('-s_srs', 'EPSG:5181');
  }
  ogrArgs.push('-t_srs', 'EPSG:5181', '-skipfailures', '-dim', '2');
  const execArgs = prefix.length > 0 ? [...prefix, ...ogrArgs] : ogrArgs;
  const result = await runOgr2ogr(cmd, execArgs, ogrEnv, PER_LAYER_TIMEOUT_MS);

  let shpSize = 0;
  try {
    shpSize = (await fsPromises.stat(outShp)).size;
  } catch {
    shpSize = 0;
  }
  if (shpSize < 100) {
    const tail = (result.stderr ?? '').trim() || `ogr2ogr 코드 ${result.code}`;
    if (/0 features|empty|no features/i.test(tail) || result.code === 0) {
      return {
        ok: false,
        reason: bbox ? '화면 범위에 도형이 없습니다.' : '도형이 없습니다.',
      };
    }
    return { ok: false, reason: `SHP 생성 실패. ${tail.slice(0, 300)}` };
  }

  await fsPromises.writeFile(path.join(path.dirname(outShp), `${tableName}.cpg`), `${dbfEncoding}\n`, 'utf8');
  return { ok: true };
}

async function appendShpToDxf(params: {
  shpAbs: string;
  dxfAbs: string;
  layerName: string;
  isFirst: boolean;
  cmd: string;
  prefix: string[];
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const { shpAbs, dxfAbs, layerName, isFirst, cmd, prefix, env } = params;
  const layerRef = ogrSqlLayerRef(path.parse(shpAbs).name);
  const ogrArgs = isFirst
    ? [
        '-f',
        'DXF',
        dxfAbs,
        shpAbs,
        '-oo',
        'ENCODING=CP949',
        '-nln',
        layerName,
        '-dsco',
        'INSUNITS=METERS',
        '-dsco',
        'MEASUREMENT=METRIC',
        '-sql',
        `SELECT FID FROM ${layerRef}`,
      ]
    : [
        '-update',
        '-append',
        '-f',
        'DXF',
        dxfAbs,
        shpAbs,
        '-oo',
        'ENCODING=CP949',
        '-nln',
        layerName,
        '-sql',
        `SELECT FID FROM ${layerRef}`,
      ];
  const execArgs = prefix.length > 0 ? [...prefix, ...ogrArgs] : ogrArgs;
  const runEnv: NodeJS.ProcessEnv = {
    ...env,
    DXF_WRITE_HATCH: 'FALSE',
  };
  const result = await runOgr2ogr(cmd, execArgs, runEnv, PER_LAYER_TIMEOUT_MS);
  let st: fs.Stats | null = null;
  try {
    st = await fsPromises.stat(dxfAbs);
  } catch {
    st = null;
  }
  const hasOutput = Boolean(st?.isFile() && (st.size ?? 0) > 0);
  if (result.code !== 0 && !(hasOutput && isOnlyDxfFieldCreationNoise(result.stderr))) {
    throw new Error((result.stderr || `ogr2ogr 코드 ${result.code}`).slice(0, 500));
  }
  if (!hasOutput) {
    throw new Error('도면 파일이 생성되지 않았습니다.');
  }
}

/**
 * 선택 레이어를 단일 CAD 버퍼로 반환.
 * `bbox`가 있으면 해당 범위만, 없으면 테이블 전체.
 */
export async function exportLayersToCad(params: {
  layers: LayerCadExportItem[];
  bbox?: LayerCadBbox | null;
  format?: LayerCadFormat | string | null;
}): Promise<LayerCadExportResult> {
  const format = normalizeFormat(params.format);
  const bbox = params.bbox != null ? validateBbox(params.bbox) : null;
  if (params.bbox != null && !bbox) {
    return { success: false, error: '지도 화면 범위가 올바르지 않습니다.' };
  }

  const rawLayers = Array.isArray(params.layers) ? params.layers : [];
  if (!rawLayers.length) {
    return { success: false, error: '레이어를 한 개 이상 선택하세요.' };
  }
  if (rawLayers.length > MAX_LAYERS) {
    return { success: false, error: `한 번에 최대 ${MAX_LAYERS}개 레이어까지 받을 수 있습니다.` };
  }
  if (format === 'dwg' && !isQcadDwgConverterAvailable()) {
    return {
      success: false,
      error: '캐드(DWG) 변환 환경을 찾지 못했습니다. 도면(DXF)으로 받으세요.',
    };
  }

  const layers: {
    tableName: string;
    schema: 'layer' | 'public_layer';
    labelField: string | null;
  }[] = [];
  const seen = new Set<string>();
  for (const item of rawLayers) {
    const tableName = sanitizeTableName(item?.tableName ?? '');
    if (!tableName) continue;
    const schema = item?.schema === 'public_layer' ? ('public_layer' as const) : ('layer' as const);
    const key = `${schema}.${tableName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const labelField = sanitizeFieldName(String(item?.labelField ?? '').trim()) || null;
    layers.push({ tableName, schema, labelField });
  }
  if (!layers.length) {
    return { success: false, error: '유효한 레이어가 없습니다.' };
  }

  const { cmd, args: prefix, env } = resolveOgr2ogrRun();
  const baseEnv = env ?? process.env;
  const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'layer-cad-'));
  const shpDir = path.join(tmpRoot, 'shp');
  const dxfAbs = path.join(tmpRoot, 'layers.dxf');
  const dwgAbs = path.join(tmpRoot, 'layers.dwg');
  await fsPromises.mkdir(shpDir, { recursive: true });

  const included: string[] = [];
  const skipped: { tableName: string; reason: string }[] = [];
  const labelBlocks: string[] = [];
  /** QGIS처럼 도형과 동일한 레이어명에 TEXT를 넣는다 */
  let textHandle = 0x10000;

  try {
    let dxfStarted = false;
    for (const layer of layers) {
      const outShp = path.join(shpDir, `${layer.tableName}.shp`);
      try {
        const shpResult = await exportOneLayerToShp({
          schema: layer.schema,
          tableName: layer.tableName,
          bbox,
          outShp,
          cmd,
          prefix,
          env: baseEnv,
        });
        if (!shpResult.ok) {
          skipped.push({ tableName: layer.tableName, reason: shpResult.reason });
          continue;
        }
        const geomLayerName = sanitizeDxfLayerName(layer.tableName);
        await appendShpToDxf({
          shpAbs: outShp,
          dxfAbs,
          layerName: geomLayerName,
          isFirst: !dxfStarted,
          cmd,
          prefix,
          env: baseEnv,
        });
        dxfStarted = true;
        included.push(layer.tableName);

        if (layer.labelField) {
          try {
            const points = await fetchLabelPoints({
              schema: layer.schema,
              tableName: layer.tableName,
              labelField: layer.labelField,
              bbox,
            });
            if (points.length) {
              const built = buildDxfTextEntities(geomLayerName, points, textHandle);
              textHandle = built.nextHandle;
              labelBlocks.push(built.block);
            } else {
              console.warn(
                `[layerCadExport] ${layer.tableName}.${layer.labelField}: 라벨 값 0건`
              );
              skipped.push({
                tableName: layer.tableName,
                reason: `라벨 속성(${layer.labelField})에 표시할 값이 없습니다.`,
              });
            }
          } catch (labelErr) {
            const msg = labelErr instanceof Error ? labelErr.message : String(labelErr);
            console.error(`[layerCadExport] label ${layer.tableName}`, msg);
            skipped.push({
              tableName: layer.tableName,
              reason: `라벨 생략: ${msg.slice(0, 200)}`,
            });
          }
        } else {
          console.log(`[layerCadExport] ${layer.tableName}: 라벨 속성 미선택`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        skipped.push({ tableName: layer.tableName, reason: msg.slice(0, 300) });
      }
    }

    if (dxfStarted) {
      const strokeLayerNames = included.map((t) => sanitizeDxfLayerName(t));
      const joined = labelBlocks.filter(Boolean).join('\n');
      const textCount = joined
        ? joined.split(/\r?\n/).filter((line) => line.trim() === 'TEXT').length
        : 0;
      await finalizeDxfWithLabelsAndStyle(dxfAbs, {
        entitiesBlock: joined || undefined,
        strokeLayerNames,
      });
      if (textCount) {
        console.log(
          `[layerCadExport] TEXT ${textCount}개 삽입 (전수·검정·굵게·작게, ANSI_949)`
        );
      }
    }

    if (!included.length) {
      const firstReason = skipped[0]?.reason || 'CAD 파일을 만들지 못했습니다.';
      return {
        success: false,
        error:
          firstReason === '화면 범위에 도형이 없습니다.'
            ? '선택한 레이어에 현재 화면 범위의 도형이 없습니다. 지도를 확대·이동한 뒤 다시 시도하세요.'
            : firstReason === '도형이 없습니다.'
              ? '선택한 레이어에 도형이 없습니다.'
              : firstReason,
      };
    }

    let outAbs = dxfAbs;
    let outFormat: LayerCadFormat = 'dxf';
    if (format === 'dwg') {
      const dwgResult = await convertDxfFileToDwg(dxfAbs, dwgAbs);
      if (!dwgResult.ok) {
        await fsPromises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        return { success: false, error: dwgResult.reason };
      }
      outAbs = dwgAbs;
      outFormat = 'dwg';
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `layers_${stamp}.${outFormat}`;
    const finalAbs = path.join(tmpRoot, fileName);
    if (path.resolve(outAbs) !== path.resolve(finalAbs)) {
      await fsPromises.copyFile(outAbs, finalAbs);
    }
    const st = await fsPromises.stat(finalAbs);

    return {
      success: true,
      filePath: finalAbs,
      fileName,
      format: outFormat,
      included,
      skipped,
      byteLength: st.size,
    };
  } catch (e) {
    await fsPromises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

function purgeExpiredCadJobs() {
  const dir = getCadJobsDir();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    const id = name.replace(/\.json$/i, '');
    try {
      assertSafeJobId(id);
    } catch {
      continue;
    }
    const job = readCadJobSync(id);
    if (!job || now - (job.createdAt || 0) < CAD_JOB_TTL_MS) continue;
    if (job.status === 'done' && job.filePath) {
      void fsPromises.rm(path.dirname(job.filePath), { recursive: true, force: true }).catch(() => {});
    }
    deleteCadJobMetaSync(id);
  }
}

/** pending 잡 생성만 — 실제 변환은 runLayerCadExportJob + next/server after() */
export function startLayerCadExportJob(_params?: {
  layers?: LayerCadExportItem[];
  bbox?: LayerCadBbox | null;
  format?: LayerCadFormat | string | null;
}): { jobId: string } {
  purgeExpiredCadJobs();
  const jobId = randomUUID();
  writeCadJobSync(jobId, { status: 'pending', createdAt: Date.now() });
  return { jobId };
}

/** after() 콜백에서 호출 — 변환 후 잡 메타를 디스크에 기록 */
export async function runLayerCadExportJob(
  jobId: string,
  params: {
    layers: LayerCadExportItem[];
    bbox?: LayerCadBbox | null;
    format?: LayerCadFormat | string | null;
  }
): Promise<void> {
  try {
    assertSafeJobId(jobId);
    const result = await exportLayersToCad(params);
    if (!result.success) {
      writeCadJobSync(jobId, { status: 'error', error: result.error, createdAt: Date.now() });
      return;
    }
    writeCadJobSync(jobId, {
      status: 'done',
      filePath: result.filePath,
      fileName: result.fileName,
      format: result.format,
      included: result.included,
      skipped: result.skipped,
      byteLength: result.byteLength,
      createdAt: Date.now(),
    });
    console.log(
      '[layerCadExport] job done',
      jobId,
      result.fileName,
      result.byteLength,
      'bytes'
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      writeCadJobSync(jobId, { status: 'error', error: msg, createdAt: Date.now() });
    } catch {
      /* ignore */
    }
    console.error('[layerCadExport] job error', jobId, msg);
  }
}

export function getLayerCadExportJob(jobId: string): LayerCadJobStatus | null {
  purgeExpiredCadJobs();
  let id: string;
  try {
    id = assertSafeJobId(jobId);
  } catch {
    return null;
  }
  const job = readCadJobSync(id);
  if (!job) return null;
  if (job.status === 'pending') return { status: 'pending' };
  if (job.status === 'error') return { status: 'error', error: job.error };
  return {
    status: 'done',
    filePath: job.filePath,
    fileName: job.fileName,
    format: job.format,
    included: job.included,
    skipped: job.skipped,
    byteLength: job.byteLength,
  };
}

/** 다운로드 완료 후 임시 파일·잡 정리 */
export async function cleanupLayerCadExportJob(jobId: string): Promise<void> {
  let id: string;
  try {
    id = assertSafeJobId(jobId);
  } catch {
    return;
  }
  const job = readCadJobSync(id);
  deleteCadJobMetaSync(id);
  if (job?.status === 'done' && job.filePath) {
    await fsPromises.rm(path.dirname(job.filePath), { recursive: true, force: true }).catch(() => {});
  }
}
