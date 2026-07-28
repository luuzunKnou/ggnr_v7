import Overlay from 'ol/Overlay';
import type Map from 'ol/Map';
import type { Coordinate } from 'ol/coordinate';
import './mapWalker.css';

/** 시야 부채꼴 각도(도) */
const FOV_DEG = 70;
/** 얼굴 시야점 — 호 반경(px), 좌우 극단 위로 꺾임(px) */
const EYE_R = 10.5;
const EYE_BEND_UP = 3.5;
function interpolateByZoom(
  zoom: number,
  anchors: Array<[zoom: number, scale: number]>
): number {
  if (zoom <= anchors[0][0]) return anchors[0][1];
  if (zoom >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [startZoom, startScale] = anchors[i];
    const [endZoom, endScale] = anchors[i + 1];
    if (zoom <= endZoom) {
      const t = (zoom - startZoom) / (endZoom - startZoom);
      return startScale + (endScale - startScale) * t;
    }
  }

  return anchors[anchors.length - 1][1];
}

/** 지도 줌 → 워커 아이콘 배율 */
function walkerFigureScaleFromZoom(zoom: number | undefined): number {
  if (zoom == null || !Number.isFinite(zoom)) return 1;
  return interpolateByZoom(zoom, [
    [11, 0.82],
    [13, 0.88],
    [16, 1.0],
    [18, 1.12],
    [20, 1.28],
  ]);
}

/** 지도 줌 → 시야 원 배율 (11에서는 크게 줄이고, 13부터 서서히 확대) */
function walkerRingScaleFromZoom(zoom: number | undefined): number {
  if (zoom == null || !Number.isFinite(zoom)) return 1;
  return interpolateByZoom(zoom, [
    [11, 0.28],
    [13, 0.28],
    [15, 0.36],
    [18, 0.5],
    [20, 0.72],
  ]);
}

export type WalkerScaleInfo = {
  walkerScale: number;
  ringScale: number;
  resolution: number;
  zoom: number | undefined;
  referenceResolution: number;
};

function createBodySvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'body');
  svg.setAttribute('viewBox', '0 0 26 20');
  svg.setAttribute('aria-hidden', 'true');
  const d =
    'M 7.75 0.75 H 18.25 L 23.1 8.45 L 23.45 12.35 Q 24.15 14.05 21.65 15.05 A 9 2.95 0 0 1 4.35 15.05 Q 1.85 14.05 2.55 12.35 L 2.9 8.45 Z';
  svg.innerHTML = `
    <defs>
      <linearGradient id="mw-body-top" x1="13" y1="0.75" x2="13" y2="6.5" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="rgb(71 85 105 / 0.24)"/>
        <stop offset="55%" stop-color="rgb(71 85 105 / 0.06)"/>
        <stop offset="100%" stop-color="rgb(71 85 105 / 0)"/>
      </linearGradient>
      <radialGradient id="mw-body-neck" cx="13" cy="1.5" r="9.5" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="rgb(71 85 105 / 0.2)"/>
        <stop offset="72%" stop-color="rgb(71 85 105 / 0.04)"/>
        <stop offset="100%" stop-color="rgb(71 85 105 / 0)"/>
      </radialGradient>
    </defs>
    <path class="bodyOutline" d="${d}" fill="#fff" />
    <path d="${d}" fill="url(#mw-body-neck)" stroke="none"/>
    <path d="${d}" fill="url(#mw-body-top)" stroke="none"/>
  `;
  return svg;
}

/**
 * OL Overlay 기반 MapWalker 목업.
 * 흰 원 + 시야 부채꼴. 원 위 드래그로 pan 변경.
 */
export class OlMapWalker {
  private overlay: Overlay;
  private content: HTMLDivElement;
  private fovRing: HTMLDivElement;
  private panDeg = 0;
  private onPanChange: ((pan: number) => void) | null = null;
  private onScaleChange: ((info: WalkerScaleInfo) => void) | null = null;
  private dragCleanup: (() => void) | null = null;
  private zoomCleanup: (() => void) | null = null;

  constructor(position: Coordinate) {
    this.content = document.createElement('div');
    this.content.className = 'MapWalker';
    this.content.style.setProperty('--mw-fov', `${FOV_DEG}deg`);

    this.fovRing = document.createElement('div');
    this.fovRing.className = 'fovRing';
    this.fovRing.title = '시야 회전';

    const figure = document.createElement('div');
    figure.className = 'figure';
    const head = document.createElement('div');
    head.className = 'head';
    const faceDot = document.createElement('div');
    faceDot.className = 'faceDot';
    faceDot.setAttribute('aria-hidden', 'true');
    head.appendChild(faceDot);
    figure.appendChild(createBodySvg());
    figure.appendChild(head);

    this.content.appendChild(this.fovRing);
    this.content.appendChild(figure);

    this.overlay = new Overlay({
      element: this.content,
      positioning: 'center-center',
      stopEvent: true,
      insertFirst: false,
    });
    this.overlay.setPosition(position);
    this.applyAngleVisual();
    this.bindAngleDrag();
  }

