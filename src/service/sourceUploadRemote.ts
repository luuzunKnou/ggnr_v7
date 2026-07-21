import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import { Agent } from 'undici';
import {
  failUploadProgress,
  patchUploadProgress,
  setChunkProgress,
  setUploadProgressPhase,
} from '@/service/sourceUploadProgress';

export const SOURCE_UPLOAD_REMOTE_BASE =
  process.env.SOURCE_UPLOAD_REMOTE_BASE ?? 'http://192.168.126.1:3000/api/source/upload';
export const SOURCE_UPLOAD_REMOTE_BEARER = process.env.SOURCE_UPLOAD_REMOTE_BEARER ?? '';

export type RemoteUploadStageId = 'preflight' | 'init' | 'chunk' | 'complete' | 'npmInstall';

export type RemoteStageReport = {
  id: RemoteUploadStageId;
  ok: boolean;
  detail?: string;
  error?: string;
  status?: number;
};

export type PreflightCheck = {
  id: string;
  ok: boolean;
  status?: number;
  message: string;
};

export type PreflightResult = {
  ok: boolean;
  remoteBase: string;
  targetHost: string;
  targetIp?: string;
  targetOrigin: string;
  /** IP·URL 한 줄 (로그/UI용, 한 번만 표시) */
  targetLabel: string;
  errorSummary?: string;
  checks: PreflightCheck[];
};

type PreflightTarget = {
  remoteBase: string;
  targetHost: string;
  targetIp?: string;
  targetOrigin: string;
  targetLabel: string;
};

type JsonRecord = Record<string, unknown> & { error?: string; message?: string };

function isIpv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function buildTargetLabel(target: Pick<PreflightTarget, 'targetIp' | 'targetHost' | 'remoteBase'>): string {
  const ipPart = target.targetIp ? `IP=${target.targetIp}, ` : '';
  return `${ipPart}URL=${target.remoteBase}`;
}

async function resolveTargetFromUrl(remoteBase: string): Promise<PreflightTarget | null> {
  try {
    const parsed = new URL(remoteBase);
    const targetHost = parsed.hostname;
    let targetIp: string | undefined;
    if (isIpv4(targetHost)) {
      targetIp = targetHost;
    } else {
      try {
        const looked = await dns.lookup(targetHost, { family: 4 });
        targetIp = looked.address;
      } catch {
        targetIp = undefined;
      }
    }
    const base: Omit<PreflightTarget, 'targetLabel'> = {
      remoteBase,
      targetHost,
      targetIp,
      targetOrigin: parsed.origin,
    };
    return { ...base, targetLabel: buildTargetLabel(base) };
  } catch {
    return null;
  }
}

function logStage(tag: string, data: Record<string, unknown>): void {
  console.log(`[source-upload][${tag}]`, JSON.stringify(data));
}

export class RemoteUploadError extends Error {
  stage: RemoteUploadStageId;
  status?: number;
  responseBody?: string;
  chunkIndex?: number;
  sentChunks?: number;
  expectedChunks?: number;
  stages: RemoteStageReport[];

  constructor(params: {
    stage: RemoteUploadStageId;
    message: string;
    status?: number;
    responseBody?: string;
    chunkIndex?: number;
    sentChunks?: number;
    expectedChunks?: number;
    stages: RemoteStageReport[];
  }) {
    super(params.message);
    this.name = 'RemoteUploadError';
    this.stage = params.stage;
    this.status = params.status;
    this.responseBody = params.responseBody;
    this.chunkIndex = params.chunkIndex;
    this.sentChunks = params.sentChunks;
    this.expectedChunks = params.expectedChunks;
    this.stages = params.stages;
  }
}

export function getRemoteUploadBase(): string {
  return SOURCE_UPLOAD_REMOTE_BASE.replace(/\/+$/, '');
}

export function buildRemoteAuthHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (SOURCE_UPLOAD_REMOTE_BEARER) {
    headers.Authorization = `Bearer ${SOURCE_UPLOAD_REMOTE_BEARER}`;
  }
  return headers;
}

export type CancelRemoteSourceUploadResult = {
  ok: boolean;
  status: number;
  gnmsStatus?: string;
  error?: string;
};

