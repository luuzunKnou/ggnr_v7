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
import { matchEpsgFromLooseText } from '@/lib/matchCoordinateSystemText';

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
const SHP_UPLOAD_TARGET_SRID = Number(SHP_UPLOAD_TARGET_SRS.replace(/^EPSG:/i, '')) || 5181;

/**
 * 정합성 geom 비교·hash 허용 격자(m).
 * CRS 재투영 부동소수점 오차(μm~mm)는 동일로 보고, 실제 위치 차이는 그대로 충돌로 둔다.
 */
const GEOM_COMPARE_GRID_M = 0.001;

/** 비교·hash용: 좌표를 허용 격자로 스냅한 geometry SQL */
function geomCompareSnapSql(geomExpr: string): string {
  return `ST_SnapToGrid((${geomExpr})::geometry, ${GEOM_COMPARE_GRID_M})`;
}

/** 스냅 후 WKB md5 — sync_log geom 메타 hash / kept 매칭과 동일 기준 */
function geomCompareHashSql(geomExpr: string): string {
  return `md5(encode(ST_AsBinary(${geomCompareSnapSql(geomExpr)}), 'hex'))`;
}

/** 비유일 key 공간 매칭 시 sync_log/반영용 메타 (테이블 컬럼 아님) */
const SYNC_MATCH_OGC_FID = '__match_ogc_fid';
const SYNC_MATCH_SYNC_FID = '__match_sync_ogc_fid';
/** 한 key 값당 이 건수 초과면 공간 매칭 후보가 N²로 폭증 → 중단 */
const SPATIAL_MATCH_MAX_PER_KEY = 200;

