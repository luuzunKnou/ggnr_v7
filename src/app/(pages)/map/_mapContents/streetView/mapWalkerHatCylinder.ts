import './mapWalkerHatCylinder.css';

/* ============================================================================
 * MapWalker 머리 위 빵모자 — 단축법(foreshortening) / 투시도법(perspective)
 * ----------------------------------------------------------------------------
 * [좌표계]
 *   월드 : X = 동(+), Y = 북(+), Z = 위(+)   (오른손 좌표계)
 *   카메라: 남쪽 위에서 북쪽을 내려다보는 고정 카메라(정사영)
 *           고도각 φ, sinφ = CAM_SIN  ( = mapWalker.css 의 --mw-ground-sy )
 *           시선   d = (0,  cosφ, -sinφ)
 *           카메라쪽 v = -d = (0, -cosφ,  sinφ)
 *   화면(SVG, y 는 아래로 증가)
 *           sx =   X
 *           sy = -( Y·sinφ + Z·cosφ )
 *
 * [핵심 성질]  위 2×3 행렬의 두 행은 정규직교(orthonormal)다.
 *   → 순수 정사영이므로 "반지름 R 인 원의 투영 = 타원" 이고
 *        장반경 = R,            (항상 원래 반지름 그대로)
 *        단반경 = R · |n·v|,    (n = 원의 법선)  ← 이게 단축법의 전부
 *        장축 방향 = 화면에 투영된 n 에 수직
 *   별도의 보정 상수가 필요 없다.
 *
 * [렌더] 빵모자 — 가로 중심선(챙 원의 장축)을 경계로 위아래를 따로 성형한다.
 *        위   : 돔     = 반타원 (rx × domeH)
 *        아래 : 아랫변 = 챙 원 정사영의 반쪽 (rx × brim)
 *
 *        brim = rx · |vis| 이며 이것이 단축법 그 자체다. 챙은 반지름 rx 인
 *        원이고 그 정사영은 장반경 rx / 단반경 rx·|축·시선| 인 타원이므로,
 *        아랫변의 깊이는 각도만으로 정해진다. 보정 상수가 없다.
 *          |vis| → 0 (정측면)   : 아랫변이 직선
 *          |vis| → 1 (챙이 정면): 아랫변이 반원에 가까움
 *        두 반타원은 장축 양 끝에서 접선이 축과 나란해 이음매가 매끄럽다.
 *
 *        domeH + brim = 2·ry 로 묶어 전체 높이(세로비율)는 원본 그대로 둔다.
 * ========================================================================== */

/** 음수 수직각(위 봄) 상한 — OlMapWalker TILT_UP_CAP_DEG 와 동일 */
export const WALKER_TILT_UP_CAP_DEG = -18;

/** 지면 타원 압축률 — mapWalker.css 의 --mw-ground-sy 와 반드시 같게 유지 */
export const WALKER_GROUND_SY = 0.52;

/** 카메라 고도각 sin/cos */
const CAM_SIN = WALKER_GROUND_SY;
const CAM_COS = Math.sqrt(Math.max(1e-6, 1 - CAM_SIN * CAM_SIN));

/* ---------------------------------------------------------------------------
 * 머리 기준점 (hatCylinder SVG 유저 좌표, 1 unit = 1px)
 *   .head       : 27×27, figure 기준 top:0  → 머리 중심 = figure(13.5, 13.5)
 *   .hatCylinder: viewBox "-8 -12 56 64", 56×64px, top:-21px, margin-left:-28px
 *   → 머리 중심이 유저 좌표 (20, 22.5) 에 오도록 CSS 와 맞춰 둠
 * ------------------------------------------------------------------------- */
const HEAD_CX = 20;
const HEAD_CY = 22.5;

/** 모자 실제 3D 치수(px) — 앞·뒤 높이 동일 */
export const HAT_R = 11;
export const HAT_H0 = 5;
/** 머리 중심 → 모자 밑면 중심 거리(3D). 크면 모자가 더 위로 얹힌다 */
const HAT_SEAT_R = 11.1;

/**
 * tiltNorm(-1…+1) → 실제 머리 pitch(도, 아래 봄 +).
 * OlMapWalker 의 시야점 이동량과 같은 각도가 되도록 맞춘 값.
 *   asin(EYE_MAX_UP_PX  / 13.5) = asin(11 / 13.5)  ≈ 54.6°
 *   asin(EYE_MAX_DOWN_PX/ 13.5) = asin(5.5 / 13.5) ≈ 24.0°
 */
