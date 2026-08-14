/**
 * 세움터 적재 DB — 건축물대장(표제) · 건축/주택 인허가
 * 스키마/테이블 없으면 빈 결과 → 호출측에서 포털 2차.
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

/** 포털·UI 공통 키로 정규화 (snake_case 원본 유지 + camelCase 별칭) */
export function normalizeSeumPermitRow(row: Record<string, string>): Record<string, string> {
  return {
    ...row,
    bldNm: row.bld_nm || row.bldNm || '',
    mainPurpsCdNm: row.main_prpos_cd_nm || row.mainPurpsCdNm || row.prpos_cd_nm || row.purpsCdNm || '',
    purpsCdNm: row.prpos_cd_nm || row.purpsCdNm || '',
    archGbCdNm: row.arch_gb_cd_nm || row.archGbCdNm || row.hs_biz_gb_cd_nm || '',
    archPmsDay: row.arch_pms_date || row.archPmsDay || row.apprv_date || row.apprvDay || '',
    apprvDay: row.apprv_date || row.apprvDay || '',
    realStcnsDay: row.real_stcns_date || row.realStcnsDay || row.stcns_date || row.stcnsDay || '',
    stcnsDay: row.stcns_date || row.stcnsDay || row.stcns_prrng_date || '',
    stcnsPrrngDay: row.stcns_prrng_date || row.stcnsPrrngDay || '',
    useAprDay: row.useapr_date || row.useAprDay || '',
    useInsptDay: row.use_inspt_date || row.useInsptDay || '',
    platArea: row.plat_area || row.platArea || '',
    archArea: row.arch_area || row.archArea || '',
    totArea: row.totarea || row.totArea || '',
    bcRat: row.bcrat || row.bcRat || '',
    vlRat: row.vlrat || row.vlRat || '',
    vlRatCalcTotArea: row.vlrat_calc_totarea || row.vlRatCalcTotArea || '',
    hhldCnt: row.hhldcnt || row.hhldCnt || row.tot_hhldcnt || row.totHhldCnt || '',
    totHhldCnt: row.tot_hhldcnt || row.totHhldCnt || '',
    hoCnt: row.ho_cnt || row.hoCnt || row.tot_ho_cnt || '',
    fmlyCnt: row.fmly_cnt || row.fmlyCnt || row.tot_fmly_cnt || '',
    mainBildCnt: row.main_bild_cnt || row.mainBildCnt || '',
    pmsCanclYn: row.pms_cancl_yn || row.pmsCanclYn || '',
    pmsCanclDate: row.pms_cancl_date || row.pmsCanclDate || row.apprv_cancl_date || '',
    canclResn: row.cancl_resn || row.canclResn || row.apprv_cancl_resn || '',
    sigunguCdNm: row.sigungu_cd_nm || row.sigunguCdNm || '',
    bjdongCdNm: row.bjdong_cd_nm || row.bjdongCdNm || '',
    mnnm: row.mnnm || '',
    slno: row.slno || '',
    exuseArea: row.exuse_area || row.exuseArea || '',
    blockNo: row.block_no || row.blockNo || '',
    lotNo: row.lot_no || row.lotNo || '',
    stcnsDelayDate: row.stcns_delay_date || row.stcnsDelayDate || '',
  };
}

// —— 우클릭 필지정보 전용 건축물대장 상세 (v6 selectRecap / BldAndTitle / Floor) ——
/** 필지분석용 SEUM_SQL(축약)과 분리 — 총괄·표제·층까지 */

const LAND_INFO_SEUM_TIMEOUT_MS = 12_000;

const FLOOR_TABLE_BY_TYPE: Record<string, string> = {
  표제부: 'djr_title_djr_flr_ouln',
  일반건축물: 'djr_bld_djr_flr_ouln',
};