function readSyncMatchOgcFid(data: Record<string, unknown> | null | undefined): number | null {
  if (!data) return null;
  const raw = data[SYNC_MATCH_OGC_FID];
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function readSyncMatchSyncFid(data: Record<string, unknown> | null | undefined): number | null {
  if (!data) return null;
  const raw = data[SYNC_MATCH_SYNC_FID];
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** 반영/롤백 WHERE: 공간 매칭 메타가 있으면 ogc_fid, 없으면 업무 key */
function syncRowTargetWhereSql(params: {
  keyCol: string;
  keyValue: string;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  ogcFidCol?: string;
}): string {
  const safeKv = params.keyValue.replace(/'/g, "''");
  const matchFid =
    readSyncMatchOgcFid(params.oldData) ?? readSyncMatchOgcFid(params.newData);
  const fidCol = params.ogcFidCol ?? 'ogc_fid';
  if (matchFid != null) {
    return `"${fidCol}" = ${matchFid}`;
  }
  return `"${params.keyCol}"::text = '${safeKv}'`;
}

function extractWktParam(content: string, name: string): number | null {
  const re = new RegExp(`PARAMETER\\s*\\[\\s*["']${name}["']\\s*,\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
  const m = content.match(re);
  return m ? parseFloat(m[1]) : null;
}

function detectEllipsoidFamily(content: string): 'grs80' | 'bessel' | null {
  if (/bessel/i.test(content)) return 'bessel';
  if (/GRS[_ ]?1980|GRS80/i.test(content)) return 'grs80';
  return null;
}

/** projections.ts 에 등록된 한국 TM 좌표계 정의(중앙자오선/false easting·northing/축척)와 일치 여부로 EPSG 추정 */
const KOREA_TM_EPSG_CANDIDATES: Array<{ code: number; lon0: number; x0: number; y0: number; k: number; ellps: 'grs80' | 'bessel' }> = [
  { code: 5179, lon0: 127.5, x0: 1000000, y0: 2000000, k: 0.9996, ellps: 'grs80' },
  { code: 5181, lon0: 127, x0: 200000, y0: 500000, k: 1, ellps: 'grs80' },
  { code: 5180, lon0: 125, x0: 200000, y0: 500000, k: 1, ellps: 'grs80' },
  { code: 5182, lon0: 127, x0: 200000, y0: 550000, k: 1, ellps: 'grs80' },
  { code: 5183, lon0: 129, x0: 200000, y0: 500000, k: 1, ellps: 'grs80' },
  { code: 5184, lon0: 131, x0: 200000, y0: 500000, k: 1, ellps: 'grs80' },
  { code: 5185, lon0: 125, x0: 200000, y0: 600000, k: 1, ellps: 'grs80' },
  { code: 5186, lon0: 127, x0: 200000, y0: 600000, k: 1, ellps: 'grs80' },
  { code: 5187, lon0: 129, x0: 200000, y0: 600000, k: 1, ellps: 'grs80' },
  { code: 5188, lon0: 131, x0: 200000, y0: 600000, k: 1, ellps: 'grs80' },
  { code: 5174, lon0: 127.0028902777778, x0: 200000, y0: 500000, k: 1, ellps: 'bessel' },
  { code: 5176, lon0: 129.0028902777778, x0: 200000, y0: 500000, k: 1, ellps: 'bessel' },
];

/** AUTHORITY 태그가 없는 일반적인 ESRI .prj용: WKT 투영 파라미터를 알려진 한국 TM 좌표계와 매칭 */
function matchEpsgFromWktParams(content: string): string | null {
  if (!/PROJECTION/i.test(content)) return null;
  const lon0 = extractWktParam(content, 'Central_Meridian');
  const x0 = extractWktParam(content, 'False_Easting');
  const y0 = extractWktParam(content, 'False_Northing');
  const k = extractWktParam(content, 'Scale_Factor');
  if (lon0 == null || x0 == null || y0 == null) return null;
  const ellps = detectEllipsoidFamily(content);
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  const matches = KOREA_TM_EPSG_CANDIDATES.filter(
    (c) =>
      near(c.lon0, lon0, 0.01) &&
      near(c.x0, x0, 1) &&
      near(c.y0, y0, 1) &&
      (k == null || near(c.k, k, 0.0005)) &&
      (!ellps || c.ellps === ellps)
  );
  return matches.length === 1 ? `EPSG:${matches[0].code}` : null;
}

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
  // ESRI 스타일 .prj는 보통 AUTHORITY 태그가 없으므로 투영 파라미터로 추정
  const paramMatch = matchEpsgFromWktParams(content);
  if (paramMatch) return paramMatch;
  // 투영 없이 경위도(GEOGCS)만 있는 경우
  if (/GEOGCS/i.test(content) && !/PROJCS/i.test(content)) return 'EPSG:4326';
  return null;
}

/**
 * 파일명(또는 폴더명)을 _ 로 나눴을 때 2번째 조각이 4자리 숫자면 EPSG로 사용 (.prj 없을 때 2순위).
 * 숫자가 아니면 "GRS중부60" 같은 COORDINATE_SYSTEM_OPTIONS 라벨 텍스트로도 시도한다.
 */
function parseEpsgFromBasename(basename: string): string | null {
  const parts = basename.split('_');
  const second = parts[1];
  if (!second) return null;
  if (/^\d{4}$/.test(second)) return `EPSG:${second}`;
  return matchEpsgFromLooseText(second);
}

/**
 * @param override 프런트에서 파일별로 확정한 EPSG(예: 'EPSG:5186' 또는 '5186'). 있으면 자동판별보다 우선.
 */
async function resolveShpSrs(
  dir: string,
  basename: string,
  override?: string | null
): Promise<{ sourceSrs: string | null; targetSrs: string }> {
  const trimmedOverride = override?.trim();
  if (trimmedOverride) {
    const normalized = /^EPSG:/i.test(trimmedOverride) ? trimmedOverride.toUpperCase() : `EPSG:${trimmedOverride}`;
    if (/^EPSG:\d{3,5}$/.test(normalized)) {
      return { sourceSrs: normalized, targetSrs: SHP_UPLOAD_TARGET_SRS };
    }
  }
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

/**
 * ogr2ogr -t_srs 사용 시 -s_srs가 필요하다.
 * 소스 CRS 미확인이면 null — 호출측에서 실패 처리 (잘못된 CRS 가정 금지).
 */
function ogrSrsTransformArgs(sourceSrs: string | null, targetSrs: string): string[] | null {
  if (!sourceSrs) return null;
  return ['-s_srs', sourceSrs, '-t_srs', targetSrs];
}

/**
 * DBF 본문 샘플: 앞·뒤 레코드를 함께 모아 인코딩 오판을 줄인다.
 * (앞쪽만 ASCII·뒤쪽 한글 CP949인 SHP에서 UTF-8로 잘못 판정되는 경우 방지)
 */
function sampleDbfRecordDataBytes(buf: Buffer, maxSample: number): Buffer {
  if (buf.length < 32) return Buffer.alloc(0);
  const headerSize = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  if (headerSize < 32 || headerSize > buf.length || recordLen < 2) return Buffer.alloc(0);
  const bodyLen = buf.length - headerSize;
  const recordCount = Math.floor(bodyLen / recordLen);
  if (recordCount <= 0) return Buffer.alloc(0);

  const half = Math.max(1, Math.floor(maxSample / 2));
  const maxRecordsPerSide = 400;
  const chunks: Buffer[] = [];
  let total = 0;

  const takeRecords = (fromIndex: number, count: number, budget: number) => {
    let used = 0;
    for (let i = 0; i < count && used < budget; i++) {
      const idx = fromIndex + i;
      if (idx < 0 || idx >= recordCount) break;
      const offset = headerSize + idx * recordLen;
      if (offset + recordLen > buf.length) break;
      const slice = buf.subarray(offset + 1, offset + recordLen);
      const n = Math.min(slice.length, budget - used);
      if (n > 0) {
        chunks.push(slice.subarray(0, n));
        used += n;
      }
    }
    return used;
  };

  total += takeRecords(0, maxRecordsPerSide, half);
  const endStart = Math.max(0, recordCount - maxRecordsPerSide);
  total += takeRecords(endStart, maxRecordsPerSide, maxSample - total);
  if (chunks.length === 0 || total === 0) return Buffer.alloc(0);
  return Buffer.concat(chunks, total);
}

function bufferHasHighBit(sample: Buffer): boolean {
  for (let i = 0; i < sample.length; i++) {
    if ((sample[i] as number) >= 0x80) return true;
  }
  return false;
}

/**
 * UTF-8(strict)로 읽히고 비ASCII(멀티바이트)가 있으면 UTF-8, 그 외는 CP949.
 * ASCII만 있으면 국내 SHP 기본인 CP949를 택한다.
 */
function sniffDbfBytesEncoding(sample: Buffer): 'UTF-8' | 'CP949' {
  if (sample.length === 0) return 'CP949';
  if (!bufferHasHighBit(sample)) return 'CP949';
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
 * - 그다음 `.dbf` 앞·뒤 샘플로 UTF-8 vs CP949 자동 판정 (`GGNR_SHP_DBF_AUTO=0` 이면 생략)
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
 * SHP 파일의 .prj만 읽어 EPSG 코드 판별 (파일명·폴더명 폴백 없음).
 * 마법사에서 "prj 기준" vs "폴더명 기준" 값을 구분해서 보여주기 위한 용도.
 */
export async function getShpPrjEpsg(params: { pathOrResult: string }): Promise<{ success: boolean; epsg: number | null; error?: string }> {
  try {
    const absolutePath = path.join(GGNR_DATA_DIR, params.pathOrResult.replace(/\//g, path.sep));
    const dir = path.dirname(absolutePath);
    const basename = path.basename(absolutePath, '.shp');
    const prjPath = path.join(dir, `${basename}.prj`);
    const prjContent = await fs.readFile(prjPath, 'utf-8').catch(() => '');
    const epsgStr = parseEpsgFromPrj(prjContent);
    if (!epsgStr || !epsgStr.startsWith('EPSG:')) {
      return { success: true, epsg: null };
    }
    const num = parseInt(epsgStr.replace('EPSG:', ''), 10);
    return { success: true, epsg: Number.isFinite(num) ? num : null };
  } catch (e: unknown) {
    return { success: false, epsg: null, error: e instanceof Error ? e.message : String(e) };
  }
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

const EMD_SCHEMA = 'public_layer';
const EMD_TABLE = 'emd';

/** ogrinfo -so -al 로 SHP 원시 범위(Extent) 조회. 좌표계 해석 없이 파일에 저장된 숫자 그대로. */
async function getShpRawExtent(absoluteShpPath: string): Promise<{ minX: number; minY: number; maxX: number; maxY: number } | null> {
  const normalized = path.normalize(absoluteShpPath);
  if (!fsSync.existsSync(normalized)) return null;

  const { cmd: ogrinfoCmd, args: prefix, env: gdalEnv } = resolveOgrInfoRun();
  const args = [...prefix, '-al', '-so', normalized];
  const isWin = process.platform === 'win32';
  const useConda = prefix.length > 0;
  const spawnCmd = useConda ? ogrinfoCmd : (isWin ? 'cmd.exe' : ogrinfoCmd);
  const spawnArgs = useConda ? args : (isWin ? ['/c', ogrinfoCmd, ...args.slice(prefix.length)] : args);

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(spawnCmd, spawnArgs, { windowsHide: true, shell: false, env: gdalEnv ?? process.env });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8')));
    child.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks).toString('utf8') : ''));
    child.on('error', reject);
  }).catch(() => '');

  const line = stdout.split(/\r?\n/).find((l) => /^Extent:/i.test(l.trim()));
  if (!line) return null;
  const m = line.match(/Extent:\s*\(([-\d.]+),\s*([-\d.]+)\)\s*-\s*\(([-\d.]+),\s*([-\d.]+)\)/i);
  if (!m) return null;
  const [minX, minY, maxX, maxY] = m.slice(1).map(Number);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

export type ShpCrsCandidate = {
  epsg: number;
  sourceCrs: string;
  intersectsEmd: boolean;
  overlapRatio: number;
};

/**
 * .prj/폴더명 모두로 EPSG 판별이 안 될 때의 마지막 폴백.
 * SHP 원시 범위를 후보 EPSG(한국 TM 계열)로 각각 해석해 EPSG:5181로 변환한 뒤,
 * 대한민국 읍면동(emd) 경계와 얼마나 겹치는지로 순위를 매긴다 (정사영상관리와 동일한 방식).
 */
export async function detectShpCrsCandidates(params: { pathOrResult: string }): Promise<{
  success: boolean;
  candidates?: ShpCrsCandidate[];
  /** EPSG:5181(임포트 시 최종 목표 좌표계) 비교용 참고 값. 후보 목록(경계 교차)에 없어도 항상 계산해서 반환 */
  reference5181?: ShpCrsCandidate;
  error?: string;
}> {
  try {
    const pathOrResult = params?.pathOrResult?.trim();
    if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };
    const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
    const box = await getShpRawExtent(absolutePath);
    if (!box) return { success: false, error: 'SHP 범위를 확인할 수 없습니다.' };

    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const gc = await db.execute(sql`
      SELECT f_geometry_column AS name, srid
      FROM geometry_columns
      WHERE f_table_schema = ${EMD_SCHEMA} AND f_table_name = ${EMD_TABLE}
      LIMIT 1
    `);
    const gcRow = gc.rows?.[0] as { name?: string; srid?: number } | undefined;
    if (!gcRow?.name) return { success: false, error: 'emd 경계 테이블을 찾을 수 없습니다.' };
    const geomCol = `"${String(gcRow.name).replace(/"/g, '""')}"`;
    const emdSrid = Number(gcRow.srid ?? 0) > 0 ? Number(gcRow.srid) : 5181;
    const emdGeomExpr =
      emdSrid === 5181
        ? `ST_SetSRID(ST_Union(${geomCol}), 5181)`
        : `ST_Transform(ST_SetSRID(ST_Union(${geomCol}), ${emdSrid}), 5181)`;

    const candidateCodes = KOREA_TM_EPSG_CANDIDATES.map((c) => c.code);
    const candidates: ShpCrsCandidate[] = [];
    let reference5181: ShpCrsCandidate | undefined;
    for (const epsg of candidateCodes) {
      const q = await db.execute(sql.raw(`
        WITH src AS (
          SELECT
            ST_Transform(ST_SetSRID(ST_MakePoint(${box.minX}, ${box.minY}), ${epsg}), 5181) AS p1,
            ST_Transform(ST_SetSRID(ST_MakePoint(${box.maxX}, ${box.minY}), ${epsg}), 5181) AS p2,
            ST_Transform(ST_SetSRID(ST_MakePoint(${box.maxX}, ${box.maxY}), ${epsg}), 5181) AS p3,
            ST_Transform(ST_SetSRID(ST_MakePoint(${box.minX}, ${box.maxY}), ${epsg}), 5181) AS p4
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
          SELECT ${emdGeomExpr} AS g
          FROM "${EMD_SCHEMA}"."${EMD_TABLE}"
        )
        SELECT
          ST_Intersects(env.g, emd.g) AS intersects_emd,
          CASE WHEN ST_Area(env.g) <= 0 THEN 0
               ELSE ST_Area(ST_Intersection(env.g, emd.g)) / ST_Area(env.g)
          END AS overlap_ratio
        FROM env, emd
      `));
      const row = q.rows?.[0] as { intersects_emd?: boolean; overlap_ratio?: number } | undefined;
      const intersectsEmd = !!row?.intersects_emd;
      const overlapRatio = Number(row?.overlap_ratio ?? 0);
      const entry: ShpCrsCandidate = { epsg, sourceCrs: `EPSG:${epsg}`, intersectsEmd, overlapRatio };
      if (epsg === 5181) reference5181 = entry;
      if (intersectsEmd) {
        candidates.push(entry);
      }
    }
    candidates.sort((a, b) => b.overlapRatio - a.overlapRatio);
    return { success: true, candidates, reference5181 };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 좌표계 후보 확인 모달 미리보기용: SHP 도형을 좌표계 해석 없이(원시 숫자 그대로) GeoJSON으로 변환.
 * 프런트에서 후보 EPSG를 dataProjection으로 지정해 지도에 겹쳐 그리면, 각 후보를 눈으로 비교할 수 있다.
 */
export async function getShpRawGeojson(params: { pathOrResult: string; maxFeatures?: number }): Promise<{
  success: boolean;
  geojson?: Record<string, unknown>;
  error?: string;
}> {
  try {
    const pathOrResult = params?.pathOrResult?.trim();
    if (!pathOrResult) return { success: false, error: 'pathOrResult가 필요합니다.' };
    const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
    if (!fsSync.existsSync(absolutePath)) return { success: false, error: '파일을 찾을 수 없습니다.' };

    const tmpDir = path.join(GGNR_DATA_DIR, 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpOut = path.join(tmpDir, `shp_raw_preview_${Date.now()}_${Math.random().toString(36).slice(2)}.geojson`);

    const result = await runOgr2ogr([
      '-f', 'GeoJSON', tmpOut, absolutePath,
      '-a_srs', 'EPSG:4326',
    ]);
    if (result.code !== 0) {
      return { success: false, error: result.stderr || 'ogr2ogr 실패' };
    }

    const raw = await fs.readFile(tmpOut, 'utf-8');
    await fs.unlink(tmpOut).catch(() => {});
    const geojson = JSON.parse(raw) as { features?: unknown[] };
    const maxFeatures = Math.max(1, Math.min(params?.maxFeatures ?? 2000, 5000));
    if (Array.isArray(geojson.features) && geojson.features.length > maxFeatures) {
      geojson.features = geojson.features.slice(0, maxFeatures);
    }
    return { success: true, geojson: geojson as Record<string, unknown> };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
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

/** tables.json에 이미 등록된 스키마가 있으면 그대로 사용(기본 layer). 레이어 설정(Layer) 탭에서 지정한 스키마를 SHP 업로드 파이프라인이 존중하도록 함. */
async function resolveDefineTableSchema(layerName: string): Promise<'layer' | 'public_layer'> {
  const defineRes = await getDefineLayerTables();
  if (defineRes.success && Array.isArray(defineRes.tables)) {
    const row = defineRes.tables.find(
      (r) =>
        String((r as Record<string, unknown>).define_table_name ?? '').trim().toLowerCase() ===
        layerName.toLowerCase()
    );
    if (row && String((row as Record<string, unknown>).define_table_schema ?? '').trim() === 'public_layer') {
      return 'public_layer';
    }
  }
  return 'layer';
}

/**
 * sync_log 반영/롤백용: 정의 스키마 + 실제 릴레이션명으로 "schema"."table" 해석.
 * 정의 스키마에 없으면 반대 스키마도 한 번 탐색.
 */
async function resolveSyncLayerTableFq(
  tableGuess: string,
): Promise<{ fq: string; schema: 'layer' | 'public_layer'; table: string } | { error: string }> {
  const guess = String(tableGuess ?? '').trim();
  if (!guess) return { error: '테이블명이 없습니다.' };
  const preferred = await resolveDefineTableSchema(guess);
  const { resolveLayerPhysicalRelName } = await import('./standardService');
  const trySchemas: Array<'layer' | 'public_layer'> = preferred === 'layer'
    ? ['layer', 'public_layer']
    : ['public_layer', 'layer'];
  for (const schema of trySchemas) {
    const physical = await resolveLayerPhysicalRelName(schema, guess);
    if (physical) {
      const safeSchema = schema.replace(/"/g, '');
      const safeTable = physical.replace(/"/g, '');
      return { fq: `"${safeSchema}"."${safeTable}"`, schema, table: physical };
    }
  }
  return {
    error: `테이블 ${preferred}.${guess} 이(가) 없습니다. 레이어 구성요소(테이블) 생성 후 다시 시도하세요.`,
  };
}

/** lower(column_name) → 실제 column_name */
type SyncColNameMap = Map<string, string>;

async function loadSyncTableColumnMap(schema: string, table: string): Promise<SyncColNameMap> {
  const { db } = await import('@/database/db');
  const { sql } = await import('drizzle-orm');
  const esc = (s: string) => s.replace(/'/g, "''");
  const res = await db.execute(sql.raw(
    `SELECT column_name::text AS column_name
     FROM information_schema.columns
     WHERE table_schema = '${esc(schema)}' AND table_name = '${esc(table)}'`
  ));
  const map: SyncColNameMap = new Map();
  for (const r of res.rows as Array<{ column_name: string }>) {
    if (r.column_name) map.set(r.column_name.toLowerCase(), r.column_name);
  }
  return map;
}

async function resolveSyncTableWithColumns(
  tableGuess: string,
): Promise<
  | { fq: string; schema: 'layer' | 'public_layer'; table: string; colMap: SyncColNameMap }
  | { error: string }
> {
  const resolved = await resolveSyncLayerTableFq(tableGuess);
  if ('error' in resolved) return resolved;
  const colMap = await loadSyncTableColumnMap(resolved.schema, resolved.table);
  return { ...resolved, colMap };
}

function pickSyncDataVal(data: Record<string, unknown>, col: string): unknown {
  if (Object.prototype.hasOwnProperty.call(data, col)) return data[col];
  const found = Object.keys(data).find((k) => k.toLowerCase() === col.toLowerCase());
  return found != null ? data[found] : undefined;
}

/** sync_log JSONB → 실제 테이블에 존재하는 컬럼만 (키는 DB 실제명) */
function filterJsonDataToTableColumns(
  raw: unknown,
  colMap: SyncColNameMap,
): Record<string, unknown> | null {
  if (raw == null) return null;
  let data: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      data = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    data = raw as Record<string, unknown>;
  } else {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const actual = colMap.get(k.toLowerCase());
    if (actual) out[actual] = v;
  }
  return out;
}

function filterColsToTable(
  keys: string[],
  colMap: SyncColNameMap,
  excludeLower: string[] = [],
): string[] {
  const excl = new Set(excludeLower.map((e) => e.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const lower = k.toLowerCase();
    if (excl.has(lower) || lower === 'ogc_fid') continue;
    const actual = colMap.get(lower);
    if (!actual || seen.has(actual.toLowerCase())) continue;
    seen.add(actual.toLowerCase());
    out.push(actual);
  }
  return out;
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

  const tablesBySchema: Record<'layer' | 'public_layer', Set<string>> = {
    layer: new Set(),
    public_layer: new Set(),
  };
  try {
    const listRes = await getLayerTableList();
    if (listRes.success && Array.isArray(listRes.tables)) {
      for (const t of listRes.tables) {
        if (t.schema === 'layer' || t.schema === 'public_layer') tablesBySchema[t.schema].add(t.table);
      }
    }
  } catch {
    // ignore
  }

  let defineTableSet: Set<string> = new Set();
  const defineHasFields: Record<string, boolean> = {};
  const defineSchemaByName = new Map<string, 'layer' | 'public_layer'>();
  try {
    const defineRes = await getDefineLayerTables();
    if (defineRes.success && Array.isArray(defineRes.tables)) {
      for (const row of defineRes.tables) {
        const name = String(row.define_table_name ?? '').trim();
        if (name) {
          defineTableSet.add(name);
          defineHasFields[name] = fsSync.existsSync(getDefineFieldsFilePath(name));
          defineSchemaByName.set(
            name.toLowerCase(),
            String(row.define_table_schema ?? '').trim() === 'public_layer' ? 'public_layer' : 'layer'
          );
        }
      }
    }
  } catch {
    // ignore
  }

  let dbGeometryTypes: Record<string, ShpGeometryType> = {};
  try {
    const [layerTypeRes, publicTypeRes] = await Promise.all([
      getLayerTableGeometryTypes({ schema: 'layer' }),
      getLayerTableGeometryTypes({ schema: 'public_layer' }),
    ]);
    dbGeometryTypes = {
      ...(layerTypeRes.success ? layerTypeRes.types : {}),
      ...(publicTypeRes.success ? publicTypeRes.types : {}),
    };
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
    const targetSchema = defineSchemaByName.get(dbTableName) ?? defineSchemaByName.get(basename.toLowerCase()) ?? 'layer';
    const hasTable = tablesBySchema[targetSchema].has(dbTableName);
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
 * ogr2ogr/ogrinfo를 conda env에서 직접 호출할 때 필요한 환경변수.
 * `conda run` 활성화가 실제로 잡아주는 값들을 activate 전/후 환경변수 전체를 덤프해 비교 확인했다
 * (GDAL_DATA, GDAL_DRIVER_PATH, PROJ_DATA, PATH 4개가 전부 — 그 외엔 CONDA_* 내부 북키핑,
 * PYTHONUTF8, SSL_CERT_* 등 GDAL과 무관한 값들뿐이었음).
 * `conda run` 자체는 매 호출마다 활성화 오버헤드로 수 초씩 걸리고 ogrinfo 쪽은 이 환경에서
 * 활성화 래퍼가 아예 멈추는(hang) 문제까지 있어, 실행 파일을 직접 호출하고 이 값만 대신 지정한다.
 */
function buildGdalEnv(envDir: string): NodeJS.ProcessEnv {
  const isWin = process.platform === 'win32';
  const shareDir = isWin ? path.join(envDir, 'Library', 'share') : path.join(envDir, 'share');
  const binDir = isWin ? path.join(envDir, 'Library', 'bin') : path.join(envDir, 'bin');
  const pluginDir = isWin ? path.join(envDir, 'Library', 'lib', 'gdalplugins') : path.join(envDir, 'lib', 'gdalplugins');
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

/**
 * ogr2ogr 실행 방식: GGNR_GDAL_OGR2OGR → 프로젝트 python/env(직접 호출 + buildGdalEnv) → PATH
 */
function resolveOgr2ogrRun(): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } {
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
      return { cmd: candidate, args: [], env: buildGdalEnv(envDir) };
    }
  }
  return { cmd: 'ogr2ogr', args: [] };
}

/** ogrinfo 실행 방식: ogr2ogr와 동일(conda env 또는 GGNR_GDAL 경로). 도구명만 ogrinfo */
function resolveOgrInfoRun(): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } {
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
    // `conda run`은 이 환경에서 활성화 래퍼가 멈추는(hang) 문제가 있어, 실행 파일이 실제로 있으면 직접 호출한다.
    if (fsSync.existsSync(candidate)) {
      return { cmd: candidate, args: [], env: buildGdalEnv(envDir) };
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

  const { cmd: ogrinfoCmd, args: prefix, env: gdalEnv } = resolveOgrInfoRun();
  const args = [...prefix, '-al', '-so', normalized];
  const isWin = process.platform === 'win32';
  const useConda = prefix.length > 0;
  const spawnCmd = useConda ? ogrinfoCmd : (isWin ? 'cmd.exe' : ogrinfoCmd);
  const spawnArgs = useConda ? args : (isWin ? ['/c', ogrinfoCmd, ...args.slice(prefix.length)] : args);

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(spawnCmd, spawnArgs, { windowsHide: true, shell: false, env: gdalEnv ?? process.env });
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
  sourceSrsOverride?: string;
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
  const { sourceSrs, targetSrs } = await resolveShpSrs(dir, basename, params.sourceSrsOverride);
  let dbfEncoding = resolveShapefileDbfEncoding(dir, basename);

  const db = getDbConfig();
  const pgConnection = `PG:host=${db.host} port=${db.port} dbname=${db.database} user=${db.user} password=${db.password}`;
  const dbSchema = await resolveDefineTableSchema(tableName);
  const layerTable = `${dbSchema}.${tableName}`;

  const { cmd: ogr2ogrCmd, args: ogr2ogrRunPrefix, env: gdalEnv } = resolveOgr2ogrRun();

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

  const runOgr2ogr = (encoding: string) =>
    new Promise<{ code: number; stderr: string }>((resolve) => {
      const ogr2ogrArgs = [
        '-f', 'PostgreSQL',
        pgConnection,
        absolutePath,
        '-oo', `ENCODING=${encoding}`,
        '-nlt', 'PROMOTE_TO_MULTI',
        '-nln', layerTable,
        ...(sourceSrs ? (['-s_srs', sourceSrs] as const) : []),
        '-t_srs', targetSrs,
        '-lco', 'GEOMETRY_NAME=geom',
        '-overwrite',
      ];
      const execArgs = ogr2ogrRunPrefix.length > 0 ? [...ogr2ogrRunPrefix, ...ogr2ogrArgs] : ogr2ogrArgs;
      const isWin = process.platform === 'win32';
      const useConda = ogr2ogrRunPrefix.length > 0;
      const spawnCmd = useConda ? ogr2ogrCmd : (isWin ? 'cmd.exe' : ogr2ogrCmd);
      const spawnArgs = useConda ? execArgs : (isWin ? ['/c', ogr2ogrCmd, ...execArgs] : execArgs);
      const child = spawn(spawnCmd, spawnArgs, {
        windowsHide: true,
        shell: false,
        env: gdalEnv ?? process.env,
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

  const mapOgrError = (code: number, stderr: string): string => {
    const raw = stderr?.trim() || `ogr2ogr 종료 코드 ${code}`;
    const notFound =
      /내부\s*또는\s*외부\s*명령|not recognized|not found|실행할 수 있는 프로그램|배치 파일이 아닙니다/i.test(raw);
    const noPgDriver = /Unable to find driver\s*[`']?PostgreSQL|PostgreSQL.*driver/i.test(raw);
    if (notFound) {
      return `ogr2ogr를 찾을 수 없습니다. 프로젝트 python/env에 GDAL이 설치되어 있어야 합니다(개발자 모드 > LAS 파이프라인 환경 생성 및 설치). 또는 env에 GGNR_GDAL_OGR2OGR로 ogr2ogr 실행 파일 경로를 지정하세요.`;
    }
    if (noPgDriver) {
      return `GDAL에 PostgreSQL 드라이버가 없습니다. 반드시 프로젝트 루트(예: D:\\ggnr_v7)에서 아래 명령을 실행하세요. python 폴더 안에서 실행하면 안 됩니다.\n\n  conda run --prefix python/env conda install -c conda-forge libpq -y`;
    }
    return raw;
  };

  let result = await runOgr2ogr(dbfEncoding);

  // UTF-8 오판 시 PG 드라이버 Non UTF-8 → CP949로 1회 재시도
  const isNonUtf8 =
    result.code !== 0 && /Non UTF-8 content found/i.test(result.stderr ?? '');
  if (isNonUtf8 && dbfEncoding.toUpperCase().replace(/_/g, '') !== 'CP949') {
    dbfEncoding = 'CP949';
    result = await runOgr2ogr(dbfEncoding);
  }

  if (result.code !== 0) {
    return { success: false, error: mapOgrError(result.code, result.stderr) };
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
  const dbSchema = await resolveDefineTableSchema(layerName);
  return createDefineTableAndFieldsCore({
    layerName,
    dbSchema,
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
  const dbSchema = await resolveDefineTableSchema(layerName);
  const matched = listRes.tables.find((t) => t.schema === dbSchema && equalsTableName(t.table, layerName));
  if (!matched) {
    return { success: false, error: `${dbSchema} 스키마에 '${layerName}' 테이블이 없습니다. 먼저 테이블 생성을 실행하세요.` };
  }

  try {
    const geometryType = params.geometryType ?? (await getShpGeometryType(absoluteShp));
    await ensureDefineLayerEntry(layerName, geometryType, params.group, dbSchema);
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
  /** pathOrResult 별 프런트에서 확정한 EPSG override (예: {'shp_data/.../a.shp': 'EPSG:5186'}) */
  sourceSrsByPath?: Record<string, string>;
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
      const sourceSrsOverride = params.sourceSrsByPath?.[row.pathOrResult.replace(/\\/g, '/')];
      const res = await createTableFromShp({ pathOrResult: row.pathOrResult, sourceSrsOverride });
      item.table = { success: res.success, error: res.error };
      if (!res.success) {
        results.push(item);
        continue;
      }
    }

    // DB에서 geometryType 가져오기
    let geometryType: ShpGeometryType | undefined;
    try {
      const layerName = safeTableName(path.basename(row.sourceFile, '.shp'));
      const typeRes = await getLayerTableGeometryTypes({ schema: await resolveDefineTableSchema(layerName) });
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
  const { cmd: ogr2ogrCmd, args: ogr2ogrRunPrefix, env: gdalEnv } = resolveOgr2ogrRun();
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
    const child = spawn(spawnCmd, spawnArgs, { windowsHide: true, shell: false, env: gdalEnv ?? process.env });
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

  const { cmd: ogrinfoCmd, args: prefix, env: gdalEnv } = resolveOgrInfoRun();
  const args = [...prefix, ...extraArgs, normalized];
  const isWin = process.platform === 'win32';
  const useConda = prefix.length > 0;
  const spawnCmd = useConda ? ogrinfoCmd : (isWin ? 'cmd.exe' : ogrinfoCmd);
  const spawnArgs = useConda ? args : (isWin ? ['/c', ogrinfoCmd, ...args.slice(prefix.length)] : args);

  return new Promise<string>((resolve) => {
    const child = spawn(spawnCmd, spawnArgs, { windowsHide: true, shell: false, env: gdalEnv ?? process.env });
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

type SyncColPair = { db: string; sync: string };

async function fetchInfoSchemaColumns(schema: string, tableName: string): Promise<string[]> {
  const { db } = await import('@/database/db');
  const { sql } = await import('drizzle-orm');
  // ogc_fid는 key로 쓸 수 있어야 하므로 목록에 포함. 속성 diff에서는 별도로 제외한다.
  const colRes = await db.execute(sql.raw(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = '${schema}' AND table_name = '${tableName}'
     ORDER BY ordinal_position`
  ));
  return (colRes.rows as Array<{ column_name: string }>).map((r) => r.column_name);
}

function buildSyncColPairs(dbColumns: string[], syncColumns: string[]): SyncColPair[] {
  const syncByLower = new Map(syncColumns.map((c) => [c.toLowerCase(), c]));
  const pairs: SyncColPair[] = [];
  for (const db of dbColumns) {
    const sync = syncByLower.get(db.toLowerCase());
    if (sync) pairs.push({ db, sync });
  }
  return pairs;
}

function resolveSyncedColumn(columns: string[], name: string): string | null {
  return columns.find((c) => c.toLowerCase() === name.toLowerCase()) ?? null;
}

/** 속성 해시 — kept 시점 SHP/DB 스냅샷과 현재 행 속성이 같으면 동일 */
function syncAttrHashSql(alias: string, pairs: SyncColPair[], useSyncCol: boolean): string {
  if (pairs.length === 0) return `md5('')`;
  const parts = pairs.map((p) => {
    const col = useSyncCol ? p.sync : p.db;
    return `COALESCE(${alias}."${col}"::text, '')`;
  });
  return `md5(concat_ws(E'\\x1f', ${parts.join(', ')}))`;
}

function syncLogJsonAttrHashSql(jsonExpr: string, dbCols: string[]): string {
  if (dbCols.length === 0) return `md5('')`;
  const parts = dbCols.map((c) => `COALESCE((${jsonExpr})->>'${c}', '')`);
  return `md5(concat_ws(E'\\x1f', ${parts.join(', ')}))`;
}

/**
 * sync_log JSONB 내용 해시 — PostgreSQL jsonb canonical ::text 기준.
 * 미결 중복/대체 판정에서 JSONB 통째 IS DISTINCT FROM 대신 사용 (의미≈jsonb 동등).
 */
function syncLogJsonbContentHashSql(jsonExpr: string): string {
  return `md5(COALESCE((${jsonExpr})::text, ''))`;
}

/** sync_log geom 메타 비교용: srs 차이는 무시하고 type/hash/_meta만 본다. */
function syncLogGeomMetaComparableSql(jsonExpr: string): string {
  return `CASE
    WHEN (${jsonExpr}) IS NULL THEN NULL
    ELSE ((${jsonExpr}) - 'srs')
  END`;
}

/** sync_log JSONB의 geom이 좌표 없는 메타({type,hash})인지 — 레거시 GeoJSON과 구분 */
function isSyncGeomMeta(g: unknown): boolean {
  if (g == null || typeof g !== 'object' || Array.isArray(g)) return false;
  const o = g as Record<string, unknown>;
  if ('coordinates' in o || 'geometries' in o) return false;
  return typeof o.hash === 'string' || o._meta === true;
}

/** sync_log geom 메타에 저장된 소스 좌표계 (예: EPSG:5186) */
function syncGeomMetaSrs(g: unknown): string | undefined {
  if (!isSyncGeomMeta(g)) return undefined;
  const srs = (g as Record<string, unknown>).srs;
  return typeof srs === 'string' && srs.trim() ? srs.trim() : undefined;
}

function syncKeptGeomMatchSql(
  jsonExpr: string,
  alias: string,
  geomPair: SyncColPair | null,
): string {
  if (!geomPair) return 'TRUE';
  const { db, sync } = geomPair;
  const geomCol = alias === 'e' ? db : sync;
  const g = `${alias}."${geomCol}"`;
  const j = `${jsonExpr}->'${db}'`;
  const tableHash = geomCompareHashSql(g);
  const legacyGeom = `ST_GeomFromGeoJSON((${j})::text)::geometry`;
  return `(
    ((${j}) IS NULL AND ${g} IS NULL)
    OR (
      (${j}) IS NOT NULL
      AND ${g} IS NOT NULL
      AND (
        (
          (${j}) ? 'hash'
          AND (${j})->>'hash' = ${tableHash}
        )
        OR (
          NOT ((${j}) ? 'hash')
          AND ST_Equals(
            ${geomCompareSnapSql(g)},
            ${geomCompareSnapSql(legacyGeom)}
          )
        )
      )
    )
  )`;
}

/**
 * sync_log 저장용 행 JSON.
 * - geom: type+hash 메타만 (목록 «좌표 변경»·kept 매칭용). 대량 GeoJSON 직렬화 회피
 * - hash: SnapToGrid(1mm) 후 WKB — 재투영 미세 오차는 동일 hash
 * - sourceSrs: SHP 소스 좌표계를 geom 메타에 기록 (상세·재반영 시 동일 CRS로 복원)
 * - includeRollbackGeom: old 스냅샷에 __rollback_geom(GeoJSON) 추가 — 반영 롤백/재삽입용
 */
function syncLogRowJsonSqlFromPairs(
  alias: string,
  attrPairs: SyncColPair[],
  geomPair: SyncColPair | null,
  opts?: {
    includeRollbackGeom?: boolean;
    sourceSrs?: string | null;
    /** jsonb_build_object(...) 조각 — 공간 매칭 메타 등 */
    extraJsonbSql?: string | null;
  },
): string {
  const attrParts = attrPairs.flatMap((p) => {
    const col = alias === 'e' ? p.db : p.sync;
    return [`'${p.db}'`, `${alias}."${col}"`];
  });
  let baseJson =
    attrParts.length === 0 ? "'{}'::jsonb" : `jsonb_build_object(${attrParts.join(', ')})`;
  if (opts?.extraJsonbSql) {
    baseJson = `(${baseJson} || (${opts.extraJsonbSql}))`;
  }
  if (!geomPair) return baseJson;
  const { db, sync } = geomPair;
  const geomCol = alias === 'e' ? db : sync;
  const g = `${alias}."${geomCol}"`;
  const srsSql =
    opts?.sourceSrs && /^EPSG:\d{3,5}$/i.test(opts.sourceSrs.trim())
      ? `, 'srs', '${opts.sourceSrs.trim().toUpperCase().replace(/'/g, "''")}'`
      : '';
  const metaGeom = `CASE
    WHEN ${g} IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      '${db}',
      jsonb_build_object(
        'type', GeometryType(${g}::geometry),
        'hash', ${geomCompareHashSql(g)},
        '_meta', true${srsSql}
      )
    )
  END`;
  if (!opts?.includeRollbackGeom) {
    return `(${baseJson} || ${metaGeom})`;
  }
  return `(${baseJson} || ${metaGeom} || CASE
    WHEN ${g} IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('__rollback_geom', ST_AsGeoJSON(${g})::jsonb)
  END)`;
}

/** SHP 비교·조회용 임시 테이블(_sync_*) 삭제. 실패해도 무시. */
async function dropShpSyncTempTable(dbSchema: string, syncTableName: string): Promise<void> {
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${dbSchema}."${syncTableName}"`));
  } catch {
    // cleanup best-effort
  }
}

/**
 * key 중복 시 같은 key 그룹 안에서 geom 최근접 탐욕 1:1 매칭.
 * 결과 테이블: sync_fid, db_fid, key_val
 */
async function buildSpatialKeyMatchTable(params: {
  dbSchema: string;
  matchTable: string;
  tableName: string;
  syncTableName: string;
  keyDb: string;
  keySync: string;
  geomDb: string;
  geomSync: string;
  fidDb: string;
  fidSync: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const { db } = await import('@/database/db');
  const { sql } = await import('drizzle-orm');
  const {
    dbSchema, matchTable, tableName, syncTableName,
    keyDb, keySync, geomDb, geomSync, fidDb, fidSync,
  } = params;

  const maxRes = await db.execute(sql.raw(
    `SELECT max(cnt)::int AS m FROM (
       SELECT count(*)::int AS cnt FROM ${dbSchema}."${tableName}"
       GROUP BY "${keyDb}"::text
       UNION ALL
       SELECT count(*)::int AS cnt FROM ${dbSchema}."${syncTableName}"
       GROUP BY "${keySync}"::text
     ) s`
  ));
  const maxPerKey = (maxRes.rows as Array<{ m: number | null }>)[0]?.m ?? 0;
  if (maxPerKey > SPATIAL_MATCH_MAX_PER_KEY) {
    return {
      success: false,
      error: `key 값 하나가 최대 ${maxPerKey}건으로 중복됩니다. 공간 매칭 한도(${SPATIAL_MATCH_MAX_PER_KEY})를 초과해 정합성을 중단합니다. 유일 key를 설정하세요.`,
    };
  }

  await db.execute(sql.raw(`DROP TABLE IF EXISTS ${dbSchema}."${matchTable}"`));
  await db.execute(sql.raw(
    `CREATE TABLE ${dbSchema}."${matchTable}" (
       sync_fid integer NOT NULL,
       db_fid integer NOT NULL,
       key_val text NOT NULL,
       PRIMARY KEY (sync_fid),
       UNIQUE (db_fid)
     )`
  ));

  const candRes = await db.execute(sql.raw(
    `SELECT
       e."${fidDb}"::int AS db_fid,
       t."${fidSync}"::int AS sync_fid,
       e."${keyDb}"::text AS key_val,
       ST_Distance(
         ST_Centroid(e."${geomDb}"::geometry),
         ST_Centroid(t."${geomSync}"::geometry)
       ) AS dist,
       ST_HausdorffDistance(
         ${geomCompareSnapSql(`e."${geomDb}"`)},
         ${geomCompareSnapSql(`t."${geomSync}"`)}
       ) AS haus
     FROM ${dbSchema}."${tableName}" e
     JOIN ${dbSchema}."${syncTableName}" t
       ON e."${keyDb}"::text = t."${keySync}"::text
     WHERE e."${geomDb}" IS NOT NULL AND t."${geomSync}" IS NOT NULL
     ORDER BY key_val,
       dist ASC NULLS LAST,
       haus ASC NULLS LAST,
       db_fid,
       sync_fid`
  ));

  const usedDb = new Set<number>();
  const usedSync = new Set<number>();
  const pairs: Array<{ db_fid: number; sync_fid: number; key_val: string }> = [];
  for (const row of candRes.rows as Array<{
    db_fid: number; sync_fid: number; key_val: string;
  }>) {
    const dbFid = Number(row.db_fid);
    const syncFid = Number(row.sync_fid);
    if (!Number.isFinite(dbFid) || !Number.isFinite(syncFid)) continue;
    if (usedDb.has(dbFid) || usedSync.has(syncFid)) continue;
    usedDb.add(dbFid);
    usedSync.add(syncFid);
    pairs.push({ db_fid: dbFid, sync_fid: syncFid, key_val: String(row.key_val ?? '') });
  }

  if (pairs.length === 0) return { success: true };

  const CHUNK = 500;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const values = chunk.map((p) => {
      const kv = p.key_val.replace(/'/g, "''");
      return `(${p.sync_fid}, ${p.db_fid}, '${kv}')`;
    }).join(',\n');
    await db.execute(sql.raw(
      `INSERT INTO ${dbSchema}."${matchTable}" (sync_fid, db_fid, key_val) VALUES ${values}`
    ));
  }
  return { success: true };
}

/** 이력·힌트로 SHP 상대경로 해석 (new geom 메타 하이드레이트용) */
async function resolveShpPathForSync(params: {
  dhKey?: number | null;
  tableName: string;
  shpPathHint?: string | null;
}): Promise<string | null> {
  const hint = params.shpPathHint?.trim();
  if (hint) return hint.replace(/\\/g, '/');
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    if (params.dhKey != null && Number.isFinite(Number(params.dhKey))) {
      const r = await db.execute(sql.raw(
        `SELECT dh_shp_path AS p FROM layer_detail_history WHERE dh_key = ${Math.floor(Number(params.dhKey))} LIMIT 1`
      ));
      const p = String((r.rows as Array<{ p: string | null }>)[0]?.p ?? '').trim();
      if (p) return p.replace(/\\/g, '/');
    }
    const safeName = String(params.tableName ?? '').replace(/'/g, "''");
    if (!safeName) return null;
    const r2 = await db.execute(sql.raw(
      `SELECT dh_shp_path AS p FROM layer_detail_history
       WHERE lower(dh_name) = lower('${safeName}')
         AND dh_shp_path IS NOT NULL AND btrim(dh_shp_path) <> ''
       ORDER BY dh_key DESC LIMIT 1`
    ));
    const p2 = String((r2.rows as Array<{ p: string | null }>)[0]?.p ?? '').trim();
    return p2 ? p2.replace(/\\/g, '/') : null;
  } catch {
    return null;
  }
}

type SyncHydrateTemp = {
  dbSchema: string;
  syncTableName: string;
  keyCol: string;
  geomCol: string;
};

/**
 * 상세 미니맵용: SHP에서 키 1건만 GeoJSON geometry로 추출 (전체 PG import 없음).
 * sync_log 메타 저장은 유지한 채, 상세 조회 시에만 좌표 복원.
 */
async function fetchShpFeatureGeoJsonByKey(params: {
  pathOrResult: string;
  keyField: string;
  keyValue: string;
  sourceSrsOverride?: string;
}): Promise<{ success: true; geometry: Record<string, unknown> } | { success: false; error: string }> {
  const pathOrResult = params.pathOrResult.trim();
  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  try {
    await fs.stat(absolutePath);
  } catch {
    return { success: false, error: `SHP 파일을 찾을 수 없습니다. (${pathOrResult})` };
  }

  const dir = path.dirname(absolutePath);
  const basename = path.basename(pathOrResult, '.shp');
  const { sourceSrs, targetSrs } = await resolveShpSrs(dir, basename, params.sourceSrsOverride);
  const srsArgs = ogrSrsTransformArgs(sourceSrs, targetSrs);
  if (!srsArgs) {
    return {
      success: false,
      error: '소스 좌표계를 알 수 없습니다. 비교 시 선택한 EPSG가 sync_log에 없거나 .prj가 없습니다.',
    };
  }
  const dbfEncoding = resolveShapefileDbfEncoding(dir, basename);

  const tmpDir = path.join(GGNR_DATA_DIR, 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpOut = path.join(tmpDir, `shp_feat_${Date.now()}_${Math.random().toString(36).slice(2)}.geojson`);

  const keyField = params.keyField.replace(/"/g, '').trim();
  if (!keyField) return { success: false, error: 'key 필드가 비어 있습니다.' };
  const kv = String(params.keyValue ?? '');
  const kvEscaped = kv.replace(/'/g, "''");
  const isNumeric = /^-?\d+(\.\d+)?$/.test(kv.trim());
  const keyFieldVariants = [...new Set([keyField, keyField.toLowerCase(), keyField.toUpperCase()])];
  const whereCandidates: string[] = [];
  for (const kf of keyFieldVariants) {
    whereCandidates.push(`"${kf}" = '${kvEscaped}'`, `${kf} = '${kvEscaped}'`);
    if (isNumeric) {
      whereCandidates.push(`"${kf}" = ${kv.trim()}`, `${kf} = ${kv.trim()}`);
    }
  }

  let lastError = '';
  try {
    for (const whereClause of whereCandidates) {
      await fs.unlink(tmpOut).catch(() => {});
      const result = await runOgr2ogr([
        '-f', 'GeoJSON', tmpOut, absolutePath,
        '-oo', `ENCODING=${dbfEncoding}`,
        '-where', whereClause,
        '-nlt', 'PROMOTE_TO_MULTI',
        ...srsArgs,
      ]);
      if (result.code !== 0) {
        lastError = result.stderr || 'ogr2ogr 실패';
        continue;
      }
      if (!fsSync.existsSync(tmpOut)) {
        lastError = 'GeoJSON 출력이 없습니다.';
        continue;
      }
      const raw = await fs.readFile(tmpOut, 'utf-8');
      let geojson: { features?: Array<{ geometry?: Record<string, unknown> | null }> };
      try {
        geojson = JSON.parse(raw) as { features?: Array<{ geometry?: Record<string, unknown> | null }> };
      } catch {
        lastError = 'GeoJSON 파싱 실패';
        continue;
      }
      const geom = geojson.features?.[0]?.geometry;
      if (geom && typeof geom === 'object' && 'type' in geom) {
        return { success: true, geometry: geom };
      }
      lastError = `SHP에서 key=${kv} 도형을 찾지 못했습니다.`;
    }
    return { success: false, error: lastError || 'SHP 단건 추출 실패' };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await fs.unlink(tmpOut).catch(() => {});
  }
}

/** 메타 geom(new) 하이드레이트용 — SHP를 _sync_* 임시 테이블로 import */
async function importShpToSyncTempForHydrate(params: {
  pathOrResult: string;
  tableName: string;
  keyField: string;
  sourceSrsOverride?: string;
}): Promise<{ success: true; temp: SyncHydrateTemp } | { success: false; error: string }> {
  const pathOrResult = params.pathOrResult.trim();
  const tableName = safeTableName(params.tableName);
  const syncTableName = `_sync_${tableName}`;
  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  try {
    await fs.stat(absolutePath);
  } catch {
    return { success: false, error: `SHP 파일을 찾을 수 없습니다. (${pathOrResult})` };
  }

  const dbSchema = await resolveDefineTableSchema(tableName);
  const dir = path.dirname(absolutePath);
  const basename = path.basename(pathOrResult, '.shp');
  const { sourceSrs, targetSrs } = await resolveShpSrs(dir, basename, params.sourceSrsOverride);
  const srsArgs = ogrSrsTransformArgs(sourceSrs, targetSrs);
  if (!srsArgs) {
    return {
      success: false,
      error: '소스 좌표계를 알 수 없습니다. 비교 시 선택한 EPSG가 sync_log에 없거나 .prj가 없습니다.',
    };
  }
  const dbfEncoding = resolveShapefileDbfEncoding(dir, basename);
  const dbCfg = getDbConfig();
  const pgConnection = `PG:host=${dbCfg.host} port=${dbCfg.port} dbname=${dbCfg.database} user=${dbCfg.user} password=${dbCfg.password}`;

  await dropShpSyncTempTable(dbSchema, syncTableName);
  const importResult = await runOgr2ogr([
    '-f', 'PostgreSQL', pgConnection, absolutePath,
    '-oo', `ENCODING=${dbfEncoding}`,
    '-nlt', 'PROMOTE_TO_MULTI',
    '-nln', `${dbSchema}.${syncTableName}`,
    ...srsArgs,
    '-lco', 'GEOMETRY_NAME=geom',
    '-lco', 'PG_USE_COPY=YES',
    '-overwrite',
  ]);
  if (importResult.code !== 0) {
    return { success: false, error: `임시 테이블 import 실패: ${importResult.stderr}` };
  }

  const syncColumns = await fetchInfoSchemaColumns(dbSchema, syncTableName);
  const keyCol = resolveSyncedColumn(syncColumns, params.keyField);
  if (!keyCol) {
    await dropShpSyncTempTable(dbSchema, syncTableName);
    return { success: false, error: `key 필드 '${params.keyField}'가 임시 테이블에 없습니다.` };
  }
  let geomCol = resolveSyncedColumn(syncColumns, 'geom') ?? 'geom';
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const gCol = await db.execute(sql.raw(
      `SELECT f_geometry_column::text AS col FROM geometry_columns
       WHERE f_table_schema = '${dbSchema}' AND f_table_name = '${syncTableName}' LIMIT 1`
    ));
    const c = (gCol.rows as Array<{ col: string }>)[0]?.col?.trim();
    if (c) geomCol = c;
  } catch { /* keep geomCol */ }

  const { db } = await import('@/database/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql.raw(
    `CREATE INDEX ON ${dbSchema}."${syncTableName}" ("${keyCol}")`
  )).catch(() => {});

  return {
    success: true,
    temp: { dbSchema, syncTableName, keyCol, geomCol },
  };
}

async function fetchGeoJsonByKey(params: {
  schemaTableSql: string;
  geomCol: string;
  keyCol: string;
  keyValue: string;
}): Promise<unknown | null> {
  const { db } = await import('@/database/db');
  const { sql } = await import('drizzle-orm');
  const safeKv = params.keyValue.replace(/'/g, "''");
  const res = await db.execute(sql.raw(
    `SELECT ST_AsGeoJSON(t."${params.geomCol}")::jsonb AS g
     FROM ${params.schemaTableSql} t
     WHERE t."${params.keyCol}"::text = '${safeKv}'
     LIMIT 1`
  ));
  return (res.rows as Array<{ g: unknown }>)[0]?.g ?? null;
}

async function fetchGeoJsonByOgcFid(params: {
  schemaTableSql: string;
  geomCol: string;
  ogcFid: number;
  fidCol?: string;
}): Promise<unknown | null> {
  const { db } = await import('@/database/db');
  const { sql } = await import('drizzle-orm');
  const fidCol = params.fidCol ?? 'ogc_fid';
  const res = await db.execute(sql.raw(
    `SELECT ST_AsGeoJSON(t."${params.geomCol}")::jsonb AS g
     FROM ${params.schemaTableSql} t
     WHERE t."${fidCol}" = ${Math.trunc(params.ogcFid)}
     LIMIT 1`
  ));
  return (res.rows as Array<{ g: unknown }>)[0]?.g ?? null;
}

/**
 * DB 쓰기 직전: 메타 geom은 좌표로 치환.
 * - __rollback_geom 있으면 그걸 geom으로 사용 (old 롤백)
 * - new 메타는 syncTemp에서 조회
 * - 공간 매칭 메타(__match_*)가 있으면 ogc_fid로 조회 (비유일 key 대응)
 */
async function prepareSyncDataForDbWrite(params: {
  data: Record<string, unknown> | null;
  side: 'old' | 'new';
  keyValue: string;
  syncTemp?: SyncHydrateTemp | null;
  liveFq?: string;
  liveGeomCol?: string;
  liveKeyCol?: string;
}): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  if (!params.data) return { data: null };
  const matchDbFid = readSyncMatchOgcFid(params.data);
  const matchSyncFid = readSyncMatchSyncFid(params.data);
  const out: Record<string, unknown> = { ...params.data };
  const rollback = out.__rollback_geom;
  delete out.__rollback_geom;
  delete out[SYNC_MATCH_OGC_FID];
  delete out[SYNC_MATCH_SYNC_FID];

  if (!isSyncGeomMeta(out.geom)) {
    if (rollback != null && out.geom == null) out.geom = rollback;
    return { data: out };
  }

  if (rollback != null) {
    out.geom = rollback;
    return { data: out };
  }

  if (params.side === 'new' && params.syncTemp) {
    const g = matchSyncFid != null
      ? await fetchGeoJsonByOgcFid({
        schemaTableSql: `${params.syncTemp.dbSchema}."${params.syncTemp.syncTableName}"`,
        geomCol: params.syncTemp.geomCol,
        ogcFid: matchSyncFid,
      })
      : await fetchGeoJsonByKey({
        schemaTableSql: `${params.syncTemp.dbSchema}."${params.syncTemp.syncTableName}"`,
        geomCol: params.syncTemp.geomCol,
        keyCol: params.syncTemp.keyCol,
        keyValue: params.keyValue,
      });
    if (g == null) {
      return { data: out, error: `SHP에서 geom을 찾지 못했습니다. (key=${params.keyValue})` };
    }
    out.geom = g;
    return { data: out };
  }

  if (params.side === 'old' && params.liveFq && params.liveGeomCol) {
    const g = matchDbFid != null
      ? await fetchGeoJsonByOgcFid({
        schemaTableSql: params.liveFq,
        geomCol: params.liveGeomCol,
        ogcFid: matchDbFid,
      })
      : (params.liveKeyCol
        ? await fetchGeoJsonByKey({
          schemaTableSql: params.liveFq,
          geomCol: params.liveGeomCol,
          keyCol: params.liveKeyCol,
          keyValue: params.keyValue,
        })
        : null);
    if (g == null) {
      return { data: out, error: `DB에서 geom을 찾지 못했습니다. (key=${params.keyValue})` };
    }
    out.geom = g;
    return { data: out };
  }

  return { data: out, error: 'geom 메타만 있어 좌표를 복원할 수 없습니다.' };
}

/** 상세 미니맵용: old/new geom 메타를 GeoJSON으로 채움.
 * sync_log 저장(메타 only)은 유지. 상세 조회 시에만 좌표 복원.
 * new(SHP) 실패해도 old(__rollback_geom/DB)는 row에 반영해 partial 반환. */
async function hydrateSyncLogRowForDetail(params: {
  row: Record<string, unknown>;
  shpPathHint?: string | null;
  dhKey?: number | null;
  sourceSrsOverride?: string | null;
}): Promise<{ row: Record<string, unknown>; error?: string }> {
  const row = { ...params.row };
  const tableName = String(row.sl_table_name ?? '').trim();
  const keyField = String(row.sl_key_field ?? '').trim();
  const keyValue = String(row.sl_key_value ?? '');
  if (!tableName || !keyField) return { row };

  let oldData = (row.sl_old_data && typeof row.sl_old_data === 'object' && !Array.isArray(row.sl_old_data))
    ? { ...(row.sl_old_data as Record<string, unknown>) }
    : null;
  let newData = (row.sl_new_data && typeof row.sl_new_data === 'object' && !Array.isArray(row.sl_new_data))
    ? { ...(row.sl_new_data as Record<string, unknown>) }
    : null;

  const needNew = !!(newData && isSyncGeomMeta(newData.geom));
  const needOld = !!(oldData && isSyncGeomMeta(oldData.geom) && oldData.__rollback_geom == null);

  const commitPartial = () => {
    row.sl_old_data = oldData;
    row.sl_new_data = newData;
  };

  const resolveDhKey = (): number | null => {
    if (params.dhKey != null && Number.isFinite(Number(params.dhKey))) {
      return Math.floor(Number(params.dhKey));
    }
    if (row.sl_dh_key != null && Number.isFinite(Number(row.sl_dh_key))) {
      return Math.floor(Number(row.sl_dh_key));
    }
    return null;
  };

  let syncTemp: SyncHydrateTemp | null = null;
  try {
    // 1) old 먼저 — __rollback_geom 또는 live DB. new 실패와 무관하게 반영
    let liveFq: string | undefined;
    let liveGeomCol: string | undefined;
    let liveKeyCol: string | undefined;
    if (needOld) {
      const resolved = await resolveSyncTableWithColumns(tableName);
      if (!('error' in resolved)) {
        liveFq = resolved.fq;
        liveKeyCol = resolved.colMap.get(keyField.toLowerCase()) ?? keyField;
        liveGeomCol = resolved.colMap.get('geom') ?? 'geom';
      }
    }

    let oldError: string | undefined;
    if (oldData) {
      const prepared = await prepareSyncDataForDbWrite({
        data: oldData,
        side: 'old',
        keyValue,
        liveFq,
        liveGeomCol,
        liveKeyCol,
      });
      if (prepared.error && isSyncGeomMeta(oldData.geom) && oldData.__rollback_geom == null) {
        oldError = prepared.error;
      } else {
        oldData = prepared.data;
        if (oldData) delete oldData.__rollback_geom;
      }
    }
    commitPartial();

    // 2) new — 단건 GeoJSON 추출 우선, 실패 시 임시 테이블 import fallback
    let newError: string | undefined;
    if (needNew) {
      const shpPath = await resolveShpPathForSync({
        dhKey: resolveDhKey(),
        tableName,
        shpPathHint: params.shpPathHint,
      });
      if (!shpPath) {
        newError = 'SHP 경로를 찾을 수 없어 지도(신규) geom을 불러오지 못했습니다.';
      } else {
        const metaSrs = syncGeomMetaSrs(newData?.geom);
        const srsOverride = params.sourceSrsOverride || metaSrs || undefined;
        const matchSyncFid = readSyncMatchSyncFid(newData);
        // 공간 매칭 key_value(이름#번호)는 SHP 속성 lookup에 쓸 수 없음 → syncTemp/ogc_fid 경로
        const direct = matchSyncFid != null
          ? { success: false as const, error: 'spatial_match_skip_direct' }
          : await fetchShpFeatureGeoJsonByKey({
            pathOrResult: shpPath,
            keyField,
            keyValue,
            sourceSrsOverride: srsOverride,
          });
        if (direct.success) {
          newData = { ...(newData as Record<string, unknown>), geom: direct.geometry };
          delete (newData as Record<string, unknown>).__rollback_geom;
        } else {
          const imported = await importShpToSyncTempForHydrate({
            pathOrResult: shpPath,
            tableName,
            keyField,
            sourceSrsOverride: srsOverride,
          });
          if (!imported.success) {
            newError = imported.error || direct.error;
          } else {
            syncTemp = imported.temp;
            const prepared = await prepareSyncDataForDbWrite({
              data: newData,
              side: 'new',
              keyValue,
              syncTemp,
            });
            if (prepared.error) {
              newError = prepared.error;
            } else {
              newData = prepared.data;
              if (newData) delete newData.__rollback_geom;
            }
          }
        }
      }
    } else if (newData) {
      const prepared = await prepareSyncDataForDbWrite({
        data: newData,
        side: 'new',
        keyValue,
        syncTemp: null,
      });
      if (prepared.error) {
        newError = prepared.error;
      } else {
        newData = prepared.data;
        if (newData) delete newData.__rollback_geom;
      }
    }
    commitPartial();

    const error = newError ?? oldError;
    return error ? { row, error } : { row };
  } finally {
    if (syncTemp) {
      await dropShpSyncTempTable(syncTemp.dbSchema, syncTemp.syncTableName);
    }
  }
}

/** 정합성 비교 단계별 소요시간 계측 (서버 콘솔 `[compareShpWithTable]` 로그) */
function createCompareTiming(tableName: string) {
  const startedAt = Date.now();
  let lastAt = startedAt;
  const stages: Record<string, number> = {};
  const log = (payload: Record<string, unknown>) => {
    console.log('[compareShpWithTable]', JSON.stringify({ tableName, ...payload }));
  };
  return {
    /** 긴 작업 직전 — 멈춘 것처럼 보일 때 “어디를 대기 중인지” 확인용 */
    enter(stage: string, extra?: Record<string, unknown>) {
      log({ event: 'enter', stage, elapsedMs: Date.now() - startedAt, ...extra });
    },
    mark(stage: string) {
      const now = Date.now();
      stages[stage] = (stages[stage] ?? 0) + (now - lastAt);
      lastAt = now;
      log({ event: 'done', stage, ms: stages[stage], elapsedMs: now - startedAt });
    },
    /** 조기 return·성공·실패 공통. success/error/건수 등 부가 정보 포함 */
    flush(extra?: Record<string, unknown>) {
      const totalMs = Date.now() - startedAt;
      log({ event: 'finish', totalMs, stages, ...extra });
    },
  };
}

/**
 * SHP를 임시 테이블로 import 후 기존 테이블과 key 기준 diff 비교.
 * 비교 결과를 sync_log에 미결(operation=NULL)로 저장한 뒤 임시 테이블 삭제.
 * import 시도 이후에는 성공·실패·예외와 무관하게 finally에서 임시 테이블을 DROP한다.
 */
export async function compareShpWithTable(params: {
  pathOrResult: string;
  sourceSrsOverride?: string;
  /** 있으면 이 상세 이력의 kept만 «유지 인정». 없으면 kept 무시(이전 업로드 유지가 새 비교를 가리지 않음). */
  dhKey?: number;
}): Promise<CompareResult> {
  const empty: CompareResult = { success: false, appendCount: 0, conflictCount: 0, removeCount: 0, unchangedCount: 0, conflicts: [], removes: [] };
  const pathOrResult = params?.pathOrResult?.trim();
  if (!pathOrResult) return { ...empty, error: 'pathOrResult가 필요합니다.' };
  const scopeDhKey =
    params.dhKey != null && Number.isFinite(Number(params.dhKey)) && Number(params.dhKey) > 0
      ? Math.trunc(Number(params.dhKey))
      : null;

  const absolutePath = path.join(GGNR_DATA_DIR, pathOrResult.replace(/\//g, path.sep));
  const basename = path.basename(pathOrResult, '.shp');
  const tableName = safeTableName(basename);
  const syncTableName = `_sync_${tableName}`;
  const timing = createCompareTiming(tableName);

  try {
    await fs.stat(absolutePath);
  } catch {
    timing.flush({ success: false, error: 'file_not_found' });
    return { ...empty, error: 'SHP 파일을 찾을 수 없습니다.' };
  }

  const keyField = getKeyFieldName(tableName);
  if (!keyField) {
    timing.flush({ success: false, error: 'no_key_field' });
    return { ...empty, error: `key 필드가 설정되어 있지 않습니다. 레이어 속성정보에서 key를 설정하세요. (${tableName})` };
  }

  const dbSchema = await resolveDefineTableSchema(tableName);

  const dir = path.dirname(absolutePath);
  const { sourceSrs, targetSrs } = await resolveShpSrs(dir, basename, params.sourceSrsOverride);
  const dbfEncoding = resolveShapefileDbfEncoding(dir, basename);

  const dbCfg = getDbConfig();
  const pgConnection = `PG:host=${dbCfg.host} port=${dbCfg.port} dbname=${dbCfg.database} user=${dbCfg.user} password=${dbCfg.password}`;
  timing.mark('resolve');

  let syncImportAttempted = false;
  let flushed = false;
  const matchTableName = `_sync_match_${tableName}`;
  let useSpatialMatch = false;
  try {
    await dropShpSyncTempTable(dbSchema, syncTableName);
    await dropShpSyncTempTable(dbSchema, matchTableName);
    timing.mark('dropTemp');

    const importResult = await runOgr2ogr([
      '-f', 'PostgreSQL', pgConnection, absolutePath,
      '-oo', `ENCODING=${dbfEncoding}`,
      '-nlt', 'PROMOTE_TO_MULTI',
      '-nln', `${dbSchema}.${syncTableName}`,
      ...(sourceSrs ? ['-s_srs', sourceSrs] as const : []),
      '-t_srs', targetSrs,
      '-lco', 'GEOMETRY_NAME=geom',
      '-lco', 'PG_USE_COPY=YES',
      '-overwrite',
    ]);
    syncImportAttempted = true;
    timing.mark('ogr2ogrImport');

    if (importResult.code !== 0) {
      timing.flush({ success: false, error: 'ogr2ogr_import_failed' });
      flushed = true;
      return { ...empty, error: `임시 테이블 import 실패: ${importResult.stderr}` };
    }

    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const [dbColumns, syncColumns] = await Promise.all([
      fetchInfoSchemaColumns(dbSchema, tableName),
      fetchInfoSchemaColumns(dbSchema, syncTableName),
    ]);
    const columns = dbColumns.filter((c) => c !== 'geom');

    const resolvedKeyDb = resolveSyncedColumn(dbColumns, keyField);
    const resolvedKeySync = resolveSyncedColumn(syncColumns, keyField);
    if (!resolvedKeyDb || !resolvedKeySync) {
      timing.flush({ success: false, error: 'key_column_missing' });
      flushed = true;
      return { ...empty, error: `key 필드 '${keyField}'가 테이블에 존재하지 않습니다.` };
    }

    // sync_log.sl_key_value NOT NULL — 키 값이 비어 있으면 비교·저장 전에 막는다.
    const [nullKeySyncRes, nullKeyDbRes] = await Promise.all([
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM ${dbSchema}."${syncTableName}"
         WHERE "${resolvedKeySync}" IS NULL OR btrim("${resolvedKeySync}"::text) = ''`
      )),
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM ${dbSchema}."${tableName}"
         WHERE "${resolvedKeyDb}" IS NULL OR btrim("${resolvedKeyDb}"::text) = ''`
      )),
    ]);
    const nullKeySyncCnt = (nullKeySyncRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    const nullKeyDbCnt = (nullKeyDbRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    if (nullKeySyncCnt > 0 || nullKeyDbCnt > 0) {
      const parts: string[] = [];
      if (nullKeySyncCnt > 0) parts.push(`SHP ${nullKeySyncCnt}건`);
      if (nullKeyDbCnt > 0) parts.push(`DB ${nullKeyDbCnt}건`);
      timing.flush({ success: false, error: 'null_key_value' });
      flushed = true;
      return {
        ...empty,
        error: `key 필드 '${resolvedKeyDb}'에 빈 값이 있습니다 (${parts.join(', ')}). 키로 쓸 수 없는 행이 있어 정합성 검증을 중단합니다.`,
      };
    }

    await db.execute(sql.raw(
      `CREATE INDEX ON ${dbSchema}."${syncTableName}" ("${resolvedKeySync}")`
    )).catch(() => {});

    let geometryDb: string | null = null;
    try {
      const gCol = await db.execute(sql.raw(
        `SELECT f_geometry_column::text AS col FROM geometry_columns
         WHERE f_table_schema = '${dbSchema}' AND f_table_name = '${tableName}' LIMIT 1`
      ));
      const c = (gCol.rows as Array<{ col: string }>)[0]?.col;
      if (c?.trim()) geometryDb = c.trim();
    } catch {
      geometryDb = null;
    }
    if (!geometryDb && dbColumns.includes('geom')) geometryDb = 'geom';

    const geometrySync = geometryDb ? resolveSyncedColumn(syncColumns, geometryDb) : null;
    const geomPair: SyncColPair | null =
      geometryDb && geometrySync ? { db: geometryDb, sync: geometrySync } : null;

    const colPairs = buildSyncColPairs(dbColumns, syncColumns);
    // ogc_fid는 key일 때만 조인에 쓰고, 속성 변경 비교·sync_log 속성에는 넣지 않는다(재import 시 번호가 달라도 속성 충돌로 보지 않음)
    const attrComparePairs = colPairs.filter(
      (p) =>
        p.db !== resolvedKeyDb
        && (!geometryDb || p.db !== geometryDb)
        && p.db.toLowerCase() !== 'ogc_fid',
    );
    const attrDbNames = attrComparePairs.map((p) => p.db);

    const attrClause =
      attrComparePairs.length > 0
        ? attrComparePairs
          .map((p) => `t."${p.sync}" IS DISTINCT FROM e."${p.db}"`)
          .join(' OR ')
        : 'FALSE';

    const geomClause = geomPair
      ? `(
  (e."${geomPair.db}" IS NULL) IS DISTINCT FROM (t."${geomPair.sync}" IS NULL)
  OR (
    e."${geomPair.db}" IS NOT NULL AND t."${geomPair.sync}" IS NOT NULL
    AND NOT ST_Equals(
      ${geomCompareSnapSql(`e."${geomPair.db}"`)},
      ${geomCompareSnapSql(`t."${geomPair.sync}"`)}
    )
  )
)`
      : 'FALSE';

    const whereClause = `(${attrClause}) OR (${geomClause})`;
    const unchangedWhere = `NOT ((${attrClause}) OR (${geomClause}))`;

    const fidDb = resolveSyncedColumn(dbColumns, 'ogc_fid');
    const fidSync = resolveSyncedColumn(syncColumns, 'ogc_fid');

    const [dupDbRes, dupSyncRes] = await Promise.all([
      db.execute(sql.raw(
        `SELECT EXISTS (
           SELECT 1 FROM ${dbSchema}."${tableName}"
           GROUP BY "${resolvedKeyDb}"::text HAVING count(*) > 1
         ) AS d`
      )),
      db.execute(sql.raw(
        `SELECT EXISTS (
           SELECT 1 FROM ${dbSchema}."${syncTableName}"
           GROUP BY "${resolvedKeySync}"::text HAVING count(*) > 1
         ) AS d`
      )),
    ]);
    const keyHasDup =
      (dupDbRes.rows as Array<{ d: boolean | string }>)[0]?.d === true
      || (dupDbRes.rows as Array<{ d: boolean | string }>)[0]?.d === 't'
      || (dupSyncRes.rows as Array<{ d: boolean | string }>)[0]?.d === true
      || (dupSyncRes.rows as Array<{ d: boolean | string }>)[0]?.d === 't';

    const matchFq = `${dbSchema}."${matchTableName}"`;
    if (keyHasDup) {
      if (!geomPair) {
        timing.flush({ success: false, error: 'duplicate_key_no_geom' });
        flushed = true;
        return {
          ...empty,
          error: `key 필드 '${resolvedKeyDb}' 값이 중복인데 geom이 없어 공간 매칭을 할 수 없습니다. 유일 key를 설정하세요.`,
        };
      }
      if (!fidDb || !fidSync) {
        timing.flush({ success: false, error: 'duplicate_key_no_ogc_fid' });
        flushed = true;
        return {
          ...empty,
          error: `key 필드 '${resolvedKeyDb}' 값이 중복입니다. 공간 매칭에는 ogc_fid가 필요합니다.`,
        };
      }
      const built = await buildSpatialKeyMatchTable({
        dbSchema,
        matchTable: matchTableName,
        tableName,
        syncTableName,
        keyDb: resolvedKeyDb,
        keySync: resolvedKeySync,
        geomDb: geomPair.db,
        geomSync: geomPair.sync,
        fidDb,
        fidSync,
      });
      if (!built.success) {
        timing.flush({ success: false, error: 'spatial_match_failed' });
        flushed = true;
        return { ...empty, error: built.error };
      }
      useSpatialMatch = true;
    }

    const joinOnKey = `t."${resolvedKeySync}" = e."${resolvedKeyDb}"`;

    // 공간 매칭: pair 테이블 기준 1:1. 유일 key: 기존 key 조인.
    const conflictFrom = useSpatialMatch
      ? `FROM ${matchFq} p
         JOIN ${dbSchema}."${syncTableName}" t ON t."${fidSync}" = p.sync_fid
         JOIN ${dbSchema}."${tableName}" e ON e."${fidDb}" = p.db_fid`
      : `FROM ${dbSchema}."${syncTableName}" t
         JOIN ${dbSchema}."${tableName}" e ON ${joinOnKey}`;
    const appendFrom = useSpatialMatch
      ? `FROM ${dbSchema}."${syncTableName}" t
         WHERE NOT EXISTS (
           SELECT 1 FROM ${matchFq} p WHERE p.sync_fid = t."${fidSync}"
         )`
      : `FROM ${dbSchema}."${syncTableName}" t
         LEFT JOIN ${dbSchema}."${tableName}" e ON ${joinOnKey}
         WHERE e."${resolvedKeyDb}" IS NULL`;
    const removeFrom = useSpatialMatch
      ? `FROM ${dbSchema}."${tableName}" e
         WHERE NOT EXISTS (
           SELECT 1 FROM ${matchFq} p WHERE p.db_fid = e."${fidDb}"
         )`
      : `FROM ${dbSchema}."${tableName}" e
         LEFT JOIN ${dbSchema}."${syncTableName}" t ON ${joinOnKey}
         WHERE t."${resolvedKeySync}" IS NULL`;

    const keyValConflictSql = useSpatialMatch
      ? `(p.key_val || '#' || p.db_fid::text)`
      : `t."${resolvedKeySync}"::text`;
    const keyValAppendSql = useSpatialMatch
      ? `(t."${resolvedKeySync}"::text || '#s' || t."${fidSync}"::text)`
      : `t."${resolvedKeySync}"::text`;
    const keyValRemoveSql = useSpatialMatch
      ? `(e."${resolvedKeyDb}"::text || '#' || e."${fidDb}"::text)`
      : `e."${resolvedKeyDb}"::text`;

    const tExtra = useSpatialMatch
      ? `jsonb_build_object('${SYNC_MATCH_SYNC_FID}', t."${fidSync}")`
      : null;
    const eExtra = useSpatialMatch
      ? `jsonb_build_object('${SYNC_MATCH_OGC_FID}', e."${fidDb}")`
      : null;

    // geom은 type+hash 메타만 저장. new 쪽은 비교에 쓴 소스 CRS(srs)도 함께 기록.
    // old 쪽만 롤백용 GeoJSON(__rollback_geom) 유지
    const tRowJson = syncLogRowJsonSqlFromPairs('t', attrComparePairs, geomPair, {
      sourceSrs,
      extraJsonbSql: tExtra,
    });
    const eRowJson = syncLogRowJsonSqlFromPairs('e', attrComparePairs, geomPair, {
      includeRollbackGeom: true,
      extraJsonbSql: eExtra,
    });

    // 유지 인정은 이번 상세 이력(dhKey) 범위만. 테이블 전역 kept는 새 업로드 비교를 막지 않음.
    let hasKept = false;
    if (scopeDhKey != null) {
      try {
        const keptRes = await db.execute(sql.raw(
          `SELECT 1 AS ok FROM sync_log WHERE sl_table_name = '${tableName}'
           AND sl_dh_key = ${scopeDhKey}
           AND sl_operation = 'kept' AND sl_rolled_back = false
           AND sl_applied_at IS NOT NULL LIMIT 1`
        ));
        hasKept = (keptRes.rows as Array<{ ok: number }>).length > 0;
      } catch {
        hasKept = false;
      }
    }
    timing.mark('prepare');

    const keptAttrMatchT = `${syncLogJsonAttrHashSql('sl.sl_new_data', attrDbNames)} = ${syncAttrHashSql('t', attrComparePairs, true)}`;
    const keptAttrMatchE = `${syncLogJsonAttrHashSql('sl.sl_old_data', attrDbNames)} = ${syncAttrHashSql('e', attrComparePairs, false)}`;
    const keptGeomMatchT = syncKeptGeomMatchSql('sl.sl_new_data', 't', geomPair);
    const keptGeomMatchE = syncKeptGeomMatchSql('sl.sl_old_data', 'e', geomPair);
    const keptDhScope = scopeDhKey != null ? `AND sl.sl_dh_key = ${scopeDhKey}` : 'AND FALSE';

    const keptKeyConflictExpr = useSpatialMatch
      ? `sl.sl_key_value = (p.key_val || '#' || p.db_fid::text)`
      : `sl.sl_key_value = t."${resolvedKeySync}"::text`;
    const keptKeyAppendExpr = useSpatialMatch
      ? `sl.sl_key_value = (t."${resolvedKeySync}"::text || '#s' || t."${fidSync}"::text)`
      : `sl.sl_key_value = t."${resolvedKeySync}"::text`;
    const keptKeyRemoveExpr = useSpatialMatch
      ? `sl.sl_key_value = (e."${resolvedKeyDb}"::text || '#' || e."${fidDb}"::text)`
      : `sl.sl_key_value = e."${resolvedKeyDb}"::text`;

    const keptMatchClause = hasKept
      ? `EXISTS (
      SELECT 1 FROM sync_log sl
      WHERE sl.sl_table_name = '${tableName}'
        AND ${keptKeyConflictExpr}
        AND sl.sl_operation = 'kept'
        AND sl.sl_rolled_back = false
        AND sl.sl_applied_at IS NOT NULL
        ${keptDhScope}
        AND ${keptAttrMatchT}
        AND ${keptGeomMatchT}
    )`
      : 'FALSE';

    const keptAppendMatchClause = hasKept
      ? `EXISTS (
      SELECT 1 FROM sync_log sl
      WHERE sl.sl_table_name = '${tableName}'
        AND ${keptKeyAppendExpr}
        AND sl.sl_operation = 'kept'
        AND sl.sl_rolled_back = false
        AND sl.sl_applied_at IS NOT NULL
        ${keptDhScope}
        AND sl.sl_old_data IS NULL
        AND ${keptAttrMatchT}
        AND ${keptGeomMatchT}
    )`
      : 'FALSE';

    const keptRemoveMatchClause = hasKept
      ? `EXISTS (
      SELECT 1 FROM sync_log sl
      WHERE sl.sl_table_name = '${tableName}'
        AND ${keptKeyRemoveExpr}
        AND sl.sl_operation = 'kept'
        AND sl.sl_rolled_back = false
        AND sl.sl_applied_at IS NOT NULL
        ${keptDhScope}
        AND sl.sl_new_data IS NULL
        AND ${keptAttrMatchE}
        AND ${keptGeomMatchE}
    )`
      : 'FALSE';

    const [appendRes, conflictRes, removeRes, unchangedRes] = await Promise.all([
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt ${appendFrom} AND NOT (${keptAppendMatchClause})`
      )),
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt ${conflictFrom}
         WHERE (${whereClause}) AND NOT (${keptMatchClause})`
      )),
      db.execute(sql.raw(
        `SELECT count(*)::int AS cnt ${removeFrom} AND NOT (${keptRemoveMatchClause})`
      )),
      db.execute(sql.raw(
        useSpatialMatch
          ? `SELECT count(*)::int AS cnt ${conflictFrom}
             WHERE (${unchangedWhere}) OR ((${whereClause}) AND (${keptMatchClause}))`
          : `SELECT count(*)::int AS cnt FROM ${dbSchema}."${syncTableName}" t
             JOIN ${dbSchema}."${tableName}" e ON ${joinOnKey}
             WHERE (${unchangedWhere}) OR ((${whereClause}) AND (${keptMatchClause}))`
      )),
    ]);
    timing.mark('counts');

    const appendCount = (appendRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    const conflictCount = (conflictRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    const removeCount = (removeRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    const unchangedCount = (unchangedRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;

    let conflicts: SyncConflictRow[] = [];
    if (conflictCount > 0) {
      const selectCols = attrComparePairs.flatMap((p) => [
        `e."${p.db}" AS "db_${p.db}"`, `t."${p.sync}" AS "shp_${p.db}"`,
      ]).join(', ');
      const geomSelect = geomPair ? `, (${geomClause}) AS _geom_mismatch` : '';
      const geomPairSelect = geomPair
        ? `, e."${geomPair.db}" AS "db_${geomPair.db}", t."${geomPair.sync}" AS "shp_${geomPair.db}"`
        : '';
      const conflictRows = await db.execute(sql.raw(
        `SELECT ${keyValConflictSql} AS key_val${selectCols ? `, ${selectCols}` : ''}${geomPairSelect}${geomSelect}
         ${conflictFrom}
         WHERE (${whereClause}) AND NOT (${keptMatchClause})
         LIMIT 500`
      ));
      conflicts = (conflictRows.rows as Array<Record<string, unknown>>).map((r) => {
        const key = String(r.key_val ?? '');
        const dbValues: Record<string, unknown> = {};
        const shpValues: Record<string, unknown> = {};
        const diffFields: string[] = [];
        for (const p of attrComparePairs) {
          const dbVal = r[`db_${p.db}`];
          const shpVal = r[`shp_${p.db}`];
          dbValues[p.db] = dbVal;
          shpValues[p.db] = shpVal;
          if (JSON.stringify(dbVal) !== JSON.stringify(shpVal)) {
            diffFields.push(p.db);
          }
        }
        if (geomPair) {
          const gm = r._geom_mismatch;
          if (gm === true || gm === 't') {
            diffFields.push(geomPair.db);
            dbValues[geomPair.db] = r[`db_${geomPair.db}`];
            shpValues[geomPair.db] = r[`shp_${geomPair.db}`];
          }
        }
        return { key, diffFields, dbValues, shpValues };
      });
    }
    timing.mark('conflictFetch');

    let removes: SyncRemoveRow[] = [];
    if (removeCount > 0) {
      const removeCols = columns.map((c) => `e."${c}"`).join(', ');
      const removeRows = await db.execute(sql.raw(
        `SELECT ${removeCols} ${removeFrom} AND NOT (${keptRemoveMatchClause})
         LIMIT 500`
      ));
      removes = (removeRows.rows as Array<Record<string, unknown>>).map((r) => ({
        key: String(r[resolvedKeyDb] ?? ''),
        values: Object.fromEntries(columns.map((c) => [c, r[c]])),
      }));
    }
    timing.mark('removeFetch');

    // --- sync_log에 미결(operation=NULL) 상태로 저장 ---
    // 기존 미결 건은 삭제하지 않고 대체됨(superseded) 표시만 남겨 이력을 보존 (중복 업로드 대응).
    // 단, 직전 미결 건과 데이터가 완전히 동일하면 재삽입하지 않고 그대로 둔다 — 매번 재검증할 때마다
    // 변경 없는 후보까지 통째로 superseded 처리 후 재삽입하면 sync_log가 무의미하게 계속 불어난다.

    // append: old=NULL, new=SHP (단, 이미 "유지"로 검토 끝난 동일 SHP 값은 재등록하지 않음)
    // 미결 중복/대체 판정은 JSONB 통째 비교 대신 content_hash(md5 of jsonb::text) 사용 — 저장 값은 그대로.
    const newHash = syncLogJsonbContentHashSql('new_data');
    const oldHash = syncLogJsonbContentHashSql('old_data');
    const slNewHash = syncLogJsonbContentHashSql('sl.sl_new_data');
    const slOldHash = syncLogJsonbContentHashSql('sl.sl_old_data');
    const sl2NewHash = syncLogJsonbContentHashSql('sl2.sl_new_data');
    const sl2OldHash = syncLogJsonbContentHashSql('sl2.sl_old_data');

    if (appendCount > 0) {
      await db.execute(sql.raw(
        `WITH candidate_rows AS (
           SELECT ${keyValAppendSql} AS key_val, (${tRowJson}) AS new_data
           ${appendFrom} AND NOT (${keptAppendMatchClause})
         ),
         candidates AS (
           SELECT key_val, new_data, ${newHash} AS content_hash
           FROM candidate_rows
         ),
         superseded AS (
           UPDATE sync_log sl
           SET sl_superseded_at = NOW()
           WHERE sl.sl_table_name = '${tableName}'
             AND sl.sl_operation IS NULL
             AND sl.sl_superseded_at IS NULL
             AND sl.sl_old_data IS NULL
             AND (
               NOT EXISTS (SELECT 1 FROM candidates c WHERE c.key_val = sl.sl_key_value)
               OR EXISTS (
                 SELECT 1 FROM candidates c
                 WHERE c.key_val = sl.sl_key_value
                   AND c.content_hash IS DISTINCT FROM ${slNewHash}
               )
             )
           RETURNING 1
         )
         INSERT INTO sync_log (sl_table_name, sl_key_field, sl_key_value, sl_old_data, sl_new_data)
         SELECT '${tableName}', '${resolvedKeyDb}', c.key_val, NULL, c.new_data
         FROM candidates c
         WHERE NOT EXISTS (
           SELECT 1 FROM sync_log sl2
           WHERE sl2.sl_table_name = '${tableName}' AND sl2.sl_operation IS NULL AND sl2.sl_superseded_at IS NULL
             AND sl2.sl_old_data IS NULL AND sl2.sl_key_value = c.key_val
             AND ${sl2NewHash} = c.content_hash
         )`
      ));
    } else {
      // 이번 회차에 append 후보가 하나도 없으면, 이전 append 미결 건들은 전부 해소된 것이므로 superseded 처리만 한다.
      await db.execute(sql.raw(
        `UPDATE sync_log SET sl_superseded_at = NOW()
         WHERE sl_table_name = '${tableName}' AND sl_operation IS NULL AND sl_superseded_at IS NULL
           AND sl_old_data IS NULL`
      ));
    }

    if (conflictCount > 0) {
      await db.execute(sql.raw(
        `WITH candidate_rows AS (
           SELECT ${keyValConflictSql} AS key_val, (${eRowJson}) AS old_data, (${tRowJson}) AS new_data
           ${conflictFrom}
           WHERE (${whereClause}) AND NOT (${keptMatchClause})
         ),
         candidates AS (
           SELECT key_val, old_data, new_data,
             ${oldHash} AS old_content_hash,
             ${newHash} AS new_content_hash
           FROM candidate_rows
         ),
         superseded AS (
           UPDATE sync_log sl
           SET sl_superseded_at = NOW()
           WHERE sl.sl_table_name = '${tableName}'
             AND sl.sl_operation IS NULL
             AND sl.sl_superseded_at IS NULL
             AND sl.sl_old_data IS NOT NULL AND sl.sl_new_data IS NOT NULL
             AND (
               NOT EXISTS (SELECT 1 FROM candidates c WHERE c.key_val = sl.sl_key_value)
               OR EXISTS (
                 SELECT 1 FROM candidates c
                 WHERE c.key_val = sl.sl_key_value
                   AND (
                     c.old_content_hash IS DISTINCT FROM ${slOldHash}
                     OR c.new_content_hash IS DISTINCT FROM ${slNewHash}
                   )
               )
             )
           RETURNING 1
         )
         INSERT INTO sync_log (sl_table_name, sl_key_field, sl_key_value, sl_old_data, sl_new_data)
         SELECT '${tableName}', '${resolvedKeyDb}', c.key_val, c.old_data, c.new_data
         FROM candidates c
         WHERE NOT EXISTS (
           SELECT 1 FROM sync_log sl2
           WHERE sl2.sl_table_name = '${tableName}' AND sl2.sl_operation IS NULL AND sl2.sl_superseded_at IS NULL
             AND sl2.sl_old_data IS NOT NULL AND sl2.sl_new_data IS NOT NULL AND sl2.sl_key_value = c.key_val
             AND ${sl2OldHash} = c.old_content_hash
             AND ${sl2NewHash} = c.new_content_hash
         )`
      ));
    } else {
      // 이번 회차에 conflict 후보가 하나도 없으면, 이전 conflict 미결 건들은 전부 해소된 것이므로 superseded 처리만 한다.
      await db.execute(sql.raw(
        `UPDATE sync_log SET sl_superseded_at = NOW()
         WHERE sl_table_name = '${tableName}' AND sl_operation IS NULL AND sl_superseded_at IS NULL
           AND sl_old_data IS NOT NULL AND sl_new_data IS NOT NULL`
      ));
    }

    if (removeCount > 0) {
      await db.execute(sql.raw(
        `WITH candidate_rows AS (
           SELECT ${keyValRemoveSql} AS key_val, (${eRowJson}) AS old_data
           ${removeFrom} AND NOT (${keptRemoveMatchClause})
         ),
         candidates AS (
           SELECT key_val, old_data, ${oldHash} AS content_hash
           FROM candidate_rows
         ),
         superseded AS (
           UPDATE sync_log sl
           SET sl_superseded_at = NOW()
           WHERE sl.sl_table_name = '${tableName}'
             AND sl.sl_operation IS NULL
             AND sl.sl_superseded_at IS NULL
             AND sl.sl_new_data IS NULL
             AND (
               NOT EXISTS (SELECT 1 FROM candidates c WHERE c.key_val = sl.sl_key_value)
               OR EXISTS (
                 SELECT 1 FROM candidates c
                 WHERE c.key_val = sl.sl_key_value
                   AND c.content_hash IS DISTINCT FROM ${slOldHash}
               )
             )
           RETURNING 1
         )
         INSERT INTO sync_log (sl_table_name, sl_key_field, sl_key_value, sl_old_data, sl_new_data)
         SELECT '${tableName}', '${resolvedKeyDb}', c.key_val, c.old_data, NULL
         FROM candidates c
         WHERE NOT EXISTS (
           SELECT 1 FROM sync_log sl2
           WHERE sl2.sl_table_name = '${tableName}' AND sl2.sl_operation IS NULL AND sl2.sl_superseded_at IS NULL
             AND sl2.sl_new_data IS NULL AND sl2.sl_key_value = c.key_val
             AND ${sl2OldHash} = c.content_hash
         )`
      ));
    } else {
      // 이번 회차에 remove 후보가 하나도 없으면, 이전 remove 미결 건들은 전부 해소된 것이므로 superseded 처리만 한다.
      await db.execute(sql.raw(
        `UPDATE sync_log SET sl_superseded_at = NOW()
         WHERE sl_table_name = '${tableName}' AND sl_operation IS NULL AND sl_superseded_at IS NULL
           AND sl_new_data IS NULL AND sl_old_data IS NOT NULL`
      ));
    }
    timing.mark('syncLogWrite');

    timing.flush({
      success: true,
      hasKept,
      useSpatialMatch,
      appendCount,
      conflictCount,
      removeCount,
      unchangedCount,
    });
    flushed = true;

    return {
      success: true,
      appendCount,
      conflictCount,
      removeCount,
      unchangedCount,
      conflicts,
      removes,
      keyField: resolvedKeyDb,
      tableName,
      columns,
    };
  } catch (e: unknown) {
    if (!flushed) {
      timing.flush({ success: false, error: formatSyncDbError(e) });
      flushed = true;
    }
    return { ...empty, error: formatSyncDbError(e) };
  } finally {
    if (syncImportAttempted) {
      const cleanupStart = Date.now();
      await dropShpSyncTempTable(dbSchema, syncTableName);
      if (useSpatialMatch) {
        await dropShpSyncTempTable(dbSchema, matchTableName);
      }
      // cleanup은 flush 이후일 수 있어 별도 한 줄로 남김
      console.log(
        '[compareShpWithTable]',
        JSON.stringify({ tableName, stage: 'cleanup', ms: Date.now() - cleanupStart }),
      );
    }
  }
}

/** GeoJSON crs(name)에서 EPSG 코드 추출. 없으면 null */
function parseSridFromGeoJsonCrs(geom: Record<string, unknown>): number | null {
  const crs = geom.crs;
  if (!crs || typeof crs !== 'object' || Array.isArray(crs)) return null;
  const props = (crs as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  const name = (props as { name?: unknown }).name;
  if (typeof name !== 'string') return null;
  const m = name.match(/EPSG::?(\d+)/i) ?? name.match(/(\d{3,5})\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function sqlVal(col: string, v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (col === 'geom') {
    let geomObj: Record<string, unknown> | null = null;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s || s === '{}') return 'NULL';
      try {
        const parsed = JSON.parse(s) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          geomObj = parsed as Record<string, unknown>;
        }
      } catch {
        return 'NULL';
      }
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      geomObj = v as Record<string, unknown>;
    }
    if (!geomObj || typeof geomObj.type !== 'string') return 'NULL';
    const srid = parseSridFromGeoJsonCrs(geomObj) ?? SHP_UPLOAD_TARGET_SRID;
    const { crs: _crs, ...geomWithoutCrs } = geomObj;
    const json = JSON.stringify(geomWithoutCrs).replace(/'/g, "''");
    return `ST_SetSRID(ST_GeomFromGeoJSON('${json}'), ${srid})`;
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** drizzle Failed query 본문 대신 PG cause/detail을 짧게 반환 (alert용) */
function formatSyncDbError(e: unknown): string {
  const chain: Array<Error & { detail?: string; hint?: string; code?: string }> = [];
  let cur: unknown = e;
  while (cur instanceof Error && chain.length < 6) {
    chain.push(cur as Error & { detail?: string; hint?: string; code?: string });
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const err = chain[i]!;
    const msg = (err.message ?? '').trim();
    if (!msg || /^Failed query:/i.test(msg)) continue;
    const bits = [msg];
    if (typeof err.detail === 'string' && err.detail.trim()) bits.push(err.detail.trim());
    if (typeof err.hint === 'string' && err.hint.trim()) bits.push(err.hint.trim());
    const out = bits.join(' — ');
    return out.length > 500 ? `${out.slice(0, 500)}…` : out;
  }
  const top = chain[0]?.message?.trim() || String(e);
  if (/^Failed query:/i.test(top)) {
    return 'DB 반영 실패. 자세한 원인은 서버 로그를 확인해주세요.';
  }
  return top.length > 500 ? `${top.slice(0, 500)}…` : top;
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
  shpPath?: string;
  sourceSrsOverride?: string;
  /** true면 레이어 테이블은 건드리지 않고 sync_log에 의도(operation)만 기록. 완료 시 commitSyncIntents로 확정 */
  intentOnly?: boolean;
}): Promise<{ success: boolean; appendedCount: number; updatedCount: number; removedCount: number; error?: string }> {
  const slKeys = params?.slKeys;
  if (!slKeys?.length) return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: 'slKeys가 필요합니다.' };
  const intentOnly = !!params.intentOnly;

  const syncTemps = new Map<string, SyncHydrateTemp>();
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const keyList = slKeys.join(', ');
    const logRes = await db.execute(sql.raw(
      `SELECT sl_key, sl_table_name, sl_key_field, sl_key_value, sl_old_data, sl_new_data
       FROM sync_log WHERE sl_key IN (${keyList}) AND sl_operation IS NULL AND sl_superseded_at IS NULL ORDER BY sl_key`
    ));
    const logs = logRes.rows as Array<{
      sl_key: number; sl_table_name: string; sl_key_field: string;
      sl_key_value: string;
      sl_old_data: Record<string, unknown> | null; sl_new_data: Record<string, unknown> | null;
    }>;

    if (logs.length === 0) return { success: true, appendedCount: 0, updatedCount: 0, removedCount: 0 };

    // 의도만 기록: geom 하이드레이트·테이블 쓰기 없이 operation만 설정 (applied_at은 NULL 유지)
    if (intentOnly) {
      let appendedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;
      const dhKeyVal = params.dhKey != null ? String(params.dhKey) : 'NULL';
      for (const log of logs) {
        const hasOld = log.sl_old_data != null && Object.keys(log.sl_old_data).length > 0;
        const hasNew = log.sl_new_data != null && Object.keys(log.sl_new_data).length > 0;
        if (!hasOld && hasNew) {
          await db.execute(sql.raw(
            `UPDATE sync_log SET sl_operation = 'append', sl_applied_at = NULL, sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
          ));
          appendedCount++;
        } else if (hasOld && hasNew) {
          await db.execute(sql.raw(
            `UPDATE sync_log SET sl_operation = 'conflict', sl_applied_at = NULL, sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
          ));
          updatedCount++;
        } else if (hasOld && !hasNew) {
          await db.execute(sql.raw(
            `UPDATE sync_log SET sl_operation = 'remove', sl_applied_at = NULL, sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
          ));
          removedCount++;
        }
      }
      return { success: true, appendedCount, updatedCount, removedCount };
    }

    // 테이블별 SHP 임시 import (new geom 메타 하이드레이트)
    for (const log of logs) {
      const nd = log.sl_new_data;
      if (!nd || !isSyncGeomMeta(nd.geom)) continue;
      const tbl = log.sl_table_name;
      if (syncTemps.has(tbl.toLowerCase())) continue;
      const shpPath = await resolveShpPathForSync({
        dhKey: params.dhKey,
        tableName: tbl,
        shpPathHint: params.shpPath,
      });
      if (!shpPath) {
        return {
          success: false, appendedCount: 0, updatedCount: 0, removedCount: 0,
          error: `SHP 경로를 찾을 수 없습니다. geom 반영에 필요합니다. (${tbl})`,
        };
      }
      const imported = await importShpToSyncTempForHydrate({
        pathOrResult: shpPath,
        tableName: tbl,
        keyField: log.sl_key_field,
        sourceSrsOverride: params.sourceSrsOverride || syncGeomMetaSrs(nd.geom),
      });
      if (!imported.success) {
        return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: imported.error };
      }
      syncTemps.set(tbl.toLowerCase(), imported.temp);
    }

    let appendedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    const dhKeyVal = params.dhKey != null ? String(params.dhKey) : 'NULL';
    const tableCache = new Map<string, { fq: string; colMap: SyncColNameMap }>();

    const resolveTable = async (tbl: string): Promise<{ fq: string; colMap: SyncColNameMap } | { error: string }> => {
      const key = tbl.toLowerCase();
      const cached = tableCache.get(key);
      if (cached) return cached;
      const resolved = await resolveSyncTableWithColumns(tbl);
      if ('error' in resolved) return resolved;
      const entry = { fq: resolved.fq, colMap: resolved.colMap };
      tableCache.set(key, entry);
      return entry;
    };

    for (const log of logs) {
      const { sl_table_name: tbl, sl_key_field: kf, sl_key_value: kv } = log;
      const tableOrErr = await resolveTable(tbl);
      if ('error' in tableOrErr) {
        return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: tableOrErr.error };
      }
      const { fq, colMap } = tableOrErr;
      const keyCol = colMap.get(kf.toLowerCase()) ?? kf;
      const syncTemp = syncTemps.get(tbl.toLowerCase()) ?? null;

      const oldPrepared = await prepareSyncDataForDbWrite({
        data: log.sl_old_data,
        side: 'old',
        keyValue: kv,
        liveFq: fq,
        liveGeomCol: colMap.get('geom') ?? 'geom',
        liveKeyCol: keyCol,
      });
      const newPrepared = await prepareSyncDataForDbWrite({
        data: log.sl_new_data,
        side: 'new',
        keyValue: kv,
        syncTemp,
      });
      if (newPrepared.error && log.sl_new_data && isSyncGeomMeta(log.sl_new_data.geom)) {
        return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: newPrepared.error };
      }
      if (oldPrepared.error && log.sl_old_data && isSyncGeomMeta(log.sl_old_data.geom)
        && log.sl_old_data.__rollback_geom == null) {
        return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: oldPrepared.error };
      }
      const oldData = oldPrepared.data;
      const newData = newPrepared.data;

      if (!oldData && newData) {
        const cols = filterColsToTable(Object.keys(newData), colMap);
        if (cols.length === 0) {
          return {
            success: false,
            appendedCount: 0,
            updatedCount: 0,
            removedCount: 0,
            error: `반영할 컬럼이 없습니다. (${tbl})`,
          };
        }
        const colNames = cols.map((c) => `"${c}"`).join(', ');
        const vals = cols.map((c) => sqlVal(c, pickSyncDataVal(newData, c))).join(', ');
        await db.execute(sql.raw(`INSERT INTO ${fq} (${colNames}) VALUES (${vals})`));
        await db.execute(sql.raw(
          `UPDATE sync_log SET sl_operation = 'append', sl_applied_at = NOW(), sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
        ));
        appendedCount++;
      } else if (oldData && newData) {
        const cols = filterColsToTable(Object.keys(newData), colMap, [kf]);
        if (cols.length > 0) {
          const setClauses = cols.map((c) => `"${c}" = ${sqlVal(c, pickSyncDataVal(newData, c))}`).join(', ');
          const whereSql = syncRowTargetWhereSql({
            keyCol, keyValue: kv, oldData: log.sl_old_data, newData: log.sl_new_data,
            ogcFidCol: colMap.get('ogc_fid') ?? 'ogc_fid',
          });
          await db.execute(sql.raw(
            `UPDATE ${fq} SET ${setClauses} WHERE ${whereSql}`
          ));
        }
        await db.execute(sql.raw(
          `UPDATE sync_log SET sl_operation = 'conflict', sl_applied_at = NOW(), sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
        ));
        updatedCount++;
      } else if (oldData && !newData) {
        const whereSql = syncRowTargetWhereSql({
          keyCol, keyValue: kv, oldData: log.sl_old_data, newData: log.sl_new_data,
          ogcFidCol: colMap.get('ogc_fid') ?? 'ogc_fid',
        });
        await db.execute(sql.raw(
          `DELETE FROM ${fq} WHERE ${whereSql}`
        ));
        await db.execute(sql.raw(
          `UPDATE sync_log SET sl_operation = 'remove', sl_applied_at = NOW(), sl_dh_key = ${dhKeyVal} WHERE sl_key = ${log.sl_key}`
        ));
        removedCount++;
      }
    }

    return { success: true, appendedCount, updatedCount, removedCount };
  } catch (e: unknown) {
    return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, error: formatSyncDbError(e) };
  } finally {
    for (const temp of syncTemps.values()) {
      await dropShpSyncTempTable(temp.dbSchema, temp.syncTableName);
    }
  }
}

