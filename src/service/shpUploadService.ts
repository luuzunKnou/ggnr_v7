/**
 * SHP File Uploader service.
 * - 목록: GGNR_DATA_DIR/shp_data (또는 하위 폴더) 내 .shp 파일 및 Table/좌표계/layer/style/Define 상태
 * - 후처리: GeoServer에 Shapefile 데이터스토어·레이어·스타일 생성
 * - 테이블 생성: GDAL ogr2ogr로 SHP → PostGIS layer 스키마
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import archiver from 'archiver';
import iconv from 'iconv-lite';
import { getLayerTableList, getDefineLayerTables, getLayerTableGeometryTypes, getTableColumnInfo, createOrUpdateGeoServerLayer, applyDefaultStyleToLayer } from './devTestService';
import { reorderDefineLayerTableRow, reorderDefineLayerTablesArray } from '@/lib/defineLayerTableRowOrder';

const GGNR_DATA_DIR = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
const GEOSERVER_DEFAULT_URL = 'http://localhost:8080/geoserver';
const GEOSERVER_AUTH = Buffer.from('admin:geoserver', 'utf8').toString('base64');
const WORKSPACE = 'ggnr';

async function geoserverFetch(
  baseUrl: string,
  pathSeg: string,
  options: { method?: string; body?: string; contentType?: string; accept?: string } = {}
): Promise<Response> {
  const url = `${baseUrl.replace(/\/$/, '')}${pathSeg}`;
  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/json',
    Authorization: `Basic ${GEOSERVER_AUTH}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = options.contentType ?? 'application/json';
  }
  return fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });
}

/** SHP → PostGIS 업로드 시 ogr2ogr `-t_srs` 목표 좌표계 (Korea 2000 / Unified) */
const SHP_UPLOAD_TARGET_SRS = 'EPSG:5181';

/** .prj 파일에서 EPSG 코드 추출. 마지막 AUTHORITY 사용 (타원체 7019보다 좌표계 5187 등이 뒤에 옴) */
function parseEpsgFromPrj(content: string): string | null {
  if (!content || typeof content !== 'string') return null;
  const re = /AUTHORITY\s*\[\s*["']?EPSG["']?\s*,\s*["']?(\d+)["']?\s*\]/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) last = m[1];
  if (last) return `EPSG:${last}`;
  const match2 = content.match(/\bEPSG[:\s]*(\d+)\b/gi);
  if (match2?.length) {
    const lastNum = match2[match2.length - 1].replace(/\D/g, '');
    if (lastNum) return `EPSG:${lastNum}`;
  }
  return null;
}

/** 파일명(또는 폴더명)을 _ 로 나눴을 때 2번째 조각이 4자리 숫자면 EPSG로 사용 (.prj 없을 때 2순위) */
function parseEpsgFromBasename(basename: string): string | null {
  const parts = basename.split('_');
  const second = parts[1];
  if (second && /^\d{4}$/.test(second)) return `EPSG:${second}`;
  return null;
}

async function resolveShpSrs(dir: string, basename: string): Promise<{ sourceSrs: string | null; targetSrs: string }> {
  const folderName = path.basename(dir);
  let sourceSrs: string | null = null;
  try {
    const prjPath = path.join(dir, `${basename}.prj`);
    const prjContent = await fs.readFile(prjPath, 'utf-8').catch(() => '');
    sourceSrs =
      parseEpsgFromPrj(prjContent) ??
      parseEpsgFromBasename(basename) ??
      parseEpsgFromBasename(folderName);
  } catch {
    sourceSrs = parseEpsgFromBasename(basename) ?? parseEpsgFromBasename(folderName);
  }
  /** 소스는 .prj → 파일명 → 폴더명 순으로만 결정. DB 적재 시에는 항상 5181로 변환 */
  return { sourceSrs, targetSrs: SHP_UPLOAD_TARGET_SRS };
}

/** DBF 본문(레코드 필드 바이트) 일부를 모아 UTF-8(strict) 여부로 UTF-8 vs CP949를 가늠 */
function sampleDbfRecordDataBytes(buf: Buffer, maxSample: number): Buffer {
  if (buf.length < 32) return Buffer.alloc(0);
  const headerSize = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  if (headerSize < 32 || headerSize > buf.length || recordLen < 2) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  let offset = headerSize;
  const maxRecords = 600;
  for (let i = 0; i < maxRecords && offset + recordLen <= buf.length && total < maxSample; i++) {
    const slice = buf.subarray(offset + 1, offset + recordLen);
    const take = Math.min(slice.length, maxSample - total);
    if (take > 0) chunks.push(slice.subarray(0, take));
    total += take;
    offset += recordLen;
  }
  if (chunks.length === 0) return Buffer.alloc(0);
  return Buffer.concat(chunks, total);
}

function sniffDbfBytesEncoding(sample: Buffer): 'UTF-8' | 'CP949' {
  if (sample.length === 0) return 'CP949';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return 'UTF-8';
  } catch {
    return 'CP949';
  }
}

/**
 * Shapefile 속성(.dbf) 문자 인코딩 → ogr2ogr `-oo ENCODING=…`
 * - 같은 이름의 `.cpg`에 한 줄 이상 있으면 그대로(예: UTF-8, CP949)
 * - `.cpg`가 없거나 비어 있으면 `GGNR_SHP_DBF_ENCODING` (전역 강제)
 * - 그다음 `.dbf` 샘플을 UTF-8(strict)로 읽을 수 있으면 UTF-8, 아니면 CP949 (자동; `GGNR_SHP_DBF_AUTO=0` 이면 생략)
 * - 최종 기본값 `CP949`
 */
function resolveShapefileDbfEncoding(dir: string, basename: string): string {
  const fromEnv = process.env.GGNR_SHP_DBF_ENCODING?.trim();
  const cpgPath = path.join(dir, `${basename}.cpg`);
  try {
    if (fsSync.existsSync(cpgPath)) {
      const raw = fsSync.readFileSync(cpgPath);
      let line =
        raw
          .toString('utf8')
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)[0]
          ?.trim() ?? '';
      if (!line && raw.length > 0) {
        line = raw.toString('ascii').split(/\r?\n/)[0]?.trim() ?? '';
      }
      if (line) {
        const norm = line.replace(/\s+/g, '').toUpperCase().replace(/_/g, '');
        const aliases: Record<string, string> = {
          UTF8: 'UTF-8',
          UTF8BIT: 'UTF-8',
          CP949: 'CP949',
          WINDOWS949: 'CP949',
          MS949: 'CP949',
          EUCKR: 'EUC-KR',
          KS56011987: 'EUC-KR',
          KSC56011987: 'EUC-KR',
          LATIN1: 'ISO-8859-1',
          ISO88591: 'ISO-8859-1',
        };
        if (aliases[norm]) return aliases[norm];
        if (/^UTF-?8$/i.test(line.trim())) return 'UTF-8';
        return line.trim();
      }
    }
  } catch {
    // ignore, fall through
  }
  if (fromEnv) return fromEnv;

  const autoOff = /^(0|false|no)$/i.test(process.env.GGNR_SHP_DBF_AUTO?.trim() ?? '');
  if (!autoOff) {
    const dbfPath = path.join(dir, `${basename}.dbf`);
    try {
      if (fsSync.existsSync(dbfPath)) {
        const buf = fsSync.readFileSync(dbfPath);
        const sample = sampleDbfRecordDataBytes(buf, 65536);
        if (sample.length > 0) return sniffDbfBytesEncoding(sample);
      }
    } catch {
      // ignore
    }
  }
  return 'CP949';
}

/**
 * SHP 파일 경로에서 좌표계(EPSG 코드) 조회. .prj → shp 파일명 → 상위 폴더명 순으로 파싱.
 * 동기화 상세 모달에서 변경값(SHP) 지도 뷰 중심용.
 */
