/**
 * 권한 «팀장» 시드 (없으면 추가).
 * 사용: npx tsx scripts/seed-team-leader-perm.ts build_yy dev
 */
import pg from 'pg';
import { loadProjectEnv } from './load-project-env';

const PERM_NAME = '팀장';

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
    console.error('usage: npx tsx scripts/seed-team-leader-perm.ts <project> [dev|demo|…]');
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
    const existing = await client.query(
      `SELECT perm_key, perm_name FROM perm WHERE perm_name = $1 LIMIT 1`,
      [PERM_NAME]
    );
    let permKey: number;
    if (existing.rowCount) {
      permKey = Number(existing.rows[0].perm_key);
      console.log(`[${project}/${type}] exists ${PERM_NAME} key=${permKey}`);
    } else {
      const inserted = await client.query(
        `INSERT INTO perm (perm_name, perm_is_hidden, perm_etc)
         VALUES ($1, false, $2)
         RETURNING perm_key, perm_name`,
        [PERM_NAME, '부서 팀장 — 사용자관리 공통 권한·데이터 요청 승인']
      );
      permKey = Number(inserted.rows[0].perm_key);
      console.log(`[${project}/${type}] inserted`, inserted.rows[0]);
    }

    // 이미 «팀장»을 가진 사용자는 부서관리자 플래그 맞춤
    const synced = await client.query(
      `UPDATE usr u
       SET usr_is_manager = EXISTS (
         SELECT 1 FROM up_map m
         WHERE m.usr_id = u.usr_id AND m.perm_key = $1
       )
       WHERE COALESCE(u.usr_is_del, false) = false`,
      [permKey]
    );
    console.log(`[${project}/${type}] usr_is_manager sync rowCount=${synced.rowCount ?? 0}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
