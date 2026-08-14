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
import { NPM_INSTALL_DEV_ARGS, resolveNpmInstallEnv } from '../src/lib/npmApplyEnv';
import { reloadProjectRuntimeEnv } from '../src/lib/projectEnvReload';

const COMMAND = process.argv[2]; // dev | start
/** ggnr_start.bat / nssm AppEnvironmentExtra 가 넣은 값을 argv보다 우선 (잘못된 npm 인자·package.json 고정 인자 방어) */
function resolveProjectArg(): string {
  const fromEnv = (process.env.GGNR_PROJECT ?? '').trim();
  const fromArgv = (process.argv[3] ?? '').trim();
  if (fromEnv && fromArgv && fromEnv !== fromArgv) {
    console.warn(
      `[run] GGNR_PROJECT 불일치 — env=${fromEnv} argv=${fromArgv} → env 사용 (argv=${JSON.stringify(process.argv.slice(2))})`
    );
    return fromEnv;
  }
  return fromEnv || fromArgv;
}
function resolveTypeArg(): string {
  const fromEnv = (process.env.GGNR_ENV ?? '').trim();
  const fromArgv = (process.argv[4] ?? '').trim();
  if (fromEnv && fromArgv && fromEnv !== fromArgv) {
    console.warn(
      `[run] GGNR_ENV 불일치 — env=${fromEnv} argv=${fromArgv} → env 사용`
    );
    return fromEnv;
  }
  return fromEnv || fromArgv;
}
const PROJECT = resolveProjectArg();
const TYPE = resolveTypeArg();

const SIGNAL_PATH = path.join(process.cwd(), '.cursor-runtime', 'restart-request.json');
const RELAUNCH_POLL_MS = 1000;

/** common.runtime.env + 프로젝트 runtime.env (loadProjectEnv 이후 호출) */
function loadRuntimeEnv(projectName: string): void {
  const dir = path.join(process.cwd(), 'src', 'config', 'projects');
  const applyRuntimeEnvFile = (filePath: string): void => {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) (process.env as Record<string, string>)[key] = value;
    }
  };
  applyRuntimeEnvFile(path.join(dir, 'common.runtime.env'));
  applyRuntimeEnvFile(path.join(dir, `${projectName}.runtime.env`));
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
    if (COMMAND === 'start') {
      console.warn('[drizzle-additive] skip(env) — DB env 없음, additive sync 생략');
    }
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

  // start(ggnr_start/nssm): 고정 정책 additive — DROP 대화형 Abort로 기동 실패 방지
  // dev: 기존 대화형 drizzle-kit push
  if (COMMAND === 'start') {
    try {
      const { runAdditiveSchemaSync } = await import('./drizzle-push-additive');
      await runAdditiveSchemaSync();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[drizzle-additive] fail(pushSchema) —', msg, '— additive 중단, 기동은 계속');
    }
    return;
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
  console.warn(`[run] WARN: port ${port} still busy after ${timeoutSec}s — force-free then recheck`);
  try {
    const { forceFreePort } = await import('../src/service/geoserverProcessService');
    const r = forceFreePort(port);
    if (r.killed.length) console.log(`[run] force-free port ${port}: killed pids=${r.killed.join(',')}`);
    if (r.errors.length) console.warn(`[run] force-free errors: ${r.errors.join('; ')}`);
  } catch (e) {
    console.warn('[run] force-free failed:', e instanceof Error ? e.message : e);
  }
  await sleep(1500);
  if (!isPortListening(port)) {
    console.log(`[run] port ${port} is FREE after force-free`);
    return;
  }
  console.warn(`[run] WARN: port ${port} STILL busy — Next spawn may hit EADDRINUSE`);
}

async function ensurePortFreeForNext(port: number): Promise<void> {
  await waitPortFree(port, 60);
  if (isPortListening(port)) {
    try {
      const { forceFreePort } = await import('../src/service/geoserverProcessService');
      const r = forceFreePort(port);
      if (r.killed.length) {
        console.log(`[run] pre-spawn force-free port ${port}: killed ${r.killed.join(',')}`);
      }
      await sleep(1500);
    } catch {
      /* ignore */
    }
  }
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
    console.warn('[SourceCodeUpload] 재시작 신호 소비 표시 실패:', e instanceof Error ? e.message : e);
  }
}

function isSupervisedRestartMode(mode: string | undefined): boolean {
  /** 레거시 command/startB 도 exit 계열로 취급 */
  return (
    mode === 'launcher' ||
    mode === 'exit' ||
    mode === 'startB' ||
    mode === 'command' ||
    mode === 'nodeWatch'
  );
}