export async function getShpEpsg(params: { pathOrResult: string }): Promise<{ success: boolean; epsg: number | null; error?: string }> {
  try {
    const absolutePath = path.join(GGNR_DATA_DIR, params.pathOrResult.replace(/\//g, path.sep));
    const dir = path.dirname(absolutePath);
    const basename = path.basename(absolutePath, '.shp');
    const folderName = path.basename(dir);

    let epsgStr: string | null = null;
    const prjPath = path.join(dir, `${basename}.prj`);
    const prjContent = await fs.readFile(prjPath, 'utf-8').catch(() => '');
    epsgStr = parseEpsgFromPrj(prjContent) ?? parseEpsgFromBasename(basename) ?? parseEpsgFromBasename(folderName);

    if (!epsgStr || !epsgStr.startsWith('EPSG:')) {
      return { success: true, epsg: null };
    }
    const num = parseInt(epsgStr.replace('EPSG:', ''), 10);
    return { success: true, epsg: Number.isFinite(num) ? num : null };
  } catch (e: unknown) {
    return { success: false, epsg: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ShpStatusRow = {
  sourceFile: string;
  pathOrResult: string;
  at: string;
  epsg: string | null;
  /** POINT / LINE / POLYGON (defineLayer 또는 SHP 파일에서 조회) */
  geometryType: ShpGeometryType | null;
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
};

const DEFINE_LAYER_FIELDS_DIR = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'fields');

function getDefineFieldsFilePath(tableKey: string): string {
  const safe = String(tableKey).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  return path.join(DEFINE_LAYER_FIELDS_DIR, `table_${safe}.json`);
}

/** PostGIS 테이블명: 영문/숫자/언더스코어만 (createTableFromShp와 동일 규칙) */
function safeTableName(basename: string): string {
  return (basename.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').toLowerCase()) || 'layer_table';
}

function equalsTableName(a: string, b: string): boolean {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function findLayerTableByName(
  tables: Array<{ schema: string; table: string }>,
  wanted: string
): { schema: string; table: string } | null {
  return tables.find((t) => t.schema === 'layer' && equalsTableName(t.table, wanted)) ?? null;
}

/**
 * shp_data 폴더(또는 하위 폴더) 내 .shp 파일 목록과 좌표계/Table/layer/style/Define 상태 반환.
 * @param params.relativePath - 현재 폴더 상대경로 (예: shp_data, shp_data/폴더명). 해당 폴더 안의 .shp만 반환.
 */
export async function getShpStatusList(params?: { relativePath?: string }): Promise<{
  rows: ShpStatusRow[];
  path: string;
}> {
  const baseShp = path.join(GGNR_DATA_DIR, 'shp_data');
  const relativePath = (params?.relativePath ?? 'shp_data').trim().replace(/^[/\\]+/, '');
  const dir = relativePath
    ? path.join(GGNR_DATA_DIR, relativePath)
    : baseShp;
  if (!dir.startsWith(baseShp)) {
    return { rows: [], path: baseShp };
  }
  const resultPath = dir;

  try {
    await fs.mkdir(path.join(GGNR_DATA_DIR, 'shp_data'), { recursive: true });
  } catch {
    // ignore
  }

  let entries: { name: string; mtime: Date }[] = [];
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return { rows: [], path: resultPath };
    }
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const e of list) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (ext !== '.shp') continue;
      const fullPath = path.join(dir, e.name);
      const st = await fs.stat(fullPath).catch(() => null);
      entries.push({ name: e.name, mtime: st?.mtime ?? new Date(0) });
    }
  } catch {
    return { rows: [], path: resultPath };
  }

  const baseUrl = GEOSERVER_DEFAULT_URL;
  let layerNames: string[] = [];
  let styleNames: string[] = [];
  try {
    const layerRes = await geoserverFetch(baseUrl, `/rest/workspaces/${WORKSPACE}/layers.json`);
    if (layerRes.ok) {
      const layerData = await layerRes.json();
      const raw = layerData?.layers?.layer ?? layerData?.layers ?? [];
      const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      layerNames = arr.map((l: { name?: string }) => l?.name ?? String(l));
    }
  } catch {
    // ignore
  }
  try {
    const styleRes = await geoserverFetch(baseUrl, '/rest/styles.json');
    if (styleRes.ok) {
      const styleData = await styleRes.json();
      const raw = styleData?.styles?.style ?? styleData?.style ?? [];
      const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      styleNames = arr.map((s: { name?: string; href?: string }) => s?.name ?? (s?.href ? s.href.replace(/.*\//, '').replace(/\.(css|sld)$/i, '') : ''));
    }
  } catch {
    // ignore
  }

  let layerTableSet: Set<string> = new Set();
  try {
    const listRes = await getLayerTableList();
    if (listRes.success && Array.isArray(listRes.tables)) {
      for (const t of listRes.tables) {
        if (t.schema === 'layer') layerTableSet.add(t.table);
      }
    }
  } catch {
    // ignore
  }

  let defineTableSet: Set<string> = new Set();
  const defineHasFields: Record<string, boolean> = {};
  try {
    const defineRes = await getDefineLayerTables();
    if (defineRes.success && Array.isArray(defineRes.tables)) {
      for (const row of defineRes.tables) {
        const name = String(row.define_table_name ?? '').trim();
        if (name) {
          defineTableSet.add(name);
          defineHasFields[name] = fsSync.existsSync(getDefineFieldsFilePath(name));
        }
      }
    }
  } catch {
    // ignore
  }

  let dbGeometryTypes: Record<string, ShpGeometryType> = {};
  try {
    const typeRes = await getLayerTableGeometryTypes();
    if (typeRes.success && typeRes.types) dbGeometryTypes = typeRes.types;
  } catch {
    // ignore
  }

  const rows: ShpStatusRow[] = [];
  for (const { name, mtime } of entries) {
    const basename = path.basename(name, '.shp');
    const pathOrResult = relativePath
      ? `${relativePath.replace(/\\/g, '/')}/${name}`
      : `shp_data/${name}`;

    let epsg: string | null = null;
    try {
      const prjPath = path.join(dir, `${basename}.prj`);
      const prjContent = await fs.readFile(prjPath, 'utf-8').catch(() => '');
      epsg = parseEpsgFromPrj(prjContent);
    } catch {
      // no .prj or read error
    }
    if (epsg == null) epsg = parseEpsgFromBasename(basename);

    const dbTableName = safeTableName(basename);
    const inDefine = defineTableSet.has(dbTableName) || defineTableSet.has(basename);
    const hasDefineFields = (defineHasFields[dbTableName] ?? defineHasFields[basename]) ?? false;
    const hasTable = layerTableSet.has(dbTableName);
    const geometryType = hasTable ? (dbGeometryTypes[dbTableName] ?? null) : null;

    rows.push({
      sourceFile: name,
      pathOrResult,
      at: mtime.toISOString(),
      epsg,
      geometryType,
      table: hasTable,
      layer: layerNames.includes(dbTableName) || layerNames.includes(basename),
      style: styleNames.includes(dbTableName) || styleNames.includes(basename),
      define: inDefine && hasDefineFields,
    });
  }

  rows.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
  return { rows, path: resultPath };
}

/** DB 연결 정보 (env 기준). layer 스키마용 */
function getDbConfig(): { host: string; port: number; database: string; user: string; password: string } {
  return {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'postgres',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
  };
}

/**
 * ogr2ogr 실행 방식: GGNR_GDAL_OGR2OGR → 프로젝트 python/env(conda run) → PATH
 * python/env 사용 시 conda run으로 실행해야 libpq 등 env 내 라이브러리를 찾을 수 있음.
 */
function resolveOgr2ogrRun(): { cmd: string; args: string[] } {
  const root = process.cwd();
  if (process.env.GGNR_GDAL_OGR2OGR) {
    const custom = path.resolve(root, process.env.GGNR_GDAL_OGR2OGR);
    const bin = fsSync.existsSync(custom) ? custom : process.env.GGNR_GDAL_OGR2OGR;
    return { cmd: bin, args: [] };
  }
  const pyEnv = process.env.GGNR_PIPELINE_PYTHON;
  if (pyEnv && pyEnv !== 'python') {
    const envDir = path.dirname(path.resolve(root, pyEnv));
    const isWin = process.platform === 'win32';
    const candidate = isWin
      ? path.join(envDir, 'Library', 'bin', 'ogr2ogr.exe')
      : path.join(envDir, 'bin', 'ogr2ogr');
    if (fsSync.existsSync(candidate)) {
      return { cmd: 'conda', args: ['run', '--no-capture-output', '--prefix', envDir, 'ogr2ogr'] };
    }
  }
  return { cmd: 'ogr2ogr', args: [] };
}

/** ogrinfo 실행 방식: ogr2ogr와 동일(conda env 또는 GGNR_GDAL 경로). 도구명만 ogrinfo */
function resolveOgrInfoRun(): { cmd: string; args: string[] } {
  const root = process.cwd();
  if (process.env.GGNR_GDAL_OGR2OGR) {
    const custom = path.resolve(root, process.env.GGNR_GDAL_OGR2OGR);
    const toDir = fsSync.existsSync(custom)
      ? (fsSync.statSync(custom).isFile() ? path.dirname(custom) : custom)
      : path.dirname(custom);
    const isWin = process.platform === 'win32';
    const ogrinfo = path.join(toDir, isWin ? 'ogrinfo.exe' : 'ogrinfo');
    if (fsSync.existsSync(ogrinfo)) return { cmd: ogrinfo, args: [] };
  }
  const pyEnv = process.env.GGNR_PIPELINE_PYTHON;
  if (pyEnv && pyEnv !== 'python') {
    const envDir = path.dirname(path.resolve(root, pyEnv));
    const isWin = process.platform === 'win32';
    const candidate = isWin
      ? path.join(envDir, 'Library', 'bin', 'ogrinfo.exe')
      : path.join(envDir, 'bin', 'ogrinfo');
    if (fsSync.existsSync(candidate)) {
      return { cmd: 'conda', args: ['run', '--no-capture-output', '--prefix', envDir, 'ogrinfo'] };
    }
  }
  return { cmd: 'ogrinfo', args: [] };
}

export type ShpGeometryType = 'POINT' | 'LINE' | 'POLYGON';

/**
 * SHP 파일의 지오메트리 타입을 ogrinfo로 조회. POINT/LINE/POLYGON 중 하나 반환.
 */
export async function getShpGeometryType(absoluteShpPath: string): Promise<ShpGeometryType> {
  const normalized = path.normalize(absoluteShpPath).replace(/\\/g, path.sep);
  if (!fsSync.existsSync(normalized)) return 'POLYGON';

  const { cmd: ogrinfoCmd, args: prefix } = resolveOgrInfoRun();
  const args = [...prefix, '-al', '-so', normalized];
  const isWin = process.platform === 'win32';
  const useConda = prefix.length > 0;
  const spawnCmd = useConda ? ogrinfoCmd : (isWin ? 'cmd.exe' : ogrinfoCmd);
  const spawnArgs = useConda ? args : (isWin ? ['/c', 'ogrinfo', ...args.slice(prefix.length)] : args);

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(spawnCmd, spawnArgs, { windowsHide: true, shell: false });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8')));
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8');
      resolve(code === 0 ? out : '');
    });
    child.on('error', reject);
  }).catch(() => '');

  const line = stdout.split(/\r?\n/).find((l) => /Geometry:\s*/i.test(l));
  if (!line) return 'POLYGON';
  const geom = line.replace(/Geometry:\s*/i, '').trim().toLowerCase();
  if (/point|multi\s*point/.test(geom)) return 'POINT';
  if (/line|curve|multi\s*line/.test(geom)) return 'LINE';
  if (/polygon|multi\s*polygon/.test(geom)) return 'POLYGON';
  return 'POLYGON';
}

/**
 * GDAL ogr2ogr로 SHP → PostGIS layer 스키마 테이블 생성
 * - ogr2ogr 실행 파일: GGNR_GDAL_OGR2OGR 환경변수 또는 PATH의 ogr2ogr
 */
export async function createTableFromShp(params: {
  pathOrResult: string;
}): Promise<{ success: boolean; error?: string }> {
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };

  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  const basename = path.basename(pathOrResult, '.shp');
  const normalizedName = safeTableName(basename);
  const tableName = safeTableName(basename);

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return { success: false, error: 'SHP 파일을 찾을 수 없습니다.' };
  } catch {
    return { success: false, error: 'SHP 파일을 찾을 수 없습니다.' };
  }

  const dir = path.dirname(absolutePath);
  const { sourceSrs, targetSrs } = await resolveShpSrs(dir, basename);
  const dbfEncoding = resolveShapefileDbfEncoding(dir, basename);

  const db = getDbConfig();
  const pgConnection = `PG:host=${db.host} port=${db.port} dbname=${db.database} user=${db.user} password=${db.password}`;
  const layerTable = `layer.${tableName}`;

  const { cmd: ogr2ogrCmd, args: ogr2ogrRunPrefix } = resolveOgr2ogrRun();
  const ogr2ogrArgs = [
    '-f', 'PostgreSQL',
    pgConnection,
    absolutePath,
    '-oo', `ENCODING=${dbfEncoding}`,
    '-nlt', 'PROMOTE_TO_MULTI',
    '-nln', layerTable,
    ...(sourceSrs ? ['-s_srs', sourceSrs] as const : []),
    '-t_srs', targetSrs,
    '-lco', 'GEOMETRY_NAME=geom',
    '-overwrite',
  ];
  const execArgs = ogr2ogrRunPrefix.length > 0 ? [...ogr2ogrRunPrefix, ...ogr2ogrArgs] : ogr2ogrArgs;

  /** Windows: ogr2ogr stderr는 보통 CP949. iconv-lite로 CP949 → 유니코드 후 JSON(UTF-8)으로 전달 */
  const decodeStderr = (chunk: Buffer | string): string => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    if (buf.length === 0) return '';
    if (process.platform === 'win32') {
      try {
        return iconv.decode(buf, 'cp949');
      } catch {
        return iconv.decode(buf, 'utf8');
      }
    }
    return iconv.decode(buf, 'utf8');
  };

  const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
    const isWin = process.platform === 'win32';
    const useConda = ogr2ogrRunPrefix.length > 0;
    const spawnCmd = useConda ? ogr2ogrCmd : (isWin ? 'cmd.exe' : ogr2ogrCmd);
    const spawnArgs = useConda ? execArgs : (isWin ? ['/c', ogr2ogrCmd, ...execArgs] : execArgs);
    const child = spawn(spawnCmd, spawnArgs, {
      windowsHide: true,
      shell: false,
    });
    const stderrChunks: Buffer[] = [];
    if (child.stderr) {
      child.stderr.on('data', (d) => stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8')));
    }
    child.on('close', (code) => {
      const stderr = stderrChunks.length ? decodeStderr(Buffer.concat(stderrChunks)) : '';
      resolve({ code: code ?? -1, stderr });
    });
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }));
  });

  if (result.code !== 0) {
    const raw = result.stderr?.trim() || `ogr2ogr 종료 코드 ${result.code}`;
    const notFound =
      /내부\s*또는\s*외부\s*명령|not recognized|not found|실행할 수 있는 프로그램|배치 파일이 아닙니다/i.test(raw);
    const noPgDriver = /Unable to find driver\s*[`']?PostgreSQL|PostgreSQL.*driver/i.test(raw);
    let error = raw;
    if (notFound) {
      error = `ogr2ogr를 찾을 수 없습니다. 프로젝트 python/env에 GDAL이 설치되어 있어야 합니다(개발자 모드 > LAS 파이프라인 환경 생성 및 설치). 또는 env에 GGNR_GDAL_OGR2OGR로 ogr2ogr 실행 파일 경로를 지정하세요.`;
    } else if (noPgDriver) {
      error = `GDAL에 PostgreSQL 드라이버가 없습니다. 반드시 프로젝트 루트(예: D:\\ggnr_v7)에서 아래 명령을 실행하세요. python 폴더 안에서 실행하면 안 됩니다.\n\n  conda run --prefix python/env conda install -c conda-forge libpq -y`;
    }
    return { success: false, error };
  }
  return { success: true };
}

const DEFINE_LAYER_TABLES_PATH = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'tables.json');

/** defineLayer tables.json 기본값 (기존 도로 레이어 등과 동일한 형태) */
const DEFINE_TABLE_DEFAULT_READ_SHARE = 'P';
const DEFINE_TABLE_DEFAULT_WRITE_SHARE = 'P';
const DEFINE_TABLE_DEFAULT_IDX = '0';
const DEFINE_TABLE_DEFAULT_ETC = '';

function buildShpDefineLayerTableRow(
  layerName: string,
  shpType: string,
  group: string,
  dbSchema: 'layer' | 'public_layer' = 'layer'
): Record<string, unknown> {
  return reorderDefineLayerTableRow({
    define_table_name: layerName,
    define_table_kor_name: layerName,
    define_table_shp_type: shpType,
    define_table_read_share: DEFINE_TABLE_DEFAULT_READ_SHARE,
    define_table_write_share: DEFINE_TABLE_DEFAULT_WRITE_SHARE,
    define_table_group: group,
    define_table_idx: DEFINE_TABLE_DEFAULT_IDX,
    define_table_etc: DEFINE_TABLE_DEFAULT_ETC,
    define_table_schema: dbSchema,
    define_table_source: 'shp',
  });
}

function ensureDefineLayerEntry(
  layerName: string,
  geometryType?: ShpGeometryType,
  group?: string,
  dbSchema: 'layer' | 'public_layer' = 'layer'
): Promise<void> {
  const shpType = geometryType ?? 'POLYGON';
  const groupVal = group ?? '';
  return getDefineLayerTables().then((defineRes) => {
    let tables: Record<string, unknown>[] = defineRes.success && Array.isArray(defineRes.tables) ? defineRes.tables : [];
    const existing = tables.find(
      (r) => String(r.define_table_name ?? '').trim().toLowerCase() === layerName.toLowerCase()
    );
    if (!existing) {
      tables = reorderDefineLayerTablesArray([
        ...tables,
        buildShpDefineLayerTableRow(layerName, shpType, groupVal, dbSchema),
      ]);
      return fs.mkdir(path.dirname(DEFINE_LAYER_TABLES_PATH), { recursive: true }).then(() =>
        fs.writeFile(DEFINE_LAYER_TABLES_PATH, JSON.stringify(tables, null, 2), 'utf-8')
      );
    }
    const row = existing as Record<string, unknown>;
    let mutated = false;
    if (groupVal && !String(row.define_table_group ?? '').trim()) {
      row.define_table_group = groupVal;
      mutated = true;
    }
    if (!('define_table_read_share' in row)) {
      row.define_table_read_share = DEFINE_TABLE_DEFAULT_READ_SHARE;
      mutated = true;
    }
    if (!('define_table_write_share' in row)) {
      row.define_table_write_share = DEFINE_TABLE_DEFAULT_WRITE_SHARE;
      mutated = true;
    }
    if (!('define_table_etc' in row)) {
      row.define_table_etc = DEFINE_TABLE_DEFAULT_ETC;
      mutated = true;
    }
    if (row.define_table_idx === 999) {
      row.define_table_idx = DEFINE_TABLE_DEFAULT_IDX;
      mutated = true;
    }
    const srcNorm = String(row.define_table_source ?? '').toLowerCase();
    if (srcNorm !== 'excel' && row.define_table_source !== 'shp') {
      row.define_table_source = 'shp';
      mutated = true;
    }
    if (!String(row.define_table_schema ?? '').trim()) {
      row.define_table_schema = dbSchema;
      mutated = true;
    }
    if (mutated) {
      return fs.writeFile(
        DEFINE_LAYER_TABLES_PATH,
        JSON.stringify(reorderDefineLayerTablesArray(tables), null, 2),
        'utf-8'
      );
    }
  });
}

function mapDataTypeToDefineFieldType(dataType: string): string {
  const t = dataType.toLowerCase();
  if (/int|smallint|bigint|serial/.test(t)) return 'integer';
  if (/float|double|real|numeric|decimal/.test(t)) return 'number';
  if (/date|time/.test(t)) return 'date';
  if (/geom|geography/.test(t)) return 'text';
  return 'text';
}

function buildDefaultField(col: { name: string; dataType: string }, idx: number): Record<string, unknown> {
  const fn = String(col.name ?? '').toLowerCase();
  return {
    define_field_name: fn,
    define_field_kor_name: fn,
    define_field_type: mapDataTypeToDefineFieldType(col.dataType),
    define_field_idx: idx,
    define_field_is_required: false,
    define_field_show_search: false,
    define_field_show_list: true,
    define_field_show_detail: true,
    define_field_read_only: false,
    define_field_is_key: false,
    define_field_show_search_detail: false,
    define_field_max_length: '',
    define_field_sort_idx: '',
    define_field_sort_type: '',
    define_field_sel_list: '',
    define_field_sel_table: '',
    define_field_sel_query: '',
    define_field_sel_url: '',
    define_field_show_detail_list: false,
    define_field_sel_key_field: '',
    define_field_sel_label_field: '',
    define_field_default_value: '',
    define_field_show_title: false,
  };
}

/**
 * defineLayer Table(tables.json) + Field(fields/table_xxx.json) 자동 생성.
 * - layer / public_layer 스키마에 해당 테이블이 있어야 함.
 * - tables.json에 없으면 항목 추가 (이미 있으면 스킵).
 * - fields: 기존 파일이 있으면 DB 컬럼 중 기존에 없는 것만 추가(upsert). 없으면 전체 생성.
 */
async function createDefineTableAndFieldsCore(params: {
  layerName: string;
  dbSchema: 'layer' | 'public_layer';
  geometryType?: ShpGeometryType;
  group?: string;
}): Promise<{ success: boolean; error?: string }> {
  const rawName = params.layerName?.trim();
  if (!rawName) return { success: false, error: 'layerName(테이블명)이 필요합니다.' };
  const layerName = safeTableName(rawName);
  const dbSchema = params.dbSchema;

  const listRes = await getLayerTableList();
  if (!listRes.success || !listRes.tables) {
    return { success: false, error: listRes.error ?? 'DB 테이블 목록을 가져올 수 없습니다.' };
  }
  const matched = listRes.tables.find((t) => t.schema === dbSchema && equalsTableName(t.table, layerName));
  if (!matched) {
    return {
      success: false,
      error: `${dbSchema} 스키마에 '${layerName}' 테이블이 없습니다. 먼저 테이블 생성을 실행하세요.`,
    };
  }
  const dbLayerTableName = matched.table;

  let geometryType = params.geometryType ?? null;
  if (geometryType === null) {
    const typeRes = await getLayerTableGeometryTypes({ schema: dbSchema });
    if (typeRes.success) {
      geometryType =
        typeRes.types[layerName] ??
        typeRes.types[layerName.toLowerCase()] ??
        typeRes.types[dbLayerTableName] ??
        null;
    }
  }

  try {
    await ensureDefineLayerEntry(dbLayerTableName, geometryType ?? 'POLYGON', params.group, dbSchema);

    const colRes = await getTableColumnInfo({ schema: dbSchema, table: dbLayerTableName });
    if (!colRes.success || !colRes.columns?.length) {
      return { success: false, error: colRes.error ?? '컬럼 정보를 가져올 수 없습니다.' };
    }

    const fieldsPath = getDefineFieldsFilePath(dbLayerTableName);
    await fs.mkdir(path.dirname(fieldsPath), { recursive: true });

    let existing: Record<string, unknown>[] = [];
    try {
      const raw = await fs.readFile(fieldsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      // file doesn't exist
    }

    const existingNames = new Set(existing.map((f) => String(f.define_field_name ?? '').trim().toLowerCase()));
    const maxIdx = existing.reduce((m, f) => Math.max(m, Number(f.define_field_idx ?? 0) || 0), 0);
    let nextIdx = maxIdx + 1;

    const newFields: Record<string, unknown>[] = [];
    for (const col of colRes.columns) {
      if (!existingNames.has(col.name.toLowerCase())) {
        newFields.push(buildDefaultField(col, nextIdx++));
      }
    }

    const merged = [...existing, ...newFields];
    await fs.writeFile(fieldsPath, JSON.stringify(merged, null, 2), 'utf-8');

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

export async function createDefineTableAndFields(params: {
  pathOrResult: string;
  geometryType?: ShpGeometryType;
  group?: string;
}): Promise<{ success: boolean; error?: string }> {
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };

  const basename = path.basename(pathOrResult, '.shp');
  const layerName = safeTableName(basename);
  return createDefineTableAndFieldsCore({
    layerName,
    dbSchema: 'layer',
    geometryType: params.geometryType,
    group: params.group,
  });
}

/**
 * 레이어 상태 화면 등: DB 테이블명으로 defineLayer(tables + fields) 생성/보강.
 */
export async function createDefineTableAndFieldsByTableName(params: {
  tableName: string;
  dbSchema?: 'layer' | 'public_layer';
  geometryType?: ShpGeometryType;
  group?: string;
}): Promise<{ success: boolean; error?: string }> {
  const dbSchema = params.dbSchema === 'public_layer' ? 'public_layer' : 'layer';
  return createDefineTableAndFieldsCore({
    layerName: params.tableName,
    dbSchema,
    geometryType: params.geometryType,
    group: params.group,
  });
}

/**
 * GeoServer 레이어만 생성 (FeatureType 발행). defineLayer 없으면 최소 항목 추가.
 * - 테이블이 layer 스키마에 있어야 함.
 * - geometryType 미지정 시 SHP 파일에서 감지. 지정 시 해당 타입 사용(테이블 옆 Type 열 정보와 동일).
 */
export async function createGeoServerLayer(params: {
  pathOrResult: string;
  url?: string;
  geometryType?: ShpGeometryType;
  group?: string;
}): Promise<{ success: boolean; error?: string }> {
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };

  const basename = path.basename(pathOrResult, '.shp');
  const layerName = safeTableName(basename);
  const absoluteShp = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));

  const listRes = await getLayerTableList();
  if (!listRes.success || !listRes.tables) {
    return { success: false, error: listRes.error ?? 'DB 테이블 목록을 가져올 수 없습니다.' };
  }
  const matched = findLayerTableByName(listRes.tables, layerName);
  if (!matched) {
    return { success: false, error: `layer 스키마에 '${layerName}' 테이블이 없습니다. 먼저 테이블 생성을 실행하세요.` };
  }

  try {
    const geometryType = params.geometryType ?? (await getShpGeometryType(absoluteShp));
    await ensureDefineLayerEntry(layerName, geometryType, params.group);
    const layerRes = await createOrUpdateGeoServerLayer({ layerName, url: params?.url });
    if (!layerRes.success) return { success: false, error: layerRes.error };
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * GeoServer 스타일만 생성 및 해당 레이어에 기본 스타일로 지정.
 * - 레이어가 GeoServer에 이미 발행되어 있어야 함.
 * - geometryType 미지정 시 SHP에서 감지. 지정 시 해당 타입 사용(테이블 옆 Type 열 정보와 동일).
 */
export async function createGeoServerStyleForShp(params: {
  pathOrResult: string;
  url?: string;
  geometryType?: ShpGeometryType;
  group?: string;
}): Promise<{ success: boolean; error?: string }> {
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };

  const basename = path.basename(pathOrResult, '.shp');
  const layerName = safeTableName(basename);
  const absoluteShp = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));

  try {
    const geometryType = params.geometryType ?? (await getShpGeometryType(absoluteShp));
    await ensureDefineLayerEntry(layerName, geometryType, params.group);
    const styleRes = await applyDefaultStyleToLayer({ layerName, url: params?.url });
    if (!styleRes.success) return { success: false, error: styleRes.error };
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * 레이어 상태 탭 등: SHP 경로 없이 테이블명으로 GeoServer FeatureType 발행.
 * - tables.json 최소 항목이 없으면 추가
 */
export async function createGeoServerLayerForTableName(params: {
  tableName: string;
  dbSchema?: 'layer' | 'public_layer';
  url?: string;
  geometryType?: ShpGeometryType;
  group?: string;
}): Promise<{ success: boolean; error?: string }> {
  const raw = params.tableName?.trim();
  if (!raw) return { success: false, error: 'tableName이 필요합니다.' };
  const layerName = safeTableName(raw);
  const dbSchema = params.dbSchema === 'public_layer' ? 'public_layer' : 'layer';

  const listRes = await getLayerTableList();
  if (!listRes.success || !listRes.tables) {
    return { success: false, error: listRes.error ?? 'DB 테이블 목록을 가져올 수 없습니다.' };
  }
  const matched = listRes.tables.find((t) => t.schema === dbSchema && equalsTableName(t.table, layerName));
  if (!matched) {
    return {
      success: false,
      error: `${dbSchema} 스키마에 '${layerName}' 테이블이 없습니다.`,
    };
  }

  let geometryType: ShpGeometryType | null = params.geometryType ?? null;
  if (!geometryType) {
    const typeRes = await getLayerTableGeometryTypes({ schema: dbSchema });
    if (typeRes.success) {
      geometryType =
        typeRes.types[matched.table] ??
        typeRes.types[matched.table.toLowerCase()] ??
        null;
    }
  }

  try {
    await ensureDefineLayerEntry(matched.table, geometryType ?? 'POLYGON', params.group, dbSchema);
    const layerRes = await createOrUpdateGeoServerLayer({ layerName: matched.table, url: params.url });
    if (!layerRes.success) return { success: false, error: layerRes.error };
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 레이어 상태 탭 등: 테이블명으로 GeoServer CSS 스타일 생성 후 레이어 기본 스타일 지정.
 * - GeoServer에 레이어(FeatureType)가 먼저 있어야 정상 동작
 */
export async function createGeoServerStyleForTableName(params: {
  tableName: string;
  dbSchema?: 'layer' | 'public_layer';
  url?: string;
  geometryType?: ShpGeometryType;
  group?: string;
}): Promise<{ success: boolean; error?: string }> {
  const raw = params.tableName?.trim();
  if (!raw) return { success: false, error: 'tableName이 필요합니다.' };
  const layerName = safeTableName(raw);
  const dbSchema = params.dbSchema === 'public_layer' ? 'public_layer' : 'layer';

  const listRes = await getLayerTableList();
  if (!listRes.success || !listRes.tables) {
    return { success: false, error: listRes.error ?? 'DB 테이블 목록을 가져올 수 없습니다.' };
  }
  const matched = listRes.tables.find((t) => t.schema === dbSchema && equalsTableName(t.table, layerName));
  if (!matched) {
    return {
      success: false,
      error: `${dbSchema} 스키마에 '${layerName}' 테이블이 없습니다.`,
    };
  }

  let geometryType: ShpGeometryType | null = params.geometryType ?? null;
  if (!geometryType) {
    const typeRes = await getLayerTableGeometryTypes({ schema: dbSchema });
    if (typeRes.success) {
      geometryType =
        typeRes.types[matched.table] ??
        typeRes.types[matched.table.toLowerCase()] ??
        null;
    }
  }

  try {
    await ensureDefineLayerEntry(matched.table, geometryType ?? 'POLYGON', params.group, dbSchema);
    const styleRes = await applyDefaultStyleToLayer({ layerName: matched.table, url: params.url });
    if (!styleRes.success) return { success: false, error: styleRes.error };
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ShpBatchResultItem = {
  file: string;
  /** 상대 경로 (GGNR_DATA_DIR 기준). 이력 dhShpPath 저장 및 동기화 상세 변경값 지도 좌표계용 */
  pathOrResult?: string;
  table: { success: boolean; skipped?: boolean; error?: string };
  layer: { success: boolean; skipped?: boolean; error?: string };
  style: { success: boolean; skipped?: boolean; error?: string };
  define: { success: boolean; skipped?: boolean; error?: string };
};

/**
 * 업로드 완료 후 일괄 후처리: 지정된 .shp 상대경로 목록에 대해 table → layer → style → define 순차 생성.
 * - shpPaths 가 있으면 해당 파일들만 처리 (업로드 직후 호출용)
 * - shpPaths 가 없으면 relativePath 폴더 기준 getShpStatusList 로 목록 조회
 * - table: 이미 있으면 스킵 (향후 예외처리 예정)
 * - layer/style: GeoServer에 이미 있으면 스킵
 * - define table: tables.json에 이미 있으면 스킵
 * - define field: upsert (기존에 없는 컬럼만 추가)
 */
export async function processShpBatch(params: {
  relativePath?: string;
  shpPaths?: string[];
}): Promise<{ success: boolean; results: ShpBatchResultItem[]; error?: string }> {
  let rows: ShpStatusRow[];

  if (params.shpPaths && params.shpPaths.length > 0) {
    const uniqueDirs = new Set<string>();
    for (const p of params.shpPaths) {
      const dir = p.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
      uniqueDirs.add(dir || 'shp_data');
    }
    const allRows: ShpStatusRow[] = [];
    for (const dir of uniqueDirs) {
      const statusRes = await getShpStatusList({ relativePath: dir });
      allRows.push(...statusRes.rows);
    }
    const pathSet = new Set(params.shpPaths.map((p) => p.replace(/\\/g, '/')));
    rows = allRows.filter((r) => pathSet.has(r.pathOrResult.replace(/\\/g, '/')));
  } else {
    const statusRes = await getShpStatusList(params);
    rows = statusRes.rows;
  }

  if (rows.length === 0) return { success: true, results: [] };

  const results: ShpBatchResultItem[] = [];

  for (const row of rows) {
    const item: ShpBatchResultItem = {
      file: row.sourceFile,
      pathOrResult: row.pathOrResult,
      table: { success: false },
      layer: { success: false },
      style: { success: false },
      define: { success: false },
    };

    // 1. Table
    if (row.table) {
      item.table = { success: true, skipped: true };
    } else {
      const res = await createTableFromShp({ pathOrResult: row.pathOrResult });
      item.table = { success: res.success, error: res.error };
      if (!res.success) {
        results.push(item);
        continue;
      }
    }

    // DB에서 geometryType 가져오기
    let geometryType: ShpGeometryType | undefined;
    try {
      const typeRes = await getLayerTableGeometryTypes();
      const layerName = safeTableName(path.basename(row.sourceFile, '.shp'));
      if (typeRes.success) {
        geometryType =
          typeRes.types[layerName] ??
          typeRes.types[layerName.toLowerCase()] ??
          undefined;
      }
    } catch { /* ignore */ }

    // 2. Layer (Table 완료 후에만 실행)
    if (row.layer) {
      item.layer = { success: true, skipped: true };
    } else {
      const res = await createGeoServerLayer({ pathOrResult: row.pathOrResult, geometryType });
      item.layer = { success: res.success, error: res.error };
    }

    // 레이어 실패 시 이후 GeoServer 단계는 건너뜀 (순차 파이프라인 보장)
    if (!item.layer.success) {
      item.style = { success: false, skipped: true, error: '레이어 생성 실패로 스타일 단계를 건너뜀' };
      const defRes = await createDefineTableAndFields({ pathOrResult: row.pathOrResult, geometryType });
      item.define = { success: defRes.success, skipped: row.define, error: defRes.error };
      results.push(item);
      continue;
    }

    // 3. Style
    if (row.style) {
      item.style = { success: true, skipped: true };
    } else {
      const res = await createGeoServerStyleForShp({ pathOrResult: row.pathOrResult, geometryType });
      item.style = { success: res.success, error: res.error };
    }

    // 4. Define (table + field upsert)
    const res = await createDefineTableAndFields({ pathOrResult: row.pathOrResult, geometryType });
    item.define = { success: res.success, skipped: row.define, error: res.error };

    results.push(item);
  }

  const allSuccess = results.every((r) => r.table.success && r.layer.success && r.style.success && r.define.success);

  try {
    const { createLayerHistory, createLayerDetailHistoryBatch } = await import('./layerHistoryService');
    const successCount = results.filter((r) => r.table.success && r.layer.success && r.style.success && r.define.success).length;
    const failCount = results.length - successCount;
    const contents = results.map((r) => path.basename(r.file, '.shp')).join(', ');
    const histRes = await createLayerHistory({
      contents: contents.length > 500 ? contents.slice(0, 497) + '…' : contents,
      successCount,
      failCount,
    });
    if (histRes.success && histRes.lhKey) {
      const details = results.map((r) => {
        const allOk = r.table.success && r.layer.success && r.style.success && r.define.success;
        const errors: string[] = [];
        if (!r.table.success && !r.table.skipped) errors.push(`Table: ${r.table.error ?? '실패'}`);
        if (!r.layer.success && !r.layer.skipped) errors.push(`Layer: ${r.layer.error ?? '실패'}`);
        if (!r.style.success && !r.style.skipped) errors.push(`Style: ${r.style.error ?? '실패'}`);
        if (!r.define.success && !r.define.skipped) errors.push(`Define: ${r.define.error ?? '실패'}`);
        const basename = path.basename(r.file, '.shp');
        return {
          name: basename,
          korName: basename,
          type: r.table.skipped ? '업데이트' : '신규',
          contents: allOk ? '모두 완료' : errors.join(' / '),
          result: allOk ? '성공' : '실패',
          shpPath: r.pathOrResult ?? undefined,
        };
      });
      await createLayerDetailHistoryBatch({ lhKey: histRes.lhKey, details });
    }
  } catch {
    // 이력 저장 실패 시 무시 (핵심 처리는 완료)
  }

  return { success: allSuccess, results };
}

/**
 * SHP 후처리: GeoServer에 외부 Shapefile 데이터스토어 추가 및 레이어·스타일 생성
 */
export async function runShpPostProcess(params: {
  pathOrResult: string;
  url?: string;
}): Promise<{ success: boolean; error?: string }> {
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };

  const baseUrl = (params?.url ?? GEOSERVER_DEFAULT_URL).replace(/\/$/, '');
  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  const basename = path.basename(pathOrResult, '.shp');
  const normalizedName = safeTableName(basename);

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return { success: false, error: 'SHP 파일을 찾을 수 없습니다.' };
    const dir = path.dirname(absolutePath);
    const shpPath = path.join(dir, `${basename}.shp`);
    const bodyPath =
      process.platform === 'win32'
        ? `file:///${shpPath.replace(/\\/g, '/')}`
        : `file://${shpPath}`;

    // PUT .../datastores/{name}/external — body = file:// URL to .shp
    const putRes = await geoserverFetch(
      baseUrl,
      `/rest/workspaces/${WORKSPACE}/datastores/${encodeURIComponent(normalizedName)}/external`,
      {
        method: 'PUT',
        contentType: 'text/plain',
        body: bodyPath,
        accept: 'application/json',
      }
    );

    if (!putRes.ok) {
      const text = await putRes.text();
      return { success: false, error: `데이터스토어/레이어 생성 실패: ${putRes.status} ${text}` };
    }

    // 스타일 생성 및 레이어에 기본 스타일 지정 (devTestService 유사 로직)
    const { createGeoServerStyle, setLayerDefaultStyle } = await import('./devTestService');
    const styleRes = await createGeoServerStyle({
      url: baseUrl,
      name: normalizedName,
      geometryType: 'POLYGON',
      styleProps: {
        fillColor: '#4a90d9',
        strokeColor: '#ffffff',
        strokeWidth: 1,
        opacity: 0.3,
      },
    });
    if (!styleRes.success) {
      return { success: true, error: undefined }; // 레이어는 생성됐을 수 있음
    }
    const setRes = await setLayerDefaultStyle({
      url: baseUrl,
      workspace: WORKSPACE,
      layerName: normalizedName,
      styleName: normalizedName,
    });
    if (!setRes.success) {
      return { success: true, error: undefined };
    }
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

/**
 * 후처리 결과를 shp_data 폴더 내 로그 파일로 저장.
 * 파일명: postprocess_YYYYMMDD_HHmmss.log
 */
export async function savePostProcessLog(params: {
  relativePath?: string;
  results: Array<{
    file: string;
    table: string;
    layer: string;
    style: string;
    define: string;
    error?: string;
    oldData?: number;
    newData?: number;
    appendCount?: number;
    conflictCount?: number;
    removeCount?: number;
  }>;
}): Promise<{ success: boolean; logPath?: string; error?: string }> {
  try {
    const rp = (params.relativePath ?? 'shp_data').trim().replace(/^[/\\]+/, '');
    const dir = path.join(GGNR_DATA_DIR, rp);
    await fs.mkdir(dir, { recursive: true });

    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const logName = `postprocess_${ts}.log`;
    const logPath = path.join(dir, logName);

    const statusLabel = (s: string) => {
      if (s === 'created') return '생성';
      if (s === 'existed') return '기존';
      if (s === 'fail') return '실패';
      return s;
    };

    const lines: string[] = [];
    lines.push('=== SHP 후처리 결과 ===');
    lines.push(`일시: ${now.toLocaleString('ko-KR')}`);
    lines.push(`경로: ${rp}`);
    lines.push(`총 ${params.results.length}건`);
    lines.push('');

    const successCount = params.results.filter((r) => r.table !== 'fail' && r.layer !== 'fail' && r.style !== 'fail' && r.define !== 'fail').length;
    const failCount = params.results.length - successCount;
    lines.push(`성공: ${successCount}건 / 실패: ${failCount}건`);
    lines.push('');
    lines.push('\u2500'.repeat(120));
    lines.push(
      `${'파일'.padEnd(26)}${'Table'.padEnd(8)}${'Layer'.padEnd(8)}${'Style'.padEnd(8)}${'Define'.padEnd(8)}${'이전'.padEnd(8)}${'현재'.padEnd(8)}${'추가'.padEnd(8)}${'변경'.padEnd(8)}${'삭제'.padEnd(8)}비고`
    );
    lines.push('\u2500'.repeat(120));

    const num = (n: number | undefined) => (n === undefined ? '—' : String(n));

    for (const r of params.results) {
      const name = r.file.replace(/\.shp$/i, '');
      const line = `${name.padEnd(26)}${statusLabel(r.table).padEnd(8)}${statusLabel(r.layer).padEnd(8)}${statusLabel(r.style).padEnd(8)}${statusLabel(r.define).padEnd(8)}${num(r.oldData).padEnd(8)}${num(r.newData).padEnd(8)}${num(r.appendCount).padEnd(8)}${num(r.conflictCount).padEnd(8)}${num(r.removeCount).padEnd(8)}${r.error ?? ''}`;
      lines.push(line);
    }

    lines.push('\u2500'.repeat(120));
    lines.push('');

    await fs.writeFile(logPath, lines.join('\n'), 'utf-8');
    return { success: true, logPath: path.relative(GGNR_DATA_DIR, logPath).replace(/\\/g, '/') };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

export type LayerStatusRow = {
  tableName: string;
  korName: string;
  group: string;
  geometryType: 'POINT' | 'LINE' | 'POLYGON' | null;
  shpType: string;
  table: boolean;
  layer: boolean;
  style: boolean;
  define: boolean;
  updatedAt: string | null;
  /** DB 스키마 (레이어 상태 필터용) */
  dbSchema: 'layer' | 'public_layer';
};

/**
 * layer 또는 public_layer 스키마 테이블 기준 레이어 상태 목록.
 * DB table, GeoServer layer/style, defineLayer 존재 여부를 종합.
 */
export async function getLayerStatusList(params?: {
  schema?: 'layer' | 'public_layer';
}): Promise<{
  success: boolean;
  rows: LayerStatusRow[];
  error?: string;
}> {
  const dbSchema = params?.schema === 'public_layer' ? 'public_layer' : 'layer';
  try {
    const [tableListRes, geomTypesRes, defineRes] = await Promise.all([
      getLayerTableList(),
      getLayerTableGeometryTypes({ schema: dbSchema }),
      getDefineLayerTables(),
    ]);

    const layerTables = (tableListRes.tables ?? []).filter((t) => t.schema === dbSchema);
    const geomTypes = geomTypesRes.success ? geomTypesRes.types : {};

    const defineMap = new Map<string, { korName: string; group: string; shpType: string }>();
    const defineFieldSet = new Set<string>();
    const excelSourceTableSet = new Set<string>();
    if (defineRes.success && Array.isArray(defineRes.tables)) {
      for (const row of defineRes.tables) {
        const name = String(row.define_table_name ?? '').trim();
        if (!name) continue;
        if (String((row as Record<string, unknown>).define_table_source ?? '').toLowerCase() === 'excel') {
          excelSourceTableSet.add(name);
        }
        defineMap.set(name, {
          korName: String(row.define_table_kor_name ?? '').trim() || name,
          group: String(row.define_table_group ?? '').trim(),
          shpType: String(row.define_table_shp_type ?? '').trim(),
        });
        if (fsSync.existsSync(getDefineFieldsFilePath(name))) {
          defineFieldSet.add(name);
        }
      }
    }

    const baseUrl = GEOSERVER_DEFAULT_URL;
    let geoLayerSet = new Set<string>();
    let geoStyleSet = new Set<string>();
    try {
      const lr = await geoserverFetch(baseUrl, `/rest/workspaces/${WORKSPACE}/layers.json`);
      if (lr.ok) {
        const ld = await lr.json();
        const arr = ld?.layers?.layer ?? ld?.layers ?? [];
        geoLayerSet = new Set((Array.isArray(arr) ? arr : []).map((l: { name?: string }) => l?.name ?? String(l)));
      }
    } catch { /* ignore */ }
    try {
      const sr = await geoserverFetch(baseUrl, '/rest/styles.json');
      if (sr.ok) {
        const sd = await sr.json();
        const arr = sd?.styles?.style ?? sd?.style ?? [];
        geoStyleSet = new Set(
          (Array.isArray(arr) ? arr : []).map((s: { name?: string }) => s?.name ?? '')
        );
      }
    } catch { /* ignore */ }

    let updateDates: Record<string, string> = {};
    try {
      const { db } = await import('@/database/db');
      const { sql } = await import('drizzle-orm');
      const res = await db.execute(
        sql`SELECT dh_name, MAX(lh.lh_create_date) AS last_date
            FROM layer_detail_history dh
            JOIN layer_history lh ON dh.dh_lh_key = lh.lh_key
            WHERE dh.dh_result IN ('성공', '대기')
            GROUP BY dh_name`
      );
      for (const r of (res.rows as Array<{ dh_name: string; last_date: string }>) ?? []) {
        if (r.dh_name) updateDates[r.dh_name.toLowerCase()] = r.last_date;
      }
    } catch { /* ignore */ }

    let rows: LayerStatusRow[] = layerTables
      .filter((t) => dbSchema === 'public_layer' || !excelSourceTableSet.has(t.table))
      .map((t) => {
        const def = defineMap.get(t.table);
        return {
          tableName: t.table,
          korName: def?.korName ?? t.table,
          group: def?.group ?? '',
          geometryType: geomTypes[t.table] ?? null,
          shpType: def?.shpType ?? '',
          table: true,
          layer: geoLayerSet.has(t.table),
          style: geoStyleSet.has(t.table),
          define: defineMap.has(t.table) && defineFieldSet.has(t.table),
          updatedAt: updateDates[t.table.toLowerCase()] ?? null,
          dbSchema,
        };
      });

    rows.sort((a, b) => (a.group || 'zzz').localeCompare(b.group || 'zzz') || a.tableName.localeCompare(b.tableName));
    return { success: true, rows };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, rows: [], error: msg };
  }
}

/* ---------- SHP-DB 스마트 동기화 ---------- */

/** defineLayer fields에서 key 필드명 조회 */
function getKeyFieldName(tableName: string): string | null {
  const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const filePath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${safe}.json`);
  try {
    if (!fsSync.existsSync(filePath)) return null;
    const fields: Record<string, string>[] = JSON.parse(fsSync.readFileSync(filePath, 'utf-8'));
    const keyField = Array.isArray(fields)
      ? fields.find((f) => String(f?.define_field_is_key ?? '').toLowerCase() === 'true')
      : null;
    return keyField ? String(keyField.define_field_name ?? '').trim() || null : null;
  } catch {
    return null;
  }
}

/** defineLayer fields에서 title(show_title) 필드명 조회 */
export async function getTitleFieldName(params: { tableName: string }): Promise<{ success: boolean; titleField: string | null; error?: string }> {
  const tableName = params?.tableName?.trim();
  if (!tableName) return { success: false, titleField: null, error: 'tableName이 필요합니다.' };
  try {
    const safe = tableName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
    const filePath = path.join(DEFINE_LAYER_FIELDS_DIR, `table_${safe}.json`);
    if (!fsSync.existsSync(filePath)) return { success: true, titleField: null };
    const fields: Record<string, string>[] = JSON.parse(fsSync.readFileSync(filePath, 'utf-8'));
    const titleField = Array.isArray(fields)
      ? fields.find((f) => String(f?.define_field_show_title ?? '').toLowerCase() === 'true')
      : null;
    const name = titleField ? String(titleField.define_field_name ?? '').trim() || null : null;
    return { success: true, titleField: name };
  } catch (e: unknown) {
    return { success: false, titleField: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** ogr2ogr 실행 공통 래퍼 (createTableFromShp와 동일한 stderr 디코딩) */
async function runOgr2ogr(ogr2ogrArgs: string[]): Promise<{ code: number; stderr: string }> {
  const { cmd: ogr2ogrCmd, args: ogr2ogrRunPrefix } = resolveOgr2ogrRun();
  const execArgs = ogr2ogrRunPrefix.length > 0 ? [...ogr2ogrRunPrefix, ...ogr2ogrArgs] : ogr2ogrArgs;

  const decodeStderr = (chunk: Buffer | string): string => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    if (buf.length === 0) return '';
    if (process.platform === 'win32') {
      try { return iconv.decode(buf, 'cp949'); } catch { return iconv.decode(buf, 'utf8'); }
    }
    return iconv.decode(buf, 'utf8');
  };

  return new Promise<{ code: number; stderr: string }>((resolve) => {
    const isWin = process.platform === 'win32';
    const useConda = ogr2ogrRunPrefix.length > 0;
    const spawnCmd = useConda ? ogr2ogrCmd : (isWin ? 'cmd.exe' : ogr2ogrCmd);
    const spawnArgs = useConda ? execArgs : (isWin ? ['/c', ogr2ogrCmd, ...execArgs] : execArgs);
    const child = spawn(spawnCmd, spawnArgs, { windowsHide: true, shell: false });
    const stderrChunks: Buffer[] = [];
    if (child.stderr) {
      child.stderr.on('data', (d) => stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8')));
    }
    child.on('close', (code) => {
      const stderr = stderrChunks.length ? decodeStderr(Buffer.concat(stderrChunks)) : '';
      resolve({ code: code ?? -1, stderr });
    });
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }));
  });
}

export type SyncConflictRow = {
  key: string;
  diffFields: string[];
  dbValues: Record<string, unknown>;
  shpValues: Record<string, unknown>;
};

export type SyncRemoveRow = {
  key: string;
  values: Record<string, unknown>;
};

export type CompareResult = {
  success: boolean;
  tableName?: string;
  keyField?: string;
  columns?: string[];
  appendCount: number;
  conflictCount: number;
  removeCount: number;
  unchangedCount: number;
  conflicts: SyncConflictRow[];
  removes: SyncRemoveRow[];
  error?: string;
};

export type ShpSchemaField = { name: string; ogrType: string };

export type ShpSchemaCompareResult = {
  success: boolean;
  ok: boolean;
  isNew: boolean;
  sourceFile: string;
  pathOrResult: string;
  tableName: string;
  shpFields: ShpSchemaField[];
  dbFields: Array<{ name: string; dataType: string }>;
  missingInDb: string[];
  missingInShp: string[];
  typeMismatches: Array<{ name: string; shpType: string; dbType: string }>;
  message?: string;
  error?: string;
};

const DB_SCHEMA_SKIP_COLUMNS = new Set(['ogc_fid', 'geom', 'wkb_geometry', 'shape']);

async function runOgrinfoStdout(absoluteShpPath: string, extraArgs: string[]): Promise<string> {
  const normalized = path.normalize(absoluteShpPath).replace(/\\/g, path.sep);
  if (!fsSync.existsSync(normalized)) return '';

  const { cmd: ogrinfoCmd, args: prefix } = resolveOgrInfoRun();
  const args = [...prefix, ...extraArgs, normalized];
  const isWin = process.platform === 'win32';
  const useConda = prefix.length > 0;
  const spawnCmd = useConda ? ogrinfoCmd : (isWin ? 'cmd.exe' : ogrinfoCmd);
  const spawnArgs = useConda ? args : (isWin ? ['/c', 'ogrinfo', ...args.slice(prefix.length)] : args);

  return new Promise<string>((resolve) => {
    const child = spawn(spawnCmd, spawnArgs, { windowsHide: true, shell: false });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8')));
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8');
      resolve(code === 0 ? out : '');
    });
    child.on('error', () => resolve(''));
  });
}

function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeOgrFieldType(raw: string): string {
  const base = raw.trim().split(/[\s(]/)[0]?.toLowerCase() ?? '';
  if (base.includes('string') || base === 'str') return 'string';
  if (base.includes('int')) return 'integer';
  if (base.includes('real') || base.includes('float') || base.includes('double') || base === 'number') return 'float';
  if (base.includes('date') || base.includes('time')) return 'datetime';
  if (base.includes('bool')) return 'boolean';
  return base;
}

function normalizePgFieldType(raw: string): string {
  const u = raw.trim().toLowerCase();
  if (u.includes('character') || u === 'text' || u === 'varchar') return 'string';
  if (u === 'integer' || u === 'bigint' || u === 'smallint') return 'integer';
  if (u.includes('double') || u.includes('real') || u.includes('numeric') || u.includes('decimal')) return 'float';
  if (u.includes('timestamp') || u.includes('date') || u.includes('time')) return 'datetime';
  if (u.includes('bool')) return 'boolean';
  if (u === 'geometry' || u.includes('user-defined')) return 'geometry';
  return u;
}

function parseShpFieldsFromOgrinfoJson(stdout: string): ShpSchemaField[] | null {
  try {
    const parsed = JSON.parse(stdout) as {
      layers?: Array<{
        fields?: Array<{ name?: string; type?: string }>;
        geometryFields?: Array<{ name?: string }>;
      }>;
    };
    const layer = parsed.layers?.[0];
    if (!layer) return null;
    const geomNames = new Set(
      (layer.geometryFields ?? []).map((g) => normalizeFieldName(String(g.name ?? ''))).filter(Boolean)
    );
    const fields: ShpSchemaField[] = [];
    for (const f of layer.fields ?? []) {
      const name = String(f.name ?? '').trim();
      if (!name) continue;
      const norm = normalizeFieldName(name);
      if (geomNames.has(norm) || DB_SCHEMA_SKIP_COLUMNS.has(norm)) continue;
      fields.push({ name, ogrType: String(f.type ?? '').trim() || 'String' });
    }
    return fields.length > 0 || (layer.fields ?? []).length === 0 ? fields : null;
  } catch {
    return null;
  }
}

function parseShpFieldsFromOgrinfoText(stdout: string): ShpSchemaField[] {
  const fields: ShpSchemaField[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\S+(?:\s*\([^)]*\))?)\s*$/);
    if (!m) continue;
    const name = m[1];
    const norm = normalizeFieldName(name);
    if (DB_SCHEMA_SKIP_COLUMNS.has(norm)) continue;
    if (/^(layer name|geometry|feature count|extent|layer srs|fid column|geometry column|info)$/i.test(name)) continue;
    fields.push({ name, ogrType: m[2].trim() });
  }
  return fields;
}

async function getShpAttributeFields(absoluteShpPath: string): Promise<ShpSchemaField[]> {
  const jsonOut = await runOgrinfoStdout(absoluteShpPath, ['-json', '-so']);
  const fromJson = jsonOut ? parseShpFieldsFromOgrinfoJson(jsonOut) : null;
  if (fromJson) return fromJson;

  const textOut = await runOgrinfoStdout(absoluteShpPath, ['-al', '-so']);
  return parseShpFieldsFromOgrinfoText(textOut);
}

/**
 * SHP 속성 필드 vs 기존 layer 테이블 컬럼 구성·타입 비교.
 * 테이블이 없으면 isNew=true, ok=true.
 */
export async function compareShpSchemaWithTable(params: {
  pathOrResult: string;
}): Promise<ShpSchemaCompareResult> {
  const pathOrResult = params?.pathOrResult?.trim();
  const sourceFile = pathOrResult ? path.basename(pathOrResult) : '';
  const fail = (error: string, partial?: Partial<ShpSchemaCompareResult>): ShpSchemaCompareResult => ({
    success: false,
    ok: false,
    isNew: false,
    sourceFile,
    pathOrResult: pathOrResult ?? '',
    tableName: '',
    shpFields: [],
    dbFields: [],
    missingInDb: [],
    missingInShp: [],
    typeMismatches: [],
    error,
    ...partial,
  });

  if (!pathOrResult) return fail('pathOrResult가 필요합니다.');

  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  const basename = path.basename(pathOrResult, '.shp');
  const tableName = safeTableName(basename);

  try {
    await fs.stat(absolutePath);
  } catch {
    return fail('SHP 파일을 찾을 수 없습니다.');
  }

  let shpFields: ShpSchemaField[];
  try {
    shpFields = await getShpAttributeFields(absolutePath);
  } catch (e: unknown) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const listRes = await getLayerTableList();
  const matched = listRes.success && listRes.tables
    ? findLayerTableByName(listRes.tables, tableName)
    : null;

  if (!matched) {
    return {
      success: true,
      ok: true,
      isNew: true,
      sourceFile,
      pathOrResult,
      tableName,
      shpFields,
      dbFields: [],
      missingInDb: [],
      missingInShp: [],
      typeMismatches: [],
      message: '신규',
    };
  }

  const colRes = await getTableColumnInfo({ schema: 'layer', table: tableName });
  if (!colRes.success) {
    return fail(colRes.error ?? 'DB 컬럼 정보를 가져올 수 없습니다.', { tableName, shpFields });
  }

  const dbFields = colRes.columns.filter((c) => !DB_SCHEMA_SKIP_COLUMNS.has(normalizeFieldName(c.name)));
  const shpMap = new Map(shpFields.map((f) => [normalizeFieldName(f.name), f]));
  const dbMap = new Map(dbFields.map((f) => [normalizeFieldName(f.name), f]));

  const missingInDb: string[] = [];
  const missingInShp: string[] = [];
  const typeMismatches: Array<{ name: string; shpType: string; dbType: string }> = [];

  for (const sf of shpFields) {
    const key = normalizeFieldName(sf.name);
    const dbCol = dbMap.get(key);
    if (!dbCol) {
      missingInDb.push(sf.name);
      continue;
    }
    const shpNorm = normalizeOgrFieldType(sf.ogrType);
    const dbNorm = normalizePgFieldType(dbCol.dataType);
    if (shpNorm !== dbNorm && shpNorm !== 'geometry' && dbNorm !== 'geometry') {
      typeMismatches.push({ name: sf.name, shpType: sf.ogrType, dbType: dbCol.dataType });
    }
  }

  for (const df of dbFields) {
    if (!shpMap.has(normalizeFieldName(df.name))) {
      missingInShp.push(df.name);
    }
  }

  const ok = missingInDb.length === 0 && missingInShp.length === 0 && typeMismatches.length === 0;
  const message = ok ? '일치' : buildShpSchemaMismatchMessage({ tableName, missingInDb, missingInShp, typeMismatches });

  return {
    success: true,
    ok,
    isNew: false,
    sourceFile,
    pathOrResult,
    tableName,
    shpFields,
    dbFields,
    missingInDb,
    missingInShp,
    typeMismatches,
    message,
  };
}

function buildShpSchemaMismatchMessage(params: {
  tableName: string;
  missingInDb: string[];
  missingInShp: string[];
  typeMismatches: Array<{ name: string; shpType: string; dbType: string }>;
}): string {
  const { tableName, missingInDb, missingInShp, typeMismatches } = params;
  const parts: string[] = [];

  if (missingInShp.length === 1) {
    parts.push(`SHP 파일에 ${missingInShp[0]} 필드가 존재하지 않습니다.`);
  } else if (missingInShp.length > 1) {
    parts.push(`SHP 파일에 ${missingInShp.join(', ')} 필드가 존재하지 않습니다.`);
  }

  if (missingInDb.length === 1) {
    parts.push(
      `DB 테이블(layer.${tableName})에 ${missingInDb[0]} 필드가 없습니다. SHP 파일에만 존재하는 필드입니다.`
    );
  } else if (missingInDb.length > 1) {
    parts.push(
      `DB 테이블(layer.${tableName})에 ${missingInDb.join(', ')} 필드가 없습니다. SHP 파일에만 존재하는 필드입니다.`
    );
  }

  for (const t of typeMismatches) {
    parts.push(
      `${t.name} 필드의 데이터 타입이 일치하지 않습니다. (SHP: ${t.shpType}, DB: ${t.dbType})`
    );
  }

  return parts.join(' ');
}

/** 폴더 내 .shp 파일별 스키마 검증 일괄 실행 */
export async function compareShpFolderSchema(params?: {
  relativePath?: string;
}): Promise<{ success: boolean; results: ShpSchemaCompareResult[]; error?: string }> {
  const statusRes = await getShpStatusList(params);
  const results: ShpSchemaCompareResult[] = [];
  for (const row of statusRes.rows) {
    results.push(await compareShpSchemaWithTable({ pathOrResult: row.pathOrResult }));
  }
  const allOk = results.every((r) => r.success && (r.ok || r.isNew));
  return { success: allOk, results };
}

/**
 * SHP를 임시 테이블로 import 후 기존 테이블과 key 기준 diff 비교.
 * 비교 결과를 sync_log에 미결(operation=NULL)로 저장한 뒤 임시 테이블 삭제.
 */
export async function compareShpWithTable(params: {
  pathOrResult: string;
}): Promise<CompareResult> {
  const empty: CompareResult = { success: false, appendCount: 0, conflictCount: 0, removeCount: 0, unchangedCount: 0, conflicts: [], removes: [] };
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { ...empty, error: 'pathOrResult가 필요합니다.' };

  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  const basename = path.basename(pathOrResult, '.shp');
  const tableName = safeTableName(basename);
  const syncTableName = `_sync_${tableName}`;

  try {
    await fs.stat(absolutePath);
  } catch {
    return { ...empty, error: 'SHP 파일을 찾을 수 없습니다.' };
  }

  const keyField = getKeyFieldName(tableName);
  if (!keyField) return { ...empty, error: `key 필드가 설정되어 있지 않습니다. 레이어 속성정보에서 key를 설정하세요. (${tableName})` };

  const dir = path.dirname(absolutePath);
  const { sourceSrs, targetSrs } = await resolveShpSrs(dir, basename);
  const dbfEncoding = resolveShapefileDbfEncoding(dir, basename);

  const dbCfg = getDbConfig();
  const pgConnection = `PG:host=${dbCfg.host} port=${dbCfg.port} dbname=${dbCfg.database} user=${dbCfg.user} password=${dbCfg.password}`;

  const importResult = await runOgr2ogr([
    '-f', 'PostgreSQL', pgConnection, absolutePath,
    '-oo', `ENCODING=${dbfEncoding}`,
    '-nlt', 'PROMOTE_TO_MULTI',
    '-nln', `layer.${syncTableName}`,
    ...(sourceSrs ? ['-s_srs', sourceSrs] as const : []),
    '-t_srs', targetSrs,
    '-lco', 'GEOMETRY_NAME=geom',
    '-overwrite',
  ]);

  if (importResult.code !== 0) {
    return { ...empty, error: `임시 테이블 import 실패: ${importResult.stderr}` };
  }

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const colRes = await db.execute(sql.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'layer' AND table_name = '${tableName}'
       AND column_name NOT IN ('ogc_fid', 'geom')
       ORDER BY ordinal_position`
    ));
    const columns = (colRes.rows as Array<{ column_name: string }>).map((r) => r.column_name);

    if (!columns.includes(keyField)) {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS layer."${syncTableName}"`));
      return { ...empty, error: `key 필드 '${keyField}'가 테이블에 존재하지 않습니다.` };
    }

    let geometryColumn: string | null = null;
    try {
      const gCol = await db.execute(sql.raw(
        `SELECT f_geometry_column::text AS col FROM geometry_columns
         WHERE f_table_schema = 'layer' AND f_table_name = '${tableName}' LIMIT 1`
      ));
      const c = (gCol.rows as Array<{ col: string }>)[0]?.col;
      if (c?.trim()) geometryColumn = c.trim();
    } catch {
      geometryColumn = null;
    }
    if (!geometryColumn) {
      const hasGeom = await db.execute(sql.raw(
        `SELECT 1 AS ok FROM information_schema.columns
         WHERE table_schema = 'layer' AND table_name = '${tableName}' AND column_name = 'geom' LIMIT 1`
      ));
      if ((hasGeom.rows as Array<{ ok: number }>).length > 0) geometryColumn = 'geom';
    }

    const compareCols = columns.filter((c) => c !== keyField);

    const attrClause =
      compareCols.length > 0
        ? compareCols.map((c) => `t."${c}" IS DISTINCT FROM e."${c}"`).join(' OR ')
        : 'FALSE';

    const geomClause = geometryColumn
      ? `(
  (e."${geometryColumn}" IS NULL) IS DISTINCT FROM (t."${geometryColumn}" IS NULL)
  OR (
    e."${geometryColumn}" IS NOT NULL AND t."${geometryColumn}" IS NOT NULL
    AND NOT ST_Equals(e."${geometryColumn}"::geometry, t."${geometryColumn}"::geometry)
  )
)`
      : 'FALSE';

    const whereClause = `(${attrClause}) OR (${geomClause})`;

    const unchangedWhere = `NOT ((${attrClause}) OR (${geomClause}))`;

    const [appendRes, conflictRes, removeRes, unchangedRes] = await Promise.all([
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM layer."${syncTableName}" t
         LEFT JOIN layer."${tableName}" e ON t."${keyField}" = e."${keyField}"
         WHERE e."${keyField}" IS NULL`
      )),
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM layer."${syncTableName}" t
         JOIN layer."${tableName}" e ON t."${keyField}" = e."${keyField}"
         WHERE ${whereClause}`
      )),
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM layer."${tableName}" e
         LEFT JOIN layer."${syncTableName}" t ON e."${keyField}" = t."${keyField}"
         WHERE t."${keyField}" IS NULL`
      )),
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM layer."${syncTableName}" t
         JOIN layer."${tableName}" e ON t."${keyField}" = e."${keyField}"
         WHERE ${unchangedWhere}`
      )),
    ]);

    const appendCount = (appendRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    const conflictCount = (conflictRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    const removeCount = (removeRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    const unchangedCount = (unchangedRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;

    let conflicts: SyncConflictRow[] = [];
    if (conflictCount > 0) {
      const selectCols = compareCols.flatMap((c) => [
        `e."${c}" AS "db_${c}"`, `t."${c}" AS "shp_${c}"`
      ]).join(', ');
      const geomSelect = geometryColumn ? `, (${geomClause}) AS _geom_mismatch` : '';
      const geomPair = geometryColumn
        ? `, e."${geometryColumn}" AS "db_${geometryColumn}", t."${geometryColumn}" AS "shp_${geometryColumn}"`
        : '';
      const conflictRows = await db.execute(sql.raw(
        `SELECT t."${keyField}" AS key_val${selectCols ? `, ${selectCols}` : ''}${geomPair}${geomSelect}
         FROM layer."${syncTableName}" t
         JOIN layer."${tableName}" e ON t."${keyField}" = e."${keyField}"
         WHERE ${whereClause}
         LIMIT 500`
      ));
      conflicts = (conflictRows.rows as Array<Record<string, unknown>>).map((r) => {
        const key = String(r.key_val ?? '');
        const dbValues: Record<string, unknown> = {};
        const shpValues: Record<string, unknown> = {};
        const diffFields: string[] = [];
        for (const c of compareCols) {
          const dbVal = r[`db_${c}`];
          const shpVal = r[`shp_${c}`];
          dbValues[c] = dbVal;
          shpValues[c] = shpVal;
          if (JSON.stringify(dbVal) !== JSON.stringify(shpVal)) {
            diffFields.push(c);
          }
        }
        if (geometryColumn) {
          const gm = r._geom_mismatch;
          if (gm === true || gm === 't') {
            diffFields.push(geometryColumn);
            dbValues[geometryColumn] = r[`db_${geometryColumn}`];
            shpValues[geometryColumn] = r[`shp_${geometryColumn}`];
          }
        }
        return { key, diffFields, dbValues, shpValues };
      });
    }

    let removes: SyncRemoveRow[] = [];
    if (removeCount > 0) {
      const removeCols = columns.map((c) => `e."${c}"`).join(', ');
      const removeRows = await db.execute(sql.raw(
        `SELECT ${removeCols} FROM layer."${tableName}" e
         LEFT JOIN layer."${syncTableName}" t ON e."${keyField}" = t."${keyField}"
         WHERE t."${keyField}" IS NULL
         LIMIT 500`
      ));
      removes = (removeRows.rows as Array<Record<string, unknown>>).map((r) => ({
        key: String(r[keyField] ?? ''),
        values: Object.fromEntries(columns.map((c) => [c, r[c]])),
      }));
    }

    // --- sync_log에 미결(operation=NULL) 상태로 저장 ---
    // 기존 미결 건 삭제 (중복 업로드 대응)
    await db.execute(sql.raw(
      `DELETE FROM sync_log WHERE sl_table_name = '${tableName}' AND sl_operation IS NULL`
    ));

    // append: old=NULL, new=SHP
    if (appendCount > 0) {
      await db.execute(sql.raw(
        `INSERT INTO sync_log (sl_table_name, sl_key_field, sl_key_value, sl_old_data, sl_new_data)
         SELECT '${tableName}', '${keyField}', t."${keyField}"::text,
                NULL, row_to_json(t.*)::jsonb
         FROM layer."${syncTableName}" t
         LEFT JOIN layer."${tableName}" e ON t."${keyField}" = e."${keyField}"
         WHERE e."${keyField}" IS NULL`
      ));
    }

    // conflict: old=DB, new=SHP
    if (conflictCount > 0) {
      await db.execute(sql.raw(
        `INSERT INTO sync_log (sl_table_name, sl_key_field, sl_key_value, sl_old_data, sl_new_data)
         SELECT '${tableName}', '${keyField}', e."${keyField}"::text,
                row_to_json(e.*)::jsonb, row_to_json(t.*)::jsonb
         FROM layer."${syncTableName}" t
         JOIN layer."${tableName}" e ON t."${keyField}" = e."${keyField}"
         WHERE ${whereClause}`
      ));
    }

    // remove: old=DB, new=NULL
    if (removeCount > 0) {
      await db.execute(sql.raw(
        `INSERT INTO sync_log (sl_table_name, sl_key_field, sl_key_value, sl_old_data, sl_new_data)
         SELECT '${tableName}', '${keyField}', e."${keyField}"::text,
                row_to_json(e.*)::jsonb, NULL
         FROM layer."${tableName}" e
         LEFT JOIN layer."${syncTableName}" t ON e."${keyField}" = t."${keyField}"
         WHERE t."${keyField}" IS NULL`
      ));
    }

    // 임시 테이블 삭제
    await db.execute(sql.raw(`DROP TABLE IF EXISTS layer."${syncTableName}"`));

    return {
      success: true,
      tableName,
      keyField,
      columns,
      appendCount,
      conflictCount,
      removeCount,
      unchangedCount,
      conflicts,
      removes,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: msg };
  }
}

function sqlVal(col: string, v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (col === 'geom' && typeof v === 'object') return `ST_GeomFromGeoJSON('${JSON.stringify(v).replace(/'/g, "''")}')`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * sync_log의 미결(operation=NULL) 항목을 DB에 반영한다.
 * - old=NULL, new=존재 → append (INSERT)
 * - old=존재, new=존재 → conflict (UPDATE to SHP value)
 * - old=존재, new=NULL → remove (DELETE)
 */