/**
 * sync_log의 미결(operation=NULL) 항목을 '유지(kept)'로 설정한다.
 * DB 레이어 테이블은 변경하지 않는다.
 * intentOnly=true 이면 applied_at을 비워 두고, 완료 시 commitSyncIntents로 확정한다.
 */
export async function keepSyncEntries(params: {
  slKeys: number[];
  dhKey?: number;
  intentOnly?: boolean;
}): Promise<{ success: boolean; keptCount: number; error?: string }> {
  const slKeys = params?.slKeys;
  if (!slKeys?.length) return { success: false, keptCount: 0, error: 'slKeys가 필요합니다.' };

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const keyList = slKeys.join(', ');
    const dhKeyVal = params.dhKey != null ? String(params.dhKey) : 'NULL';
    const appliedSql = params.intentOnly ? 'NULL' : 'NOW()';
    const res = await db.execute(sql.raw(
      `UPDATE sync_log SET sl_operation = 'kept', sl_applied_at = ${appliedSql}, sl_dh_key = ${dhKeyVal}
       WHERE sl_key IN (${keyList}) AND sl_operation IS NULL AND sl_superseded_at IS NULL
       RETURNING sl_key`
    ));
    const keptCount = (res.rows as Array<{ sl_key: number }>).length;
    return { success: true, keptCount };
  } catch (e: unknown) {
    return { success: false, keptCount: 0, error: formatSyncDbError(e) };
  }
}

