import type { Map as OlMap } from 'ol';
import html2canvas from 'html2canvas';
import { compositeOpenLayersMapToCanvas } from '../parcelAnalysis/ParcelAnalysis.mapCapture';

const IGNORE_CLASS = 'map-print-ignore';

function waitForMapRender(map: OlMap, timeoutMs = 2500): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.once('rendercomplete', finish);
    map.renderSync();
    window.setTimeout(finish, timeoutMs);
  });
}

/**
 * 인쇄 용지 DOM을 PNG로 저장.
 * OL 레이어(배경·업무·도형·측정 벡터)는 canvas 합성 후 img로 치환하고,
 * html2canvas로 측정 라벨·핀·하단 안내까지 함께 캡처한다.
 */
export async function downloadMapPrintImage(
  paperEl: HTMLElement,
  map: OlMap | null,
  fileName = 'map-image.png'
): Promise<void> {
  if (map) {
    await waitForMapRender(map);
  }

  const mapHost = paperEl.querySelector('.map-print-map-host') as HTMLElement | null;
  const viewport = mapHost?.querySelector('.ol-viewport') as HTMLElement | null;
  const layersRoot = viewport?.querySelector('.ol-layers') as HTMLElement | null;
  let swapImg: HTMLImageElement | null = null;

  if (map && viewport && layersRoot) {
    const composed = document.createElement('canvas');
    const ok = compositeOpenLayersMapToCanvas(map, composed);
    if (ok && composed.width > 0 && composed.height > 0) {
      swapImg = document.createElement('img');
      swapImg.src = composed.toDataURL('image/png');
      swapImg.alt = '';
      swapImg.setAttribute('data-map-print-swap', '1');
      // 레이어만 가리고 오버레이(거리 라벨·핀 등)는 그대로 캡처
      swapImg.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;z-index:0;pointer-events:none;';
      layersRoot.style.visibility = 'hidden';
      viewport.insertBefore(swapImg, layersRoot);
    }
  }

  try {
    const canvas = await html2canvas(paperEl, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      ignoreElements: (el) =>
        el.classList.contains(IGNORE_CLASS) ||
        el.classList.contains('comment-cancle') ||
        el.classList.contains('comment-edit'),
    });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = fileName;
    a.click();
  } finally {
    if (swapImg?.parentElement) swapImg.parentElement.removeChild(swapImg);
    if (layersRoot) layersRoot.style.visibility = '';
  }
}

/** 브라우저 인쇄 — 용지 영역만 보이도록 body에 클래스 부여 */
export function printMapPrintPaper(paperEl: HTMLElement): void {
  document.body.classList.add('map-print-printing');
  paperEl.classList.add('map-print-paper-active');
  const cleanup = () => {
    document.body.classList.remove('map-print-printing');
    paperEl.classList.remove('map-print-paper-active');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  window.setTimeout(cleanup, 1500);
}

export function formatPrintScaleMeters(map: OlMap | null): string {
  if (!map) return '—';
  const res = map.getView().getResolution();
  if (res == null || !Number.isFinite(res)) return '—';
  return `${(res * 100).toFixed(2)}m`;
}

export function formatPrintDateTime(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const time = new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true,
  }).format(date);
  return `${y}.${m}.${d} ${time}`;
}
