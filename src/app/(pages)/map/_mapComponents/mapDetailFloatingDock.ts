/** 상세·단면도 최소화 바 폭·하단 도킹 (UI 무관 순수 유틸) */

export const MAP_DETAIL_FLOAT_MINIMIZED_WIDTH_PX = 260
export const MAP_DETAIL_FLOAT_MINIMIZED_WIDTH = `${MAP_DETAIL_FLOAT_MINIMIZED_WIDTH_PX}px`
/** 좌우 간격 */
export const MAP_DETAIL_DOCK_GAP_PX = 5
/** 상하(줄) 간격 */
export const MAP_DETAIL_DOCK_ROW_GAP_PX = 3
export const MAP_DETAIL_DOCK_BOTTOM_PX = 10
/** 최소화 바 높이 */
export const MAP_DETAIL_DOCK_BAR_HEIGHT_PX = 36

export function computeMapDetailDockPin(opts: {
  dockIndex: number
  dockLeftStart: number
  viewportW: number
  viewportH: number
}): { top: number; left: number } {
  const slotW = MAP_DETAIL_FLOAT_MINIMIZED_WIDTH_PX + MAP_DETAIL_DOCK_GAP_PX
  const usableW = Math.max(
    slotW,
    opts.viewportW - opts.dockLeftStart - MAP_DETAIL_DOCK_GAP_PX
  )
  const cols = Math.max(1, Math.floor(usableW / slotW))
  const col = opts.dockIndex % cols
  const row = Math.floor(opts.dockIndex / cols)
  return {
    top: Math.max(
      MAP_DETAIL_DOCK_BOTTOM_PX,
      opts.viewportH -
        MAP_DETAIL_DOCK_BOTTOM_PX -
        MAP_DETAIL_DOCK_BAR_HEIGHT_PX -
        row * (MAP_DETAIL_DOCK_BAR_HEIGHT_PX + MAP_DETAIL_DOCK_ROW_GAP_PX)
    ),
    left: opts.dockLeftStart + col * slotW,
  }
}
