import './mapWalkerCatEars.css';
import { WALKER_GROUND_SY, type WalkerViewBasis } from './mapWalkerHatCylinder';

/* ============================================================================
 * MapWalker 고양이 귀 — 원뿔 2개 (단축법 / 투시도법)
 * ----------------------------------------------------------------------------
 * 좌표계·카메라·머리 pitch 는 mapWalkerHatCylinder 와 완전히 동일하다.
 * computeWalkerViewBasis 로 만든 같은 시선 기저를 그대로 받아 쓰므로
 * 모자·시야점·귀가 서로 어긋날 수 없다.
 *
 * [단축법 — 밑면]
 *   귀 밑면은 반지름 EAR_R 인 원이다. 정사영에서 원은
 *     장반경 = EAR_R,  단반경 = EAR_R · |축·시선|
 *   인 타원이 되고, 장축은 화면에 투영된 축에 수직이다.
 *   보정 상수가 필요 없다.
 *
 * [원뿔 실루엣 — 정확해]
 *   원뿔의 윤곽 = {꼭짓점} ∪ {밑면 원} 의 볼록 껍질.
 *   밑면 타원을 단위원으로 정규화하면 꼭짓점은 (0, d), d = L / ry 에 놓인다.
 *   (L = 화면상 밑면중심→꼭짓점 거리. 꼭짓점 오프셋은 항상 장축에 수직이다.)
 *     d ≤ 1 : 꼭짓점이 밑면 타원 안 → 귀가 카메라 정면. 실루엣 = 밑면 타원
 *     d > 1 : 접점이 t = π/2 ± α,  α = acos(1/d)
 *             실루엣 = 접선 2개 + 꼭짓점 반대편 밑면 호(장호)
 *   |vis| → 0 (정측면) 이면 α → π/2 라 삼각형,
 *   |vis| → 1 (귀가 정면) 이면 d → 0 이라 원이 된다. 분기 하나로 전부 커버된다.
 *
 * [앉힘]
 *   EAR_SEAT = √(HEAD_R² − EAR_R²) 이면 밑면 원의 모든 점이 머리 구 표면에
 *   정확히 놓인다. 즉 귀가 두개골에서 자라난 것처럼 붙고, 실루엣의 밑면 호가
 *   그대로 «귀가 머리에 붙는 선» 이 된다.
 *
 * [테두리]
 *   밑면 원은 머리 구 표면 위에 있으므로, 실루엣의 밑면 호는
 *   «귀가 머리에 붙는 이음선» 이다. 채움과 테두리는 서로 다른 path 를 쓴다.
 *     채움   = 사면 + 깎인 끝 + 밑면 호  (닫힌 도형)
 *     테두리 = 사면 + 깎인 끝            (열린 선, 수직각 0°~90°)
 *   위를 볼 때(수직각 음수) 만 접점에서 밑면 장호 쪽으로 테두리를
 *   양쪽으로 연장한다. 위 봄 정도(upAmt)·EAR_UP_BASE_STROKE_MAX 로
 *   감싸는 범위를 키우며, 선 굵기는 바꾸지 않는다.
 *   d ≤ 1 이면 실루엣 전체가 밑면 타원이라 그릴 테두리가 없다.
 *   EAR_VIS_MARGIN 으로 단축률에 상한을 둬 그 상태에 들어가지 않게 한다.
 *
 * [귀 끝]
 *   두 사면에서 같은 길이만큼 물러난 뒤 꼭짓점을 제어점으로 하는 2차 베지에로
 *   잇는다. 양 끝에서 사면과 접하므로 이음매가 매끄럽다.
 *
 * [투시도법]
 *   깊이에 따른 약한 원근. 카메라에 가까운 귀가 살짝 커진다.
 * ========================================================================== */

/** 카메라 고도각 — 모자와 같은 값을 쓴다 (mapWalker.css --mw-ground-sy) */
const CAM_SIN = WALKER_GROUND_SY;
const CAM_COS = Math.sqrt(Math.max(1e-6, 1 - CAM_SIN * CAM_SIN));

/* ---------------------------------------------------------------------------
 * 머리 기준점 (catEar SVG 유저 좌표, 1 unit = 1px) — 모자 SVG 와 동일 앵커
 *   .head   : 27×27, figure 기준 top:0 → 머리 중심 = figure(13.5, 13.5)
 *   .catEar : viewBox "-8 -12 56 64", 56×64px, top:-21px, margin-left:-28px
 * ------------------------------------------------------------------------- */