/** 미반영 의도(operation 있음·applied_at NULL)를 취소해 다시 미결로 되돌린다. */
export async function clearSyncIntents(params: {
  slKeys: number[];
}): Promise<{ success: boolean; clearedCount: number; error?: string }> {
  const slKeys = params?.slKeys;
  if (!slKeys?.length) return { success: false, clearedCount: 0, error: 'slKeys가 필요합니다.' };
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const keyList = slKeys.join(', ');
    const res = await db.execute(sql.raw(
      `UPDATE sync_log
       SET sl_operation = NULL, sl_applied_at = NULL, sl_dh_key = NULL
       WHERE sl_key IN (${keyList})
         AND sl_operation IS NOT NULL
         AND sl_applied_at IS NULL
         AND sl_superseded_at IS NULL`
    ));
    return { success: true, clearedCount: (res as { rowCount?: number }).rowCount ?? 0 };
  } catch (e: unknown) {
    return { success: false, clearedCount: 0, error: formatSyncDbError(e) };
  }
}

/**
 * 위저드 4단계 완료: 테이블의 미반영 의도(applied_at IS NULL)를 실제 DB에 확정한다.
 * - kept: applied_at·dh_key만 확정
 * - append/conflict/remove: 의도를 미결로 되돌린 뒤 applySyncEntries로 실제 반영
 */
