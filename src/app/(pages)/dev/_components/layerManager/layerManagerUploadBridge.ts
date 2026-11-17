import type { LayerUploadDialogKind } from "./LayerManagerUploadDialogs"
import { invalidateLayerManagerListCache } from "./layerManagerListCache"

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
  invalidateLayerManagerListCache()
  refreshListMeta?.()
}

type RefreshHistoryFn = () => void
let refreshHistory: RefreshHistoryFn | null = null

/** 완료 처리 중에는 목록을 그리지 않고, 건수 반영 뒤에 한 번만 다시 읽는다. */
let shpHistoryHoldCount = 0
const shpHistoryHoldListeners = new Set<() => void>()

export function isShpHistoryListHeld() {
  return shpHistoryHoldCount > 0
}

export function registerShpHistoryHoldChange(fn: () => void) {
  shpHistoryHoldListeners.add(fn)
  return () => {
    shpHistoryHoldListeners.delete(fn)
  }
}

function notifyShpHistoryHold() {
  for (const fn of shpHistoryHoldListeners) fn()
}

export function beginShpHistoryListHold() {
  shpHistoryHoldCount += 1
  notifyShpHistoryHold()
}

export function endShpHistoryListHold() {
  if (shpHistoryHoldCount === 0) return
  shpHistoryHoldCount -= 1
  notifyShpHistoryHold()
  if (shpHistoryHoldCount === 0) requestShpHistoryRefresh()
}

export function registerShpHistoryRefresh(fn: RefreshHistoryFn) {
  refreshHistory = fn
  return () => {
    if (refreshHistory === fn) refreshHistory = null
  }
}

export function requestShpHistoryRefresh() {
  if (shpHistoryHoldCount > 0) return
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
  invalidateLayerManagerListCache()
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
