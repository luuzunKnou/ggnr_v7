/**
 * 슈퍼유저로 프로젝트 DB 사용자·DB 생성
 * - run.ts에서 자동 호출 시: postgres/postgres 하드코딩
 * - CLI: PG_SUPER_PASSWORD=비밀번호 npm run db:create-user -- river_yd dev
 */
import pg from 'pg';
import { getProjectEnvVars } from './load-project-env';

const SUPER_USER = 'postgres';
const SUPER_PASSWORD = 'postgres';

export type EnsureDbUserOptions = {
  superUser?: string;
  superPassword?: string;
};

/**
 * 프로젝트 env 기준으로 DB 사용자·DB가 없으면 생성 (슈퍼유저 사용)
 */
export async function ensureDbUser(
  project: string,
  type: string,
  options: EnsureDbUserOptions = {}
): Promise<void> {
  const superUser = options.superUser ?? SUPER_USER;
  const superPassword = options.superPassword ?? SUPER_PASSWORD;

  const vars = getProjectEnvVars(project, type);
  const dbHost = vars.DATABASE_HOST || 'localhost';
  const dbPort = parseInt(vars.DATABASE_PORT || '5432', 10);
  const dbName = vars.DATABASE_NAME;
  const dbUser = vars.DATABASE_USER;
  const dbPassword = vars.DATABASE_PASSWORD;

  if (!dbName || !dbUser || !dbPassword) {
    throw new Error(
      `src/config/projects/${project}.env [${type}]에 DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD 가 필요합니다.`
    );
  }

  const client = new pg.Client({
    host: dbHost,
    port: dbPort,
    database: 'postgres',
    user: superUser,
    password: superPassword,
  });

  await client.connect();

  // PASSWORD는 바인드 파라미터 미지원이므로 이스케이프 후 리터럴 사용
  const passwordEscaped = dbPassword.replace(/'/g, "''");

  try {
    // 1) 사용자 생성 (이미 있으면 무시)
    try {
      await client.query(`CREATE ROLE "${dbUser}" WITH LOGIN PASSWORD '${passwordEscaped}'`);
      console.log('[run] DB 사용자 생성됨:', dbUser);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code !== '42710') throw e;
    }

    // 2) DB 생성 (이미 있으면 무시)
    try {
      await client.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`);
      console.log('[run] DB 생성됨:', dbName);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code !== '42P04') throw e;
    }
  } finally {
    await client.end();
  }

  // 3) 새 DB에 연결해 PostGIS 확장 설치(슈퍼유저만 가능) 후 public 스키마 권한 부여
  const client2 = new pg.Client({
    host: dbHost,
    port: dbPort,
    database: dbName,
    user: superUser,
    password: superPassword,
  });
  await client2.connect();
  try {
    await client2.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await client2.query(`GRANT ALL ON SCHEMA public TO "${dbUser}"`);
    await client2.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${dbUser}"`);
    await client2.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${dbUser}"`);
    await client2.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${dbUser}"`);

    // layer, public_layer 스키마 생성 및 앱 유저 권한 부여 (GeoServer/레이어 테이블용)
    await client2.query('CREATE SCHEMA IF NOT EXISTS layer');
    await client2.query('CREATE SCHEMA IF NOT EXISTS public_layer');
    await client2.query(`GRANT USAGE ON SCHEMA layer TO "${dbUser}"`);
    await client2.query(`GRANT USAGE ON SCHEMA public_layer TO "${dbUser}"`);
    await client2.query(`GRANT CREATE ON SCHEMA layer TO "${dbUser}"`);
    await client2.query(`GRANT CREATE ON SCHEMA public_layer TO "${dbUser}"`);
    console.log('[run] 스키마 생성됨: layer, public_layer');
  } finally {
    await client2.end();
  }
}

// CLI: 이 파일을 직접 실행했을 때만 실행 (run.ts에서 import 시에는 실행 안 함)
const isCli = typeof process.argv[1] === 'string' && process.argv[1].includes('create-db-user');
if (isCli) {
  const project = process.argv[2];
  const type = process.argv[3] || 'dev';
  if (!project) {
    console.error('Usage: PG_SUPER_PASSWORD=<슈퍼유저비밀번호> npm run db:create-user -- <project> [type]');
    process.exit(1);
  }
  const superPassword = process.env.PG_SUPER_PASSWORD;
  if (!superPassword) {
    console.error('슈퍼유저 비밀번호: PG_SUPER_PASSWORD=비밀번호');
    process.exit(1);
  }
  ensureDbUser(project, type, {
    superUser: process.env.PG_SUPER_USER || 'postgres',
    superPassword,
  })
    .then(() => console.log('[db:create-user] 완료.'))
    .catch((err) => {
      console.error('[db:create-user] 오류:', err);
      process.exit(1);
    });
}