export async function commitSyncIntents(params: {
  tableName: string;
  dhKey: number;
  shpPath?: string;
  sourceSrsOverride?: string;
}): Promise<{
  success: boolean;
  appendedCount: number;
  updatedCount: number;
  removedCount: number;
  keptCount: number;
  error?: string;
}> {
  const tableName = String(params?.tableName ?? '').trim();
  const dhKey = Math.floor(Number(params?.dhKey));
  if (!tableName || !Number.isFinite(dhKey) || dhKey <= 0) {
    return { success: false, appendedCount: 0, updatedCount: 0, removedCount: 0, keptCount: 0, error: 'tableName과 dhKey가 필요합니다.' };
  }
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const safeTbl = tableName.replace(/'/g, "''");

    // 이번 세션(미배정) 또는 이미 이 dhKey에 묶인 미반영 kept만 확정 — 타 이력/이전 회차 kept를 끌어오지 않음
    const keptRes = await db.execute(sql.raw(
      `UPDATE sync_log
       SET sl_applied_at = NOW(), sl_dh_key = ${dhKey}
       WHERE LOWER(sl_table_name) = LOWER('${safeTbl}')
         AND sl_operation = 'kept'
         AND sl_applied_at IS NULL
         AND sl_superseded_at IS NULL
         AND (sl_dh_key IS NULL OR sl_dh_key = ${dhKey})
       RETURNING sl_key`
    ));
    const keptCount = (keptRes.rows as Array<{ sl_key: number }>).length;

    const applyIntentRes = await db.execute(sql.raw(
      `SELECT sl_key FROM sync_log
       WHERE LOWER(sl_table_name) = LOWER('${safeTbl}')
         AND sl_operation IN ('append', 'conflict', 'remove')
         AND sl_applied_at IS NULL
         AND sl_superseded_at IS NULL
         AND (sl_dh_key IS NULL OR sl_dh_key = ${dhKey})
       ORDER BY sl_key`
    ));
    const applyKeys = (applyIntentRes.rows as Array<{ sl_key: number }>).map((r) => r.sl_key);
    let appendedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    if (applyKeys.length > 0) {
      const keyList = applyKeys.join(', ');
      await db.execute(sql.raw(
        `UPDATE sync_log SET sl_operation = NULL, sl_dh_key = NULL
         WHERE sl_key IN (${keyList}) AND sl_applied_at IS NULL`
      ));
      const applied = await applySyncEntries({
        slKeys: applyKeys,
        dhKey,
        shpPath: params.shpPath,
        sourceSrsOverride: params.sourceSrsOverride,
      });
      if (!applied.success) {
        return {
          success: false,
          appendedCount: 0,
          updatedCount: 0,
          removedCount: 0,
          keptCount,
          error: applied.error ?? '의도 반영에 실패했습니다.',
        };
      }
      appendedCount = applied.appendedCount;
      updatedCount = applied.updatedCount;
      removedCount = applied.removedCount;
    }

    return { success: true, appendedCount, updatedCount, removedCount, keptCount };
  } catch (e: unknown) {
    return {
      success: false,
      appendedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      keptCount: 0,
      error: formatSyncDbError(e),
    };
  }
}