const HEAD_CX = 20;
const HEAD_CY = 22.5;
const HEAD_R = 13.5;

/** 귀 밑면 반지름(px, 3D 실치수) */
export const EAR_R = 4.4;
/** 귀 높이 — 밑면에서 꼭짓점까지(px, 3D 실치수) */
export const EAR_H = 8;
/** 밑면 원이 머리 구 표면에 정확히 놓이는 거리. 아래 봄 접힘 외에는 손대지 말 것 */
const EAR_SEAT = Math.sqrt(Math.max(0, HEAD_R * HEAD_R - EAR_R * EAR_R));

/**
 * 단축률(|vis|) 상한 — 임계값 대비 비율.
 *
 * 원뿔 반각이 카메라 방향을 삼키면(|vis| ≥ 임계) 꼭짓점이 밑면 타원 안으로
 * 들어가 실루엣이 밑면 타원 하나가 된다. 그 윤곽은 전부 이음선이라 테두리가
 * 통째로 사라진다.
 *   임계 |vis| = q / √(1 + q²),  q = 귀높이 / EAR_R
 * 수평각·수직각을 전부 훑으면 |vis| 가 0.997 까지 올라가 각도의 14% 가 이
 * 구간에 들어간다. 귀를 바늘처럼 가늘게 만들지 않는 한 기하로는 못 피한다.
 *
 * 그래서 투영에 쓰는 |vis| 를 임계의 이 비율까지만 허용한다. 상한에 걸리면
 * 귀가 실제보다 덜 누운 것처럼 그려져 최소 길이와 테두리를 지킨다. 값이
 * 이어지므로 각도를 돌려도 튀지 않고, 상한 밖에서는 원래 계산 그대로다.
 * 0.88 에서 꼭짓점거리/밑면단반경 이 최소 1.34 로 테두리가 넉넉히 남는다.
 * 1 에 가까울수록 물리적으로 정확하지만 상한 부근에서 테두리가 짧아진다.
 */
const EAR_VIS_MARGIN = 0.88;

/** 정수리에서 좌우로 벌어지는 각(도) */
const EAR_SPLAY_DEG = 28;
/** 앞쪽으로 살짝 기울이는 각(도) */
const EAR_FORWARD_DEG = 6;

/** 귀 끝 모서리 깎기 — 사면 길이 대비 물러나는 비율 */
const EAR_TIP_CUT = 0.18;

/** 안쪽 귀 — 바깥 원뿔과 축을 공유하는 작은 원뿔 (0…1, EAR_H 기준) */
const INNER_BASE_T = 0.1;
const INNER_TIP_T = 0.74;
const INNER_R_RATIO = 0.56;

/**
 * 아래를 볼 때 귀를 접는 정도.
 *
 * 머리는 고정된 원이라 아래를 봐도 실루엣이 그대로다. 그 상태에서 귀만
 * 물리대로 두면 축이 오히려 정측면에 가까워져, 수직각을 끝까지 내렸을 때
 * 화면에서 가장 길게 뻗는다. 그래서 아래를 보는 정도에 비례해 길이를 줄이고
 * 밑면을 머리 안쪽으로 당겨 «머리에 붙어 접힌» 모습으로 만든다.
 * 위를 볼 때는 0 이라 영향이 없다.
 *
 *   SHORTEN — 귀 높이를 줄이는 비율. 수직각 90°에서 35% 짧아진다.
 *   TUCK    — 밑면을 머리 중심 쪽으로 당기는 양(px). 밑면 원이 구 표면보다
 *             안으로 들어가지만 이음선에는 stroke 가 없어 티가 나지 않는다.
 */
const EAR_DOWN_SHORTEN = 0.35;
const EAR_DOWN_TUCK_PX = 2;

/**
 * 위를 볼 때 귀를 화면 아래로 더 내리는 양(px).
 *
 * 머리는 고정된 원이라 pitch 를 줘도 실루엣이 변하지 않는다. 그래서 워커가
 * 등을 보인 채(수평각 0 부근) 끝까지 위를 보면, 뒤로 누운 귀가 화면에서
 * 덜 내려와 머리 윗부분에 걸쳐 보인다. 위를 보는 정도와 등을 보이는 정도를
 * 곱해 부드럽게 더한다. 정측면·정면에서는 0 이라 기존 모습 그대로다.
 */
