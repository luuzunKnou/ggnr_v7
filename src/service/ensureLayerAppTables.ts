/**
 * 서버 기동 시 앱 필수 layer 테이블 확보 (없으면 생성, public에만 있으면 layer로 이동).
 * - 추가속성 정의: public.layer_extra_def
 * - 도로점용: road_use_ledger, road_use_ledger_jijuk
 * - 공통점용: water|road|public_occupationledger(+_jijuk|_mgj) — 9개
 * - 점사용료: water|road|public_ngl_fee_list — 3개
 * - 메모: memo 및 memo_* 계열
 * - 영상: work_unit, file_unit
 */
import { db } from '@/database/db';
import { sql } from 'drizzle-orm';
import { MEMO_TABLES } from '@/lib/memoConfig';

type EnsureResult = {
  created: string[];
  moved: string[];
  existed: string[];
  errors: string[];
};

const OCCUPATION_PREFIXES = ['water', 'road', 'public'] as const;

async function tableExists(schema: string, table: string): Promise<'BASE TABLE' | 'VIEW' | null> {
  const res = await db.execute(
    sql.raw(
      `SELECT table_type
       FROM information_schema.tables
       WHERE table_schema = '${schema.replace(/'/g, "''")}'
         AND table_name = '${table.replace(/'/g, "''")}'
       LIMIT 1`
    )
  );
  const t = String((res.rows?.[0] as { table_type?: string } | undefined)?.table_type ?? '');
  if (t === 'BASE TABLE' || t === 'VIEW') return t;
  return null;
}

async function columnExists(schema: string, table: string, column: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = '${schema.replace(/'/g, "''")}'
         AND table_name = '${table.replace(/'/g, "''")}'
         AND column_name = '${column.replace(/'/g, "''")}'
       LIMIT 1`
    )
  );
  return (res.rows?.length ?? 0) > 0;
}

async function ensureSchemaLayer(): Promise<void> {
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS layer`));
}

async function execSqlStatements(raw: string): Promise<void> {
  const parts = raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const part of parts) {
    await db.execute(sql.raw(part));
  }
}

/**
 * layer에 실테이블이 있으면 유지.
 * VIEW만 있으면 제거하고 public 실테이블을 옮기거나 새로 만든다.
 */
async function ensureBaseTable(params: {
  table: string;
  createSql: string;
  result: EnsureResult;
}): Promise<void> {
  const { table, createSql, result } = params;
  const fq = `layer.${table}`;

  try {
    const layerType = await tableExists('layer', table);
    if (layerType === 'BASE TABLE') {
      result.existed.push(fq);
      return;
    }
    if (layerType === 'VIEW') {
      await db.execute(sql.raw(`DROP VIEW IF EXISTS layer."${table}" CASCADE`));
    }

    const publicType = await tableExists('public', table);
    if (publicType === 'BASE TABLE') {
      await db.execute(sql.raw(`ALTER TABLE public."${table}" SET SCHEMA layer`));
      result.moved.push(fq);
      return;
    }

    await execSqlStatements(createSql);
    result.created.push(fq);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`${fq}: ${msg}`);
  }
}

const ROAD_USE_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_use_ledger (
  id SERIAL PRIMARY KEY,
  geom geometry(Polygon, 5181),
  parcel_address text,
  use_no text,
  use_permit_date text,
  use_road_type text,
  use_road_name text,
  use_addr text,
  use_mgj text,
  use_why text,
  use_lic_addr text,
  use_lic_tel text,
  use_lic_name text,
  use_area double precision,
  use_start text,
  use_end text
);
CREATE INDEX IF NOT EXISTS road_use_ledger_geom_gix ON layer.road_use_ledger USING GIST (geom);
COMMENT ON TABLE layer.road_use_ledger IS '도로점용 대장';
`;

const ROAD_USE_LEDGER_JIJUK_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_use_ledger_jijuk (
  id SERIAL PRIMARY KEY,
  parent_id integer NOT NULL REFERENCES layer.road_use_ledger (id) ON DELETE CASCADE,
  geom geometry(Polygon, 5181),
  parcel_address text
);
CREATE INDEX IF NOT EXISTS road_use_ledger_jijuk_parent_id_idx
  ON layer.road_use_ledger_jijuk (parent_id);
CREATE INDEX IF NOT EXISTS road_use_ledger_jijuk_geom_gix
  ON layer.road_use_ledger_jijuk USING GIST (geom);
COMMENT ON TABLE layer.road_use_ledger_jijuk IS '도로점용 대장 필지목록';
`;

