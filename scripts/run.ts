/**
 * 프로젝트·환경별 env 로드 → DB 확장(PostGIS) 및 테이블 생성 → Next 서버 실행
 * 사용: npm run dev -- river_yd dev  |  npm run start -- river_yd prod
 *
 * 버전관리 «Node 런처» 재시작: 이 프로세스(Node)는 유지하고 Next 자식만 종료·재기동.
 */
import fs from 'node:fs';
import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import path from 'node:path';
import { ensureDbUser } from './create-db-user';
import { loadProjectEnv } from './load-project-env';

const COMMAND = process.argv[2]; // dev | start
const PROJECT = process.argv[3]; // e.g. river_yd
const TYPE = process.argv[4]; // dev | demo | prod

const SIGNAL_PATH = path.join(process.cwd(), '.cursor-runtime', 'restart-request.json');
const RELAUNCH_POLL_MS = 1000;

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

function getAppListenPort(): number {
  const n = Number(process.env.PORT ?? 3000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isPortListening(port: number): boolean {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
      return new RegExp(`:${port}\\s+.*LISTENING`, 'i').test(out);
    }
    const out = execFileSync(
      'sh',
      ['-c', `(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -E ':${port}[[:space:]]' || true`],
      { encoding: 'utf8', timeout: 5000 }
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

async function waitPortFree(port: number, timeoutSec = 90): Promise<void> {
  console.log(`[run] waiting until port ${port} is FREE...`);
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (!isPortListening(port)) {
      console.log(`[run] port ${port} is FREE`);
      return;
    }
    await sleep(1000);
  }
  console.warn(`[run] WARN: port ${port} still busy after ${timeoutSec}s — starting Next anyway`);
}

type RestartSignal = {
  at?: string;
  restartRequested?: boolean;
  restartMode?: string;
  runNpmInstallBefore?: boolean;
  runBuild?: boolean;
  startGeoServerAfter?: boolean;
  launcherConsumed?: boolean;
};

function readRestartSignal(): RestartSignal | null {
  try {
    if (!fs.existsSync(SIGNAL_PATH)) return null;
    const raw = fs.readFileSync(SIGNAL_PATH, 'utf8');
    return JSON.parse(raw) as RestartSignal;
  } catch {
    return null;
  }
}

function markRestartConsumed(signal: RestartSignal): void {
  try {
    fs.mkdirSync(path.dirname(SIGNAL_PATH), { recursive: true });
    fs.writeFileSync(
      SIGNAL_PATH,
      JSON.stringify({ ...signal, launcherConsumed: true, launcherConsumedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (e) {
    console.warn('[run] failed to mark restart signal consumed:', e instanceof Error ? e.message : e);
  }
}

function isSupervisedRestartMode(mode: string | undefined): boolean {
  return mode === 'launcher' || mode === 'startB' || mode === 'exit';
}

function runNpmInstallSync(): void {
  console.log('[run] npm install --no-audit --no-fund (before app relaunch)');
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
}

function runNpmBuildSync(): void {
  console.log('[run] npm run build (app stopped)');
  execFileSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  console.log('[run] npm run build OK');
}

type NextCmd = 'dev' | 'start';

let nextProc: ChildProcess | null = null;
let relaunchInFlight = false;
/** Next 종료 시 런처가 의도적으로 죽인 경우 process.exit 하지 않음 */
let expectNextExitForRelaunch = false;

function spawnNext(cmd: NextCmd): void {
  const nextBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'next.cmd' : 'next'
  );
  console.log(`[run] starting Next.js (${cmd})...`);
  const proc = spawn(nextBin, [cmd], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  nextProc = proc;
  proc.on('error', (err) => {
    console.error('[run] Next failed:', err);
    if (!relaunchInFlight) process.exit(1);
  });
  proc.on('close', (code) => {
    nextProc = null;
    if (expectNextExitForRelaunch || relaunchInFlight) {
      console.log(`[run] Next exited (code=${code ?? 0}) for relaunch — Node launcher stays up`);
      return;
    }
    /** start/b·exit: Next가 process.exit 해도 Node(run)는 남아 npm run build → 앱 재기동 */
    const signal = readRestartSignal();
    if (
      signal?.restartRequested === true &&
      signal.launcherConsumed !== true &&
      isSupervisedRestartMode(signal.restartMode)
    ) {
      console.log(
        `[run] Next exited (code=${code ?? 0}) with supervised restartMode=${signal.restartMode} — running build pipeline`
      );
      void relaunchNextOnly(signal, cmd);
      return;
    }
    process.exit(code ?? 0);
  });
}

async function relaunchNextOnly(signal: RestartSignal, cmd: NextCmd): Promise<void> {
  if (relaunchInFlight) return;
  relaunchInFlight = true;
  const port = getAppListenPort();
  const mode = signal.restartMode ?? 'launcher';
  console.log(`[run] supervised relaunch (mode=${mode}). Node stays; Next stopped. port=${port}`);
  markRestartConsumed(signal);

  expectNextExitForRelaunch = true;
  if (nextProc && !nextProc.killed) {
    console.log('[run] supervised: stopping Next child...');
    try {
      nextProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    // Windows: tree kill if still around after a moment
    await sleep(1500);
    if (nextProc && !nextProc.killed && nextProc.pid) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(nextProc.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
        } else {
          nextProc.kill('SIGKILL');
        }
      } catch {
        /* ignore */
      }
    }
  }

  await waitPortFree(port);

  if (signal.runNpmInstallBefore === true) {
    try {
      runNpmInstallSync();
    } catch (e) {
      console.error('[run] npm install failed:', e instanceof Error ? e.message : e);
      relaunchInFlight = false;
      expectNextExitForRelaunch = false;
      spawnNext(cmd);
      return;
    }
  }

  if (signal.runBuild !== false) {
    try {
      runNpmBuildSync();
    } catch (e) {
      console.error('[run] npm run build failed:', e instanceof Error ? e.message : e);
      relaunchInFlight = false;
      expectNextExitForRelaunch = false;
      spawnNext(cmd);
      return;
    }
  }

  expectNextExitForRelaunch = false;
  relaunchInFlight = false;
  spawnNext(cmd);
}

function startLauncherPoll(cmd: NextCmd): void {
  const delayMs = Number(process.env.GGNR_RESTART_DELAY_MS ?? 2000);
  const safeDelay = Number.isFinite(delayMs) && delayMs >= 500 ? delayMs : 2000;
  console.log(
    `[run] supervised restart watch — launcher: poll+stop Next; startB/exit: Next exit → build → Next (delay ${safeDelay}ms)`
  );

  setInterval(() => {
    if (relaunchInFlight) return;
    const signal = readRestartSignal();
    if (!signal) return;
    if (signal.launcherConsumed === true) return;
    if (signal.restartRequested !== true) return;
    /** launcher만 폴링으로 Next를 먼저 죽임. startB/exit는 Next process.exit 후 close에서 처리 */
    if (signal.restartMode !== 'launcher') return;

    const atMs = signal.at ? Date.parse(signal.at) : NaN;
    if (Number.isFinite(atMs) && Date.now() - atMs < safeDelay) return;

    void relaunchNextOnly(signal, cmd);
  }, RELAUNCH_POLL_MS);
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
  process.env.GGNR_RUN_SCRIPT = COMMAND;
  /** Next 프로세스에 전달: 재시작 시 빌드·재기동을 이 Node가 맡음 */
  process.env.GGNR_RUN_SUPERVISOR = '1';
  try {
    const { writeGgnrBootCommand } = await import('../src/lib/ggnrBootCommand');
    const boot = writeGgnrBootCommand(COMMAND as 'dev' | 'start', PROJECT, TYPE);
    console.log(`[run] Boot command recorded: ${boot.command}`);
  } catch (e) {
    console.warn('[run] Boot command record skipped:', e instanceof Error ? e.message : e);
  }
  console.log(`[run] Loaded env: project=${PROJECT}, type=${TYPE}, script=${COMMAND}`);

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

  console.log('[run] DB setup done.');
  const nextCmd = COMMAND as NextCmd;
  startLauncherPoll(nextCmd);
  spawnNext(nextCmd);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
