import Overlay from 'ol/Overlay';
import type Map from 'ol/Map';
import type { Coordinate } from 'ol/coordinate';
import { getPointResolution } from 'ol/proj';
import { getMapVisualCenterCoordinate } from '../../_mapComponents/config/mapVisualCenter';
import {
  applyHatCylinder,
  computeHatCylinder,
  computeWalkerViewBasis,
  createHatCylinder,
} from './mapWalkerHatCylinder';
import './mapWalker.css';

/** 원기둥 SVG 화면 표시 — false면 미부착(파일·모듈 유지) */
const SHOW_HAT_CYLINDER = true;
/** 뒤통수 GGNR 문구 — false면 비가시(DOM·로직 유지) */
const SHOW_HEAD_MARK = false;

/** 시야 부채꼴 각도(도) */
const FOV_DEG = 70;
/** CSS 시야 원 지름(px) — mapWalker.css .fovRing 과 동일 */
export const WALKER_FOV_RING_DIAMETER_PX = 168;
/** 얼굴 시야점 — 호 반경(px), 좌우 극단 위로 꺾임(px) */
const EYE_R = 10.5;
const EYE_BEND_UP = 3.5;
/** 시야점 수직 이동 상한(px) — 위 봄(음수, 길게) / 아래 봄(양수, 짧게) */
const EYE_MAX_UP_PX = 11;
const EYE_MAX_DOWN_PX = 5.5;

const PANO_SEARCH_RADIUS_MIN_M = 50;
const PANO_SEARCH_RADIUS_MAX_M = 2000;

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

/** 지도 줌 → 시야 원 배율 (중줌·14 근처에서 검색 반경·시야가 너무 작지 않도록) */
export function walkerRingScaleFromZoom(zoom: number | undefined): number {
  if (zoom == null || !Number.isFinite(zoom)) return 1;
  return interpolateByZoom(zoom, [
    [11, 0.42],
    [13, 0.58],
    [14, 0.78],
    [16, 0.98],
    [18, 1.18],
    [20, 1.35],
  ]);
}

/**
 * 시야원 화면 반지름 → 지상 거리(m). getNearestPanoId 검색 반경용.
 * 시각 시야원보다 약간 넓게(1.35배) 잡아 중줌에서도 근처 파노라마를 잘 찾음.
 */
export function panoSearchRadiusMetersFromMap(map: Map): number {
  const view = map.getView();
  const zoom = view.getZoom();
  const resolution = view.getResolution();
  const center = view.getCenter();
  const projection = view.getProjection();
  if (resolution == null || !center || !projection) {
    return PANO_SEARCH_RADIUS_MIN_M;
  }
  const diameterPx = WALKER_FOV_RING_DIAMETER_PX * walkerRingScaleFromZoom(zoom);
  const radiusPx = diameterPx / 2;
  const mPerPx = getPointResolution(projection, resolution, center);
  const meters = radiusPx * mPerPx * 1.35;
  if (!Number.isFinite(meters) || meters <= 0) return PANO_SEARCH_RADIUS_MIN_M;
  return Math.min(
    PANO_SEARCH_RADIUS_MAX_M,
    Math.max(PANO_SEARCH_RADIUS_MIN_M, Math.round(meters))
  );
}

