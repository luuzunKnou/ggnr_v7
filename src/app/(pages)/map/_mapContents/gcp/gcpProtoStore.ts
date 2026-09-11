import {
  GCP_SEED_INSPECTIONS,
  GCP_SEED_POINTS,
  type GcpInspection,
  type GcpInspectItem,
  type GcpPoint,
} from './gcpDummyData'

export const GCP_PROTO_CHANGED_EVENT = 'ggnr-gcp-proto-changed'

export type GcpCreateDraft = {
  geom5181: [number, number] | null
}

let points: GcpPoint[] = GCP_SEED_POINTS.map((p) => ({ ...p, photos: [...p.photos] }))
let inspections: GcpInspection[] = GCP_SEED_INSPECTIONS.map((row) => ({
  ...row,
  items: row.items.map((item) => ({ ...item, photos: [...item.photos] })),
}))
let createDraft: GcpCreateDraft | null = null

function notify() {
  if (typeof window === 'undefined') return
  queueMicrotask(() => window.dispatchEvent(new CustomEvent(GCP_PROTO_CHANGED_EVENT)))
}

export function getGcpPoints(): GcpPoint[] {
  return points
}

export function getGcpInspections(): GcpInspection[] {
  return inspections
}

export function getGcpPoint(id: string): GcpPoint | undefined {
  return points.find((p) => p.id === id)
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

export function addGcpPoint(input: {
  gcpnum: string
  x: number
  y: number
  z: number
  geom5181: [number, number]
  placeNote: string
  installedAt: string
  status: GcpPoint['status']
  address: string
}): string {
  const id = `gcp-${Date.now()}`
  points = [
    {
      id,
      gcpnum: input.gcpnum,
      x: input.x,
      y: input.y,
      z: input.z,
      geom5181: input.geom5181,
      placeNote: input.placeNote,
      installedAt: input.installedAt,
      status: input.status,
      address: input.address.trim() || '—',
      photos: [],
      lastInspectDate: '',
    },
    ...points,
  ]
  createDraft = null
  notify()
  return id
}

export function inspectionsForGcp(gcpId: string): GcpInspection[] {
  return inspections.filter((row) => row.items.some((item) => item.gcpId === gcpId))
}

export function updateGcpPointAttrs(
  id: string,
  patch: Pick<GcpPoint, 'placeNote' | 'status' | 'address'>
) {
  points = points.map((p) => (p.id === id ? { ...p, ...patch } : p))
  notify()
}

export function applyGcpInspection(next: GcpInspection) {
  inspections = [
    {
      ...next,
      items: next.items.map((item) => ({ ...item, photos: [] })),
    },
    ...inspections,
  ]
  const byId = new Map(next.items.map((item) => [item.gcpId, item]))
  points = points.map((p) => {
    const item = byId.get(p.id)
    if (!item) return p
    return {
      ...p,
      status: item.status,
      lastInspectDate: next.inspectDate,
      photos: item.photos.length ? [...item.photos] : p.photos,
    }
  })
  notify()
}

export function newInspectId(): string {
  return `insp-${Date.now()}`
}

export function emptyInspectItem(gcpId: string, status: GcpPoint['status']): GcpInspectItem {
  return { gcpId, status, note: '', photos: [] }
}