const WORK_UNIT_SQL = `
CREATE TABLE IF NOT EXISTS layer.work_unit (
  wu_key SERIAL PRIMARY KEY,
  work_name varchar NOT NULL,
  kind varchar NOT NULL,
  folder_name varchar NOT NULL,
  sr_key integer,
  wu_is_del boolean NOT NULL DEFAULT false,
  wu_create_date timestamp,
  wu_create_user varchar,
  wu_update_date timestamp,
  wu_update_user varchar
);
COMMENT ON TABLE layer.work_unit IS '영상작업단위';
`;

const FILE_UNIT_SQL = `
CREATE TABLE IF NOT EXISTS layer.file_unit (
  fu_key SERIAL PRIMARY KEY,
  wu_key integer NOT NULL,
  file_name varchar NOT NULL,
  relative_path varchar NOT NULL,
  media_type varchar NOT NULL,
  file_size bigint,
  x_5181 double precision,
  y_5181 double precision,
  geom geometry(Point, 5181),
  fu_is_del boolean NOT NULL DEFAULT false,
  fu_create_date timestamp,
  fu_create_user varchar,
  fu_update_date timestamp,
  fu_update_user varchar
);
CREATE INDEX IF NOT EXISTS file_unit_wu_key_idx ON layer.file_unit (wu_key);
CREATE INDEX IF NOT EXISTS file_unit_geom_gix ON layer.file_unit USING GIST (geom);
COMMENT ON TABLE layer.file_unit IS '영상작업단위파일';
`;

