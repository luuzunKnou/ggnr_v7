import { classifyGnmsNetworkError, loadGnmsBrowserConfig } from '@/lib/gnmsBrowserClient';
import { buildGnmsBaseDataExportAsyncUrl } from '@/lib/gnmsSourceUrl';

export type GnmsBaseDataExportBody = {
  folder: string;
  bjd_cde: string;
  keyword: string;
  geom?: string;
  /** emd·ri — 시군구 코드(우측 0 제외, 예: 47730) */
  col_adm_se?: string;
};

/** GNMS async job 진행 (폴링 JSON) */
export type GnmsBaseDataAsyncProgress = {
  status?: string;
  phase?: string;
  label?: string;
  layerIndex?: number;
  layerCount?: number;
  layerName?: string;
  pct?: number;
  overallPct?: number;
  elapsedSec?: number;
  heartbeatAt?: string;
  alive?: boolean;
  ready?: boolean;
  error?: string;
  jobId?: string;
};

const ASYNC_FOLDERS = new Set(['elevation', 'kais_gb']);
const ASYNC_POLL_MS = 4_000;
const ASYNC_MAX_WAIT_MS = 45 * 60 * 1000;

function usesAsyncExport(folder: string): boolean {
  return ASYNC_FOLDERS.has(String(folder ?? '').trim());
}

function parseContentDispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const utf = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return utf[1].trim().replace(/^"|"$/g, '');
    }
  }
  const plain = header.match(/filename\s*=\s*("?)([^";]+)\1/i);
  return plain?.[2]?.trim() || null;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function buildExportPayload(body: GnmsBaseDataExportBody): Record<string, string> {
  const payload: Record<string, string> = {
    folder: body.folder,
    bjd_cde: body.bjd_cde,
    keyword: body.keyword,
  };
  // kais_gb는 geom 미전송 (GNMS 측 요청)
  if (body.geom && body.folder !== 'kais_gb') payload.geom = body.geom;
  if ((body.folder === 'emd' || body.folder === 'ri') && body.col_adm_se) {
    payload.col_adm_se = body.col_adm_se;
  }
  return payload;
}

function formatAsyncProgressLine(p: GnmsBaseDataAsyncProgress): string {
  const parts: string[] = [];
  if (p.label) parts.push(p.label);
  else if (p.phase) parts.push(String(p.phase));
  if (p.layerName) {
    const idx =
      p.layerIndex != null && p.layerCount != null
        ? `${p.layerIndex}/${p.layerCount} `
        : p.layerIndex != null
          ? `${p.layerIndex} `
          : '';
    parts.push(`${idx}${p.layerName}`);
  }
  const pct = p.overallPct ?? p.pct;
  if (pct != null && Number.isFinite(pct)) parts.push(`${Math.round(pct)}%`);
  if (p.elapsedSec != null && Number.isFinite(p.elapsedSec)) parts.push(`${p.elapsedSec}초`);
  if (p.status) parts.push(`status=${p.status}`);
  return parts.length > 0 ? parts.join(' · ') : '진행 중…';
}