const HEAD_PITCH_UP_DEG = 55;
const HEAD_PITCH_DOWN_DEG = 24;

/**
 * 약한 투시(weak perspective) 가상 카메라 거리(px).
 * 카메라에 가까운 면이 살짝 커진다. 0 이하로 두면 순수 정사영.
 */
const CAM_DIST_PX = 420;

const perspScale = (depth: number) =>
  CAM_DIST_PX > 0 ? CAM_DIST_PX / Math.max(1, CAM_DIST_PX + depth) : 1;

/* ---------------------------------------------------------------------------
 * 외곽 성형 — 원본 튜닝값 그대로
 * ------------------------------------------------------------------------- */
/** 캡 중심을 밑면→윗면 축의 어디에 둘지 (0 = 밑면, 1 = 윗면) */
const HAT_CAP_CENTER = 0.58;
/** 가로 반경 여유 */
const HAT_CAP_RX_GAIN = 1.06;
/** 세로 반경 산식 — 전체 높이 = 2 · ry */
const HAT_CAP_RY_DISC = 1.2;
const HAT_CAP_RY_SIDE = 0.5;
const HAT_CAP_RY_FLOOR = 0.4;
/** 아랫변이 깊어져도 돔은 이 아래로 낮아지지 않는다 (rx 배수) */
const HAT_DOME_FLOOR = 0.35;

/* ========================================================================== */

export type WalkerViewBasis = {
  pan: number;
  tilt: number;
  front: number;
  sinR: number;
  cosR: number;
  lateral: number;
  /** 워커 시야점·그림자와 동일: 위 봄 −1(상한 −18°) … 아래 봄 +1 */
  tiltNorm: number;
  tiltAmt: number;
  /** 실제 머리 pitch(도, 아래 봄 +) */
  headPitchDeg: number;
};

/** pan/tilt → 워커와 같은 front·lateral·tiltNorm (기존 필드 그대로 유지) */
export function computeWalkerViewBasis(
  panDeg: number,
  tiltDeg: number
): WalkerViewBasis {
  const pan = ((panDeg % 360) + 360) % 360;
  const tilt = Math.min(90, Math.max(-90, Number.isFinite(tiltDeg) ? tiltDeg : 0));
  const rad = (pan * Math.PI) / 180;
  const sinR = Math.sin(rad);
  const cosR = Math.cos(rad);
  const front = -cosR;
  const lateral = Math.min(1, Math.abs(sinR));

  const tiltForEye =
    tilt <= 0 ? Math.max(WALKER_TILT_UP_CAP_DEG, tilt) : Math.min(90, tilt);
  const tiltNorm =
    tilt <= 0 ? tiltForEye / -WALKER_TILT_UP_CAP_DEG : tiltForEye / 90;
  const tiltAmt = Math.abs(tiltNorm);

  const headPitchDeg =
    tiltNorm <= 0 ? tiltNorm * HEAD_PITCH_UP_DEG : tiltNorm * HEAD_PITCH_DOWN_DEG;

  return { pan, tilt, front, sinR, cosR, lateral, tiltNorm, tiltAmt, headPitchDeg };
}

export type HatCylinderState = {
  /** 밑면 중심(SVG 좌표) */
  bx: number;
  by: number;
  /** 윗면 중심(SVG 좌표) */
  tx: number;
  ty: number;
  /** 윗면 타원 장/단반경 */
  rxTop: number;
  ryTop: number;
  /** 밑면 타원 장/단반경 */
  rxBot: number;
  ryBot: number;
  /** 두 타원 공통 장축 각도(도) */
  rot: number;
  /** 축·시선 내적. >0 윗면 보임 / <0 밑면(안쪽) 보임 / 0 정측면 */
  vis: number;
  /** 밑면 중심이 머리 중심보다 뒤 → 머리 아래 레이어로 */
  underHead: boolean;
  /** 배럴 음영용 장축 단위벡터 */
  majX: number;
  majY: number;

  /** @deprecated 구버전 호환용 파생값 */
  rx: number;
  /** @deprecated */
  ry: number;
  /** @deprecated 화면상 옆면 길이 */
  H: number;
  /** @deprecated */
  ox: number;
  /** @deprecated */
  oy: number;
};

