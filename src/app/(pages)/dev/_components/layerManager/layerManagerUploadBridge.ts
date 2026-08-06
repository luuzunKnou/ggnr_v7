import type { LayerUploadDialogKind } from "./LayerManagerUploadDialogs"

type OpenUploadFn = (kind: Exclude<LayerUploadDialogKind, null>) => void

let openUpload: OpenUploadFn | null = null

export function registerLayerManagerUploadOpener(fn: OpenUploadFn) {
  openUpload = fn
  return () => {
    if (openUpload === fn) openUpload = null
  }
}

export function requestLayerManagerUpload(kind: Exclude<LayerUploadDialogKind, null>) {
  openUpload?.(kind)
}

type RefreshListMetaFn = () => void
let refreshListMeta: RefreshListMetaFn | null = null

export function registerLayerManagerListRefresh(fn: RefreshListMetaFn) {
  refreshListMeta = fn
  return () => {
    if (refreshListMeta === fn) refreshListMeta = null
  }
}

export function requestLayerManagerListRefresh() {
  refreshListMeta?.()
}

type RefreshHistoryFn = () => void
let refreshHistory: RefreshHistoryFn | null = null

export function registerShpHistoryRefresh(fn: RefreshHistoryFn) {
  refreshHistory = fn
  return () => {
    if (refreshHistory === fn) refreshHistory = null
  }
}

export function requestShpHistoryRefresh() {
  refreshHistory?.()
}

/** 레이어 설정(Layer/Field) — 업로드 후 tables.json·DB 반영을 화면이 다시 읽도록 (다중 구독) */
type RefreshDefineFn = () => void
const refreshDefineListeners = new Set<RefreshDefineFn>()

export function registerLayerManagerDefineRefresh(fn: RefreshDefineFn) {
  refreshDefineListeners.add(fn)
  return () => {
    refreshDefineListeners.delete(fn)
  }
}

export function requestLayerManagerDefineRefresh() {
  for (const fn of refreshDefineListeners) fn()
}

type RefreshExcelHistoryFn = () => void
let refreshExcelHistory: RefreshExcelHistoryFn | null = null

export function registerExcelHistoryRefresh(fn: RefreshExcelHistoryFn) {
  refreshExcelHistory = fn
  return () => {
    if (refreshExcelHistory === fn) refreshExcelHistory = null
  }
}

export function requestExcelHistoryRefresh() {
  refreshExcelHistory?.()
}

/** SHP/Excel 업로드 완료 후 목록·설정·이력 일괄 갱신 */
export function requestLayerManagerAfterUploadRefresh(kind: "shp" | "exl") {
  requestLayerManagerListRefresh()
  requestLayerManagerDefineRefresh()
  if (kind === "shp") requestShpHistoryRefresh()
  else requestExcelHistoryRefresh()
}
