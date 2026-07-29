/**
 * `[data-roadview-stage]` 전체 크기로 로드뷰 canvas만 cover 합성.
 * 캡처 순간에만 `[data-roadview-controls]`를 숨겨 UI가 비트맵에 섞이지 않게 함.
 */
export function captureRoadviewFrame(stageEl: HTMLElement): {
  url: string;
  w: number;
  h: number;
} | null {
  const w = Math.round(stageEl.clientWidth);
  const h = Math.round(stageEl.clientHeight);
  if (w <= 0 || h <= 0) return null;

  const controls = stageEl.querySelector('[data-roadview-controls]') as HTMLElement | null;
  const prevControlsVis = controls?.style.visibility ?? '';
  if (controls) controls.style.visibility = 'hidden';

  try {
    const host = stageEl.querySelector('[data-roadview-host]');
    const canvas = host?.querySelector('canvas') ?? stageEl.querySelector('canvas');
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      try {
        return compositeCover(stageEl, w, h, canvas);
      } catch {
        /* tainted canvas 등 */
      }
    }

    const img = host?.querySelector('img') ?? stageEl.querySelector('img');
    if (img && img.naturalWidth > 0) {
      try {
        return compositeCover(stageEl, w, h, img);
      } catch {
        return null;
      }
    }

    return null;
  } finally {
    if (controls) controls.style.visibility = prevControlsVis;
  }
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

function compositeCover(
  stageEl: HTMLElement,
  w: number,
  h: number,
  source: CanvasImageSource & Element
): { url: string; w: number; h: number } {
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  const bg = getComputedStyle(stageEl).backgroundColor;
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
