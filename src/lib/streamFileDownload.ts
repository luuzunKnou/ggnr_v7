/** 브라우저에서 응답 본문을 스트림으로 읽어 파일 저장 (재압축·전체 버퍼 없이 pipe 우선) */
export async function streamDownloadFile(
  url: string,
  fileName: string,
  onProgress?: (received: number, total: number | null) => void,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');

  let writable: FileSystemWritableFileStream | null = null;

  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (
        window as Window & {
          showSaveFilePicker: (options: {
            suggestedName: string;
            types?: { description: string; accept: Record<string, string[]> }[];
          }) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
      });
      if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      writable = await handle.createWritable();
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      writable = null;
    }
  }

  const res = await fetch(url, { method: 'GET', cache: 'no-store', signal });
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || contentType.includes('application/json')) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `다운로드 실패 (${res.status})`);
  }
  if (!res.body) throw new Error('다운로드 body 없음');

  const totalHeader = res.headers.get('content-length');
  const total = totalHeader && Number.isFinite(Number(totalHeader)) ? Number(totalHeader) : null;
  const reader = res.body.getReader();
  let received = 0;

  if (writable) {
    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          await writable.abort().catch(() => {});
          throw new DOMException('The operation was aborted', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        received += value.length;
        onProgress?.(received, total);
      }
      await writable.close();
      return;
    } catch (e) {
      await writable.abort().catch(() => {});
      throw e;
    }
  }

  const chunks: BlobPart[] = [];
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
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