/** 위저드 취소: 테이블별 미반영(applied_at NULL) sync_log만 삭제. 실제 반영분·SHP 파일은 유지 */
export async function clearUnappliedSyncLogs(params: {
  tableNames: string[];
}): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  const tableNames = [...new Set((params?.tableNames ?? []).map((n) => String(n ?? '').trim()).filter(Boolean))];
  if (tableNames.length === 0) return { success: true, deletedCount: 0 };
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const list = tableNames.map((n) => `'${n.replace(/'/g, "''").toLowerCase()}'`).join(', ');
    const res = await db.execute(sql.raw(
      `DELETE FROM sync_log
       WHERE LOWER(sl_table_name) IN (${list})
         AND sl_applied_at IS NULL`
    ));
    return { success: true, deletedCount: (res as { rowCount?: number }).rowCount ?? 0 };
  } catch (e: unknown) {
    return { success: false, deletedCount: 0, error: formatSyncDbError(e) };
  }
}

type SyncLogTab = 'all' | 'pending' | 'update' | 'kept' | 'append' | 'remove';

/** 변경 필드 필터 (목록·건수 공통). 선택된 필드가 목록 열에 나타날 수 있는 행만. */
function buildSyncLogFilterClauses(fieldFilters?: string[]): string {
  const fields = [...new Set((fieldFilters ?? []).map((f) => f.trim()).filter(Boolean))];
  if (fields.length === 0) return '';

  const parts: string[] = [];
  const attrFields = fields.filter((f) => f !== 'geom');
  if (attrFields.length > 0) {
    const attrList = attrFields.map((f) => `'${f.replace(/'/g, "''")}'`).join(', ');
    parts.push(`EXISTS (
      SELECT 1 FROM unnest(ARRAY[${attrList}]::text[]) AS f(key)
      WHERE
        (
          sl_old_data IS NOT NULL AND sl_new_data IS NOT NULL
          AND (sl_old_data -> f.key) IS DISTINCT FROM (sl_new_data -> f.key)
        )
        OR (
          sl_old_data IS NULL AND sl_new_data IS NOT NULL AND (sl_new_data ? f.key)
        )
    )`);
  }
  if (fields.includes('geom')) {
    parts.push(`(
      (sl_old_data -> 'geom') IS DISTINCT FROM (sl_new_data -> 'geom')
    )`);
  }
  return ` AND (${parts.join(' OR ')})`;
}

