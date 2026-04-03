import fs from 'node:fs/promises';
import path from 'node:path';

import iconv from 'iconv-lite';

import { pool } from '@/database/db';
import { BinaryStreamReader, ensureDir, extractZip, fetchWithRetry, findTokenInFilename, geoserverFetch, resolveOgr2ogrRun, runCommand, withAdvisoryLock, yyyymmdd } from '@/integrations/core';

type KaisMode = 'initial' | 'daily';

type KaisParams = {
  mode: KaisMode;
  appKey: string;
  cntcCd: string;
  dateGb: 'D';
  retryIn: 'Y' | 'N';
  from: string; // yyyymmdd
  to: string; // yyyymmdd
  sggCode?: string; // optional filter
  baseUrl?: string; // default update.juso.go.kr
  downloadRoot?: string; // default <GGNR_DATA_DIR>/integrations/kais
};

type ReceiveRecord = {
  fileSeq: string;
  fileBaseDt: string;
  fileName: string;
  fileSize: number;
  resCode: string;
  reqCode: string;
  replay: string;
  createDt: string;
  outDir: string;
  zipPath: string;
};

const KEY_FIELDS: Record<string, string[]> = {
  ti_sgco_rnadr_mst: ['adr_mng_no', 'sig_cd', 'rn_cd', 'buld_se_cd', 'buld_mnnm', 'buld_slno'],
  ti_spbd_entrc: ['sig_cd', 'ent_man_no'],
  ti_sgco_rnadr_dong: ['adr_mng_no', 'bd_mgt_sn'],
  ti_spbd_entrc_dong: ['sig_cd', 'ent_man_no'],
  ti_sprd_rw: ['rw_sn', 'sig_cd'],
  ti_sprd_manage: ['rds_man_no', 'sig_cd'],
  ti_sprd_intrvl: ['bsi_int_sn', 'rds_man_no', 'sig_cd'],
};

function targetSchema(): string {
  // 사용자가 요청한 기본 스키마: public_layer
  return (process.env.KAIS_TARGET_SCHEMA ?? 'public_layer').trim() || 'public_layer';
}

async function ensureTargetSchema(): Promise<void> {
  const s = targetSchema();
  await pool.query(`create schema if not exists ${s}`);
}

function tiToTl(name: string): string {
  return name.toLowerCase().startsWith('ti_') ? name.toLowerCase().replace(/^ti_/, 'tl_') : name.toLowerCase();
}

function tableNameFor(shpName: string): string {
  // 항상 대상 스키마로 적재/삭제 수행
  return `${targetSchema()}.${tiToTl(shpName)}`;
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

async function tableExists(schema: string, relname: string): Promise<boolean> {
  const r = await pool.query<{ x: boolean }>(
    `
select exists(
  select 1 from information_schema.tables
  where table_schema = $1 and table_name = $2
) as x
`,
    [schema, relname.toLowerCase()]
  );
  return Boolean(r.rows[0]?.x);
}

/** Staging 테이블명(스키마 제외). 본 테이블 `tl_*`와 충돌 없음. */
function stagingRelFor(shpName: string): string {
  return `_kais_stg_${tiToTl(shpName)}`;
}

async function getInsertColumns(schema: string, stagingTable: string, mainTable: string): Promise<string[]> {
  const r = await pool.query<{ column_name: string }>(
    `
select c.column_name
from information_schema.columns c
where c.table_schema = $1 and c.table_name = $2
  and lower(c.column_name) not in ('ogc_fid', 'ogr_fid')
  and exists (
    select 1 from information_schema.columns m
    where m.table_schema = $1 and m.table_name = $3
      and m.column_name = c.column_name
  )
order by c.ordinal_position
`,
    [schema, stagingTable.toLowerCase(), mainTable.toLowerCase()]
  );
  return r.rows.map((row) => row.column_name);
}

function decodeFilename(buf: Uint8Array): string {
  const b = Buffer.from(buf);
  const trimmed = b.toString('binary').replace(/\x00+$/g, '');
  // Try EUC-KR first (common for legacy gov payloads); fallback utf-8.
  try {
    const s = iconv.decode(Buffer.from(trimmed, 'binary'), 'euc-kr').trim();
    if (s) return s;
  } catch {
    // ignore
  }
  return Buffer.from(trimmed, 'binary').toString('utf8').trim();
}

function parseIntAscii(s: string): number {
  const v = parseInt(s.replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(v)) throw new Error(`Invalid int field: "${s}"`);
  return v;
}

async function insertLogKais(params: {
  cntcCd: string;
  name: string;
  date: string;
  resultCode?: string | null;
  responseCode?: string | null;
  responseMsg?: string | null;
  status: string;
}): Promise<void> {
  await pool.query(
    `
insert into log_kais (
  log_kais_cntc_cd,
  log_kais_name,
  log_kais_date,
  log_kais_request_date,
  log_kais_result_code,
  log_kais_response_code,
  log_kais_response_msg,
  log_kais_status
)
values ($1,$2,$3,now(),$4,$5,$6,$7)
`,
    [
      params.cntcCd,
      params.name,
      params.date,
      params.resultCode ?? null,
      params.responseCode ?? null,
      params.responseMsg ?? null,
      params.status,
    ]
  );
}

async function deleteKeys(table: string, keyCols: string[], rows: string[][]): Promise<void> {
  if (rows.length === 0) return;
  // Chunk to avoid enormous SQL.
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const whereParts: string[] = [];
    const values: string[] = [];
    for (const r of chunk) {
      const cond: string[] = [];
      for (let k = 0; k < keyCols.length; k++) {
        values.push(r[k] ?? '');
        cond.push(`${keyCols[k]} = $${values.length}`);
      }
      whereParts.push(`(${cond.join(' and ')})`);
    }
    const sql = `delete from ${table} where ${whereParts.join(' or ')}`;
    try {
      await pool.query(sql, values);
    } catch (e) {
      // 테이블이 아직 없으면(초기) 삭제는 스킵하고, SHP import 때 테이블이 자동 생성되도록 둔다.
      const anyErr = e as { code?: unknown; message?: unknown };
      const code = anyErr?.code != null ? String(anyErr.code) : '';
      const msg =
        anyErr?.message != null
          ? String(anyErr.message)
          : e instanceof Error
            ? e.message
            : String(e);
      if (
        code === '42P01' ||
        msg.includes('42P01') ||
        msg.toLowerCase().includes('does not exist') ||
        msg.includes('관계(relation)')
      ) {
        return;
      }
      throw e;
    }
  }
}

