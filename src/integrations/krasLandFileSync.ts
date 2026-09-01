/**
 * 토지행정망 목록·토지기본정보·소유현황, 공시지가 일괄 파일.
 * 도형(038)은 krasLayerSync. 필지 클릭 XML·주제도 분할·대장 통째 적재는 하지 않음.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import iconv from 'iconv-lite';

import { parseKrasBodyFieldMaps } from '@/lib/krasLandUseXml';
import { pool } from '@/database/db';
import { extractZip, withAdvisoryLock } from '@/integrations/core';
import { appendLinkageError, formatLinkageError } from '@/integrations/linkageErrorLog';
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
  KRAS_LAYER_CATALOG_SCHEMA,
  KRAS_LAYER_CATALOG_TABLE,
  KRAS_LAYER_SCHEMA_CANDIDATES,
} from '@/integrations/krasLayerSync.config';
import {
  JIJUK_OWN_GBN_COLUMN,
  JIJUK_TABLE,
  ensureJijukOwnGbnColumn,
} from '@/integrations/krasJijukOwnGbn';
import type { KrasLayerSyncResult } from '@/integrations/krasLayerSync';
import { krasSyncWorkDir, pruneOldKrasSyncDays } from '@/integrations/krasSyncKeepDir';

const LOG = '[kras-land-file]';

/** 필지 고유번호 ↔ 소유구분 대조용 임시 테이블 */
const OWN_GBN_MAP_TABLE = 'kras_own_gbn_map';

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

/**
 * 토지기본정보의 지번 코드를 이어 붙여 필지 고유번호를 만들고,
 * 같은 고유번호의 지적 도형에 소유구분 값을 채운다.
 * 소유구분 레이어·지목 레이어가 지적 도형 하나만 보고 그려지도록 하는 단계.
 */
