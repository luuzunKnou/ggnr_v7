/**
 * public_layer.jijuk_building_ledger — 건축물대장(표제부) 조회 캐시
 */
import { pool } from '@/database/db';

const SCHEMA = 'public_layer';
const TABLE = 'jijuk_building_ledger';

export type BuildingLedgerCacheRow = {
  pnu: string;
  addr: string;
  bldNm: string;
  platLoc: string;
  jibun: string;
  roadAddr: string;
  bcRat: string;
  vlRat: string;
  jijigu: string;
  platArea: string;
  totArea: string;
};

let tableEnsured = false;

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function mapRow(raw: Record<string, unknown>): BuildingLedgerCacheRow | null {
  const pnu = toStr(raw.pnu);
  if (!/^\d{19}$/.test(pnu)) return null;
  const hasBuilding = raw.has_building === true || raw.has_building === 't';
  if (!hasBuilding) return null;
  return {
    pnu,
    addr: toStr(raw.addr) || '-',
    bldNm: toStr(raw.bld_nm) || '-',
    platLoc: toStr(raw.plat_loc) || '-',
    jibun: toStr(raw.jibun) || '-',
    roadAddr: toStr(raw.road_addr) || '-',
    bcRat: toStr(raw.bc_rat) || '-',
    vlRat: toStr(raw.vl_rat) || '-',
    jijigu: toStr(raw.jijigu) || '-',
    platArea: toStr(raw.plat_area) || '-',
    totArea: toStr(raw.tot_area) || '-',
  };
}

export async function ensureBuildingLedgerCacheTable(): Promise<void> {
  if (tableEnsured) return;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}."${TABLE}" (
      pnu varchar(19) PRIMARY KEY,
      has_building boolean NOT NULL DEFAULT false,
      addr text,
      bld_nm text,
      plat_loc text,
      jibun text,
      road_addr text,
      bc_rat text,
      vl_rat text,
      jijigu text,
      plat_area text,
      tot_area text,
      synced_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    COMMENT ON TABLE ${SCHEMA}."${TABLE}" IS '건축물대장 표제부 캐시(공공데이터포털)'
  `);
  tableEnsured = true;
}

export async function getBuildingLedgersFromCache(pnus: string[]): Promise<{
  cachedPnus: Set<string>;
  rows: BuildingLedgerCacheRow[];
}> {
  const unique = [...new Set(pnus.map((p) => toStr(p)).filter((p) => /^\d{19}$/.test(p)))];
  if (!unique.length) return { cachedPnus: new Set(), rows: [] };

  await ensureBuildingLedgerCacheTable();
  const res = await pool.query(
    `
    SELECT pnu, has_building, addr, bld_nm, plat_loc, jibun, road_addr,
           bc_rat, vl_rat, jijigu, plat_area, tot_area
    FROM ${SCHEMA}."${TABLE}"
    WHERE pnu = ANY($1::text[])
    `,
    [unique]
  );

  const cachedPnus = new Set<string>();
  const rows: BuildingLedgerCacheRow[] = [];
  for (const raw of (res.rows ?? []) as Record<string, unknown>[]) {
    const pnu = toStr(raw.pnu);
    if (!pnu) continue;
    cachedPnus.add(pnu);
    const row = mapRow(raw);
    if (row) rows.push(row);
  }
  return { cachedPnus, rows };
}

function escSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export async function upsertBuildingLedgerCache(
  entries: Array<{ pnu: string; row: BuildingLedgerCacheRow | null; addr?: string }>
): Promise<void> {
  const valid = entries.filter((e) => /^\d{19}$/.test(toStr(e.pnu)));
  if (!valid.length) return;

  await ensureBuildingLedgerCacheTable();

  for (const entry of valid) {
    const pnu = toStr(entry.pnu);
    const escPnu = escSqlLiteral(pnu);
    const row = entry.row;
    const hasBuilding = row != null;
    const addr = escSqlLiteral(row?.addr || entry.addr || pnu);

    if (!hasBuilding) {
      await pool.query(`
        INSERT INTO ${SCHEMA}."${TABLE}" (pnu, has_building, synced_at)
        VALUES ('${escPnu}', false, now())
        ON CONFLICT (pnu) DO UPDATE SET
          has_building = false,
          addr = NULL, bld_nm = NULL, plat_loc = NULL, jibun = NULL,
          road_addr = NULL, bc_rat = NULL, vl_rat = NULL, jijigu = NULL,
          plat_area = NULL, tot_area = NULL,
          synced_at = now()
      `);
      continue;
    }

    await pool.query(`
      INSERT INTO ${SCHEMA}."${TABLE}" (
        pnu, has_building, addr, bld_nm, plat_loc, jibun, road_addr,
        bc_rat, vl_rat, jijigu, plat_area, tot_area, synced_at
      ) VALUES (
        '${escPnu}', true,
        '${addr}',
        '${escSqlLiteral(row.bldNm)}',
        '${escSqlLiteral(row.platLoc)}',
        '${escSqlLiteral(row.jibun)}',
        '${escSqlLiteral(row.roadAddr)}',
        '${escSqlLiteral(row.bcRat)}',
        '${escSqlLiteral(row.vlRat)}',
        '${escSqlLiteral(row.jijigu)}',
        '${escSqlLiteral(row.platArea)}',
        '${escSqlLiteral(row.totArea)}',
        now()
      )
      ON CONFLICT (pnu) DO UPDATE SET
        has_building = true,
        addr = EXCLUDED.addr,
        bld_nm = EXCLUDED.bld_nm,
        plat_loc = EXCLUDED.plat_loc,
        jibun = EXCLUDED.jibun,
        road_addr = EXCLUDED.road_addr,
        bc_rat = EXCLUDED.bc_rat,
        vl_rat = EXCLUDED.vl_rat,
        jijigu = EXCLUDED.jijigu,
        plat_area = EXCLUDED.plat_area,
        tot_area = EXCLUDED.tot_area,
        synced_at = now()
    `);
  }
}
