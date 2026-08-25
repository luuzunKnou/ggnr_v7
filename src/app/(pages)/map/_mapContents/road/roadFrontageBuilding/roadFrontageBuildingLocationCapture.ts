import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { defaults as defaultControls } from 'ol/control';
import { fromString } from 'ol/transform';
import type MapType from 'ol/Map';
import '../../../_mapComponents/config/projections';
import { RESOLUTIONS_3857 } from '../../../_mapComponents/config/mapDefaults';
import {
  createLocalOrthoTileLayer,
  isLocalOrthoBackgroundId,
  ORTHO_TILESET_GROUP_LS_KEY,
  parseBackgroundMapId,
  VWORLD_MAX_ZOOM_INDEX,
  type VWorldLayerType,
} from '../../../_mapComponents/layerFactory/backgroundLayerFactory';
import { compositeOpenLayersMapToCanvas } from '../../parcelAnalysis/ParcelAnalysis.mapCapture';
import { lonLatTo3857 } from './roadFrontageBuildingMock';

const CAPTURE_W = 800;
const CAPTURE_H = 600;
const CAPTURE_FILE_NAME = 'location-map.png';

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

function waitRenderComplete(map: MapType, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.once('rendercomplete', finish);
    map.render();
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

function drawLocationPoint(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

function canvasToPngFile(canvas: HTMLCanvasElement): File | null {
  let dataUrl = '';
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    if (bytes.length < 32) return null;
    return new File([bytes], CAPTURE_FILE_NAME, { type: 'image/png' });
  } catch {
    return null;
  }
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

function createCaptureBackgroundLayer(backgroundId: string): TileLayer<XYZ> {
  if (isLocalOrthoBackgroundId(backgroundId)) {
    return createLocalOrthoTileLayer(backgroundId, localOrthoGroupName(backgroundId));
  }
  const parsed = parseBackgroundMapId(backgroundId);
  const type: VWorldLayerType =
    parsed?.provider === 'vworld' ? (parsed.layerType as VWorldLayerType) : 'satellite';
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

function compositeOffscreenToCanvas(map: MapType, target: HTMLCanvasElement): boolean {
  const size = map.getSize();
  if (!size) return false;
  const [width, height] = size;
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d');
  if (!ctx) return false;
  const layersRoot = map.getViewport().querySelector('.ol-layers');
  if (!layersRoot) return false;
  ctx.fillStyle = '#e8eef2';
  ctx.fillRect(0, 0, width, height);
  let drew = false;
  for (const container of layersRoot.children) {
    const element = container as HTMLElement;
    const canvas = (element.firstElementChild ?? element) as HTMLCanvasElement;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) continue;
    const transform = canvas.style.transform;
    if (transform) {
      const matrix = fromString(transform);
      if (matrix.length === 6) {
        ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      }
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    try {
      ctx.drawImage(canvas, 0, 0);
      drew = true;
    } catch {
      /* tainted */
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return drew;
}

async function captureOffscreen(
  lonLat: { lon: number; lat: number },
  backgroundId: string
): Promise<File | null> {
  const host = document.createElement('div');
  host.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    `width:${CAPTURE_W}px`,
    `height:${CAPTURE_H}px`,
    'opacity:0',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(host);

  let map: Map | null = null;
  try {
    const tileLayer = createCaptureBackgroundLayer(backgroundId);
    const tileSource = tileLayer.getSource();
    map = new Map({
      target: host,
      layers: [tileLayer],
      view: new View({
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
        center: lonLatTo3857(lonLat.lon, lonLat.lat),
        zoom: 17,
      }),
      controls: defaultControls({ attribution: false, zoom: false }),
      interactions: [],
    });
    map.setSize([CAPTURE_W, CAPTURE_H]);
    map.updateSize();
    if (tileSource) await waitTilesLoaded(tileSource, 6000);
    await waitRenderComplete(map, 3000);
    await waitMs(300);
    await waitRenderComplete(map, 2000);

    const canvas = document.createElement('canvas');
    if (!compositeOffscreenToCanvas(map, canvas) || canvas.width < 2) return null;
    const ctx = canvas.getContext('2d');
    const pixel = map.getPixelFromCoordinate(lonLatTo3857(lonLat.lon, lonLat.lat));
    if (ctx && pixel && Number.isFinite(pixel[0]) && Number.isFinite(pixel[1])) {
      drawLocationPoint(ctx, pixel[0], pixel[1]);
    }
    return canvasToPngFile(canvas);
  } catch {
    return null;
  } finally {
    map?.setTarget(undefined);
    host.remove();
  }
}

async function captureLiveMap(
  map: MapType,
  lonLat: { lon: number; lat: number }
): Promise<File | null> {
  await waitMs(120);
  await waitRenderComplete(map, 2000);
  const composed = document.createElement('canvas');
  let ok = false;
  try {
    ok = compositeOpenLayersMapToCanvas(map, composed);
  } catch {
    ok = false;
  }
  if (!ok || composed.width < 2) return null;
  const padding = map.getView().padding ?? [0, 0, 0, 0];
  const top = Math.max(0, Math.round(Number(padding[0] ?? 0)));
  const right = Math.max(0, Math.round(Number(padding[1] ?? 0)));
  const bottom = Math.max(0, Math.round(Number(padding[2] ?? 0)));
  const left = Math.max(0, Math.round(Number(padding[3] ?? 0)));
  const cropW = composed.width - left - right;
  const cropH = composed.height - top - bottom;
  const useCrop = cropW >= 80 && cropH >= 80;
  const out = document.createElement('canvas');
  out.width = useCrop ? cropW : composed.width;
  out.height = useCrop ? cropH : composed.height;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  if (useCrop) ctx.drawImage(composed, left, top, cropW, cropH, 0, 0, cropW, cropH);
  else ctx.drawImage(composed, 0, 0);
  const pixel = map.getPixelFromCoordinate(lonLatTo3857(lonLat.lon, lonLat.lat));
  if (pixel && Number.isFinite(pixel[0]) && Number.isFinite(pixel[1])) {
    const x = useCrop ? pixel[0] - left : pixel[0];
    const y = useCrop ? pixel[1] - top : pixel[1];
    if (x >= 0 && y >= 0 && x <= out.width && y <= out.height) {
      drawLocationPoint(ctx, x, y);
    }
  }
  return canvasToPngFile(out);
}

/**
 * 현재 배경지도를 담아 좌표에 점을 찍은 위치도 그림을 만든다.
 * 화면에 보이는 WebGL 배경은 그림으로 못 담는 경우가 많아, 같은 배경의 타일로 다시 그린다.
 */
export async function captureLocationMapWithPoint(
  map: MapType,
  lonLat: { lon: number; lat: number },
  backgroundId?: string
): Promise<File | null> {
  const offscreen = await captureOffscreen(lonLat, backgroundId?.trim() || 'aerial-vworld');
  if (offscreen) return offscreen;
  return captureLiveMap(map, lonLat);
}
