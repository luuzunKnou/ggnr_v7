/**
 * 서버 기동 시 앱 필수 테이블 확보 (없으면 생성, public에만 있으면 layer로 이동).
 * - 추가속성 정의: public.layer_extra_def
 * - 도로점용: road_use_ledger, road_use_ledger_jijuk
 * - 접도구역 건축물: road_frontage_building(+_detail|_confirm)
 * - 접도구역 표주: road_frontage_marker(+_item)
 * - 공통점용: water|road|public_occupationledger(+_jijuk|_mgj) — 9개
 * - 점사용료: water|road|public_ngl_fee_list — 3개
 * - FMS: water|road|public_fms_facility + _fms_inspection — 6개
 * - 차세대 연계: next_gen_linkage.ngl_error_log, ngl_query_table
 * - 메모: memo 및 memo_* 계열
 * - 영상: work_unit, file_unit
 * - 보상편입: road_reward, road_reward_parcel
 * - 공사대장: cons_data_as, cons_data_solo_as
 * - 마을순찰대: village_patrol
 */
import { db, pool } from '@/database/db';
import { sql } from 'drizzle-orm';
import { MEMO_TABLES } from '@/lib/memoConfig';
import {
  ROAD_FRONTAGE_BUILDING_CONFIRM_LAYER_COLUMNS,
  ROAD_FRONTAGE_BUILDING_DETAIL_LAYER_COLUMNS,
  ROAD_FRONTAGE_BUILDING_LAYER_COLUMNS,
  type RoadFrontageBuildingLayerColumnDef,
} from '@/database/schema/road_frontage_building';

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

async function schemaExists(schema: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1 LIMIT 1`,
    [schema]
  );
  return (res.rowCount ?? res.rows.length) > 0;
}

function pgErrCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) return String((e as { code?: unknown }).code ?? '');
  const cause = e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return String((cause as { code?: unknown }).code ?? '');
  }
  return '';
}

async function ensureSchemaLayer(): Promise<void> {
  if (await schemaExists('layer')) return;
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS layer');
  } catch (e: unknown) {
    if (await schemaExists('layer')) return;
    const code = pgErrCode(e);
    if (code === '42P06' || code === '42501') return;
    throw e;
  }
}

async function ensureSchemaNextGenLinkage(): Promise<void> {
  if (await schemaExists('next_gen_linkage')) return;
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS next_gen_linkage`));
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

async function copyLegacyColumnData(
  table: string,
  targetCol: string,
  def: RoadFrontageBuildingLayerColumnDef
): Promise<void> {
  if (def.legacyCopyExpr) {
    if (def.legacyCopyExpr.includes('ftr_idn') && !(await columnExists('layer', table, 'ftr_idn'))) {
      return;
    }
    if (
      def.legacyCopyExpr.includes('loc_adr_r') &&
      !(await columnExists('layer', table, 'loc_adr_r')) &&
      !(await columnExists('layer', table, 'loc_adr_c'))
    ) {
      return;
    }
    const expr = def.legacyCopyExpr.includes('ftr_idn')
      ? `CASE WHEN TRIM(ftr_idn::text) ~ '^[0-9]+$' THEN TRIM(ftr_idn::text)::integer ELSE NULL END`
      : def.legacyCopyExpr;
    await db.execute(
      sql.raw(
        `UPDATE layer.${table}
         SET ${targetCol} = ${expr}
         WHERE ${targetCol} IS NULL`
      )
    );
    return;
  }
  if (!def.legacyFrom) return;
  if (!(await columnExists('layer', table, def.legacyFrom))) return;
  await db.execute(
    sql.raw(
      `UPDATE layer.${table}
       SET ${targetCol} = ${def.legacyFrom}
       WHERE ${targetCol} IS NULL AND ${def.legacyFrom} IS NOT NULL`
    )
  );
}

