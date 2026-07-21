export type UploadProgressPhase =
  | 'idle'
  | 'scan'
  | 'dbCompare'
  | 'zip'
  | 'preflight'
  | 'init'
  | 'chunk'
  | 'complete'
  | 'npmInstall'
  | 'finalize'
  | 'done'
  | 'error';

export type SourceUploadProgress = {
  progressId: string;
  phase: UploadProgressPhase;
  progressPct: number;
  message: string;
  error?: string;
  failedStage?: string;
  sentChunks?: number;
  expectedChunks?: number;
  chunkIndex?: number;
  zipName?: string;
  zipSize?: number;
  scanIncluded?: number;
  scanSkipped?: number;
  scanPath?: string;
  /** 실제 제외된 경로(파일·폴더). 상한 초과 시 truncated */
  scanSkippedPaths?: string[];
  scanSkippedTruncated?: boolean;
  scanDbSql?: number;
  scanDbReview?: number;
  scanImages?: number;
  scanPackages?: number;
  schemaDbDiffCount?: number;
  zipProcessed?: number;
  zipTotal?: number;
  includeNodeModules?: boolean;
  /** GNMS init 응답 uploadId — 취소 통보용 */
  remoteUploadId?: string;
  updatedAt: number;
  done: boolean;
};

const GLOBAL_STORE_KEY = '__ggnr_source_upload_progress_store__';

function getProgressStore(): Map<string, SourceUploadProgress> {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_STORE_KEY]?: Map<string, SourceUploadProgress>;
  };
  if (!g[GLOBAL_STORE_KEY]) {
    g[GLOBAL_STORE_KEY] = new Map<string, SourceUploadProgress>();
  }
  return g[GLOBAL_STORE_KEY];
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function createProgressId(): string {
  return `sup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function initUploadProgress(progressId: string): SourceUploadProgress {
  const entry: SourceUploadProgress = {
    progressId,
    phase: 'idle',
    progressPct: 0,
    message: '시작',
    updatedAt: Date.now(),
    done: false,
  };
  getProgressStore().set(progressId, entry);
  return entry;
}

export function getUploadProgress(progressId: string): SourceUploadProgress | null {
  pruneExpired();
  return getProgressStore().get(progressId) ?? null;
}

export function patchUploadProgress(
  progressId: string,
  patch: Partial<Omit<SourceUploadProgress, 'progressId' | 'updatedAt'>>
): SourceUploadProgress | null {
  const prev = getProgressStore().get(progressId);
  if (!prev) return null;
  const next: SourceUploadProgress = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  };
  getProgressStore().set(progressId, next);
  return next;
}

export function setUploadProgressPhase(
  progressId: string,
  phase: UploadProgressPhase,
  message: string,
  extra?: Partial<SourceUploadProgress>
): void {
  const pct = extra?.progressPct ?? phasePct(phase, extra?.sentChunks, extra?.expectedChunks, extra?.zipProcessed, extra?.zipTotal);
  patchUploadProgress(progressId, {
    phase,
    message,
    progressPct: pct,
    ...extra,
    done: phase === 'done' || phase === 'error',
  });
}

function phasePct(
  phase: UploadProgressPhase,
  sent?: number,
  expected?: number,
  zipProcessed?: number,
  zipTotal?: number
): number {
  switch (phase) {
    case 'scan':
      return 10;
    case 'dbCompare':
      return 12;
    case 'zip':
      if (zipProcessed != null && zipTotal != null && zipTotal > 0) {
        return clampPct(16 + (zipProcessed / zipTotal) * 6);
      }
      return 16;
    case 'preflight':
      return 8;
    case 'init':
      return 22;
    case 'chunk':
      if (sent != null && expected != null && expected > 0) {
        /** 최대 ~70% — 병합/압축 해제 구간(72~88) 여유 */
        return clampPct(22 + (sent / expected) * 48);
      }
      return 25;
    case 'complete':
      return 72;
    case 'npmInstall':
      return 92;
    case 'finalize':
      return 96;
    case 'done':
      return 100;
    case 'error':
      return 0;
    default:
      return 0;
  }
}

/** scan walk 중 주기적 갱신 (포함/제외 건수 + 현재 경로) */
export function setScanProgress(
  progressId: string,
  params: {
    included: number;
    skipped: number;
    currentPath: string;
    dirsVisited: number;
    dbSql?: number;
    dbReview?: number;
    images?: number;
    packages?: number;
    schemaDbDiffCount?: number;
    skippedPaths?: string[];
    skippedTruncated?: boolean;
  }
): void {
  const {
    included,
    skipped,
    currentPath,
    dirsVisited,
    dbSql,
    dbReview,
    images,
    packages,
    schemaDbDiffCount,
    skippedPaths,
    skippedTruncated,
  } = params;
  const pulse = Math.min(5, Math.floor((included + skipped) / 200));
  const pct = clampPct(5 + pulse);
  const shortPath = currentPath.length > 60 ? `...${currentPath.slice(-57)}` : currentPath;
  patchUploadProgress(progressId, {
    phase: 'scan',
    scanIncluded: included,
    scanSkipped: skipped,
    scanPath: currentPath,
    scanSkippedPaths: skippedPaths,
    scanSkippedTruncated: skippedTruncated,
    scanDbSql: dbSql,
    scanDbReview: dbReview,
    scanImages: images,
    scanPackages: packages,
    schemaDbDiffCount,
    progressPct: pct,
    message: `스캔 중 (폴더 ${dirsVisited}) — 포함 ${included}, 제외 ${skipped} — ${shortPath || '.'}`,
    done: false,
  });
}

export function setZipProgress(
  progressId: string,
  params: { processed: number; total: number; zipName?: string }
): void {
  const pct = phasePct('zip', undefined, undefined, params.processed, params.total);
  patchUploadProgress(progressId, {
    phase: 'zip',
    zipProcessed: params.processed,
    zipTotal: params.total,
    zipName: params.zipName,
    progressPct: pct,
    message: `ZIP 압축 ${params.processed}/${params.total} (${pct}%)`,
    done: false,
  });
}

export function setChunkProgress(
  progressId: string,
  sentChunks: number,
  expectedChunks: number,
  chunkIndex: number
): void {
  const pct = phasePct('chunk', sentChunks, expectedChunks);
  patchUploadProgress(progressId, {
    phase: 'chunk',
    sentChunks,
    expectedChunks,
    chunkIndex,
    progressPct: pct,
    message: `청크 전송 ${sentChunks}/${expectedChunks} (${pct}%)`,
    done: false,
  });
}

export function failUploadProgress(
  progressId: string,
  failedStage: string,
  error: string,
  extra?: Partial<SourceUploadProgress>
): void {
  patchUploadProgress(progressId, {
    phase: 'error',
    failedStage,
    error,
    message: `[${failedStage}] ${error}`,
    done: true,
    ...extra,
  });
}

export function completeUploadProgress(progressId: string, message: string): void {
  patchUploadProgress(progressId, {
    phase: 'done',
    progressPct: 100,
    message,
    done: true,
  });
}

function pruneExpired(): void {
  const store = getProgressStore();
  const now = Date.now();
  const TTL_MS = 30 * 60 * 1000;
  for (const [id, p] of store) {
    if (now - p.updatedAt > TTL_MS) store.delete(id);
  }
}
