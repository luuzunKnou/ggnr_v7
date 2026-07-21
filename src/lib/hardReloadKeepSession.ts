/**
 * 쿠키·sessionStorage·localStorage는 유지한 채 Cache Storage만 비우고
 * URL 캐시버스트로 이동 (강력 새로고침에 가깝게, 로그인 유지).
 */

const DEFAULT_HEALTH_PATH = '/api/source/version/gnms-config';
const DEFAULT_APPLY_READY_PATH = '/api/source/version/apply-ready';
const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_APPLY_TIMEOUT_MS = 180_000;
const DEFAULT_SUCCESS_DELAY_MS = 1000;
const DEFAULT_STABLE_OK_COUNT = 3;
const DEFAULT_SETTLE_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function clearCacheStorageOnly(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }
}

function isHealthOk(status: number): boolean {
  return status === 200 || status === 401 || status === 403 || (status >= 200 && status < 300);
}

/** Cache Storage 삭제 후 동일 경로로 `_v` 쿼리 붙여 이동 */
export async function hardReloadKeepSession(): Promise<void> {
  if (typeof window === 'undefined') return;
  await clearCacheStorageOnly();
  const url = new URL(window.location.href);
  url.searchParams.set('_v', String(Date.now()));
  window.location.replace(url.toString());
}

/** 안내 표시용 짧은 대기 후 hardReloadKeepSession */
export async function hardReloadKeepSessionAfterDelay(
  delayMs = DEFAULT_SUCCESS_DELAY_MS
): Promise<void> {
  await sleep(delayMs);
  await hardReloadKeepSession();
}

/**
 * 서버가 다시 응답할 때까지 폴링한 뒤 hardReloadKeepSession.
 * 타임아웃이어도 한 번 시도(사용자가 수동 새로고침할 수 있게).
 */
export async function waitServerThenHardReload(options?: {
  healthPath?: string;
  intervalMs?: number;
  timeoutMs?: number;
  onWaiting?: () => void;
}): Promise<void> {
  if (typeof window === 'undefined') return;

  const healthPath = options?.healthPath ?? DEFAULT_HEALTH_PATH;
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  options?.onWaiting?.();

  const deadline = Date.now() + timeoutMs;
  let ready = false;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthPath, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (isHealthOk(res.status)) {
        ready = true;
        break;
      }
    } catch {
      /* 재기동 중 */
    }
    await sleep(intervalMs);
  }

  if (!ready) {
    await sleep(intervalMs);
  }
  await hardReloadKeepSession();
}

export type ApplyRestartWaitPhase = 'server' | 'history' | 'reload';

/**
 * 최신 소스 적용·재시작 후: health 연속 성공 → 이력 flush → settle → hardReload.
 */
export async function waitApplyRestartThenHardReload(options?: {
  healthPath?: string;
  applyReadyPath?: string;
  intervalMs?: number;
  timeoutMs?: number;
  stableOkCount?: number;
  settleMs?: number;
  onPhase?: (phase: ApplyRestartWaitPhase) => void;
}): Promise<void> {
  if (typeof window === 'undefined') return;

  const healthPath = options?.healthPath ?? DEFAULT_HEALTH_PATH;
  const applyReadyPath = options?.applyReadyPath ?? DEFAULT_APPLY_READY_PATH;
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_APPLY_TIMEOUT_MS;
  const stableOkCount = options?.stableOkCount ?? DEFAULT_STABLE_OK_COUNT;
  const settleMs = options?.settleMs ?? DEFAULT_SETTLE_MS;
  const onPhase = options?.onPhase;

  const deadline = Date.now() + timeoutMs;

  onPhase?.('server');
  let consecutiveOk = 0;
  while (Date.now() < deadline && consecutiveOk < stableOkCount) {
    try {
      const res = await fetch(healthPath, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (isHealthOk(res.status)) {
        consecutiveOk += 1;
      } else {
        consecutiveOk = 0;
      }
    } catch {
      consecutiveOk = 0;
    }
    if (consecutiveOk < stableOkCount) {
      await sleep(intervalMs);
    }
  }

  onPhase?.('history');
  let historyReady = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(applyReadyPath, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (res.status === 401 || res.status === 403) {
        historyReady = true;
        break;
      }
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as { ready?: boolean };
        if (json.ready === true) {
          historyReady = true;
          break;
        }
      }
    } catch {
      /* 재기동 직후 */
    }
    await sleep(intervalMs);
  }

  onPhase?.('reload');
  await sleep(settleMs);
  if (!historyReady && consecutiveOk < stableOkCount) {
    await sleep(intervalMs);
  }
  await hardReloadKeepSession();
}