/** 기존 테이블에 누락 컬럼 ADD + 구형 컬럼 값 복사 */
async function ensureLayerTableColumns(
  table: string,
  columns: RoadFrontageBuildingLayerColumnDef[],
  result: EnsureResult
): Promise<void> {
  const fq = `layer.${table}`;
  try {
    if ((await tableExists('layer', table)) !== 'BASE TABLE') return;

    for (const col of columns) {
      if (await columnExists('layer', table, col.name)) continue;
      await db.execute(sql.raw(`ALTER TABLE layer.${table} ADD COLUMN ${col.name} ${col.ddl}`));
      try {
        await copyLegacyColumnData(table, col.name, col);
      } catch (copyErr: unknown) {
        const msg = copyErr instanceof Error ? copyErr.message : String(copyErr);
        result.errors.push(`${fq}.${col.name}.legacyCopy: ${msg}`);
      }
      if (col.comment) {
        await db.execute(
          sql.raw(
            `COMMENT ON COLUMN layer.${table}.${col.name} IS '${col.comment.replace(/'/g, "''")}'`
          )
        );
      }
      result.created.push(`${fq}.${col.name}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`${fq}.columns: ${msg}`);
  }
}

async function ensureRoadFrontageBuildingColumns(result: EnsureResult): Promise<void> {
  await ensureLayerTableColumns('road_frontage_building', ROAD_FRONTAGE_BUILDING_LAYER_COLUMNS, result);
  await ensureLayerTableColumns(
    'road_frontage_building_detail',
    ROAD_FRONTAGE_BUILDING_DETAIL_LAYER_COLUMNS,
    result
  );
  await ensureLayerTableColumns(
    'road_frontage_building_confirm',
    ROAD_FRONTAGE_BUILDING_CONFIRM_LAYER_COLUMNS,
    result
  );

  try {
    await db.execute(
      sql.raw(`
        CREATE INDEX IF NOT EXISTS road_frontage_building_geom_gix
          ON layer.road_frontage_building USING GIST (geom);
        CREATE INDEX IF NOT EXISTS road_frontage_building_detail_parent_id_idx
          ON layer.road_frontage_building_detail (parent_id);
        CREATE INDEX IF NOT EXISTS road_frontage_building_confirm_parent_id_idx
          ON layer.road_frontage_building_confirm (parent_id);
      `)
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`layer.road_frontage_building.indexes: ${msg}`);
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

/** layer가 아닌 스키마 — 없으면 생성만 (public에서 이동하지 않음) */
async function ensureNamedSchemaTable(params: {
  schema: string;
  table: string;
  createSql: string;
  result: EnsureResult;
}): Promise<void> {
  const { schema, table, createSql, result } = params;
  const fq = `${schema}.${table}`;
  try {
    const existing = await tableExists(schema, table);
    if (existing === 'BASE TABLE') {
      result.existed.push(fq);
      return;
    }
    if (existing === 'VIEW') {
      await db.execute(sql.raw(`DROP VIEW IF EXISTS ${schema}."${table}" CASCADE`));
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

const ROAD_FRONTAGE_BUILDING_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_frontage_building (
  id SERIAL PRIMARY KEY,
  geom geometry(Point, 5181),
  lon double precision,
  lat double precision,
  ftr_idn text,
  road_type text,
  route_no text,
  route_nam text,
  serial_no text,
  pre_ymd text,
  loc_adr text,
  resi_nam text,
  resi_num text,
  build_onam text,
  build_onum text,
  build_oadr text,
  land_onam text,
  land_onum text,
  land_oadr text,
  write_dept text,
  write_nam text,
  write_ymd text,
  before_ymd text,
  after_ymd text,
  is_del boolean NOT NULL DEFAULT false,
  crea_ymd text,
  crea_nam text,
  upd_ymd text,
  upd_nam text
);
CREATE INDEX IF NOT EXISTS road_frontage_building_geom_gix
  ON layer.road_frontage_building USING GIST (geom);
CREATE UNIQUE INDEX IF NOT EXISTS road_frontage_building_ftr_idn_uidx
  ON layer.road_frontage_building (ftr_idn)
  WHERE ftr_idn IS NOT NULL AND btrim(ftr_idn) <> '';
COMMENT ON TABLE layer.road_frontage_building IS '접도구역 기존 건축물 관리대장';
`;

/** 기존 풀어쓴 영문 컬럼 → DBF 축약명 (한 번만 적용) */
const ROAD_FRONTAGE_BUILDING_ALIGN_SQL = `
DO $align$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'route_name'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN route_name TO route_nam;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'prepared_date'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN prepared_date TO pre_ymd;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'location_address'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN location_address TO loc_adr;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'resident_name'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN resident_name TO resi_nam;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'resident_phone'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN resident_phone TO resi_num;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'building_owner_name'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN building_owner_name TO build_onam;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'building_owner_phone'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN building_owner_phone TO build_onum;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'building_owner_address'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN building_owner_address TO build_oadr;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'land_owner_name'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN land_owner_name TO land_onam;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'land_owner_phone'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN land_owner_phone TO land_onum;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'land_owner_address'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN land_owner_address TO land_oadr;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'writer_dept'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN writer_dept TO write_dept;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'writer_name'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN writer_name TO write_nam;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'written_at'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN written_at TO write_ymd;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'attach_shot_before'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN attach_shot_before TO before_ymd;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'attach_shot_after'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN attach_shot_after TO after_ymd;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'create_date'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN create_date TO crea_ymd;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'create_user'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN create_user TO crea_nam;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'update_date'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN update_date TO upd_ymd;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'update_user'
  ) THEN
    ALTER TABLE layer.road_frontage_building RENAME COLUMN update_user TO upd_nam;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building' AND column_name = 'ftr_idn'
  ) THEN
    ALTER TABLE layer.road_frontage_building ADD COLUMN ftr_idn text;
  END IF;
  UPDATE layer.road_frontage_building
  SET ftr_idn = 'JD' || lpad(id::text, 4, '0')
  WHERE ftr_idn IS NULL OR btrim(ftr_idn) = '';
END
$align$;
`;

const ROAD_FRONTAGE_BUILDING_FTR_IDN_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS road_frontage_building_ftr_idn_uidx
  ON layer.road_frontage_building (ftr_idn)
  WHERE ftr_idn IS NOT NULL AND btrim(ftr_idn) <> '';
`;

const ROAD_FRONTAGE_BUILDING_DETAIL_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_frontage_building_detail (
  id SERIAL PRIMARY KEY,
  ftr_idn text NOT NULL,
  dong_no text,
  inst_ymd text,
  structure text,
  usage_type text,
  area_sqm text,
  loc_adr_r text,
  loc_adr_c text,
  bad_marks text,
  sort_no integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS road_frontage_building_detail_ftr_idn_idx
  ON layer.road_frontage_building_detail (ftr_idn);
COMMENT ON TABLE layer.road_frontage_building_detail IS '접도구역 건축물 내용';
`;

/** 건축물내용 컬럼을 수급 DBF명으로 맞춤 */
const ROAD_FRONTAGE_BUILDING_DETAIL_ALIGN_SQL = `
DO $align$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail' AND column_name = 'installed_date'
  ) THEN
    ALTER TABLE layer.road_frontage_building_detail RENAME COLUMN installed_date TO inst_ymd;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail'
      AND column_name = 'dong_no' AND data_type = 'integer'
  ) THEN
    ALTER TABLE layer.road_frontage_building_detail
      ALTER COLUMN dong_no TYPE text USING NULLIF(dong_no::text, '');
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail'
      AND column_name = 'area_sqm' AND data_type = 'double precision'
  ) THEN
    ALTER TABLE layer.road_frontage_building_detail
      ALTER COLUMN area_sqm TYPE text USING NULLIF(trim(to_char(area_sqm, 'FM999999999.999999')), '');
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail' AND column_name = 'location_kind'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail' AND column_name = 'loc_adr_r'
    ) THEN
      ALTER TABLE layer.road_frontage_building_detail ADD COLUMN loc_adr_r text;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail' AND column_name = 'loc_adr_c'
    ) THEN
      ALTER TABLE layer.road_frontage_building_detail ADD COLUMN loc_adr_c text;
    END IF;
    UPDATE layer.road_frontage_building_detail
    SET loc_adr_r = CASE WHEN location_kind = '도로예정지' THEN 'Y' ELSE loc_adr_r END,
        loc_adr_c = CASE WHEN location_kind = '접도구역' THEN 'Y' ELSE loc_adr_c END
    WHERE location_kind IS NOT NULL AND btrim(location_kind) <> '';
    ALTER TABLE layer.road_frontage_building_detail DROP COLUMN location_kind;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail' AND column_name = 'ftr_idn'
  ) THEN
    ALTER TABLE layer.road_frontage_building_detail ADD COLUMN ftr_idn text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail' AND column_name = 'loc_adr_r'
  ) THEN
    ALTER TABLE layer.road_frontage_building_detail ADD COLUMN loc_adr_r text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail' AND column_name = 'loc_adr_c'
  ) THEN
    ALTER TABLE layer.road_frontage_building_detail ADD COLUMN loc_adr_c text;
  END IF;
  -- parent_id → ftr_idn 키로 전환
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_detail' AND column_name = 'parent_id'
  ) THEN
    UPDATE layer.road_frontage_building_detail d
    SET ftr_idn = p.ftr_idn
    FROM layer.road_frontage_building p
    WHERE d.parent_id = p.id
      AND (d.ftr_idn IS NULL OR btrim(d.ftr_idn) = '')
      AND p.ftr_idn IS NOT NULL AND btrim(p.ftr_idn) <> '';
    ALTER TABLE layer.road_frontage_building_detail DROP CONSTRAINT IF EXISTS road_frontage_building_detail_parent_id_fkey;
    ALTER TABLE layer.road_frontage_building_detail DROP COLUMN parent_id;
  END IF;
  DELETE FROM layer.road_frontage_building_detail WHERE ftr_idn IS NULL OR btrim(ftr_idn) = '';
  BEGIN
    ALTER TABLE layer.road_frontage_building_detail ALTER COLUMN ftr_idn SET NOT NULL;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END
$align$;
CREATE INDEX IF NOT EXISTS road_frontage_building_detail_ftr_idn_idx
  ON layer.road_frontage_building_detail (ftr_idn);
`;

const ROAD_FRONTAGE_BUILDING_CONFIRM_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_frontage_building_confirm (
  id SERIAL PRIMARY KEY,
  ftr_idn text NOT NULL,
  check_ymd text,
  check_nam text,
  app_nam text,
  sort_no integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS road_frontage_building_confirm_ftr_idn_idx
  ON layer.road_frontage_building_confirm (ftr_idn);
COMMENT ON TABLE layer.road_frontage_building_confirm IS '접도구역 건축물 확인 결과';
`;

const ROAD_FRONTAGE_MARKER_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_frontage_marker (
  id SERIAL PRIMARY KEY,
  road_type text,
  route_name text,
  geom geometry(MultiPoint, 5181)
);
CREATE INDEX IF NOT EXISTS road_frontage_marker_geom_gix
  ON layer.road_frontage_marker USING GIST (geom);
COMMENT ON TABLE layer.road_frontage_marker IS '접도구역 표주 관리대장';
`;

const ROAD_FRONTAGE_MARKER_ITEM_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_frontage_marker_item (
  id SERIAL PRIMARY KEY,
  parent_id integer NOT NULL REFERENCES layer.road_frontage_marker (id) ON DELETE CASCADE,
  station_distance text,
  owner_name text,
  owner_address text,
  sign text,
  remark text,
  install_location text,
  land_category text,
  pnu text,
  geom geometry(Point, 5181)
);
CREATE INDEX IF NOT EXISTS road_frontage_marker_item_parent_id_idx
  ON layer.road_frontage_marker_item (parent_id);
CREATE INDEX IF NOT EXISTS road_frontage_marker_item_geom_gix
  ON layer.road_frontage_marker_item USING GIST (geom);
COMMENT ON TABLE layer.road_frontage_marker_item IS '접도구역 표주 점';
`;

/** 확인결과 컬럼을 수급 DBF명으로 맞춤 + ftr_idn 키 */
const ROAD_FRONTAGE_BUILDING_CONFIRM_ALIGN_SQL = `
DO $align$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_confirm' AND column_name = 'confirm_date'
  ) THEN
    ALTER TABLE layer.road_frontage_building_confirm RENAME COLUMN confirm_date TO check_ymd;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_confirm' AND column_name = 'confirmer_name'
  ) THEN
    ALTER TABLE layer.road_frontage_building_confirm RENAME COLUMN confirmer_name TO check_nam;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_confirm' AND column_name = 'approver_name'
  ) THEN
    ALTER TABLE layer.road_frontage_building_confirm RENAME COLUMN approver_name TO app_nam;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_confirm' AND column_name = 'ftr_idn'
  ) THEN
    ALTER TABLE layer.road_frontage_building_confirm ADD COLUMN ftr_idn text;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'layer' AND table_name = 'road_frontage_building_confirm' AND column_name = 'parent_id'
  ) THEN
    UPDATE layer.road_frontage_building_confirm c
    SET ftr_idn = p.ftr_idn
    FROM layer.road_frontage_building p
    WHERE c.parent_id = p.id
      AND (c.ftr_idn IS NULL OR btrim(c.ftr_idn) = '')
      AND p.ftr_idn IS NOT NULL AND btrim(p.ftr_idn) <> '';
    ALTER TABLE layer.road_frontage_building_confirm DROP CONSTRAINT IF EXISTS road_frontage_building_confirm_parent_id_fkey;
    ALTER TABLE layer.road_frontage_building_confirm DROP COLUMN parent_id;
  END IF;
  DELETE FROM layer.road_frontage_building_confirm WHERE ftr_idn IS NULL OR btrim(ftr_idn) = '';
  BEGIN
    ALTER TABLE layer.road_frontage_building_confirm ALTER COLUMN ftr_idn SET NOT NULL;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END
