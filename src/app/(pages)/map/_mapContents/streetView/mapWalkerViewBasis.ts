/** 음수 수직각(위 봄) 상한 — OlMapWalker 시야점·장식 공통 */
export const WALKER_TILT_UP_CAP_DEG = -18;

/** 지면 타원 압축률 — mapWalker.css 의 --mw-ground-sy 와 반드시 같게 유지 */
export const WALKER_GROUND_SY = 0.52;

/**
 * tiltNorm(-1…+1) → 실제 머리 pitch(도, 아래 봄 +).
 * OlMapWalker 의 시야점 이동량과 같은 각도가 되도록 맞춘 값.
 *   asin(EYE_MAX_UP_PX  / 13.5) = asin(11 / 13.5)  ≈ 54.6°
 *   asin(EYE_MAX_DOWN_PX/ 13.5) = asin(5.5 / 13.5) ≈ 24.0°
 */
const HEAD_PITCH_UP_DEG = 55;
const HEAD_PITCH_DOWN_DEG = 24;

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

/** pan/tilt → 워커와 같은 front·lateral·tiltNorm */
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
