export type InstallZipPhase =
  | 'idle'
  | 'info'
  | 'scan'
  | 'zip'
  | 'download'
  | 'done'
  | 'error';

export type InstallZipProgress = {
  progressId: string;
  phase: InstallZipPhase;
  progressPct: number;
  message: string;
  error?: string;
  fileCount?: number;
  scanSkipped?: number;
  scanSkippedPaths?: string[];
  scanSkippedTruncated?: boolean;
  zipName?: string;
  zipSize?: number;
  updatedAt: number;
  done: boolean;
};

const GLOBAL_STORE_KEY = '__ggnr_source_install_zip_progress__';

function getStore(): Map<string, InstallZipProgress> {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_STORE_KEY]?: Map<string, InstallZipProgress>;
  };
  if (!g[GLOBAL_STORE_KEY]) g[GLOBAL_STORE_KEY] = new Map();
  return g[GLOBAL_STORE_KEY];
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function createInstallZipProgressId(): string {
  return `siz_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function initInstallZipProgress(progressId: string): InstallZipProgress {
  const entry: InstallZipProgress = {
    progressId,
    phase: 'idle',
    progressPct: 0,
    message: '대기',
    updatedAt: Date.now(),
    done: false,
  };
  getStore().set(progressId, entry);
  return entry;
}

export function getInstallZipProgress(progressId: string): InstallZipProgress | null {
  return getStore().get(progressId) ?? null;
}

export function patchInstallZipProgress(
  progressId: string,
  patch: Partial<Omit<InstallZipProgress, 'progressId' | 'updatedAt'>>
): InstallZipProgress | null {
  const prev = getStore().get(progressId);
  if (!prev) return null;
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  getStore().set(progressId, next);
  return next;
}

export function setInstallZipPhase(
  progressId: string,
  phase: InstallZipPhase,
  message: string,
  extra?: Partial<InstallZipProgress>
): void {
  const pctMap: Record<InstallZipPhase, number> = {
    idle: 0,
    info: 5,
    scan: 20,
    zip: 50,
    download: 90,
    done: 100,
    error: 0,
  };
  patchInstallZipProgress(progressId, {
    phase,
    message,
    progressPct: extra?.progressPct ?? pctMap[phase],
    done: phase === 'done' || phase === 'error',
    ...extra,
  });
}

export function setInstallZipScanProgress(
  progressId: string,
  params: {
    fileCount: number;
    skipped?: number;
    skippedPaths?: string[];
    skippedTruncated?: boolean;
    message?: string;
  }
): void {
  const skipped = params.skipped ?? 0;
  const pct = clampPct(10 + Math.min(15, Math.floor(params.fileCount / 500)));
  patchInstallZipProgress(progressId, {
    phase: 'scan',
    fileCount: params.fileCount,
    scanSkipped: skipped,
    scanSkippedPaths: params.skippedPaths,
    scanSkippedTruncated: params.skippedTruncated,
    progressPct: pct,
    message:
      params.message ??
      `스캔 포함 ${params.fileCount} / 제외 ${skipped}`,
    done: false,
  });
}

export function failInstallZipProgress(progressId: string, error: string): void {
  patchInstallZipProgress(progressId, {
    phase: 'error',
    error,
    message: error,
    done: true,
  });
}

export function completeInstallZipProgress(progressId: string, message: string, zipName?: string, zipSize?: number): void {
  patchInstallZipProgress(progressId, {
    phase: 'done',
    progressPct: 100,
    message,
    zipName,
    zipSize,
    done: true,
  });
}
