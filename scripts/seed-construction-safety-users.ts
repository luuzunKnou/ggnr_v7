/**
 * 건설안전과 사용자 일괄 등록·갱신.
 * 아이디·임시 비밀번호 = 성명. 권한 없음. 최초 로그인 시 비밀번호 변경.
 * 재실행 시 부서·팀·성명만 맞추고, 이미 있는 계정의 비밀번호는 유지한다.
 *
 * 사용: npx tsx scripts/seed-construction-safety-users.ts build_yy dev
 *       npx tsx scripts/seed-construction-safety-users.ts build_yy demo
 */
import pg from 'pg';
import bcrypt from 'bcrypt';
import { loadProjectEnv } from './load-project-env';
import { hangulNameToQwerty } from '../src/lib/auth/hangulQwerty';

const SALT_ROUNDS = 10;
const DEPT = '건설안전과';

const USERS: { team: string; name: string }[] = [
  { team: '건설안전과', name: '백인흠' },
  { team: '건설행정팀', name: '심영희' },
  { team: '건설행정팀', name: '김혜진' },
  { team: '건설행정팀', name: '김승현' },
  { team: '안전관리팀', name: '이현규' },
  { team: '안전관리팀', name: '구덕모' },
  { team: '안전관리팀', name: '김진우' },
  { team: '재난방재팀', name: '황형구' },
  { team: '재난방재팀', name: '이재진' },
  { team: '재난방재팀', name: '김주엽' },
  { team: '재난방재팀', name: '김현민' },
  { team: '도로팀', name: '이창훈' },
  { team: '도로팀', name: '조현주' },
  { team: '도로팀', name: '이재근' },
  { team: '도로팀', name: '김수현' },
  { team: '하천팀', name: '최정웅' },
  { team: '하천팀', name: '박근호' },
  { team: '하천팀', name: '김건우' },
];

/** 조직도 성명: 과장 백인흠 */
const RENAME_IDS: { from: string; to: string }[] = [{ from: '백인홍', to: '백인흠' }];

/** usr_id 자식. uniqueCol 이 있으면 대상 계정과 키가 겹치는 옛 행은 삭제 후 이전 */
const CHILD_USR_ID_TABLES: { table: string; uniqueCol?: string }[] = [
  { table: 'up_map', uniqueCol: 'perm_key' },
  { table: 'usr_sys_grant', uniqueCol: 'sys_key' },
  { table: 'usr_ser_grant', uniqueCol: 'ser_eng' },
  { table: 'usr_access_request' },
  { table: 'usr_biz_notif_state', uniqueCol: 'notif_key' },
  { table: 'shooting_request' },
];

function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

async function tableExists(client: pg.Client, name: string): Promise<boolean> {
  const r = await client.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return r.rows[0]?.t != null;
}

async function remapUsrIdChildren(client: pg.Client, from: string, to: string): Promise<void> {
  for (const { table, uniqueCol } of CHILD_USR_ID_TABLES) {
    if (!(await tableExists(client, table))) continue;
    if (uniqueCol) {
      await client.query(
        `DELETE FROM ${table} a
         WHERE a.usr_id = $2
           AND EXISTS (
             SELECT 1 FROM ${table} b
             WHERE b.usr_id = $1 AND b.${uniqueCol} IS NOT DISTINCT FROM a.${uniqueCol}
           )`,
        [to, from]
      );
    }
    await client.query(`UPDATE ${table} SET usr_id = $1 WHERE usr_id = $2`, [to, from]);
  }
  if (await tableExists(client, 'login_log')) {
    await client.query(`UPDATE login_log SET login_user = $1 WHERE login_user = $2`, [to, from]);
  }
  if (await tableExists(client, 'user_log')) {
    await client.query(`UPDATE user_log SET ul_user = $1 WHERE ul_user = $2`, [to, from]);
    await client.query(`UPDATE user_log SET ul_work_user = $1 WHERE ul_work_user = $2`, [to, from]);
  }
}

