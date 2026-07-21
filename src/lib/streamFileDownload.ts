/** 이미 fetch된 Response body를 읽어 브라우저 기본 다운로드(다운로드 폴더)로 저장 */
export async function streamDownloadResponse(
  res: Response,
  fileName: string,
  onProgress?: (received: number, total: number | null) => void,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || contentType.includes('application/json')) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `다운로드 실패 (${res.status})`);
  }
  if (!res.body) throw new Error('다운로드 body 없음');

  const totalHeader = res.headers.get('content-length');
  const total = totalHeader && Number.isFinite(Number(totalHeader)) ? Number(totalHeader) : null;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }

  const blob = new Blob(chunks, { type: 'application/zip' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.title = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/** URL 응답 본문을 읽어 브라우저 기본 다운로드로 저장 */
export async function streamDownloadFile(
  url: string,
  fileName: string,
  onProgress?: (received: number, total: number | null) => void,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  const res = await fetch(url, { method: 'GET', cache: 'no-store', signal });
  await streamDownloadResponse(res, fileName, onProgress, signal);
}
