/**
 * 폴더 업로드 진행률 목업.
 * 실연동 시 작업폴더/.upload-progress.json 을 주기적으로 읽어 UI에 반영하는 것과 같다.
 * 목업은 localStorage를 그 파일로 보고, 탭·창과 무관하게 폴링한다.
 * 파일 업로드 자체는 시작한 탭에서 직렬로 진행되며, 진행 값만 공유한다.
 */

import type { AerialKind } from './aerialMediaTypes';
import { AERIAL_KIND_ROOT } from './aerialMediaRoots';

export const UPLOAD_PROGRESS_FILE_NAME = '.upload-progress.json';

export type UploadJobStatus = 'uploading' | 'done' | 'failed';

export type UploadProgressSnapshot = {
  id: string;
  folderName: string;
  kind: AerialKind;
  workName: string;
  status: UploadJobStatus;
  /** 0~100 */
  percent: number;
  /** 1-based */
  fileIndex: number;
  fileTotal: number;
  currentFileName: string;
  /** 1-based */
  chunkIndex: number;
  chunkTotal: number;
  /** 작업 폴더 기준 진행 파일 경로(목업 표시용) */
  progressFilePath: string;
  /** 진행 파일에 쓴 JSON 문자열(목업 미리보기) */
  progressFileBody: string;
  updatedAt: string;
};

export type UploadCompleteNotice = {
  kind: AerialKind;
  workName: string;
  folderName: string;
  progressFilePath: string;
  fileTotal: number;
  /** 승인 건 연결 시 */
  linkedPurpose?: string;
};

type Listener = () => void;

const STORAGE_KEY = 'ggnr.aerialUploadProgress.v1';
const NOTICE_KEY = 'ggnr.aerialUploadCompleteNotice.v1';
const FILE_TOTAL = 12;
const CHUNK_TOTAL = 8;

let jobs: UploadProgressSnapshot[] = loadFromStorage();
let completionNotice: UploadCompleteNotice | null = loadNoticeFromStorage();
const listeners = new Set<Listener>();
const timers = new Map<string, number>();

let pollTimer: number | null = null;
let storageHooked = false;
/** useSyncExternalStore용 — jobs 참조가 같아도 notice 변경 시 리렌더 */
let progressUiVersion = 0;

function notifyListeners() {
  progressUiVersion += 1;
  for (const l of listeners) l();
}

function emit() {
  persist();
  notifyListeners();
}

/** 구독 스냅샷 — 진행·완료알림 어느 쪽이 바뀌어도 값이 달라짐 */
export function getUploadProgressUiVersion(): number {
  return progressUiVersion;
}

/**
 * 진행파일 읽기 목업 — localStorage를 파일처럼 다시 읽음.
 * 메모리에 있는 더 최신 uploading 은 지우지 않고 병합한다.
 */
function mergeJobs(
  memory: UploadProgressSnapshot[],
  disk: UploadProgressSnapshot[]
): UploadProgressSnapshot[] {
  const map = new Map<string, UploadProgressSnapshot>();
  for (const j of disk) map.set(j.id, j);
  for (const j of memory) {
    const d = map.get(j.id);
    if (!d) {
      map.set(j.id, j);
      continue;
    }
    const memT = Date.parse(j.updatedAt) || 0;
    const diskT = Date.parse(d.updatedAt) || 0;
    if (j.status === 'uploading' && (memT >= diskT || j.percent >= d.percent)) {
      map.set(j.id, j);
    } else if (memT > diskT) {
      map.set(j.id, j);
    }
  }
  return Array.from(map.values());
}

function reloadFromProgressFileMock() {
  const diskJobs = loadFromStorage();
  const nextJobs = mergeJobs(jobs, diskJobs);
  const nextNotice = loadNoticeFromStorage();
  const jobsChanged = JSON.stringify(nextJobs) !== JSON.stringify(jobs);
  const noticeChanged = JSON.stringify(nextNotice) !== JSON.stringify(completionNotice);
  if (!jobsChanged && !noticeChanged) return;
  jobs = nextJobs;
  completionNotice = nextNotice;
  // 디스크에 uploading 이 있으면 타이머 재개 (메뉴 전환 후 복귀 대비)
  for (const j of jobs) {
    if (j.status === 'uploading') ensureTimer(j);
  }
  notifyListeners();
}

