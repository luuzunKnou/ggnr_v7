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
  WALKER_TILT_UP_CAP_DEG,
} from './mapWalkerHatCylinder';
import {
  applyCatEars,
  computeCatEars,
  createCatEars,
  setCatEarsVisible,
  type CatEarsElements,
} from './mapWalkerCatEars';
import './mapWalker.css';

/** 워커 아이콘 형태 — 기본값은 고양이(cat) */
export type WalkerIconMode = 'default' | 'hat' | 'ggnr' | 'cat' | 'ggnrCat';

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
/** mapWalker.css .faceDot `top: calc(50% + Npx)` 와 동일 — 머리 중심 대비 시야점 기본 Y */
const EYE_BASE_OY_PX = 3;
/**
 * 좌우 극단에서 세로 단축 완화 시작 각도.
 * 위 봄(음수) / 아래 봄(양수) — «감은 눈»처럼 보이는 납작 타원을 막는다.
 */
const EYE_UP_ELLIPSE_SOFT_DEG = -12.5;
const EYE_DOWN_ELLIPSE_SOFT_DEG = 12.1;
/** 아래 봄 완화 상한(로드뷰 tilt 최대에 맞춤) */
const EYE_DOWN_ELLIPSE_SOFT_END_DEG = 90;

/**
 * 구면 시야점 — 정면(180) 기준. 구 표면의 한 점처럼 투영.
 * fromFront 0→90: 정면→동·서 측면
 * fromFront 90→126: 측면→후면 — 윤곽에 붙어 상승·좌우로 납작/잘림 (중심으로 돌아오지 않음)
 */
const EYE_SIDE_FROM_FRONT_DEG = 90;
const EYE_HIDE_FROM_FRONT_DEG = 126;
/** 측면 지나 후면: 구면 따라 위로 (px) */
const EYE_PAST_SIDE_CLIMB_PX = 2.5;
/** 측면 지나 후면: 머리 밖으로 밀어 overflow로 잘리게 (px) */
const EYE_PAST_SIDE_OUT_PX = 5;
/** 측면 지나 후면: 가로(깊이) 단축 강도 0~1 */
const EYE_PAST_SIDE_SX_SQUASH = 0.9;

/**
 * 뒤통수 GGNR — 정후면(0°) 기준 이 각도까지 표시(opacity 페이드 없음).
 * 측면은 머리 overflow로 일부만 잘려 보임.
 */
const GGNR_MARK_VISIBLE_UNTIL_DEG = 90;

/**
 * 뒤통수 문구 세로 보정(px, + 가 아래).
 * 문구는 시야점의 대척점을 그대로 따라가는데, 그대로 두면 머리 위쪽에
 * 치우쳐 보인다. 아래로 조금 내려 머리 한가운데에 얹는다.
 */
const GGNR_MARK_OY_PX = 3;

/** pan → 정후면으로부터의 최소 각(0=등, 180=정면) */
function panFromBackDeg(panDeg: number): number {
  const pan = ((panDeg % 360) + 360) % 360;
  return Math.min(pan, 360 - pan);
}

/** pan → 정면(180°)으로부터의 최소 각(0=정면, 90=동·서, 180=등) */
function panFromFrontDeg(panDeg: number): number {
  const pan = ((panDeg % 360) + 360) % 360;
  const d = Math.abs(pan - 180);
  return Math.min(d, 360 - d);
}

/**
 * 정면→측면 단축량 0~1 (fromFront / 90, 상한 1).
 * 측면 이후에도 1 유지 — |sin|처럼 90° 지나 다시 커지지 않음.
 */
function eyeForeshortenFromFront(fromFrontDeg: number): number {
  return Math.min(1, fromFrontDeg / EYE_SIDE_FROM_FRONT_DEG);
}

/**
 * 측면(90°)을 지나 후면으로 가는 진행도 0~1.
 * 270→306 / 90→54 등에서 Y 상승에 사용.
 */