function runNpmInstallSync(): void {
  console.log('[SourceCodeUpload] npm install --include=dev --no-audit --no-fund (재기동 전)');
  execFileSync('npm', [...NPM_INSTALL_DEV_ARGS], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: resolveNpmInstallEnv(),
  });
}

function runNpmBuildSync(): void {
  console.log('[SourceCodeUpload] npm run build (앱 중지 상태)');
  execFileSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  console.log('[SourceCodeUpload] npm run build OK');
}

async function setupDbOnRelaunch(logPrefix: string): Promise<void> {
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = parseInt(process.env.DATABASE_PORT || '5432', 10);
  const database = process.env.DATABASE_NAME || '';
  const user = process.env.DATABASE_USER || '';
  const password = process.env.DATABASE_PASSWORD || '';

  if (!database || !user) {
    console.warn(`${logPrefix} DATABASE env 없음 — 재기동 DB 동기화 생략`);
    return;
  }

  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ host, port, database, user, password });
    try {
      await client.connect();
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
      console.log(`${logPrefix} PostGIS extension ensured (relaunch).`);
    } finally {
      await client.end();
    }
  } catch (e) {
    console.warn(`${logPrefix} PostGIS ensure 실패:`, e instanceof Error ? e.message : e);
  }

  if (COMMAND === 'start') {
    try {
      const { runAdditiveSchemaSync } = await import('./drizzle-push-additive');
      await runAdditiveSchemaSync();
      console.log(`${logPrefix} additive schema sync OK (relaunch).`);
    } catch (e) {
      console.warn(`${logPrefix} additive schema sync 실패:`, e instanceof Error ? e.message : e);
    }
  }

  try {
    const { applyAllSchemaComments } = await import('../src/service/dbManagerService');
    const result = await applyAllSchemaComments();
    if (result.applied > 0) {
      console.log(`${logPrefix} 코멘트 적용:`, result.applied, '건 (relaunch)');
    }
    if (result.error) console.warn(`${logPrefix} 코멘트 적용 일부 실패:`, result.error);
  } catch (e) {
    console.warn(`${logPrefix} 코멘트 적용 스킵:`, e instanceof Error ? e.message : e);
  }
}

let geoRelaunchInFlight = false;

async function ensureGeoServerOnRelaunch(): Promise<void> {
  if (geoRelaunchInFlight) {
    console.log('[SourceCodeUpload] GeoServer 백그라운드 작업 이미 진행 중 — 생략');
    return;
  }
  geoRelaunchInFlight = true;
  const logPrefix = '[SourceCodeUpload]';
  console.log(
    `${logPrefix} GeoServer·저장소 백그라운드 준비 시작 (Next는 이미 기동, 지도 레이어는 최대 2분 소요 가능)`
  );
  const onLog = (message: string) => {
    console.log(`${logPrefix} GeoServer: ${message}`);
  };
  try {
    reloadProjectRuntimeEnv(PROJECT, TYPE);
    const { ensureGeoServerWithDbSetup } = await import('../src/service/geoServerBootstrapService');
    const r = await ensureGeoServerWithDbSetup({
      onLog,
      geoAlreadyStopped: true,
      readyTimeoutMs: 120_000,
      retryOnceOnFail: true,
    });
    if (r.success) {
      console.log(`${logPrefix} GeoServer·저장소 준비 OK (action=${r.ensure.action})`);
    } else {
      console.warn(
        `${logPrefix} GeoServer·저장소 준비 실패(Next는 기동됨):`,
        r.ensure.error ?? 'unknown'
      );
    }
  } catch (e) {
    console.warn(`${logPrefix} GeoServer 준비 오류:`, e instanceof Error ? e.message : e);
  } finally {
    geoRelaunchInFlight = false;
  }
}

/** Next·DB 동기화는 백그라운드 — Geo는 startGeoServerAfter 신호에 따름 */
function startRelaunchBackgroundTasks(signal?: RestartSignal | null): void {
  void (async () => {
    reloadProjectRuntimeEnv(PROJECT, TYPE);
    await setupDbOnRelaunch('[SourceCodeUpload]');
  })();
  startGeoServerOnRelaunchInBackground(signal);
}