const EAR_UP_TILT_DROP_PX = 3;

/**
 * 위를 볼 때 밑면 장호를 테두리에 넣는 최대 비율(0…1).
 * upAmt(= −tiltNorm) 에 곱해 접점 양쪽에서 장호 쪽으로 연장한다.
 * 1 이면 양끝이 장호 가운데에서 만나 닫히므로 0.6 으로 틈을 남긴다.
 */
const EAR_UP_BASE_STROKE_MAX = 0.6;

/** 약한 투시 가상 카메라 거리(px). 0 이하면 순수 정사영 */
const CAM_DIST_PX = 420;

const perspScale = (depth: number) =>
  CAM_DIST_PX > 0 ? CAM_DIST_PX / Math.max(1, CAM_DIST_PX + depth) : 1;

/* ========================================================================== */

/** 원뿔 하나 — 밑면 중심 / 꼭짓점 / 밑면 타원 */
type ConeGeom = {
  bx: number;
  by: number;
  ax: number;
  ay: number;
  rx: number;
  ry: number;
};

export type CatEarState = {
  /** +1 = 워커 기준 오른쪽 귀, −1 = 왼쪽 귀 */
  side: 1 | -1;
  /** 귀 축 · 카메라방향. >0 이면 카메라 쪽으로 기울어 있다 */
  vis: number;
  /** 밑면 타원 장축 각도(도) — 바깥·안쪽 공용 */
  rot: number;
  /** 장축 단위벡터 */
  majX: number;
  majY: number;
  outer: ConeGeom;
  inner: ConeGeom;
  /** 밑면 중심이 머리 중심보다 뒤 → 머리 아래 레이어로 */
  underHead: boolean;
  /** 머리(2)·몸통(1) 사이에서의 최종 쌓임 순서 */
  zIndex: number;
  /** 위를 보는 정도(0…1). 0 이면 밑면 호 테두리 연장 없음 */
  upAmt: number;
};

export type CatEarsState = {
  /** 먼 귀 → 가까운 귀 순서 */
  far: CatEarState;
  near: CatEarState;
};

const SPLAY_SIN = Math.sin((EAR_SPLAY_DEG * Math.PI) / 180);
const FWD_SIN = Math.sin((EAR_FORWARD_DEG * Math.PI) / 180);
const UP_COMP = Math.sqrt(
  Math.max(0, 1 - SPLAY_SIN * SPLAY_SIN - FWD_SIN * FWD_SIN)
);

/**
 * 귀 축(월드 단위벡터).
 * 머리 국소 기저 forward / up / right 를 만든 뒤 좌우·앞으로 기울인다.
 *   forward = ( sinψ·cosθ,  cosψ·cosθ, −sinθ )
 *   up      = ( sinψ·sinθ,  cosψ·sinθ,  cosθ )   ← 모자 축과 동일
 *   right   = ( cosψ,      −sinψ,       0     )
 */
function earAxis(
  basis: WalkerViewBasis,
  side: 1 | -1
): [number, number, number] {
  const th = (basis.headPitchDeg * Math.PI) / 180;
  const st = Math.sin(th);
  const ct = Math.cos(th);
  const { sinR, cosR } = basis;

  const fx = sinR * ct;
  const fy = cosR * ct;
  const fz = -st;
  const ux = sinR * st;
  const uy = cosR * st;
  const uz = ct;
  const rx = cosR;
  const ry = -sinR;

  const s = SPLAY_SIN * side;
  return [
    s * rx + FWD_SIN * fx + UP_COMP * ux,
    s * ry + FWD_SIN * fy + UP_COMP * uy,
    FWD_SIN * fz + UP_COMP * uz,
  ];
}

