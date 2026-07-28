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

/** 병합·적용 내부 단계 예산(초) — ZIP 해제·백업은 복사 건수 ETA에 안 잡히던 구간 */
export type MergeApplyEtaStep = 'extract' | 'count' | 'backup' | 'copy' | 'cleanup';

const MERGE_APPLY_STEP_ORDER: MergeApplyEtaStep[] = [
  'extract',
  'count',
  'backup',
  'copy',
  'cleanup',
];

/** 폐쇄망(node_modules 포함) 합 ~12분, 개방망 ~7분 — 실측(해제·백업 포함) 반영 */
export const MERGE_APPLY_STEP_SEC: Record<
  'closed' | 'open',
  Record<MergeApplyEtaStep, number>
> = {
  closed: { extract: 240, count: 45, backup: 180, copy: 240, cleanup: 45 },
  open: { extract: 120, count: 30, backup: 90, copy: 150, cleanup: 30 },
};

export function mergeApplyStepPct(
  step: MergeApplyEtaStep | null | undefined,
  applied: number,
  total: number
): number {
  if (step === 'extract') return 56;
  if (step === 'count') return 58;
  if (step === 'backup') return 62;
  if (step === 'cleanup') return 90;
  if (step === 'copy' && total > 0) {
    return 65 + Math.min(24, Math.round((Math.max(0, applied) / total) * 24));
  }
  if (step === 'copy') return 65;
  return 55;
}

/**
 * 병합·적용 남은 초.
 * extract/count/backup/cleanup: 단계 예산 − 경과 + 이후 단계 합.
 * copy: 건수 속도 + cleanup 예산.
 */
export function estimateMergeApplyRemainingSeconds(opts: {
  packageProfile: 'closed' | 'open';
  mergeStep: MergeApplyEtaStep | null | undefined;
  applied: number;
  total: number;
  stepStartedAtMs: number;
  copyStartedAtMs: number;
}): number {
  const budget = MERGE_APPLY_STEP_SEC[opts.packageProfile];
  const step = opts.mergeStep ?? 'extract';
  const idx = MERGE_APPLY_STEP_ORDER.indexOf(step);
  let after = 0;
  for (let i = Math.max(0, idx) + 1; i < MERGE_APPLY_STEP_ORDER.length; i++) {
    after += budget[MERGE_APPLY_STEP_ORDER[i]!];
  }

  if (step === 'copy') {
    const copyRemain =
      opts.total > 0 && opts.applied > 0 && opts.copyStartedAtMs > 0
        ? (estimateRemainingByCount(opts.applied, opts.total, opts.copyStartedAtMs) ??
          budget.copy)
        : Math.max(
            30,
            budget.copy - Math.max(0, (Date.now() - (opts.stepStartedAtMs || Date.now())) / 1000)
          );
    return Math.max(1, copyRemain + budget.cleanup);
  }

  const stepBudget = budget[step];
  const elapsed = Math.max(0, (Date.now() - (opts.stepStartedAtMs || Date.now())) / 1000);
  const stepRemain = Math.max(15, stepBudget - elapsed);
  return Math.max(1, stepRemain + after);
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

/**
 * 소스 업로드 — 원격 병합/압축 해제 예산(초).
 * 예전이 ZIP MB×0.5초로 과소평가되어 «약 1분»으로 보이던 구간.
 */
export function estimateUploadRemoteCompleteSeconds(
  zipSizeBytes: number | undefined,
  includeNodeModules: boolean
): number {
  const fallbackMb = includeNodeModules ? 450 : 100;
  const mb = Math.max(1, (zipSizeBytes != null && zipSizeBytes > 0 ? zipSizeBytes : fallbackMb * 1024 * 1024) / (1024 * 1024));
  if (includeNodeModules) {
    /** 폐쇄망: 최소 ~10분, MB당 ~2.5초 */
    return Math.max(600, Math.round(mb * 2.5));
  }
  /** 개방망: 최소 ~4분 */
  return Math.max(240, Math.round(mb * 1.5));
}

export function estimateUploadTotalSeconds(
  fileCount: number | undefined,
  zipSizeBytes: number | undefined,
  includeNodeModules: boolean
): number {
  const files = fileCount && fileCount > 0 ? fileCount : 0;
  if (files <= 0 && (zipSizeBytes == null || zipSizeBytes <= 0)) return 0;
  const closed = includeNodeModules;
  const scanSec = Math.max(2, files * 0.004);
  const estZipBytes = zipSizeBytes ?? files * (closed ? 100_000 : 6_000);
  const zipSec = Math.max(
    3,
    files * (closed ? 0.018 : 0.01) + (estZipBytes / (1024 * 1024)) * (closed ? 1.8 : 0.9)
  );
  const transferSec = Math.max(3, (estZipBytes / (1024 * 1024)) * (closed ? 1.2 : 0.8));
  const remoteSec = estimateUploadRemoteCompleteSeconds(estZipBytes, includeNodeModules);
  const npmSec = closed ? 0 : 90;
  return scanSec + zipSec + transferSec + remoteSec + npmSec;
}

/** 병합/압축 해제 단계 전용 남은 초 (% 기반 추정 사용 금지) */
export function estimateUploadCompleteRemainingSeconds(
  zipSizeBytes: number | undefined,
  includeNodeModules: boolean,
  completeStartedAtMs: number,
  npmInstallPending: boolean
): number {
  const budget = estimateUploadRemoteCompleteSeconds(zipSizeBytes, includeNodeModules);
  const elapsed =
    completeStartedAtMs > 0 ? Math.max(0, (Date.now() - completeStartedAtMs) / 1000) : 0;
  const completeRemain = Math.max(45, budget - elapsed);
  const npmSec = npmInstallPending ? 90 : 0;
  return completeRemain + npmSec;
}

/** 청크 완료 후~병합 구간 진행률 (90% 점프로 남은 시간 과소평가 방지) */
export function uploadCompletePhasePct(
  completeStartedAtMs: number,
  zipSizeBytes: number | undefined,
  includeNodeModules: boolean
): number {
  const budget = estimateUploadRemoteCompleteSeconds(zipSizeBytes, includeNodeModules);
  const elapsed =
    completeStartedAtMs > 0 ? Math.max(0, (Date.now() - completeStartedAtMs) / 1000) : 0;
  const ratio = budget > 0 ? Math.min(1, elapsed / budget) : 0;
  return Math.min(88, 72 + Math.round(ratio * 16));
}