function memoCreateSql(tableName: string): string {
  const t = tableName.replace(/"/g, '""');
  return `
CREATE TABLE IF NOT EXISTS layer."${t}" (
  memo_key SERIAL PRIMARY KEY,
  geom geometry(Point, 5181),
  memo_title text,
  memo_contents text,
  memo_create_date text,
  memo_create_user text,
  memo_create_group text,
  memo_is_del boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS "${t}_geom_gix" ON layer."${t}" USING GIST (geom);
COMMENT ON TABLE layer."${t}" IS '메모';
`;
}

function occupationLedgerMainSql(prefix: string): string {
  const t = `${prefix}_occupationledger`;
  return `
CREATE TABLE IF NOT EXISTS layer.${t} (
  ogc_fid serial PRIMARY KEY,
  id text,
  work_name text,
  occup_place text,
  occup_purpose text,
  perm_start_date date,
  perm_end_date date,
  perm_area text,
  permit_no text,
  permit_date date,
  occup_name text,
  occup_phone text,
  applicant_addr text,
  manage_name text,
  state text,
  remark text,
  geom geometry(MultiPolygon, 5181)
);
CREATE INDEX IF NOT EXISTS ${t}_geom_gix ON layer.${t} USING GIST (geom);
CREATE INDEX IF NOT EXISTS ${t}_permit_no_idx ON layer.${t} (permit_no);
COMMENT ON TABLE layer.${t} IS '공통 점용대장';
`;
}

function occupationLedgerChildSql(tableName: string, comment: string): string {
  const t = tableName.replace(/"/g, '');
  return `
CREATE TABLE IF NOT EXISTS layer.${t} (
  ogc_fid serial PRIMARY KEY,
  permit_no text,
  id text,
  occup_place text,
  geom geometry(MultiPolygon, 5181)
);
CREATE INDEX IF NOT EXISTS ${t}_permit_no_idx ON layer.${t} (permit_no);
CREATE INDEX IF NOT EXISTS ${t}_geom_gix ON layer.${t} USING GIST (geom);
COMMENT ON TABLE layer.${t} IS '${comment.replace(/'/g, "''")}';
`;
}

/** scripts/sql/ngl_fee_list.sql 과 동일 컬럼 — water|road|public 접두 */
function nglFeeListSql(tableName: string): string {
  const t = tableName.replace(/"/g, '');
  const uq = `${t}_lvy_rcvmt_key`;
  return `
CREATE TABLE IF NOT EXISTS layer.${t} (
  id bigserial PRIMARY KEY,
  fee_status text NOT NULL CHECK (fee_status IN ('미납', '수납')),
  geom geometry(MultiPolygon, 5181),
  sgb_cd text,
  lvy_key text,
  dpt_nm text,
  dpt_cd text,
  fyr text,
  act_se_cd text,
  rprs_txm_cd text,
  rprs_txm_nm text,
  lvy_no text,
  itm_sn text,
  pyr_no text,
  pyr_nm text,
  pyr_addr text,
  lvy_ymd text,
  frst_pid_ymd text,
  gl_nm text,
  gl_mng_no text,
  gl_addr text,
  vtlac_bank_nm1 text,
  vr_actno1 text,
  vtlac_bank_nm2 text,
  vr_actno2 text,
  vtlac_bank_nm3 text,
  vr_actno3 text,
  vtlac_bank_nm4 text,
  vr_actno4 text,
  vtlac_bank_nm5 text,
  vr_actno5 text,
  vtlac_bank_nm6 text,
  vr_actno6 text,
  vtlac_bank_nm7 text,
  vr_actno7 text,
  vtlac_bank_nm8 text,
  vr_actno8 text,
  vtlac_bank_nm9 text,
  vr_actno9 text,
  vtlac_bank_nm10 text,
  vr_actno10 text,
  vtlac_bank_nm11 text,
  vr_actno11 text,
  vtlac_bank_nm12 text,
  vr_actno12 text,
  vtlac_bank_nm13 text,
  vr_actno13 text,
  vtlac_bank_nm14 text,
  vr_actno14 text,
  vtlac_bank_nm15 text,
  vr_actno15 text,
  vtlac_bank_nm16 text,
  vr_actno16 text,
  vtlac_bank_nm17 text,
  vr_actno17 text,
  vtlac_bank_nm18 text,
  vr_actno18 text,
  vtlac_bank_nm19 text,
  vr_actno19 text,
  vtlac_bank_nm20 text,
  vr_actno20 text,
  epay_no text,
  ledger_no text,
  acct_itm_cd text,
  sgb_nm text,
  rcvmt_se_nm text,
  szr_se_nm text,
  pyr_se_cd text,
  pyr_mng_no text,
  pyr_addr_sn text,
  pyr_stt_cd text,
  pyr_stt_nm text,
  zip text,
  lotno_road_addr_se_cd text,
  pyr_cnpc_no text,
  pyr_mbl_cnpc_no text,
  lvy_se_cd text,
  last_pid_ymd text,
  pid_af_ymd text,
  pid_af_amt bigint,
  frst_pct_amt bigint,
  lvy_stt_se_nm text,
  last_pct_amt bigint,
  last_adtn_amt bigint,
  last_itm_intr_amt bigint,
  itm_se_nm text,
  unty_lvy_data_se_nm text,
  gl_lotno_road_addr_se_cd text,
  gl_zip text,
  mng_item_sn1 text,
  mng_item_sn2 text,
  mng_item_sn3 text,
  mng_item_sn4 text,
  mng_item_sn5 text,
  mng_item_sn6 text,
  arr_rsn_cd text,
  arr_rsn_nm text,
  dft_se_nm text,
  pyr_eml_addr text,
  auto_pay_se_cd text,
  rdt_se_nm text,
  rpm_szr_vhrno text,
  unty_rprs_key text,
  spac_biz_cd text,
  rcvmt_sn text,
  rcvmt_ymd text,
  rcvmt_pct_amt bigint,
  rcvmt_adtn_amt bigint,
  itm_intr_amt bigint,
  rcvmt_bank text,
  rcvmt_ty_cd text,
  rcvmt_ty_nm text,
  act_ymd text,
  pmk_ymd text,
  rcvmt_se_cd text,
  rcvmt_stt_se_cd text,
  taxn_no text,
  sync_status text,
  synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT ${uq} UNIQUE (lvy_key, rcvmt_sn)
);
CREATE INDEX IF NOT EXISTS ${t}_fee_status_idx ON layer.${t} (fee_status);
CREATE INDEX IF NOT EXISTS ${t}_geom_gix ON layer.${t} USING GIST (geom);
CREATE INDEX IF NOT EXISTS ${t}_lvy_no_idx ON layer.${t} (lvy_no);
CREATE INDEX IF NOT EXISTS ${t}_ledger_no_idx ON layer.${t} (ledger_no);
COMMENT ON TABLE layer.${t} IS '점사용료 미납·수납 통합';
`;
}

/** public→layer 이동 후 geom 컬럼·인덱스·좌표 백필 */
async function ensureFileUnitGeom(result: EnsureResult): Promise<void> {
  const fq = 'layer.file_unit';
  try {
    if ((await tableExists('layer', 'file_unit')) !== 'BASE TABLE') return;

    if (!(await columnExists('layer', 'file_unit', 'geom'))) {
      await db.execute(
        sql.raw(`ALTER TABLE layer.file_unit ADD COLUMN geom geometry(Point, 5181)`)
      );
      result.created.push(`${fq}.geom`);
    }

    await db.execute(
      sql.raw(`
        UPDATE layer.file_unit
        SET geom = ST_SetSRID(ST_MakePoint(x_5181, y_5181), 5181)
        WHERE geom IS NULL
          AND x_5181 IS NOT NULL
          AND y_5181 IS NOT NULL
      `)
    );

    await db.execute(
      sql.raw(`CREATE INDEX IF NOT EXISTS file_unit_wu_key_idx ON layer.file_unit (wu_key)`)
    );
    await db.execute(
      sql.raw(`CREATE INDEX IF NOT EXISTS file_unit_geom_gix ON layer.file_unit USING GIST (geom)`)
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`${fq}.geom: ${msg}`);
  }
}

export async function ensureRoadUseLedgerTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  await ensureBaseTable({
    table: 'road_use_ledger',
    createSql: ROAD_USE_LEDGER_SQL,
    result: out,
  });
  await ensureBaseTable({
    table: 'road_use_ledger_jijuk',
    createSql: ROAD_USE_LEDGER_JIJUK_SQL,
    result: out,
  });
  return out;
}

/** 공통 점용대장 본대·필지·물건지 × water|road|public (9개) */
export async function ensureOccupationLedgerTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  for (const prefix of OCCUPATION_PREFIXES) {
    const base = `${prefix}_occupationledger`;
    await ensureBaseTable({
      table: base,
      createSql: occupationLedgerMainSql(prefix),
      result: out,
    });
    await ensureBaseTable({
      table: `${base}_jijuk`,
      createSql: occupationLedgerChildSql(`${base}_jijuk`, '공통 점용대장 필지'),
      result: out,
    });
    await ensureBaseTable({
      table: `${base}_mgj`,
      createSql: occupationLedgerChildSql(`${base}_mgj`, '공통 점용대장 물건지'),
      result: out,
    });
  }
  return out;
}

/** 점사용료 water|road|public_ngl_fee_list (3개) */
export async function ensureNglFeeListTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  for (const prefix of OCCUPATION_PREFIXES) {
    const table = `${prefix}_ngl_fee_list`;
    await ensureBaseTable({
      table,
      createSql: nglFeeListSql(table),
      result: out,
    });
  }
  return out;
}