function eyePastSideT(fromFrontDeg: number): number {
  const span = EYE_HIDE_FROM_FRONT_DEG - EYE_SIDE_FROM_FRONT_DEG;
  if (span <= 1e-6 || fromFrontDeg <= EYE_SIDE_FROM_FRONT_DEG) return 0;
  return Math.min(1, (fromFrontDeg - EYE_SIDE_FROM_FRONT_DEG) / span);
}

/** 뒤통수 문구 표시 여부 (이진, 페이드 없음) */
function ggnrMarkVisible(panDeg: number): boolean {
  return panFromBackDeg(panDeg) <= GGNR_MARK_VISIBLE_UNTIL_DEG;
}

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
  private catEars: CatEarsElements | null = null;
  private iconMode: WalkerIconMode = 'cat';
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
    this.hatCylinder = createHatCylinder();
    figure.appendChild(this.hatCylinder);
    this.catEars = createCatEars();
    figure.appendChild(this.catEars.far);
    figure.appendChild(this.catEars.near);

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

  setIconMode(mode: WalkerIconMode) {
    if (mode === this.iconMode) return;
    this.iconMode = mode;
    this.applyAngleVisual();
  }

  getIconMode(): WalkerIconMode {
    return this.iconMode;
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
    const { front, sinR, tiltNorm, tiltAmt } = basis;

    // 구면 한 점: 정면→측면은 sin 궤도, 측면 이후는 윤곽에 붙어 뒤쪽으로(중심으로 복귀 금지)
    const fromFront = panFromFrontDeg(pan);
    const sideAmt = eyeForeshortenFromFront(fromFront);
    const pastSide = eyePastSideT(fromFront);
    const orbitSign = pan >= 180 ? -1 : 1;
    const ex =
      pastSide > 0
        ? orbitSign * (EYE_R + pastSide * EYE_PAST_SIDE_OUT_PX)
        : sinR * EYE_R;
    // 정면→측면 단축
    const eyeScale =
      (1 - sideAmt * 0.14) * (1 - tiltAmt * 0.1);
    const shrinkAmt = 1 - eyeScale;
    const ellipseT = shrinkAmt > 0.002 ? Math.min(1, shrinkAmt / 0.2) : 0;
    let tiltEllipse = tiltAmt * ellipseT * (0.22 + tiltAmt * 0.38);
    // 위 봄 −12.5°·아래 봄 +12.1° 이상: 세로 단축 완화 + 스케일 원점 아래로
    let eyeOriginY = 50;
    if (ellipseT > 0) {
      let soft = 0;
      if (tilt < EYE_UP_ELLIPSE_SOFT_DEG) {
        const span = EYE_UP_ELLIPSE_SOFT_DEG - WALKER_TILT_UP_CAP_DEG;
        soft =
          span > 1e-6
            ? Math.min(1, Math.max(0, (EYE_UP_ELLIPSE_SOFT_DEG - tilt) / span))
            : 0;
      } else if (tilt > EYE_DOWN_ELLIPSE_SOFT_DEG) {
        const span = EYE_DOWN_ELLIPSE_SOFT_END_DEG - EYE_DOWN_ELLIPSE_SOFT_DEG;
        soft =
          span > 1e-6
            ? Math.min(1, Math.max(0, (tilt - EYE_DOWN_ELLIPSE_SOFT_DEG) / span))
            : 0;
      }
      if (soft > 0) {
        tiltEllipse *= 1 - soft * 0.62;
        eyeOriginY = 50 + soft * 18;
      }
    }
    // 측면 이후: 깊이축(가로) 강하게 납작 — 온전한 원으로 남지 않음
    const pastSx = Math.max(0.1, 1 - pastSide * EYE_PAST_SIDE_SX_SQUASH);
    const pastSy = Math.max(0.35, 1 - pastSide * 0.4);
    const eyeSx =
      eyeScale * (1 - sideAmt * ellipseT * 0.14) * pastSx;
    const eyeSy = Math.max(
      eyeScale * (1 - tiltEllipse) * pastSy,
      eyeSx * 0.58
    );
    // 측면까지 위 꺾임 + 측면 이후 윤곽을 따라 소폭 상승
    const eyPan =
      -(sideAmt * sideAmt) * EYE_BEND_UP - pastSide * EYE_PAST_SIDE_CLIMB_PX;
    const verticalAmp = tiltNorm <= 0 ? EYE_MAX_UP_PX : EYE_MAX_DOWN_PX;
    const eyRaw = eyPan + tiltNorm * verticalAmp;
    const eyUpCap = EYE_MAX_UP_PX + EYE_PAST_SIDE_CLIMB_PX;
    const ey = Math.min(EYE_MAX_DOWN_PX, Math.max(-eyUpCap, eyRaw));
    // 페이드 없음 — 숨김 각도 전까지 1, 이후 0
    const eyeVis = fromFront < EYE_HIDE_FROM_FRONT_DEG ? '1' : '0';
    const eyeRot = -(
      (pastSide > 0 ? orbitSign : Math.sign(sinR || 1)) *
      sideAmt *
      32 *
      0.18
    );

    this.setCss('--mw-ex', `${ex.toFixed(1)}px`);
    this.setCss('--mw-ey', `${ey.toFixed(1)}px`);
    this.setCss('--mw-eye-sx', eyeSx.toFixed(2));
    this.setCss('--mw-eye-sy', eyeSy.toFixed(2));
    this.setCss('--mw-eye-rot', `${eyeRot.toFixed(1)}deg`);
    this.setCss('--mw-eye-oy', `${eyeOriginY.toFixed(0)}%`);
    this.setCss('--mw-eye-vis', eyeVis);

    // GGNR: 시야점 pastSide(윤곽 밀기·납작)와 분리 — 구 뒷면 자체 궤도(sin + fromBack)
    const showMark = this.iconMode === 'ggnr' || this.iconMode === 'ggnrCat';
    const markVis = showMark && ggnrMarkVisible(pan) ? '1' : '0';
    const fromBack = panFromBackDeg(pan);
    const markAmt = Math.min(1, fromBack / 90);
    const mx = -sinR * EYE_R;
    const eyPanMark = -(markAmt * markAmt) * EYE_BEND_UP;
    const eyMarkRaw = eyPanMark + tiltNorm * verticalAmp;
    const eyMark = Math.min(
      EYE_MAX_DOWN_PX,
      Math.max(-EYE_MAX_UP_PX, eyMarkRaw)
    );
    const my = -(eyMark + EYE_BASE_OY_PX) + GGNR_MARK_OY_PX;
    const markScale = (1 - markAmt * 0.14) * (1 - tiltAmt * 0.1);
    const markShrink = 1 - markScale;
    const markEllipseT =
      markShrink > 0.002 ? Math.min(1, markShrink / 0.2) : 0;
    const markSx = markScale * (1 - markAmt * markEllipseT * 0.14);
    const markSy = Math.max(markScale * (1 - tiltAmt * markEllipseT * 0.3), markSx * 0.58);
    const markRot = Math.sign(sinR || 1) * markAmt * 32 * 0.18;
    this.setCss('--mw-mx', `${mx.toFixed(1)}px`);
    this.setCss('--mw-my', `${my.toFixed(1)}px`);
    this.setCss('--mw-m-sx', markSx.toFixed(2));
    this.setCss('--mw-m-sy', markSy.toFixed(2));
    this.setCss('--mw-m-rot', `${markRot.toFixed(1)}deg`);
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

    if (this.hatCylinder) {
      const showHat = this.iconMode === 'hat';
      this.hatCylinder.style.display = showHat ? '' : 'none';
      if (showHat) {
        applyHatCylinder(this.hatCylinder, computeHatCylinder(basis));
      }
    }

    if (this.catEars) {
      const showCat = this.iconMode === 'cat' || this.iconMode === 'ggnrCat';
      setCatEarsVisible(this.catEars, showCat);
      if (showCat) {
        applyCatEars(this.catEars, computeCatEars(basis));
      }
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
