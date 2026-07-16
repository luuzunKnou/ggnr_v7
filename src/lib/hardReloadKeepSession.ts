/**
 * 쿠키·sessionStorage·localStorage는 유지한 채 Cache Storage만 비우고
 * URL 캐시버스트로 이동 (강력 새로고침에 가깝게, 로그인 유지).
 */

const DEFAULT_HEALTH_PATH = '/api/source/version/gnms-config';
const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_SUCCESS_DELAY_MS = 1000;

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
      if (res.ok || res.status === 401 || res.status === 403) {
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
