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

function resolvePoolMax(): number {
  const raw = String(process.env.DATABASE_POOL_MAX ?? '').trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  // 기본 5 — Next/Turbopack HMR·다중 프로세스에서 공유 DB 53300(too_many_connections) 완화
  if (Number.isFinite(n) && n >= 1 && n <= 50) return n;
  return 5;
}

type GlobalPg = typeof globalThis & { __ggnrPgPool?: Pool };
type InstrumentedPool = Pool & { __ggnrInstrumented?: boolean };

/**
 * HMR마다 모듈이 재실행돼도 pool 싱글톤은 유지됨.
 * query 래핑·error 리스너를 매번 붙이면 중첩/누적 → Failed query·MaxListeners 유발.
 * 풀 인스턴스당 1회만 계측한다.
 */
function instrumentPoolOnce(pool: Pool): void {
  const p = pool as InstrumentedPool;
  if (p.__ggnrInstrumented) return;
  p.__ggnrInstrumented = true;

  const SQL_LOG_ENABLED = (() => {
    const v = String(process.env.DB_QUERY_LOG ?? process.env.SQL_LOG ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  })();

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
    const result =
      callback != null
        ? (originalQuery as (c: unknown, v?: unknown, cb?: unknown) => void)(config, values, callback)
        : (originalQuery as (c: unknown, v?: unknown) => Promise<{ rows?: QueryResultRow[] }>)(
            config,
            values
          );
    if (SQL_LOG_ENABLED && result != null && typeof (result as Promise<unknown>)?.then === 'function') {
      return (result as Promise<{ rows?: QueryResultRow[] }>).then((res) => {
        const rows = res?.rows ?? [];
        console.log('[SQL Result]', Array.isArray(rows) ? rows.length : 0, 'rows');
        return res;
      });
    }
    return result;
  };

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });
}

function getOrCreatePool(): Pool {
  const g = globalThis as GlobalPg;
  // HMR 시 모듈이 다시 로드돼도 풀을 재사용 (미종료 연결 누적 → 53300 방지)
  if (g.__ggnrPgPool) {
    instrumentPoolOnce(g.__ggnrPgPool);
    return g.__ggnrPgPool;
  }

  const pool = new Pool({
    ...getDatabaseConfig(),
    max: resolvePoolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  instrumentPoolOnce(pool);
  g.__ggnrPgPool = pool;
  return pool;
}

// PostgreSQL 연결 풀 (프로세스당 싱글톤)
const pool = getOrCreatePool();

// Drizzle 클라이언트 생성
export const db = drizzle(pool, { schema });

/** 파라미터 바인딩 쿼리용 (예: 긴 INSERT 시 쿼리 절단 방지) */
export { pool };

// 연결 풀 종료 함수
export async function closePool(): Promise<void> {
  const g = globalThis as GlobalPg;
  await pool.end();
  if (g.__ggnrPgPool === pool) delete g.__ggnrPgPool;
}

export default db;