/** 구분 필터 (목록 열 기준). 탭 조건과 AND. */
type SyncLogOpFilter = 'new' | 'conflict' | 'delete' | 'kept';

function buildSyncLogOpFilterClauses(opFilters?: string[]): string {
  const ops = [...new Set((opFilters ?? []).map((o) => String(o).trim()).filter(Boolean))] as SyncLogOpFilter[];
  const allowed = new Set<SyncLogOpFilter>(['new', 'conflict', 'delete', 'kept']);
  const selected = ops.filter((o): o is SyncLogOpFilter => allowed.has(o as SyncLogOpFilter));
  if (selected.length === 0) return '';

  const parts: string[] = [];
  if (selected.includes('new')) {
    parts.push(`(sl_operation = 'append' OR (sl_operation IS NULL AND sl_old_data IS NULL AND sl_new_data IS NOT NULL))`);
  }
  if (selected.includes('conflict')) {
    parts.push(`(sl_operation = 'conflict' OR (sl_operation IS NULL AND sl_old_data IS NOT NULL AND sl_new_data IS NOT NULL))`);
  }
  if (selected.includes('delete')) {
    parts.push(`(sl_operation = 'remove' OR (sl_operation IS NULL AND sl_old_data IS NOT NULL AND sl_new_data IS NULL))`);
  }
  if (selected.includes('kept')) {
    parts.push(`(sl_operation = 'kept')`);
  }
  return ` AND (${parts.join(' OR ')})`;
}

function buildSyncLogWhere(params: {
  dhKey?: number;
  tableName?: string;
  pendingOnly?: boolean;
  /**
   * true면 이번 위저드 세션(sl_dh_key IS NULL)만.
   * dhKey 없이 tableName만으로 집계할 때 이전 이력 kept가 합산되지 않게 한다.
   */
  currentSessionOnly?: boolean;
  /** true면 sl_dh_key = dhKey만 (이력 조회). OR NULL로 타 세션 미배정 건을 섞지 않음 */
  strictDhKey?: boolean;
  tab?: SyncLogTab;
  fieldFilters?: string[];
  opFilters?: string[];
}): { where: string; error?: string } {
  const { dhKey, tableName, pendingOnly, currentSessionOnly, strictDhKey, tab, fieldFilters, opFilters } = params;
  if (!dhKey && !tableName) return { where: '', error: 'dhKey 또는 tableName이 필요합니다.' };
  const safeTbl = tableName ? tableName.trim().toLowerCase().replace(/'/g, "''") : '';
  const tableEq = safeTbl ? `LOWER(sl_table_name) = '${safeTbl}'` : '';
  let where: string;
  if (dhKey && strictDhKey) {
    // 이력 조회: dhKey만으로 조회 (테이블명 대소문자·정규화 불일치로 빈 목록 나는 것 방지)
    where = `sl_dh_key = ${dhKey}`;
  } else if (dhKey && tableName) {
    where = `(sl_dh_key = ${dhKey} OR sl_dh_key IS NULL) AND ${tableEq}`;
  } else if (dhKey) {
    where = `sl_dh_key = ${dhKey}`;
  } else {
    where = tableEq;
    if (currentSessionOnly) where += ` AND sl_dh_key IS NULL`;
  }
  if (pendingOnly) where += ` AND sl_operation IS NULL`;
  where += ` AND sl_superseded_at IS NULL`;

  if (tab && tab !== 'all') {
    if (tab === 'pending') where += ` AND sl_operation IS NULL`;
    else if (tab === 'update') where += ` AND sl_operation = 'conflict'`;
    else if (tab === 'kept') where += ` AND sl_operation = 'kept'`;
    else if (tab === 'append') where += ` AND sl_operation = 'append'`;
    else if (tab === 'remove') where += ` AND sl_operation = 'remove'`;
  }
  where += buildSyncLogFilterClauses(fieldFilters);
  where += buildSyncLogOpFilterClauses(opFilters);
  return { where };
}

/** light 응답: geom 좌표 제거 + 변경 여부/타입만 주입해 목록에서 «좌표 변경» 표시 가능 */
function enrichLightSyncLogRow(row: Record<string, unknown>): Record<string, unknown> {
  const geomChanged = row.geom_changed === true || row.geom_changed === 't';
  const oldType = typeof row.old_geom_type === 'string' ? row.old_geom_type : null;
  const newType = typeof row.new_geom_type === 'string' ? row.new_geom_type : null;
  const oldData = (row.sl_old_data as Record<string, unknown> | null) ?? null;
  const newData = (row.sl_new_data as Record<string, unknown> | null) ?? null;

  if (geomChanged) {
    // old가 원래 없으면 null 유지 (빈 {}를 넣으면 목록 구분이 신규→충돌로 오인됨)
    const nextOld = oldData ? { ...oldData } : null;
    const nextNew = newData ? { ...newData } : null;
    if (nextOld) {
      nextOld.geom = oldType && newType && oldType !== newType
        ? { type: oldType }
        : (oldType ? { type: oldType, _changed: 0 } : '좌표 변경');
    }
    if (nextNew) {
      nextNew.geom = oldType && newType && oldType !== newType
        ? { type: newType }
        : (newType ? { type: newType, _changed: 1 } : '좌표 변경');
    }
    row.sl_old_data = nextOld;
    row.sl_new_data = nextNew;
  }

  delete row.geom_changed;
  delete row.old_geom_type;
  delete row.new_geom_type;
  return row;
}

/** sync_log 조회 (page/limit 있으면 페이징, light면 geom 제외) */
function normalizeSyncLogFieldFilters(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    return raw.map((f) => String(f).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return undefined;
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((f) => String(f).trim()).filter(Boolean);
        }
      } catch { /* fall through */ }
    }
    return [s];
  }
  return undefined;
}