/** GNMS 소스 업로드 세션 취소 통보 (브라우저 AbortSignal에 묶지 말 것) */
export async function cancelRemoteSourceUpload(params: {
  uploadId: string;
  reason?: string;
}): Promise<CancelRemoteSourceUploadResult> {
  const uploadId = params.uploadId.trim();
  if (!uploadId) {
    return { ok: false, status: 400, error: 'uploadId 필요' };
  }
  const url = `${getRemoteUploadBase()}/cancel`;
  const body = {
    uploadId,
    reason: params.reason?.trim() || 'user_abort',
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildRemoteAuthHeaders(true),
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
    };
    logStage('remote-cancel', {
      url,
      uploadId,
      httpStatus: res.status,
      response: json,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        gnmsStatus: json.status,
        error: json.error ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      status: res.status,
      gnmsStatus: json.status ?? 'cancelled',
    };
  } catch (err: unknown) {
    const message = formatFetchCause(err);
    logStage('remote-cancel', { url, uploadId, error: message });
    return { ok: false, status: 0, error: message };
  }
}

function formatFetchCause(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) return `${err.message}: ${cause.message}`;
    return err.message;
  }
  return String(err);
}

export async function readHttpErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  try {
    const json = JSON.parse(text) as JsonRecord;
    return json.error ?? json.message ?? text.slice(0, 800);
  } catch {
    return text.slice(0, 800);
  }
}

async function readResponseJson(res: Response): Promise<{ json: JsonRecord; text: string }> {
  const text = await res.text().catch(() => '');
  if (!text) return { json: {}, text: '' };
  try {
    return { json: JSON.parse(text) as JsonRecord, text };
  } catch {
    return { json: {}, text };
  }
}

/** complete(병합+압축해제) 및 npm install 은 대용량에서 5분 이상 걸릴 수 있음 */
const COMPLETE_FETCH_TIMEOUT_MS = 30 * 60 * 1000;

/** Node fetch(undici) 기본 headersTimeout=300s — complete 응답 대기용 */
const longRunningFetchAgent = new Agent({
  headersTimeout: COMPLETE_FETCH_TIMEOUT_MS,
  bodyTimeout: COMPLETE_FETCH_TIMEOUT_MS,
});

type UndiciFetchInit = RequestInit & { dispatcher?: Agent };

async function fetchCompleteLongRunning(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPLETE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      dispatcher: longRunningFetchAgent,
    } as UndiciFetchInit);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`요청 시간 초과 (${COMPLETE_FETCH_TIMEOUT_MS}ms)`);
    }
    throw new Error(formatFetchCause(err));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetch(url, { ...init, cache: 'no-store' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`요청 시간 초과 (${timeoutMs}ms)`);
    }
    throw new Error(formatFetchCause(err));
  } finally {
    clearTimeout(timer);
  }
}

const PREFLIGHT_PROBE_TIMEOUT_MS = 15_000;
const PREFLIGHT_TIMEOUT_USER_MSG = '예상 시간 초과(15초). 다시 시도해주세요.';

/** preflight reach/init 전용 — 15초 초과와 일반 연결 실패 구분 */
function preflightProbeErrorMessage(err: unknown): string {
  const raw = formatFetchCause(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes('시간 초과') ||
    lower.includes('timeout') ||
    lower.includes('aborterror') ||
    /요청 시간 초과\s*\(15000\s*ms\)/.test(raw)
  ) {
    return PREFLIGHT_TIMEOUT_USER_MSG;
  }
  return `서버 연결 실패: ${raw}`;
}

function preflightInitErrorMessage(err: unknown): string {
  const raw = formatFetchCause(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes('시간 초과') ||
    lower.includes('timeout') ||
    lower.includes('aborterror') ||
    /요청 시간 초과\s*\(15000\s*ms\)/.test(raw)
  ) {
    return PREFLIGHT_TIMEOUT_USER_MSG;
  }
  return `init API 호출 실패: ${raw}`;
}

function preflightResult(
  target: PreflightTarget,
  ok: boolean,
  checks: PreflightCheck[]
): PreflightResult {
  const failed = checks.find((c) => !c.ok);
  return {
    ok,
    remoteBase: target.remoteBase,
    targetHost: target.targetHost,
    targetIp: target.targetIp,
    targetOrigin: target.targetOrigin,
    targetLabel: target.targetLabel,
    errorSummary:
      ok || !failed ? undefined : `${target.targetLabel} — ${failed.message}`,
    checks,
  };
}