function ensureProgressFileWatch() {
  if (typeof window === 'undefined') return;

  if (!storageHooked) {
    storageHooked = true;
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY || e.key === NOTICE_KEY) {
        reloadFromProgressFileMock();
      }
    });
  }

  if (pollTimer == null) {
    pollTimer = window.setInterval(() => {
      reloadFromProgressFileMock();
    }, 400);
  }
}

function stopProgressFileWatchIfIdle() {
  // 업로드가 남아 있으면 리스너가 0이어도 폴링·타이머 유지 (메뉴 전환 대비)
  if (listeners.size > 0) return;
  if (jobs.some((j) => j.status === 'uploading')) return;
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function persist() {
  try {
    if (typeof window === 'undefined') return;
    const active = jobs.filter((j) => j.status === 'uploading' || j.status === 'done');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch {
    /* ignore */
  }
}

function persistNotice() {
  try {
    if (typeof window === 'undefined') return;
    if (completionNotice) {
      window.localStorage.setItem(NOTICE_KEY, JSON.stringify(completionNotice));
    } else {
      window.localStorage.removeItem(NOTICE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function loadFromStorage(): UploadProgressSnapshot[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UploadProgressSnapshot[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function loadNoticeFromStorage(): UploadCompleteNotice | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(NOTICE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UploadCompleteNotice;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildProgressBody(snap: Omit<UploadProgressSnapshot, 'progressFileBody'>): string {
  const payload = {
    folderName: snap.folderName,
    kind: snap.kind,
    workName: snap.workName,
    status: snap.status,
    percent: snap.percent,
    fileIndex: snap.fileIndex,
    fileTotal: snap.fileTotal,
    currentFileName: snap.currentFileName,
    chunkIndex: snap.chunkIndex,
    chunkTotal: snap.chunkTotal,
    updatedAt: snap.updatedAt,
  };
  return JSON.stringify(payload, null, 2);
}

function progressPath(kind: AerialKind, folderName: string): string {
  return `${AERIAL_KIND_ROOT[kind]}${folderName}/${UPLOAD_PROGRESS_FILE_NAME}`;
}

function jobId(kind: AerialKind, folderName: string): string {
  return `${kind}::${folderName}`;
}

export function subscribeUploadProgress(listener: Listener): () => void {
  listeners.add(listener);
  ensureProgressFileWatch();
  reloadFromProgressFileMock();
  return () => {
    listeners.delete(listener);
    stopProgressFileWatchIfIdle();
  };
}

export function getUploadJobs(): UploadProgressSnapshot[] {
  return jobs;
}

export function getUploadingJobsForKind(kind: AerialKind): UploadProgressSnapshot[] {
  return jobs.filter((j) => j.kind === kind && j.status === 'uploading');
}

export function getJobByFolder(kind: AerialKind, folderName: string): UploadProgressSnapshot | null {
  return jobs.find((j) => j.id === jobId(kind, folderName)) ?? null;
}

export function clearFinishedUploadJobs(): void {
  jobs = jobs.filter((j) => j.status === 'uploading');
  emit();
}

export function dismissUploadJob(id: string): void {
  stopTimer(id);
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}

export function getUploadCompleteNotice(): UploadCompleteNotice | null {
  return completionNotice;
}

export function clearUploadCompleteNotice(): void {
  if (completionNotice == null) return;
  completionNotice = null;
  persistNotice();
  notifyListeners();
}

export function setUploadCompleteNotice(notice: UploadCompleteNotice): void {
  completionNotice = notice;
  persistNotice();
  notifyListeners();
}

function stopTimer(id: string) {
  const t = timers.get(id);
  if (t != null) {
    window.clearInterval(t);
    timers.delete(id);
  }
}

function upsertJob(next: UploadProgressSnapshot) {
  const idx = jobs.findIndex((j) => j.id === next.id);
  if (idx < 0) jobs = [next, ...jobs];
  else jobs = [...jobs.slice(0, idx), next, ...jobs.slice(idx + 1)];
  emit();
}

function patchJob(id: string, patch: Partial<UploadProgressSnapshot>) {
  const prev = jobs.find((j) => j.id === id);
  if (!prev) return;
  const merged = { ...prev, ...patch, updatedAt: nowIso() };
  const withBody: UploadProgressSnapshot = {
    ...merged,
    progressFileBody: buildProgressBody(merged),
  };
  upsertJob(withBody);
}

/**
 * 직렬 업로드 목업 시작.
 * 이미 같은 폴더가 uploading이면 기존 잡을 반환.
 */
export function startSerialUploadMock(params: {
  kind: AerialKind;
  folderName: string;
  workName: string;
  onComplete?: (job: UploadProgressSnapshot) => void;
}): UploadProgressSnapshot {
  const id = jobId(params.kind, params.folderName);
  const existing = jobs.find((j) => j.id === id && j.status === 'uploading');
  if (existing) {
    ensureTimer(existing, params.onComplete);
    return existing;
  }

  // 완료된 동일 키는 교체
  stopTimer(id);
  jobs = jobs.filter((j) => j.id !== id);

  let fileIndex = 1;
  let chunkIndex = 1;

  const base = {
    id,
    folderName: params.folderName,
    kind: params.kind,
    workName: params.workName,
    status: 'uploading' as const,
    percent: 0,
    fileIndex,
    fileTotal: FILE_TOTAL,
    currentFileName: `file_${String(fileIndex).padStart(3, '0')}.dat`,
    chunkIndex,
    chunkTotal: CHUNK_TOTAL,
    progressFilePath: progressPath(params.kind, params.folderName),
    updatedAt: nowIso(),
  };
  const initial: UploadProgressSnapshot = {
    ...base,
    progressFileBody: buildProgressBody(base),
  };
  upsertJob(initial);
  ensureTimer(initial, params.onComplete);
  return initial;
}

function ensureTimer(
  job: UploadProgressSnapshot,
  onComplete?: (job: UploadProgressSnapshot) => void
) {
  if (typeof window === 'undefined') return;
  if (timers.has(job.id)) return;
  if (job.status !== 'uploading') return;

  // 새로고침 후 uploading이면 현재 퍼센트부터 이어감
  let fileIndex = Math.max(1, job.fileIndex);
  let chunkIndex = Math.max(1, job.chunkIndex);

  const timer = window.setInterval(() => {
    let cur = jobs.find((j) => j.id === job.id);
    if (!cur || cur.status !== 'uploading') {
      // 메뉴 전환으로 메모리가 비었을 수 있음 — 진행파일에서 한 번 복구
      reloadFromProgressFileMock();
      cur = jobs.find((j) => j.id === job.id);
      if (!cur || cur.status !== 'uploading') {
        stopTimer(job.id);
        return;
      }
      fileIndex = Math.max(fileIndex, cur.fileIndex);
      chunkIndex = Math.max(chunkIndex, cur.chunkIndex);
    }

    chunkIndex += 1;
    if (chunkIndex > CHUNK_TOTAL) {
      chunkIndex = 1;
      fileIndex += 1;
    }

    if (fileIndex > FILE_TOTAL) {
      stopTimer(job.id);
      const doneBase = {
        ...cur,
        status: 'done' as const,
        percent: 100,
        fileIndex: FILE_TOTAL,
        chunkIndex: CHUNK_TOTAL,
        currentFileName: `file_${String(FILE_TOTAL).padStart(3, '0')}.dat`,
        updatedAt: nowIso(),
      };
      const done: UploadProgressSnapshot = {
        ...doneBase,
        progressFileBody: buildProgressBody(doneBase),
      };
      upsertJob(done);
      onComplete?.(done);
      // 잠시 후 목록에서 자동 정리
      window.setTimeout(() => {
        dismissUploadJob(done.id);
      }, 8000);
      return;
    }

    const stepsDone = (fileIndex - 1) * CHUNK_TOTAL + (chunkIndex - 1);
    const stepsTotal = FILE_TOTAL * CHUNK_TOTAL;
    const percent = Math.min(99, Math.round((stepsDone / stepsTotal) * 100));

    patchJob(job.id, {
      fileIndex,
      chunkIndex,
      percent,
      currentFileName: `file_${String(fileIndex).padStart(3, '0')}.dat`,
    });
  }, 220);

  timers.set(job.id, timer);
}

/** 앱 로드 시 localStorage의 uploading 잡 타이머 재개 */
export function resumeUploadingTimersFromStorage(): void {
  if (typeof window === 'undefined') return;
  for (const j of jobs) {
    if (j.status === 'uploading') ensureTimer(j);
  }
}
