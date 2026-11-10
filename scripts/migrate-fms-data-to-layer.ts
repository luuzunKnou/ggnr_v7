/**
 * fms_linkage.bastb_master / mantb_dign_result → layer.road_fms_facility / road_fms_inspection
 * (상하수도·도로·건축물 모두 도로 테이블 한 쌍, 구분은 facil_gbn)
 * 사용: npx tsx scripts/migrate-fms-data-to-layer.ts build_uj dev
 */
import { loadProjectEnv } from './load-project-env';
import { FMS_FACILITY_TABLE, FMS_INSPECTION_TABLE } from '../src/lib/fmsLinkage/fmsBinding';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

const FACILITY_COLS = [
  'facil_no',
  'facil_nm',
  'mng_no',
  'mng_main_cd',
  'permit_org_cd',
  'facil_owner',
  'route_class',
  'route_detail',
  'facil_class',
  'facil_gbn',
  'facil_kind',
  'facil_desc_cd',
  'addr_sido',
  'addr_gugun',
  'addr_dong',
  'addr_detail',
  'cpl_ymd',
  'temp_ymd',
  'rsp_to_ymd',
  'design_ymd_from',
  'design_ymd_to',
  'designer_nm',
  'const_ymd_from',
  'const_ymd_to',
  'constractor_cd',
  'constractor_nm',
  'const_amt',
  'spv_ymd_from',
  'spv_ymd_to',
  'supervisor_nm',
  'const_order_cd',
  'const_order_nm',
  'const_nm',
  'const_spvsr_nm',
  'dsn_book_st_yn',
  'eq_dsn_app_yn',
  'gam_reason_cd',
  'whl_pht_file_ct',
  'etc_pht_file_ct',
  'upper_no',
  'lnk_facil_no',
  'etc_remark',
  'addr_full',
] as const;

const INSPECTION_COLS = [
  'facil_no',
  'dign_seq',
  'start_ymd',
  'end_ymd',
  'dign_gbn',
  'regular_gbn',
  'rep_engineer_nm',
  'dign_amt',
  'state_grade',
  'dign_content',
  'amend_content',
  'wrt_ymd',
  'wrt_person_nm',
] as const;

async function main() {
  const { db } = await import('../src/database/db');
  const { sql } = await import('drizzle-orm');
  const { ensureFmsTables } = await import('../src/service/ensureLayerAppTables');

  console.log('[migrate-fms] project=', project, 'tables=', FMS_FACILITY_TABLE, FMS_INSPECTION_TABLE);

  const ensureResult = await ensureFmsTables();
  for (const t of ensureResult.created) console.log('[created]', t);
  for (const t of ensureResult.existed) console.log('[exists]', t);
  for (const t of ensureResult.errors) console.error('[error]', t);
  if (ensureResult.errors.length) process.exit(1);

  const legacyFacility = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='fms_linkage' AND table_name='bastb_master' LIMIT 1`
    )
  );
  const hasLegacyFacility = (legacyFacility.rows?.length ?? 0) > 0;

  const legacyInspection = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='fms_linkage' AND table_name='mantb_dign_result' LIMIT 1`
    )
  );
  const hasLegacyInspection = (legacyInspection.rows?.length ?? 0) > 0;

  if (!hasLegacyFacility && !hasLegacyInspection) {
    console.log('[migrate-fms] legacy data tables not found — tables ensured only');
    process.exit(0);
  }

  const facilitySelect = FACILITY_COLS.join(', ');
  const inspectionSelect = INSPECTION_COLS.join(', ');

  if (hasLegacyFacility) {
    await db.execute(sql.raw(`TRUNCATE TABLE layer.${FMS_FACILITY_TABLE}`));
    const ins = await db.execute(
      sql.raw(`
        INSERT INTO layer.${FMS_FACILITY_TABLE} (${facilitySelect}, sync_status, synced_at, created_at, updated_at)
        SELECT ${facilitySelect}, 'migrated', now(), now(), now()
        FROM fms_linkage.bastb_master
      `)
    );
    console.log(`[copied] ${FMS_FACILITY_TABLE} rows=${ins.rowCount ?? '?'}`);
  }

  if (hasLegacyInspection) {
    await db.execute(sql.raw(`TRUNCATE TABLE layer.${FMS_INSPECTION_TABLE}`));
    const ins = await db.execute(
      sql.raw(`
        INSERT INTO layer.${FMS_INSPECTION_TABLE} (${inspectionSelect}, sync_status, synced_at, created_at, updated_at)
        SELECT ${inspectionSelect}, 'migrated', now(), now(), now()
        FROM fms_linkage.mantb_dign_result
      `)
    );
    console.log(`[copied] ${FMS_INSPECTION_TABLE} rows=${ins.rowCount ?? '?'}`);
  }

  if (hasLegacyFacility) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS fms_linkage.bastb_master`));
    console.log('[dropped] fms_linkage.bastb_master');
  }
  if (hasLegacyInspection) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS fms_linkage.mantb_dign_result`));
    console.log('[dropped] fms_linkage.mantb_dign_result');
  }

  console.log('[done] FMS data migrated to layer');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