const INIT_PROBE_BODY = {
  fileName: 'preflight_probe.zip',
  totalSize: 1,
  mode: 'install',
  date: '2026-01-01',
  changeNote: 'preflight',
  bundleRoot: 'preflight_probe',
  bundleType: 'sourceZip',
};

/** 전송 시작 전 대상 서버/API 수신 가능 여부 확인 (init/chunk/complete 플로우만) */
export async function checkRemoteTargetReady(): Promise<PreflightResult> {
  const remoteBase = getRemoteUploadBase();
  const checks: PreflightCheck[] = [];

  const target = await resolveTargetFromUrl(remoteBase);
  if (!target) {
    checks.push({ id: 'target', ok: false, message: `잘못된 URL: ${remoteBase}` });
    return {
      ok: false,
      remoteBase,
      targetHost: '',
      targetOrigin: '',
      targetLabel: `URL=${remoteBase}`,
      errorSummary: `URL=${remoteBase} — 잘못된 URL`,
      checks,
    };
  }

  checks.push({ id: 'target', ok: true, message: target.targetLabel });

  try {
    const reachRes = await fetchWithTimeout(
      target.targetOrigin,
      { method: 'GET' },
      PREFLIGHT_PROBE_TIMEOUT_MS
    );
    const ok = reachRes.status < 500;
    checks.push({
      id: 'reach',
      ok,
      status: reachRes.status,
      message: ok ? `서버 응답 HTTP ${reachRes.status}` : `서버 오류 HTTP ${reachRes.status}`,
    });
    if (!ok) return preflightResult(target, false, checks);
  } catch (err) {
    checks.push({
      id: 'reach',
      ok: false,
      message: preflightProbeErrorMessage(err),
    });
    return preflightResult(target, false, checks);
  }

  const initUrl = `${target.remoteBase}/init`;
  try {
    const initRes = await fetchWithTimeout(
      initUrl,
      {
        method: 'POST',
        headers: buildRemoteAuthHeaders(),
        body: JSON.stringify(INIT_PROBE_BODY),
      },
      PREFLIGHT_PROBE_TIMEOUT_MS
    );
    const { json: initJson, text: initText } = await readResponseJson(initRes);
    const initMsg = initJson.error ?? initJson.message ?? (initText ? initText.slice(0, 200) : '');
    const initOk = initRes.ok || initRes.status === 401;
    checks.push({
      id: 'init-api',
      ok: initOk,
      status: initRes.status,
      message: initOk
        ? `init API HTTP ${initRes.status}${initMsg ? ` — ${initMsg}` : ''}`
        : initMsg || `HTTP ${initRes.status}`,
    });
    logStage('preflight-init', {
      target: target.targetLabel,
      url: initUrl,
      status: initRes.status,
      response: initJson,
    });
    if (!initOk) return preflightResult(target, false, checks);
  } catch (err) {
    checks.push({
      id: 'init-api',
      ok: false,
      message: preflightInitErrorMessage(err),
    });
    return preflightResult(target, false, checks);
  }

  return preflightResult(target, true, checks);
}

type UploadZipParams = {
  zipPath: string;
  zipName: string;
  totalSize: number;
  mode: string;
  date: string;
  changeNote: string;
  bundleRoot: string;
  skipPreflight?: boolean;
  progressId?: string;
  includeNodeModules?: boolean;
};

export type RemoteUploadResult = {
  uploadId: string;
  chunkSize: number;
  expectedChunks: number;
  sentChunks: number;
  complete: Record<string, unknown>;
  stages: RemoteStageReport[];
};

function isCompleteSuccess(json: JsonRecord, resOk: boolean): boolean {
  if (!resOk || json.error) return false;
  return (
    json.ok === true ||
    typeof json.mergedZipPath === 'string' ||
    typeof json.extractedPath === 'string' ||
    typeof json.savedPath === 'string'
  );
}

function reportFail(progressId: string | undefined, stage: string, message: string, extra?: Parameters<typeof failUploadProgress>[3]) {
  if (progressId) failUploadProgress(progressId, stage, message, extra);
}

