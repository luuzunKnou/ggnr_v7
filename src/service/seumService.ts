/**
 * 세움터 적재 DB — 건축물대장(표제) · 건축/주택 인허가
 * 스키마/테이블 없으면 null·빈 배열 (포털 폴백).
 */
import type { PoolClient } from 'pg';
import { pool } from '@/database/db';
import {
  normalizeBuildingLedgerRow,
  type BuildingLedgerDisplayRow,
  type BuildingLedgerRawRow,
} from '@/lib/buildingLedgerFetch';
import { getLandLinkageConfig } from '@/service/configService';

// —— 건축물대장 ——

/** 세움 단건 한계 — 초과 시 null, 포털로 넘김 */
const SEUM_QUERY_TIMEOUT_MS = 2_500;
/** 배치 전체 한계 — 초과 시 미조회분은 포털 */
const SEUM_BATCH_TIMEOUT_MS = 8_000;

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function rowToRaw(row: Record<string, unknown>): BuildingLedgerRawRow {
  const out: BuildingLedgerRawRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const text = Array.isArray(v) ? v.map((x) => toStr(x)).filter(Boolean).join(', ') : toStr(v);
    if (text) out[k] = text;
  }
  return out;
}

function delay(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), ms));
}

const SEUM_SQL = `
    SELECT *
    FROM (
      SELECT
        b.pnu::text AS pnu,
        COALESCE(NULLIF(TRIM(t.bld_nm), ''), NULLIF(TRIM(t.dong_nm), ''), '') AS bld_nm,
        COALESCE(NULLIF(TRIM(t.dong_nm), ''), '') AS dong_nm,
        COALESCE(t.totarea::text, '') AS totarea,
        COALESCE(t.plat_area::text, '') AS plat_area,
        COALESCE(t.bcrat::text, '') AS bcrat,
        COALESCE(t.vlrat::text, '') AS vlrat,
        COALESCE(NULLIF(TRIM(t.main_prpos_cd_nm), ''), '') AS jijigu_nm
      FROM seum.djr_bld_djr_bldrgst b
      JOIN seum.djr_bld_djr_title t ON b.bldrgst_seqno = t.bldrgst_seqno
      WHERE b.pnu = $1

      UNION ALL

      SELECT
        b.pnu::text AS pnu,
        COALESCE(NULLIF(TRIM(t.bld_nm), ''), NULLIF(TRIM(t.dong_nm), ''), '') AS bld_nm,
        COALESCE(NULLIF(TRIM(t.dong_nm), ''), '') AS dong_nm,
        COALESCE(t.totarea::text, '') AS totarea,
        COALESCE(t.plat_area::text, '') AS plat_area,
        COALESCE(t.bcrat::text, '') AS bcrat,
        COALESCE(t.vlrat::text, '') AS vlrat,
        COALESCE(NULLIF(TRIM(t.main_prpos_cd_nm), ''), '') AS jijigu_nm
      FROM seum.djr_title_djr_bldrgst b
      JOIN seum.djr_title_djr_title t ON b.bldrgst_seqno = t.bldrgst_seqno
      WHERE b.pnu = $1
    ) s
    LIMIT 1
  `;

/** PNU 1건 — 일반건축물·표제부 중 1행 (v6 selectBldAndTitleData 축약) */
export async function fetchSeumBuildingLedgerByPnu(
  pnu: string,
  jibunHint?: string
): Promise<BuildingLedgerDisplayRow | null> {
  if (!/^\d{19}$/.test(pnu)) return null;

  let client: PoolClient | null = null;
  try {
    const connected = await Promise.race([
      pool.connect() as Promise<PoolClient>,
      delay(SEUM_QUERY_TIMEOUT_MS),
    ]);
    if (connected === 'timeout' || !connected) return null;
    client = connected;

    await client.query(`SET statement_timeout TO ${SEUM_QUERY_TIMEOUT_MS}`);
    try {
      const res = await client.query<Record<string, unknown>>(SEUM_SQL, [pnu]);
      const row = res.rows[0];
      if (!row) return null;
      const raw = rowToRaw(row);
      const normalized = normalizeBuildingLedgerRow(pnu, jibunHint?.trim() || '', raw);
      const hasData = [normalized.bldNm, normalized.totArea, normalized.platArea].some(
        (v) => v && v !== '-'
      );
      return hasData ? normalized : null;
    } finally {
      await client.query('SET statement_timeout TO 0').catch(() => undefined);
    }
  } catch {
    return null;
  } finally {
    client?.release();
  }
}