async function deleteFromDeletionTxt(filePath: string, fileDate: string, sggCode?: string): Promise<void> {
  const base = path.basename(filePath);
  const token = findTokenInFilename(base, 'ti_');
  if (!token) return;
  const shpName = token;
  const keyCols = KEY_FIELDS[shpName];
  if (!keyCols) return;
  await ensureTargetSchema();
  const table = tableNameFor(shpName);

  const text = await fs.readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return;
  const dataLines = lines.slice(1);
  if (dataLines[0]?.toLowerCase().includes('no data')) {
    await insertLogKais({ cntcCd: 'KAIS', name: shpName, date: fileDate, status: 'Deletion:NoData' });
    return;
  }

  const rows: string[][] = [];
  for (const line of dataLines) {
    const parts = line.split('|');
    if (parts.length < keyCols.length) continue;
    if (sggCode) {
      // Heuristic based on earlier Java logic: accept if any field contains sggCode.
      if (!parts.some((p) => p?.includes(sggCode))) continue;
    }
    rows.push(parts.slice(0, keyCols.length));
  }
  await deleteKeys(table, keyCols, rows);
  await insertLogKais({ cntcCd: 'KAIS', name: shpName, date: fileDate, status: `Deletion:Deleted:${rows.length}` });
}

async function importShpToPostgis(
  shpPath: string,
  table: string,
  srs: string | undefined,
  opts?: { overwrite?: boolean }
): Promise<void> {
  // Minimal wrapper: rely on ogr2ogr existing in PATH (already used elsewhere in repo).
  // Use -nln to target schema.table.
  await ensureTargetSchema();
  const { cmd: ogr2ogrCmd, args: prefix } = resolveOgr2ogrRun();
  // KAIS 원본 SHP는 .prj가 없는 경우가 있어 좌표계 강제 지정 필요
  // 사용자 요구사항: UTM-K 고정(EPSG:5179)
  const sourceSrs = 'EPSG:5179';
  const overwrite = opts?.overwrite !== false;
  const args: string[] = [
    '-f',
    'PostgreSQL',
    `PG:host=${process.env.DATABASE_HOST} port=${process.env.DATABASE_PORT ?? '5432'} dbname=${process.env.DATABASE_NAME} user=${process.env.DATABASE_USER} password=${process.env.DATABASE_PASSWORD}`,
    shpPath,
    '-oo',
    'ENCODING=CP949',
    '-nlt',
    'PROMOTE_TO_MULTI',
    '-nln',
    table,
    ...(sourceSrs ? (['-s_srs', sourceSrs] as const) : []),
    ...(overwrite ? (['-overwrite'] as const) : (['-append'] as const)),
  ];
  if (srs) {
    args.push('-t_srs', srs);
  }
  args.push('-lco', 'GEOMETRY_NAME=geom');
  const execArgs = prefix.length > 0 ? [...prefix, ...args] : args;
  try {
    await runCommand(ogr2ogrCmd, execArgs, { logPrefix: 'ogr2ogr' });
  } catch (e) {
    const anyErr = e as { code?: unknown; message?: unknown };
    const code = anyErr?.code != null ? String(anyErr.code) : '';
    const msg = anyErr?.message != null ? String(anyErr.message) : e instanceof Error ? e.message : String(e);
    if (code === 'ENOENT' || msg.includes('ENOENT') || msg.includes('spawn ogr2ogr')) {
      throw new Error(
        `ogr2ogr 실행 파일을 찾을 수 없습니다(ENOENT). 기존 SHP 업로드와 동일하게 env에 GGNR_GDAL_OGR2OGR(직접 경로) 또는 GGNR_PIPELINE_PYTHON(conda env) 설정이 필요합니다.`
      );
    }
    if (msg.includes('source layer has no') && msg.toLowerCase().includes('coordinate system')) {
      throw new Error(
        `SHP에 좌표계(.prj)가 없어 변환에 실패했습니다. KAIS는 소스 좌표계를 EPSG:5179(UTM-K)로 고정해서 처리합니다. SHP 자체 좌표계가 다른 경우, 변환 기준을 코드에서 조정해야 합니다.`
      );
    }
    throw e;
  }
}