function computeEar(basis: WalkerViewBasis, side: 1 | -1): CatEarState {
  const [nx, ny, nz] = earAxis(basis, side);

  // 단축률 — 축이 카메라를 향할수록 1, 시선과 직각이면 0
  const vis = -CAM_COS * ny + CAM_SIN * nz;
  // 축의 화면 투영 — 밑면중심 → 꼭짓점 방향
  const mx = nx;
  const my = -(CAM_SIN * ny + CAM_COS * nz);
  const mLen = Math.hypot(mx, my); // === √(1 − vis²)

  // 장축은 투영된 축에 수직. e_min(= m̂) 을 기준으로 잡아야
  // 접점 파라미터 t = π/2 ± α 가 그대로 성립한다.
  const minX = mLen > 1e-6 ? mx / mLen : 0;
  const minY = mLen > 1e-6 ? my / mLen : -1;
  const majX = minY;
  const majY = -minX;
  const rot = (Math.atan2(majY, majX) * 180) / Math.PI;

  // 아래 봄 보정 — 귀를 짧게 줄이고 밑면을 머리 쪽으로 당겨 접는다
  const downAmt = Math.max(0, basis.tiltNorm);
  const earH = EAR_H * (1 - EAR_DOWN_SHORTEN * downAmt);
  const seat = EAR_SEAT - EAR_DOWN_TUCK_PX * downAmt;

  // 단축률 상한 — 귀가 카메라를 정면으로 볼 때 실루엣이 밑면 타원으로
  // 무너지지 않도록, 투영에 쓰는 |vis| 와 축 길이를 함께 묶어 제한한다.
  const slender = earH / EAR_R;
  const visLimit = (EAR_VIS_MARGIN * slender) / Math.hypot(1, slender);
  const absVis = Math.min(Math.abs(vis), visLimit);
  const mLenEff = Math.sqrt(Math.max(0, 1 - absVis * absVis));
  const axX = minX * mLenEff;
  const axY = minY * mLenEff;
  // 위 봄 보정 — 바깥·안쪽 원뿔을 통째로 같은 양만큼 내려 모양은 그대로 둔다
  const dropY =
    EAR_UP_TILT_DROP_PX *
    Math.max(0, -basis.tiltNorm) *
    Math.max(0, basis.cosR);
  /** 머리 중심에서 dist 만큼 축 방향으로 간 점의 화면 좌표 + 원근 배율 */
  const at = (dist: number): [number, number, number] => {
    const k = perspScale(-dist * vis);
    return [HEAD_CX + axX * dist * k, HEAD_CY + axY * dist * k + dropY, k];
  };

  const b = at(seat);
  const a = at(seat + earH);
  const ib = at(seat + earH * INNER_BASE_T);
  const ia = at(seat + earH * INNER_TIP_T);

  const innerR = EAR_R * INNER_R_RATIO;
  const upAmt = Math.max(0, -basis.tiltNorm);

  return {
    side,
    vis,
    rot,
    majX,
    majY,
    outer: {
      bx: b[0],
      by: b[1],
      ax: a[0],
      ay: a[1],
      rx: EAR_R * b[2],
      ry: Math.max(0.02, EAR_R * absVis * b[2]),
    },
    inner: {
      bx: ib[0],
      by: ib[1],
      ax: ia[0],
      ay: ia[1],
      rx: innerR * ib[2],
      ry: Math.max(0.02, innerR * absVis * ib[2]),
    },
    underHead: vis < 0,
    zIndex: 3,
    upAmt,
  };
}

/**
 * 두 귀를 계산하고 깊이 순으로 정렬한다.
 * 귀 밑면의 깊이 = −EAR_SEAT · vis 이므로 vis 가 클수록 카메라에 가깝다.
 * pan 90°/270° 부근에서 두 귀가 화면에서 겹치므로 이 정렬이 꼭 필요하다.
 */
export function computeCatEars(basis: WalkerViewBasis): CatEarsState {
  const right = computeEar(basis, 1);
  const left = computeEar(basis, -1);
  const far = right.vis <= left.vis ? right : left;
  const near = far === right ? left : right;

  // 머리 = 2, 몸통 = 1. 뒤로 간 귀는 머리 밑, 앞의 귀는 머리 위.
  far.zIndex = far.underHead ? 0 : 3;
  near.zIndex = near.underHead ? 1 : 4;

  return { far, near };
}

/* ==========================  렌더링  ====================================== */

const NS = 'http://www.w3.org/2000/svg';

/** 귀 바깥면 — 머리(흰 바탕 + 슬레이트 그늘) 평균 톤 */
const EAR_FILL = '#eef2f7';
/** 귀 안쪽 — 바깥면보다 한 단계 어둡게 (slate-200) */
const EAR_INNER_FILL = '#e2e8f0';

