/**
 * FMS 시설 geom 재적재 (기존 backfill과 동일)
 * 사용: npx tsx scripts/fix-fms-point-buffer-geom.ts build_yy dev
 *
 * (과거) 점 버퍼 거절용이었으나, 거절 로직 제거 후 일반 backfill 진입점으로 유지
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_yy';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);

function loadRuntimeEnv(projectName: string): void {
  const dir = path.join(process.cwd(), 'src', 'config', 'projects');
  const apply = (filePath: string) => {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) (process.env as Record<string, string>)[key] = value;
    }
  };
  apply(path.join(dir, 'common.runtime.env'));
  apply(path.join(dir, `${projectName}.runtime.env`));
}

loadRuntimeEnv(project);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

async function main() {
  const { backfillFmsFacilityGeom } = await import('../src/lib/fmsLinkage/backfillFacilityGeom');
  const { pool } = await import('../src/database/db');

  console.log(`[fix-fms-point-buffer] project=${project} type=${type} — backfill null geoms`);

  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND usename = current_user
          AND pid <> pg_backend_pid()
          AND state = 'idle'`
    );
  } catch {
    /* ignore */
  }

  const result = await backfillFmsFacilityGeom({ limit: 5000 });
  console.log(JSON.stringify(result, null, 2));

  const check = await pool.query(
    `SELECT facil_no, facil_nm, geom IS NOT NULL AS has_geom
       FROM layer.road_fms_facility
      WHERE facil_no IN ('BR1977-0000043', 'BR1980-0000372')
      ORDER BY facil_no`
  );
  console.log('[fix-fms-point-buffer] target', check.rows);

  await pool.end();
  if (result.error) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
