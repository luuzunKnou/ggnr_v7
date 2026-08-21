/**
 * fms_linkage.bastb_master / mantb_dign_result → layer.{prefix}_fms_facility / _fms_inspection
 * 사용: npx tsx scripts/migrate-fms-data-to-layer.ts build_uj dev
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from './load-project-env';
import { getFmsPrefixesForEnabledSystems } from '../src/lib/fmsLinkage/fmsBinding';

const project = process.argv[2] || 'build_uj';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

function readEnabledSystemsFromRuntime(): string[] | null {
  const filePath = path.join(
    process.cwd(),
    'src',
    'config',
    'projects',
    `${project}.runtime.env`
  );
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!trimmed.startsWith('ENABLED_SYSTEMS=')) continue;
    const raw = trimmed.slice('ENABLED_SYSTEMS='.length).trim();
    if (!raw) return null;
    const keys = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return keys.length ? keys : null;
  }
  return null;
}

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

  const enabledSystems = readEnabledSystemsFromRuntime();
  const prefixes = getFmsPrefixesForEnabledSystems(enabledSystems);
  console.log('[migrate-fms] project=', project, 'prefixes=', prefixes.join(','));

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

  for (const prefix of prefixes) {
    const facilityTable = `${prefix}_fms_facility`;
    const inspectionTable = `${prefix}_fms_inspection`;

    if (hasLegacyFacility) {
      await db.execute(sql.raw(`TRUNCATE TABLE layer.${facilityTable}`));
      const ins = await db.execute(
        sql.raw(`
          INSERT INTO layer.${facilityTable} (${facilitySelect}, sync_status, synced_at, created_at, updated_at)
          SELECT ${facilitySelect}, 'migrated', now(), now(), now()
          FROM fms_linkage.bastb_master
        `)
      );
      console.log(`[copied] ${facilityTable} rows=${ins.rowCount ?? '?'}`);
    }

    if (hasLegacyInspection) {
      await db.execute(sql.raw(`TRUNCATE TABLE layer.${inspectionTable}`));
      const ins = await db.execute(
        sql.raw(`
          INSERT INTO layer.${inspectionTable} (${inspectionSelect}, sync_status, synced_at, created_at, updated_at)
          SELECT ${inspectionSelect}, 'migrated', now(), now(), now()
          FROM fms_linkage.mantb_dign_result
        `)
      );
      console.log(`[copied] ${inspectionTable} rows=${ins.rowCount ?? '?'}`);
    }
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
