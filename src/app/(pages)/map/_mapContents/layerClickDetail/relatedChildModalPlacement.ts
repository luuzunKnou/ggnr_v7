/** 현황 행 상세 플로팅 폭 — WtlFacilityRelatedDetailFloating 과 동일 */
export const RELATED_CHILD_MODAL_WIDTH_PX = 420

const EDGE_PAD = 8
const GAP = 8

/**
 * 지도 기본 모달(부모) 기준 — 가능하면 좌측, 좌측 공간 부족 시 위.
 * 반환값은 자식 모달 좌상단(viewport).
 */
export function computeRelatedChildModalBesideParent(
  parent: DOMRect,
  childW: number = RELATED_CHILD_MODAL_WIDTH_PX,
  childH: number = Math.min(
    typeof window !== 'undefined' ? window.innerHeight * 0.7 : 480,
    480
  )
): { top: number; left: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : parent.right
  const vh = typeof window !== 'undefined' ? window.innerHeight : parent.bottom
  const spaceLeft = parent.left - EDGE_PAD
  const preferLeft = spaceLeft >= childW + GAP

  let left: number
  let top: number
  if (preferLeft) {
    left = parent.left - childW - GAP
    top = parent.top
  } else {
    left = parent.left
    top = parent.top - childH - GAP
  }

  const maxLeft = Math.max(EDGE_PAD, vw - childW - EDGE_PAD)
  const maxTop = Math.max(EDGE_PAD, vh - childH - EDGE_PAD)
  return {
    left: Math.min(maxLeft, Math.max(EDGE_PAD, left)),
    top: Math.min(maxTop, Math.max(EDGE_PAD, top)),
  }
}
