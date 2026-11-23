'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { syncOdorCommDisconnectFaults } from '@/app/(pages)/map/_mapContents/odorAlert/odorAlertStore'
import {
  buildNodeViews,
  expandFilterWithAncestors,
  filterNodeViews,
} from './odorSystemStatusJudge'
import { createOdorSystemStatusGraph } from './odorSystemStatusMock'
import type { OdorCommNodeView, OdorCommStatusFilter } from './odorSystemStatusTypes'
import { ODOR_COMM_AUTO_REFRESH_MS } from './odorSystemStatusTypes'

function sensorsUnderAgency(
  all: OdorCommNodeView[],
  agencyId: string
): OdorCommNodeView[] {
  return all.filter((n) => n.kind === 'sensor' && n.parentId === agencyId)
}

export function useOdorSystemStatusModel() {
  const [tick, setTick] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [filter, setFilter] = useState<OdorCommStatusFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sensorDetailId, setSensorDetailId] = useState<string | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => setTick((t) => t + 1), ODOR_COMM_AUTO_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [autoRefresh])

  const graph = useMemo(() => createOdorSystemStatusGraph(Date.now()), [tick])
  const allViews = useMemo(() => buildNodeViews(graph), [graph])

  useEffect(() => {
    syncOdorCommDisconnectFaults(allViews)
  }, [allViews])

  const visibleViews = useMemo(() => {
    const filtered = filterNodeViews(allViews, filter)
    return expandFilterWithAncestors(allViews, filtered)
  }, [allViews, filter])

  const visibleLinks = useMemo(() => {
    const ids = new Set(visibleViews.map((v) => v.id))
    return graph.links.filter((l) => ids.has(l.fromId) && ids.has(l.toId))
  }, [graph.links, visibleViews])

  const selected = useMemo(
    () => allViews.find((v) => v.id === selectedId) ?? null,
    [allViews, selectedId]
  )

  const sensorDetail = useMemo(
    () => allViews.find((v) => v.id === sensorDetailId) ?? null,
    [allViews, sensorDetailId]
  )

  const agencySensors = useMemo(() => {
    if (!selected || selected.kind !== 'agency') return []
    return sensorsUnderAgency(allViews, selected.id)
  }, [allViews, selected])

  const disconnectSensors = useMemo(
    () => allViews.filter((v) => v.kind === 'sensor' && v.status === 'disconnect'),
    [allViews]
  )

  const selectNode = useCallback((id: string) => {
    setSelectedId(id)
    setSensorDetailId(null)
  }, [])

  const closeExpand = useCallback(() => {
    setSelectedId(null)
    setSensorDetailId(null)
  }, [])

  return {
    graph,
    allViews,
    visibleViews,
    visibleLinks,
    filter,
    setFilter,
    autoRefresh,
    setAutoRefresh,
    refresh,
    selectedId,
    selected,
    sensorDetail,
    agencySensors,
    selectNode,
    setSensorDetailId,
    closeExpand,
    expandOpen: selectedId != null,
    disconnectSensors,
    bannerDismissed,
    setBannerDismissed,
    showBanner: !bannerDismissed && disconnectSensors.length > 0,
  }
}

export type OdorSystemStatusModel = ReturnType<typeof useOdorSystemStatusModel>
