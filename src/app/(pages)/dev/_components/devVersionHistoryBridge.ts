let closeHandler: (() => void) | null = null;
let refreshHandler: (() => void) | null = null;

/** dev/page — 이력 플로팅 패널 닫기 핸들러 등록 */
export function registerDevVersionHistoryClose(handler: () => void): () => void {
  closeHandler = handler;
  return () => {
    if (closeHandler === handler) closeHandler = null;
  };
}

export function closeDevVersionHistory(): void {
  closeHandler?.();
}

/** VersionHistoryDialog — 이력 목록 재조회 핸들러 등록 */
export function registerDevVersionHistoryRefresh(handler: () => void): () => void {
  refreshHandler = handler;
  return () => {
    if (refreshHandler === handler) refreshHandler = null;
  };
}

/** 관련 기능 성공 시 이력 검색 갱신 */
export function notifyDevVersionHistoryRefresh(): void {
  refreshHandler?.();
}

/**
 * 서버 재시작 직후 등 일시적 연결 실패를 고려해 이력 새로고침을 여러 번 시도.
 * 기본 간격: 즉시 → 5초 → 15초 → 30초 → 60초
 * (process.exit·재시작 대기·개방망 npm install 여유 포함)
 * @returns clearTimeout 용 타이머 id 목록
 */
export function notifyDevVersionHistoryRefreshRetry(
  delaysMs: number[] = [0, 5_000, 15_000, 30_000, 60_000]
): ReturnType<typeof setTimeout>[] {
  const timerIds: ReturnType<typeof setTimeout>[] = [];
  for (const ms of delaysMs) {
    if (ms <= 0) {
      refreshHandler?.();
    } else {
      timerIds.push(
        setTimeout(() => {
          refreshHandler?.();
        }, ms)
      );
    }
  }
  return timerIds;
}

export function clearDevVersionHistoryRefreshRetry(timerIds: ReturnType<typeof setTimeout>[]): void {
  for (const id of timerIds) {
    clearTimeout(id);
  }
}
