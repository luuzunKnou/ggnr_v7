import type { CSSProperties } from 'react'

/**
 * standard-map-float-surface 의 opacity-90 과 동일 기준값.
 * 표면 utility 불투명도를 헤더·본문으로 나눠 쓰기 위해 사용.
 */
export const ODOR_MAP_FLOAT_SURFACE_OPACITY = 0.9

/**
 * 헤더 불투명도 = 표면 × ratio (최대 1).
 * 1 = 표면과 동일, 1.11 ≈ 10%↑(완전 불투명에 근접).
 */
export const ODOR_MAP_FLOAT_HEADER_OPACITY_RATIO = 1

/** utility `opacity-90` 무력화 — 헤더/본문 opacity를 각각 제어하기 위함 */
export const ODOR_MAP_FLOAT_SURFACE_OPACITY_RESET_CLASS = 'opacity-100!'

export function odorMapFloatHeaderOpacityStyle(): CSSProperties {
  return {
    opacity: Math.min(
      1,
      ODOR_MAP_FLOAT_SURFACE_OPACITY * ODOR_MAP_FLOAT_HEADER_OPACITY_RATIO
    ),
  }
}

export function odorMapFloatBodyOpacityStyle(): CSSProperties {
  return { opacity: ODOR_MAP_FLOAT_SURFACE_OPACITY }
}
