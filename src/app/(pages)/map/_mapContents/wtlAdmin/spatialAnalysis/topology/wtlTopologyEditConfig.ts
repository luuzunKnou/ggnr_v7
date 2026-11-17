/**
 * 위상검증 도형·속성 수정 반영 방식
 * - request: 반영요청(메모·첨부)만 남김
 * - immediate: DB에 즉시 반영 (가능 항목)
 *
 * 환경변수 NEXT_PUBLIC_WTL_TOPO_EDIT_MODE=immediate|request
 */
export type WtlTopoEditApplyMode = 'immediate' | 'request'

export function getWtlTopoEditApplyMode(): WtlTopoEditApplyMode {
  const raw = (process.env.NEXT_PUBLIC_WTL_TOPO_EDIT_MODE ?? 'request').trim().toLowerCase()
  return raw === 'immediate' ? 'immediate' : 'request'
}

export function wtlTopoEditModeLabel(mode: WtlTopoEditApplyMode): string {
  return mode === 'immediate' ? '즉시수정' : '반영요청'
}
