/**
 * `[data-roadview-host]` 전체 표시 영역 캡처 (컨트롤러·링크 제외).
 * canvas/img는 호스트 전체를 cover로 채워 좌우·상하 회색 여백 없음.
 */
export function captureRoadviewFrame(host: HTMLElement): {
  url: string;
  w: number;
  h: number;
} | null {
  const w = Math.round(host.clientWidth);
  const h = Math.round(host.clientHeight);
  if (w <= 0 || h <= 0) return null;

  const canvas = host.querySelector('canvas');
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    try {
      return compositeFrame(host, w, h, canvas);
    } catch {
      /* tainted canvas 등 */
    }
  }

  const img = host.querySelector('img');
  if (img && img.naturalWidth > 0) {
    try {
      return compositeFrame(host, w, h, img);
    } catch {
      return null;
    }
  }

  return null;
}

function sourcePixelSize(source: CanvasImageSource & Element): { sw: number; sh: number } {
  if (source instanceof HTMLCanvasElement) {
    return { sw: source.width, sh: source.height };
  }
  if (source instanceof HTMLImageElement) {
    return { sw: source.naturalWidth, sh: source.naturalHeight };
  }
  const r = source.getBoundingClientRect();
  return { sw: r.width, sh: r.height };
}

function compositeFrame(
  host: HTMLElement,
  w: number,
  h: number,
  source: CanvasImageSource & Element
): { url: string; w: number; h: number } {
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  const bg = getComputedStyle(host).backgroundColor;
  ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#888888';
  ctx.fillRect(0, 0, w, h);

  const { sw, sh } = sourcePixelSize(source);
  if (sw <= 0 || sh <= 0) {
    return { url: off.toDataURL('image/jpeg', 0.85), w, h };
  }

  const scale = Math.max(w / sw, h / sh);
  const drawW = sw * scale;
  const drawH = sh * scale;
  const dx = (w - drawW) / 2;
  const dy = (h - drawH) / 2;
  ctx.drawImage(source, dx, dy, drawW, drawH);

  return { url: off.toDataURL('image/jpeg', 0.85), w, h };
}