$align$;
CREATE INDEX IF NOT EXISTS road_frontage_building_confirm_ftr_idn_idx
  ON layer.road_frontage_building_confirm (ftr_idn);
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

/** scripts/sql/road_reward.sql 과 동일 컬럼 */
const ROAD_REWARD_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_reward (
  ogc_fid SERIAL PRIMARY KEY,
  geom geometry(Geometry, 5181),
  name text,
  org text,
  policy text,
  unit text,
  detail text,
  budget_item text,
  stat_item text,
  appraisal1_name text,
  appraisal2_name text
);
CREATE INDEX IF NOT EXISTS road_reward_geom_idx
  ON layer.road_reward USING GIST (geom);
COMMENT ON TABLE layer.road_reward IS '보상편입용지';
`;

const ROAD_REWARD_PARCEL_SQL = `
CREATE TABLE IF NOT EXISTS layer.road_reward_parcel (
  ogc_fid SERIAL PRIMARY KEY,
  geom geometry(Geometry, 5181),
  reward_key integer NOT NULL,
  pnu text,
  eupmyeon_dong text,
  jibun_original text,
  jibun_included text,
  area_original double precision,
  area_included double precision,
  jimok text,
  appraisal1_value double precision,
  appraisal2_value double precision,
  applied_unit_price double precision,
  compensation_amount double precision,
  farming_compensation_amount double precision,
  obstacle_compensation_amount double precision,
  owner_address text,
  owner_name text,
  actual_owner text,
  actual_cultivator text,
  note text,
  CONSTRAINT road_reward_parcel_reward_ogc_fid_fkey
    FOREIGN KEY (reward_key) REFERENCES layer.road_reward (ogc_fid)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS road_reward_parcel_reward_ogc_fid_idx
  ON layer.road_reward_parcel (reward_key);
CREATE INDEX IF NOT EXISTS road_reward_parcel_pnu_idx
  ON layer.road_reward_parcel (pnu);
CREATE INDEX IF NOT EXISTS road_reward_parcel_geom_idx
  ON layer.road_reward_parcel USING GIST (geom);
COMMENT ON TABLE layer.road_reward_parcel IS '보상편입용지 필지목록';
COMMENT ON COLUMN layer.road_reward_parcel.compensation_amount IS '토지보상금액(원)';
COMMENT ON COLUMN layer.road_reward_parcel.farming_compensation_amount IS '영농보상금액(원)';
COMMENT ON COLUMN layer.road_reward_parcel.obstacle_compensation_amount IS '지장물보상금액(원)';
COMMENT ON COLUMN layer.road_reward_parcel.actual_owner IS '실소유자';
COMMENT ON COLUMN layer.road_reward_parcel.actual_cultivator IS '실경작자';
`;

const CONS_DATA_AS_SQL = `
CREATE TABLE IF NOT EXISTS layer.cons_data_as (
  ogc_fid serial PRIMARY KEY,
  geom geometry(MultiPolygon, 5181),
  gkey_code text,
  cons_code text,
  river_type text,
  river_code text,
  river_name text,
  cons_name text,
  cons_locat text,
  cons_volum text,
  amount_pre text,
  amount_var text,
  amount_cha text,
  amount_aft text,
  cont_date text,
  start_date text,
  done_date text,
  sdone_date text,
  busin_name text,
  ceo_name text,
  busin_addr text,
  busin_phon text,
  direct_pos text,
  direct_nam text,
  reason text,
  descript text
);
CREATE INDEX IF NOT EXISTS cons_data_as_geom_gix ON layer.cons_data_as USING GIST (geom);
CREATE INDEX IF NOT EXISTS cons_data_as_cons_code_idx ON layer.cons_data_as (cons_code);
COMMENT ON TABLE layer.cons_data_as IS '공사대장';
`;

const CONS_DATA_SOLO_AS_SQL = `
CREATE TABLE IF NOT EXISTS layer.cons_data_solo_as (
  ogc_fid serial PRIMARY KEY,
  geom geometry(MultiPolygon, 5181),
  cons_code text,
  river_type text,
  river_code text,
  river_name text,
  solo_code text,
  remark text
);
CREATE INDEX IF NOT EXISTS cons_data_solo_as_geom_gix ON layer.cons_data_solo_as USING GIST (geom);
CREATE INDEX IF NOT EXISTS cons_data_solo_as_cons_code_idx ON layer.cons_data_solo_as (cons_code);
COMMENT ON TABLE layer.cons_data_solo_as IS '공사대장_개별';
`;

const VILLAGE_PATROL_SQL = `
CREATE TABLE IF NOT EXISTS layer.village_patrol (
  id SERIAL PRIMARY KEY,
  eup text NOT NULL DEFAULT '',
  village text NOT NULL DEFAULT '',
  team text NOT NULL DEFAULT 'A조',
  name text NOT NULL DEFAULT '',
  affiliation text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS village_patrol_place_idx
  ON layer.village_patrol (eup, village, team);
CREATE INDEX IF NOT EXISTS village_patrol_phone_idx
  ON layer.village_patrol (phone);
COMMENT ON TABLE layer.village_patrol IS '마을순찰대 편성 명단';
`;

/** 기존 중복 정리 후 편성 유니크 인덱스 확보 */
async function ensureVillagePatrolAssignmentUnique(result: EnsureResult): Promise<void> {
  const fq = 'layer.village_patrol';
  try {
    if ((await tableExists('layer', 'village_patrol')) !== 'BASE TABLE') return;

    await db.execute(
      sql.raw(`
        DELETE FROM layer.village_patrol a
        USING layer.village_patrol b
        WHERE a.id > b.id
          AND a.eup = b.eup
          AND a.village = b.village
          AND a.team = b.team
          AND a.name = b.name
          AND a.phone = b.phone
      `)
    );

    await db.execute(
      sql.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS village_patrol_assignment_uidx
          ON layer.village_patrol (eup, village, team, name, phone)
      `)
    );
    result.created.push(`${fq}.village_patrol_assignment_uidx`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`${fq}.assignment_uidx: ${msg}`);
  }
}