/**
 * 워커 시선 기저 → 모자 정사영 + 약한 투시.
 * 보정 상수 없이 3D 축을 직접 세우고 투영한다.
 */
export function computeHatCylinder(basis: WalkerViewBasis): HatCylinderState {
  const { sinR, cosR, headPitchDeg } = basis;

  const th = (headPitchDeg * Math.PI) / 180;
  const st = Math.sin(th);
  const ct = Math.cos(th);

  const ax = sinR * st;
  const ay = cosR * st;
  const az = ct;

  const vis = -CAM_COS * ay + CAM_SIN * az;

  const mx = ax;
  const my = -(CAM_SIN * ay + CAM_COS * az);
  const mLen = Math.hypot(mx, my);

  const minX = mLen > 1e-6 ? mx / mLen : 0;
  const minY = mLen > 1e-6 ? my / mLen : -1;
  const majX = minY;
  const majY = -minX;
  const rot = (Math.atan2(majY, majX) * 180) / Math.PI;

  const kBot = perspScale(-HAT_SEAT_R * vis);
  const kTop = perspScale(-(HAT_SEAT_R + HAT_H0) * vis);

  const bx = HEAD_CX + mx * HAT_SEAT_R * kBot;
  const by = HEAD_CY + my * HAT_SEAT_R * kBot;
  const tx = HEAD_CX + mx * (HAT_SEAT_R + HAT_H0) * kTop;
  const ty = HEAD_CY + my * (HAT_SEAT_R + HAT_H0) * kTop;

  const absVis = Math.abs(vis);
  const rxTop = HAT_R * kTop;
  const ryTop = Math.max(0.05, HAT_R * absVis * kTop);
  const rxBot = HAT_R * kBot;
  const ryBot = Math.max(0.05, HAT_R * absVis * kBot);

  return {
    bx,
    by,
    tx,
    ty,
    rxTop,
    ryTop,
    rxBot,
    ryBot,
    rot,
    vis,
    underHead: vis < 0,
    majX,
    majY,
    rx: rxTop,
    ry: ryTop,
    H: Math.hypot(tx - bx, ty - by),
    ox: bx - HEAD_CX,
    oy: by - HEAD_CY,
  };
}

/** pan/tilt 편의 래퍼 */
export function computeHatCylinderFromAngles(
  panDeg: number,
  tiltDeg: number
): HatCylinderState {
  return computeHatCylinder(computeWalkerViewBasis(panDeg, tiltDeg));
}

/* ==========================  렌더링  ====================================== */

const NS = 'http://www.w3.org/2000/svg';
let uidSeq = 0;

/** 워커 head/body 와 동일 slate (71 85 105) — 옆면 배럴 음영 */
const SIDE_SHADE_STOPS: Array<[string, string]> = [
  ['0%', 'rgb(71 85 105 / 0.2)'],
  ['28%', 'rgb(71 85 105 / 0.05)'],
  ['50%', 'rgb(71 85 105 / 0)'],
  ['72%', 'rgb(71 85 105 / 0.05)'],
  ['100%', 'rgb(71 85 105 / 0.2)'],
];

/** 워커 .head radial 과 비슷한 가장 — 가장자리만 살짝 어둡게 */
const RIM_SHADE_STOPS: Array<[string, string]> = [
  ['0%', 'rgb(71 85 105 / 0)'],
  ['40%', 'rgb(71 85 105 / 0)'],
  ['72%', 'rgb(71 85 105 / 0.05)'],
  ['100%', 'rgb(71 85 105 / 0.16)'],
];

function appendStops(grad: SVGElement, stops: Array<[string, string]>) {
  for (const [offset, color] of stops) {
    const st = document.createElementNS(NS, 'stop');
    st.setAttribute('offset', offset);
    st.setAttribute('stop-color', color);
    grad.appendChild(st);
  }
}