function isSafeSeumIdent(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

/** PG 스칼라 → 맵에 넣을 값. 빈 값은 생략(v6 MyBatis: null로 덮지 않음) */
function assignIfPresent(out: Record<string, unknown>, key: string, v: unknown): void {
  if (v == null) return;
  if (key === 'jijigu_list') {
    const list = Array.isArray(v)
      ? v.map((x) => toStr(x)).filter(Boolean)
      : toStr(v)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    if (list.length) out.jijigu_list = list;
    return;
  }
  if (Array.isArray(v)) {
    const text = v.map((x) => toStr(x)).filter(Boolean).join(', ');
    if (text) out[key] = text;
    return;
  }
  if (typeof v === 'object' && !(v instanceof Date)) {
    return;
  }
  const text = toStr(v);
  if (text) out[key] = text;
}

function mergeSeumParts(
  first: Record<string, unknown> | null | undefined,
  second: Record<string, unknown> | null | undefined,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const src of [first, second, extra]) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      assignIfPresent(out, k, v);
    }
  }
  return out;
}

function parseJsonCol(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

/** 대장 목록·동현황 행 */
function rowToLandInfoMap(row: Record<string, unknown>): Record<string, unknown> {
  if (row.bld_row != null || row.title_row != null) {
    return mergeSeumParts(parseJsonCol(row.bld_row), parseJsonCol(row.title_row), {
      jijigu_list: row.jijigu_list,
      type: row.type,
    });
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    assignIfPresent(out, k, v);
  }
  return out;
}

async function queryRecapBuildings(pnu: string): Promise<Record<string, unknown>[]> {
  const res = await pool.query<Record<string, unknown>>(
    `
    SELECT t.*, b.pnu, (
      SELECT array_agg(DISTINCT j.jijigu_cd_nm)
      FROM seum.djr_recap_djr_jijigu j
      WHERE j.bldrgst_seqno = b.bldrgst_seqno
        AND trim(COALESCE(j.jijigu_cd_nm, '')) != ''
    ) AS jijigu_list,
    '총괄표제부'::text AS type
    FROM seum.djr_recap_djr_bldrgst b
    JOIN seum.djr_recap_djr_recap_title t ON b.bldrgst_seqno = t.bldrgst_seqno
    WHERE b.pnu = $1
    ORDER BY t.bld_nm DESC NULLS LAST
    `,
    [pnu]
  );
  return res.rows.map(rowToLandInfoMap);
}

async function queryDongCurstList(pnu: string): Promise<Record<string, unknown>[]> {
  const res = await pool.query<Record<string, unknown>>(
    `
    WITH base AS (
      SELECT '동'::text AS type, d.bld_nm, d.main_prpos_cd_nm, d.main_strct_cd_nm, d.totarea::text AS totarea
      FROM seum.djr_recap_djr_dong_curst d
      JOIN seum.djr_recap_djr_bldrgst b ON d.bldrgst_seqno = b.bldrgst_seqno
      WHERE b.pnu = $1

      UNION ALL

      SELECT '표제'::text, t.dong_nm, t.main_prpos_cd_nm, t.strct_cd_nm, t.totarea::text
      FROM seum.djr_title_djr_title t
      JOIN seum.djr_title_djr_bldrgst b ON t.bldrgst_seqno = b.bldrgst_seqno
      WHERE b.pnu = $1

      UNION ALL

      SELECT '일반'::text, t.dong_nm, t.main_prpos_cd_nm, t.strct_cd_nm, t.totarea::text
      FROM seum.djr_bld_djr_title t
      JOIN seum.djr_bld_djr_bldrgst b ON t.bldrgst_seqno = b.bldrgst_seqno
      WHERE b.pnu = $1
    )
    SELECT MAX(type) AS type, bld_nm,
           MAX(main_prpos_cd_nm) AS main_prpos_cd_nm,
           MAX(main_strct_cd_nm) AS main_strct_cd_nm,
           MAX(totarea) AS totarea
    FROM base
    GROUP BY bld_nm
    ORDER BY type DESC, bld_nm
    `,
    [pnu]
  );
  return res.rows.map(rowToLandInfoMap);
}

async function queryBldAndTitleBuildings(
  pnu: string,
  dongNm?: string | null
): Promise<Record<string, unknown>[]> {
  const params: string[] = [pnu];
  let bldFilter = '';
  if (dongNm !== undefined && dongNm !== null) {
    params.push(dongNm);
    bldFilter = `AND COALESCE(t.dong_nm, '') = $${params.length}`;
  }
  const res = await pool.query<Record<string, unknown>>(
    `
    SELECT * FROM (
      SELECT
        t.*,
        b.pnu,
        (
          SELECT array_agg(DISTINCT j.jijigu_cd_nm)
          FROM seum.djr_bld_djr_jijigu j
          WHERE j.bldrgst_seqno = b.bldrgst_seqno
            AND trim(COALESCE(j.jijigu_cd_nm, '')) != ''
        ) AS jijigu_list,
        '일반건축물'::text AS type
      FROM seum.djr_bld_djr_bldrgst b
      JOIN seum.djr_bld_djr_title t ON b.bldrgst_seqno = t.bldrgst_seqno
      WHERE b.pnu = $1
      ${bldFilter}

      UNION ALL

      SELECT
        t.*,
        b.pnu,
        (
          SELECT array_agg(DISTINCT j.jijigu_cd_nm)
          FROM seum.djr_title_djr_jijigu j
          WHERE j.bldrgst_seqno = b.bldrgst_seqno
            AND trim(COALESCE(j.jijigu_cd_nm, '')) != ''
        ) AS jijigu_list,
        '표제부'::text AS type
      FROM seum.djr_title_djr_bldrgst b
      JOIN seum.djr_title_djr_title t ON b.bldrgst_seqno = t.bldrgst_seqno
      WHERE b.pnu = $1
      ${bldFilter}
    ) s
    ORDER BY bld_nm NULLS LAST, dong_nm NULLS LAST
    `,
    params
  );
  return res.rows.map(rowToLandInfoMap);
}

async function queryFloorListByType(
  type: string,
  seqNo: string
): Promise<Record<string, unknown>[]> {
  const table = FLOOR_TABLE_BY_TYPE[type];
  if (!table || !isSafeSeumIdent(table) || !seqNo) return [];
  const res = await pool.query<Record<string, unknown>>(
    `
    SELECT *
    FROM seum."${table}"
    WHERE bldrgst_seqno = $1
    ORDER BY
      CASE
        WHEN flrno_nm ~ '^[0-9]+' THEN CAST(REGEXP_REPLACE(flrno_nm, '[^0-9]', '', 'g') AS INTEGER)
      END NULLS LAST,
      flrno_nm
    `,
    [seqNo]
  );
  return res.rows.map(rowToLandInfoMap);
}

export type SeumBuildingRegisterMode = 'recap' | 'title' | null;

/** 우클릭 — 총괄표제 우선, 없으면 일반·표제 (+ 동현황 또는 층) */
export async function fetchSeumBuildingRegisterForLandInfo(params: {
  pnu?: string;
}): Promise<{
  ok: boolean;
  mode: SeumBuildingRegisterMode;
  buildings: Record<string, unknown>[];
  children: Record<string, unknown>[];
}> {
  const pnu = toStr(params.pnu);
  if (!/^\d{19}$/.test(pnu)) return { ok: true, mode: null, buildings: [], children: [] };
  if (!getLandLinkageConfig().useSeum) return { ok: true, mode: null, buildings: [], children: [] };

  try {
    const raced = await Promise.race([
      (async () => {
        const recap = await queryRecapBuildings(pnu);
        if (recap.length) {
          let children: Record<string, unknown>[] = [];
          try {
            children = await queryDongCurstList(pnu);
          } catch {
            children = [];
          }
          return { ok: true as const, mode: 'recap' as const, buildings: recap, children };
        }

        const titles = await queryBldAndTitleBuildings(pnu);
        if (titles.length) {
          const first = titles[0]!;
          const type = toStr(first.type);
          const seq = toStr(first.bldrgst_seqno);
          const children = seq ? await queryFloorListByType(type, seq) : [];
          return { ok: true as const, mode: 'title' as const, buildings: titles, children };
        }

        return {
          ok: true as const,
          mode: null,
          buildings: [] as Record<string, unknown>[],
          children: [] as Record<string, unknown>[],
        };
      })(),
      delay(LAND_INFO_SEUM_TIMEOUT_MS).then(() => 'timeout' as const),
    ]);

    if (raced === 'timeout') {
      return { ok: false, mode: null, buildings: [], children: [] };
    }
    return raced;
  } catch (e) {
    console.error('[seum·건축물대장]', e instanceof Error ? e.message : e);
    return { ok: false, mode: null, buildings: [], children: [] };
  }
}

/** 우클릭 — 동명으로 일반·표제 재조회 (총괄 하위 «조회») */
export async function fetchSeumBuildingRegisterByDong(params: {
  pnu?: string;
  bldNm?: string;
}): Promise<{
  ok: boolean;
  buildings: Record<string, unknown>[];
  children: Record<string, unknown>[];
}> {
  const pnu = toStr(params.pnu);
  const bldNm = params.bldNm == null ? '' : toStr(params.bldNm);
  if (!/^\d{19}$/.test(pnu)) return { ok: true, buildings: [], children: [] };
  if (!getLandLinkageConfig().useSeum) return { ok: true, buildings: [], children: [] };

  try {
    const buildings = await queryBldAndTitleBuildings(pnu, bldNm);
    if (!buildings.length) return { ok: true, buildings: [], children: [] };
    const first = buildings[0]!;
    const children = await queryFloorListByType(toStr(first.type), toStr(first.bldrgst_seqno));
    return { ok: true, buildings, children };
  } catch {
    return { ok: false, buildings: [], children: [] };
  }
}

/** 우클릭 — 선택 건물 층별 현황 */
export async function fetchSeumBuildingFloorList(params: {
  type?: string;
  seqNo?: string;
}): Promise<{ ok: boolean; children: Record<string, unknown>[] }> {
  const type = toStr(params.type);
  const seqNo = toStr(params.seqNo);
  if (!type || !seqNo) return { ok: true, children: [] };
  if (!getLandLinkageConfig().useSeum) return { ok: true, children: [] };

  try {
    const children = await queryFloorListByType(type, seqNo);
    return { ok: true, children };
  } catch {
    return { ok: false, children: [] };
  }
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
      SELECT p.*, l.sigungu_cd_nm, l.bjdong_cd_nm, l.mnnm, l.slno
      FROM seum."${plat}" l
      JOIN seum."${rgst}" p ON l."${seqCol}" = p."${seqCol}"
      WHERE p.pnu = $1
    `);
  }
  if (!parts.length) return [];

  const orderBy =
    rgstSuffix === 'pmsrgst'
      ? `COALESCE(u.pmsrgst_gb_cd_nm, ''), COALESCE(u.bld_nm, '') DESC`
      : `COALESCE(u.pmsno_gb_cd_nm, ''), COALESCE(u.bld_nm, '') DESC`;

  const sql = `
    SELECT * FROM (
      ${parts.join(' UNION ALL ')}
    ) u
    ORDER BY ${orderBy}
  `;

  const res = await pool.query<Record<string, unknown>>(sql, [pnu]);
  return res.rows.map(rowToLandInfoMap);
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
  } catch (e) {
    console.error('[seum·건축인허가]', e instanceof Error ? e.message : e);
    return { ok: false, kind: null, rows: [] };
  }
}
