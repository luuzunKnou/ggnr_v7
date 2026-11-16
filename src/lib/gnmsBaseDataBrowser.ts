import { classifyGnmsNetworkError, loadGnmsBrowserConfig } from '@/lib/gnmsBrowserClient';

export type GnmsBaseDataExportBody = {
  folder: string;
  bjd_cde: string;
  keyword: string;
  geom?: string;
  /** emd·ri — 시군구 코드(trailing 0 제외, 예: 47730) */
  col_adm_se?: string;
};

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

/** 브라우저 → GNMS POST /api/base-data/export → ZIP 저장 (Bearer 없음) */
export async function downloadGnmsBaseDataZipFromBrowser(options: {
  body: GnmsBaseDataExportBody;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}): Promise<{ fileName: string; bytes: number; exportUrl: string }> {
  const { body, signal, onLog } = options;
  const cfg = await loadGnmsBrowserConfig(signal);
  const exportUrl = String(cfg.baseDataExportUrl ?? '').trim();
  if (!exportUrl) throw new Error('GNMS baseDataExportUrl이 없습니다');

  const payload: Record<string, string> = {
    folder: body.folder,
    bjd_cde: body.bjd_cde,
    keyword: body.keyword,
  };
  if (body.geom) payload.geom = body.geom;
  if ((body.folder === 'emd' || body.folder === 'ri') && body.col_adm_se) {
    payload.col_adm_se = body.col_adm_se;
  }

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
