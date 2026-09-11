import type { Map as OlMap } from 'ol';
import type BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { fromString } from 'ol/transform';
import {
  createLocalOrthoTileLayer,
  isLocalOrthoBackgroundId,
  ORTHO_TILESET_GROUP_LS_KEY,
  parseBackgroundMapId,
  VWORLD_MAX_ZOOM_INDEX,
  type GoogleLayerType,
  type OSMLayerType,
  type VWorldLayerType,
} from '@/app/(pages)/map/_mapComponents/layerFactory/backgroundLayerFactory';

const VWORLD_XYZ: Record<VWorldLayerType, { path: string; ext: string }> = {
  base: { path: 'Base', ext: 'png' },
  satellite: { path: 'Satellite', ext: 'jpeg' },
  white: { path: 'white', ext: 'png' },
  night: { path: 'midnight', ext: 'png' },
};

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

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

function waitTilesLoaded(source: XYZ, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let pending = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      source.un('tileloadstart', onStart);
      source.un('tileloadend', onEnd);
      source.un('tileloaderror', onEnd);
      resolve();
    };
    const onStart = () => {
      pending += 1;
    };
    const onEnd = () => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) window.setTimeout(finish, 80);
    };
    source.on('tileloadstart', onStart);
    source.on('tileloadend', onEnd);
    source.on('tileloaderror', onEnd);
    window.setTimeout(finish, timeoutMs);
  });
}

function localOrthoGroupName(backgroundId: string): string {
  try {
    const raw = window.localStorage.getItem(ORTHO_TILESET_GROUP_LS_KEY);
    if (!raw) return '';
    const map = JSON.parse(raw) as Record<string, string>;
    const group = map[backgroundId];
    return typeof group === 'string' ? group : '';
  } catch {
    return '';
  }
}

/**
 * 캡처용 Canvas Tile 배경 (WebGL 대신).
 * 접도구역 위치도 캡처와 같이 crossOrigin 타일로 다시 그린다.
 */
function createPrintCaptureBackgroundLayer(backgroundId: string): TileLayer<XYZ> {
  if (isLocalOrthoBackgroundId(backgroundId)) {
    return createLocalOrthoTileLayer(backgroundId, localOrthoGroupName(backgroundId));
  }
  const parsed = parseBackgroundMapId(backgroundId);
  if (parsed?.provider === 'vworld') {
    const type = parsed.layerType as VWorldLayerType;
    const info = VWORLD_XYZ[type] ?? VWORLD_XYZ.satellite;
    return new TileLayer({
      source: new XYZ({
        url: `https://xdworld.vworld.kr/2d/${info.path}/service/{z}/{x}/{y}.${info.ext}`,
        crossOrigin: 'anonymous',
        maxZoom: VWORLD_MAX_ZOOM_INDEX,
        attributions: '© VWorld',
      }),
    });
  }
  if (parsed?.provider === 'google') {
    const type = parsed.layerType as GoogleLayerType;
    const lyrs = type === 'satellite' ? 's' : type === 'terrain' ? 'p' : 'm';
    return new TileLayer({
      source: new XYZ({
        url: `https://mt0.google.com/vt/lyrs=${lyrs}&hl=en&x={x}&y={y}&z={z}`,
        crossOrigin: 'anonymous',
        attributions: '© Google',
      }),
    });
  }
  if (parsed?.provider === 'osm') {
    const type = parsed.layerType as OSMLayerType;
    if (type === 'satellite') {
      return new TileLayer({
        source: new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          crossOrigin: 'anonymous',
          attributions: '© Esri',
        }),
      });
    }
    if (type === 'terrain') {
      return new TileLayer({
        source: new XYZ({
          url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
          crossOrigin: 'anonymous',
          attributions: '© OpenTopoMap',
        }),
      });
    }
    return new TileLayer({
      source: new XYZ({
        url: 'https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        crossOrigin: 'anonymous',
        attributions: '© OpenStreetMap',
      }),
    });
  }
  // 카카오 등 CORS 불가 배경 → VWorld 위성으로 대체해 저장 가능하게
  const info = VWORLD_XYZ.satellite;
  return new TileLayer({
    source: new XYZ({
      url: `https://xdworld.vworld.kr/2d/${info.path}/service/{z}/{x}/{y}.${info.ext}`,
      crossOrigin: 'anonymous',
      maxZoom: VWORLD_MAX_ZOOM_INDEX,
      attributions: '© VWorld',
    }),
  });
}

