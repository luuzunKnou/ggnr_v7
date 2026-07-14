/**
 * GeoServer 프로세스 기동·중지·헬스 체크 (Windows bat)
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
  return (process.env.GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
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

/**
 * GeoServer 실행 (백그라운드로 시작) — bat만. 헬스는 ensureGeoServerRunning 사용.
 */
export async function startGeoServer() {
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
}): Promise<EnsureGeoServerResult> {
  const forceRestart = options?.forceRestart === true;
  const settleMs = options?.settleMsAfterStop ?? 2500;
  const readyTimeoutMs = options?.readyTimeoutMs ?? 120_000;
  const startingWaitMs = options?.startingWaitMs ?? 90_000;

  if (!forceRestart) {
    let health = await checkGeoServerHealth();
    if (health.ready) {
      return { success: true, action: 'already-ready', health };
    }
    if (health.status === 'starting') {
      health = await waitGeoServerReady({ timeoutMs: startingWaitMs });
      if (health.ready) {
        return { success: true, action: 'already-ready', health };
      }
      // 대기 후에도 ready 아니면 stop/start로 회복 시도
    }
  }

  const stopResult = await stopGeoServer();
  await sleep(settleMs);

  const startResult = await startGeoServer();
  if (!startResult.success) {
    const afterFail = await waitGeoServerReady({ timeoutMs: 30_000 });
    if (afterFail.ready) {
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

  const health = await waitGeoServerReady({ timeoutMs: readyTimeoutMs });
  if (health.ready) {
    return {
      success: true,
      action: forceRestart || stopResult.success ? 'restarted' : 'started',
      health,
    };
  }

  return {
    success: false,
    action: 'failed',
    error: `기동 후에도 ready 아님 (${health.status}${health.detail ? `: ${health.detail}` : ''})`,
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
