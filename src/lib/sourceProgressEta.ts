/** 소스 업로드·설치 ZIP·버전 적용·빌드 검사 공통 예상 시간 헬퍼 */

export function estimateRemainingSeconds(
  totalSec: number,
  pct: number | null,
  startedAtMs: number
): number {
  if (totalSec <= 0 && (pct == null || pct <= 0)) return 0;
  if (pct != null && pct > 2 && pct < 100 && startedAtMs > 0) {
    const elapsed = (Date.now() - startedAtMs) / 1000;
    const projected = elapsed / (pct / 100);
    return Math.max(1, projected - elapsed);
  }
  if (pct != null && pct >= 0 && totalSec > 0) {
    return Math.max(1, totalSec * (1 - pct / 100));
  }
  if (totalSec > 0 && startedAtMs > 0) {
    const elapsed = (Date.now() - startedAtMs) / 1000;
    return Math.max(1, totalSec - elapsed);
  }
  return totalSec > 0 ? totalSec : 0;
}

/** 파일 건수 진행 기준 남은 초 (병합 복사 등) */
export function estimateRemainingByCount(
  applied: number,
  total: number,
  startedAtMs: number
): number | null {
  if (total <= 0 || applied <= 0 || startedAtMs <= 0) return null;
  if (applied >= total) return 1;
  const elapsed = (Date.now() - startedAtMs) / 1000;
  return Math.max(1, (elapsed / applied) * (total - applied));
}

/** 바이트 진행 기준 남은 초 */
export function estimateRemainingByBytes(
  bytesDone: number,
  totalBytes: number,
  startedAtMs: number
): number | null {
  if (totalBytes <= 0 || bytesDone <= 0 || startedAtMs <= 0) return null;
  if (bytesDone >= totalBytes) return 1;
  const elapsed = (Date.now() - startedAtMs) / 1000;
  return Math.max(1, (elapsed / bytesDone) * (totalBytes - bytesDone));
}

/**
 * 표시용. 1분 미만은 «1분 미만», 그 외는 «약 n분»(또는 시간).
 * 초 단위 세분은 쓰지 않는다.
 */
export function formatEtaMinutes(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '1분 미만';
  const m = Math.ceil(sec / 60);
  if (m < 1) return '1분 미만';
  if (m < 60) return `약 ${m}분`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `약 ${h}시간 ${rm}분` : `약 ${h}시간`;
}

/** @deprecated 호환 — formatEtaMinutes와 동일 정책 */
export function formatEtaSeconds(sec: number): string {
  return formatEtaMinutes(sec);
}

export function estimateVersionApplyTotalSeconds(
  packageProfile: 'closed' | 'open',
  restart: boolean
): number {
  const base = packageProfile === 'closed' ? 900 : 720;
  const restartExtra = restart ? (packageProfile === 'open' ? 240 : 90) : 0;
  return base + restartExtra;
}

/** 빌드 검사: 복사·install·build 휴리스틱(초) */
export const BUILD_CHECK_PHASE_SEC = {
  copy: 120,
  install: 180,
  build: 480,
} as const;

export type BuildCheckEtaPhase = keyof typeof BUILD_CHECK_PHASE_SEC;

export function estimateBuildCheckRemainingSeconds(
  phase: BuildCheckEtaPhase,
  startedAtMs: number,
  phaseStartedAtMs: number
): number {
  const order: BuildCheckEtaPhase[] = ['copy', 'install', 'build'];
  const idx = order.indexOf(phase);
  let after = 0;
  for (let i = idx + 1; i < order.length; i++) {
    after += BUILD_CHECK_PHASE_SEC[order[i]!];
  }
  const phaseBudget = BUILD_CHECK_PHASE_SEC[phase];
  const phaseElapsed = Math.max(0, (Date.now() - phaseStartedAtMs) / 1000);
  const phaseRemain = Math.max(30, phaseBudget - phaseElapsed);
  const clockRemain = Math.max(
    30,
    order.reduce((s, p) => s + BUILD_CHECK_PHASE_SEC[p], 0) - (Date.now() - startedAtMs) / 1000
  );
  return Math.max(phaseRemain + after, clockRemain * 0.5);
}