/** 북쪽(315~47°) 구간 — 그림자 보강 가중치 0~1 */
function northFacingWeight(panDeg: number): number {
  if (panDeg >= 315) return (360 - panDeg) / 45;
  if (panDeg <= 47) return 1 - panDeg / 47;
  return 0;
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
 * 지면 투시 타원 + 시야 부채꼴. 원 위 드래그로 pan 변경.
 */
export class OlMapWalker {
  private overlay: Overlay;
  private content: HTMLDivElement;
  private fovRing: HTMLDivElement;
  private hatCylinder: SVGSVGElement | null = null;
  private panDeg = 0;
  private tiltDeg = 0;
  private mapRef: Map | null = null;
  private onPanChange: ((pan: number) => void) | null = null;
  private dragCleanup: (() => void) | null = null;
  private zoomCleanup: (() => void) | null = null;
  private wheelCleanup: (() => void) | null = null;
  /** 마지막 적용 CSS 값 — 동일 시 setProperty 생략 */
  private cssVars: Record<string, string> = {};
  private lastFigureScale = '';
  private lastRingScale = '';
  private zoomRaf = 0;
  /** pan/tilt DOM 갱신 프레임 합치기 */
  private angleVisualRaf = 0;

  constructor(position: Coordinate) {
    this.content = document.createElement('div');
    this.content.className = 'MapWalker';
    this.content.style.setProperty('--mw-fov', `${FOV_DEG}deg`);

    this.fovRing = document.createElement('div');
    this.fovRing.className = 'fovRing';
    this.fovRing.title = '시야 회전';
    const fovWedge = document.createElement('div');
    fovWedge.className = 'fovWedge';
    fovWedge.setAttribute('aria-hidden', 'true');
    this.fovRing.appendChild(fovWedge);

    const figure = document.createElement('div');
    figure.className = 'figure';
    const head = document.createElement('div');
    head.className = 'head';
    const faceDot = document.createElement('div');
    faceDot.className = 'faceDot';
    faceDot.setAttribute('aria-hidden', 'true');
    head.appendChild(faceDot);
    const headMark = document.createElement('div');
    headMark.className = 'headMark';
    headMark.setAttribute('aria-hidden', 'true');
    headMark.textContent = 'GGNR';
    head.appendChild(headMark);
    figure.appendChild(createBodySvg());
    figure.appendChild(head);
    if (SHOW_HAT_CYLINDER) {
      this.hatCylinder = createHatCylinder();
      figure.appendChild(this.hatCylinder);
    }

    this.content.appendChild(this.fovRing);
    this.content.appendChild(figure);

    this.overlay = new Overlay({
      element: this.content,
      positioning: 'center-center',
      // 시야 원 밖은 pointer-events:none → 맵으로 통과. 원 위 휠은 직접 전달
      stopEvent: false,
      insertFirst: false,
    });
    this.overlay.setPosition(position);
    this.applyAngleVisual();
    this.bindAngleDrag();
    this.bindWheelForward();
  }

  /** 맵 시각 중심(센터마크와 동일 좌표) */
  static positionAtVisualCenter(map: Map): Coordinate | null {
    return getMapVisualCenterCoordinate(map);
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
    this.scheduleAngleVisual();
  }

  /** 수직각(-90~90, 카카오와 동일: 음수=위·양수=아래). 시야점은 음수 시 위로(상한 -18°) */
  setTilt(tilt: number) {
    const n = Number.isFinite(tilt) ? tilt : 0;
    const next = Math.min(90, Math.max(-90, n));
    if (next === this.tiltDeg) return;
    this.tiltDeg = next;
    this.scheduleAngleVisual();
  }

  private scheduleAngleVisual() {
    if (this.angleVisualRaf) return;
    this.angleVisualRaf = requestAnimationFrame(() => {
      this.angleVisualRaf = 0;
      this.applyAngleVisual();
    });
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
    this.mapRef = map;
    if (this.zoomRaf) {
      cancelAnimationFrame(this.zoomRaf);
      this.zoomRaf = 0;
    }
    if (this.angleVisualRaf) {
      cancelAnimationFrame(this.angleVisualRaf);
      this.angleVisualRaf = 0;
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
    this.wheelCleanup?.();
    this.wheelCleanup = null;
    this.zoomCleanup?.();
    this.zoomCleanup = null;
    this.mapRef = null;
    if (this.zoomRaf) {
      cancelAnimationFrame(this.zoomRaf);
      this.zoomRaf = 0;
    }
    if (this.angleVisualRaf) {
      cancelAnimationFrame(this.angleVisualRaf);
      this.angleVisualRaf = 0;
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
    const pan = this.panDeg;
    const tilt = this.tiltDeg;

    this.setCss('--mw-pan', `${pan}deg`);

    // 원기둥과 동일 시선 기저 (투시·단축 연동)
    const basis = computeWalkerViewBasis(pan, tilt);
    const { front, sinR, lateral, tiltNorm, tiltAmt } = basis;

    const ex = sinR * EYE_R;
    // 좌우 극단 + 수직각 끝에서 시야점 축소 → 축소 시점부터 원→타원
    const eyeScale =
      (1 - lateral * 0.14) * (1 - tiltAmt * 0.1);
    const shrinkAmt = 1 - eyeScale;
    const ellipseT = shrinkAmt > 0.002 ? Math.min(1, shrinkAmt / 0.2) : 0;
    const tiltEllipse = tiltAmt * ellipseT * (0.22 + tiltAmt * 0.38);
    const eyeSx = eyeScale * (1 - lateral * ellipseT * 0.14);
    const eyeSy = eyeScale * (1 - tiltEllipse);
    const eyPan = -(sinR * sinR) * EYE_BEND_UP;
    const verticalAmp = tiltNorm <= 0 ? EYE_MAX_UP_PX : EYE_MAX_DOWN_PX;
    const eyRaw = eyPan + tiltNorm * verticalAmp;
    const ey = Math.min(EYE_MAX_DOWN_PX, Math.max(-EYE_MAX_UP_PX, eyRaw));
    const eyeVis = pan >= 60 && pan <= 300 ? '1' : '0';
    // 좌우 이동 방향에 따라 타원 기울기: 동쪽(sin>0) → 음수 회전, 서쪽(sin<0) → 양수 회전
    const eyeRot = -(sinR * lateral * 32 * (eyeSx < eyeSy ? eyeSy - eyeSx : 0.18));

    this.setCss('--mw-ex', `${ex.toFixed(1)}px`);
    this.setCss('--mw-ey', `${ey.toFixed(1)}px`);
    this.setCss('--mw-eye-sx', eyeSx.toFixed(2));
    this.setCss('--mw-eye-sy', eyeSy.toFixed(2));
    this.setCss('--mw-eye-rot', `${eyeRot.toFixed(1)}deg`);
    this.setCss('--mw-eye-vis', eyeVis);

    // 뒤통수 GGNR — 시야점 구면 대척 (수평·수직 부호 반전, 가시 배타)
    const markVis = SHOW_HEAD_MARK && eyeVis !== '1' ? '1' : '0';
    this.setCss('--mw-mx', `${(-ex).toFixed(1)}px`);
    this.setCss('--mw-my', `${(-ey).toFixed(1)}px`);
    this.setCss('--mw-m-sx', eyeSx.toFixed(2));
    this.setCss('--mw-m-sy', eyeSy.toFixed(2));
    this.setCss('--mw-m-rot', `${(-eyeRot).toFixed(1)}deg`);
    this.setCss('--mw-m-vis', markVis);

    // 머리 그림자 — 3D 정상단 광원: pitch·yaw에 따라 구 표면 어두운 영역 투영
    const northW = northFacingWeight(pan);
    const yawShade = sinR;
    const pitchShade = tiltNorm;
    const pitchGain = 5.8 + northW * 3.2;
    const sx = yawShade * (3.2 + tiltAmt * 0.85);
    const sy = 2.4 + pitchShade * pitchGain + (1 - Math.abs(front)) * 0.55;
    const alpha =
      0.09 +
      tiltAmt * 0.058 +
      Math.abs(yawShade) * 0.03 +
      northW * tiltAmt * 0.04;
    const alphaCap = 0.24;
    const gradR = 14.5 - tiltAmt * 1.65 - northW * tiltAmt * 0.55;
    const softCore = Math.max(32, 40 + tiltAmt * 10 + Math.abs(yawShade) * 5);
    const softMid = Math.min(90, softCore + 26);

    this.setCss('--mw-sx', `${sx.toFixed(1)}px`);
    this.setCss('--mw-sy', `${sy.toFixed(1)}px`);
    this.setCss('--mw-sa', Math.min(alphaCap, alpha).toFixed(2));
    this.setCss('--mw-sr', `${gradR.toFixed(0)}px`);
    this.setCss('--mw-ss', `${softCore.toFixed(0)}%`);
    this.setCss('--mw-sm', `${softMid.toFixed(0)}%`);

    if (SHOW_HAT_CYLINDER && this.hatCylinder) {
      applyHatCylinder(this.hatCylinder, computeHatCylinder(basis));
    }
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

  /** 시야 원 위 휠 → 지도 뷰포트로 전달 (줌 잠김 방지) */
  private bindWheelForward() {
    const el = this.fovRing;
    const onWheel = (e: WheelEvent) => {
      const map = this.mapRef;
      if (!map) return;
      const viewport = map.getViewport();
      if (!viewport) return;
      const forwarded = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      });
      viewport.dispatchEvent(forwarded);
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    this.wheelCleanup = () => {
      el.removeEventListener('wheel', onWheel);
    };
  }
}
