/**
 * GeoServer 프로세스 기동·중지·응답 확인 (Windows bat)
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getGeoServerInternalBase } from '@/lib/geoserverUrl';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export function getGeoServerBaseUrl(): string {
  return getGeoServerInternalBase();
}

export type GeoServerHealth = {
  ready: boolean;
  status: 'ready' | 'starting' | 'down' | 'error';
  httpStatus?: number;
  detail?: string;
};

/**
 * REST/웹이 응답하는지 확인.
 * 200·401·403·302 → ready
 * 503·502 → starting
 * fetch 실패 → down
 */
export async function checkGeoServerHealth(baseUrl = getGeoServerBaseUrl()): Promise<GeoServerHealth> {
  const url = `${baseUrl.replace(/\/$/, '')}/web/`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      // Node fetch는 302를 따라가며 redirect loop → fetch failed. 상태만 본다.
      redirect: 'manual',
      signal: fetchTimeoutSignal(5000),
    });
    if (res.status === 200 || res.status === 401 || res.status === 403 || res.status === 302) {
      return { ready: true, status: 'ready', httpStatus: res.status };
    }
    if (res.status === 503 || res.status === 502) {
      return {
        ready: false,
        status: 'starting',
        httpStatus: res.status,
        detail: `HTTP ${res.status}`,
      };
    }
    return {
      ready: false,
      status: 'error',
      httpStatus: res.status,
      detail: `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ready: false,
      status: 'down',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function waitGeoServerReady(options?: {
  timeoutMs?: number;
  intervalMs?: number;
  baseUrl?: string;
}): Promise<GeoServerHealth> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 2000;
  const baseUrl = options?.baseUrl ?? getGeoServerBaseUrl();
  const deadline = Date.now() + timeoutMs;
  let last: GeoServerHealth = { ready: false, status: 'down' };
  while (Date.now() < deadline) {
    last = await checkGeoServerHealth(baseUrl);
    if (last.ready) return last;
    await sleep(intervalMs);
  }
  return last;
}

async function runStartGeoServerBat(): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { success: false, error: 'GeoServer start is supported on Windows only.' };
  }

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'geoserver_modules', 'scripts', 'start-geoserver.bat');
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `스크립트 없음: ${scriptPath} (cwd: ${projectRoot})` };
  }

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    const chunks: { out: string[]; err: string[] } = { out: [], err: [] };
    let settled = false;

    const child = spawn('cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: projectRoot,
    });

    child.stdout?.on('data', (d: Buffer) => chunks.out.push(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => chunks.err.push(d.toString('utf8')));

    const finish = (ok: boolean, err?: string) => {
      if (settled) return;
      settled = true;
      child.removeAllListeners();
      resolve(ok ? { success: true } : { success: false, error: err });
    };

    child.on('close', (code) => {
      if (code !== 0) {
        const errText = chunks.err.join('').trim() || chunks.out.join('').trim();
        finish(false, errText || `스크립트 종료 코드: ${code}`);
      } else {
        finish(true);
      }
    });

    child.on('error', (e) => finish(false, e.message));
    child.unref();

    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        finish(true);
      }
    }, 3000);
  });
}

/**
 * GeoServer 실행 — bat 기동 후 start.ini 포트(8090 등) 응답 확인.
 */
export async function startGeoServer() {
  const result = await ensureGeoServerRunning({
    skipStopIfDown: true,
    onLog: () => {},
  });

  if (result.success) {
    return { success: true };
  }

  return {
    success: false,
    error: result.error ?? `기동 실패 (${result.action})`,
  };
}

export async function stopGeoServer() {
  if (process.platform !== 'win32') {
    return { success: false, error: 'GeoServer stop is supported on Windows only.' };
  }

  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'geoserver_modules', 'scripts', 'stop-geoserver.bat');
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `스크립트 없음: ${scriptPath} (cwd: ${projectRoot})` };
  }

  return new Promise<{ success: boolean; error?: string; output?: string }>((resolve) => {
    const chunks: { out: string[]; err: string[] } = { out: [], err: [] };

    const child = spawn('cmd.exe', ['/c', scriptPath], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: projectRoot,
    });

    child.stdout?.on('data', (d: Buffer) => chunks.out.push(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => chunks.err.push(d.toString('utf8')));

    const getOutput = () =>
      [chunks.out.join(''), chunks.err.join('')].filter(Boolean).join('\n').trim();

    child.on('close', (code) => {
      const output = getOutput();
      resolve(
        code === 0
          ? { success: true, output }
          : { success: false, error: output || `종료 코드: ${code}`, output }
      );
    });

    child.on('error', (e) => resolve({ success: false, error: e.message }));
  });
}

export type StopGeoServerVerifiedResult = {
  /** 응답(web/)이 없어야 true — bat 성공만으로는 true가 아님 */
  success: boolean;
  message: string;
  health?: GeoServerHealth;
  batOk?: boolean;
  batError?: string;
};

function formatResponseRemainDetail(health: GeoServerHealth): string {
  if (health.detail) return health.detail;
  if (health.httpStatus != null) return `HTTP ${health.httpStatus}`;
  return health.status;
}

/**
 * stop bat 실행 후 web/ 응답이 사라졌는지 확인.
 * 이미 꺼진 상태(응답 없음)면 bat 실패여도 성공.
 * bat 성공이어도 응답이 남으면 한 번 더 stop 후 대기, 그래도 남으면 실패.
 */
export async function stopGeoServerAndVerify(options?: {
  settleMs?: number;
  downTimeoutMs?: number;
  intervalMs?: number;
}): Promise<StopGeoServerVerifiedResult> {
  const settleMs = options?.settleMs ?? 2500;
  const downTimeoutMs = options?.downTimeoutMs ?? 30_000;
  const intervalMs = options?.intervalMs ?? 1500;

  let bat = await stopGeoServer();
  await sleep(settleMs);

  let health = await checkGeoServerHealth();
  if (!health.ready) {
    return {
      success: true,
      message: '중지 OK(응답 없음)',
      health,
      batOk: bat.success,
      batError: bat.error,
    };
  }

  bat = await stopGeoServer();
  await sleep(settleMs);

  const deadline = Date.now() + downTimeoutMs;
  while (Date.now() < deadline) {
    health = await checkGeoServerHealth();
    if (!health.ready) {
      return {
        success: true,
        message: '중지 OK(응답 없음)',
        health,
        batOk: bat.success,
        batError: bat.error,
      };
    }
    await sleep(intervalMs);
  }

  return {
    success: false,
    message: `중지 실패(응답 유지: ${formatResponseRemainDetail(health)})`,
    health,
    batOk: bat.success,
    batError: bat.error,
  };
}

export type EnsureGeoServerResult = {
  success: boolean;
  action: 'already-ready' | 'started' | 'restarted' | 'failed';
  error?: string;
  health?: GeoServerHealth;
};

/**
 * 상태 확인 후 필요 시에만 기동.
 * - ready → 스킵
 * - starting(503) → stop 전에 ready 대기, 되면 스킵
 * - 그 외 / wait 실패 → stop → start → ready 폴링
 */
export async function ensureGeoServerRunning(options?: {
  forceRestart?: boolean;
  settleMsAfterStop?: number;
  readyTimeoutMs?: number;
  /** starting 상태에서 stop 전 대기 (기본 90s) */
  startingWaitMs?: number;
  /** true면 응답 없을 때 stop bat 생략 (적용 직후 중지 상태) */
  skipStopIfDown?: boolean;
  /** 단계 로그 (run.ts 등) */
  onLog?: (message: string) => void;
}): Promise<EnsureGeoServerResult> {
  const forceRestart = options?.forceRestart === true;
  const settleMs = options?.settleMsAfterStop ?? 2500;
  const readyTimeoutMs = options?.readyTimeoutMs ?? 120_000;
  const startingWaitMs = options?.startingWaitMs ?? 90_000;
  const log = options?.onLog ?? (() => {});

  if (!forceRestart) {
    log('상태 확인 중...');
    let health = await checkGeoServerHealth();
    log(`상태: ${health.status}${health.httpStatus != null ? ` (HTTP ${health.httpStatus})` : ''}`);
    if (health.ready) {
      log('이미 응답 중 — 기동 생략');
      return { success: true, action: 'already-ready', health };
    }
    if (health.status === 'starting') {
      log(`starting 대기 (최대 ${Math.round(startingWaitMs / 1000)}초)...`);
      health = await waitGeoServerReady({ timeoutMs: startingWaitMs });
      if (health.ready) {
        log('대기 후 응답 확인 — 기동 생략');
        return { success: true, action: 'already-ready', health };
      }
      log('starting 대기 후에도 미응답 — stop/start 시도');
    }
  } else {
    log('강제 재기동 (forceRestart)');
  }

  let stopVerified = false;
  const skipStop =
    options?.skipStopIfDown === true && !(await checkGeoServerHealth()).ready;
  if (skipStop) {
    log('이미 중지 상태 — stop 생략');
  } else {
    log('stop bat 실행·응답 소멸 확인...');
    const stopResult = await stopGeoServerAndVerify({ settleMs });
    stopVerified = stopResult.success;
    log(stopResult.success ? stopResult.message : `stop 경고: ${stopResult.message}`);
    if (!stopResult.success) {
      log('stop 미확인 — start 시도 계속');
    }
  }

  log('start bat 실행...');
  const startResult = await runStartGeoServerBat();
  if (!startResult.success) {
    log(`start bat 실패 — 응답 대기(30초): ${startResult.error ?? 'unknown'}`);
    const afterFail = await waitGeoServerReady({ timeoutMs: 30_000 });
    if (afterFail.ready) {
      log('bat 실패 후에도 응답 확인됨');
      return {
        success: true,
        action: forceRestart ? 'restarted' : 'started',
        health: afterFail,
      };
    }
    return {
      success: false,
      action: 'failed',
      error: startResult.error ?? 'start bat failed',
      health: afterFail,
    };
  }

  log(`응답 대기 (최대 ${Math.round(readyTimeoutMs / 1000)}초)...`);
  const health = await waitGeoServerReady({ timeoutMs: readyTimeoutMs });
  if (health.ready) {
    log('응답 확인 OK');
    return {
      success: true,
      action: forceRestart || stopVerified || skipStop ? 'restarted' : 'started',
      health,
    };
  }

  log(`응답 없음: ${health.status}${health.detail ? ` (${health.detail})` : ''}`);
  return {
    success: false,
    action: 'failed',
    error: `기동 후에도 응답 없음 (${health.status}${health.detail ? `: ${health.detail}` : ''})`,
    health,
  };
}

function protectedPids(): Set<number> {
  const s = new Set<number>([process.pid]);
  if (typeof process.ppid === 'number' && process.ppid > 0) s.add(process.ppid);
  return s;
}

/** Windows: 포트 LISTENING PID 목록 (자기·부모 제외) */
export function listListeningPidsOnPort(port: number): number[] {
  if (process.platform !== 'win32') return [];
  const protect = protectedPids();
  try {
    const out = execFileSync('netstat', ['-ano'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    const pids = new Set<number>();
    const re = new RegExp(`:${port}\\s+.*LISTENING\\s+(\\d+)`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      const pid = Number(m[1]);
      if (Number.isFinite(pid) && pid > 0 && !protect.has(pid)) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

/** 포트 점유 프로세스 강제 종료 (Next EADDRINUSE 완화). 자기·부모 PID는 건드리지 않음. */
export function forceFreePort(port: number): { killed: number[]; errors: string[]; skippedProtected: number[] } {
  const killed: number[] = [];
  const errors: string[] = [];
  const skippedProtected: number[] = [];
  if (process.platform !== 'win32') return { killed, errors, skippedProtected };
  const protect = protectedPids();
  for (const pid of listListeningPidsOnPort(port)) {
    if (protect.has(pid)) {
      skippedProtected.push(pid);
      continue;
    }
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 8000,
      });
      killed.push(pid);
    } catch (e) {
      errors.push(`pid ${pid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { killed, errors, skippedProtected };
}