/** WebGL/오염 캔버스는 건너뛰고 합성 (접도구역 위치도 캡처와 동일) */
function safeCompositeOpenLayersMapToCanvas(map: OlMap, target: HTMLCanvasElement): boolean {
  const size = map.getSize();
  if (!size) return false;
  const [width, height] = size;
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d');
  if (!ctx) return false;
  const layersRoot = map.getViewport().querySelector('.ol-layers');
  if (!layersRoot) return false;

  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let drew = false;
  for (const container of layersRoot.children) {
    const element = container as HTMLElement;
    const canvas = (element.firstElementChild ?? element) as HTMLCanvasElement;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) continue;

    const opacity = element.style.opacity || canvas.style.opacity;
    ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);

    const transform = canvas.style.transform;
    if (transform) {
      const matrix = fromString(transform);
      if (matrix.length === 6) {
        ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      }
    } else {
      const w = parseFloat(canvas.style.width) / canvas.width;
      const h = parseFloat(canvas.style.height) / canvas.height;
      ctx.setTransform(
        Number.isFinite(w) && w > 0 ? w : 1,
        0,
        0,
        Number.isFinite(h) && h > 0 ? h : 1,
        0,
        0
      );
    }
    try {
      ctx.drawImage(canvas, 0, 0);
      drew = true;
    } catch {
      /* tainted / WebGL */
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  return drew;
}

/**
 * 캡처 동안 WebGL 배경을 Canvas Tile로 잠시 교체.
 * 끝나면 원래 배경을 복구한다.
 */
async function withCanvasBackgroundForCapture(
  map: OlMap,
  backgroundId: string,
  run: () => Promise<void>
): Promise<void> {
  if (!backgroundId || backgroundId === 'no-background') {
    await run();
    return;
  }

  const layers = map.getLayers();
  const prevBg = layers.getArray().find((l) => l.get('name') === 'background') as BaseLayer | undefined;
  if (prevBg) layers.remove(prevBg);

  const captureBg = createPrintCaptureBackgroundLayer(backgroundId);
  captureBg.set('name', 'background');
  captureBg.set('mapPrintCaptureTemp', true);
  layers.insertAt(0, captureBg);

  try {
    const src = captureBg.getSource();
    if (src) await waitTilesLoaded(src, 6000);
    await waitForMapRender(map, 3000);
    await waitMs(250);
    await waitForMapRender(map, 2000);
    await run();
  } finally {
    layers.remove(captureBg);
    if (prevBg) layers.insertAt(0, prevBg);
    map.renderSync();
  }
}

