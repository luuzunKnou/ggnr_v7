import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// 환경 변수에서 데이터베이스 연결 정보 가져오기
const getDatabaseConfig = () => {
  // DATABASE_URL이 있으면 우선 사용
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
    };
  }

  // 개별 환경 변수 사용
  return {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  };
};

// PostgreSQL 연결 풀 생성
const pool = new Pool(getDatabaseConfig());

// 연결 풀 이벤트 핸들러
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Drizzle 클라이언트 생성
export const db = drizzle(pool, { schema });

// 연결 풀 종료 함수
export async function closePool(): Promise<void> {
  await pool.end();
}

export default db;