  /** 맵 시각 중심(센터마크와 동일 좌표) */
  static positionAtVisualCenter(map: Map): Coordinate | null {
    const size = map.getSize();
    if (!size || size.length < 2) {
      const c = map.getView().getCenter();
      return c ? [...c] : null;
    }
    const padding = map.getView().padding ?? [0, 0, 0, 0];
    const padLeft = padding[3] ?? 0;
    const cx = (size[0] + padLeft) / 2;
    const cy = size[1] / 2;
    const coord = map.getCoordinateFromPixel([cx, cy]);
    if (coord) return [...coord];
    const c = map.getView().getCenter();
    return c ? [...c] : null;
  }

  setOnPanChange(cb: ((pan: number) => void) | null) {
    this.onPanChange = cb;
  }

  setOnScaleChange(cb: ((info: WalkerScaleInfo) => void) | null) {
    this.onScaleChange = cb;
  }

  getPan() {
    return this.panDeg;
  }

  setAngle(pan: number) {
    this.panDeg = ((pan % 360) + 360) % 360;
    this.applyAngleVisual();
  }

  setPosition(coord: Coordinate) {
    this.overlay.setPosition(coord);
  }

  getPosition(): Coordinate | undefined {
    return this.overlay.getPosition();
  }

  setMap(map: Map | null) {
    this.zoomCleanup?.();
    this.zoomCleanup = null;
    this.overlay.setMap(map);
    if (!map) {
      this.content.style.setProperty('--mw-scale', '1');
      return;
    }

    const view = map.getView();
    const updateScale = () => {
      const res = view.getResolution();
      const zoom = view.getZoom();
      const figureScale = walkerFigureScaleFromZoom(zoom);
      const ringScale = walkerRingScaleFromZoom(zoom);
      this.content.style.setProperty('--mw-figure-scale', figureScale.toFixed(3));
      this.content.style.setProperty('--mw-ring-scale', ringScale.toFixed(3));
      this.onScaleChange?.({
        walkerScale: figureScale,
        ringScale,
        resolution: res ?? NaN,
        zoom,
        referenceResolution: res ?? NaN,
      });
    };
    updateScale();
    view.on('change:resolution', updateScale);
    this.zoomCleanup = () => view.un('change:resolution', updateScale);
  }

  destroy() {
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.zoomCleanup?.();
    this.zoomCleanup = null;
    this.overlay.setMap(null);
  }

  private applyAngleVisual() {
    this.content.style.setProperty('--mw-pan', `${this.panDeg}deg`);

    const rad = (this.panDeg * Math.PI) / 180;
    // 남쪽(180°)=머리 정중앙, 좌우로 아래 호를 따라 이동, 북쪽 반구는 숨김
    const front = -Math.cos(rad); // 남 +1, 북 -1
    const sinR = Math.sin(rad);
    const ex = sinR * EYE_R;
    const lateral = Math.min(1, Math.abs(sinR));
    const eyeScale = 1 - lateral * 0.14;
    const ey = -(sinR * sinR) * EYE_BEND_UP;
    this.content.style.setProperty('--mw-ex', `${ex.toFixed(2)}px`);
    this.content.style.setProperty('--mw-ey', `${ey.toFixed(2)}px`);
    this.content.style.setProperty('--mw-eye-scale', eyeScale.toFixed(3));
    this.content.style.setProperty('--mw-eye-vis', front > 0.1 ? '1' : '0');

    // 머리 구면 음영 — 방향 정규화, 아래·시선 반대 대각선
    const northness = (1 + Math.cos(rad)) / 2;
    const dx = -Math.sin(rad);
    const dy = Math.abs(Math.cos(rad)) * 0.3 + 0.7;
    const len = Math.hypot(dx, dy) || 1;
    const reach = 5 - northness * 1.1;
    const sx = (dx / len) * reach;
    const sy = (dy / len) * reach;
    const alpha = 0.16 - northness * 0.05;
    const gradR = 13 - northness * 1.8;
    const innerStop = 48 + northness * 9;
    this.content.style.setProperty('--mw-sx', `${sx.toFixed(2)}px`);
    this.content.style.setProperty('--mw-sy', `${sy.toFixed(2)}px`);
    this.content.style.setProperty('--mw-sa', alpha.toFixed(3));
    this.content.style.setProperty('--mw-sr', `${gradR.toFixed(1)}px`);
    this.content.style.setProperty('--mw-ss', `${innerStop.toFixed(0)}%`);
  }

  private bindAngleDrag() {
    const el = this.fovRing;
    let dragging = false;

    const panFromEvent = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const ox = rect.left + rect.width / 2;
      const oy = rect.top + rect.height / 2;
      // 화면: 위쪽이 0°에 가깝게 (지도 북쪽 기준에 맞춤)
      const rad = Math.atan2(e.clientX - ox, oy - e.clientY);
      let deg = (rad * 180) / Math.PI;
      if (deg < 0) deg += 360;
      return deg;
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      el.setPointerCapture(e.pointerId);
      this.setAngle(panFromEvent(e));
      this.onPanChange?.(this.panDeg);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      e.preventDefault();
      this.setAngle(panFromEvent(e));
      this.onPanChange?.(this.panDeg);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    this.dragCleanup = () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }
}