/**
 * Java KaisScheduler와 동일: 변동 SHP만으로 본 테이블 전체를 덮어쓰지 않음.
 * - 본 테이블 없음: ogr2ogr -overwrite 로 최초 생성
 * - 있음: 스테이징에 SHP 적재 → 키 일치 행 DELETE(USING) → INSERT SELECT → 스테이징 DROP
 */
async function importShpDeltaLikeJava(shpPath: string, shpName: string, targetSrs: string): Promise<void> {
  await ensureTargetSchema();
  const schema = targetSchema();
  const tlRel = tiToTl(shpName);
  const keyCols = KEY_FIELDS[shpName];
  if (!keyCols) return;

  const mainQ = `${quoteIdent(schema)}.${quoteIdent(tlRel)}`;
  const stgRel = stagingRelFor(shpName);
  const stgQ = `${quoteIdent(schema)}.${quoteIdent(stgRel)}`;

  const exists = await tableExists(schema, tlRel);
  if (!exists) {
    await importShpToPostgis(shpPath, `${schema}.${tlRel}`, targetSrs, { overwrite: true });
    return;
  }

  try {
    await importShpToPostgis(shpPath, `${schema}.${stgRel}`, targetSrs, { overwrite: true });
    const keyMatch = keyCols.map((k) => `m.${quoteIdent(k)}::text = s.${quoteIdent(k)}::text`).join(' and ');
    await pool.query(`delete from ${mainQ} m using ${stgQ} s where ${keyMatch}`);
    const cols = await getInsertColumns(schema, stgRel, tlRel);
    if (cols.length === 0) {
      throw new Error(`KAIS: no common columns (excluding ogc_fid) for ${schema}.${tlRel} ← staging ${stgRel}`);
    }
    const colList = cols.map(quoteIdent).join(', ');
    const selectList = cols.map((c) => `s.${quoteIdent(c)}`).join(', ');
    await pool.query(`insert into ${mainQ} (${colList}) select ${selectList} from ${stgQ} s`);
  } finally {
    await pool.query(`drop table if exists ${stgQ}`).catch(() => {});
  }
}

async function publishGeoServerLayer(layerName: string): Promise<void> {
  const workspace = process.env.GEOSERVER_WORKSPACE ?? 'ggnr';
  const datastore = process.env.GEOSERVER_DATASTORE ?? 'layer';
  const qualified = `${workspace}:${layerName}`;

  await geoserverFetch(`/rest/layers/${qualified}.json`, { method: 'DELETE' }).catch(() => {});
  await geoserverFetch(`/rest/workspaces/${workspace}/datastores/${datastore}/featuretypes/${layerName}.json`, { method: 'DELETE' }).catch(() => {});

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<featureType>
  <name>${layerName}</name>
</featureType>`;

  const res = await geoserverFetch(`/rest/workspaces/${workspace}/datastores/${datastore}/featuretypes`, {
    method: 'POST',
    body: xml,
    contentType: 'text/xml',
    accept: 'application/json',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GeoServer publish failed (${res.status}): ${t.slice(0, 300)}`);
  }
}