export async function ensureMemoTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  for (const m of MEMO_TABLES) {
    await ensureBaseTable({
      table: m.tableName,
      createSql: memoCreateSql(m.tableName),
      result: out,
    });
  }
  return out;
}

export async function ensureAerialWorkUnitTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  await ensureBaseTable({
    table: 'work_unit',
    createSql: WORK_UNIT_SQL,
    result: out,
  });
  await ensureBaseTable({
    table: 'file_unit',
    createSql: FILE_UNIT_SQL,
    result: out,
  });
  await ensureFileUnitGeom(out);
  return out;
}

/** public.layer_extra_def — 추가속성 정의 (점용 본대 extra 컬럼과는 별개) */
export async function ensureLayerExtraDefTable(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  const fq = 'public.layer_extra_def';
  try {
    const { ensureLayerExtraDefTable: ensureDef } = await import('@/service/layerExtraService');
    const r = await ensureDef();
    if (!r.ok) {
      out.errors.push(`${fq}: ${r.error ?? 'failed'}`);
      return out;
    }
    const exists = await tableExists('public', 'layer_extra_def');
    if (exists === 'BASE TABLE') out.existed.push(fq);
    else out.created.push(fq);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(`${fq}: ${msg}`);
  }
  return out;
}

/** instrumentation / 수동 호출용 */
export async function ensureLayerAppTables(): Promise<EnsureResult> {
  const result: EnsureResult = { created: [], moved: [], existed: [], errors: [] };
  try {
    await ensureSchemaLayer();
    await ensureLayerExtraDefTable(result);
    await ensureRoadUseLedgerTables(result);
    await ensureOccupationLedgerTables(result);
    await ensureNglFeeListTables(result);
    await ensureMemoTables(result);
    await ensureAerialWorkUnitTables(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(msg);
  }
  return result;
}
