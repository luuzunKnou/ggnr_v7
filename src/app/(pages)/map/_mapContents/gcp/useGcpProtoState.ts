'use client'

import { useEffect, useState } from 'react'
import {
  GCP_PROTO_CHANGED_EVENT,
  getGcpCreateDraft,
  getGcpInspections,
  getGcpPoints,
  type GcpCreateDraft,
} from './gcpProtoStore'
import type { GcpInspection, GcpPoint } from './gcpDummyData'

export function useGcpProtoState(): {
  points: GcpPoint[]
  inspections: GcpInspection[]
  createDraft: GcpCreateDraft | null
} {
  const [points, setPoints] = useState(getGcpPoints)
  const [inspections, setInspections] = useState(getGcpInspections)
  const [createDraft, setCreateDraft] = useState(getGcpCreateDraft)

  useEffect(() => {
    const sync = () => {
      setPoints([...getGcpPoints()])
      setInspections([...getGcpInspections()])
      setCreateDraft(getGcpCreateDraft())
    }
    window.addEventListener(GCP_PROTO_CHANGED_EVENT, sync)
    return () => window.removeEventListener(GCP_PROTO_CHANGED_EVENT, sync)
  }, [])

  return { points, inspections, createDraft }
}