function defaultDownloadRoot(): string {
  const root = process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir';
  return path.join(root, 'integrations', 'kais');
}

async function receiveZipRecords(params: KaisParams): Promise<ReceiveRecord[]> {
  const baseUrl = params.baseUrl ?? 'http://update.juso.go.kr';
  const url = new URL('/updateInfo.do', baseUrl);
  url.searchParams.set('app_key', params.appKey);
  url.searchParams.set('date_gb', params.dateGb);
  url.searchParams.set('retry_in', params.retryIn);
  url.searchParams.set('cntc_cd', params.cntcCd);
  url.searchParams.set('req_dt', params.from);
  url.searchParams.set('req_dt2', params.to);

  const res = await fetchWithRetry(url.toString(), { method: 'GET' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`KAIS receive failed: HTTP ${res.status} ${t.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('KAIS receive failed: empty body');

  const reader = new BinaryStreamReader(res.body);
  const out: ReceiveRecord[] = [];
  const root = params.downloadRoot ?? defaultDownloadRoot();

  while (true) {
    const seqBuf = await reader.readMaybe(2);
    if (!seqBuf) break;
    const fileSeq = Buffer.from(seqBuf).toString('ascii');

    const fileBaseDt = await reader.readAscii(8);
    const fileName = decodeFilename(await reader.readExactly(50));
    const fileSize = parseIntAscii(await reader.readAscii(10));
    const resCode = await reader.readAscii(5);
    const reqCode = await reader.readAscii(6);
    const replay = await reader.readAscii(1);
    const createDt = (await reader.readAscii(8)).trim();

    const outDir = path.join(root, createDt.slice(2, 8));
    await ensureDir(outDir);

    // Python guide reads file_size + 10; keep compatibility by doing the same.
    const zipBytes = await reader.readExactly(fileSize + 10);
    const zipPath = path.join(outDir, fileName);
    await fs.writeFile(zipPath, Buffer.from(zipBytes));

    out.push({ fileSeq, fileBaseDt, fileName, fileSize, resCode, reqCode, replay, createDt, outDir, zipPath });
  }
  return out;
}

async function processZipRecord(params: KaisParams, rec: ReceiveRecord): Promise<void> {
  const unzipDir = rec.zipPath.replace(/\.zip$/i, '');
  await extractZip(rec.zipPath, unzipDir);
  const entries = await fs.readdir(unzipDir).catch(() => []);

  // Java와 동일: deletion.txt 선처리 후 SHP 적재(디렉터리 순서와 무관하게)
  for (const name of entries) {
    const p = path.join(unzipDir, name);
    const lower = name.toLowerCase();
    if (lower.includes('deletion') && lower.endsWith('.txt')) {
      await deleteFromDeletionTxt(p, rec.createDt, params.sggCode);
    }
  }
  for (const name of entries) {
    const p = path.join(unzipDir, name);
    const lower = name.toLowerCase();
    if (!lower.endsWith('.shp')) continue;
    const token = findTokenInFilename(name, 'ti_');
    if (!token) continue;
    const shpName = token;
    const keyCols = KEY_FIELDS[shpName];
    if (!keyCols) continue;
    const table = tableNameFor(shpName);

    // 원본 EPSG:5179(UTM-K) → DB EPSG:5181. 일변동은 키 선삭제 후 INSERT(Java deleteFromSHP + uploadSHP).
    await importShpDeltaLikeJava(p, shpName, 'EPSG:5181');

    if (params.sggCode) {
      await pool.query(`delete from ${table} where sig_cd != $1`, [params.sggCode]).catch(() => {});
    }

    if (process.env.KAIS_GEOSERVER_PUBLISH === '1') {
      await publishGeoServerLayer(tiToTl(shpName));
    }

    await insertLogKais({ cntcCd: params.cntcCd, name: shpName, date: rec.createDt, status: `SHP:Imported:${table}` });
  }
}

export async function runKais(params: KaisParams): Promise<void> {
  const lockKey = `kais:${params.mode}:${params.cntcCd}:${params.from}:${params.to}`;
  await withAdvisoryLock(lockKey, async () => {
    await insertLogKais({
      cntcCd: params.cntcCd,
      name: `cntc_${params.cntcCd}`,
      date: params.from,
      status: `Start:${params.mode}`,
    });

    const records = await receiveZipRecords(params);
    for (const r of records) {
      await processZipRecord(params, r);
    }
  });
}

export function defaultDailyWindow(now = new Date()): { from: string; to: string } {
  // Default: request today's delta
  const d = yyyymmdd(now);
  return { from: d, to: d };
}

