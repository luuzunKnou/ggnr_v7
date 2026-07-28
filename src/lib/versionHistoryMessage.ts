/**
 * 버전·소스 이력 — 선택 옵션 라벨·본문 조립 (성공/실패·IP는 컬럼으로 분리)
 */

export type RestartModeForHistory = 'none' | 'exit' | 'launcher';
export type PackageProfileForHistory = 'closed' | 'open';

export const HISTORY_OPTION_NODE_MODULES_INCLUDE = 'node_modules 포함';
export const HISTORY_OPTION_NODE_MODULES_EXCLUDE = 'node_modules 미포함';
export const HISTORY_OPTION_CLOSED = '폐쇄망 (node_modules 포함)';
export const HISTORY_OPTION_OPEN = '개방망 (node_modules 미포함)';
export const HISTORY_OPTION_RESTART_EXIT = '프로세스 종료(nssm)';
export const HISTORY_OPTION_RESTART_LAUNCHER = 'Node 런처(Node 내 앱 재실행)';
export const HISTORY_OPTION_RESTART_NONE = '재시작 안 함';

export function uploadHistoryOptions(includeNodeModules: boolean): string[] {
  return [
    includeNodeModules ? HISTORY_OPTION_NODE_MODULES_INCLUDE : HISTORY_OPTION_NODE_MODULES_EXCLUDE,
  ];
}

export function packageProfileHistoryOption(profile: PackageProfileForHistory): string {
  return profile === 'closed' ? HISTORY_OPTION_CLOSED : HISTORY_OPTION_OPEN;
}

export function restartModeHistoryOption(mode: RestartModeForHistory): string {
  if (mode === 'exit') return HISTORY_OPTION_RESTART_EXIT;
  if (mode === 'launcher') return HISTORY_OPTION_RESTART_LAUNCHER;
  return HISTORY_OPTION_RESTART_NONE;
}

export function applyLatestHistoryOptions(
  includeNodeModules: boolean,
  restartMode: RestartModeForHistory
): string[] {
  return [
    includeNodeModules ? HISTORY_OPTION_CLOSED : HISTORY_OPTION_OPEN,
    restartModeHistoryOption(restartMode),
  ];
}

export function installZipHistoryOptions(profile: PackageProfileForHistory): string[] {
  return [packageProfileHistoryOption(profile)];
}

export function normalizeHistoryMemo(memo?: string | null): string | null {
  const t = memo?.trim() ?? '';
  return t ? t : null;
}

export function normalizeHistoryOptions(option?: string[] | null): string[] | null {
  if (!option || option.length === 0) return null;
  const cleaned = option.map((s) => String(s).trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

/** list/API에서 jsonb가 string으로 올 수 있음 */
export function coerceHistoryOptions(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    return normalizeHistoryOptions(raw.map((x) => String(x)));
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeHistoryOptions(parsed.map((x) => String(x)));
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}
