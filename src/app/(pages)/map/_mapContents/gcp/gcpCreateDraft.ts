export type GcpCreateDraft = {
  geom5181: [number, number] | null
}

export const GCP_CREATE_DRAFT_EVENT = 'ggnr-gcp-create-draft'

let createDraft: GcpCreateDraft | null = null

function notify() {
  if (typeof window === 'undefined') return
  queueMicrotask(() => window.dispatchEvent(new CustomEvent(GCP_CREATE_DRAFT_EVENT)))
}

export function getGcpCreateDraft(): GcpCreateDraft | null {
  return createDraft
}

export function startGcpCreate() {
  createDraft = { geom5181: null }
  notify()
}

export function setGcpCreateGeom(coord: [number, number] | null) {
  if (!createDraft) createDraft = { geom5181: coord }
  else createDraft = { geom5181: coord }
  notify()
}

export function clearGcpCreate() {
  if (!createDraft) return
  createDraft = null
  notify()
}
