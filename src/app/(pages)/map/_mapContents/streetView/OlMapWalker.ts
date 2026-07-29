import Overlay from 'ol/Overlay';
import type Map from 'ol/Map';
import type { Coordinate } from 'ol/coordinate';
import './mapWalker.css';

/** 시야 부채꼴 각도(도) */
const FOV_DEG = 70;
/** 얼굴 시야점 — 호 반경(px), 좌우 극단 위로 꺾임(px) */
const EYE_R = 10.5;
const EYE_BEND_UP = 3.5;
/** 시야점 수직 이동 상한(px) — 양수(위) / 음수(아래, 짧게) */
const EYE_MAX_UP_PX = 8;
const EYE_MAX_DOWN_PX = 3.5;
/** 음수 수직각: 이 각도에서 하단 상한 */
const TILT_DOWN_CAP_DEG = -10;

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
    [18, 0.92],
    [20, 1.35],
  ]);
}

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
 * OL Overlay 기반 MapWalker.
 * 흰 원 + 시야 부채꼴. 원 위 드래그로 pan 변경.
 */
export class OlMapWalker {
  private overlay: Overlay;
  private content: HTMLDivElement;
  private fovRing: HTMLDivElement;
  private panDeg = 0;
  private tiltDeg = 0;
  private onPanChange: ((pan: number) => void) | null = null;
  private dragCleanup: (() => void) | null = null;
  private zoomCleanup: (() => void) | null = null;
  /** 마지막 적용 CSS 값 — 동일 시 setProperty 생략 */
  private cssVars: Record<string, string> = {};
  private lastFigureScale = '';
  private lastRingScale = '';
  private zoomRaf = 0;

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

  getPan() {
    return this.panDeg;
  }

  getTilt() {
    return this.tiltDeg;
  }

  setAngle(pan: number) {
    const next = ((pan % 360) + 360) % 360;
    if (next === this.panDeg) return;
    this.panDeg = next;
    this.applyAngleVisual();
  }

  /** 수직각(-90~90). 시야점 이동은 음수 -10° 하단 상한·양수보다 짧은 이동 */
  setTilt(tilt: number) {
    const n = Number.isFinite(tilt) ? tilt : 0;
    const next = Math.min(90, Math.max(-90, n));
    if (next === this.tiltDeg) return;
    this.tiltDeg = next;
    this.applyAngleVisual();
  }

  setPosition(coord: Coordinate) {
    const prev = this.overlay.getPosition();
    if (prev && prev[0] === coord[0] && prev[1] === coord[1]) return;
    this.overlay.setPosition(coord);
  }

  getPosition(): Coordinate | undefined {
    return this.overlay.getPosition();
  }

  setMap(map: Map | null) {
    this.zoomCleanup?.();
    this.zoomCleanup = null;
    if (this.zoomRaf) {
      cancelAnimationFrame(this.zoomRaf);
      this.zoomRaf = 0;
    }
    this.overlay.setMap(map);
    if (!map) {
      this.setCss('--mw-figure-scale', '1');
      this.setCss('--mw-ring-scale', '1');
      this.lastFigureScale = '1';
      this.lastRingScale = '1';
      return;
    }

    const view = map.getView();
    const updateScale = () => {
      const zoom = view.getZoom();
      const figureScale = walkerFigureScaleFromZoom(zoom).toFixed(3);
      const ringScale = walkerRingScaleFromZoom(zoom).toFixed(3);
      if (figureScale !== this.lastFigureScale) {
        this.lastFigureScale = figureScale;
        this.setCss('--mw-figure-scale', figureScale);
      }
      if (ringScale !== this.lastRingScale) {
        this.lastRingScale = ringScale;
        this.setCss('--mw-ring-scale', ringScale);
      }
    };
    const scheduleScale = () => {
      if (this.zoomRaf) return;
      this.zoomRaf = requestAnimationFrame(() => {
        this.zoomRaf = 0;
        updateScale();
      });
    };
    updateScale();
    view.on('change:resolution', scheduleScale);
    this.zoomCleanup = () => {
      view.un('change:resolution', scheduleScale);
      if (this.zoomRaf) {
        cancelAnimationFrame(this.zoomRaf);
        this.zoomRaf = 0;
      }
    };
  }

