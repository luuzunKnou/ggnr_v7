import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type QueryResultRow } from 'pg';
import * as schema from './schema';

// 환경 변수에서 데이터베이스 연결 정보 가져오기 (프로젝트 env 개별 변수가 있으면 DATABASE_URL보다 우선)
const getDatabaseConfig = () => {
  const hasIndividual =
    process.env.DATABASE_HOST != null &&
    process.env.DATABASE_NAME != null &&
    process.env.DATABASE_NAME !== '';
  if (hasIndividual) {
    return {
      host: process.env.DATABASE_HOST,
      port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : undefined,
      database: process.env.DATABASE_NAME,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
    };
  }
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : undefined,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  };
};

// PostgreSQL 연결 풀 생성
const pool = new Pool(getDatabaseConfig());

/** SQL 콘솔 로그는 기본 비활성. 필요할 때만 env로 켬. */
const SQL_LOG_ENABLED = (() => {
  const v = String(process.env.DB_QUERY_LOG ?? process.env.SQL_LOG ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
})();

// 모든 서비스의 pool.query를 래핑 (SQL 로그는 옵션)
const originalQuery = pool.query.bind(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pool as any).query = function (config: unknown, values?: unknown, callback?: unknown): unknown {
  if (SQL_LOG_ENABLED) {
    const first = typeof config === 'string' ? config : (config as Record<string, unknown>);
    const text =
      typeof first === 'string'
        ? first
        : first?.text != null
          ? String(first.text)
          : first?.sql != null
            ? String(first.sql)
            : typeof first === 'object' && first !== null
              ? JSON.stringify(first).slice(0, 500)
              : String(config);
    console.log('[SQL]', text);
  }
  const result = callback != null
    ? (originalQuery as (c: unknown, v?: unknown, cb?: unknown) => void)(config, values, callback)
    : (originalQuery as (c: unknown, v?: unknown) => Promise<{ rows?: QueryResultRow[] }>)(config, values);
  if (SQL_LOG_ENABLED && result != null && typeof (result as Promise<unknown>)?.then === 'function') {
    return (result as Promise<{ rows?: QueryResultRow[] }>).then((res) => {
      const rows = res?.rows ?? [];
      console.log('[SQL Result]', Array.isArray(rows) ? rows.length : 0, 'rows');
      return res;
    });
  }
  return result;
};

// 연결 풀 이벤트 핸들러
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Drizzle 클라이언트 생성
export const db = drizzle(pool, { schema });

/** 파라미터 바인딩 쿼리용 (예: 긴 INSERT 시 쿼리 절단 방지) */
export { pool };

// 연결 풀 종료 함수
export async function closePool(): Promise<void> {
  await pool.end();
}

export default db;