function memoCreateSql(tableName: string): string {
  const t = tableName.replace(/"/g, '""');
  return `
CREATE TABLE IF NOT EXISTS layer."${t}" (
  memo_key SERIAL PRIMARY KEY,
  geom geometry(Point, 5181),
  address text,
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

function fmsFacilitySql(tableName: string): string {
  const t = tableName.replace(/"/g, '');
  const uq = `${t}_facil_no_key`;
  return `
CREATE TABLE IF NOT EXISTS layer.${t} (
  id bigserial PRIMARY KEY,
  facil_no text,
  facil_nm text,
  mng_no text,
  mng_main_cd text,
  permit_org_cd text,
  facil_owner text,
  route_class text,
  route_detail text,
  facil_class text,
  facil_gbn text,
  facil_kind text,
  facil_desc_cd text,
  addr_sido text,
  addr_gugun text,
  addr_dong text,
  addr_detail text,
  cpl_ymd text,
  temp_ymd text,
  rsp_to_ymd text,
  design_ymd_from text,
  design_ymd_to text,
  designer_nm text,
  const_ymd_from text,
  const_ymd_to text,
  constractor_cd text,
  constractor_nm text,
  const_amt text,
  spv_ymd_from text,
  spv_ymd_to text,
  supervisor_nm text,
  const_order_cd text,
  const_order_nm text,
  const_nm text,
  const_spvsr_nm text,
  dsn_book_st_yn text,
  eq_dsn_app_yn text,
  gam_reason_cd text,
  whl_pht_file_ct text,
  etc_pht_file_ct text,
  upper_no text,
  lnk_facil_no text,
  etc_remark text,
  addr_full text,
  geom geometry(MultiPolygon, 5181),
  sync_status text,
  synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT ${uq} UNIQUE (facil_no)
);
CREATE INDEX IF NOT EXISTS ${t}_facil_no_idx ON layer.${t} (facil_no);
CREATE INDEX IF NOT EXISTS ${t}_facil_nm_idx ON layer.${t} (facil_nm);
CREATE INDEX IF NOT EXISTS ${t}_geom_gix ON layer.${t} USING GIST (geom);
COMMENT ON TABLE layer.${t} IS 'FMS 시설물관리대장';
`;
}

function fmsInspectionSql(tableName: string): string {
  const t = tableName.replace(/"/g, '');
  const uq = `${t}_facil_dign_key`;
  return `
CREATE TABLE IF NOT EXISTS layer.${t} (
  id bigserial PRIMARY KEY,
  facil_no text,
  dign_seq text,
  start_ymd text,
  end_ymd text,
  dign_gbn text,
  regular_gbn text,
  rep_engineer_nm text,
  dign_amt text,
  state_grade text,
  dign_content text,
  amend_content text,
  wrt_ymd text,
  wrt_person_nm text,
  sync_status text,
  synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT ${uq} UNIQUE (facil_no, dign_seq)
);
CREATE INDEX IF NOT EXISTS ${t}_facil_no_idx ON layer.${t} (facil_no);
COMMENT ON TABLE layer.${t} IS 'FMS 점검진단실적';
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

export async function ensureRoadFrontageBuildingTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  await ensureBaseTable({
    table: 'road_frontage_building',
    createSql: ROAD_FRONTAGE_BUILDING_SQL,
    result: out,
  });
  try {
    // DO 블록은 ';' 분할하면 깨지므로 pool로 한 번에 실행
    await pool.query(ROAD_FRONTAGE_BUILDING_ALIGN_SQL);
    await pool.query(ROAD_FRONTAGE_BUILDING_FTR_IDN_INDEX_SQL);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(`layer.road_frontage_building align: ${msg}`);
  }
  await ensureBaseTable({
    table: 'road_frontage_building_detail',
    createSql: ROAD_FRONTAGE_BUILDING_DETAIL_SQL,
    result: out,
  });
  try {
    await pool.query(ROAD_FRONTAGE_BUILDING_DETAIL_ALIGN_SQL);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(`layer.road_frontage_building_detail align: ${msg}`);
  }
  await ensureBaseTable({
    table: 'road_frontage_building_confirm',
    createSql: ROAD_FRONTAGE_BUILDING_CONFIRM_SQL,
    result: out,
  });
  await ensureRoadFrontageBuildingColumns(out);
  try {
    await pool.query(ROAD_FRONTAGE_BUILDING_CONFIRM_ALIGN_SQL);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(`layer.road_frontage_building_confirm align: ${msg}`);
  }
  try {
    await pool.query(`DROP TABLE IF EXISTS layer.road_frontage_building_attach`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(`layer.road_frontage_building_attach drop: ${msg}`);
  }
  return out;
}

export async function ensureRoadFrontageMarkerTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  await ensureBaseTable({
    table: 'road_frontage_marker',
    createSql: ROAD_FRONTAGE_MARKER_SQL,
    result: out,
  });
  await ensureBaseTable({
    table: 'road_frontage_marker_item',
    createSql: ROAD_FRONTAGE_MARKER_ITEM_SQL,
    result: out,
  });
  const markerParentCols: Array<{ name: string; ddl: string }> = [
    { name: 'geom', ddl: 'geometry(MultiPoint, 5181)' },
  ];
  for (const col of markerParentCols) {
    try {
      if (await columnExists('layer', 'road_frontage_marker', col.name)) continue;
      await db.execute(
        sql.raw(`ALTER TABLE layer.road_frontage_marker ADD COLUMN ${col.name} ${col.ddl}`)
      );
      out.created.push(`layer.road_frontage_marker.${col.name}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`layer.road_frontage_marker.${col.name}: ${msg}`);
    }
  }
  try {
    await db.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS road_frontage_marker_geom_gix
         ON layer.road_frontage_marker USING GIST (geom)`
      )
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(`layer.road_frontage_marker_geom_gix: ${msg}`);
  }
  const markerItemCols: Array<{ name: string; ddl: string }> = [
    { name: 'install_location', ddl: 'text' },
    { name: 'land_category', ddl: 'text' },
    { name: 'pnu', ddl: 'text' },
    { name: 'geom', ddl: 'geometry(Point, 5181)' },
  ];
  for (const col of markerItemCols) {
    try {
      if (await columnExists('layer', 'road_frontage_marker_item', col.name)) continue;
      await db.execute(
        sql.raw(`ALTER TABLE layer.road_frontage_marker_item ADD COLUMN ${col.name} ${col.ddl}`)
      );
      out.created.push(`layer.road_frontage_marker_item.${col.name}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`layer.road_frontage_marker_item.${col.name}: ${msg}`);
    }
  }
  try {
    await db.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS road_frontage_marker_item_geom_gix
         ON layer.road_frontage_marker_item USING GIST (geom)`
      )
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(`layer.road_frontage_marker_item_geom_gix: ${msg}`);
  }
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

/** FMS water|road|public × facility·inspection (6개) */
export async function ensureFmsTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  for (const prefix of OCCUPATION_PREFIXES) {
    const facility = `${prefix}_fms_facility`;
    const inspection = `${prefix}_fms_inspection`;
    await ensureBaseTable({
      table: facility,
      createSql: fmsFacilitySql(facility),
      result: out,
    });
    try {
      if (!(await columnExists('layer', facility, 'geom'))) {
        await db.execute(
          sql.raw(`
            ALTER TABLE layer.${facility}
              ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 5181);
            CREATE INDEX IF NOT EXISTS ${facility}_geom_gix
              ON layer.${facility} USING GIST (geom);
          `)
        );
      }
    } catch (e) {
      out.errors.push(
        `layer.${facility}.geom: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    await ensureBaseTable({
      table: inspection,
      createSql: fmsInspectionSql(inspection),
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

const NGL_ERROR_LOG_SQL = `
CREATE TABLE IF NOT EXISTS next_gen_linkage.ngl_error_log (
  id serial4 NOT NULL,
  lvy_no varchar(6) NULL,
  itm_sn varchar(2) NULL,
  interface_id varchar(100) NULL,
  rprs_txm_cd varchar(6) NULL,
  rprs_txm_nm varchar(100) NULL,
  error_code varchar(20) NULL,
  error_message varchar NULL,
  created_at timestamp DEFAULT now() NULL,
  CONSTRAINT ngl_error_log_pkey PRIMARY KEY (id)
)
`;

const NGL_QUERY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS next_gen_linkage.ngl_query_table (
  ngl_key serial4 NOT NULL,
  interface_id varchar(10) NOT NULL,
  interface_nm varchar(200) NULL,
  rprs_txm_cd varchar(6) NOT NULL,
  rprs_txm_nm varchar(100) NULL,
  spac_biz_cd varchar(4) NULL,
  act_se_cd varchar(2) NOT NULL,
  is_active varchar(1) DEFAULT 'Y'::character varying NULL,
  if_id varchar(50) NULL,
  dpt_cd varchar(7) NULL,
  CONSTRAINT ngl_query_table_pkey PRIMARY KEY (ngl_key)
)
`;

/** 차세대 연계 next_gen_linkage.ngl_error_log · ngl_query_table */
export async function ensureNextGenLinkageTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  try {
    await ensureSchemaNextGenLinkage();
    await ensureNamedSchemaTable({
      schema: 'next_gen_linkage',
      table: 'ngl_error_log',
      createSql: NGL_ERROR_LOG_SQL,
      result: out,
    });
    await ensureNamedSchemaTable({
      schema: 'next_gen_linkage',
      table: 'ngl_query_table',
      createSql: NGL_QUERY_TABLE_SQL,
      result: out,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    out.errors.push(`next_gen_linkage: ${msg}`);
  }
  return out;
}

/** 기존 memo_* 테이블에 주소 컬럼 보강 */
async function ensureMemoAddressColumn(tableName: string, result: EnsureResult): Promise<void> {
  const fq = `layer.${tableName}`;
  try {
    if ((await tableExists('layer', tableName)) !== 'BASE TABLE') return;
    if (await columnExists('layer', tableName, 'address')) return;
    await db.execute(sql.raw(`ALTER TABLE layer."${tableName.replace(/"/g, '""')}" ADD COLUMN address text`));
    await db.execute(
      sql.raw(`COMMENT ON COLUMN layer."${tableName.replace(/"/g, '""')}".address IS '주소'`)
    );
    result.created.push(`${fq}.address`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`${fq}.address: ${msg}`);
  }
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
    await ensureMemoAddressColumn(m.tableName, out);
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

/** 기존 필지 테이블에 토지 외 금액·실소유자·실경작자 컬럼 보강 */
async function ensureRoadRewardParcelColumns(result: EnsureResult): Promise<void> {
  const table = 'road_reward_parcel';
  const fq = `layer.${table}`;
  try {
    if ((await tableExists('layer', table)) !== 'BASE TABLE') return;

    if (await columnExists('layer', table, 'compensation_amount')) {
      await db.execute(
        sql.raw(`COMMENT ON COLUMN layer.road_reward_parcel.compensation_amount IS '토지보상금액(원)'`)
      );
    }

    const extras: { name: string; ddl: string; comment: string }[] = [
      { name: 'farming_compensation_amount', ddl: 'double precision', comment: '영농보상금액(원)' },
      { name: 'obstacle_compensation_amount', ddl: 'double precision', comment: '지장물보상금액(원)' },
      { name: 'actual_owner', ddl: 'text', comment: '실소유자' },
      { name: 'actual_cultivator', ddl: 'text', comment: '실경작자' },
    ];
    for (const col of extras) {
      if (await columnExists('layer', table, col.name)) continue;
      await db.execute(sql.raw(`ALTER TABLE layer.${table} ADD COLUMN ${col.name} ${col.ddl}`));
      await db.execute(
        sql.raw(`COMMENT ON COLUMN layer.${table}.${col.name} IS '${col.comment.replace(/'/g, "''")}'`)
      );
      result.created.push(`${fq}.${col.name}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`${fq}.columns: ${msg}`);
  }
}

/** 보상편입용지 · 필지목록 */
export async function ensureRoadRewardTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  await ensureBaseTable({
    table: 'road_reward',
    createSql: ROAD_REWARD_SQL,
    result: out,
  });
  await ensureBaseTable({
    table: 'road_reward_parcel',
    createSql: ROAD_REWARD_PARCEL_SQL,
    result: out,
  });
  await ensureRoadRewardParcelColumns(out);
  return out;
}

/** 공사대장 · 개별(필지) */
export async function ensureConsDataAsTables(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  await ensureBaseTable({
    table: 'cons_data_as',
    createSql: CONS_DATA_AS_SQL,
    result: out,
  });
  await ensureBaseTable({
    table: 'cons_data_solo_as',
    createSql: CONS_DATA_SOLO_AS_SQL,
    result: out,
  });
  return out;
}

export async function ensureVillagePatrolTable(result?: EnsureResult): Promise<EnsureResult> {
  const out: EnsureResult = result ?? { created: [], moved: [], existed: [], errors: [] };
  await ensureSchemaLayer();
  await ensureBaseTable({
    table: 'village_patrol',
    createSql: VILLAGE_PATROL_SQL,
    result: out,
  });
  await ensureVillagePatrolAssignmentUnique(out);
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
    await ensureRoadFrontageBuildingTables(result);
    await ensureRoadFrontageMarkerTables(result);
    await ensureOccupationLedgerTables(result);
    await ensureNglFeeListTables(result);
    await ensureFmsTables(result);
    await ensureNextGenLinkageTables(result);
    await ensureMemoTables(result);
    await ensureAerialWorkUnitTables(result);
    await ensureRoadRewardTables(result);
    await ensureConsDataAsTables(result);
    await ensureVillagePatrolTable(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(msg);
  }
  return result;
}