  destroy() {
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.zoomCleanup?.();
    this.zoomCleanup = null;
    if (this.zoomRaf) {
      cancelAnimationFrame(this.zoomRaf);
      this.zoomRaf = 0;
    }
    this.overlay.setMap(null);
    this.cssVars = {};
  }

  private setCss(name: string, value: string) {
    if (this.cssVars[name] === value) return;
    this.cssVars[name] = value;
    this.content.style.setProperty(name, value);
  }

  private applyAngleVisual() {
    // pan은 transform rotate만 — conic-gradient 재계산 없음
    this.setCss('--mw-pan', `${this.panDeg}deg`);

    const rad = (this.panDeg * Math.PI) / 180;
    // 남쪽(180°)=정면(+), 북쪽(0°)=후면(-)
    const front = -Math.cos(rad);
    const sinR = Math.sin(rad);
    const tiltForEye =
      this.tiltDeg >= 0
        ? Math.min(90, this.tiltDeg)
        : Math.max(TILT_DOWN_CAP_DEG, this.tiltDeg);
    const tiltNorm =
      this.tiltDeg >= 0 ? tiltForEye / 90 : tiltForEye / -TILT_DOWN_CAP_DEG;

    const ex = sinR * EYE_R;
    const lateral = Math.min(1, Math.abs(sinR));
    const eyeScale = 1 - lateral * 0.14;
    const eyPan = -(sinR * sinR) * EYE_BEND_UP;
    const verticalAmp = this.tiltDeg >= 0 ? EYE_R + 3 : EYE_MAX_DOWN_PX;
    const vertical = -tiltNorm * verticalAmp;
    const eyRaw = eyPan + vertical;
    const ey = Math.min(EYE_MAX_DOWN_PX, Math.max(-EYE_MAX_UP_PX, eyRaw));
    const eyeVis = front > 0.1 ? '1' : '0';
    this.setCss('--mw-ex', `${ex.toFixed(2)}px`);
    this.setCss('--mw-ey', `${ey.toFixed(2)}px`);
    this.setCss('--mw-eye-scale', eyeScale.toFixed(3));
    this.setCss('--mw-eye-vis', eyeVis);

    // 머리 음영 — 값 반올림 후 dirty set
    const lightX = sinR;
    const lightY = -front * 0.5 + 0.38 - tiltNorm * 0.5;
    const llen = Math.hypot(lightX, lightY) || 1;
    const reach = 4.4 + (1 - Math.abs(front)) * 0.6;
    const sx = (-lightX / llen) * reach;
    const sy = (-lightY / llen) * reach;
    const tiltAmt = Math.abs(tiltNorm);
    const alpha = 0.1 + (1 - front) * 0.025 + tiltAmt * 0.02;
    const gradR = 15 - tiltAmt * 1.1;
    const softCore = Math.max(28, 42 + front * 6 - tiltNorm * 5);
    const softMid = Math.min(88, softCore + 28);
    this.setCss('--mw-sx', `${sx.toFixed(2)}px`);
    this.setCss('--mw-sy', `${sy.toFixed(2)}px`);
    this.setCss('--mw-sa', Math.min(0.16, alpha).toFixed(3));
    this.setCss('--mw-sr', `${gradR.toFixed(1)}px`);
    this.setCss('--mw-ss', `${softCore.toFixed(0)}%`);
    this.setCss('--mw-sm', `${softMid.toFixed(0)}%`);
  }

  private bindAngleDrag() {
    const el = this.fovRing;
    let dragging = false;
    let ox = 0;
    let oy = 0;

    const panFromClient = (clientX: number, clientY: number) => {
      const rad = Math.atan2(clientX - ox, oy - clientY);
      let deg = (rad * 180) / Math.PI;
      if (deg < 0) deg += 360;
      return deg;
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      const rect = el.getBoundingClientRect();
      ox = rect.left + rect.width / 2;
      oy = rect.top + rect.height / 2;
      el.setPointerCapture(e.pointerId);
      this.setAngle(panFromClient(e.clientX, e.clientY));
      this.onPanChange?.(this.panDeg);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      e.preventDefault();
      this.setAngle(panFromClient(e.clientX, e.clientY));
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
