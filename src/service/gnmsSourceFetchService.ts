import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveGnmsApiUrl } from '@/lib/gnmsSourceUrl';
import {
  applySourceZipFile,
  getGnmsClientConfig,
  normalizeRestartMode,
  type ApplySourceProgressEvent,
  type ApplySourceZipResult,
  type RestartMode,
} from '@/service/sourceVersionService';

export type GnmsProxyProgressEvent = Omit<ApplySourceProgressEvent, 'phase'> & {
  phase: ApplySourceProgressEvent['phase'] | 'latest' | 'download';
  bytesDone?: number;
  totalBytes?: number;
};

export type GnmsVersionListEntry = {
  folder: string;
  date: string;
  changeNote: string | null;
  createdAt: string;
  isLatest: boolean;
  hasCachedZip: boolean;
  sizeBytes: number | null;
};

type GnmsLatestPayload = {
  jobId?: string;
  version?: string;
  fileName?: string;
  downloadUrl?: string;
  size?: number;
  sizeBytes?: number;
  totalSize?: number;
};

export type GnmsFetchedZip = {
  version: string;
  fileName: string;
  jobId: string;
  downloadUrl: string;
  zipPath: string;
  tmpDir: string;
  sizeBytes: number;
};

function gnmsHeaders(bearer?: string): Record<string, string> {
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

function withJobIdQuery(downloadUrl: string, jobId: string): string {
  const u = new URL(downloadUrl);
  u.searchParams.set('jobId', jobId);
  return u.toString();
}

function isDownloadJobEndedError(status: number, apiMsg: string): boolean {
  if (status !== 404) return false;
  const lower = apiMsg.toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('already ended') ||
    lower.includes('job not found')
  );
}

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return String(json.error ?? json.message ?? fallback).trim();
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