export type CatEarsElements = {
  far: SVGSVGElement;
  near: SVGSVGElement;
};

function createEarSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'catEar');
  svg.setAttribute('viewBox', '-8 -12 56 64');
  svg.setAttribute('width', '56');
  svg.setAttribute('height', '64');
  svg.setAttribute('aria-hidden', 'true');

  // 단색 채움 + 외곽 stroke. 머리는 흰 바탕에 그늘이 얹혀 회색빛이라
  // 순백으로 채우면 이음선이 흰 띠로 도드라진다 → 머리 평균 톤에 맞춘다.
  const fill = document.createElementNS(NS, 'path');
  fill.setAttribute('class', 'catEarFill');
  fill.setAttribute('fill', EAR_FILL);

  const inner = document.createElementNS(NS, 'path');
  inner.setAttribute('class', 'catEarInner');
  inner.setAttribute('fill', EAR_INNER_FILL);

  const stroke = document.createElementNS(NS, 'path');
  stroke.setAttribute('class', 'catEarStroke');
  stroke.setAttribute('fill', 'none');

  svg.appendChild(fill);
  svg.appendChild(inner);
  svg.appendChild(stroke);
  return svg;
}

/** 귀 2개. 깊이가 바뀌어도 DOM 을 재배치하지 않도록 z-index 로만 정렬한다. */
export function createCatEars(): CatEarsElements {
  return { far: createEarSvg(), near: createEarSvg() };
}

const f = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0');

/** 밑면 타원만. EAR_VIS_MARGIN 덕에 정상 각도에서는 쓰이지 않는 안전망이다. */
function ellipsePaths(c: ConeGeom, rot: number): ConePaths {
  const rx = Math.max(0.05, c.rx);
  const ry = Math.max(0.02, c.ry);
  return {
    fill:
      `M ${f(c.bx - rx)} ${f(c.by)}` +
      ` A ${f(rx)} ${f(ry)} ${f(rot)} 1 0 ${f(c.bx + rx)} ${f(c.by)}` +
      ` A ${f(rx)} ${f(ry)} ${f(rot)} 1 0 ${f(c.bx - rx)} ${f(c.by)}` +
      ' Z',
    stroke: '',
  };
}

type ConePaths = {
  /** 닫힌 실루엣 — 채움용 */
  fill: string;
  /** 사면 + 깎인 끝(+ 위 봄 시 밑면 호 일부). 빈 문자열이면 그릴 테두리가 없다 */
  stroke: string;
};

/** 밑면 타원 위 점 — θ=0 은 e_maj, θ=π/2 는 꼭짓점 방향(e_min) */
function ellipsePointAt(
  c: ConeGeom,
  majX: number,
  majY: number,
  rx: number,
  ry: number,
  theta: number
): [number, number] {
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [
    c.bx + rx * ct * majX + ry * st * -majY,
    c.by + rx * ct * majY + ry * st * majX,
  ];
}

/**
 * 원뿔 실루엣.
 * 접점 T± = 밑면중심 ∓ rx·sinα·e_maj + ry·cosα·e_min   (α = acos(1/d))
 * 끝은 두 사면에서 cut 만큼 물러난 뒤 2차 베지에로 잇는다.
 * 마지막 밑면 호는 꼭짓점 반대편 장호이므로 large-arc = 1,
 * 진행이 t 감소 방향이라 sweep = 0. 이 호는 채움에 들어가고,
 * baseStrokeAmt > 0 이면 테두리에도 접점 양쪽에서 일부만 넣는다.
 */
