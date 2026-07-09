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
