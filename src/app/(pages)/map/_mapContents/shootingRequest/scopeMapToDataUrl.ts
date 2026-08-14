'use client';

import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import { defaults as defaultControls } from 'ol/control';
import { fromString } from 'ol/transform';
import '../../_mapComponents/config/projections';
import { transformCoordinate } from '../../_mapComponents/services/coordinateService';
import { RESOLUTIONS_3857 } from '../../_mapComponents/config/mapDefaults';
import { VWORLD_MAX_ZOOM_INDEX } from '../../_mapComponents/layerFactory/backgroundLayerFactory';

const SCOPE_STYLE = new Style({
  stroke: new Stroke({ color: '#0284c7', width: 2 }),
  fill: new Fill({ color: 'rgba(2,132,199,0.22)' }),
});

const CAPTURE_W = 640;
const CAPTURE_H = 360;

function parsePolygonWkt5181(wkt: string): [number, number][] | null {
  const m = wkt.trim().match(/^POLYGON\s*\(\s*\(\s*(.+?)\s*\)\s*\)$/i);
  if (!m) return null;
  const ring: [number, number][] = [];
  for (const part of m[1].split(',')) {
    const nums = part.trim().split(/\s+/).map(Number);
    if (nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) return null;
    ring.push([nums[0], nums[1]]);
  }
  return ring.length >= 4 ? ring : null;
}

/** PDF 캡처용 — WebGL 대신 일반 Tile(캔버스 합성 가능·CORS 명시) */
function createVworldSatelliteTileLayer(): TileLayer<XYZ> {
  return new TileLayer({
    source: new XYZ({
      url: 'https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg',
      crossOrigin: 'anonymous',
      maxZoom: VWORLD_MAX_ZOOM_INDEX,
      attributions: '© VWorld',
    }),
  });
}

function compositeMapToCanvas(map: Map, target: HTMLCanvasElement): boolean {
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
  ctx.fillStyle = '#e8eef2';
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
      /* tainted */
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  return drew;
}

function waitRenderComplete(map: Map, timeoutMs: number): Promise<void> {
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

/**
 * 촬영 범위 WKT(EPSG:5181)를 배경지도+폴리곤 이미지(data URL)로 만든다.
 * PDF 위치도 삽입용. 실패 시 null.
 */
export async function scopeMapToDataUrl(wkt5181: string): Promise<string | null> {
  const ring5181 = parsePolygonWkt5181(wkt5181);
  if (!ring5181) return null;

  const ring3857: [number, number][] = [];
  for (const pt of ring5181) {
    const c = transformCoordinate(pt, 'EPSG:5181', 'EPSG:3857');
    if (!c) return null;
    ring3857.push([c[0], c[1]]);
  }

  /** opacity:0 이면 타일 로딩이 스킵되는 브라우저가 있음 → 화면 밖·불투명이되 보이게 */
  const host = document.createElement('div');
  host.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    `width:${CAPTURE_W}px`,
    `height:${CAPTURE_H}px`,
    'opacity:1',
    'visibility:hidden',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(host);

  let map: Map | null = null;
  try {
    const vectorSource = new VectorSource({
      features: [new Feature({ geometry: new Polygon([ring3857]) })],
    });
    const tileLayer = createVworldSatelliteTileLayer();
    const tileSource = tileLayer.getSource();

    map = new Map({
      target: host,
      layers: [
        tileLayer,
        new VectorLayer({ source: vectorSource, style: SCOPE_STYLE, zIndex: 10 }),
      ],
      view: new View({
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
      }),
      controls: defaultControls({ attribution: false, zoom: false }),
      interactions: [],
    });

    map.setSize([CAPTURE_W, CAPTURE_H]);
    map.getView().fit(vectorSource.getExtent(), {
      padding: [28, 28, 28, 28],
      maxZoom: 17,
      duration: 0,
    });
    map.updateSize();

    if (tileSource) {
      await waitTilesLoaded(tileSource, 6000);
    }
    await waitRenderComplete(map, 3000);
    await new Promise((r) => window.setTimeout(r, 400));
    await waitRenderComplete(map, 2000);

    const canvas = document.createElement('canvas');
    if (!compositeMapToCanvas(map, canvas) || canvas.width < 2) {
      return null;
    }
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    map?.setTarget(undefined);
    host.remove();
  }
}
