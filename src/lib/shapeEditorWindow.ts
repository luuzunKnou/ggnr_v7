import { withBasePathNav } from '@/lib/basePath';

const SHAPE_EDITOR_WINDOW_NAME = 'ggnr_shape_editor';

/** 브라우저별 팝업 — 주소창·툴바 최소화 + 작업표시줄 제외 전체 영역 */
function buildShapeEditorWindowFeatures(): string {
  if (typeof window === 'undefined') {
    return 'popup=yes,width=1280,height=900';
  }
  const w = window.screen.availWidth;
  const h = window.screen.availHeight;
  return [
    'popup=yes',
    `width=${w}`,
    `height=${h}`,
    'left=0',
    'top=0',
    'toolbar=no',
    'menubar=no',
    'location=no',
    'status=no',
    'scrollbars=no',
    'resizable=yes',
  ].join(',');
}

function tryMaximizePopup(win: Window) {
  try {
    win.moveTo(0, 0);
    win.resizeTo(window.screen.availWidth, window.screen.availHeight);
  } catch {
    /* 일부 브라우저에서 cross-window resize 차단 */
  }
}

/** 도형편집기 전용 지도 팝업 URL */
export function buildShapeEditorMapUrl(systemKey?: string | null): string {
  const params = new URLSearchParams();
  const system = String(systemKey ?? '').trim();
  if (system) params.set('system', system);
  const q = params.toString();
  return `/shape-editor${q ? `?${q}` : ''}`;
}

/** 새 팝업 창으로 도형편집기 지도 열기 (전체 화면, URL 바 숨김 시도) */
export function openShapeEditorMapWindow(systemKey?: string | null): Window | null {
  if (typeof window === 'undefined') return null;
  const path = withBasePathNav(buildShapeEditorMapUrl(systemKey));
  const url = `${window.location.origin}${path}`;
  const win = window.open(url, SHAPE_EDITOR_WINDOW_NAME, buildShapeEditorWindowFeatures());
  if (win) tryMaximizePopup(win);
  return win;
}

/** shape-editor 페이지 마운트 시 전체화면 (주소창 없음). 사용자 클릭 직후 열린 창에서만 성공하는 경우가 많음 */
export function requestShapeEditorFullscreen(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const req =
    root.requestFullscreen?.bind(root) ??
    (root as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(root);
  if (!req) return;
  void Promise.resolve(req()).catch(() => {
    /* 자동 전체화면 거부 시 팝업 최대화만 유지 */
  });
}