export function createHatCylinder(): SVGSVGElement {
  const uid = `mwHat${(uidSeq += 1)}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'hatCylinder');
  svg.setAttribute('viewBox', '-8 -12 56 64');
  svg.setAttribute('width', '56');
  svg.setAttribute('height', '64');
  svg.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS(NS, 'defs');

  const sideGrad = document.createElementNS(NS, 'linearGradient');
  sideGrad.setAttribute('id', `${uid}-side`);
  sideGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
  appendStops(sideGrad, SIDE_SHADE_STOPS);
  defs.appendChild(sideGrad);

  const rimGrad = document.createElementNS(NS, 'radialGradient');
  rimGrad.setAttribute('id', `${uid}-rim`);
  rimGrad.setAttribute('gradientUnits', 'objectBoundingBox');
  rimGrad.setAttribute('cx', '0.42');
  rimGrad.setAttribute('cy', '0.38');
  rimGrad.setAttribute('r', '0.72');
  appendStops(rimGrad, RIM_SHADE_STOPS);
  defs.appendChild(rimGrad);

  svg.appendChild(defs);

  const side = document.createElementNS(NS, 'path');
  side.setAttribute('class', 'hatSide');
  side.setAttribute('fill', '#ffffff');
  side.setAttribute('stroke', 'none');

  const sideShade = document.createElementNS(NS, 'path');
  sideShade.setAttribute('class', 'hatSideShade');
  sideShade.setAttribute('fill', `url(#${uid}-side)`);
  sideShade.setAttribute('stroke', 'none');

  const top = document.createElementNS(NS, 'ellipse');
  top.setAttribute('class', 'hatTop');
  top.setAttribute('fill', '#ffffff');
  top.setAttribute('stroke', 'none');

  const topShade = document.createElementNS(NS, 'ellipse');
  topShade.setAttribute('class', 'hatTopShade');
  topShade.setAttribute('fill', `url(#${uid}-rim)`);
  topShade.setAttribute('stroke', 'none');

  const outerStroke = document.createElementNS(NS, 'path');
  outerStroke.setAttribute('class', 'hatOuterStroke');
  outerStroke.setAttribute('fill', 'none');

  const inner = document.createElementNS(NS, 'ellipse');
  inner.setAttribute('class', 'hatInner');
  inner.setAttribute('fill', '#f1f5f9');
  inner.setAttribute('stroke', 'none');

  svg.appendChild(side);
  svg.appendChild(sideShade);
  svg.appendChild(top);
  svg.appendChild(topShade);
  svg.appendChild(inner);
  svg.appendChild(outerStroke);
  return svg;
}

const f = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0');

function setEll(
  el: Element,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number
) {
  el.setAttribute('cx', f(cx));
  el.setAttribute('cy', f(cy));
  el.setAttribute('rx', f(Math.max(0.05, rx)));
  el.setAttribute('ry', f(Math.max(0.05, ry)));
  el.setAttribute('transform', `rotate(${f(rot)} ${f(cx)} ${f(cy)})`);
}

type CapFrame = {
  cx: number;
  cy: number;
  /** 가로 반경(장축) */
  rx: number;
  /** 세로 반경 — 전체 높이는 2·ry 로 유지된다 */
  ry: number;
  rot: number;
  /** 국소 기저: u = 장축(가로), v = 축 방향(+ 가 윗면 쪽) */
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  /** 밑면→윗면 화면 거리 */
  H: number;
};

/** 모자 외곽 기준 프레임 (세로 비율은 납작화 이전값 유지). */
function capFrame(s: HatCylinderState): CapFrame {
  // e_min = 밑면→윗면. rot 이 어떤 값이든 안정적으로 얻는다.
  const vx = -s.majY;
  const vy = s.majX;
  const H = Math.hypot(s.tx - s.bx, s.ty - s.by);

  const cx = s.bx + vx * H * HAT_CAP_CENTER;
  const cy = s.by + vy * H * HAT_CAP_CENTER;

  const discR = Math.max(s.rxTop, s.rxBot);
  const discRy = Math.max(s.ryTop, s.ryBot);
  const rx = discR * HAT_CAP_RX_GAIN;
  const ry = Math.max(
    discRy * HAT_CAP_RY_DISC + H * HAT_CAP_RY_SIDE,
    rx * HAT_CAP_RY_FLOOR
  );

  return { cx, cy, rx, ry, rot: s.rot, ux: s.majX, uy: s.majY, vx, vy, H };
}

type CapSplit = {
  /** 가로 중심선 아래 = 챙 원 정사영의 단반경 */
  brim: number;
  /** 가로 중심선 위 = 돔 반타원의 높이 */
  dome: number;
  /** 캡 중심 기준, 가로 중심선의 축방향 위치 */
  v0: number;
};

/**
 * 가로 중심선 위/아래 분할.
 *
 *   brim = rx · |vis|
 *     아랫변은 챙(밑면) 원의 정사영이다. 정사영에서 원은
 *     장반경 = 반지름, 단반경 = 반지름 · |법선·시선| 인 타원이 되므로
 *     깊이가 각도만으로 결정된다. 튜닝 상수가 붙지 않는다.
 *
 *   dome = 2·ry − brim
 *     전체 높이를 원본(2·ry)에 묶어 세로비율을 보존한다.
 *     아랫변이 깊어진 만큼 돔이 낮아지고, 그 반대도 같다.
 *
 *   v0 = −(ry − brim)
 *     가로 중심선 위치. 아래 끝 = −ry, 위 끝 = +ry 로 원본과 정확히 일치.
 */
function capSplit(s: HatCylinderState, c: CapFrame): CapSplit {
  const brim = Math.max(0.05, c.rx * Math.abs(s.vis));
  const dome = Math.max(c.rx * HAT_DOME_FLOOR, c.ry * 2 - brim);
  return { brim, dome, v0: -(c.ry - brim) };
}

/**
 * 빵모자 외곽선 — 반타원 두 개.
 * 장축 양 끝에서 두 반타원 모두 접선이 축과 나란하므로 이음매가 매끄럽고,
 * 아랫변은 얕은 타원 호(◟___◞)로 떨어진다.
 * 진행 방향이 한쪽이라 두 호 모두 sweep-flag = 0.
 */
function capOutlinePath(s: HatCylinderState, c: CapFrame): string {
  const { brim, dome, v0 } = capSplit(s, c);
  const L = (u: number, v: number): [number, number] => [
    c.cx + u * c.ux + v * c.vx,
    c.cy + u * c.uy + v * c.vy,
  ];
  const a = L(-c.rx, v0);
  const b = L(c.rx, v0);

  return (
    `M ${f(a[0])} ${f(a[1])}` +
    ` A ${f(c.rx)} ${f(dome)} ${f(c.rot)} 0 0 ${f(b[0])} ${f(b[1])}` +
    ` A ${f(c.rx)} ${f(brim)} ${f(c.rot)} 0 0 ${f(a[0])} ${f(a[1])}` +
    ' Z'
  );
}

export function applyHatCylinder(svg: SVGSVGElement, s: HatCylinderState) {
  svg.classList.toggle('underHead', s.underHead);

  const side = svg.querySelector('.hatSide');
  const sideShade = svg.querySelector('.hatSideShade');
  const top = svg.querySelector('.hatTop');
  const topShade = svg.querySelector('.hatTopShade');
  const inner = svg.querySelector('.hatInner');
  const outerStroke = svg.querySelector('.hatOuterStroke');
  const sideGrad = svg.querySelector('linearGradient');
  if (!side || !sideShade || !top || !topShade || !inner || !outerStroke) return;

  const cap = capFrame(s);
  const d = capOutlinePath(s, cap);
  side.setAttribute('d', d);
  sideShade.setAttribute('d', d);
  outerStroke.setAttribute('d', d);
  side.setAttribute('stroke', 'none');

  // 원기둥 배럴과 동일: 장축 방향으로 좌↔우 음영 (워커 slate 톤)
  if (sideGrad) {
    sideGrad.setAttribute('x1', f(cap.cx - s.majX * cap.rx));
    sideGrad.setAttribute('y1', f(cap.cy - s.majY * cap.rx));
    sideGrad.setAttribute('x2', f(cap.cx + s.majX * cap.rx));
    sideGrad.setAttribute('y2', f(cap.cy + s.majY * cap.rx));
  }

  if (s.vis >= 0) {
    top.setAttribute('visibility', 'visible');
    topShade.setAttribute('visibility', 'visible');
    inner.setAttribute('visibility', 'hidden');
    const lift = cap.H * 0.12;
    const tcx = cap.cx + cap.vx * lift;
    const tcy = cap.cy + cap.vy * lift;
    const topRx = Math.min(cap.rx * 0.92, s.rxTop * 1.08);
    const topRy = Math.min(cap.ry * 0.72, Math.max(s.ryTop * 1.2, cap.ry * 0.45));
    setEll(top, tcx, tcy, topRx, topRy, s.rot);
    setEll(topShade, tcx, tcy, topRx, topRy, s.rot);
  } else {
    top.setAttribute('visibility', 'hidden');
    topShade.setAttribute('visibility', 'hidden');
    inner.setAttribute('visibility', 'visible');
    setEll(inner, s.bx, s.by, s.rxBot, s.ryBot, s.rot);
  }
}
