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
