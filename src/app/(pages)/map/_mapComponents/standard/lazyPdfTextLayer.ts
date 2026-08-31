/** TextLayer — idle 지연 + 동시 렌더 1건 제한 */

const TEXT_LAYER_IDLE_TIMEOUT_MS = 1200;
const TEXT_LAYER_CONCURRENCY = 1;

let activeTextLayerRenders = 0;
const textLayerQueue: Array<() => void> = [];

function runTextLayerQueued<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeTextLayerRenders += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeTextLayerRenders -= 1;
          const next = textLayerQueue.shift();
          if (next) next();
        });
    };
    if (activeTextLayerRenders < TEXT_LAYER_CONCURRENCY) run();
    else textLayerQueue.push(run);
  });
}

export type LazyTextLayerHandle = {
  cancel: () => void;
};

/**
 * canvas 표시 후 idle에 TextLayer 렌더 — 스크롤·전환 시 cancel().
 * fn은 AbortSignal을 받아 renderPdfTextLayer에 전달한다.
 */
export function scheduleLazyPdfTextLayer(
  fn: (signal: AbortSignal) => Promise<void>
): LazyTextLayerHandle {
  let cancelled = false;
  const ac = new AbortController();

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    ac.abort();
    if (idleId != null && typeof cancelIdleCallback !== 'undefined') {
      cancelIdleCallback(idleId);
    }
    if (timeoutId != null) window.clearTimeout(timeoutId);
  };

  let idleId: number | undefined;
  let timeoutId: number | undefined;

  const start = () => {
    if (cancelled || ac.signal.aborted) return;
    void runTextLayerQueued(() => fn(ac.signal)).catch(() => {
      /* abort·취소·텍스트 없음 */
    });
  };

  if (typeof requestIdleCallback !== 'undefined') {
    idleId = requestIdleCallback(start, { timeout: TEXT_LAYER_IDLE_TIMEOUT_MS });
  } else {
    timeoutId = window.setTimeout(start, 48);
  }

  return { cancel };
}
