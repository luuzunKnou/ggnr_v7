import './mapWalkerHatCylinder.css';

/* ============================================================================
 * MapWalker 머리 위 원기둥 — 단축법(foreshortening) / 투시도법(perspective)
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
 * [기존 구현이 틀렸던 지점]
 *   윗면 단축률을 open0 = (1 + front)/2, 즉 "워커가 향한 방향(pan)" 으로 잡았다.
 *   원기둥은 축 대칭이라 고개를 안 숙이면(tilt = 0) pan 이 아무리 변해도
 *   모양이 변하면 안 된다. 실제로 단축률을 정하는 건 카메라 고도각뿐이고,
 *   pan 은 "고개를 숙였을 때 축이 기우는 방향" 으로만 개입한다.
 *   그래서 pan 구간별 leanSign / dropPan / BACK_PULL 같은 부호 뒤집기가
 *   필요했던 것이고, 구간 경계마다 형태가 튀었다.
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

/** 원기둥 실제 3D 치수(px) */
export const HAT_R = 11;
export const HAT_H0 = 5;
/** 머리 중심 → 원기둥 밑면 중심 거리(3D). 크면 모자가 더 위로 얹힌다 */
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
 * 워커 아이콘은 카메라 대비 매우 작아 실제 원근은 미미하므로 값이 크다.
 */
const CAM_DIST_PX = 420;

const perspScale = (depth: number) =>
  CAM_DIST_PX > 0 ? CAM_DIST_PX / Math.max(1, CAM_DIST_PX + depth) : 1;

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
 * 워커 시선 기저 → 원기둥 정사영 + 약한 투시.
 * 보정 상수 없이 3D 축을 직접 세우고 투영한다.
 */