function conePaths(
  c: ConeGeom,
  rot: number,
  majX: number,
  majY: number,
  baseStrokeAmt = 0
): ConePaths {
  const rx = Math.max(0.05, c.rx);
  const ry = Math.max(0.02, c.ry);
  const L = Math.hypot(c.ax - c.bx, c.ay - c.by);
  const d = L / ry;

  // 꼭짓점이 밑면 타원 안 → 접선이 없다. 원뿔을 축 방향에서 본 상태.
  if (!(d > 1.0001)) return ellipsePaths(c, rot);

  const alpha = Math.acos(Math.min(1, 1 / d));
  const sa = Math.sin(alpha);
  const ca = Math.cos(alpha);
  // e_min = (−majY, majX)
  const ox = majX * rx * sa;
  const oy = majY * rx * sa;
  const px = -majY * ry * ca;
  const py = majX * ry * ca;

  const t1x = c.bx - ox + px;
  const t1y = c.by - oy + py;
  const t2x = c.bx + ox + px;
  const t2y = c.by + oy + py;

  // 귀 끝 모서리 깎기
  const e1x = t1x - c.ax;
  const e1y = t1y - c.ay;
  const e2x = t2x - c.ax;
  const e2y = t2y - c.ay;
  const l1 = Math.hypot(e1x, e1y) || 1;
  const l2 = Math.hypot(e2x, e2y) || 1;
  const cut = Math.min(EAR_TIP_CUT * Math.min(l1, l2), l1 * 0.45, l2 * 0.45);
  const q1x = c.ax + (e1x / l1) * cut;
  const q1y = c.ay + (e1y / l1) * cut;
  const q2x = c.ax + (e2x / l2) * cut;
  const q2y = c.ay + (e2y / l2) * cut;

  const flanks =
    `L ${f(q1x)} ${f(q1y)}` +
    ` Q ${f(c.ax)} ${f(c.ay)} ${f(q2x)} ${f(q2y)}` +
    ` L ${f(t2x)} ${f(t2y)}`;

  const fill =
    `M ${f(t1x)} ${f(t1y)} ` +
    flanks +
    ` A ${f(rx)} ${f(ry)} ${f(rot)} 1 0 ${f(t1x)} ${f(t1y)} Z`;

  // 접점 θ = π/2 ± α. 장호는 θ 감소(sweep=0) 방향.
  const amt = Math.min(1, Math.max(0, baseStrokeAmt));
  if (!(amt > 1e-4)) {
    return { fill, stroke: `M ${f(t1x)} ${f(t1y)} ` + flanks };
  }

  const halfLong = Math.PI - alpha;
  const ext = amt * halfLong;
  const theta1 = Math.PI / 2 + alpha;
  const theta2 = Math.PI / 2 - alpha;
  const [e1xExt, e1yExt] = ellipsePointAt(c, majX, majY, rx, ry, theta1 + ext);
  const [e2xExt, e2yExt] = ellipsePointAt(c, majX, majY, rx, ry, theta2 - ext);
  const laf = ext > Math.PI ? 1 : 0;

  const stroke =
    `M ${f(e1xExt)} ${f(e1yExt)}` +
    ` A ${f(rx)} ${f(ry)} ${f(rot)} ${laf} 0 ${f(t1x)} ${f(t1y)} ` +
    flanks +
    ` A ${f(rx)} ${f(ry)} ${f(rot)} ${laf} 0 ${f(e2xExt)} ${f(e2yExt)}`;

  return { fill, stroke };
}

function applyEar(svg: SVGSVGElement, s: CatEarState) {
  svg.classList.toggle('underHead', s.underHead);
  svg.style.zIndex = String(s.zIndex);

  const fill = svg.querySelector('.catEarFill');
  const inner = svg.querySelector('.catEarInner');
  const stroke = svg.querySelector('.catEarStroke');
  if (!fill || !inner || !stroke) return;

  const baseStrokeAmt = s.upAmt * EAR_UP_BASE_STROKE_MAX;
  const outer = conePaths(s.outer, s.rot, s.majX, s.majY, baseStrokeAmt);
  fill.setAttribute('d', outer.fill);
  inner.setAttribute('d', conePaths(s.inner, s.rot, s.majX, s.majY, 0).fill);

  // 수직각 0~90°: 밑면 호 제외. 위 봄: 접점에서 밑면 장호 쪽으로 연장
  if (outer.stroke) {
    stroke.setAttribute('d', outer.stroke);
    stroke.removeAttribute('visibility');
  } else {
    stroke.setAttribute('visibility', 'hidden');
  }
}

export function applyCatEars(els: CatEarsElements, s: CatEarsState) {
  applyEar(els.far, s.far);
  applyEar(els.near, s.near);
}

/** 표시/숨김 — OlMapWalker 의 iconMode 전환용 */
export function setCatEarsVisible(els: CatEarsElements, visible: boolean) {
  const display = visible ? '' : 'none';
  els.far.style.display = display;
  els.near.style.display = display;
}