/** OL HTML 오버레이(측정 라벨 등)를 지도 좌표 기준으로 캔버스에 그림 */
function paintMapHtmlOverlays(
  ctx: CanvasRenderingContext2D,
  mapHost: HTMLElement,
  scaleX: number,
  scaleY: number
): void {
  const hostRect = mapHost.getBoundingClientRect();
  const nodes = mapHost.querySelectorAll('.ol-overlay-container > *, .ol-overlaycontainer-stopevent > *');
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.offsetParent === null && node.style.display === 'none') return;
    const text = String(node.innerText ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const x = (r.left - hostRect.left) * scaleX;
    const y = (r.top - hostRect.top) * scaleY;
    const w = Math.max(r.width * scaleX, 8);
    const h = Math.max(r.height * scaleY, 8);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.strokeStyle = 'rgba(30,30,30,0.55)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#111111';
    ctx.font = `${Math.max(10, Math.round(11 * Math.min(scaleX, scaleY)))}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 4, y + h / 2, Math.max(0, w - 8));
    ctx.restore();
  });
}

function paintFooterPanels(
  ctx: CanvasRenderingContext2D,
  paperEl: HTMLElement,
  mapHost: HTMLElement,
  outW: number,
  outH: number
): void {
  const hostRect = mapHost.getBoundingClientRect();
  const scaleX = outW / Math.max(hostRect.width, 1);
  const scaleY = outH / Math.max(hostRect.height, 1);
  const leftEl = paperEl.querySelector('.map-print-footer-left') as HTMLElement | null;
  const rightEl = paperEl.querySelector('.map-print-footer-right') as HTMLElement | null;

  const paintOne = (el: HTMLElement | null, align: 'left' | 'right') => {
    if (!el) return;
    const text = String(el.innerText ?? '').trim();
    if (!text) return;
    const padX = 12 * scaleX;
    const padY = 7 * scaleY;
    const fontSize = Math.max(11, Math.round(12 * Math.min(scaleX, scaleY)));
    ctx.font = `${fontSize}px sans-serif`;
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const lineH = fontSize * 1.4;
    const contentW = Math.max(...lines.map((ln) => ctx.measureText(ln).width), 40);
    const boxW = contentW + padX * 2;
    const boxH = lines.length * lineH + padY * 2;
    const x = align === 'left' ? 0 : Math.max(0, outW - boxW);
    const y = Math.max(0, outH - boxH);
    const radius = Math.max(4, 12 * scaleX);

    ctx.save();
    ctx.fillStyle = 'rgba(245,245,245,0.9)';
    ctx.strokeStyle = 'rgba(180,180,180,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (align === 'left') {
      ctx.moveTo(x, y + boxH);
      ctx.lineTo(x, y);
      ctx.arcTo(x + boxW, y, x + boxW, y + boxH, radius);
      ctx.lineTo(x + boxW, y + boxH);
    } else {
      ctx.moveTo(x + boxW, y + boxH);
      ctx.lineTo(x + boxW, y);
      ctx.arcTo(x, y, x, y + boxH, radius);
      ctx.lineTo(x, y + boxH);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';
    ctx.textAlign = align === 'left' ? 'left' : 'right';
    const tx = align === 'left' ? x + padX : x + boxW - padX;
    lines.forEach((ln, i) => {
      ctx.fillText(ln, tx, y + padY + i * lineH);
    });
    ctx.restore();
  };

  paintOne(leftEl, 'left');
  paintOne(rightEl, 'right');
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('이미지 내보내기 실패: PNG 생성 불가'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    } catch (err) {
      reject(
        new Error(
          err instanceof Error
            ? `이미지 내보내기 실패: ${err.message}`
            : '이미지 내보내기 실패(SecurityError)'
        )
      );
    }
  });
}

/**
 * blob:/data: 대신 서버 일회성 URL로 받아 Chromium HTTP 경고를 피한다.
 */
async function triggerPngDownload(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await canvasToPngBlob(canvas);
  const post = await fetch('/api/map-print/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-File-Name': encodeURIComponent(fileName),
    },
    body: blob,
    credentials: 'same-origin',
  });
  if (!post.ok) {
    let msg = '이미지 서버 저장에 실패했습니다.';
    try {
      const j = (await post.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const { id } = (await post.json()) as { id?: string };
  if (!id) throw new Error('다운로드 id를 받지 못했습니다.');

  const a = document.createElement('a');
  a.href = `/api/map-print/image?id=${encodeURIComponent(id)}`;
  a.download = fileName;
  a.rel = 'noopener';
  a.click();
}

/**
 * 인쇄 지도 PNG 저장.
 * html2canvas(oklab 미지원) 대신 OL 레이어 합성 + 오버레이·푸터를 캔버스에 직접 그린다.
 */
export async function downloadMapPrintImage(
  paperEl: HTMLElement,
  map: OlMap | null,
  fileName = 'map-image.png',
  backgroundId = 'aerial-vworld'
): Promise<void> {
  const mapHost = paperEl.querySelector('.map-print-map-host') as HTMLElement | null;
  if (!mapHost) {
    throw new Error('인쇄 지도 영역을 찾을 수 없습니다.');
  }

  const captureOnce = async () => {
    if (map) {
      await waitForMapRender(map);
    }

    const out = document.createElement('canvas');
    const hostW = Math.max(1, Math.round(mapHost.clientWidth));
    const hostH = Math.max(1, Math.round(mapHost.clientHeight));

    if (map) {
      const composed = document.createElement('canvas');
      let ok = false;
      try {
        ok = safeCompositeOpenLayersMapToCanvas(map, composed);
      } catch {
        ok = false;
      }
      if (!ok || composed.width < 2 || composed.height < 2) {
        throw new Error('지도 이미지를 합성하지 못했습니다. 배경·레이어를 확인한 뒤 다시 시도해 주세요.');
      }
      out.width = composed.width;
      out.height = composed.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('캔버스를 초기화하지 못했습니다.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(composed, 0, 0);
      const scaleX = out.width / hostW;
      const scaleY = out.height / hostH;
      paintMapHtmlOverlays(ctx, mapHost, scaleX, scaleY);
      paintFooterPanels(ctx, paperEl, mapHost, out.width, out.height);
    } else {
      out.width = hostW;
      out.height = hostH;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('캔버스를 초기화하지 못했습니다.');
      ctx.fillStyle = '#e8eef2';
      ctx.fillRect(0, 0, out.width, out.height);
      paintFooterPanels(ctx, paperEl, mapHost, out.width, out.height);
    }

    await triggerPngDownload(out, fileName);
  };

  if (map) {
    await withCanvasBackgroundForCapture(map, backgroundId, captureOnce);
  } else {
    await captureOnce();
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
