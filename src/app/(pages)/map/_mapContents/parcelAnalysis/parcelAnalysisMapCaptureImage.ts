/** 디코드 실패·WMS 오류 응답 시 빈 타일 대체 — Next 개발 오버레이 EncodingError 방지 */
export const MAP_CAPTURE_TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ZQAAAAASUVORK5CYII=';

async function isImageBlob(blob: Blob): Promise<boolean> {
  if (blob.size < 4) return false;
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true;
  if (head[0] === 0xff && head[1] === 0xd8) return true;
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return true;
  return false;
}

function applyTransparent(img: HTMLImageElement): void {
  try {
    img.removeAttribute('crossorigin');
    img.src = MAP_CAPTURE_TRANSPARENT_PNG;
  } catch {
    /* ignore */
  }
}

/** fetch → 매직바이트 검증 후에만 img에 반영 (직접 URL 대입 금지) */
export async function loadMapCaptureImage(
  img: HTMLImageElement,
  src: string,
  onFail?: () => void
): Promise<void> {
  const fallback = () => {
    onFail?.();
    applyTransparent(img);
  };

  if (!src || src.startsWith('data:')) {
    fallback();
    return;
  }

  try {
    const res = await fetch(src, { method: 'GET', cache: 'no-store', mode: 'cors' });
    if (!res.ok) {
      fallback();
      return;
    }
    const blob = await res.blob();
    if (!(await isImageBlob(blob))) {
      fallback();
      return;
    }
    const blobUrl = URL.createObjectURL(blob);
    img.crossOrigin = 'anonymous';
    img.onload = () => URL.revokeObjectURL(blobUrl);
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      fallback();
    };
    img.src = blobUrl;
  } catch {
    fallback();
  }
}
