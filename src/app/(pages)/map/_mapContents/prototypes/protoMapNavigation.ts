'use client'

import type Map from 'ol/Map'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import type { ProtoLedgerRow } from './dummyData'

export function flyToProtoLedger(
  map: Map | null | undefined,
  ledger: ProtoLedgerRow | null | undefined,
  applyMapViewPadding?: (() => void) | null
): boolean {
  if (!map || !ledger?.extent3857) return false
  scheduleFitMapToExtent3857(map, ledger.extent3857, {
    maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
    applyMapViewPadding: applyMapViewPadding ?? undefined,
  })
  return true
}
