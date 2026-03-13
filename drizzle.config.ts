import type { Config } from 'drizzle-kit';
import { loadProjectEnv } from './scripts/load-project-env';

// GGNR_PROJECT + GGNR_ENV 가 있으면 src/config/projects/<project>.env 의 [section] 로드
// 예: run.ts 사용 시 자동 설정. 단독 push 시엔 npm run db:push:project -- river_yd dev
const project = process.env.GGNR_PROJECT;
const envType = process.env.GGNR_ENV;
if (project && envType) {
  loadProjectEnv(project, envType);
}

export default {
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : undefined,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: false,
  },
  // PostGIS 확장 테이블은 비교/관리 대상에서 제외 → 리네임 질문 안 뜸
  extensionsFilters: ['postgis'],
  tablesFilter: [
    '!spatial_ref_sys',
    '!geometry_columns',
    '!geography_columns',
    '!raster_columns',
    '!raster_overviews',
  ],
} as Config;
