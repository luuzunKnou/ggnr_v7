/**
 * usr.usr_login_fail_cnt 컬럼 추가 (없을 때만).
 * 사용: npx tsx scripts/add-usr-login-fail-cnt-column.ts build_yy dev
 */
import pg from 'pg';
import { loadProjectEnv } from './load-project-env';

async function connectWithRetry(factory: () => pg.Client, tries = 4): Promise<pg.Client> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const client = factory();
    try {
      await client.connect();
      return client;
    } catch (e) {
      last = e;
      try {
        client.end().catch(() => {});
      } catch {
        /* ignore */
      }
      const code = (e as { code?: string })?.code;
      if (code === '57P03' || String(e).includes('timeout')) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

async function main() {
  const project = process.argv[2]?.trim();
  const type = process.argv[3]?.trim() || 'dev';
  if (!project) {
    console.error('usage: npx tsx scripts/add-usr-login-fail-cnt-column.ts <project> [dev|demo|…]');
    process.exit(1);
  }

  loadProjectEnv(project, type);
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : 5432;
  const database = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;
  if (!host || !database || !user) {
    throw new Error(`${project} [${type}] DATABASE_* 가 없습니다.`);
  }

  const client = await connectWithRetry(
    () =>
      new pg.Client({
        host,
        port,
        database,
        user,
        password,
        connectionTimeoutMillis: 20000,
      })
  );

  try {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'usr' AND column_name = 'usr_login_fail_cnt'`
    );
    if (exists.rowCount) {
      console.log(`[${project}/${type}] usr_login_fail_cnt already exists`);
      return;
    }
    await client.query(
      `ALTER TABLE usr ADD COLUMN usr_login_fail_cnt integer DEFAULT 0`
    );
    await client.query(`UPDATE usr SET usr_login_fail_cnt = 0 WHERE usr_login_fail_cnt IS NULL`);
    console.log(`[${project}/${type}] added usr_login_fail_cnt`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