export async function fetchSeumBuildingLedgersByPnus(
  parcels: Array<{ pnu: string; jibun: string }>
): Promise<Map<string, BuildingLedgerDisplayRow>> {
  const out = new Map<string, BuildingLedgerDisplayRow>();
  if (!parcels.length) return out;

  const concurrency = Math.min(4, Math.max(1, parcels.length));
  let index = 0;
  let abort = false;

  async function worker() {
    while (!abort && index < parcels.length) {
      const i = index++;
      const p = parcels[i];
      if (!p) continue;
      const row = await fetchSeumBuildingLedgerByPnu(p.pnu, p.jibun);
      if (row) out.set(p.pnu, row);
    }
  }

  const workers = Promise.all(Array.from({ length: concurrency }, () => worker()));
  const raced = await Promise.race([
    workers.then(() => 'done' as const),
    delay(SEUM_BATCH_TIMEOUT_MS),
  ]);
  if (raced === 'timeout') abort = true;
  await workers;
  return out;
}

// —— 건축·주택 인허가 ——

export type SeumPermitKind = 'arch' | 'housing';

function isSafeSeumTable(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

function rowToStrings(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const text = toStr(v);
    if (text) out[k] = text;
  }
  return out;
}

/** 포털·UI 공통 키로 정규화 */
export function normalizeSeumPermitRow(row: Record<string, string>): Record<string, string> {
  return {
    ...row,
    mainPurpsCdNm: row.main_prpos_cd_nm || row.mainPurpsCdNm || row.prpos_cd_nm || row.purpsCdNm || '',
    purpsCdNm: row.prpos_cd_nm || row.purpsCdNm || '',
    archPmsDay: row.arch_pms_date || row.archPmsDay || row.apprv_date || row.apprvDay || '',
    apprvDay: row.apprv_date || row.apprvDay || '',
    realStcnsDay: row.real_stcns_date || row.realStcnsDay || row.stcns_date || row.stcnsDay || '',
    stcnsDay: row.stcns_date || row.stcnsDay || row.stcns_prrng_date || '',
    useAprDay: row.useapr_date || row.useAprDay || '',
    useInsptDay: row.use_inspt_date || row.useInsptDay || '',
    totArea: row.totarea || row.totArea || '',
    hhldCnt: row.hhldcnt || row.hhldCnt || row.tot_hhldcnt || row.totHhldCnt || '',
    totHhldCnt: row.tot_hhldcnt || row.totHhldCnt || '',
  };
}

async function listPlatLcTables(prefix: 'kcr' | 'jtr'): Promise<string[]> {
  const res = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'seum' AND tablename LIKE $1 ORDER BY tablename`,
    [`${prefix}_%plat_lc`]
  );
  return res.rows.map((r) => r.tablename).filter(isSafeSeumTable);
}

async function queryPermitUnion(
  pnu: string,
  platTables: string[],
  rgstSuffix: 'pmsrgst' | 'hsrgst'
): Promise<Record<string, unknown>[]> {
  if (!platTables.length) return [];

  const parts: string[] = [];
  const seqCol = `${rgstSuffix}_seqno`;

  for (const plat of platTables) {
    const rgst = plat.replace('plat_lc', rgstSuffix);
    if (!isSafeSeumTable(rgst)) continue;
    parts.push(`
      SELECT l.*, p.*
      FROM seum."${plat}" l
      JOIN seum."${rgst}" p ON l."${seqCol}" = p."${seqCol}"
      WHERE p.pnu = $1
    `);
  }
  if (!parts.length) return [];

  const orderBy =
    rgstSuffix === 'pmsrgst'
      ? `COALESCE(u.pmsrgst_gb_cd_nm, '') DESC, COALESCE(u.bld_nm, '') DESC`
      : `COALESCE(u.pmsno_gb_cd_nm, '') DESC, COALESCE(u.bld_nm, '') DESC`;

  const sql = `
    SELECT * FROM (
      ${parts.join(' UNION ALL ')}
    ) u
    ORDER BY ${orderBy}
  `;

  const res = await pool.query<Record<string, unknown>>(sql, [pnu]);
  return res.rows;
}

/** PNU 1건 — 건축인허가(kcr) 우선, 없으면 주택인허가(jtr) */
export async function fetchSeumPermitRowsByPnu(params: {
  pnu?: string;
}): Promise<{ ok: boolean; kind: SeumPermitKind | null; rows: Record<string, string>[] }> {
  const pnu = toStr(params.pnu);
  if (!/^\d{19}$/.test(pnu)) return { ok: true, kind: null, rows: [] };
  if (!getLandLinkageConfig().useSeum) return { ok: true, kind: null, rows: [] };

  try {
    const archTables = await listPlatLcTables('kcr');
    let raw = await queryPermitUnion(pnu, archTables, 'pmsrgst');
    if (raw.length) {
      return {
        ok: true,
        kind: 'arch',
        rows: raw.map((r) => normalizeSeumPermitRow(rowToStrings(r))),
      };
    }

    const housingTables = await listPlatLcTables('jtr');
    raw = await queryPermitUnion(pnu, housingTables, 'hsrgst');
    if (raw.length) {
      return {
        ok: true,
        kind: 'housing',
        rows: raw.map((r) => normalizeSeumPermitRow(rowToStrings(r))),
      };
    }

    return { ok: true, kind: null, rows: [] };
  } catch {
    return { ok: false, kind: null, rows: [] };
  }
}