export async function getSyncLogs(params: {
  dhKey?: number;
  tableName?: string;
  pendingOnly?: boolean;
  /** dhKey 없을 때 이번 세션(sl_dh_key IS NULL)만 집계 */
  currentSessionOnly?: boolean;
  /** 이력 조회 등 — dhKey 일치 행만 */
  strictDhKey?: boolean;
  tab?: SyncLogTab;
  page?: number;
  limit?: number;
  light?: boolean;
  includeCounts?: boolean;
  /** false면 탭 total COUNT 생략(페이지 이동 시 캐시된 total 사용) */
  includeTotal?: boolean;
  /** true면 목록 SELECT 생략, total COUNT만 (푸터 후속 갱신) */
  countOnly?: boolean;
  fieldFilters?: string[];
  /** 구분 필터: new | conflict | delete | kept */
  opFilters?: string[];
}): Promise<{
  success: boolean;
  rows: Array<Record<string, unknown>>;
  total?: number;
  page?: number;
  limit?: number;
  counts?: {
    all: number;
    pending: number;
    updated: number;
    kept: number;
    append: number;
    remove: number;
    rolledBack: number;
  };
  error?: string;
}> {
  const {
    dhKey,
    tableName,
    pendingOnly,
    currentSessionOnly = false,
    strictDhKey = false,
    tab,
    page,
    limit,
    light = false,
    includeCounts = false,
    includeTotal = true,
    countOnly = false,
  } = params ?? {};
  const fieldFilters = normalizeSyncLogFieldFilters(params?.fieldFilters);
  const opFilters = Array.isArray(params?.opFilters)
    ? params.opFilters.map((o) => String(o).trim()).filter(Boolean)
    : undefined;

  const built = buildSyncLogWhere({
    dhKey,
    tableName,
    pendingOnly,
    currentSessionOnly,
    strictDhKey,
    tab,
    fieldFilters,
    opFilters,
  });
  if (built.error) return { success: false, rows: [], error: built.error };
  const { where } = built;

  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const usePaging = page != null && limit != null && limit > 0;
    const pageNum = usePaging ? Math.max(1, Math.floor(page!)) : 1;
    const pageSize = usePaging ? Math.min(500, Math.max(1, Math.floor(limit!))) : 0;
    const offset = usePaging ? (pageNum - 1) * pageSize : 0;

    /** 푸터용 건수만 필요할 때 — 목록 재조회 없이 COUNT만 */
    if (countOnly) {
      const totalRes = await db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM sync_log WHERE ${where}`
      ));
      const total = (totalRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
      return {
        success: true,
        rows: [],
        total,
        ...(usePaging ? { page: pageNum, limit: pageSize || 50 } : {}),
      };
    }

    const keyValueOrder = `CASE WHEN sl_key_value ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN 0 ELSE 1 END, CASE WHEN sl_key_value ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN sl_key_value::numeric END, sl_key_value, sl_key`;
    const orderBy = tab === 'update'
      ? `CASE WHEN sl_rolled_back THEN 0 ELSE 1 END, ${keyValueOrder}`
      : `CASE WHEN sl_operation IS NULL THEN 0 WHEN sl_operation = 'kept' THEN 2 ELSE 1 END, ${keyValueOrder}`;

    const selectCols = light
      ? `sl_key, sl_dh_key, sl_table_name, sl_key_field, sl_key_value, sl_operation,
         CASE WHEN sl_old_data IS NULL THEN NULL ELSE (sl_old_data - 'geom') END AS sl_old_data,
         CASE WHEN sl_new_data IS NULL THEN NULL ELSE (sl_new_data - 'geom') END AS sl_new_data,
         (${syncLogGeomMetaComparableSql(`sl_old_data -> 'geom'`)} IS DISTINCT FROM ${syncLogGeomMetaComparableSql(`sl_new_data -> 'geom'`)}) AS geom_changed,
         sl_old_data -> 'geom' ->> 'type' AS old_geom_type,
         sl_new_data -> 'geom' ->> 'type' AS new_geom_type,
         sl_applied_at, sl_rolled_back, sl_rolled_back_at, sl_created_at, sl_superseded_at`
      : `sl_key, sl_dh_key, sl_table_name, sl_key_field, sl_key_value, sl_operation,
         sl_old_data, sl_new_data, sl_applied_at, sl_rolled_back, sl_rolled_back_at, sl_created_at, sl_superseded_at`;

    const limitSql = usePaging ? ` LIMIT ${pageSize} OFFSET ${offset}` : '';
    // 목록을 COUNT보다 먼저 — 필터 시 1페이지 데이터를 건수 집계보다 먼저 확보
    const res = await db.execute(sql.raw(
      `SELECT ${selectCols}
       FROM sync_log WHERE ${where} ORDER BY ${orderBy}${limitSql}`
    ));

    let rows = res.rows as Array<Record<string, unknown>>;
    if (light) rows = rows.map((r) => enrichLightSyncLogRow({ ...r }));

    const colCache = new Map<string, SyncColNameMap | null>();
    const colMapFor = async (tableNameRaw: unknown): Promise<SyncColNameMap | null> => {
      const name = String(tableNameRaw ?? '').trim();
      if (!name) return null;
      const key = name.toLowerCase();
      if (colCache.has(key)) return colCache.get(key) ?? null;
      const resolved = await resolveSyncTableWithColumns(name);
      if ('error' in resolved) {
        colCache.set(key, null);
        return null;
      }
      colCache.set(key, resolved.colMap);
      return resolved.colMap;
    };
    for (const row of rows) {
      const colMap = await colMapFor(row.sl_table_name);
      if (!colMap) continue;
      row.sl_old_data = filterJsonDataToTableColumns(row.sl_old_data, colMap);
      row.sl_new_data = filterJsonDataToTableColumns(row.sl_new_data, colMap);
    }

    let counts: {
      all: number;
      pending: number;
      updated: number;
      kept: number;
      append: number;
      remove: number;
      rolledBack: number;
    } | undefined;

    if (includeCounts) {
      const base = buildSyncLogWhere({
        dhKey,
        tableName,
        pendingOnly,
        currentSessionOnly,
        strictDhKey,
        fieldFilters,
      });
      if (base.error) return { success: false, rows: [], error: base.error };
      const countRes = await db.execute(sql.raw(
        `SELECT
           count(*)::int AS all_cnt,
           count(*) FILTER (WHERE sl_operation IS NULL)::int AS pending,
           count(*) FILTER (WHERE sl_operation = 'conflict')::int AS updated,
           count(*) FILTER (WHERE sl_operation = 'kept')::int AS kept,
           count(*) FILTER (WHERE sl_operation = 'append')::int AS append,
           count(*) FILTER (WHERE sl_operation = 'remove')::int AS remove,
           count(*) FILTER (WHERE sl_rolled_back = true)::int AS rolled_back
         FROM sync_log WHERE ${base.where}`
      ));
      const c = (countRes.rows as Array<Record<string, number>>)[0] ?? {};
      counts = {
        all: c.all_cnt ?? 0,
        pending: c.pending ?? 0,
        updated: c.updated ?? 0,
        kept: c.kept ?? 0,
        append: c.append ?? 0,
        remove: c.remove ?? 0,
        rolledBack: c.rolled_back ?? 0,
      };
    }

    let total: number | undefined;
    if (usePaging && includeTotal) {
      const totalRes = await db.execute(sql.raw(
        `SELECT count(*)::int AS cnt FROM sync_log WHERE ${where}`
      ));
      total = (totalRes.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    }

    return {
      success: true,
      rows,
      ...(usePaging ? { total, page: pageNum, limit: pageSize } : {}),
      ...(counts ? { counts } : {}),
    };
  } catch (e: unknown) {
    return { success: false, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** sync_log 단건 (상세·미니맵용 full geom 포함) */
export async function getSyncLogDetail(params: {
  slKey: number;
  shpPath?: string;
  /** 미결 행은 sl_dh_key가 NULL일 수 있어 모달 쪽 이력 키로 경로 해석 */
  dhKey?: number;
  /** 비교 시 사용한 소스 좌표계 (위저드에서 선택). .prj 없을 때 필요 */
  sourceSrsOverride?: string;
}): Promise<{ success: boolean; row?: Record<string, unknown>; error?: string }> {
  const slKey = params?.slKey;
  if (!slKey) return { success: false, error: 'slKey가 필요합니다.' };
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql.raw(
      `SELECT sl_key, sl_dh_key, sl_table_name, sl_key_field, sl_key_value, sl_operation,
              sl_old_data, sl_new_data, sl_applied_at, sl_rolled_back, sl_rolled_back_at, sl_created_at, sl_superseded_at
       FROM sync_log WHERE sl_key = ${slKey} LIMIT 1`
    ));
    const row = (res.rows as Array<Record<string, unknown>>)[0];
    if (!row) return { success: false, error: '항목을 찾을 수 없습니다.' };
    const tableName = String(row.sl_table_name ?? '').trim();
    if (tableName) {
      const resolved = await resolveSyncTableWithColumns(tableName);
      if (!('error' in resolved)) {
        // __rollback_geom / 공간매칭 메타는 colMap에 없으므로 하이드레이트 전에 보존
        const rawOld = row.sl_old_data;
        const rawNew = row.sl_new_data;
        const pickMeta = (raw: unknown, key: string) =>
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)[key]
            : undefined;
        const oldRollback = pickMeta(rawOld, '__rollback_geom');
        const newRollback = pickMeta(rawNew, '__rollback_geom');
        const oldMatchFid = pickMeta(rawOld, SYNC_MATCH_OGC_FID);
        const newMatchFid = pickMeta(rawNew, SYNC_MATCH_OGC_FID);
        const oldMatchSyncFid = pickMeta(rawOld, SYNC_MATCH_SYNC_FID);
        const newMatchSyncFid = pickMeta(rawNew, SYNC_MATCH_SYNC_FID);
        row.sl_old_data = filterJsonDataToTableColumns(row.sl_old_data, resolved.colMap);
        row.sl_new_data = filterJsonDataToTableColumns(row.sl_new_data, resolved.colMap);
        const restore = (target: unknown, key: string, val: unknown) => {
          if (target && typeof target === 'object' && !Array.isArray(target) && val !== undefined) {
            (target as Record<string, unknown>)[key] = val;
          }
        };
        restore(row.sl_old_data, '__rollback_geom', oldRollback);
        restore(row.sl_new_data, '__rollback_geom', newRollback);
        restore(row.sl_old_data, SYNC_MATCH_OGC_FID, oldMatchFid);
        restore(row.sl_new_data, SYNC_MATCH_OGC_FID, newMatchFid);
        restore(row.sl_old_data, SYNC_MATCH_SYNC_FID, oldMatchSyncFid);
        restore(row.sl_new_data, SYNC_MATCH_SYNC_FID, newMatchSyncFid);
      }
    }
    const hydrated = await hydrateSyncLogRowForDetail({
      row,
      shpPathHint: params.shpPath,
      dhKey: params.dhKey,
      sourceSrsOverride: params.sourceSrsOverride,
    });
    if (hydrated.error) {
      // 속성 상세는 보여 주되, 지도만 실패할 수 있음 — 경고는 error로 반환하지 않고 row만
      console.warn('[getSyncLogDetail] geom hydrate:', hydrated.error);
    }
    return { success: true, row: hydrated.row };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 동기화 범위 내 목록(변경 필드 열)에 실제로 나타나는 필드명 */
export async function getSyncLogFieldNames(params: {
  dhKey?: number;
  tableName?: string;
}): Promise<{ success: boolean; fields: string[]; error?: string }> {
  const built = buildSyncLogWhere({ dhKey: params?.dhKey, tableName: params?.tableName });
  if (built.error) return { success: false, fields: [], error: built.error };
  const whereS = built.where.replace(/\bsl_/g, 's.sl_');
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    // buildFlatRows와 동일: 충돌·유지는 값이 다른 키만, 신규는 new 속성 전부, geom은 좌표/타입 변경 시
    const res = await db.execute(sql.raw(
      `SELECT key FROM (
         SELECT DISTINCT key FROM (
           -- 변경·유지(old+new): 값이 다른 속성만
           SELECT k.key
           FROM sync_log s
           CROSS JOIN LATERAL jsonb_object_keys(
             (COALESCE(s.sl_old_data, '{}'::jsonb) - 'geom' - 'ogc_fid' - '__rollback_geom' - '${SYNC_MATCH_OGC_FID}' - '${SYNC_MATCH_SYNC_FID}')
             || (COALESCE(s.sl_new_data, '{}'::jsonb) - 'geom' - 'ogc_fid' - '__rollback_geom' - '${SYNC_MATCH_OGC_FID}' - '${SYNC_MATCH_SYNC_FID}')
           ) AS k(key)
           WHERE ${whereS}
             AND s.sl_old_data IS NOT NULL
             AND s.sl_new_data IS NOT NULL
             AND (s.sl_old_data -> k.key) IS DISTINCT FROM (s.sl_new_data -> k.key)
           UNION ALL
           -- 신규(append/pending new): new 속성 전부
           SELECT jsonb_object_keys(
             COALESCE(s.sl_new_data, '{}'::jsonb) - 'geom' - 'ogc_fid' - '__rollback_geom' - '${SYNC_MATCH_OGC_FID}' - '${SYNC_MATCH_SYNC_FID}'
           ) AS key
           FROM sync_log s
           WHERE ${whereS}
             AND s.sl_old_data IS NULL
             AND s.sl_new_data IS NOT NULL
         ) keys
         WHERE key IS NOT NULL AND key <> ''
         UNION
         SELECT 'geom' AS key
         WHERE EXISTS (
           SELECT 1 FROM sync_log
           WHERE ${built.where}
             AND (${syncLogGeomMetaComparableSql(`sl_old_data -> 'geom'`)} IS DISTINCT FROM ${syncLogGeomMetaComparableSql(`sl_new_data -> 'geom'`)})
         )
       ) t
       ORDER BY key`
    ));
    const fields = (res.rows as Array<{ key: string }>).map((r) => r.key).filter(Boolean);
    const tableName = String(params?.tableName ?? '').trim();
    if (!tableName) return { success: true, fields };
    const resolved = await resolveSyncTableWithColumns(tableName);
    if ('error' in resolved) return { success: true, fields };
    const filtered = fields.filter((f) => resolved.colMap.has(f.toLowerCase()));
    return { success: true, fields: filtered };
  } catch (e: unknown) {
    return { success: false, fields: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** 미결 sync_log 키만 조회 (전체 반영/유지용, JSONB 제외). 구분·변경 필드 필터 있으면 해당 범위만. */
export async function getSyncLogPendingKeys(params: {
  dhKey?: number;
  tableName?: string;
  fieldFilters?: string[];
  opFilters?: string[];
}): Promise<{ success: boolean; keys: number[]; error?: string }> {
  const fieldFilters = normalizeSyncLogFieldFilters(params?.fieldFilters);
  const opFilters = Array.isArray(params?.opFilters)
    ? params.opFilters.map((o) => String(o).trim()).filter(Boolean)
    : undefined;
  const built = buildSyncLogWhere({
    dhKey: params?.dhKey,
    tableName: params?.tableName,
    pendingOnly: true,
    fieldFilters,
    opFilters,
  });
  if (built.error) return { success: false, keys: [], error: built.error };
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql.raw(
      `SELECT sl_key FROM sync_log WHERE ${built.where} ORDER BY sl_key`
    ));
    const keys = (res.rows as Array<{ sl_key: number }>).map((r) => r.sl_key);
    return { success: true, keys };
  } catch (e: unknown) {
    return { success: false, keys: [], error: e instanceof Error ? e.message : String(e) };
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
       FROM sync_log WHERE sl_key IN (${keyList})
         AND sl_rolled_back = false
         AND sl_operation IS NOT NULL
         AND sl_applied_at IS NOT NULL
       ORDER BY sl_key DESC`
    ));
    const logs = logRes.rows as Array<{
      sl_key: number; sl_table_name: string; sl_key_field: string;
      sl_key_value: string; sl_operation: string;
      sl_old_data: Record<string, unknown> | null; sl_new_data: Record<string, unknown> | null;
    }>;

    if (logs.length === 0) return { success: true, rolledBackCount: 0 };

    let rolledBackCount = 0;
    const tableCache = new Map<string, { fq: string; colMap: SyncColNameMap }>();
    const resolveTable = async (tbl: string): Promise<{ fq: string; colMap: SyncColNameMap } | { error: string }> => {
      const key = tbl.toLowerCase();
      const cached = tableCache.get(key);
      if (cached) return cached;
      const resolved = await resolveSyncTableWithColumns(tbl);
      if ('error' in resolved) return resolved;
      const entry = { fq: resolved.fq, colMap: resolved.colMap };
      tableCache.set(key, entry);
      return entry;
    };

    for (const log of logs) {
      const { sl_table_name: tbl, sl_key_field: kf, sl_key_value: kv, sl_operation: op } = log;
      if (op === 'kept') continue;
      const tableOrErr = await resolveTable(tbl);
      if ('error' in tableOrErr) {
        return { success: false, rolledBackCount: 0, error: tableOrErr.error };
      }
      const { fq, colMap } = tableOrErr;
      const keyCol = colMap.get(kf.toLowerCase()) ?? kf;

      const oldPrepared = await prepareSyncDataForDbWrite({
        data: log.sl_old_data,
        side: 'old',
        keyValue: kv,
        liveFq: fq,
        liveGeomCol: colMap.get('geom') ?? 'geom',
        liveKeyCol: keyCol,
      });
      if (oldPrepared.error && log.sl_old_data && isSyncGeomMeta(log.sl_old_data.geom)
        && log.sl_old_data.__rollback_geom == null) {
        return { success: false, rolledBackCount: 0, error: oldPrepared.error };
      }
      const oldData = oldPrepared.data;

      if (op === 'append') {
        const whereSql = syncRowTargetWhereSql({
          keyCol, keyValue: kv, oldData: log.sl_old_data, newData: log.sl_new_data,
          ogcFidCol: colMap.get('ogc_fid') ?? 'ogc_fid',
        });
        await db.execute(sql.raw(
          `DELETE FROM ${fq} WHERE ${whereSql}`
        ));
      } else if (op === 'conflict' && oldData) {
        const cols = filterColsToTable(Object.keys(oldData), colMap, [kf]);
        if (cols.length > 0) {
          const setClauses = cols.map((c) => `"${c}" = ${sqlVal(c, pickSyncDataVal(oldData, c))}`).join(', ');
          const whereSql = syncRowTargetWhereSql({
            keyCol, keyValue: kv, oldData: log.sl_old_data, newData: log.sl_new_data,
            ogcFidCol: colMap.get('ogc_fid') ?? 'ogc_fid',
          });
          await db.execute(sql.raw(
            `UPDATE ${fq} SET ${setClauses} WHERE ${whereSql}`
          ));
        }
      } else if (op === 'remove' && oldData) {
        const cols = filterColsToTable(Object.keys(oldData), colMap);
        if (cols.length === 0) {
          return { success: false, rolledBackCount: 0, error: `롤백(재삽입)할 컬럼이 없습니다. (${tbl})` };
        }
        const colNames = cols.map((c) => `"${c}"`).join(', ');
        const vals = cols.map((c) => sqlVal(c, pickSyncDataVal(oldData, c))).join(', ');
        await db.execute(sql.raw(
          `INSERT INTO ${fq} (${colNames}) VALUES (${vals})`
        ));
      }

      await db.execute(sql.raw(
        `UPDATE sync_log SET sl_rolled_back = true, sl_rolled_back_at = NOW() WHERE sl_key = ${log.sl_key}`
      ));
      rolledBackCount++;
    }

    return { success: true, rolledBackCount };
  } catch (e: unknown) {
    return { success: false, rolledBackCount: 0, error: formatSyncDbError(e) };
  }
}

/**
 * 롤백된(sl_rolled_back=true) 항목을 다시 적용한다.
 * sl_operation 기준으로 INSERT/UPDATE/DELETE 수행 후 sl_rolled_back 해제.
 */
export async function reapplySyncRows(params: {
  slKeys: number[];
  shpPath?: string;
}): Promise<{ success: boolean; reappliedCount: number; error?: string }> {
  const slKeys = params?.slKeys;
  if (!slKeys?.length) return { success: false, reappliedCount: 0, error: 'slKeys가 필요합니다.' };

  const syncTemps = new Map<string, SyncHydrateTemp>();
  try {
    const { db } = await import('@/database/db');
    const { sql } = await import('drizzle-orm');

    const keyList = slKeys.join(', ');
    const logRes = await db.execute(sql.raw(
      `SELECT sl_key, sl_dh_key, sl_table_name, sl_key_field, sl_key_value, sl_operation, sl_old_data, sl_new_data
       FROM sync_log WHERE sl_key IN (${keyList}) AND sl_rolled_back = true AND sl_operation IN ('append','conflict','remove') ORDER BY sl_key`
    ));
    const logs = logRes.rows as Array<{
      sl_key: number; sl_dh_key: number | null; sl_table_name: string; sl_key_field: string;
      sl_key_value: string; sl_operation: string;
      sl_old_data: Record<string, unknown> | null; sl_new_data: Record<string, unknown> | null;
    }>;

    if (logs.length === 0) return { success: true, reappliedCount: 0 };

    for (const log of logs) {
      const nd = log.sl_new_data;
      if (!nd || !isSyncGeomMeta(nd.geom)) continue;
      const tbl = log.sl_table_name;
      if (syncTemps.has(tbl.toLowerCase())) continue;
      const shpPath = await resolveShpPathForSync({
        dhKey: log.sl_dh_key,
        tableName: tbl,
        shpPathHint: params.shpPath,
      });
      if (!shpPath) {
        return { success: false, reappliedCount: 0, error: `SHP 경로를 찾을 수 없습니다. (${tbl})` };
      }
      const imported = await importShpToSyncTempForHydrate({
        pathOrResult: shpPath,
        tableName: tbl,
        keyField: log.sl_key_field,
        sourceSrsOverride: syncGeomMetaSrs(nd.geom),
      });
      if (!imported.success) return { success: false, reappliedCount: 0, error: imported.error };
      syncTemps.set(tbl.toLowerCase(), imported.temp);
    }

    let reappliedCount = 0;
    const tableCache = new Map<string, { fq: string; colMap: SyncColNameMap }>();
    const resolveTable = async (tbl: string): Promise<{ fq: string; colMap: SyncColNameMap } | { error: string }> => {
      const key = tbl.toLowerCase();
      const cached = tableCache.get(key);
      if (cached) return cached;
      const resolved = await resolveSyncTableWithColumns(tbl);
      if ('error' in resolved) return resolved;
      const entry = { fq: resolved.fq, colMap: resolved.colMap };
      tableCache.set(key, entry);
      return entry;
    };

    for (const log of logs) {
      const { sl_table_name: tbl, sl_key_field: kf, sl_key_value: kv, sl_operation: op } = log;
      const tableOrErr = await resolveTable(tbl);
      if ('error' in tableOrErr) {
        return { success: false, reappliedCount: 0, error: tableOrErr.error };
      }
      const { fq, colMap } = tableOrErr;
      const keyCol = colMap.get(kf.toLowerCase()) ?? kf;
      const syncTemp = syncTemps.get(tbl.toLowerCase()) ?? null;

      const newPrepared = await prepareSyncDataForDbWrite({
        data: log.sl_new_data,
        side: 'new',
        keyValue: kv,
        syncTemp,
      });
      if (newPrepared.error && log.sl_new_data && isSyncGeomMeta(log.sl_new_data.geom)) {
        return { success: false, reappliedCount: 0, error: newPrepared.error };
      }
      const newData = newPrepared.data;

      if (op === 'append' && newData) {
        const cols = filterColsToTable(Object.keys(newData), colMap);
        if (cols.length === 0) {
          return { success: false, reappliedCount: 0, error: `다시 적용할 컬럼이 없습니다. (${tbl})` };
        }
        const colNames = cols.map((c) => `"${c}"`).join(', ');
        const vals = cols.map((c) => sqlVal(c, pickSyncDataVal(newData, c))).join(', ');
        await db.execute(sql.raw(`INSERT INTO ${fq} (${colNames}) VALUES (${vals})`));
      } else if (op === 'conflict' && newData) {
        const cols = filterColsToTable(Object.keys(newData), colMap, [kf]);
        if (cols.length > 0) {
          const setClauses = cols.map((c) => `"${c}" = ${sqlVal(c, pickSyncDataVal(newData, c))}`).join(', ');
          const whereSql = syncRowTargetWhereSql({
            keyCol, keyValue: kv, oldData: log.sl_old_data, newData: log.sl_new_data,
            ogcFidCol: colMap.get('ogc_fid') ?? 'ogc_fid',
          });
          await db.execute(sql.raw(
            `UPDATE ${fq} SET ${setClauses} WHERE ${whereSql}`
          ));
        }
      } else if (op === 'remove') {
        const whereSql = syncRowTargetWhereSql({
          keyCol, keyValue: kv, oldData: log.sl_old_data, newData: log.sl_new_data,
          ogcFidCol: colMap.get('ogc_fid') ?? 'ogc_fid',
        });
        await db.execute(sql.raw(
          `DELETE FROM ${fq} WHERE ${whereSql}`
        ));
      }

      await db.execute(sql.raw(
        `UPDATE sync_log SET sl_rolled_back = false, sl_rolled_back_at = NULL WHERE sl_key = ${log.sl_key}`
      ));
      reappliedCount++;
    }

    return { success: true, reappliedCount };
  } catch (e: unknown) {
    return { success: false, reappliedCount: 0, error: formatSyncDbError(e) };
  } finally {
    for (const temp of syncTemps.values()) {
      await dropShpSyncTempTable(temp.dbSchema, temp.syncTableName);
    }
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

  let syncImportAttempted = false;
  try {
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
    syncImportAttempted = true;

    if (importRes.code !== 0) {
      return { success: false, rows: {}, error: `SHP import 실패: ${importRes.stderr}` };
    }

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

    return { success: true, rows: result };
  } catch (e: unknown) {
    return { success: false, rows: {}, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (syncImportAttempted) {
      await dropShpSyncTempTable('layer', syncTableName);
    }
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


