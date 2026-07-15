import type { SourcePackageProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { includeNodeModulesFromProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { resolveClientMachineIp } from '@/lib/clientMachineIp';
import { resolveGnmsApiUrl } from '@/lib/gnmsSourceUrl';
import { recordVersionHistoryClient } from '@/lib/recordVersionHistoryClient';

export type RestartMode = 'none' | 'exit' | 'launcher';

export type VersionRelayPhase =
  | 'latest'
  | 'download'
  | 'relay-init'
  | 'relay-chunk'
  | 'relay-complete'
  | 'merge-apply'
  | 'geoserver'
  | 'geoserver-stop'
  | 'npm-install'
  | 'app-stop'
  | 'build'
  | 'app-start'
  | 'geoserver-start'
  | 'restart';

export type VersionRelayProgress = {
  phase: VersionRelayPhase;
  message: string;
  bytesDone?: number;
  totalBytes?: number;
  chunkIndex?: number;
  totalChunks?: number;
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
};

type GnmsConfigResponse = {
  gnmsBaseUrl: string;
  latestUrl: string;
  downloadUrlFallback: string;
  bearer: string;
  /** 운영 서버에 구동 프로젝트/타입이 있어 명령 실행 재시작 가능 여부 */
  restartCommandConfigured?: boolean;
  error?: string;
};

type GnmsLatestPayload = {
  version?: string;
  fileName?: string;
  downloadUrl?: string;
  size?: number;
  sizeBytes?: number;
  totalSize?: number;
};

const CHUNK_FETCH_TIMEOUT_MS = 120_000;
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

function gnmsHeaders(bearer: string): Record<string, string> {
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
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
  onProgressLine: (event: { phase: VersionRelayPhase; message: string }) => void
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
      if (phase && message) onProgressLine({ phase, message });
      return;
    }
    if (type === 'error') {
      result = {
        ok: false,
        error: String(parsed.error ?? 'relay complete 실패'),
      } as VersionRelayResult & { error?: string; ok?: boolean };
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
    throw new Error('relay complete 결과(result) 행이 없습니다');
  }
  return result;
}

function parseTotalSize(latest: GnmsLatestPayload, contentLength: string | null): number {
  const fromHeader = contentLength ? Number(contentLength) : NaN;
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  for (const key of ['sizeBytes', 'totalSize', 'size'] as const) {
    const n = Number(latest[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return String(json.error ?? json.message ?? fallback);
}

/** 취소·실패 시 운영 서버 relay tmp 정리 (AbortSignal 없이 keepalive) */
async function cleanupRelaySession(uploadId: string, log: (line: string) => void): Promise<void> {
  try {
    const res = await fetch('/api/source/version/relay/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
      keepalive: true,
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; removed?: boolean; error?: string };
    if (!res.ok) {
      log(`WARNING: relay tmp 정리 실패 — ${json.error ?? `HTTP ${res.status}`}`);
      return;
    }
    log(json.removed ? `relay tmp 정리 완료: ${uploadId}` : `relay tmp 없음(이미 정리됨): ${uploadId}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`WARNING: relay tmp 정리 요청 실패 — ${msg}`);
  }
}

export async function relayLatestSourceFromGnms(options: {
  restart: boolean;
  restartMode: RestartMode;
  packageProfile?: SourcePackageProfile;
  signal?: AbortSignal;
  onProgress?: (p: VersionRelayProgress) => void;
  onLog?: (line: string) => void;
}): Promise<VersionRelayResult> {
  const { restart, restartMode, packageProfile = 'closed', signal, onProgress, onLog } = options;
  const includeNodeModules = includeNodeModulesFromProfile(packageProfile);
  const log = (line: string) => onLog?.(line);
  let cfg: GnmsConfigResponse | undefined;
  /** init 이후 세션 — 성공 complete(서버가 삭제) 제외하고 취소·실패 시 정리 */
  let activeUploadId: string | null = null;
  let relayCompleted = false;

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

    throwIfAborted(signal);
    onProgress?.({ phase: 'latest', message: 'GNMS 최신 버전 조회 중...' });
    let latestRes: Response;
    try {
      latestRes = await fetchWithTimeout(
        cfg.latestUrl,
        { method: 'GET', headers: gnmsHeaders(cfg.bearer), cache: 'no-store' },
        60_000,
        signal,
        { label: 'GNMS latest 조회', classifyNetwork: true }
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('[CORS/네트워크]')) {
        log(`ERROR: ${err.message}`);
      }
      throw err;
    }
    const latestJson = (await latestRes.json().catch(() => ({}))) as GnmsLatestPayload;
    if (!latestRes.ok) {
      const apiMsg = await readJsonError(latestRes, '');
      const msg = `GNMS latest API 오류 (${latestRes.status})${apiMsg ? `: ${apiMsg}` : ''}`;
      log(`ERROR: ${msg}`);
      throw new Error(msg);
    }

    const version = String(latestJson.version ?? '').trim() || new Date().toISOString();
    const fileName = String(latestJson.fileName ?? '').trim() || `source_latest_${Date.now()}.zip`;
    const downloadUrlRaw = String(latestJson.downloadUrl ?? '').trim() || cfg.downloadUrlFallback;
    const downloadUrl = resolveGnmsApiUrl(cfg.gnmsBaseUrl, downloadUrlRaw);
    log(`latest: version=${version}, file=${fileName}`);

    throwIfAborted(signal);
    onProgress?.({ phase: 'download', message: 'GNMS ZIP 다운로드 시작...' });
    let downloadRes: Response;
    try {
      downloadRes = await fetchWithTimeout(
        downloadUrl,
        { method: 'GET', headers: gnmsHeaders(cfg.bearer), cache: 'no-store' },
        0,
        signal,
        { label: 'GNMS ZIP 다운로드', classifyNetwork: true }
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('[CORS/네트워크]')) {
        log(`ERROR: ${err.message}`);
      }
      throw err;
    }
    if (!downloadRes.ok) {
      const apiMsg = await readJsonError(downloadRes, '');
      const msg = `GNMS download API 오류 (${downloadRes.status})${apiMsg ? `: ${apiMsg}` : ''}`;
      log(`ERROR: ${msg}`);
      throw new Error(msg);
    }
    if (!downloadRes.body) {
      throw new Error('GNMS 다운로드 body 없음');
    }

    const totalSize = parseTotalSize(latestJson, downloadRes.headers.get('content-length'));
    if (totalSize <= 0) {
      throw new Error('ZIP 크기를 알 수 없습니다 (Content-Length 또는 latest.size 필요)');
    }

    throwIfAborted(signal);
    onProgress?.({
      phase: 'relay-init',
      message: '운영 서버 relay 세션 시작...',
      totalBytes: totalSize,
    });
    const initRes = await fetch('/api/source/version/relay/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        totalSize,
        version,
        restart,
        restartMode,
        includeNodeModules,
        clientIp: await resolveClientMachineIp(),
      }),
      signal,
    });
    const initJson = (await initRes.json().catch(() => ({}))) as {
      uploadId?: string;
      chunkSize?: number;
      expectedChunks?: number;
      error?: string;
    };
    if (!initRes.ok || !initJson.uploadId || !initJson.chunkSize || !initJson.expectedChunks) {
      throw new Error(initJson.error ?? 'relay init 실패');
    }

    const { uploadId, chunkSize, expectedChunks } = initJson;
    activeUploadId = uploadId;
    log(`relay init: uploadId=${uploadId}, chunks=${expectedChunks}, chunkSize=${chunkSize}`);

    const reader = downloadRes.body.getReader();
    let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let chunkIndex = 0;
    let bytesDone = 0;

    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      if (value?.length) {
        pending = appendUint8Arrays(pending, value);
      }

      while (pending.length >= chunkSize || (done && pending.length > 0)) {
        throwIfAborted(signal);
        const isLast = done && pending.length <= chunkSize;
        const take = isLast ? pending.length : Math.min(chunkSize, pending.length);
        if (take <= 0) break;

        const slice = pending.subarray(0, take);
        pending = pending.subarray(take);
        const chunkBody = new Uint8Array(take);
        chunkBody.set(slice);

        const url =
          `/api/source/version/relay/chunk?uploadId=${encodeURIComponent(uploadId)}` +
          `&chunkIndex=${chunkIndex}&totalChunks=${expectedChunks}`;

        const chunkRes = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: chunkBody,
          },
          CHUNK_FETCH_TIMEOUT_MS,
          signal,
          { label: `relay 청크 ${chunkIndex + 1}/${expectedChunks}` }
        );
        const chunkJson = (await chunkRes.json().catch(() => ({}))) as { error?: string; ok?: boolean };
        if (!chunkRes.ok || chunkJson.error || chunkJson.ok === false) {
          throw new Error(
            chunkJson.error ?? `relay 청크 ${chunkIndex + 1}/${expectedChunks} 실패 (HTTP ${chunkRes.status})`
          );
        }

        chunkIndex += 1;
        bytesDone += take;
        log(`relay chunk ${chunkIndex}/${expectedChunks} (${Math.round((bytesDone / totalSize) * 100)}%)`);
        onProgress?.({
          phase: 'relay-chunk',
          message: `운영 서버 전송 ${chunkIndex}/${expectedChunks}`,
          bytesDone,
          totalBytes: totalSize,
          chunkIndex,
          totalChunks: expectedChunks,
        });

        if (chunkIndex >= expectedChunks) break;
      }

      if (done) break;
    }

    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    if (chunkIndex !== expectedChunks) {
      const msg = `청크 수 불일치: sent=${chunkIndex}, expected=${expectedChunks}`;
      log(`ERROR: ${msg}`);
      throw new Error(msg);
    }
    if (bytesDone !== totalSize) {
      const msg = `전송 바이트 불일치: sent=${bytesDone}, expected=${totalSize}`;
      log(`ERROR: ${msg}`);
      throw new Error(msg);
    }

    throwIfAborted(signal);
    onProgress?.({ phase: 'geoserver-stop', message: '적용 준비 중...' });
    log('relay complete 요청...');
    const completeRes = await fetchWithTimeout(
      '/api/source/version/relay/complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      },
      COMPLETE_FETCH_TIMEOUT_MS,
      signal,
      { label: '병합·적용' }
    );

    if (!completeRes.ok) {
      const errJson = (await completeRes.json().catch(() => ({}))) as { error?: string };
      const msg = errJson.error ?? `relay complete 실패 (HTTP ${completeRes.status})`;
      log(`ERROR: ${msg}`);
      throw new Error(msg);
    }

    const completeJson = await readRelayCompleteNdjson(completeRes, (event) => {
      onProgress?.(event);
    });
    if (completeJson.error || completeJson.ok === false) {
      const msg = completeJson.error ?? 'relay complete 실패';
      log(`ERROR: ${msg}`);
      throw new Error(msg);
    }

    relayCompleted = true;
    activeUploadId = null;
    log(
      `적용 완료: ${completeJson.appliedFiles}건, GeoServer: ${completeJson.geoserver?.message ?? '-'}, 재시작: ${completeJson.restart?.message ?? '-'}`
    );

    // 성공 이력은 운영 서버가 재시작 전에 INSERT함. 클라이언트 후기록은 생략.

    return {
      ...completeJson,
      gnmsBaseUrl: cfg!.gnmsBaseUrl,
      latestUrl: cfg!.latestUrl,
      downloadUrl,
    };
  } catch (e: unknown) {
    if (activeUploadId && !relayCompleted) {
      await cleanupRelaySession(activeUploadId, log);
      activeUploadId = null;
    }
    if (!isUserAbortError(e)) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordVersionHistoryClient({
        historyType: 'apply_latest',
        status: 'fail',
        message: msg,
      }).catch(() => {});
    }
    throw e;
  }
}
