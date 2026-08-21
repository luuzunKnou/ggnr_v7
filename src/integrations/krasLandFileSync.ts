/**
 * 토지행정망 목록·토지기본정보·소유현황, 공시지가 일괄 파일.
 * 도형(038)은 krasLayerSync. 필지 클릭 XML·주제도 분할·대장 통째 적재는 하지 않음.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import iconv from 'iconv-lite';

import { pool } from '@/database/db';
import { extractZip, withAdvisoryLock } from '@/integrations/core';
import {
  buildKrasQuery,
  fetchKrasBytes,
  krasRequestUrl,
  requireKorepsConn,
  requireKrasConn,
} from '@/integrations/krasGateway';
import {
  KOREPS_PRICE_FILE_QUERY_ID,
  KOREPS_PRICE_FILE_TABLE,
  KRAS_CATALOG_QUERY_ID,
  KRAS_DROP_GUARD_MIN_OLD,
  KRAS_DROP_GUARD_RATIO,
  KRAS_LAND_BASIC_QUERY_ID,
  KRAS_LAND_BASIC_TABLE,
  KRAS_LANDOWN_OWN_LABEL,
  KRAS_LANDOWN_TABLE,
  KRAS_LAYER_CATALOG_SCHEMA,
  KRAS_LAYER_CATALOG_TABLE,
  KRAS_LAYER_SCHEMA_CANDIDATES,
} from '@/integrations/krasLayerSync.config';
import type { KrasLayerSyncResult } from '@/integrations/krasLayerSync';
import { parseKrasBodyFieldMaps } from '@/lib/krasLandUseXml';
import { createOrUpdateGeoServerLayer } from '@/service/devTestService';

const LOG = '[kras-land-file]';

const LAND_BASIC_COLS = [
  'adm_sect_cd',
  'land_loc_cd',
  'ledg_gbn',
  'bobn',
  'bubn',
  'jimok',
  'parea',
  'own_gbn',
] as const;

const PRICE_FILE_COLS = [
  'pnu',
  'base_year',
  'stdmt',
  'pnilp',
  'pjji_yn',
  'pann_ymd',
  'etc_cntn',
  'col_adm_sect_cd',
] as const;

type ProgressFn = (message: string) => Promise<void> | void;

export type KrasStepResult = { status: 'ok' | 'skip'; detail: string };

function qi(ident: string): string {
  const n = ident.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`잘못된 식별자: ${ident}`);
  return `"${n}"`;
}

function colIdent(raw: string): string {
  const n = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`잘못된 열 이름: ${raw}`);
  return n;
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const { rows } = await pool.query<{ c: string }>(`select to_regclass($1) as c`, [`${schema}.${table}`]);
  return Boolean(rows[0]?.c);
}

async function countRows(schema: string, table: string): Promise<number> {
  const { rows } = await pool.query<{ c: string }>(
    `select count(*)::text as c from ${qi(schema)}.${qi(table)}`
  );
  return Number(rows[0]?.c ?? 0);
}

async function dropTable(schema: string, table: string): Promise<void> {
  await pool.query(`drop table if exists ${qi(schema)}.${qi(table)}`);
}

async function swapTables(schema: string, tmp: string, target: string): Promise<void> {
  const old = `${target}_krasold`;
  await dropTable(schema, old);
  const exists = await tableExists(schema, target);
  if (exists) {
    await pool.query(`alter table ${qi(schema)}.${qi(target)} rename to ${qi(old)}`);
  }
  try {
    await pool.query(`alter table ${qi(schema)}.${qi(tmp)} rename to ${qi(target)}`);
  } catch (e) {
    if (exists) {
      await pool.query(`alter table ${qi(schema)}.${qi(old)} rename to ${qi(target)}`).catch(() => {});
    }
    throw e;
  }
  await dropTable(schema, old);
}

async function resolveLayerSchema(table: string): Promise<'public_layer' | 'layer'> {
  for (const schema of KRAS_LAYER_SCHEMA_CANDIDATES) {
    if (await tableExists(schema, table)) return schema;
  }
  return 'public_layer';
}

async function ensureLinkageSchema(): Promise<void> {
  await pool.query(`create schema if not exists ${qi(KRAS_LAYER_CATALOG_SCHEMA)}`);
}

function decodeText(buf: Buffer): string {
  const utf = buf.toString('utf8');
  const first = utf.split(/\r?\n/, 1)[0] ?? '';
  const looksBinaryKorean = utf.includes('\uFFFD') || /[\x80-\xFF]/.test(first);
  const looksKnown =
    /adm_sect|land_loc|layer_cd|grp_nm|pnu|base_year|jimok/i.test(first) ||
    /^[\x09\x0b\x20-\x7e|,]+$/.test(first);
  if (!looksBinaryKorean && looksKnown) return utf;
  if (!utf.includes('\uFFFD') && looksKnown) return utf;
  return iconv.decode(buf, 'cp949');
}

function splitHeaderLine(line: string): { delim: string; headers: string[] } {
  if (line.includes('\u000B')) {
    return { delim: '\u000B', headers: line.split('\u000B') };
  }
  if (line.includes('\t')) {
    return { delim: '\t', headers: line.split('\t') };
  }
  if (line.includes('|')) {
    return { delim: '|', headers: line.split('|') };
  }
  return { delim: '\t', headers: line.split('\t') };
}

function parseDelimitedRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headerLine = lines[0];
  if (!headerLine) return [];
  const { delim, headers: rawHeaders } = splitHeaderLine(headerLine);
  const headers = rawHeaders.map((h) => colIdent(h));
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = delim === '\u000B' ? lines[i]!.split(/[\p{C}]+/u) : lines[i]!.split(delim);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]!] = (values[c] ?? '').trim();
    }
    out.push(row);
  }
  return out;
}

async function insertVarcharRows(
  schema: string,
  table: string,
  columns: string[],
  rows: Record<string, string>[]
): Promise<void> {
  const colSql = columns.map(qi).join(', ');
  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const params: string[] = [];
    const values = batch.map((row, ri) => {
      const parts = columns.map((col, ci) => {
        params.push(row[col] ?? '');
        return `$${ri * columns.length + ci + 1}`;
      });
      return `(${parts.join(',')})`;
    });
    await pool.query(
      `insert into ${qi(schema)}.${qi(table)} (${colSql}) values ${values.join(',')}`,
      params
    );
  }
}

async function loadVarcharTable(opts: {
  schema: string;
  table: string;
  columns: string[];
  rows: Record<string, string>[];
  label: string;
}): Promise<KrasStepResult> {
  if (!opts.rows.length) {
    return { status: 'skip', detail: `${opts.label} 0건 — 기존 유지` };
  }
  const tmp = `${opts.table}_krastmp`;
  await dropTable(opts.schema, tmp);
  const defs = opts.columns.map((c) => `${qi(c)} varchar`).join(', ');
  await pool.query(`create table ${qi(opts.schema)}.${qi(tmp)} (${defs})`);
  try {
    await insertVarcharRows(opts.schema, tmp, opts.columns, opts.rows);
    const newCnt = await countRows(opts.schema, tmp);
    if (newCnt <= 0) {
      await dropTable(opts.schema, tmp);
      return { status: 'skip', detail: `${opts.label} 0건 — 기존 유지` };
    }
    const oldExists = await tableExists(opts.schema, opts.table);
    const oldCnt = oldExists ? await countRows(opts.schema, opts.table) : 0;
    if (oldExists && oldCnt >= KRAS_DROP_GUARD_MIN_OLD && newCnt < oldCnt * KRAS_DROP_GUARD_RATIO) {
      await dropTable(opts.schema, tmp);
      return {
        status: 'skip',
        detail: `${opts.label} 건수 부족(기존 ${oldCnt} → ${newCnt}), 기존 유지`,
      };
    }
    await swapTables(opts.schema, tmp, opts.table);
    return { status: 'ok', detail: `${opts.label} 반영 ${opts.schema}.${opts.table} ${newCnt}건` };
  } catch (e) {
    await dropTable(opts.schema, tmp).catch(() => {});
    throw e;
  }
}

function pickXmlTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  return block.match(re)?.[1]?.trim() ?? '';
}

function parseLayerCatalogXml(xml: string): Record<string, string>[] {
  const fromMaps = parseKrasBodyFieldMaps(xml)
    .map((m) => {
      const rec: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) rec[colIdent(k)] = String(v ?? '').trim();
      if (rec.grp_nm && !rec.grp_id) rec.grp_id = rec.grp_nm;
      return rec;
    })
    .filter((r) => r.layer_cd);
  if (fromMaps.length) return fromMaps;

  const blocks = xml.match(/<CONT_CMAP_LAYER_LIST>[\s\S]*?<\/CONT_CMAP_LAYER_LIST>/gi) ?? [];
  return blocks
    .map((block) => {
      const grpNm = pickXmlTag(block, 'GRP_NM');
      const rec: Record<string, string> = {
        grp_nm: grpNm,
        grp_id: grpNm,
        layer_nm: pickXmlTag(block, 'LAYER_NM'),
        layer_no: pickXmlTag(block, 'LAYER_NO'),
        layer_cd: pickXmlTag(block, 'LAYER_CD'),
      };
      return rec;
    })
    .filter((r) => r.layer_cd);
}

function pickCols(row: Record<string, string>, wanted: readonly string[]): Record<string, string> {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase()] = v;
  const out: Record<string, string> = {};
  for (const c of wanted) out[c] = lower[c] ?? '';
  return out;
}

export async function refreshKrasLayerCatalog(): Promise<KrasStepResult> {
  const conn = requireKrasConn();
  const q = buildKrasQuery({ key: conn.key, queryId: KRAS_CATALOG_QUERY_ID, sgg: conn.sgg });
  const buf = await fetchKrasBytes(krasRequestUrl(conn.url, q), { allowSuccessXml: true });
  const rows = parseLayerCatalogXml(buf.toString('utf8'));
  if (!rows.length) {
    return { status: 'skip', detail: '레이어 목록 0건 — 기존 유지' };
  }
  await ensureLinkageSchema();
  const colSet = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) colSet.add(k);
  const columns = [...colSet];
  return loadVarcharTable({
    schema: KRAS_LAYER_CATALOG_SCHEMA,
    table: KRAS_LAYER_CATALOG_TABLE,
    columns,
    rows,
    label: '레이어 목록',
  });
}

export async function refreshKrasLandBasic(): Promise<KrasStepResult> {
  const conn = requireKrasConn();
  const q = buildKrasQuery({ key: conn.key, queryId: KRAS_LAND_BASIC_QUERY_ID, sgg: conn.sgg });
  const buf = await fetchKrasBytes(krasRequestUrl(conn.url, q));
  const parsed = parseDelimitedRows(decodeText(buf));
  const named = parsed.map((r) => pickCols(r, LAND_BASIC_COLS));
  const usePos = named.every((r) => !r.adm_sect_cd);
  const rows = usePos
    ? parsed.map((r) => {
        const vals = Object.values(r);
        const byPos: Record<string, string> = {};
        LAND_BASIC_COLS.forEach((c, i) => {
          byPos[c] = vals[i] ?? '';
        });
        return byPos;
      })
    : named;
  await ensureLinkageSchema();
  return loadVarcharTable({
    schema: KRAS_LAYER_CATALOG_SCHEMA,
    table: KRAS_LAND_BASIC_TABLE,
    columns: [...LAND_BASIC_COLS],
    rows,
    label: '토지기본정보',
  });
}

function ownGbnCaseSql(alias: string): string {
  const parts = Object.entries(KRAS_LANDOWN_OWN_LABEL)
    .map(([code, label]) => `when ${alias}.own_gbn = '${code}' then '${label.replace(/'/g, "''")}'`)
    .join(' ');
  return `case ${parts} else '기타' end`;
}

export async function recreateLandownFromBasic(): Promise<KrasStepResult> {
  if (!(await tableExists(KRAS_LAYER_CATALOG_SCHEMA, KRAS_LAND_BASIC_TABLE))) {
    return { status: 'skip', detail: '토지기본정보 없음 — 소유현황 기존 유지' };
  }
  const basicCnt = await countRows(KRAS_LAYER_CATALOG_SCHEMA, KRAS_LAND_BASIC_TABLE);
  if (basicCnt <= 0) {
    return { status: 'skip', detail: '토지기본정보 0건 — 소유현황 기존 유지' };
  }

  const jijukSchema = await resolveLayerSchema('jijuk');
  if (!(await tableExists(jijukSchema, 'jijuk'))) {
    return { status: 'skip', detail: '지적 도형 없음 — 소유현황 기존 유지' };
  }
  const jijukCnt = await countRows(jijukSchema, 'jijuk');
  if (jijukCnt <= 0) {
    return { status: 'skip', detail: '지적 도형 0건 — 소유현황 기존 유지' };
  }

  const landownSchema = (await tableExists('public_layer', KRAS_LANDOWN_TABLE))
    ? 'public_layer'
    : (await tableExists('layer', KRAS_LANDOWN_TABLE))
      ? 'layer'
      : 'public_layer';

  const emdSchema = await resolveLayerSchema('emd');
  const sggSchema = await resolveLayerSchema('sgg');
  const riSchema = await resolveLayerSchema('ri');
  const hasEmd = await tableExists(emdSchema, 'emd');
  const hasSgg = await tableExists(sggSchema, 'sgg');
  const hasRi = await tableExists(riSchema, 'ri');

  const tmp = `${KRAS_LANDOWN_TABLE}_krastmp`;
  await dropTable(landownSchema, tmp);

  const addrParts = [
    hasSgg ? `nullif(trim(s.sgg_nm), '')` : null,
    hasEmd ? `nullif(trim(e.emd_nm), '')` : null,
    hasRi ? `nullif(trim(r.ri_nm), '')` : null,
  ].filter(Boolean);
  const addrExpr = addrParts.length ? `concat_ws(' ', ${addrParts.join(', ')})` : `''`;

  const joins = [
    `from ${qi(KRAS_LAYER_CATALOG_SCHEMA)}.${qi(KRAS_LAND_BASIC_TABLE)} k`,
    `join ${qi(jijukSchema)}.${qi('jijuk')} j
       on j.pnu = k.adm_sect_cd || k.land_loc_cd || k.ledg_gbn || k.bobn || k.bubn`,
    hasSgg ? `left join ${qi(sggSchema)}.${qi('sgg')} s on s.adm_sect_c = k.adm_sect_cd` : '',
    hasEmd
      ? `left join ${qi(emdSchema)}.${qi('emd')} e on e.emd_cd = substring(k.adm_sect_cd || k.land_loc_cd, 1, 8)`
      : '',
    hasRi ? `left join ${qi(riSchema)}.${qi('ri')} r on r.ri_cd = k.adm_sect_cd || k.land_loc_cd` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await pool.query(`
      create table ${qi(landownSchema)}.${qi(tmp)} as
      select
        k.adm_sect_cd || k.land_loc_cd || k.ledg_gbn || k.bobn || k.bubn as pnu,
        k.jimok,
        k.parea,
        ${addrExpr} as a2,
        ${addrExpr} as parcel_address,
        k.own_gbn as a7,
        ${ownGbnCaseSql('k')} as a8,
        j.jibun,
        j.bchk,
        j.geom
      ${joins}
    `);
    await pool.query(
      `alter table ${qi(landownSchema)}.${qi(tmp)} add column gid serial primary key, add column id serial`
    );

    const newCnt = await countRows(landownSchema, tmp);
    if (newCnt <= 0) {
      await dropTable(landownSchema, tmp);
      return { status: 'skip', detail: '소유현황 0건 — 기존 유지' };
    }
    const oldExists = await tableExists(landownSchema, KRAS_LANDOWN_TABLE);
    const oldCnt = oldExists ? await countRows(landownSchema, KRAS_LANDOWN_TABLE) : 0;
    if (oldExists && oldCnt >= KRAS_DROP_GUARD_MIN_OLD && newCnt < oldCnt * KRAS_DROP_GUARD_RATIO) {
      await dropTable(landownSchema, tmp);
      return {
        status: 'skip',
        detail: `소유현황 건수 부족(기존 ${oldCnt} → ${newCnt}), 기존 유지`,
      };
    }
    await swapTables(landownSchema, tmp, KRAS_LANDOWN_TABLE);
    try {
      await createOrUpdateGeoServerLayer({ layerName: KRAS_LANDOWN_TABLE });
    } catch (e) {
      console.warn(`${LOG} geoserver landown:`, e instanceof Error ? e.message : e);
    }
    return {
      status: 'ok',
      detail: `소유현황 반영 ${landownSchema}.${KRAS_LANDOWN_TABLE} ${newCnt}건`,
    };
  } catch (e) {
    await dropTable(landownSchema, tmp).catch(() => {});
    throw e;
  }
}

function dataDir(): string {
  return (process.env.GGNR_DATA_DIR ?? 'd:\\ggnr_data_dir').trim() || 'd:\\ggnr_data_dir';
}

async function findFirstTxt(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const nested = await findFirstTxt(full);
      if (nested) return nested;
    } else if (e.name.toLowerCase().endsWith('.txt')) {
      return full;
    }
  }
  return null;
}

export async function refreshKorepsPriceFile(): Promise<KrasStepResult> {
  const conn = requireKorepsConn();
  const queryId = KOREPS_PRICE_FILE_QUERY_ID;
  const url = `${conn.url.replace(/\/+$/, '')}/${queryId}`;
  const body = buildKrasQuery({ key: conn.key, queryId, sgg: conn.sgg });
  const buf = await fetchKrasBytes(url, { method: 'POST', body });
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('공시지가 파일이 압축 형식이 아닙니다');
  }

  const workDir = path.join(dataDir(), 'kras_sync', 'koreps00039');
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(workDir, { recursive: true });
  const zipPath = path.join(workDir, `${queryId}.zip`);
  try {
    await fs.writeFile(zipPath, buf);
    await extractZip(zipPath, workDir);
    const txtPath = await findFirstTxt(workDir);
    if (!txtPath) {
      return { status: 'skip', detail: '공시지가 파일 안 텍스트 없음 — 기존 유지' };
    }
    const txt = decodeText(await fs.readFile(txtPath));
    const parsed = parseDelimitedRows(txt);
    const rows = parsed.map((r) => pickCols(r, PRICE_FILE_COLS));
    await ensureLinkageSchema();
    return loadVarcharTable({
      schema: KRAS_LAYER_CATALOG_SCHEMA,
      table: KOREPS_PRICE_FILE_TABLE,
      columns: [...PRICE_FILE_COLS],
      rows,
      label: '공시지가 파일',
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runStep(
  label: string,
  fn: () => Promise<KrasStepResult>,
  onProgress?: ProgressFn
): Promise<KrasStepResult> {
  await onProgress?.(`진행중 | ${label}`);
  const r = await fn();
  await onProgress?.(`${r.status === 'ok' ? '완료' : '유지'} | ${label} | ${r.detail}`);
  console.info(`${LOG} ${r.detail}`);
  return r;
}

function toSyncResult(details: string[], failed: number): KrasLayerSyncResult {
  const total = details.length;
  const success = details.filter((d) => !/실패|기존 유지|0건/.test(d) || /반영/.test(d)).length;
  const skipped = total - success - failed;
  const message = details.join('\n');
  return {
    ok: failed === 0,
    total,
    success,
    skipped: Math.max(0, skipped),
    failed,
    message,
    details,
  };
}

export async function runKrasFullSync(opts?: {
  includeShape?: boolean;
  includePriceFile?: boolean;
  skipLock?: boolean;
  onProgress?: ProgressFn;
}): Promise<KrasLayerSyncResult> {
  const includeShape = opts?.includeShape !== false;
  const includePriceFile = opts?.includePriceFile === true;
  const run = async (): Promise<KrasLayerSyncResult> => {
    const details: string[] = [];
    let failed = 0;
    const push = (r: KrasStepResult) => details.push(r.detail);

    try {
      push(await runStep('레이어 목록', refreshKrasLayerCatalog, opts?.onProgress));
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(`레이어 목록 실패: ${msg}`);
      await opts?.onProgress?.(`실패 | 레이어 목록 | ${msg}`);
    }

    if (includeShape) {
      try {
        const { runKrasLayerSync } = await import('@/integrations/krasLayerSync');
        const shape = await runKrasLayerSync({
          scope: 'all',
          onProgress: opts?.onProgress,
          skipLock: true,
          throwIfAllFailed: false,
        });
        details.push(...shape.details);
        failed += shape.failed;
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        details.push(`도형 실패: ${msg}`);
        await opts?.onProgress?.(`실패 | 도형 | ${msg}`);
      }
    }

    try {
      push(await runStep('토지기본정보', refreshKrasLandBasic, opts?.onProgress));
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(`토지기본정보 실패: ${msg}`);
      await opts?.onProgress?.(`실패 | 토지기본정보 | ${msg}`);
    }

    try {
      push(await runStep('소유현황', recreateLandownFromBasic, opts?.onProgress));
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(`소유현황 실패: ${msg}`);
      await opts?.onProgress?.(`실패 | 소유현황 | ${msg}`);
    }

    if (includePriceFile) {
      try {
        push(await runStep('공시지가 파일', refreshKorepsPriceFile, opts?.onProgress));
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        details.push(`공시지가 파일 실패: ${msg}`);
        await opts?.onProgress?.(`실패 | 공시지가 파일 | ${msg}`);
      }
    }

    const result = toSyncResult(details, failed);
    if (failed > 0 && !details.some((d) => /반영/.test(d))) {
      throw new Error(details[0] ?? result.message);
    }
    return { ...result, message: details.join('\n') };
  };

  try {
    if (opts?.skipLock) return await run();
    return await withAdvisoryLock('KRAS-layer', run);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/lock busy/i.test(msg)) throw new Error('이미 실행 중입니다.');
    throw e;
  }
}

export async function runKorepsPriceFileSync(opts?: {
  onProgress?: ProgressFn;
}): Promise<KrasLayerSyncResult> {
  try {
    return await withAdvisoryLock('KRAS-layer', async () => {
      const r = await runStep('공시지가 파일', refreshKorepsPriceFile, opts?.onProgress);
      return {
        ok: r.status === 'ok',
        total: 1,
        success: r.status === 'ok' ? 1 : 0,
        skipped: r.status === 'skip' ? 1 : 0,
        failed: 0,
        message: r.detail,
        details: [r.detail],
      };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/lock busy/i.test(msg)) throw new Error('이미 실행 중입니다.');
    throw e;
  }
}

export async function runKrasFileStep(
  step: 'catalog' | 'landinfo' | 'landown',
  opts?: { onProgress?: ProgressFn }
): Promise<KrasLayerSyncResult> {
  const fn =
    step === 'catalog'
      ? refreshKrasLayerCatalog
      : step === 'landinfo'
        ? refreshKrasLandBasic
        : recreateLandownFromBasic;
  const label = step === 'catalog' ? '레이어 목록' : step === 'landinfo' ? '토지기본정보' : '소유현황';
  try {
    return await withAdvisoryLock('KRAS-layer', async () => {
      const r = await runStep(label, fn, opts?.onProgress);
      return {
        ok: r.status === 'ok',
        total: 1,
        success: r.status === 'ok' ? 1 : 0,
        skipped: r.status === 'skip' ? 1 : 0,
        failed: 0,
        message: r.detail,
        details: [r.detail],
      };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/lock busy/i.test(msg)) throw new Error('이미 실행 중입니다.');
    throw e;
  }
}
