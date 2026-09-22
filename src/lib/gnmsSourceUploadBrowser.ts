import { classifyGnmsNetworkError, gnmsAuthHeaders, loadGnmsBrowserConfig } from '@/lib/gnmsBrowserClient';

export type BrowserRemoteStage = {
  id: string;
  ok: boolean;
  warn?: boolean;
  detail?: string;
  error?: string;
  status?: number;
};

export type BrowserRemoteUploadResult = {
  uploadId: string;
  chunkSize: number;
  expectedChunks: number;
  sentChunks: number;
  complete: Record<string, unknown>;
  stages: BrowserRemoteStage[];
};

type UploadParams = {
  progressId: string;
  zipName: string;
  zipSize: number;
  mode: string;
  date: string;
  changeNote: string;
  bundleRoot: string;
  includeNodeModules: boolean;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onChunkProgress?: (sent: number, expected: number) => void;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** 브라우저 → GNMS init/chunk/complete (로컬 prepared-zip 바이트 사용) */
export async function uploadPreparedZipToGnmsFromBrowser(
  params: UploadParams
): Promise<BrowserRemoteUploadResult> {
  const {
    progressId,
    zipName,
    zipSize,
    mode,
    date,
    changeNote,
    bundleRoot,
    includeNodeModules,
    signal,
    onLog,
    onChunkProgress,
  } = params;
  const log = (line: string) => onLog?.(line);
  const stages: BrowserRemoteStage[] = [];

  throwIfAborted(signal);
  const cfg = await loadGnmsBrowserConfig(signal);
  const base = (cfg.uploadBaseUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('GNMS uploadBaseUrl이 없습니다');
  const bearer = cfg.bearer ?? '';
  log(`GNMS 업로드: ${base}`);

  // preflight reach
  try {
    const reachRes = await fetch(base, { method: 'GET', signal, cache: 'no-store' });
    const ok = reachRes.status < 500;
    stages.push({
      id: 'preflight',
      ok,
      status: reachRes.status,
      detail: ok ? `서버 응답 HTTP ${reachRes.status}` : `서버 오류 HTTP ${reachRes.status}`,
      error: ok ? undefined : `HTTP ${reachRes.status}`,
    });
    if (!ok) throw new Error(`GNMS preflight 실패 HTTP ${reachRes.status}`);
  } catch (err: unknown) {
    throw classifyGnmsNetworkError(err, 'GNMS preflight', base);
  }

  throwIfAborted(signal);
  const initUrl = `${base}/init`;
  const initBody = {
    fileName: zipName,
    totalSize: zipSize,
    mode,
    date,
    changeNote,
    bundleRoot,
    bundleType: 'sourceZip',
    includeNodeModules,
  };
  let initRes: Response;
  try {
    initRes = await fetch(initUrl, {
      method: 'POST',
      headers: gnmsAuthHeaders(bearer, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(initBody),
      signal,
      cache: 'no-store',
    });
  } catch (err: unknown) {
    throw classifyGnmsNetworkError(err, 'GNMS init', initUrl);
  }
  const initJson = await readJson(initRes);
  if (!initRes.ok || initJson.error) {
    const message = String(initJson.error ?? initJson.message ?? `HTTP ${initRes.status}`);
    stages.push({ id: 'init', ok: false, status: initRes.status, error: message });
    throw new Error(`GNMS init 실패: ${message}`);
  }
  const uploadId = String(initJson.uploadId ?? '').trim();
  const chunkSize = Number(initJson.chunkSize);
  const expectedChunks = Number(initJson.expectedChunks);
  if (!uploadId || !(chunkSize > 0) || !(expectedChunks > 0)) {
    throw new Error('init 응답에 uploadId/chunkSize/expectedChunks가 없습니다');
  }
  stages.push({
    id: 'init',
    ok: true,
    status: initRes.status,
    detail: `uploadId=${uploadId}, chunks=${expectedChunks}`,
  });
  log(`init ok: chunks=${expectedChunks}, chunkSize=${chunkSize}`);

  let sentChunks = 0;
  let position = 0;
  for (let chunkIndex = 0; chunkIndex < expectedChunks; chunkIndex++) {
    throwIfAborted(signal);
    const want = Math.min(chunkSize, Math.max(zipSize - position, 0));
    if (want <= 0) break;
    const localRes = await fetch(
      `/api/source/upload/prepared-zip?progressId=${encodeURIComponent(progressId)}` +
        `&offset=${position}&length=${want}`,
      { cache: 'no-store', signal }
    );
    if (!localRes.ok) {
      const err = await readJson(localRes);
      throw new Error(String(err.error ?? `로컬 ZIP 읽기 실패 HTTP ${localRes.status}`));
    }
    const chunkBody = new Uint8Array(await localRes.arrayBuffer());
    position += chunkBody.byteLength;

    const chunkUrl =
      `${base}/chunk?uploadId=${encodeURIComponent(uploadId)}` +
      `&chunkIndex=${chunkIndex}&totalChunks=${expectedChunks}`;
    let chunkRes: Response;
    try {
      chunkRes = await fetch(chunkUrl, {
        method: 'POST',
        headers: gnmsAuthHeaders(bearer, { 'Content-Type': 'application/octet-stream' }),
        body: chunkBody,
        signal,
        cache: 'no-store',
      });
    } catch (err: unknown) {
      throw classifyGnmsNetworkError(err, `GNMS 청크 ${chunkIndex + 1}`, chunkUrl);
    }
    const chunkJson = await readJson(chunkRes);
    if (!chunkRes.ok || chunkJson.error || chunkJson.ok === false) {
      const message = String(
        chunkJson.error ?? chunkJson.message ?? `HTTP ${chunkRes.status}`
      );
      stages.push({
        id: 'chunk',
        ok: false,
        status: chunkRes.status,
        error: message,
        detail: `sent=${sentChunks}/${expectedChunks}`,
      });
      throw new Error(`청크 ${chunkIndex + 1}/${expectedChunks} 실패: ${message}`);
    }
    sentChunks += 1;
    onChunkProgress?.(sentChunks, expectedChunks);
    if (sentChunks === 1 || sentChunks % 5 === 0 || sentChunks === expectedChunks) {
      log(`chunk ${sentChunks}/${expectedChunks}`);
    }
  }

  if (sentChunks < expectedChunks) {
    throw new Error(`청크 전송 불완전: ${sentChunks}/${expectedChunks}`);
  }
  stages.push({
    id: 'chunk',
    ok: true,
    detail: `sent=${sentChunks}/${expectedChunks}`,
  });

  throwIfAborted(signal);
  const completeUrl = `${base}/complete`;
  let completeRes: Response;
  try {
    completeRes = await fetch(completeUrl, {
      method: 'POST',
      headers: gnmsAuthHeaders(bearer, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ uploadId }),
      signal,
      cache: 'no-store',
    });
  } catch (err: unknown) {
    throw classifyGnmsNetworkError(err, 'GNMS complete', completeUrl);
  }
  const completeJson = await readJson(completeRes);
  if (!completeRes.ok || completeJson.error) {
    const message = String(completeJson.error ?? completeJson.message ?? `HTTP ${completeRes.status}`);
    stages.push({ id: 'complete', ok: false, status: completeRes.status, error: message });
    throw new Error(`GNMS complete 실패: ${message}`);
  }
  stages.push({ id: 'complete', ok: true, status: completeRes.status });
  log('GNMS complete ok');

  return {
    uploadId,
    chunkSize,
    expectedChunks,
    sentChunks,
    complete: completeJson,
    stages,
  };
}

export async function cancelGnmsSourceUploadFromBrowser(options: {
  uploadId: string;
  signal?: AbortSignal;
  log?: (line: string) => void;
}): Promise<void> {
  try {
    const cfg = await loadGnmsBrowserConfig(options.signal);
    const base = (cfg.uploadBaseUrl ?? '').replace(/\/+$/, '');
    if (!base || !options.uploadId) return;
    const res = await fetch(`${base}/cancel`, {
      method: 'POST',
      headers: gnmsAuthHeaders(cfg.bearer, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ uploadId: options.uploadId, reason: 'user_abort' }),
      keepalive: true,
    });
    options.log?.(
      res.ok
        ? `GNMS 업로드 취소 통지 ok (uploadId=${options.uploadId})`
        : `WARNING: GNMS 업로드 취소 실패 HTTP ${res.status}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    options.log?.(`WARNING: GNMS 업로드 취소 요청 실패 — ${msg}`);
  }
}