async function renameUsrId(client: pg.Client, from: string, to: string): Promise<string> {
  const oldRow = await client.query(`SELECT usr_id FROM usr WHERE usr_id = $1`, [from]);
  if (!oldRow.rowCount) return `rename skip: ${from} 없음`;
  const newRow = await client.query(`SELECT usr_id FROM usr WHERE usr_id = $1`, [to]);
  await remapUsrIdChildren(client, from, to);
  if (newRow.rowCount) {
    await client.query(`DELETE FROM usr WHERE usr_id = $1`, [from]);
    return `rename: ${from} 삭제 (이미 ${to} 있음, 자식 행 이전)`;
  }

  await client.query(
    `UPDATE usr SET usr_id = $1, usr_name = $1 WHERE usr_id = $2`,
    [to, from]
  );
  return `rename: ${from} → ${to}`;
}

async function seed(project: string, type: string): Promise<string> {
  loadProjectEnv(project, type);
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : 5432;
  const database = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;
  if (!host || !database || !user) {
    throw new Error(`${project} [${type}] DATABASE_* 가 없습니다.`);
  }

  const client = new pg.Client({
    host,
    port,
    database,
    user,
    password,
    connectionTimeoutMillis: 8000,
  });
  await client.connect();

  const sqlParts: string[] = [
    `-- 건설안전과 사용자 (${USERS.length}명) — 임시 비밀번호 = 성명을 영문 자판으로 친 값`,
    `-- ${project} [${type}] ${host}:${port}/${database}`,
  ];

  try {
    await client.query('BEGIN');

    for (const r of RENAME_IDS) {
      const msg = await renameUsrId(client, r.from, r.to);
      console.log(`[seed] ${msg}`);
    }

    await client.query(
      `INSERT INTO ug (ug_name, ug_is_del, ug_is_hidden) VALUES ($1, false, false) ON CONFLICT (ug_name) DO NOTHING`,
      [DEPT]
    );

    const teams = [...new Set(USERS.map((u) => u.team))];
    for (const team of teams) {
      await client.query(
        `INSERT INTO ut (ut_name, ug_name, ut_is_del, ut_is_hidden)
         VALUES ($1, $2, false, false) ON CONFLICT (ut_name) DO NOTHING`,
        [team, DEPT]
      );
    }

    let inserted = 0;
    let updated = 0;
    for (const u of USERS) {
      const tempPwd = hangulNameToQwerty(u.name);
      const hash = await bcrypt.hash(tempPwd, SALT_ROUNDS);
      const result = await client.query(
        `INSERT INTO usr (usr_id, ug_name, ut_name, usr_name, usr_pwd, usr_is_del, usr_is_hidden, usr_ok_time)
         VALUES ($1, $2, $3, $1, $4, false, false, NOW())
         ON CONFLICT (usr_id) DO UPDATE SET
           ug_name = EXCLUDED.ug_name,
           ut_name = EXCLUDED.ut_name,
           usr_name = EXCLUDED.usr_name,
           usr_is_del = false,
           usr_is_hidden = false,
           usr_ok_time = COALESCE(usr.usr_ok_time, EXCLUDED.usr_ok_time)
         RETURNING (xmax = 0) AS inserted`,
        [u.name, DEPT, u.team, hash]
      );
      if (result.rows[0]?.inserted) inserted += 1;
      else updated += 1;
    }

    await client.query('COMMIT');
    console.log(`[seed] ${project} [${type}] ${host}:${port}/${database} — 추가 ${inserted}, 갱신 ${updated}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }

  return sqlParts.join('\n');
}

async function main() {
  const project = (process.argv[2] ?? 'build_yy').trim();
  const types = process.argv.slice(3).map((s) => s.trim()).filter(Boolean);
  const targets = types.length ? types : ['dev'];
  for (const type of targets) {
    await seed(project, type);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