function gnmsTmpRoot(): string {
  const leaf = ['ggnr', 'gnms', 'fetch'].join('_');
  return `${os.tmpdir()}${path.sep}${leaf}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

export async function fetchGnmsVersionListFromServer(): Promise<{
  listUrl: string;
  entries: GnmsVersionListEntry[];
}> {
  const cfg = getGnmsClientConfig();
  const listRes = await fetch(cfg.listUrl, {
    method: 'GET',
    headers: gnmsHeaders(cfg.bearer),
    cache: 'no-store',
  });
  const listJson = (await listRes.json().catch(() => ({}))) as {
    ok?: boolean;
    entries?: GnmsVersionListEntry[];
    error?: string;
  };
  if (!listRes.ok) {
    throw new Error(
      `GNMS 버전 목록 오류 (${listRes.status})${listJson.error ? `: ${listJson.error}` : ''}`
    );
  }
  const entries = Array.isArray(listJson.entries) ? listJson.entries : [];
  return { listUrl: cfg.listUrl, entries };
}

export async function notifyGnmsCancelFromServer(params: {
  jobId: string;
  version?: string;
  fileName?: string;
  reason?: string;
}): Promise<{ ok: boolean; status?: string; error?: string }> {
  const cfg = getGnmsClientConfig();
  const jobId = params.jobId.trim();
  if (!jobId) throw new Error('jobId가 필요합니다');
  const body: Record<string, string> = {
    jobId,
    reason: params.reason?.trim() || 'user_abort',
  };
  if (params.version) body.version = params.version;
  if (params.fileName) body.fileName = params.fileName;
  const res = await fetch(cfg.cancelUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...gnmsHeaders(cfg.bearer),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
  if (!res.ok) {
    return {
      ok: false,
      status: json.status,
      error: json.error ?? `GNMS 취소 실패 (${res.status})`,
    };
  }
  return { ok: true, status: json.status ?? 'ok' };
}

type ReadyPayload = {
  phase: string;
  message?: string;
  jobId?: string;
  downloadUrl?: string;
  sizeBytes?: number;
  fileName?: string;
  version?: string;
  error?: string;
};

async function fetchGnmsPrepareReady(params: {
  folder: string;
  includeNodeModules: boolean;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onProgress?: (event: GnmsProxyProgressEvent) => void | Promise<void>;
}): Promise<GnmsLatestPayload & { downloadUrl: string; jobId: string; version: string; fileName: string }> {
  const cfg = getGnmsClientConfig();
  const folderId = params.folder.trim();
  if (!folderId) throw new Error('버전 폴더가 없습니다');
  const preparePath = `/${encodeURIComponent(folderId)}/prepare`;
  const prepareUrl = new URL(resolveGnmsApiUrl(cfg.gnmsBaseUrl, preparePath));
  prepareUrl.searchParams.set('includeNodeModules', params.includeNodeModules ? '1' : '0');
  params.onLog?.(`prepare: folder=${folderId}, includeNodeModules=${params.includeNodeModules ? 1 : 0}`);

  const prepareRes = await fetch(prepareUrl.toString(), {
    method: 'GET',
    headers: gnmsHeaders(cfg.bearer),
    cache: 'no-store',
    signal: params.signal,
  });
  if (!prepareRes.ok) {
    const apiMsg = await readJsonError(prepareRes, '');
    throw new Error(`GNMS prepare API 오류 (${prepareRes.status})${apiMsg ? `: ${apiMsg}` : ''}`);
  }

  let ready: ReadyPayload | null = null;
  const text = await prepareRes.text();
  for (const line of text.split('\n')) {
    throwIfAborted(params.signal);
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: ReadyPayload;
    try {
      parsed = JSON.parse(trimmed) as ReadyPayload;
    } catch {
      continue;
    }
    const phase = String(parsed.phase ?? '');
    if (!phase) continue;
    if (phase === 'error') {
      throw new Error(String(parsed.message ?? parsed.error ?? 'prepare 실패'));
    }
    const msg = String(parsed.message ?? phase).trim() || phase;
    await params.onProgress?.({ phase: 'latest', message: msg, logLine: `prepare ${phase}: ${msg}` });
    params.onLog?.(`prepare ${phase}: ${msg}`);
    if (phase === 'ready') ready = parsed;
  }
  if (!ready) throw new Error('prepare 결과(ready)가 없습니다');
  const readyPayload: ReadyPayload = ready;
  const jobId = String(readyPayload.jobId ?? '').trim();
  if (!jobId) throw new Error('prepare ready에 jobId 없음');
  const version = String(readyPayload.version ?? '').trim() || folderId;
  const fileName = String(readyPayload.fileName ?? '').trim() || `source_${folderId}.zip`;
  const downloadUrlRaw =
    String(readyPayload.downloadUrl ?? '').trim() || `/download/${encodeURIComponent(folderId)}`;
  const downloadUrl = withJobIdQuery(resolveGnmsApiUrl(cfg.gnmsBaseUrl, downloadUrlRaw), jobId);
  return {
    jobId,
    version,
    fileName,
    downloadUrl,
    sizeBytes: typeof readyPayload.sizeBytes === 'number' ? readyPayload.sizeBytes : undefined,
  };
}

async function fetchGnmsLatestMeta(signal?: AbortSignal): Promise<{
  payload: GnmsLatestPayload;
  version: string;
  fileName: string;
  jobId: string;
  downloadUrl: string;
}> {
  const cfg = getGnmsClientConfig();
  const latestRes = await fetch(cfg.latestUrl, {
    method: 'GET',
    headers: gnmsHeaders(cfg.bearer),
    cache: 'no-store',
    signal,
  });
  const latestJson = (await latestRes.json().catch(() => ({}))) as GnmsLatestPayload;
  if (!latestRes.ok) {
    const apiMsg = await readJsonError(latestRes, '');
    throw new Error(`GNMS latest API 오류 (${latestRes.status})${apiMsg ? `: ${apiMsg}` : ''}`);
  }
  const version = String(latestJson.version ?? '').trim() || new Date().toISOString();
  const fileName = String(latestJson.fileName ?? '').trim() || `source_latest_${Date.now()}.zip`;
  const jobId = String(latestJson.jobId ?? '').trim();
  const downloadUrlRaw = String(latestJson.downloadUrl ?? '').trim() || cfg.downloadUrlFallback;
  let downloadUrl = resolveGnmsApiUrl(cfg.gnmsBaseUrl, downloadUrlRaw);
  if (jobId) downloadUrl = withJobIdQuery(downloadUrl, jobId);
  return { payload: latestJson, version, fileName, jobId, downloadUrl };
}

async function fetchGnmsInstallLatestMeta(signal?: AbortSignal): Promise<{
  payload: GnmsLatestPayload;
  version: string;
  fileName: string;
  jobId: string;
  downloadUrl: string;
}> {
  const cfg = getGnmsClientConfig();
  const latestRes = await fetch(cfg.installLatestUrl, {
    method: 'GET',
    headers: gnmsHeaders(cfg.bearer),
    cache: 'no-store',
    signal,
  });
  const latestJson = (await latestRes.json().catch(() => ({}))) as GnmsLatestPayload;
  if (!latestRes.ok) {
    const apiMsg = await readJsonError(latestRes, '');
    throw new Error(`GNMS 설치 latest API 오류 (${latestRes.status})${apiMsg ? `: ${apiMsg}` : ''}`);
  }
  const version = String(latestJson.version ?? '').trim() || new Date().toISOString();
  const fileName = String(latestJson.fileName ?? '').trim() || `source_install_${Date.now()}.zip`;
  const jobId = String(latestJson.jobId ?? '').trim();
  const downloadUrlRaw = String(latestJson.downloadUrl ?? '').trim() || cfg.installDownloadUrl;
  let downloadUrl = resolveGnmsApiUrl(cfg.gnmsBaseUrl, downloadUrlRaw);
  if (jobId) downloadUrl = withJobIdQuery(downloadUrl, jobId);
  return { payload: latestJson, version, fileName, jobId, downloadUrl };
}

async function saveDownloadResponseToTemp(params: {
  downloadRes: Response;
  fileName: string;
  payload: GnmsLatestPayload;
  signal?: AbortSignal;
  onProgress?: (received: number, total: number) => void | Promise<void>;
}): Promise<{ zipPath: string; tmpDir: string; sizeBytes: number }> {
  const { downloadRes, fileName, payload, signal, onProgress } = params;
  if (!downloadRes.ok) {
    const apiMsg = await readJsonError(downloadRes, '');
    const err = new Error(
      isDownloadJobEndedError(downloadRes.status, apiMsg)
        ? `DOWNLOAD_JOB_ENDED:${apiMsg}`
        : `GNMS download API 오류 (${downloadRes.status})${apiMsg ? `: ${apiMsg}` : ''}`
    );
    throw err;
  }
  if (!downloadRes.body) throw new Error('GNMS 다운로드 body 없음');
  const total = parseTotalSize(payload, downloadRes.headers.get('content-length'));
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = `${gnmsTmpRoot()}${path.sep}${stamp}`;
  await fs.mkdir(tmpDir, { recursive: true });
  const safeName = path.basename(fileName.replace(/\\/g, '/')) || `source_${Date.now()}.zip`;
  const zipPath = path.join(tmpDir, safeName);
  const nodeReadable = Readable.fromWeb(downloadRes.body as import('node:stream/web').ReadableStream);
  const out = fsSync.createWriteStream(zipPath);
  let received = 0;
  nodeReadable.on('data', (chunk: Buffer | string) => {
    const n = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    received += n;
    if (onProgress && total > 0) void onProgress(received, total);
  });
  try {
    throwIfAborted(signal);
    await pipeline(nodeReadable, out);
  } catch (e) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
  const sizeBytes = (await fs.stat(zipPath)).size;
  return { zipPath, tmpDir, sizeBytes };
}

async function fetchSourceZipOnce(params: {
  isLatest: boolean;
  folder: string;
  includeNodeModules: boolean;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onProgress?: (event: GnmsProxyProgressEvent) => void | Promise<void>;
}): Promise<GnmsFetchedZip> {
  const cfg = getGnmsClientConfig();
  throwIfAborted(params.signal);
  let meta: {
    payload: GnmsLatestPayload;
    version: string;
    fileName: string;
    jobId: string;
    downloadUrl: string;
  };
  if (params.isLatest) {
    meta = await fetchGnmsLatestMeta(params.signal);
  } else {
    const ready = await fetchGnmsPrepareReady({
      folder: params.folder,
      includeNodeModules: params.includeNodeModules,
      signal: params.signal,
      onLog: params.onLog,
      onProgress: params.onProgress,
    });
    meta = {
      payload: ready,
      version: ready.version,
      fileName: ready.fileName,
      jobId: ready.jobId,
      downloadUrl: ready.downloadUrl,
    };
  }
  params.onLog?.(
    `latest: version=${meta.version}, file=${meta.fileName}${meta.jobId ? `, jobId=${meta.jobId}` : ''}`
  );
  let downloadRes: Response;
  try {
    downloadRes = await fetch(meta.downloadUrl, {
      method: 'GET',
      headers: gnmsHeaders(cfg.bearer),
      cache: 'no-store',
      signal: params.signal,
    });
  } catch (e) {
    if (params.signal?.aborted && meta.jobId) {
      await notifyGnmsCancelFromServer({
        jobId: meta.jobId,
        version: meta.version,
        fileName: meta.fileName,
      }).catch(() => {});
    }
    throw e;
  }
  if (!downloadRes.ok) {
    const apiMsg = await readJsonError(downloadRes, '');
    const err = new Error(
      isDownloadJobEndedError(downloadRes.status, apiMsg)
        ? `DOWNLOAD_JOB_ENDED:${apiMsg}`
        : `GNMS download API 오류 (${downloadRes.status})${apiMsg ? `: ${apiMsg}` : ''}`
    );
    throw err;
  }
  const saved = await saveDownloadResponseToTemp({
    downloadRes,
    fileName: meta.fileName,
    payload: meta.payload,
    signal: params.signal,
    onProgress: async (received, total) => {
      await params.onProgress?.({
        phase: 'download',
        message: `GNMS ZIP 수신 ${received}/${total}`,
        logLine: `download ${received}/${total}`,
        bytesDone: received,
        totalBytes: total,
      });
    },
  });
  return {
    version: meta.version,
    fileName: meta.fileName,
    jobId: meta.jobId,
    downloadUrl: meta.downloadUrl,
    ...saved,
  };
}

export async function fetchGnmsSourceZipToTemp(params: {
  isLatest: boolean;
  folder: string;
  includeNodeModules: boolean;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onProgress?: (event: GnmsProxyProgressEvent) => void | Promise<void>;
}): Promise<GnmsFetchedZip> {
  try {
    return await fetchSourceZipOnce(params);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.startsWith('DOWNLOAD_JOB_ENDED:')) throw e;
    params.onLog?.('WARNING: download job 만료 — 재조회 후 재시도');
    return await fetchSourceZipOnce(params);
  }
}

export async function applyGnmsSourceZipOnServer(params: {
  isLatest: boolean;
  folder: string;
  includeNodeModules: boolean;
  requestedBy: string;
  clientIp?: string;
  restart: boolean;
  restartMode: RestartMode;
  versionLabel?: string;
  signal?: AbortSignal;
  onProgress?: (event: GnmsProxyProgressEvent) => void | Promise<void>;
}): Promise<ApplySourceZipResult & { gnmsBaseUrl: string; latestUrl: string; downloadUrl: string }> {
  const cfg = getGnmsClientConfig();
  const restartMode = normalizeRestartMode(params.restart ? params.restartMode : 'none');
  await params.onProgress?.({
    phase: 'latest',
    message: params.isLatest ? 'GNMS 최신 버전 조회 중...' : 'GNMS 선택 버전 준비 중...',
    logLine: `GNMS: ${cfg.gnmsBaseUrl}`,
  });

  let fetched: GnmsFetchedZip | null = null;
  try {
    fetched = await fetchGnmsSourceZipToTemp({
      isLatest: params.isLatest,
      folder: params.folder,
      includeNodeModules: params.includeNodeModules,
      signal: params.signal,
      onLog: (line) => {
        void params.onProgress?.({ phase: 'latest', message: line, logLine: line });
      },
      onProgress: params.onProgress,
    });
    const historyVersion = params.versionLabel?.trim() || params.folder.trim() || fetched.version;
    const applied = await applySourceZipFile({
      zipPath: fetched.zipPath,
      version: historyVersion,
      fileName: fetched.fileName,
      requestedBy: params.requestedBy,
      clientIp: params.clientIp,
      restart: params.restart,
      restartMode,
      includeNodeModules: params.includeNodeModules,
      onProgress: (event) => params.onProgress?.(event),
    });
    return {
      ...applied,
      gnmsBaseUrl: cfg.gnmsBaseUrl,
      latestUrl: cfg.latestUrl,
      downloadUrl: fetched.downloadUrl,
    };
  } catch (e) {
    if (params.signal?.aborted && fetched?.jobId) {
      await notifyGnmsCancelFromServer({
        jobId: fetched.jobId,
        version: fetched.version,
        fileName: fetched.fileName,
      }).catch(() => {});
    }
    throw e;
  } finally {
    if (fetched?.tmpDir) {
      await fs.rm(fetched.tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function openGnmsInstallZipDownloadStream(signal?: AbortSignal): Promise<{
  fileName: string;
  version: string;
  jobId: string;
  size: number | null;
  webStream: ReadableStream;
  cleanup: () => void;
}> {
  const cfg = getGnmsClientConfig();
  let meta = await fetchGnmsInstallLatestMeta(signal);
  let downloadRes = await fetch(meta.downloadUrl, {
    method: 'GET',
    headers: gnmsHeaders(cfg.bearer),
    cache: 'no-store',
    signal,
  });
  if (!downloadRes.ok) {
    const firstMsg = await readJsonError(downloadRes, '');
    if (isDownloadJobEndedError(downloadRes.status, firstMsg)) {
      meta = await fetchGnmsInstallLatestMeta(signal);
      downloadRes = await fetch(meta.downloadUrl, {
        method: 'GET',
        headers: gnmsHeaders(cfg.bearer),
        cache: 'no-store',
        signal,
      });
    }
  }
  if (!downloadRes.ok) {
    const apiMsg = await readJsonError(downloadRes, '');
    throw new Error(`GNMS 설치 ZIP 다운로드 오류 (${downloadRes.status})${apiMsg ? `: ${apiMsg}` : ''}`);
  }
  if (!downloadRes.body) throw new Error('GNMS 설치 ZIP body 없음');
  const len = downloadRes.headers.get('content-length');
  const size = len && Number.isFinite(Number(len)) ? Number(len) : parseTotalSize(meta.payload, len) || null;
  const nodeStream = Readable.fromWeb(downloadRes.body as import('node:stream/web').ReadableStream);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  let cancelled = false;
  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    nodeStream.destroy();
  };
  nodeStream.on('error', cleanup);
  return {
    fileName: meta.fileName,
    version: meta.version,
    jobId: meta.jobId,
    size,
    webStream,
    cleanup,
  };
}
