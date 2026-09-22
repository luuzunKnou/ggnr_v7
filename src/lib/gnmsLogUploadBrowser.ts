import { classifyGnmsNetworkError, gnmsAuthHeaders, loadGnmsBrowserConfig } from '@/lib/gnmsBrowserClient';

export type GnmsLogFileMeta = {
  index: number;
  fileName: string;
  date: string;
  size: number;
};

/** 로컬 세션 파일을 브라우저가 GNMS POST /api/logs 로 업로드 */
export async function uploadGnmsLogsFromBrowser(options: {
  sessionId: string;
  project: string;
  type: string;
  files: GnmsLogFileMeta[];
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}): Promise<{ uploaded: number; logsUrl: string }> {
  const { sessionId, project, type, files, signal, onLog } = options;
  const cfg = await loadGnmsBrowserConfig(signal);
  const logsUrl = (cfg.logsUrl ?? '').trim();
  if (!logsUrl) throw new Error('GNMS logsUrl이 없습니다');
  onLog?.(`GNMS 로그 업로드: ${logsUrl} (${files.length}건)`);

  let uploaded = 0;
  for (const f of files) {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const localRes = await fetch(
      `/api/dev/gnms-logs/file?sessionId=${encodeURIComponent(sessionId)}&index=${f.index}`,
      { cache: 'no-store', signal }
    );
    if (!localRes.ok) {
      const err = (await localRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `로컬 로그 읽기 실패 (${f.fileName})`);
    }
    const blob = await localRes.blob();
    const form = new FormData();
    form.append('project', project);
    form.append('type', type);
    form.append('date', f.date);
    form.append('file', blob, f.fileName);

    let res: Response;
    try {
      res = await fetch(logsUrl, {
        method: 'POST',
        headers: gnmsAuthHeaders(cfg.bearer),
        body: form,
        signal,
      });
    } catch (err: unknown) {
      throw classifyGnmsNetworkError(err, 'GNMS 로그 업로드', logsUrl);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(
        json.error ?? `GNMS 로그 업로드 실패 HTTP ${res.status} file=${f.fileName}`
      );
    }
    uploaded += 1;
    onLog?.(`업로드 ${uploaded}/${files.length}: ${f.fileName}`);
  }

  await fetch(`/api/dev/gnms-logs/file?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    cache: 'no-store',
  }).catch(() => {});

  return { uploaded, logsUrl };
}
