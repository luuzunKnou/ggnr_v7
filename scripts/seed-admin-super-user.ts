/**
 * 슈퍼계정 admin 시드 (su 와 동일 권한은 코드 isSuperUser).
 * 사용: npx tsx scripts/seed-admin-super-user.ts build_yy dev
 */
import pg from 'pg';
import bcrypt from 'bcrypt';
import { loadProjectEnv } from './load-project-env';

const SALT_ROUNDS = 10;
const USR_ID = 'admin';
const USR_NAME = '관리자';
const UG_NAME = '관리자';
const UT_NAME = '관리자';
const PLAIN_PWD = 'admin00!!';

async function connectWithRetry(
  factory: () => pg.Client,
  tries = 4
): Promise<pg.Client> {
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
    console.error('usage: npx tsx scripts/seed-admin-super-user.ts <project> [dev|demo|…]');
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
    await client.query(
      `INSERT INTO ug (ug_name, ug_is_del, ug_is_hidden)
       VALUES ($1, false, false)
       ON CONFLICT (ug_name) DO UPDATE SET ug_is_del = false, ug_is_hidden = false`,
      [UG_NAME]
    );
    await client.query(
      `INSERT INTO ut (ut_name, ug_name, ut_is_del, ut_is_hidden)
       VALUES ($1, $2, false, false)
       ON CONFLICT (ut_name) DO UPDATE SET ug_name = EXCLUDED.ug_name, ut_is_del = false, ut_is_hidden = false`,
      [UT_NAME, UG_NAME]
    );

    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'usr'`
    );
    const colSet = new Set(cols.rows.map((r) => r.column_name));

    const hashed = await bcrypt.hash(PLAIN_PWD, SALT_ROUNDS);
    const existing = await client.query(`SELECT usr_id FROM usr WHERE usr_id = $1`, [USR_ID]);
    if (existing.rowCount) {
      const sets: string[] = [
        'ug_name = $1',
        'ut_name = $2',
        'usr_name = $3',
        'usr_pwd = $4',
        'usr_is_del = false',
        'usr_is_hidden = false',
      ];
      if (colSet.has('usr_ok_time')) sets.push('usr_ok_time = COALESCE(usr_ok_time, NOW())');
      if (colSet.has('usr_req_time')) sets.push('usr_req_time = NULL');
      if (colSet.has('usr_cancle_time')) sets.push('usr_cancle_time = NULL');
      if (colSet.has('usr_reject_reason')) sets.push('usr_reject_reason = NULL');
      await client.query(
        `UPDATE usr SET ${sets.join(', ')} WHERE usr_id = $5`,
        [UG_NAME, UT_NAME, USR_NAME, hashed, USR_ID]
      );
      console.log(`[${project}/${type}] updated ${USR_ID}`);
    } else {
      await client.query(
        `INSERT INTO usr (
           usr_id, ug_name, ut_name, usr_name, usr_pwd,
           usr_is_del, usr_is_hidden, usr_ok_time
         ) VALUES ($1, $2, $3, $4, $5, false, false, NOW())`,
        [USR_ID, UG_NAME, UT_NAME, USR_NAME, hashed]
      );
      console.log(`[${project}/${type}] inserted ${USR_ID}`);
    }

    const check = await client.query(
      `SELECT usr_id, usr_name, ug_name, ut_name,
              usr_ok_time IS NOT NULL AS ok,
              usr_is_del, usr_is_hidden
       FROM usr WHERE usr_id = $1`,
      [USR_ID]
    );
    console.log(JSON.stringify(check.rows[0], null, 2));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
