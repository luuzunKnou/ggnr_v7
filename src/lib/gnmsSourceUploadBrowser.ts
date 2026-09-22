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
  /** init | chunk | complete | npmInstall — UI 단계 전환용 */
  onRemotePhase?: (phase: 'init' | 'chunk' | 'complete' | 'npmInstall') => void;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const COMPLETE_POLL_INTERVAL_MS = 5_000;
const COMPLETE_POLL_TIMEOUT_MS = 30 * 60 * 1000;

function isLikelyProxyDisconnect(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return false;
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  return (
    err instanceof TypeError ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('fetch failed')
  );
}

function isCompleteSuccess(json: Record<string, unknown>, resOk: boolean): boolean {
  if (!resOk || json.error) return false;
  return (
    json.ok === true ||
    typeof json.mergedZipPath === 'string' ||
    typeof json.extractedPath === 'string' ||
    typeof json.savedPath === 'string' ||
    json.mergeCompleted === true ||
    json.recoveredFromProxy === true
  );
}

/** complete 응답이 프록시에서 끊겨도 GET init?uploadId 로 mergeCompleted 폴링 */
async function waitForBrowserMergeCompleted(params: {
  initUrl: string;
  uploadId: string;
  bearer: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}): Promise<Record<string, unknown>> {
  const { initUrl, uploadId, bearer, signal, onLog } = params;
  const started = Date.now();
  let polls = 0;
  const metaUrl = `${initUrl}?uploadId=${encodeURIComponent(uploadId)}`;
  while (Date.now() - started < COMPLETE_POLL_TIMEOUT_MS) {
    throwIfAborted(signal);
    polls += 1;
    try {
      const res = await fetch(metaUrl, {
        method: 'GET',
        headers: gnmsAuthHeaders(bearer),
        cache: 'no-store',
        signal,
      });
      const json = await readJson(res);
      const meta = (json.meta ?? {}) as Record<string, unknown>;
      if (res.ok && meta.mergeCompleted === true) {
        onLog?.(
          `GNMS complete 응답 끊김 복구: 원격 병합 완료 확인 (poll=${polls}, ${Math.round((Date.now() - started) / 1000)}초)`
        );
        return {
          ok: true,
          npmInstallPending: true,
          recoveredFromProxy: true,
          ...meta,
        };
      }
      onLog?.(
        `원격 병합/압축 해제 확인 중… (${polls}회, 프록시·게이트 응답 지연 가능)`
      );
    } catch (err: unknown) {
      if (signal?.aborted) throw err;
      onLog?.(
        `WARNING: 병합 상태 조회 실패 (${polls}회) — ${err instanceof Error ? err.message : String(err)}`
      );
    }
    await new Promise<void>((r) => setTimeout(r, COMPLETE_POLL_INTERVAL_MS));
  }
  throw new Error(
    '원격 병합 완료 대기 시간 초과. GNMS에 이미 반영됐을 수 있으니 원격 저장소를 확인한 뒤, 게이트 ProxyTimeout 증설을 검토하세요.'
  );
}