export async function uploadZipByChunks(params: UploadZipParams): Promise<RemoteUploadResult> {
  const {
    zipPath,
    zipName,
    totalSize,
    mode,
    date,
    changeNote,
    bundleRoot,
    skipPreflight,
    progressId,
    includeNodeModules = false,
  } = params;
  const base = getRemoteUploadBase();
  const initUrl = `${base}/init`;
  const chunkUrl = `${base}/chunk`;
  const completeUrl = `${base}/complete`;
  const headers = buildRemoteAuthHeaders();
  const stages: RemoteStageReport[] = [];

  if (progressId) {
    setUploadProgressPhase(progressId, 'init', '원격 init 준비 중...');
  }

  if (!skipPreflight) {
    if (progressId) setUploadProgressPhase(progressId, 'preflight', '대상 서버 확인 중...');
    const pre = await checkRemoteTargetReady();
    stages.push({
      id: 'preflight',
      ok: pre.ok,
      detail: pre.ok
        ? `${pre.targetLabel} | ${pre.checks.filter((c) => c.id !== 'target').map((c) => c.message).join(' | ')}`
        : pre.errorSummary,
      error: pre.ok ? undefined : pre.errorSummary,
    });
    if (!pre.ok) {
      const message = pre.errorSummary ?? '대상 서버 preflight 실패';
      reportFail(progressId, 'preflight', message);
      throw new RemoteUploadError({ stage: 'preflight', message, stages });
    }
  }

  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    const message = `totalSize가 올바르지 않습니다: ${totalSize}`;
    stages.push({ id: 'init', ok: false, error: message });
    reportFail(progressId, 'init', message);
    throw new RemoteUploadError({ stage: 'init', message, stages });
  }

  if (progressId) {
    setUploadProgressPhase(progressId, 'init', `원격 init 요청 (${Math.round(totalSize / 1024 / 1024)}MB)...`, {
      zipName,
      zipSize: totalSize,
    });
  }

  const initBody = {
    fileName: zipName,
    totalSize,
    mode,
    date,
    changeNote,
    bundleRoot,
    bundleType: 'sourceZip',
    includeNodeModules,
  };

  let initRes: Response;
  try {
    initRes = await fetchWithTimeout(
      initUrl,
      { method: 'POST', headers, body: JSON.stringify(initBody) },
      60_000
    );
  } catch (err) {
    const message = `init 호출 실패: ${formatFetchCause(err)}`;
    stages.push({ id: 'init', ok: false, error: message });
    reportFail(progressId, 'init', message);
    throw new RemoteUploadError({ stage: 'init', message, stages });
  }

  const { json: initJson, text: initText } = await readResponseJson(initRes);
  logStage('init', { url: initUrl, request: initBody, status: initRes.status, response: initJson });

  if (!initRes.ok || initJson.error) {
    const message =
      initJson.error ??
      initJson.message ??
      (initText.slice(0, 800) || `HTTP ${initRes.status}`);
    stages.push({ id: 'init', ok: false, status: initRes.status, error: message });
    reportFail(progressId, 'init', message, { failedStage: 'init' });
    throw new RemoteUploadError({
      stage: 'init',
      message,
      status: initRes.status,
      responseBody: initText,
      stages,
    });
  }

  const uploadId = String(initJson.uploadId ?? '').trim();
  const chunkSize = Number(initJson.chunkSize);
  const expectedChunks = Number(initJson.expectedChunks);
  if (
    !uploadId ||
    !Number.isFinite(chunkSize) ||
    chunkSize <= 0 ||
    !Number.isFinite(expectedChunks) ||
    expectedChunks <= 0
  ) {
    const message = 'init 응답에 uploadId/chunkSize/expectedChunks가 없습니다.';
    stages.push({ id: 'init', ok: false, error: message });
    reportFail(progressId, 'init', message);
    throw new RemoteUploadError({ stage: 'init', message, stages });
  }

  stages.push({
    id: 'init',
    ok: true,
    status: initRes.status,
    detail: `uploadId=${uploadId}, chunks=${expectedChunks}, chunkSize=${chunkSize}`,
  });

  if (progressId) {
    patchUploadProgress(progressId, { remoteUploadId: uploadId });
    setUploadProgressPhase(progressId, 'chunk', `청크 0/${expectedChunks} — 전송 시작`, {
      sentChunks: 0,
      expectedChunks,
      zipName,
      zipSize: totalSize,
      remoteUploadId: uploadId,
    });
  }

  const chunkHeaders: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  };
  if (SOURCE_UPLOAD_REMOTE_BEARER) {
    chunkHeaders.Authorization = `Bearer ${SOURCE_UPLOAD_REMOTE_BEARER}`;
  }

  let sentChunks = 0;
  const fh = await fs.open(zipPath, 'r');
  try {
    let position = 0;
    for (let chunkIndex = 0; chunkIndex < expectedChunks; chunkIndex++) {
      const remain = totalSize - position;
      const want = Math.min(chunkSize, Math.max(remain, 0));
      if (want <= 0) break;
      const buf = Buffer.allocUnsafe(want);
      const read = await fh.read(buf, 0, want, position);
      if (read.bytesRead <= 0) break;
      position += read.bytesRead;

      const byteLength = read.bytesRead;
      const url = `${chunkUrl}?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}&totalChunks=${expectedChunks}`;
      let chunkRes: Response;
      try {
        chunkRes = await fetchWithTimeout(
          url,
          { method: 'POST', body: buf.subarray(0, byteLength), headers: chunkHeaders },
          120_000
        );
      } catch (err) {
        const message = `청크 ${chunkIndex + 1}/${expectedChunks} 전송 실패: ${formatFetchCause(err)}`;
        logStage('chunk', { i: chunkIndex + 1, N: expectedChunks, byteLength, url, error: message });
        stages.push({
          id: 'chunk',
          ok: false,
          error: message,
          detail: `sent=${sentChunks}/${expectedChunks}`,
        });
        reportFail(progressId, 'chunk', message, { sentChunks, expectedChunks, chunkIndex });
        throw new RemoteUploadError({
          stage: 'chunk',
          message,
          chunkIndex,
          sentChunks,
          expectedChunks,
          stages,
        });
      }

      const { json: chunkJson, text: chunkText } = await readResponseJson(chunkRes);
      const chunkErr =
        !chunkRes.ok || chunkJson.error || chunkJson.ok === false
          ? String(
              chunkJson.error ??
                chunkJson.message ??
                (chunkText.slice(0, 800) || `HTTP ${chunkRes.status}`)
            )
          : null;

      logStage('chunk', {
        i: chunkIndex + 1,
        N: expectedChunks,
        byteLength,
        url,
        status: chunkRes.status,
        response: chunkJson,
      });

      if (chunkErr) {
        const message = `청크 ${chunkIndex + 1}/${expectedChunks} 거부: ${chunkErr}`;
        stages.push({
          id: 'chunk',
          ok: false,
          status: chunkRes.status,
          error: message,
          detail: `sent=${sentChunks}/${expectedChunks}`,
        });
        reportFail(progressId, 'chunk', message, { sentChunks, expectedChunks, chunkIndex });
        throw new RemoteUploadError({
          stage: 'chunk',
          message,
          status: chunkRes.status,
          responseBody: chunkText,
          chunkIndex,
          sentChunks,
          expectedChunks,
          stages,
        });
      }

      sentChunks += 1;
      if (progressId) {
        setChunkProgress(progressId, sentChunks, expectedChunks, chunkIndex);
      }
    }
  } finally {
    await fh.close();
  }

  if (sentChunks < expectedChunks) {
    const message = `청크 전송 불완전: ${sentChunks}/${expectedChunks}`;
    stages.push({ id: 'chunk', ok: false, error: message, detail: `sent=${sentChunks}/${expectedChunks}` });
    reportFail(progressId, 'chunk', message, { sentChunks, expectedChunks });
    throw new RemoteUploadError({
      stage: 'chunk',
      message,
      sentChunks,
      expectedChunks,
      stages,
    });
  }

  stages.push({
    id: 'chunk',
    ok: true,
    detail: `${sentChunks}/${expectedChunks} 전송 완료`,
  });

  if (progressId) {
    setUploadProgressPhase(
      progressId,
      'complete',
      `청크 ${sentChunks}/${expectedChunks} 완료 — 원격 병합/압축 해제 중...`,
      {
        sentChunks,
        expectedChunks,
        progressPct: 90,
      }
    );
  }

  try {
    const statusRes = await fetchWithTimeout(
      `${chunkUrl}?uploadId=${encodeURIComponent(uploadId)}`,
      { method: 'GET', headers: SOURCE_UPLOAD_REMOTE_BEARER ? { Authorization: `Bearer ${SOURCE_UPLOAD_REMOTE_BEARER}` } : {} },
      15_000
    );
    const { json: statusJson } = await readResponseJson(statusRes);
    logStage('chunk-status', { uploadId, status: statusRes.status, response: statusJson });
  } catch (err) {
    logStage('chunk-status', { uploadId, error: formatFetchCause(err) });
  }

  const completeBody = {
    uploadId,
    extract: true,
    extractFolder: bundleRoot,
    preserveBundleZip: true,
    skipNpmInstall: !includeNodeModules,
  };

  const npmInstallUrl = `${base}/npm-install`;

  let completeRes: Response;
  try {
    completeRes = await fetchCompleteLongRunning(completeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(completeBody),
    });
  } catch (err) {
    const message = `complete 호출 실패: ${formatFetchCause(err)}`;
    stages.push({ id: 'complete', ok: false, error: message });
    reportFail(progressId, 'complete', message, { sentChunks, expectedChunks });
    throw new RemoteUploadError({ stage: 'complete', message, sentChunks, expectedChunks, stages });
  }

  let { json: completeJson, text: completeText } = await readResponseJson(completeRes);
  logStage('complete', {
    url: completeUrl,
    request: completeBody,
    status: completeRes.status,
    response: completeJson,
  });

  if (!isCompleteSuccess(completeJson, completeRes.ok)) {
    const message =
      completeJson.error ??
      completeJson.message ??
      (completeText.slice(0, 800) || 'complete 응답이 올바르지 않습니다.');
    stages.push({
      id: 'complete',
      ok: false,
      status: completeRes.status,
      error: message,
    });
    reportFail(progressId, 'complete', message, { sentChunks, expectedChunks });
    throw new RemoteUploadError({
      stage: 'complete',
      message,
      status: completeRes.status,
      responseBody: completeText,
      stages,
      sentChunks,
      expectedChunks,
    });
  }

  const completeDetail = [
    completeJson.mergedZipPath ? `merged=${String(completeJson.mergedZipPath)}` : null,
    completeJson.extractedPath ? `extracted=${String(completeJson.extractedPath)}` : null,
    completeJson.savedPath ? `saved=${String(completeJson.savedPath)}` : null,
    completeJson.totalSize != null ? `size=${String(completeJson.totalSize)}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  stages.push({
    id: 'complete',
    ok: true,
    status: completeRes.status,
    detail: completeDetail || 'complete 성공',
  });

  let npmInstall = completeJson.npmInstall as
    | { ok?: boolean; message?: string; skipped?: boolean }
    | undefined;

  const npmInstallPending = completeJson.npmInstallPending === true;

  if (npmInstallPending) {
    if (progressId) {
      setUploadProgressPhase(progressId, 'npmInstall', 'npm install 중...', {
        sentChunks,
        expectedChunks,
        progressPct: 93,
      });
    }

    let npmRes: Response;
    try {
      npmRes = await fetchCompleteLongRunning(npmInstallUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ uploadId }),
      });
    } catch (err) {
      const message = `npm install 호출 실패: ${formatFetchCause(err)}`;
      reportFail(progressId, 'npmInstall', message, { sentChunks, expectedChunks });
      throw new RemoteUploadError({
        stage: 'npmInstall',
        message,
        sentChunks,
        expectedChunks,
        stages,
      });
    }

    const { json: npmJson, text: npmText } = await readResponseJson(npmRes);
    logStage('npm-install', {
      url: npmInstallUrl,
      request: { uploadId },
      status: npmRes.status,
      response: npmJson,
    });

    if (!npmRes.ok || npmJson.error) {
      const message =
        (typeof npmJson.error === 'string' ? npmJson.error : null) ??
        (npmText.slice(0, 800) || 'npm install 실패');
      reportFail(progressId, 'npmInstall', message, { sentChunks, expectedChunks });
      throw new RemoteUploadError({
        stage: 'npmInstall',
        message,
        status: npmRes.status,
        responseBody: npmText,
        stages,
        sentChunks,
        expectedChunks,
      });
    }

    npmInstall = npmJson.npmInstall as typeof npmInstall;
    completeJson = { ...completeJson, npmInstall };
  }

  if (progressId) {
    if (npmInstall?.skipped) {
      setUploadProgressPhase(progressId, 'npmInstall', 'npm install 생략 (node_modules 포함)', {
        progressPct: 98,
      });
    } else if (npmInstall) {
      setUploadProgressPhase(progressId, 'npmInstall', npmInstall.message ?? 'npm install 완료', {
        progressPct: npmInstall.ok ? 98 : 95,
      });
    }
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
