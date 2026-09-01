import type { SourcePackageProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { includeNodeModulesFromProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { resolveClientMachineIp } from '@/lib/clientMachineIp';
import { recordVersionHistoryClient } from '@/lib/recordVersionHistoryClient';
import { applyLatestHistoryOptions } from '@/lib/versionHistoryMessage';
export type RestartMode = 'none' | 'exit' | 'launcher';

export type VersionRelayPhase =
  | 'latest'
  | 'download'
  | 'relay-init'
  | 'relay-chunk'
  | 'relay-complete'
  | 'type-check'
  | 'merge-apply'
  | 'geoserver'
  | 'geoserver-stop'
  | 'npm-install'
  | 'app-stop'
  | 'build'
  | 'app-start'
  | 'geoserver-start'
  | 'schema-wait'
  | 'restart';

export type VersionRelayProgress = {
  phase: VersionRelayPhase;
  message: string;
  bytesDone?: number;
  totalBytes?: number;
  chunkIndex?: number;
  totalChunks?: number;
  /** 서버 [SourceCodeUpload] 로그 → UI 실시간 로그 */
  logLine?: string;
  appliedFiles?: number;
  skippedFiles?: number;
  totalFiles?: number;
  /** 병합·적용 내부: ZIP 해제·집계·백업·복사·정리 */
  mergeStep?: 'extract' | 'count' | 'backup' | 'copy' | 'cleanup';
};

export type VersionRelayResult = {
  version: string;
  fileName: string;
  downloadedBytes: number;
  appliedFiles: number;
  skippedFiles: number;
  gnmsBaseUrl: string;
  latestUrl: string;
  downloadUrl: string;
  geoserver?: {
    stopped: boolean;
    started: boolean;
    deferredStart?: boolean;
    message: string;
    stopMessage?: string;
    startMessage?: string;
  };
  restart: {
    requested: boolean;
    mode: RestartMode;
    scheduled: boolean;
    message: string;
    signalFile: string;
  };
  skippedSamples?: string[];
  pendingSchemaConfirm?: boolean;
  pendingId?: string;
};

type GnmsConfigResponse = {
  gnmsBaseUrl: string;
  /** 운영 서버에 구동 프로젝트/타입이 있어 명령 실행 재시작 가능 여부 */
  restartCommandConfigured?: boolean;
  error?: string;
};

/** GNMS GET /list 항목 */
export type GnmsVersionListEntry = {
  folder: string;
  date: string;
  changeNote: string | null;
  createdAt: string;
  isLatest: boolean;
  hasCachedZip: boolean;
  sizeBytes: number | null;
};

const COMPLETE_FETCH_TIMEOUT_MS = 30 * 60 * 1000;

/** fetchWithTimeout 시간 초과 — AbortError(사용자 취소)와 구분 */
export class RelayTimeoutError extends Error {
  override name = 'RelayTimeoutError';
  constructor(timeoutMs: number, label?: string) {
    const sec = Math.round(timeoutMs / 1000);
    super(label ? `${label} 시간 초과 (${sec}초)` : `요청 시간 초과 (${sec}초)`);
  }
}

export function isUserAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/** 재시작(process.exit) 직후 브라우저가 받는 연결 끊김 — 실패로 취급하지 않음 */
export function isRestartDisconnectError(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('cors/네트워크') ||
    lower.includes('connection') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed')
  );
}

export function isRelayTimeoutError(e: unknown): boolean {
  return e instanceof RelayTimeoutError || (e instanceof Error && e.name === 'RelayTimeoutError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

function urlLabel(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  try {
    return String((input as Request).url ?? input);
  } catch {
    return String(input);
  }
}

/** 네트워크/CORS(응답 없음) vs 그 외 — 화면·로그용 한국어 메시지 */
function classifyNetworkFetchError(err: unknown, context: string, input: RequestInfo | URL): Error {
  if (isUserAbortError(err) || isRelayTimeoutError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const looksCorsOrNetwork =
    err instanceof TypeError ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('cors') ||
    lower.includes('access-control');

  if (looksCorsOrNetwork) {
    return new Error(
      `[CORS/네트워크] ${context} 실패 — HTTP 응답 없이 브라우저가 연결을 거부했습니다 (${urlLabel(input)}). CORS·주소·방화벽을 확인하세요. 원본: ${raw}`
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
  options?: { label?: string; classifyNetwork?: boolean }
): Promise<Response> {
  throwIfAborted(externalSignal);
  const label = options?.label;
  const classifyNetwork = options?.classifyNetwork === true;

  const runFetch = async (signal: AbortSignal | undefined): Promise<Response> => {
    try {
      return await fetch(input, { ...init, signal });
    } catch (err: unknown) {
      throwIfAborted(externalSignal);
      if (classifyNetwork) throw classifyNetworkFetchError(err, label ?? '요청', input);
      throw err;
    }
  };

  if (timeoutMs <= 0) {
    if (!externalSignal && !init.signal) {
      try {
        return await fetch(input, init);
      } catch (err: unknown) {
        if (classifyNetwork) throw classifyNetworkFetchError(err, label ?? '요청', input);
        throw err;
      }
    }
    const signals: AbortSignal[] = [];
    if (init.signal) signals.push(init.signal);
    if (externalSignal) signals.push(externalSignal);
    const mergedSignal =
      signals.length > 1 && typeof AbortSignal !== 'undefined' && 'any' in AbortSignal
        ? AbortSignal.any(signals)
        : (externalSignal ?? init.signal ?? undefined);
    return runFetch(mergedSignal);
  }

  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);
  const onExternalAbort = () => timeoutController.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  const signals: AbortSignal[] = [timeoutController.signal];
  if (init.signal) signals.push(init.signal);
  const mergedSignal =
    typeof AbortSignal !== 'undefined' && 'any' in AbortSignal
      ? AbortSignal.any(signals)
      : timeoutController.signal;

  try {
    return await runFetch(mergedSignal);
  } catch (err: unknown) {
    throwIfAborted(externalSignal);
    if (timedOut) throw new RelayTimeoutError(timeoutMs, label);
    throw err;
  } finally {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    clearTimeout(timer);
  }
}

function appendUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return new Uint8Array(b);
  if (b.length === 0) return new Uint8Array(a);
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** complete API NDJSON: progress 줄 여러 개 + result/error 한 줄 */
async function readRelayCompleteNdjson(
  res: Response,
  onProgressLine: (event: {
    phase: VersionRelayPhase;
    message: string;
    logLine?: string;
    appliedFiles?: number;
    skippedFiles?: number;
    totalFiles?: number;
    mergeStep?: VersionRelayProgress['mergeStep'];
    bytesDone?: number;
    totalBytes?: number;
  }) => void
): Promise<VersionRelayResult & { error?: string; ok?: boolean }> {
  const contentType = res.headers.get('content-type') ?? '';

  /** 구 단일 JSON 응답 호환 */
  if (contentType.includes('application/json') && !contentType.includes('ndjson')) {
    return (await res.json().catch(() => ({}))) as VersionRelayResult & {
      error?: string;
      ok?: boolean;
    };
  }

  if (!res.body) {
    return (await res.json().catch(() => ({}))) as VersionRelayResult & {
      error?: string;
      ok?: boolean;
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: (VersionRelayResult & { error?: string; ok?: boolean }) | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(parsed.type ?? '');
    if (type === 'progress') {
      const phase = String(parsed.phase ?? '') as VersionRelayPhase;
      const message = String(parsed.message ?? '');
      const logLine =
        typeof parsed.logLine === 'string' && parsed.logLine.trim()
          ? parsed.logLine.trim()
          : undefined;
      const appliedFiles =
        typeof parsed.appliedFiles === 'number' ? parsed.appliedFiles : undefined;
      const skippedFiles =
        typeof parsed.skippedFiles === 'number' ? parsed.skippedFiles : undefined;
      const totalFiles = typeof parsed.totalFiles === 'number' ? parsed.totalFiles : undefined;
      const mergeStepRaw = String(parsed.mergeStep ?? '');
      const mergeStep =
        mergeStepRaw === 'extract' ||
        mergeStepRaw === 'count' ||
        mergeStepRaw === 'backup' ||
        mergeStepRaw === 'copy' ||
        mergeStepRaw === 'cleanup'
          ? (mergeStepRaw as VersionRelayProgress['mergeStep'])
          : undefined;
      const bytesDone = typeof parsed.bytesDone === 'number' ? parsed.bytesDone : undefined;
      const totalBytes = typeof parsed.totalBytes === 'number' ? parsed.totalBytes : undefined;
      if (phase && message) {
        onProgressLine({
          phase,
          message,
          logLine,
          appliedFiles,
          skippedFiles,
          totalFiles,
          mergeStep,
          bytesDone,
          totalBytes,
        });
      }
      return;
    }
    if (type === 'error') {
      result = {
        ok: false,
        error: String(parsed.error ?? 'relay complete 실패'),
        historyRecorded: parsed.historyRecorded === true,
      } as VersionRelayResult & { error?: string; ok?: boolean; historyRecorded?: boolean };
      return;
    }
    if (type === 'result') {
      const { type: _t, ...rest } = parsed;
      result = rest as VersionRelayResult & { error?: string; ok?: boolean };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) handleLine(raw);
  }
  if (buffer.trim()) handleLine(buffer);

  if (!result) {
    throw new Error(
      '적용 응답이 중간에 끊겼습니다. 장시간 단계 중 게이트·프록시 유휴 제한으로 끊길 수 있습니다. 서버 [SourceCodeUpload] 로그를 확인하거나 프록시 timeout을 늘린 뒤 다시 시도하세요.'
    );
  }
  return result;
}

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return String(json.error ?? json.message ?? fallback);
}

/** GNMS GET /list — 버전 select용 (동시 호출 시 진행 중 Promise 공유) */
let versionListInflight: Promise<{ listUrl: string; entries: GnmsVersionListEntry[] }> | null =
  null;

async function fetchGnmsVersionListOnce(): Promise<{
  listUrl: string;
  entries: GnmsVersionListEntry[];
}> {
  const listRes = await fetchWithTimeout(
    '/api/source/version/gnms/list',
    { method: 'GET', cache: 'no-store' },
    60_000,
    undefined,
    { label: 'GNMS 버전 목록' }
  );
  const listJson = (await listRes.json().catch(() => ({}))) as {
    ok?: boolean;
    listUrl?: string;
    entries?: GnmsVersionListEntry[];
    error?: string;
  };
  if (!listRes.ok) {
    throw new Error(
      `GNMS 버전 목록 오류 (${listRes.status})${listJson.error ? `: ${listJson.error}` : ''}`
    );
  }
  const entries = Array.isArray(listJson.entries) ? listJson.entries : [];
  return { listUrl: String(listJson.listUrl ?? '/api/source/version/gnms/list'), entries };
}

export async function fetchGnmsVersionList(options?: {
  signal?: AbortSignal;
}): Promise<{ listUrl: string; entries: GnmsVersionListEntry[] }> {
  const { signal } = options ?? {};
  throwIfAborted(signal);

  if (!versionListInflight) {
    versionListInflight = fetchGnmsVersionListOnce().finally(() => {
      versionListInflight = null;
    });
  }

  const inflight = versionListInflight;
  if (!signal) return inflight;

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    inflight.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'));
          return;
        }
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    );
  });
}

/**
 * 설치파일 다운로드 — 로컬 서버가 GNMS install ZIP을 받아 브라우저로 전달.
 */
export async function fetchGnmsInstallZipViaLocal(options: {
  signal?: AbortSignal;
  log: (line: string) => void;
}): Promise<{ downloadRes: Response; fileName: string; version: string; jobId: string }> {
  const { signal, log } = options;
  throwIfAborted(signal);
  log('로컬 서버 → GNMS 설치 ZIP 요청');
  const downloadRes = await fetch('/api/source/version/install-zip/from-gnms', {
    method: 'GET',
    cache: 'no-store',
    signal,
  });
  const headerName = downloadRes.headers.get('X-Gnms-FileName');
  const headerVer = downloadRes.headers.get('X-Gnms-Version');
  const jobId = downloadRes.headers.get('X-Gnms-JobId')?.trim() ?? '';
  const fileName = headerName
    ? decodeURIComponent(headerName)
    : `source_install_${Date.now()}.zip`;
  const version = headerVer ? decodeURIComponent(headerVer) : '';
  if (!downloadRes.ok) {
    const apiMsg = await readJsonError(downloadRes, '');
    throw new Error(apiMsg || `설치 ZIP 다운로드 실패 (${downloadRes.status})`);
  }
  log(`다운로드 시작: ${fileName}${version ? ` (version=${version})` : ''}`);
  return { downloadRes, fileName, version, jobId };
}

/** 사용자 취소 시 로컬 서버가 GNMS cancel 을 호출 */
export async function notifyGnmsLatestDownloadCancel(options: {
  jobId: string;
  version?: string;
  fileName?: string;
  log: (line: string) => void;
}): Promise<void> {
  try {
    const res = await fetch('/api/source/version/gnms/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: options.jobId,
        version: options.version,
        fileName: options.fileName,
        reason: 'user_abort',
      }),
      keepalive: true,
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
    if (res.ok) {
      options.log(`GNMS 취소 통지: ${json.status ?? 'ok'} (jobId=${options.jobId})`);
      return;
    }
    options.log(
      `WARNING: GNMS 취소 통지 실패 — HTTP ${res.status}${json.error ? `: ${json.error}` : ''}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    options.log(`WARNING: GNMS 취소 통지 요청 실패 — ${msg}`);
  }
}

export async function relayLatestSourceFromGnms(options: {
  restart: boolean;
  restartMode: RestartMode;
  packageProfile?: SourcePackageProfile;
  /** 선택 버전 폴더 ID (목록 folder) */
  folder: string;
  /** 이력·UI용 — select option 본문 (`날짜 | 변경메모`) */
  versionLabel?: string;
  /** true면 /latest 경로, false면 prepare + /download/{folder} */
  isLatest: boolean;
  signal?: AbortSignal;
  onProgress?: (p: VersionRelayProgress) => void;
  onLog?: (line: string) => void;
}): Promise<VersionRelayResult> {
  const {
    restart,
    restartMode,
    packageProfile = 'closed',
    folder,
    versionLabel,
    isLatest,
    signal,
    onProgress,
    onLog,
  } = options;
  const includeNodeModules = includeNodeModulesFromProfile(packageProfile);
  const log = (line: string) => onLog?.(line);
  let cfg: GnmsConfigResponse | undefined;
  let relayCompleted = false;
  let gnmsVersion: string | undefined;
  const historyVersionLabel = versionLabel?.trim() || '';

  try {
    throwIfAborted(signal);
    onProgress?.({ phase: 'latest', message: 'GNMS 설정 조회 중...' });
    const cfgRes = await fetch('/api/source/version/gnms-config', { cache: 'no-store', signal });
    cfg = (await cfgRes.json().catch(() => ({}))) as GnmsConfigResponse;
    if (!cfgRes.ok) throw new Error(cfg?.error ?? 'GNMS 설정 조회 실패');

    if (restart && restartMode === 'launcher' && cfg.restartCommandConfigured !== true) {
      const msg =
        '구동 프로젝트/타입이 없어 Node 런처 재시작을 쓸 수 없습니다. 운영 서버를 npm run dev|start -- <project> <type> 으로 기동하세요.';
      log(`ERROR: ${msg}`);
      throw new Error(msg);
    }

    log(`GNMS: ${cfg.gnmsBaseUrl}`);
    log(`선택 버전: ${folder}${isLatest ? ' (latest)' : ''}`);

    throwIfAborted(signal);
    onProgress?.({
      phase: 'latest',
      message: isLatest ? 'GNMS 최신 버전 조회 중...' : 'GNMS 선택 버전 준비 중...',
    });

    const applyRes = await fetchWithTimeout(
      '/api/source/version/gnms/apply',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder,
          isLatest,
          restart,
          restartMode,
          packageProfile,
          versionLabel: historyVersionLabel || undefined,
          clientIp: await resolveClientMachineIp(),
        }),
      },
      COMPLETE_FETCH_TIMEOUT_MS,
      signal,
      { label: 'GNMS 적용' }
    );

    if (!applyRes.ok) {
      const errJson = (await applyRes.json().catch(() => ({}))) as { error?: string };
      const msg = errJson.error ?? `GNMS 적용 실패 (HTTP ${applyRes.status})`;
      log(`ERROR: ${msg}`);
      throw new Error(msg);
    }

    const completeJson = await readRelayCompleteNdjson(applyRes, (event) => {
      if (event.logLine) log(event.logLine);
      if (event.phase === 'latest' && event.message.includes('version=')) {
        gnmsVersion = event.message.replace(/^latest:\s*/i, '');
      }
      onProgress?.(event);
    });
    if (completeJson.error || completeJson.ok === false) {
      const msg = completeJson.error ?? 'GNMS 적용 실패';
      log(`ERROR: ${msg}`);
      const err = new Error(msg) as Error & { historyRecorded?: boolean };
      err.historyRecorded =
        (completeJson as { historyRecorded?: boolean }).historyRecorded === true;
      throw err;
    }

    relayCompleted = true;
    log(
      `적용 완료: ${completeJson.appliedFiles}건 / GeoServer ${completeJson.geoserver?.stopMessage ?? completeJson.geoserver?.message ?? '-'} / 재시작 ${completeJson.restart?.message ?? '-'}`
    );

    return {
      ...completeJson,
      gnmsBaseUrl: cfg.gnmsBaseUrl,
      latestUrl: completeJson.latestUrl ?? '',
      downloadUrl: completeJson.downloadUrl ?? '',
    };
  } catch (e: unknown) {
    if (isUserAbortError(e)) {
      log('사용자가 취소했습니다. 로컬 서버가 GNMS 수신을 중단합니다.');
    } else if (!isRelayTimeoutError(e) && isRestartDisconnectError(e) && !relayCompleted) {
      /** 압축 해제 등 장구간 무출력 중 연결 끊김 — 재시작 전 끊김은 실패로 안내 */
      const clearer = new Error(
        '적용 중 연결이 끊겼습니다. 압축 해제·집계·타입 검사 등 장시간 단계에서 게이트·프록시 유휴 제한(~60초)으로 끊길 수 있습니다. 서버 콘솔 [SourceCodeUpload] 로그로 진행 여부를 확인한 뒤 다시 시도하세요.'
      );
      log(`ERROR: ${clearer.message}`);
      const failVer =
        historyVersionLabel || folder.trim() || gnmsVersion?.trim() || '';
      await recordVersionHistoryClient({
        historyType: 'apply_latest',
        status: 'fail',
        message: clearer.message,
        option: applyLatestHistoryOptions(includeNodeModules, restartMode),
        version: failVer || undefined,
      }).catch(() => {});
      throw clearer;
    }
    /** 재시작 정상 끊김·적용 완료·서버가 이미 실패 이력 남긴 경우 클라이언트 중복 기록 생략 */
    const serverHistoryRecorded =
      e instanceof Error &&
      'historyRecorded' in e &&
      (e as Error & { historyRecorded?: boolean }).historyRecorded === true;
    const skipFailHistory =
      relayCompleted ||
      serverHistoryRecorded ||
      (restart && isRestartDisconnectError(e));
    if (!isUserAbortError(e) && !skipFailHistory) {
      const msg = e instanceof Error ? e.message : String(e);
      const failVer =
        historyVersionLabel || folder.trim() || gnmsVersion?.trim() || '';
      await recordVersionHistoryClient({
        historyType: 'apply_latest',
        status: 'fail',
        message: msg,
        option: applyLatestHistoryOptions(includeNodeModules, restartMode),
        version: failVer || undefined,
      }).catch(() => {});
    }
    throw e;
  }
}

export type SchemaSyncConfirmResult = {
  ok?: boolean;
  error?: string;
  restart?: {
    message?: string;
    scheduled?: boolean;
    requested?: boolean;
    mode?: RestartMode;
  };
  rollbackDetail?: string;
};

/** 스키마 안내 [진행] — live commit (NDJSON·keepalive, 장시간 병합·빌드) */
export async function confirmSchemaSyncApply(
  pendingId: string,
  onProgress?: (event: VersionRelayProgress) => void
): Promise<SchemaSyncConfirmResult> {
  const res = await fetch('/api/dev/schema-sync/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pendingId }),
  });
  const result = await readRelayCompleteNdjson(res, (p) => onProgress?.(p));
  if (result.ok === false || result.error) {
    return { ok: false, error: result.error ?? '진행 확정 실패' };
  }
  return result as SchemaSyncConfirmResult;
}