/** 브라우저 → GNMS init/chunk/complete (로컬 prepared-zip 바이트 사용) */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

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
    onRemotePhase,
  } = params;
  const log = (line: string) => onLog?.(line);
  const stages: BrowserRemoteStage[] = [];

  throwIfAborted(signal);
  const cfg = await loadGnmsBrowserConfig(signal);
  const base = (cfg.uploadBaseUrl ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('GNMS uploadBaseUrl이 없습니다');
  const bearer = cfg.bearer ?? '';
  log(`GNMS 업로드: ${base}`);
  onRemotePhase?.('init');

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
  onRemotePhase?.('chunk');

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
  log(`청크 전송 완료 ${sentChunks}/${expectedChunks} — complete 단계로 전환`);
  onRemotePhase?.('complete');
  /** 긴 complete 요청 전에 UI가 chunk→complete로 그려지도록 한 프레임 양보 */
  await yieldToUi();

  throwIfAborted(signal);
  const completeUrl = `${base}/complete`;
  const completeBody = {
    uploadId,
    extract: true,
    extractFolder: bundleRoot,
    preserveBundleZip: true,
    skipNpmInstall: !includeNodeModules,
  };
  log(`GNMS complete 요청 → ${completeUrl}`);

  let completeJson: Record<string, unknown> = {};
  let recoveredFromDisconnect = false;

  try {
    const completeRes = await fetch(completeUrl, {
      method: 'POST',
      headers: gnmsAuthHeaders(bearer, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(completeBody),
      signal,
      cache: 'no-store',
    });
    completeJson = await readJson(completeRes);
    if (!isCompleteSuccess(completeJson, completeRes.ok)) {
      if (completeRes.status === 502 || completeRes.status === 504) {
        log(
          `WARNING: complete HTTP ${completeRes.status} (프록시 타임아웃 가능) — 원격 병합 상태 폴링`
        );
        completeJson = await waitForBrowserMergeCompleted({
          initUrl,
          uploadId,
          bearer,
          signal,
          onLog: log,
        });
        recoveredFromDisconnect = true;
      } else {
        const message = String(
          completeJson.error ?? completeJson.message ?? `HTTP ${completeRes.status}`
        );
        stages.push({ id: 'complete', ok: false, status: completeRes.status, error: message });
        throw new Error(`GNMS complete 실패: ${message}`);
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw err;
    }
    /** 청크까지 성공한 뒤 complete만 Failed to fetch → 대개 프록시 유휴 끊김(작업은 GNMS에서 계속) */
    if (isLikelyProxyDisconnect(err)) {
      log(
        `WARNING: complete 연결 끊김 (${err instanceof Error ? err.message : String(err)}) — 원격 병합 상태 폴링으로 복구 시도`
      );
      try {
        completeJson = await waitForBrowserMergeCompleted({
          initUrl,
          uploadId,
          bearer,
          signal,
          onLog: log,
        });
        recoveredFromDisconnect = true;
      } catch (recoverErr: unknown) {
        const recoverMsg =
          recoverErr instanceof Error ? recoverErr.message : String(recoverErr);
        stages.push({ id: 'complete', ok: false, error: recoverMsg });
        throw new Error(
          `GNMS complete 응답을 받지 못했고 병합 완료도 확인하지 못했습니다. ` +
            `청크는 전송됐을 수 있으니 GNMS 저장 여부를 확인하세요. (${recoverMsg})`
        );
      }
    } else if (err instanceof Error && err.message.startsWith('GNMS complete 실패')) {
      throw err;
    } else {
      throw classifyGnmsNetworkError(err, 'GNMS complete', completeUrl);
    }
  }

  stages.push({
    id: 'complete',
    ok: true,
    detail: recoveredFromDisconnect
      ? 'complete 성공 (프록시 끊김 후 병합 폴링 복구)'
      : 'complete 성공',
  });
  log(
    recoveredFromDisconnect
      ? 'GNMS complete ok (응답 끊김 → 원격 mergeCompleted 확인)'
      : 'GNMS complete ok'
  );

  /** 서버 경로와 동일: merge 후 npmInstallPending 이면 별도 npm-install */
  if (completeJson.npmInstallPending === true && !includeNodeModules) {
    const npmInstallUrl = `${base}/npm-install`;
    onRemotePhase?.('npmInstall');
    await yieldToUi();
    log('GNMS npm-install 요청');
    try {
      const npmRes = await fetch(npmInstallUrl, {
        method: 'POST',
        headers: gnmsAuthHeaders(bearer, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ uploadId }),
        signal,
        cache: 'no-store',
      });
      const npmJson = await readJson(npmRes);
      if (!npmRes.ok || npmJson.error) {
        throw new Error(
          String(npmJson.error ?? npmJson.message ?? `npm install HTTP ${npmRes.status}`)
        );
      }
      completeJson = { ...completeJson, npmInstall: npmJson.npmInstall ?? npmJson };
      stages.push({ id: 'npmInstall', ok: true, detail: 'npm install 완료' });
    } catch (err: unknown) {
      if (isLikelyProxyDisconnect(err)) {
        log(
          'WARNING: npm-install 응답 끊김 — complete 복구와 같이 원격에서 끝났을 수 있음. 이력을 확인하세요.'
        );
        stages.push({
          id: 'npmInstall',
          ok: true,
          warn: true,
          detail: 'npm-install 응답 끊김(원격 진행 가능)',
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        stages.push({ id: 'npmInstall', ok: false, error: msg });
        throw new Error(`GNMS npm-install 실패: ${msg}`);
      }
    }
  } else if (includeNodeModules) {
    stages.push({ id: 'npmInstall', ok: true, detail: '생략 (node_modules 포함)' });
  }

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