/** Next를 막지 않음 — GeoServer·DB 동기화는 백그라운드 */
function startGeoServerOnRelaunchInBackground(signal?: RestartSignal | null): void {
  if (signal?.startGeoServerAfter === false) {
    console.log('[SourceCodeUpload] startGeoServerAfter=false — GeoServer 백그라운드 기동 생략');
    return;
  }
  void ensureGeoServerOnRelaunch();
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
  // Windows + cwd 공백: shell:true 일 때 미인용 경로가 잘림 → next.cmd 인용
  const bin =
    process.platform === 'win32' && /[\s()]/.test(nextBin) ? `"${nextBin}"` : nextBin;
  const args = cmd === 'dev' && /\s/.test(process.cwd()) ? [cmd, '--webpack'] : [cmd];
  console.log(`[run] starting Next.js (${cmd})...`);
  const proc = spawn(bin, args, {
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
      console.log(
        `[SourceCodeUpload] Next 종료 (code=${code ?? 0}) — 재기동용, Node 런처 유지`
      );
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
        `[SourceCodeUpload] Next 종료 (code=${code ?? 0}) supervised mode=${signal.restartMode} — 빌드 파이프라인 시작`
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
  console.log(
    `[SourceCodeUpload] supervised 재기동 시작 (mode=${mode}). Node 유지, Next 중지. port=${port}`
  );
  markRestartConsumed(signal);

  expectNextExitForRelaunch = true;
  if (nextProc && !nextProc.killed) {
    console.log('[SourceCodeUpload] Next 자식 프로세스 종료 중...');
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

  await ensurePortFreeForNext(port);

  if (signal.runNpmInstallBefore === true) {
    try {
      runNpmInstallSync();
    } catch (e) {
      console.error('[SourceCodeUpload] npm install 실패:', e instanceof Error ? e.message : e);
      relaunchInFlight = false;
      expectNextExitForRelaunch = false;
      await ensurePortFreeForNext(port);
      reloadProjectRuntimeEnv(PROJECT, TYPE);
      spawnNext(cmd);
      startRelaunchBackgroundTasks(signal);
      return;
    }
  }

  if (signal.runBuild !== false) {
    try {
      runNpmBuildSync();
    } catch (e) {
      console.error('[SourceCodeUpload] npm run build 실패:', e instanceof Error ? e.message : e);
      relaunchInFlight = false;
      expectNextExitForRelaunch = false;
      await ensurePortFreeForNext(port);
      reloadProjectRuntimeEnv(PROJECT, TYPE);
      spawnNext(cmd);
      startRelaunchBackgroundTasks(signal);
      return;
    }
  } else {
    console.log('[SourceCodeUpload] runBuild=false — 사전 빌드 완료분, 후행 빌드 생략');
  }

  expectNextExitForRelaunch = false;
  relaunchInFlight = false;
  await ensurePortFreeForNext(port);
  reloadProjectRuntimeEnv(PROJECT, TYPE);
  spawnNext(cmd);
  console.log(
    '[SourceCodeUpload] Next 기동 — GeoServer·지도 레이어는 백그라운드 준비 중(최대 약 2분)'
  );
  startRelaunchBackgroundTasks(signal);
}

function startLauncherPoll(cmd: NextCmd): void {
  const delayMs = Number(process.env.GGNR_RESTART_DELAY_MS ?? 2000);
  const safeDelay = Number.isFinite(delayMs) && delayMs >= 500 ? delayMs : 2000;
  console.log(
    `[SourceCodeUpload] supervised 감시 시작 — launcher: Next 폴링 종료; startB/exit: Next 종료 → 빌드 → Next (delay ${safeDelay}ms)`
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
  const tryGeoServerSetup = async (): Promise<boolean> => {
    const { trySetupGeoServerDb } = await import('../src/service/geoServerBootstrapService');
    return trySetupGeoServerDb({
      onLog: (m) => console.log(`[run] GeoServer: ${m}`),
    });
  };

  console.log('[run] DB setup done.');
  const nextCmd = COMMAND as NextCmd;
  startLauncherPoll(nextCmd);
  await ensurePortFreeForNext(getAppListenPort());
  spawnNext(nextCmd);

  // Next 기동을 막지 않음. GeoServer 응답·저장소 설정은 백그라운드.
  void (async () => {
    let geoOk = await tryGeoServerSetup();
    if (geoOk) return;
    try {
      console.log('[run] GeoServer ensure (백그라운드, 응답 확인 후 필요 시 기동)...');
      const { ensureGeoServerWithDbSetup } = await import('../src/service/geoServerBootstrapService');
      const ens = await ensureGeoServerWithDbSetup({
        readyTimeoutMs: 120_000,
        retryOnceOnFail: true,
        onLog: (m) => console.log(`[run] GeoServer: ${m}`),
      });
      if (ens.success) {
        console.log(`[run] GeoServer·저장소 OK (action=${ens.ensure.action})`);
      } else {
        console.warn('[run] GeoServer 기동·저장소 실패:', ens.ensure.error ?? 'unknown');
      }
      if (!ens.setupOk) {
        console.warn('[run] GeoServer 기동·응답 확인 후에도 설정 실패. 수동으로 npm run geoserver 후 재시도하세요.');
      }
    } catch (e) {
      console.warn('[run] GeoServer 기동 스킵:', e instanceof Error ? e.message : e);
    }
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