export async function applyOwnGbnToJijuk(): Promise<KrasStepResult> {
  if (!(await tableExists(KRAS_LAYER_CATALOG_SCHEMA, KRAS_LAND_BASIC_TABLE))) {
    return { status: 'skip', detail: '토지기본정보 없음 — 소유구분 기존 유지' };
  }
  const basicCnt = await countRows(KRAS_LAYER_CATALOG_SCHEMA, KRAS_LAND_BASIC_TABLE);
  if (basicCnt <= 0) {
    return { status: 'skip', detail: '토지기본정보 0건 — 소유구분 기존 유지' };
  }

  const jijukSchema = await resolveLayerSchema(JIJUK_TABLE);
  if (!(await tableExists(jijukSchema, JIJUK_TABLE))) {
    return { status: 'skip', detail: '지적 도형 없음 — 소유구분 건너뜀' };
  }
  const jijukCnt = await countRows(jijukSchema, JIJUK_TABLE);
  if (jijukCnt <= 0) {
    return { status: 'skip', detail: '지적 도형 0건 — 소유구분 건너뜀' };
  }

  const basic = `${qi(KRAS_LAYER_CATALOG_SCHEMA)}.${qi(KRAS_LAND_BASIC_TABLE)}`;
  const jijuk = `${qi(jijukSchema)}.${qi(JIJUK_TABLE)}`;
  const map = `${qi(KRAS_LAYER_CATALOG_SCHEMA)}.${qi(OWN_GBN_MAP_TABLE)}`;
  const ownCol = qi(JIJUK_OWN_GBN_COLUMN);

  await ensureJijukOwnGbnColumn(jijukSchema, JIJUK_TABLE);
  await dropTable(KRAS_LAYER_CATALOG_SCHEMA, OWN_GBN_MAP_TABLE);

  try {
    await pool.query(`
      create table ${map} as
      select distinct on (p.pnu) p.pnu, p.own_gbn
      from (
        select
          nullif(trim(k.adm_sect_cd || k.land_loc_cd || k.ledg_gbn || k.bobn || k.bubn), '') as pnu,
          nullif(trim(k.own_gbn), '') as own_gbn
        from ${basic} k
      ) p
      where p.pnu is not null and p.own_gbn is not null
      order by p.pnu
    `);
    const mapCnt = await countRows(KRAS_LAYER_CATALOG_SCHEMA, OWN_GBN_MAP_TABLE);
    if (mapCnt <= 0) {
      return { status: 'skip', detail: '토지기본정보 소유구분 없음 — 지적 소유구분 기존 유지' };
    }
    await pool.query(`alter table ${map} add primary key (pnu)`);

    const { rows: matchRows } = await pool.query<{ c: string }>(
      `select count(*)::text as c from ${jijuk} j join ${map} m on m.pnu = j.pnu`
    );
    const matched = Number(matchRows[0]?.c ?? 0);
    if (matched <= 0) {
      return { status: 'skip', detail: '지적·토지기본정보 필지 일치 없음 — 소유구분 기존 유지' };
    }

    await pool.query(`
      update ${jijuk} j
      set ${ownCol} = m.own_gbn
      from ${map} m
      where j.pnu = m.pnu and coalesce(j.${ownCol}, '') <> m.own_gbn
    `);
    await pool.query(`
      update ${jijuk} j
      set ${ownCol} = null
      where j.${ownCol} is not null
        and not exists (select 1 from ${map} m where m.pnu = j.pnu)
    `);

    return {
      status: 'ok',
      detail: `소유구분 반영 ${jijukSchema}.${JIJUK_TABLE} ${matched}건 (지적 ${jijukCnt}건)`,
    };
  } finally {
    await dropTable(KRAS_LAYER_CATALOG_SCHEMA, OWN_GBN_MAP_TABLE).catch(() => {});
  }
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

  await pruneOldKrasSyncDays();
  const workDir = krasSyncWorkDir('koreps00039');
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(workDir, { recursive: true });
  const zipPath = path.join(workDir, `${queryId}.zip`);
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
      void appendLinkageError({ system: 'KRAS', title: '레이어 목록', detail: formatLinkageError(e) });
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
        void appendLinkageError({ system: 'KRAS', title: '도형', detail: formatLinkageError(e) });
      }
    }

    try {
      push(await runStep('토지기본정보', refreshKrasLandBasic, opts?.onProgress));
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(`토지기본정보 실패: ${msg}`);
      await opts?.onProgress?.(`실패 | 토지기본정보 | ${msg}`);
      void appendLinkageError({ system: 'KRAS', title: '토지기본정보', detail: formatLinkageError(e) });
    }

    try {
      push(await runStep('소유구분', applyOwnGbnToJijuk, opts?.onProgress));
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      details.push(`소유구분 실패: ${msg}`);
      await opts?.onProgress?.(`실패 | 소유구분 | ${msg}`);
      void appendLinkageError({ system: 'KRAS', title: '소유구분', detail: formatLinkageError(e) });
    }

    if (includePriceFile) {
      try {
        push(await runStep('공시지가 파일', refreshKorepsPriceFile, opts?.onProgress));
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        details.push(`공시지가 파일 실패: ${msg}`);
        await opts?.onProgress?.(`실패 | 공시지가 파일 | ${msg}`);
        void appendLinkageError({
          system: 'KORPES',
          title: '공시지가 파일',
          detail: formatLinkageError(e),
        });
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
    void appendLinkageError({
      system: 'KRAS',
      title: '연계 중단',
      detail: formatLinkageError(e),
    });
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
    void appendLinkageError({
      system: 'KORPES',
      title: '공시지가 파일',
      detail: formatLinkageError(e),
    });
    if (/lock busy/i.test(msg)) throw new Error('이미 실행 중입니다.');
    throw e;
  }
}

export async function runKrasFileStep(
  step: 'catalog' | 'landinfo' | 'owngbn',
  opts?: { onProgress?: ProgressFn }
): Promise<KrasLayerSyncResult> {
  const fn =
    step === 'catalog'
      ? refreshKrasLayerCatalog
      : step === 'landinfo'
        ? refreshKrasLandBasic
        : applyOwnGbnToJijuk;
  const label = step === 'catalog' ? '레이어 목록' : step === 'landinfo' ? '토지기본정보' : '소유구분';
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
    void appendLinkageError({
      system: 'KRAS',
      title: label,
      detail: formatLinkageError(e),
    });
    if (/lock busy/i.test(msg)) throw new Error('이미 실행 중입니다.');
    throw e;
  }
}
