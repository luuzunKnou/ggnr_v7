import type { Config } from 'drizzle-kit';

// 데이터베이스 연결 정보 (우선순위: 이 변수 > 환경 변수)
const DB_CONFIG = {
  host: 'localhost',
  port: 5433,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
} as const;

export default {
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: DB_CONFIG.host || process.env.DATABASE_HOST || 'localhost',
    port: DB_CONFIG.port || parseInt(process.env.DATABASE_PORT || '5432', 10),
    user: DB_CONFIG.user || process.env.DATABASE_USER || '',
    password: DB_CONFIG.password || process.env.DATABASE_PASSWORD || '',
    database: DB_CONFIG.database || process.env.DATABASE_NAME || '',
    ssl: false,
  },
} satisfies Config;
