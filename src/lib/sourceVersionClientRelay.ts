import type { SourcePackageProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { includeNodeModulesFromProfile } from '@/app/(pages)/dev/_components/sourceUpload/sourceUploadProfiles';
import { resolveGnmsApiUrl } from '@/lib/gnmsSourceUrl';
import { recordVersionHistoryClient } from '@/lib/recordVersionHistoryClient';

export type RestartMode = 'none' | 'exit' | 'command';

export type VersionRelayPhase = 'latest' | 'download' | 'relay-init' | 'relay-chunk' | 'relay-complete';

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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

function gnmsHeaders(bearer: string): Record<string, string> {
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<Response> {
  throwIfAborted(externalSignal);
  if (timeoutMs <= 0) {
    if (!externalSignal && !init.signal) return fetch(input, init);
    const signals: AbortSignal[] = [];
    if (init.signal) signals.push(init.signal);
    if (externalSignal) signals.push(externalSignal);
    const mergedSignal =
      signals.length > 1 && typeof AbortSignal !== 'undefined' && 'any' in AbortSignal
        ? AbortSignal.any(signals)
        : (externalSignal ?? init.signal);
    return fetch(input, { ...init, signal: mergedSignal });
  }

  const timeoutController = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => timeoutController.abort(), timeoutMs) : null;
  const onExternalAbort = () => timeoutController.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  const signals: AbortSignal[] = [timeoutController.signal];
  if (init.signal) signals.push(init.signal);
  const mergedSignal =
    typeof AbortSignal !== 'undefined' && 'any' in AbortSignal
      ? AbortSignal.any(signals)
      : timeoutController.signal;

  try {
    return await fetch(input, { ...init, signal: mergedSignal });
  } finally {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    if (timer) clearTimeout(timer);
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

  try {
    throwIfAborted(signal);
    onProgress?.({ phase: 'latest', message: 'GNMS 설정 조회 중...' });
    const cfgRes = await fetch('/api/source/version/gnms-config', { cache: 'no-store', signal });
    cfg = (await cfgRes.json().catch(() => ({}))) as GnmsConfigResponse;
    if (!cfgRes.ok) throw new Error(cfg?.error ?? 'GNMS 설정 조회 실패');

    log(`GNMS: ${cfg.gnmsBaseUrl}`);

    throwIfAborted(signal);
    onProgress?.({ phase: 'latest', message: 'GNMS 최신 버전 조회 중...' });
    const latestRes = await fetchWithTimeout(
      cfg.latestUrl,
      { method: 'GET', headers: gnmsHeaders(cfg.bearer), cache: 'no-store' },
      60_000,
      signal
    );
    const latestJson = (await latestRes.json().catch(() => ({}))) as GnmsLatestPayload;
    if (!latestRes.ok) {
      throw new Error(`GNMS latest 조회 실패 (${latestRes.status}): ${await readJsonError(latestRes, '')}`);
    }

    const version = String(latestJson.version ?? '').trim() || new Date().toISOString();
    const fileName = String(latestJson.fileName ?? '').trim() || `source_latest_${Date.now()}.zip`;
    const downloadUrlRaw = String(latestJson.downloadUrl ?? '').trim() || cfg.downloadUrlFallback;
    const downloadUrl = resolveGnmsApiUrl(cfg.gnmsBaseUrl, downloadUrlRaw);
    log(`latest: version=${version}, file=${fileName}`);

    throwIfAborted(signal);
    onProgress?.({ phase: 'download', message: 'GNMS ZIP 다운로드 시작...' });
    const downloadRes = await fetchWithTimeout(
      downloadUrl,
      { method: 'GET', headers: gnmsHeaders(cfg.bearer), cache: 'no-store' },
      0,
      signal
    );
    if (!downloadRes.ok) {
      throw new Error(`GNMS 소스 다운로드 실패 (${downloadRes.status})`);
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
      body: JSON.stringify({ fileName, totalSize, version, restart, restartMode, includeNodeModules }),
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
          signal
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
      throw new Error(`청크 수 불일치: sent=${chunkIndex}, expected=${expectedChunks}`);
    }
    if (bytesDone !== totalSize) {
      throw new Error(`전송 바이트 불일치: sent=${bytesDone}, expected=${totalSize}`);
    }

    throwIfAborted(signal);
    onProgress?.({ phase: 'relay-complete', message: '병합·적용·재시작 처리 중...' });
    log('relay complete 요청...');
    const completeRes = await fetchWithTimeout(
      '/api/source/version/relay/complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      },
      COMPLETE_FETCH_TIMEOUT_MS,
      signal
    );
    const completeJson = (await completeRes.json().catch(() => ({}))) as VersionRelayResult & {
      error?: string;
      ok?: boolean;
    };
    if (!completeRes.ok || completeJson.error || completeJson.ok === false) {
      throw new Error(completeJson.error ?? 'relay complete 실패');
    }

    log(`적용 완료: ${completeJson.appliedFiles}건, 재시작: ${completeJson.restart?.message ?? '-'}`);

    await recordVersionHistoryClient({
      historyType: 'apply_latest',
      status: 'success',
      message: `적용 ${completeJson.appliedFiles}건 · 제외 ${completeJson.skippedFiles}건 · ${packageProfile === 'closed' ? '폐쇄망' : '개방망'}`,
    });

    return {
      ...completeJson,
      gnmsBaseUrl: cfg!.gnmsBaseUrl,
      latestUrl: cfg!.latestUrl,
      downloadUrl,
    };
  } catch (e: unknown) {
    const isAbort = e instanceof Error && e.name === 'AbortError';
    if (!isAbort) {
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