export async function applySyncEntries(params: {
  slKeys: number[];
  dhKey?: number;
}): Promise<{ success: boolean; appendedCount: number; updatedCount: number; removedCount: number; error?: string }> {
  const slKeys = params?.slKeys;
  if (!slKeys?.length) return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: 'slKeys가 필요합니다.' };

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const keyList = slKeys.join(', ');
    const logRes = await db.execute(sql.raw(
      `SELECT sl_key, sl_table_name, sl_key_field, sl_key_value, sl_old_data, sl_new_data
       FROM sync_log WHERE sl_key IN (${keyList}) AND sl_operation IS NULL ORDER BY sl_key`
    ));
    const logs = logRes.rows as Array<{
      sl_key: number; sl_table_name: string; sl_key_field: string;
      sl_key_value: string;
      sl_old_data: Record<string, unknown> | null; sl_new_data: Record<string, unknown> | null;
    }>;

    if (logs.length === 0) return { success: true, appendedCount: 0, updatedCount: 0, removedCount: 0 };

    let appendedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    const dhKeyVal = params.dhKey != null ? String(params.dhKey) : 'NULL';

    for (const log of logs) {
      const { sl_table_name: tbl, sl_key_field: kf, sl_key_value: kv, sl_old_data: oldData, sl_new_data: newData } = log;
      const safeKv = kv.replace(/'/g, "''");

      if (!oldData && newData) {
        const cols = Object.keys(newData).filter((c) => c !== 'ogc_fid');
        const colNames = cols.map((c) => `"${c}"`).join(', ');
        const vals = cols.map((c) => sqlVal(c, newData[c])).join(', ');
        await db.execute(sql.raw(`INSERT INTO layer."${tbl}" (${colNames}) VALUES (${vals})`));
        await db.execute(sql.raw(
          `UPDATE sync_log SET sl_operation = 'append', sl_applied_at = NOW(), sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
        ));
        appendedCount++;
      } else if (oldData && newData) {
        const cols = Object.keys(newData).filter((c) => c !== 'ogc_fid' && c !== kf);
        if (cols.length > 0) {
          const setClauses = cols.map((c) => `"${c}" = ${sqlVal(c, newData[c])}`).join(', ');
          await db.execute(sql.raw(
            `UPDATE layer."${tbl}" SET ${setClauses} WHERE "${kf}"::text = '${safeKv}'`
          ));
        }
        await db.execute(sql.raw(
          `UPDATE sync_log SET sl_operation = 'conflict', sl_applied_at = NOW(), sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
        ));
        updatedCount++;
      } else if (oldData && !newData) {
        await db.execute(sql.raw(
          `DELETE FROM layer."${tbl}" WHERE "${kf}"::text = '${safeKv}'`
        ));
        await db.execute(sql.raw(
          `UPDATE sync_log SET sl_operation = 'remove', sl_applied_at = NOW(), sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
        ));
        removedCount++;
      }
    }

    return { success: true, appendedCount, updatedCount, removedCount };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: msg };
  }
}

/**
 * sync_log의 미결(operation=NULL) 항목을 '유지(kept)'로 설정한다.
 * DB에는 아무 변경 없이, operation만 'kept'으로 표시.
 */
export async function keepSyncEntries(params: {
  slKeys: number[];
  dhKey?: number;
}): Promise<{ success: boolean; keptCount: number; error?: string }> {
  const slKeys = params?.slKeys;
  if (!slKeys?.length) return { success: false, keptCount: 0, error: 'slKeys가 필요합니다.' };

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const keyList = slKeys.join(', ');
    const dhKeyVal = params.dhKey != null ? String(params.dhKey) : 'NULL';
    const res = await db.execute(sql.raw(
      `UPDATE sync_log SET sl_operation = 'kept', sl_applied_at = NOW(), sl_dh_key = ${dhKeyVal}
       WHERE sl_key IN (${keyList}) AND sl_operation IS NULL`
    ));
    const keptCount = (res as { rowCount?: number }).rowCount ?? 0;
    return { success: true, keptCount };
  } catch (e: unknown) {
    return { success: false, keptCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** sync_log 조회 */
export async function getSyncLogs(params: {
  dhKey?: number;
  tableName?: string;
  pendingOnly?: boolean;
}): Promise<{ success: boolean; rows: Array<Record<string, unknown>>; error?: string }> {
  const { dhKey, tableName, pendingOnly } = params ?? {};
  if (!dhKey && !tableName) return { success: false, rows: [], error: 'dhKey 또는 tableName이 필요합니다.' };
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    let where: string;
    const safeTbl = tableName ? tableName.replace(/'/g, "''") : '';
    if (dhKey && tableName) {
      where = `(sl_dh_key = ${dhKey} OR sl_dh_key IS NULL) AND sl_table_name = '${safeTbl}'`;
    } else if (dhKey) {
      where = `sl_dh_key = ${dhKey}`;
    } else {
      where = `sl_table_name = '${safeTbl}'`;
    }
    if (pendingOnly) where += ` AND sl_operation IS NULL`;

    const res = await db.execute(sql.raw(
      `SELECT sl_key, sl_dh_key, sl_table_name, sl_key_field, sl_key_value, sl_operation,
              sl_old_data, sl_new_data, sl_applied_at, sl_rolled_back, sl_rolled_back_at, sl_created_at
       FROM sync_log WHERE ${where} ORDER BY sl_key`
    ));
    return { success: true, rows: res.rows as Array<Record<string, unknown>> };
  } catch (e: unknown) {
    return { success: false, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 행 단위 롤백: 반영된 sync_log 항목을 되돌림 */
export async function rollbackSyncRows(params: {
  slKeys: number[];
}): Promise<{ success: boolean; rolledBackCount: number; error?: string }> {
  const slKeys = params?.slKeys;
  if (!slKeys?.length) return { success: false, rolledBackCount: 0, error: 'slKeys가 필요합니다.' };

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const keyList = slKeys.join(', ');
    const logRes = await db.execute(sql.raw(
      `SELECT sl_key, sl_table_name, sl_key_field, sl_key_value, sl_operation, sl_old_data, sl_new_data
       FROM sync_log WHERE sl_key IN (${keyList}) AND sl_rolled_back = false AND sl_operation IS NOT NULL ORDER BY sl_key DESC`
    ));
    const logs = logRes.rows as Array<{
      sl_key: number; sl_table_name: string; sl_key_field: string;
      sl_key_value: string; sl_operation: string;
      sl_old_data: Record<string, unknown> | null; sl_new_data: Record<string, unknown> | null;
    }>;

    if (logs.length === 0) return { success: true, rolledBackCount: 0 };

    let rolledBackCount = 0;

    for (const log of logs) {
      const { sl_table_name: tbl, sl_key_field: kf, sl_key_value: kv, sl_operation: op, sl_old_data: oldData } = log;
      if (op === 'kept') continue;
      const safeKv = kv.replace(/'/g, "''");

      if (op === 'append') {
        await db.execute(sql.raw(
          `DELETE FROM layer."${tbl}" WHERE "${kf}"::text = '${safeKv}'`
        ));
      } else if (op === 'conflict' && oldData) {
        const cols = Object.keys(oldData).filter((c) => c !== 'ogc_fid' && c !== kf);
        if (cols.length > 0) {
          const setClauses = cols.map((c) => `"${c}" = ${sqlVal(c, oldData[c])}`).join(', ');
          await db.execute(sql.raw(
            `UPDATE layer."${tbl}" SET ${setClauses} WHERE "${kf}"::text = '${safeKv}'`
          ));
        }
      } else if (op === 'remove' && oldData) {
        const cols = Object.keys(oldData).filter((c) => c !== 'ogc_fid');
        const colNames = cols.map((c) => `"${c}"`).join(', ');
        const vals = cols.map((c) => sqlVal(c, oldData[c])).join(', ');
        await db.execute(sql.raw(
          `INSERT INTO layer."${tbl}" (${colNames}) VALUES (${vals})`
        ));
      }

      await db.execute(sql.raw(
        `UPDATE sync_log SET sl_rolled_back = true, sl_rolled_back_at = NOW() WHERE sl_key = ${log.sl_key}`
      ));
      rolledBackCount++;
    }

    return { success: true, rolledBackCount };
  } catch (e: unknown) {
    return { success: false, rolledBackCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 롤백된(sl_rolled_back=true) 항목을 다시 적용한다.
 * sl_operation 기준으로 INSERT/UPDATE/DELETE 수행 후 sl_rolled_back 해제.
 */
export async function reapplySyncRows(params: {
  slKeys: number[];
}): Promise<{ success: boolean; reappliedCount: number; error?: string }> {
  const slKeys = params?.slKeys;
  if (!slKeys?.length) return { success: false, reappliedCount: 0, error: 'slKeys가 필요합니다.' };

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const keyList = slKeys.join(', ');
    const logRes = await db.execute(sql.raw(
      `SELECT sl_key, sl_table_name, sl_key_field, sl_key_value, sl_operation, sl_old_data, sl_new_data
       FROM sync_log WHERE sl_key IN (${keyList}) AND sl_rolled_back = true AND sl_operation IN ('append','conflict','remove') ORDER BY sl_key`
    ));
    const logs = logRes.rows as Array<{
      sl_key: number; sl_table_name: string; sl_key_field: string;
      sl_key_value: string; sl_operation: string;
      sl_old_data: Record<string, unknown> | null; sl_new_data: Record<string, unknown> | null;
    }>;

    if (logs.length === 0) return { success: true, reappliedCount: 0 };

    let reappliedCount = 0;

    for (const log of logs) {
      const { sl_table_name: tbl, sl_key_field: kf, sl_key_value: kv, sl_operation: op, sl_old_data: oldData, sl_new_data: newData } = log;
      const safeKv = kv.replace(/'/g, "''");

      if (op === 'append' && newData) {
        const cols = Object.keys(newData).filter((c) => c !== 'ogc_fid');
        const colNames = cols.map((c) => `"${c}"`).join(', ');
        const vals = cols.map((c) => sqlVal(c, newData[c])).join(', ');
        await db.execute(sql.raw(`INSERT INTO layer."${tbl}" (${colNames}) VALUES (${vals})`));
      } else if (op === 'conflict' && oldData && newData) {
        const cols = Object.keys(newData).filter((c) => c !== 'ogc_fid' && c !== kf);
        if (cols.length > 0) {
          const setClauses = cols.map((c) => `"${c}" = ${sqlVal(c, newData[c])}`).join(', ');
          await db.execute(sql.raw(
            `UPDATE layer."${tbl}" SET ${setClauses} WHERE "${kf}"::text = '${safeKv}'`
          ));
        }
      } else if (op === 'remove') {
        await db.execute(sql.raw(
          `DELETE FROM layer."${tbl}" WHERE "${kf}"::text = '${safeKv}'`
        ));
      }

      await db.execute(sql.raw(
        `UPDATE sync_log SET sl_rolled_back = false, sl_rolled_back_at = NULL WHERE sl_key = ${log.sl_key}`
      ));
      reappliedCount++;
    }

    return { success: true, reappliedCount };
  } catch (e: unknown) {
    return { success: false, reappliedCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * SHP 파일에서 특정 키 값의 행 데이터를 읽어온다.
 * kept 항목에 sl_new_data가 없을 때 SHP에서 직접 값을 조회하는 용도.
 */
export async function readShpValues(params: {
  shpPath: string;
  tableName: string;
  keyField: string;
  keyValues: string[];
}): Promise<{ success: boolean; rows: Record<string, Record<string, unknown>>; error?: string }> {
  const { shpPath, tableName, keyField, keyValues } = params ?? {};
  if (!shpPath || !tableName || !keyField || !keyValues?.length) {
    return { success: false, rows: {}, error: '필수 파라미터가 누락되었습니다.' };
  }

  const absolutePath = path.join(GGNR_DATA_DIR, shpPath.replace(/\//g, path.sep));
  const syncTableName = `_sync_shpread_${tableName}`;

  try { await fs.stat(absolutePath); } catch {
    return { success: false, rows: {}, error: 'SHP 파일을 찾을 수 없습니다.' };
  }

  const dir = path.dirname(absolutePath);
  const basename = path.basename(shpPath, '.shp');
  const { sourceSrs, targetSrs } = await resolveShpSrs(dir, basename);
  const dbfEncoding = resolveShapefileDbfEncoding(dir, basename);

  const dbCfg = getDbConfig();
  const pgConn = `PG:host=${dbCfg.host} port=${dbCfg.port} dbname=${dbCfg.database} user=${dbCfg.user} password=${dbCfg.password}`;

  const importRes = await runOgr2ogr([
    '-f', 'PostgreSQL', pgConn, absolutePath,
    '-oo', `ENCODING=${dbfEncoding}`,
    '-nlt', 'PROMOTE_TO_MULTI',
    '-nln', `layer.${syncTableName}`,
    ...(sourceSrs ? ['-s_srs', sourceSrs] as const : []),
    '-t_srs', targetSrs,
    '-lco', 'GEOMETRY_NAME=geom',
    '-overwrite',
  ]);

  if (importRes.code !== 0) {
    return { success: false, rows: {}, error: `SHP import 실패: ${importRes.stderr}` };
  }

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const kvList = keyValues.map((k) => `'${k.replace(/'/g, "''")}'`).join(', ');
    const res = await db.execute(sql.raw(
      `SELECT row_to_json(t.*)::jsonb AS data, t."${keyField}"::text AS kv
       FROM layer."${syncTableName}" t
       WHERE t."${keyField}"::text IN (${kvList})`
    ));

    const result: Record<string, Record<string, unknown>> = {};
    for (const r of res.rows as Array<{ data: Record<string, unknown>; kv: string }>) {
      result[r.kv] = r.data;
    }

    await db.execute(sql.raw(`DROP TABLE IF EXISTS layer."${syncTableName}"`));
    return { success: true, rows: result };
  } catch (e: unknown) {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(`DROP TABLE IF EXISTS layer."${syncTableName}"`)).catch(() => {});
    return { success: false, rows: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * layer 스키마 테이블을 EPSG:5181 Shapefile로 내보낸 뒤 zip 버퍼로 반환.
 * Excel 데이터 상태 탭 등에서 SHP 다운로드용.
 */
export async function exportLayerTableToShp(params: {
  tableName: string;
  schema?: 'layer' | 'public_layer';
}): Promise<{ success: boolean; zipBuffer?: Buffer; error?: string }> {
  const tableName = (params?.tableName ?? '').trim().replace(/[^a-zA-Z0-9_]/g, '_') || undefined;
  if (!tableName) return { success: false, error: 'tableName이 필요합니다.' };
  const schema = params?.schema === 'public_layer' ? 'public_layer' : 'layer';

  const tmpBase = path.join(GGNR_DATA_DIR, 'tmp');
  const tempDir = path.join(tmpBase, `shp_export_${schema}_${tableName}_${Date.now()}`);
  const outShp = path.join(tempDir, `${tableName}.shp`);

  try {
    await fs.mkdir(tempDir, { recursive: true });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }

  const dbCfg = getDbConfig();
  const pgConn = `PG:host=${dbCfg.host} port=${dbCfg.port} dbname=${dbCfg.database} user=${dbCfg.user} password=${dbCfg.password}`;
  const layerTable = `${schema}.${tableName}`;

  /**
   * public_layer.jijuk 등: geometry_columns SRID=0인데 실제 좌표는 5181 → -s_srs로 소스 고정.
   * layer 스키마(엑셀 등 4326→5181 저장)는 DB 메타 SRID를 따름.
   */
  const ogrBase: string[] = [
    '-f', 'ESRI Shapefile',
    outShp,
    pgConn,
    layerTable,
  ];
  if (schema === 'public_layer') {
    ogrBase.push('-s_srs', 'EPSG:5181');
  }
  ogrBase.push('-t_srs', 'EPSG:5181', '-skipfailures', '-dim', '2', '-lco', 'ENCODING=UTF-8');
  const result = await runOgr2ogr(ogrBase);

  let shpSize = 0;
  try {
    shpSize = (await fs.stat(outShp)).size;
  } catch {
    shpSize = 0;
  }
  if (shpSize < 100) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(tempDir, { recursive: true }).catch(() => {});
    const sql = `SELECT * FROM ${schema}."${tableName}" WHERE geom IS NOT NULL AND ST_IsValid(geom)`;
    const retryArgs: string[] = ['-f', 'ESRI Shapefile', outShp, pgConn, '-sql', sql];
    if (schema === 'public_layer') {
      retryArgs.push('-s_srs', 'EPSG:5181');
    }
    retryArgs.push('-t_srs', 'EPSG:5181', '-skipfailures', '-dim', '2', '-lco', 'ENCODING=UTF-8');
    const result2 = await runOgr2ogr(retryArgs);
    try {
      shpSize = (await fs.stat(outShp)).size;
    } catch {
      shpSize = 0;
    }
    if (shpSize < 100) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      const tail = (result2.stderr ?? result.stderr ?? '').trim() || `ogr2ogr 코드 ${result2.code}`;
      return {
        success: false,
        error: `SHP 생성 실패(jijuk 등 일부 행 좌표계·지오메트리 오류). ${tail}`,
      };
    }
    if (result2.code !== 0) {
      console.warn(`[exportLayerTableToShp] ${schema}.${tableName} 2차(SQL) ogr2ogr exit ${result2.code} (일부 행 생략)`);
    }
  } else if (result.code !== 0) {
    console.warn(`[exportLayerTableToShp] ${schema}.${tableName} ogr2ogr exit ${result.code} (일부 행 생략, shp ${shpSize}b)`);
  }

  const chunks: Buffer[] = [];
  const archive = archiver('zip', { zlib: { level: 9 } });
  const out = new PassThrough();
  out.on('data', (c: Buffer) => chunks.push(c));
  archive.on('error', (err: unknown) => {
    console.error('[exportLayerTableToShp] archiver error:', err);
  });
  archive.pipe(out);
  archive.directory(tempDir, false);
  await archive.finalize();
  await finished(out);
  const zipBuffer = Buffer.concat(chunks);
  console.log(`[exportLayerTableToShp] ${tableName} zip ${zipBuffer.length} bytes`);

  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(tmpBase, { recursive: true }).catch(() => {});

  return { success: true, zipBuffer };
}


