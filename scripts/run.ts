/**
 * 프로젝트·환경별 env 로드 → DB 확장(PostGIS) 및 테이블 생성 → Next 서버 실행
 * 사용: npm run dev -- river_yd dev  |  npm run start -- river_yd prod
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ensureDbUser } from './create-db-user';
import { loadProjectEnv } from './load-project-env';

const COMMAND = process.argv[2]; // dev | start
const PROJECT = process.argv[3]; // e.g. river_yd
const TYPE = process.argv[4]; // dev | demo | prod

/** src/config/projects/<project>.runtime.env 의 KEY=VALUE 를 process.env 에 병합 */
function loadRuntimeEnv(projectName: string): void {
  const root = process.cwd();
  const filePath = path.join(root, 'src', 'config', 'projects', `${projectName}.runtime.env`);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) (process.env as Record<string, string>)[key] = value;
  }
}

function usage(): never {
  console.error(`
Usage: npm run dev -- <project> <type>   # 개발 서버 (DB 셋업 후 next dev)
       npm run start -- <project> <type>  # 운영 서버 (DB 셋업 후 next start)

  project  e.g. river_yd, ggnr_ad, ggnr_yj, build_yy, build_uj
  type     dev | demo | prod (src/config/projects/<project>.env 의 [section] 이름)
`);
  process.exit(1);
}

async function setupDb(): Promise<void> {
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = parseInt(process.env.DATABASE_PORT || '5432', 10);
  const database = process.env.DATABASE_NAME || '';
  const user = process.env.DATABASE_USER || '';
  const password = process.env.DATABASE_PASSWORD || '';

  if (!database || !user) {
    console.warn('[run] DATABASE_NAME or DATABASE_USER not set; skipping DB setup.');
    return;
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ host, port, database, user, password });

  try {
    await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    console.log('[run] PostGIS extension ensured.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[run] DB setup (extension) failed:', msg);
    throw err;
  } finally {
    await client.end();
  }

  // drizzle.config.ts 의 extensionsFilters/tablesFilter 로 PostGIS 테이블 제외
  return new Promise((resolve, reject) => {
    const push = spawn('npx', ['drizzle-kit', 'push'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    push.on('error', reject);
    push.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`drizzle-kit push exited ${code}`))));
  });
}

function runNext(cmd: 'dev' | 'start'): void {
  const nextBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next');
  // Windows: 경로 공백 시 shell:true 가 경로를 쪼개므로 따옴표로 감싼다
  const bin = process.platform === 'win32' ? `"${nextBin}"` : nextBin;
  const proc = spawn(bin, [cmd], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  proc.on('error', (err) => {
    console.error('[run] Next failed:', err);
    process.exit(1);
  });
  proc.on('close', (code) => process.exit(code ?? 0));
}

async function main(): Promise<void> {
  if (!COMMAND || !PROJECT || !TYPE) usage();
  if (COMMAND !== 'dev' && COMMAND !== 'start') usage();

  loadProjectEnv(PROJECT, TYPE);
  loadRuntimeEnv(PROJECT);
  if (!process.env.AUTH_SECRET?.trim() && !process.env.NEXTAUTH_SECRET?.trim()) {
    process.env.AUTH_SECRET = 'ggnr-dev-auth-secret-change-me';
  }
  process.env.GGNR_PROJECT = PROJECT;
  process.env.GGNR_ENV = TYPE;
  console.log(`[run] Loaded env: project=${PROJECT}, type=${TYPE}`);

  // 슈퍼유저(postgres/postgres)로 DB·사용자 없으면 생성
  await ensureDbUser(PROJECT, TYPE);

  await setupDb();

  // 스키마에 정의된 테이블/컬럼 코멘트를 DB에 적용 (DB Manager 불일치 방지)
  try {
    const { applyAllSchemaComments } = await import('../src/service/dbManagerService');
    const result = await applyAllSchemaComments();
    if (result.applied > 0) console.log('[run] 코멘트 적용:', result.applied, '건');
    if (result.error) console.warn('[run] 코멘트 적용 일부 실패:', result.error);
  } catch (e) {
    console.warn('[run] 코멘트 적용 스킵:', e instanceof Error ? e.message : e);
  }

  // GeoServer: 꺼져 있으면 기동 후, 워크스페이스 ggnr 고정·저장소(현재 프로젝트 env DB) 확인/갱신
  const geoUrl = process.env.GEOSERVER_URL || 'http://localhost:8080/geoserver';
  const tryGeoServerSetup = async (): Promise<boolean> => {
    try {
      const { setupGeoServerDb } = await import('../src/service/devTestService');
      const gs = await setupGeoServerDb({ workspace: 'ggnr', url: geoUrl });
      if (gs.success) {
        const created = gs.datastores?.filter((d) => d.status === 'created').length ?? 0;
        const updated = gs.datastores?.filter((d) => d.status === 'updated').length ?? 0;
        if (created > 0) console.log('[run] GeoServer 워크스페이스 ggnr 저장소 생성:', created, '건');
        if (updated > 0) console.log('[run] GeoServer 저장소 DB 연결 갱신:', updated, '건 (현재 프로젝트:', PROJECT, ')');
        return true;
      }
      console.warn('[run] GeoServer 설정 실패:', gs.error);
      return false;
    } catch (e) {
      console.warn('[run] GeoServer 연결 실패:', e instanceof Error ? e.message : e);
      return false;
    }
  };

  let geoOk = await tryGeoServerSetup();
  if (!geoOk) {
    try {
      const batPath = path.join(process.cwd(), 'geoserver_modules', 'scripts', 'start-geoserver.bat');
      if (fs.existsSync(batPath)) {
        console.log('[run] GeoServer 기동 시도...');
        const isWin = process.platform === 'win32';
        spawn(isWin ? 'cmd' : 'sh', isWin ? ['/c', batPath] : [batPath], {
          cwd: process.cwd(),
          detached: true,
          stdio: 'ignore',
          shell: true,
        }).unref();
        await new Promise((r) => setTimeout(r, 20000));
        geoOk = await tryGeoServerSetup();
        if (!geoOk) console.warn('[run] GeoServer 기동 후에도 설정 실패. 수동으로 npm run geoserver 후 재시도하세요.');
      }
    } catch (e) {
      console.warn('[run] GeoServer 기동 스킵:', e instanceof Error ? e.message : e);
    }
  }

  console.log('[run] DB setup done. Starting Next.js...');
  runNext(COMMAND as 'dev' | 'start');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
