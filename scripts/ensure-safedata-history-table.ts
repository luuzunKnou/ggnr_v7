/**
 * public.safedata_history 테이블만 생성 (IF NOT EXISTS)
 * 사용: npx tsx scripts/ensure-safedata-history-table.ts build_yy dev
 */
import { loadProjectEnv } from './load-project-env';

const project = process.argv[2] || 'build_yy';
const type = process.argv[3] || 'dev';
loadProjectEnv(project, type);
process.env.GGNR_PROJECT = project;
process.env.GGNR_ENV = type;

async function main() {
  const { sql } = await import('drizzle-orm');
  const { db } = await import('../src/database/db');

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS public.safedata_history (
      history_key serial PRIMARY KEY NOT NULL,
      his_gubun varchar NOT NULL,
      ftr_idn varchar NOT NULL,
      his_contents text NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      created_by varchar NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS safedata_history_gubun_ftr_idx
      ON public.safedata_history (his_gubun, ftr_idn)
  `);
  await db.execute(sql`
    COMMENT ON TABLE public.safedata_history IS '재난대응시설 이력'
  `);
  console.log(`[ensure-safedata-history] ok — ${project} ${type}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[ensure-safedata-history] failed', e);
  process.exit(1);
});