function pickJobId(json: Record<string, unknown>): string {
  const direct = String(json.jobId ?? json.job_id ?? '').trim();
  if (direct) return direct;
  const data = json.data;
  if (data && typeof data === 'object') {
    const nested = String(
      (data as { jobId?: unknown; job_id?: unknown }).jobId ??
        (data as { job_id?: unknown }).job_id ??
        ''
    ).trim();
    if (nested) return nested;
  }
  return '';
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** elevation / kais_gb — async 시작 → 폴링 → file ZIP */
async function downloadGnmsBaseDataZipAsync(options: {
  exportUrl: string;
  body: GnmsBaseDataExportBody;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onProgress?: (p: GnmsBaseDataAsyncProgress) => void;
}): Promise<{ fileName: string; bytes: number; exportUrl: string }> {
  const { exportUrl, body, signal, onLog, onProgress } = options;
  const asyncBase = buildGnmsBaseDataExportAsyncUrl(exportUrl);
  if (!asyncBase) throw new Error('GNMS async export URL이 없습니다');

  const payload = buildExportPayload(body);
  onLog?.(`GNMS GIS async 시작: ${asyncBase} folder=${body.folder}`);

  let startRes: Response;
  try {
    startRes = await fetch(asyncBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal,
    });
  } catch (err: unknown) {
    throw classifyGnmsNetworkError(err, 'GNMS GIS async 시작', asyncBase);
  }

  const startJson = (await startRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (startRes.status !== 202 && !startRes.ok) {
    throw new Error(
      String(startJson.error ?? startJson.message ?? `GNMS GIS async 시작 실패 HTTP ${startRes.status}`)
    );
  }
  const jobId = pickJobId(startJson);
  if (!jobId) {
    throw new Error('GNMS GIS async jobId가 없습니다');
  }
  onLog?.(`GNMS GIS async job=${jobId} (폴링 ${ASYNC_POLL_MS / 1000}초)`);

  const statusUrl = `${asyncBase}/${encodeURIComponent(jobId)}`;
  const fileUrl = `${statusUrl}/file`;
  const startedAt = Date.now();
  let lastLine = '';

  while (Date.now() - startedAt < ASYNC_MAX_WAIT_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let statusRes: Response;
    try {
      statusRes = await fetch(statusUrl, { cache: 'no-store', signal });
    } catch (err: unknown) {
      throw classifyGnmsNetworkError(err, 'GNMS GIS async 진행', statusUrl);
    }

    const progress = (await statusRes.json().catch(() => ({}))) as GnmsBaseDataAsyncProgress &
      Record<string, unknown>;
    if (!statusRes.ok) {
      throw new Error(
        String(progress.error ?? progress.message ?? `GNMS GIS async 진행 실패 HTTP ${statusRes.status}`)
      );
    }

    onProgress?.(progress);
    const line = formatAsyncProgressLine(progress);
    if (line && line !== lastLine) {
      lastLine = line;
      onLog?.(`GNMS GIS async: ${line}`);
    }

    const statusLower = String(progress.status ?? '').toLowerCase();
    if (progress.error || statusLower === 'error' || statusLower === 'failed') {
      throw new Error(String(progress.error ?? progress.label ?? 'GNMS GIS async 실패'));
    }

    if (progress.ready === true || statusLower === 'ready' || statusLower === 'done') {
      let fileRes: Response;
      try {
        fileRes = await fetch(fileUrl, { cache: 'no-store', signal });
      } catch (err: unknown) {
        throw classifyGnmsNetworkError(err, 'GNMS GIS async 파일', fileUrl);
      }
      if (!fileRes.ok) {
        const json = (await fileRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `GNMS GIS async 파일 실패 HTTP ${fileRes.status}`);
      }
      const blob = await fileRes.blob();
      const fallbackName = `${body.bjd_cde || body.folder}_${body.folder}.zip`;
      const fileName =
        parseContentDispositionFileName(fileRes.headers.get('content-disposition')) || fallbackName;
      triggerBlobDownload(blob, fileName);
      onLog?.(`저장 완료: ${fileName} (${blob.size} bytes)`);
      return { fileName, bytes: blob.size, exportUrl: fileUrl };
    }

    await sleep(ASYNC_POLL_MS, signal);
  }

  throw new Error(`GNMS GIS async 시간 초과 (${Math.round(ASYNC_MAX_WAIT_MS / 60000)}분)`);
}

/** ri/emd/sgg — 기존 sync POST /api/base-data/export */
async function downloadGnmsBaseDataZipSync(options: {
  exportUrl: string;
  body: GnmsBaseDataExportBody;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}): Promise<{ fileName: string; bytes: number; exportUrl: string }> {
  const { exportUrl, body, signal, onLog } = options;
  const payload = buildExportPayload(body);

  onLog?.(`GNMS GIS 다운로드 요청: ${exportUrl} folder=${body.folder}`);

  let res: Response;
  try {
    res = await fetch(exportUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal,
    });
  } catch (err: unknown) {
    throw classifyGnmsNetworkError(err, 'GNMS GIS 다운로드', exportUrl);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `GNMS GIS 다운로드 실패 HTTP ${res.status}`);
  }
  if (!contentType.includes('zip') && !contentType.includes('octet-stream')) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (json?.error) throw new Error(json.error);
  }

  const blob = await res.blob();
  const fallbackName = `${body.bjd_cde || body.folder}_${body.folder}.zip`;
  const fileName = parseContentDispositionFileName(res.headers.get('content-disposition')) || fallbackName;
  triggerBlobDownload(blob, fileName);
  onLog?.(`저장 완료: ${fileName} (${blob.size} bytes)`);
  return { fileName, bytes: blob.size, exportUrl };
}

/**
 * 브라우저 → GNMS base-data export → ZIP 저장 (Bearer 없음).
 * elevation·kais_gb: async(/export/async) + 폴링.
 * ri·emd·sgg: 기존 sync POST /export.
 */
export async function downloadGnmsBaseDataZipFromBrowser(options: {
  body: GnmsBaseDataExportBody;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onProgress?: (p: GnmsBaseDataAsyncProgress) => void;
}): Promise<{ fileName: string; bytes: number; exportUrl: string }> {
  const { body, signal, onLog, onProgress } = options;
  const cfg = await loadGnmsBrowserConfig(signal);
  const exportUrl = String(cfg.baseDataExportUrl ?? '').trim();
  if (!exportUrl) throw new Error('GNMS baseDataExportUrl이 없습니다');

  if (usesAsyncExport(body.folder)) {
    return downloadGnmsBaseDataZipAsync({ exportUrl, body, signal, onLog, onProgress });
  }
  return downloadGnmsBaseDataZipSync({ exportUrl, body, signal, onLog });
}
