/**
 * public_layer.jijuk_land_attr — VWorld 필지정보(토지기본정보·소유) 캐시
 */
import { pool } from '@/database/db';

const SCHEMA = 'public_layer';
const TABLE = 'jijuk_land_attr';
const JIJUK_TABLE = 'jijuk';
const TABLE_SRID = 5181;

type JsonRow = Record<string, unknown>;

export type JijukLandAttrRow = {
  pnu: string;
  jimok: string | null;
  ownship_se: string | null;
  pblntf_pclnd: string | number | null;
  lndpcl_ar: string | number | null;
  prpos_area_main: string | null;
  synced_at: string | Date | null;
};

export type ParcelTabCacheInput = {
  pnu: string;
  characteristics?: JsonRow[];
  landUses?: JsonRow[];
  prices?: JsonRow[];
  possessions?: JsonRow[];
};

let tableEnsured = false;

function escSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function pickField(row: JsonRow | undefined, keys: string[]): string {
  if (!row) return '';
  for (const key of keys) {
    const val = row[key];
    if (val != null && String(val).trim() !== '') return String(val).trim();
  }
  return '';
}

function toNum(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sortLatestCharacteristic(rows: JsonRow[]): JsonRow | undefined {
  if (!rows.length) return undefined;
  return [...rows].sort((a, b) => {
    const yearCmp = toStr(b.stdrYear).localeCompare(toStr(a.stdrYear));
    if (yearCmp !== 0) return yearCmp;
    return toStr(b.stdrMt).localeCompare(toStr(a.stdrMt));
  })[0];
}

function sortLatestPrice(rows: JsonRow[]): JsonRow | undefined {
  if (!rows.length) return undefined;
  return [...rows].sort((a, b) => toStr(b.pblntfDe).localeCompare(toStr(a.pblntfDe)))[0];
}

/** 토지기본정보·소유내역 기준 캐시 행 추출 (LandInfoPanelContent와 동일 필드 우선순위) */
export function extractJijukLandAttrFromParcelData(input: ParcelTabCacheInput) {
  const pnu = toStr(input.pnu);
  if (!/^\d{19}$/.test(pnu)) {
    return { ok: false as const, error: '유효한 PNU(19자리)가 필요합니다.' };
  }

  const characteristics = Array.isArray(input.characteristics) ? input.characteristics : [];
  const landUses = Array.isArray(input.landUses) ? input.landUses : [];
  const prices = Array.isArray(input.prices) ? input.prices : [];
  const possessions = Array.isArray(input.possessions) ? input.possessions : [];

  const latestChar = sortLatestCharacteristic(characteristics);
  const latestPrice = sortLatestPrice(prices);
  const latestPossession = possessions[0];

  const jimok = pickField(latestChar, ['lndcgrCodeNm', 'jimok']);
  const ownshipSe = pickField(latestPossession, ['posesnSeCodeNm']);
  const pblntfPclnd = toNum(latestPrice?.pblntfPclnd);
  const lndpclAr = toNum(latestChar?.lndpclAr ?? latestChar?.area);
  const prposFromChar = pickField(latestChar, ['prposArea1Nm', 'prposAreaDstrcCodeNm']);
  const prposFromUse = pickField(landUses[0], ['prposAreaDstrcCodeNm']);
  const prposAreaMain = prposFromChar || prposFromUse;

  return {
    ok: true as const,
    row: {
      pnu,
      jimok: jimok || null,
      ownshipSe: ownshipSe || null,
      pblntfPclnd,
      lndpclAr,
      prposAreaMain: prposAreaMain || null,
    },
  };
}

/** DB 캐시 행 → 필지정보 패널 ParcelTabData 형식 */
export function parcelTabDataFromCacheRow(row: JijukLandAttrRow) {
  const jimok = toStr(row.jimok);
  const ownshipSe = toStr(row.ownship_se);
  const prposAreaMain = toStr(row.prpos_area_main);
  const lndpclAr = row.lndpcl_ar;
  const pblntfPclnd = row.pblntf_pclnd;

  const characteristics: JsonRow[] = [];
  if (jimok || lndpclAr != null || prposAreaMain) {
    characteristics.push({
      lndcgrCodeNm: jimok || undefined,
      lndpclAr: lndpclAr ?? undefined,
      prposArea1Nm: prposAreaMain || undefined,
    });
  }

  const landUses: JsonRow[] = prposAreaMain
    ? [{ prposAreaDstrcCodeNm: prposAreaMain }]
    : [];

  const prices: JsonRow[] =
    pblntfPclnd != null && String(pblntfPclnd).trim() !== ''
      ? [{ pblntfPclnd }]
      : [];

  const possessions: JsonRow[] = ownshipSe ? [{ posesnSeCodeNm: ownshipSe }] : [];

  return { characteristics, landUses, prices, possessions };
}

function mapDbRow(raw: Record<string, unknown>): JijukLandAttrRow {
  const pblntfRaw = raw.pblntf_pclnd;
  const areaRaw = raw.lndpcl_ar;
  const pblntfPclnd =
    pblntfRaw == null || pblntfRaw === ''
      ? null
      : typeof pblntfRaw === 'number' || typeof pblntfRaw === 'string'
        ? pblntfRaw
        : null;
  const lndpclAr =
    areaRaw == null || areaRaw === ''
      ? null
      : typeof areaRaw === 'number' || typeof areaRaw === 'string'
        ? areaRaw
        : null;
  return {
    pnu: toStr(raw.pnu),
    jimok: toStr(raw.jimok) || null,
    ownship_se: toStr(raw.ownship_se) || null,
    pblntf_pclnd: pblntfPclnd,
    lndpcl_ar: lndpclAr,
    prpos_area_main: toStr(raw.prpos_area_main) || null,
    synced_at: (raw.synced_at as string | Date | null) ?? null,
  };
}

export async function ensureJijukLandAttrTable(): Promise<void> {
  if (tableEnsured) return;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}."${TABLE}" (
      pnu varchar(19) PRIMARY KEY,
      jimok text,
      ownship_se text,
      pblntf_pclnd numeric,
      lndpcl_ar numeric,
      prpos_area_main text,
      geom geometry(Geometry, ${TABLE_SRID}),
      synced_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS jijuk_land_attr_geom_gix
    ON ${SCHEMA}."${TABLE}" USING GIST (geom)
  `);
  await pool.query(`
    COMMENT ON TABLE ${SCHEMA}."${TABLE}" IS '지적토지속성(VWorld 필지정보 캐시)'
  `);
  tableEnsured = true;
}

/** PNU 1건 캐시 조회 */
export async function getJijukLandAttrByPnu(params: { pnu: string }) {
  const pnu = toStr(params.pnu);
  if (!/^\d{19}$/.test(pnu)) return { row: null as JijukLandAttrRow | null };
  await ensureJijukLandAttrTable();
  const escPnu = escSqlLiteral(pnu);
  const res = await pool.query(`
    SELECT pnu, jimok, ownship_se, pblntf_pclnd, lndpcl_ar, prpos_area_main, synced_at
    FROM ${SCHEMA}."${TABLE}"
    WHERE pnu = '${escPnu}'
    LIMIT 1
  `);
  const raw = res.rows?.[0] as Record<string, unknown> | undefined;
  return { row: raw ? mapDbRow(raw) : null };
}

/** PNU 다건 캐시 조회 (지도 bbox용) */
export async function getJijukLandAttrsByPnus(params: { pnus: string[] }) {
  const pnus = [...new Set((params.pnus ?? []).map((p) => toStr(p)).filter((p) => /^\d{19}$/.test(p)))];
  if (!pnus.length) return { rows: {} as Record<string, JijukLandAttrRow> };
  await ensureJijukLandAttrTable();
  const res = await pool.query(
    `
    SELECT pnu, jimok, ownship_se, pblntf_pclnd, lndpcl_ar, prpos_area_main, synced_at
    FROM ${SCHEMA}."${TABLE}"
    WHERE pnu = ANY($1::text[])
    `,
    [pnus]
  );
  const rows: Record<string, JijukLandAttrRow> = {};
  for (const raw of (res.rows ?? []) as Record<string, unknown>[]) {
    const row = mapDbRow(raw);
    if (row.pnu) rows[row.pnu] = row;
  }
  return { rows };
}

/** 필지정보 패널용 — 캐시 hit 시 ParcelTabData 반환 */
export async function getParcelTabDataFromCache(params: { pnu: string }) {
  const { row } = await getJijukLandAttrByPnu(params);
  if (!row) return { hit: false as const };
  const hasData =
    Boolean(row.jimok) ||
    Boolean(row.ownship_se) ||
    Boolean(row.prpos_area_main) ||
    row.pblntf_pclnd != null ||
    row.lndpcl_ar != null;
  if (!hasData) return { hit: false as const };
  return { hit: true as const, syncedAt: row.synced_at, ...parcelTabDataFromCacheRow(row) };
}

/**
 * 필지정보 조회 결과를 jijuk_land_attr에 UPSERT.
 * geom은 public_layer.jijuk에서 pnu로 복사.
 */
export async function upsertJijukLandAttrFromParcelData(input: ParcelTabCacheInput) {
  const extracted = extractJijukLandAttrFromParcelData(input);
  if (!extracted.ok) {
    return { ok: false as const, error: extracted.error };
  }

  await ensureJijukLandAttrTable();

  const { pnu, jimok, ownshipSe, pblntfPclnd, lndpclAr, prposAreaMain } = extracted.row;
  const escPnu = escSqlLiteral(pnu);

  const upsertSql = `
    INSERT INTO ${SCHEMA}."${TABLE}" (
      pnu, jimok, ownship_se, pblntf_pclnd, lndpcl_ar, prpos_area_main, geom, synced_at
    )
    SELECT
      '${escPnu}',
      ${jimok != null ? `'${escSqlLiteral(jimok)}'` : 'NULL'},
      ${ownshipSe != null ? `'${escSqlLiteral(ownshipSe)}'` : 'NULL'},
      ${pblntfPclnd != null ? pblntfPclnd : 'NULL'},
      ${lndpclAr != null ? lndpclAr : 'NULL'},
      ${prposAreaMain != null ? `'${escSqlLiteral(prposAreaMain)}'` : 'NULL'},
      j."geom",
      now()
    FROM ${SCHEMA}."${JIJUK_TABLE}" j
    WHERE j."pnu" = '${escPnu}'
    LIMIT 1
    ON CONFLICT (pnu) DO UPDATE SET
      jimok = EXCLUDED.jimok,
      ownship_se = EXCLUDED.ownship_se,
      pblntf_pclnd = EXCLUDED.pblntf_pclnd,
      lndpcl_ar = EXCLUDED.lndpcl_ar,
      prpos_area_main = EXCLUDED.prpos_area_main,
      geom = COALESCE(EXCLUDED.geom, ${SCHEMA}."${TABLE}".geom),
      synced_at = now()
  `;

  try {
    const res = await pool.query(upsertSql);
    const rowCount = res.rowCount ?? 0;
    if (rowCount === 0) {
      // jijuk에 geom 없을 때 텍스트 속성만 저장
      const fallbackSql = `
        INSERT INTO ${SCHEMA}."${TABLE}" (
          pnu, jimok, ownship_se, pblntf_pclnd, lndpcl_ar, prpos_area_main, synced_at
        ) VALUES (
          '${escPnu}',
          ${jimok != null ? `'${escSqlLiteral(jimok)}'` : 'NULL'},
          ${ownshipSe != null ? `'${escSqlLiteral(ownshipSe)}'` : 'NULL'},
          ${pblntfPclnd != null ? pblntfPclnd : 'NULL'},
          ${lndpclAr != null ? lndpclAr : 'NULL'},
          ${prposAreaMain != null ? `'${escSqlLiteral(prposAreaMain)}'` : 'NULL'},
          now()
        )
        ON CONFLICT (pnu) DO UPDATE SET
          jimok = EXCLUDED.jimok,
          ownship_se = EXCLUDED.ownship_se,
          pblntf_pclnd = EXCLUDED.pblntf_pclnd,
          lndpcl_ar = EXCLUDED.lndpcl_ar,
          prpos_area_main = EXCLUDED.prpos_area_main,
          synced_at = now()
      `;
      await pool.query(fallbackSql);
    }
    return { ok: true as const, pnu, rowCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false as const, error: message };
  }
}

/** 공시지가 등 일부 필드만 캐시에 병합 저장 (지도 레이어 VWorld 조회 후) */
export async function mergeJijukLandAttrSummary(params: {
  pnu: string;
  pblntfPclnd?: number | null;
  jimok?: string | null;
  ownshipSe?: string | null;
  lndpclAr?: number | null;
  prposAreaMain?: string | null;
}) {
  const pnu = toStr(params.pnu);
  if (!/^\d{19}$/.test(pnu)) {
    return { ok: false as const, error: '유효한 PNU(19자리)가 필요합니다.' };
  }
  await ensureJijukLandAttrTable();
  const escPnu = escSqlLiteral(pnu);
  const pblntf = params.pblntfPclnd != null && Number.isFinite(params.pblntfPclnd) ? params.pblntfPclnd : null;
  const lndpclAr = params.lndpclAr != null && Number.isFinite(params.lndpclAr) ? params.lndpclAr : null;
  const jimok = toStr(params.jimok) || null;
  const ownshipSe = toStr(params.ownshipSe) || null;
  const prposAreaMain = toStr(params.prposAreaMain) || null;

  const upsertSql = `
    INSERT INTO ${SCHEMA}."${TABLE}" (
      pnu, jimok, ownship_se, pblntf_pclnd, lndpcl_ar, prpos_area_main, geom, synced_at
    )
    SELECT
      '${escPnu}',
      ${jimok != null ? `'${escSqlLiteral(jimok)}'` : 'NULL'},
      ${ownshipSe != null ? `'${escSqlLiteral(ownshipSe)}'` : 'NULL'},
      ${pblntf != null ? pblntf : 'NULL'},
      ${lndpclAr != null ? lndpclAr : 'NULL'},
      ${prposAreaMain != null ? `'${escSqlLiteral(prposAreaMain)}'` : 'NULL'},
      j."geom",
      now()
    FROM ${SCHEMA}."${JIJUK_TABLE}" j
    WHERE j."pnu" = '${escPnu}'
    LIMIT 1
    ON CONFLICT (pnu) DO UPDATE SET
      jimok = COALESCE(EXCLUDED.jimok, ${SCHEMA}."${TABLE}".jimok),
      ownship_se = COALESCE(EXCLUDED.ownship_se, ${SCHEMA}."${TABLE}".ownship_se),
      pblntf_pclnd = COALESCE(EXCLUDED.pblntf_pclnd, ${SCHEMA}."${TABLE}".pblntf_pclnd),
      lndpcl_ar = COALESCE(EXCLUDED.lndpcl_ar, ${SCHEMA}."${TABLE}".lndpcl_ar),
      prpos_area_main = COALESCE(EXCLUDED.prpos_area_main, ${SCHEMA}."${TABLE}".prpos_area_main),
      geom = COALESCE(EXCLUDED.geom, ${SCHEMA}."${TABLE}".geom),
      synced_at = now()
  `;

  try {
    const res = await pool.query(upsertSql);
    if ((res.rowCount ?? 0) === 0 && (pblntf != null || jimok || ownshipSe || lndpclAr != null || prposAreaMain)) {
      await pool.query(`
        INSERT INTO ${SCHEMA}."${TABLE}" (pnu, jimok, ownship_se, pblntf_pclnd, lndpcl_ar, prpos_area_main, synced_at)
        VALUES (
          '${escPnu}',
          ${jimok != null ? `'${escSqlLiteral(jimok)}'` : 'NULL'},
          ${ownshipSe != null ? `'${escSqlLiteral(ownshipSe)}'` : 'NULL'},
          ${pblntf != null ? pblntf : 'NULL'},
          ${lndpclAr != null ? lndpclAr : 'NULL'},
          ${prposAreaMain != null ? `'${escSqlLiteral(prposAreaMain)}'` : 'NULL'},
          now()
        )
        ON CONFLICT (pnu) DO UPDATE SET
          jimok = COALESCE(EXCLUDED.jimok, ${SCHEMA}."${TABLE}".jimok),
          ownship_se = COALESCE(EXCLUDED.ownship_se, ${SCHEMA}."${TABLE}".ownship_se),
          pblntf_pclnd = COALESCE(EXCLUDED.pblntf_pclnd, ${SCHEMA}."${TABLE}".pblntf_pclnd),
          lndpcl_ar = COALESCE(EXCLUDED.lndpcl_ar, ${SCHEMA}."${TABLE}".lndpcl_ar),
          prpos_area_main = COALESCE(EXCLUDED.prpos_area_main, ${SCHEMA}."${TABLE}".prpos_area_main),
          synced_at = now()
      `);
    }
    return { ok: true as const, pnu };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false as const, error: message };
  }
}