export function computeHatCylinder(basis: WalkerViewBasis): HatCylinderState {
  const { sinR, cosR, headPitchDeg } = basis;

  // 1) 머리 pitch
  const th = (headPitchDeg * Math.PI) / 180;
  const st = Math.sin(th);
  const ct = Math.cos(th);

  // 2) 원기둥 축 = 머리의 up 벡터 (월드 단위벡터)
  //    정면 f = (sinψ, cosψ, 0),  up = f·sinθ + ẑ·cosθ
  //    (θ>0 = 아래 봄 → 축이 정면 쪽으로 기운다)
  const ax = sinR * st;
  const ay = cosR * st;
  const az = ct;

  // 3) 단축률 = 축·카메라방향.  tilt=0 이면 pan 과 무관하게 항상 CAM_SIN
  const vis = -CAM_COS * ay + CAM_SIN * az;

  // 4) 축의 화면 투영 m — 옆면이 뻗어 나가는 방향 (밑면 → 윗면)
  const mx = ax;
  const my = -(CAM_SIN * ay + CAM_COS * az);
  const mLen = Math.hypot(mx, my); // === sqrt(1 - vis²)

  // 5) 타원 기저.  단축(e_min)을 m̂ 에 맞춰야 파라미터 t∈(0,π) 가
  //    "윗면 쪽 반원" 이 되어 실루엣 경로가 항상 올바르게 이어진다.
  const minX = mLen > 1e-6 ? mx / mLen : 0;
  const minY = mLen > 1e-6 ? my / mLen : -1;
  const majX = minY;
  const majY = -minX;
  const rot = (Math.atan2(majY, majX) * 180) / Math.PI;

  // 6) 투시도법 — 깊이(카메라에서 먼 쪽이 +)에 따른 스케일
  const kBot = perspScale(-HAT_SEAT_R * vis);
  const kTop = perspScale(-(HAT_SEAT_R + HAT_H0) * vis);

  // 7) 중심 — 머리 구 위 축 방향으로 얹은 뒤 투영
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

export function createHatCylinder(): SVGSVGElement {
  const uid = `mwHat${(uidSeq += 1)}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'hatCylinder');
  svg.setAttribute('viewBox', '-8 -12 56 64');
  svg.setAttribute('width', '56');
  svg.setAttribute('height', '64');
  svg.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS(NS, 'defs');
  // 배럴 음영 — 장축 방향으로 좌→우. 좌표는 매 프레임 갱신
  const grad = document.createElementNS(NS, 'linearGradient');
  grad.setAttribute('id', `${uid}-side`);
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  const stops: Array<[string, string]> = [
    ['0%', '#8e1c1c'],
    ['34%', '#d13a3a'],
    ['62%', '#c62828'],
    ['100%', '#7d1616'],
  ];
  for (const [offset, color] of stops) {
    const st = document.createElementNS(NS, 'stop');
    st.setAttribute('offset', offset);
    st.setAttribute('stop-color', color);
    grad.appendChild(st);
  }
  defs.appendChild(grad);
  svg.appendChild(defs);

  const side = document.createElementNS(NS, 'path');
  side.setAttribute('class', 'hatSide');
  side.setAttribute('fill', `url(#${uid}-side)`);

  // 윗면(밝음) / 밑면 안쪽(어두움) — 한 번에 하나만 보인다
  const top = document.createElementNS(NS, 'ellipse');
  top.setAttribute('class', 'hatTop');
  top.setAttribute('fill', '#ef5350');

  const inner = document.createElementNS(NS, 'ellipse');
  inner.setAttribute('class', 'hatInner');
  inner.setAttribute('fill', '#6d1212');

  const innerRim = document.createElementNS(NS, 'ellipse');
  innerRim.setAttribute('class', 'hatInnerRim');
  innerRim.setAttribute('fill', 'none');
  innerRim.setAttribute('stroke', '#4a0c0c');
  innerRim.setAttribute('stroke-width', '0.9');

  svg.appendChild(side);
  svg.appendChild(top);
  svg.appendChild(inner);
  svg.appendChild(innerRim);
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

/**
 * 옆면 실루엣.
 * 정사영에서 원기둥 옆면의 윤곽 = 두 타원의 볼록 껍질(민코프스키 합).
 * 접선이 축 투영 m 과 평행해지는 지점 = 장축의 양 끝(장축 ⊥ m 이므로).
 * 따라서 "윗면의 +m 쪽 반원 → 직선 → 밑면의 −m 쪽 반원 → 직선" 으로 닫힌다.
 * sweep-flag 는 cross(e_maj, e_min) = +1 이므로 항상 1.
 */
function sidePath(s: HatCylinderState): string {
  const { majX, majY } = s;
  const p1x = s.tx + majX * s.rxTop;
  const p1y = s.ty + majY * s.rxTop;
  const p2x = s.tx - majX * s.rxTop;
  const p2y = s.ty - majY * s.rxTop;
  const p3x = s.bx - majX * s.rxBot;
  const p3y = s.by - majY * s.rxBot;
  const p4x = s.bx + majX * s.rxBot;
  const p4y = s.by + majY * s.rxBot;

  return (
    `M ${f(p1x)} ${f(p1y)}` +
    ` A ${f(s.rxTop)} ${f(s.ryTop)} ${f(s.rot)} 0 1 ${f(p2x)} ${f(p2y)}` +
    ` L ${f(p3x)} ${f(p3y)}` +
    ` A ${f(s.rxBot)} ${f(s.ryBot)} ${f(s.rot)} 0 1 ${f(p4x)} ${f(p4y)}` +
    ' Z'
  );
}

export function applyHatCylinder(svg: SVGSVGElement, s: HatCylinderState) {
  svg.classList.toggle('underHead', s.underHead);

  const side = svg.querySelector('.hatSide');
  const top = svg.querySelector('.hatTop');
  const inner = svg.querySelector('.hatInner');
  const innerRim = svg.querySelector('.hatInnerRim');
  const grad = svg.querySelector('linearGradient');
  if (!side || !top || !inner || !innerRim) return;

  side.setAttribute('d', sidePath(s));

  // 배럴 음영: 장축 방향을 따라 왼쪽 실루엣 → 오른쪽 실루엣
  if (grad) {
    const cx = (s.bx + s.tx) / 2;
    const cy = (s.by + s.ty) / 2;
    const r = (s.rxTop + s.rxBot) / 2;
    grad.setAttribute('x1', f(cx - s.majX * r));
    grad.setAttribute('y1', f(cy - s.majY * r));
    grad.setAttribute('x2', f(cx + s.majX * r));
    grad.setAttribute('y2', f(cy + s.majY * r));
  }

  if (s.vis >= 0) {
    // 윗면이 보임 — 밑면은 옆면에 완전히 가려진다
    top.setAttribute('visibility', 'visible');
    inner.setAttribute('visibility', 'hidden');
    innerRim.setAttribute('visibility', 'hidden');
    setEll(top, s.tx, s.ty, s.rxTop, s.ryTop, s.rot);
  } else {
    // 밑면(모자 안쪽)이 보임
    top.setAttribute('visibility', 'hidden');
    inner.setAttribute('visibility', 'visible');
    innerRim.setAttribute('visibility', 'visible');
    setEll(inner, s.bx, s.by, s.rxBot, s.ryBot, s.rot);
    setEll(innerRim, s.bx, s.by, s.rxBot * 0.93, s.ryBot * 0.93, s.rot);
  }
}
