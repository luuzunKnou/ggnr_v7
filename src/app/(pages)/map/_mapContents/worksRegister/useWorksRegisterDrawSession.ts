'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Draw, { createBox, type DrawEvent } from 'ol/interaction/Draw'
import Modify, { type ModifyEvent } from 'ol/interaction/Modify'
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import WKT from 'ol/format/WKT'
import { fromCircle } from 'ol/geom/Polygon'
import type Circle from 'ol/geom/Circle'
import type { Geometry } from 'ol/geom'
import { useMapContext } from '../../_mapComponents/MapContext'
import { canStartMapDrawInteraction } from '../../_mapComponents/mapDrawInteraction'
import {
  ANALYSIS_DRAW_STYLE,
  computeAreaSqmFromWkt5181,
  formatAreaSqm,
  type DrawToolbarMapAnchor,
} from '../../_mapComponents/analysisArea'
import type {
  WorksRegisterScopeOwnerPriceStat,
  WorksRegisterScopeOwnershipStat,
  WorksRegisterScopeZoneStat,
} from './worksRegisterMock'

export type WorksRegisterDrawTool = 'rectangle' | 'polygon' | 'circle'
export type WorksRegisterDrawPhase = 'drawing' | 'editing'

export type WorksRegisterScopeArea = {
  method: 'draw' | 'location'
  wkt: string
  summaryLabel: string
  areaSqm: number
  address?: string
  ownership?: string
  zoneLabel?: string
  landPrice?: number
  recommendName?: string
  parcelCount?: number
  landPriceByOwner?: WorksRegisterScopeOwnerPriceStat[]
  ownershipStats?: WorksRegisterScopeOwnershipStat[]
  zoneStats?: WorksRegisterScopeZoneStat[]
  locationLabel?: string
}

const DRAW_LAYER_Z = 870

function extentTopCenter(geom: Geometry): [number, number] {
  const ext = geom.getExtent()
  return [(ext[0] + ext[2]) / 2, ext[3]]
}

function buildToolbarAnchorFromGeom(geom: Geometry): DrawToolbarMapAnchor {
  return { topCenter: extentTopCenter(geom) }
}

function toWkt5181(geom: Geometry): string {
  const base = geom.getType() === 'Circle' ? fromCircle(geom as Circle) : geom
  const cloned = base.clone()
  cloned.transform('EPSG:3857', 'EPSG:5181')
  return new WKT().writeGeometry(cloned)
}

export function useWorksRegisterDrawSession(options?: {
  onConfirmArea?: (area: WorksRegisterScopeArea) => void
}) {
  const mapContext = useMapContext()
  const onConfirmArea = options?.onConfirmArea

  const [drawTool, setDrawTool] = useState<WorksRegisterDrawTool | null>(null)
  const [drawPhase, setDrawPhase] = useState<WorksRegisterDrawPhase>('drawing')
  const [drawToolbarAnchor, setDrawToolbarAnchor] = useState<DrawToolbarMapAnchor | null>(null)
  const [toolPickerOpen, setToolPickerOpen] = useState(false)
  const drawWktRef = useRef<string | null>(null)

  const clearDrawToolbarAnchor = useCallback(() => setDrawToolbarAnchor(null), [])

  const clearDrawSession = useCallback(() => {
    setDrawTool(null)
    setDrawPhase('drawing')
    drawWktRef.current = null
    setDrawToolbarAnchor(null)
  }, [])

  const openToolPicker = useCallback(() => {
    clearDrawSession()
    setToolPickerOpen(true)
  }, [clearDrawSession])

  const closeToolPicker = useCallback(() => setToolPickerOpen(false), [])

  const startDraw = useCallback(
    (tool: WorksRegisterDrawTool) => {
      if (!mapContext) return
      if (
        !canStartMapDrawInteraction(
          {
            measurementActive: mapContext.measurementActive,
            spatialDrawRequest: mapContext.spatialDrawRequest,
            layerRowGeomEdit: mapContext.layerRowGeomEdit,
          },
          'spatialSearch'
        )
      ) {
        return
      }
      mapContext.setSpatialDrawRequest?.(null)
      setToolPickerOpen(false)
      drawWktRef.current = null
      clearDrawToolbarAnchor()
      setDrawPhase('drawing')
      setDrawTool(tool)
    },
    [mapContext, clearDrawToolbarAnchor]
  )

  const redrawShape = useCallback(() => {
    drawWktRef.current = null
    clearDrawToolbarAnchor()
    setDrawPhase('drawing')
  }, [clearDrawToolbarAnchor])

  const cancelDraw = useCallback(() => {
    clearDrawSession()
    setToolPickerOpen(true)
  }, [clearDrawSession])

  const confirmDraw = useCallback(() => {
    const wkt = drawWktRef.current
    if (!wkt) {
      window.alert('그린 도형이 없습니다. 지도에 도형을 그려 주세요.')
      return
    }
    const areaSqm = computeAreaSqmFromWkt5181(wkt)
    onConfirmArea?.({
      method: 'draw',
      wkt,
      summaryLabel: `직접 그린 영역 · ${formatAreaSqm(areaSqm)}`,
      areaSqm,
    })
    clearDrawSession()
    setToolPickerOpen(false)
  }, [onConfirmArea, clearDrawSession])

  const attachDrawRef = useRef<((tool: WorksRegisterDrawTool) => void) | null>(null)
  const attachModifyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !drawTool) return

    const source = new VectorSource()
    const layer = new VectorLayer({ source, style: ANALYSIS_DRAW_STYLE, zIndex: DRAW_LAYER_Z })
    layer.set('worksRegisterDraw', true)
    map.addLayer(layer)

    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined
    dblClickZoom?.setActive(false)

    let draw: Draw | null = null
    let modify: Modify | null = null

    const detachDraw = () => {
      if (draw) {
        map.removeInteraction(draw)
        draw.dispose()
        draw = null
      }
    }
    const detachModify = () => {
      if (modify) {
        map.removeInteraction(modify)
        modify.dispose()
        modify = null
      }
    }

    const writeWkt = () => {
      const geom = source.getFeatures()[0]?.getGeometry()
      drawWktRef.current = geom ? toWkt5181(geom) : null
    }

    const attachDraw = (tool: WorksRegisterDrawTool) => {
      detachDraw()
      detachModify()
      source.clear()
      drawWktRef.current = null
      draw =
        tool === 'rectangle'
          ? new Draw({ source, type: 'Circle', geometryFunction: createBox(), stopClick: true })
          : tool === 'polygon'
            ? new Draw({ source, type: 'Polygon', stopClick: true })
            : new Draw({ source, type: 'Circle', stopClick: true })
      draw.on('drawstart', () => {
        source.clear()
        clearDrawToolbarAnchor()
      })
      draw.on('drawend', (e: DrawEvent) => {
        const geom = e.feature?.getGeometry()?.clone()
        if (!geom) return
        let wkt: string | null = null
        try {
          wkt = toWkt5181(geom)
        } catch {
          wkt = null
        }
        drawWktRef.current = wkt
        const anchor = buildToolbarAnchorFromGeom(geom)
        queueMicrotask(() => {
          setDrawToolbarAnchor(anchor)
          setDrawPhase('editing')
        })
      })
      map.addInteraction(draw)
    }

    const attachModify = () => {
      detachDraw()
      detachModify()
      modify = new Modify({ source })
      let anchorRaf = 0
      modify.on('modifyend', (e: ModifyEvent) => {
        writeWkt()
        const geom = e.features.getArray()[0]?.getGeometry()
        if (!geom) return
        if (anchorRaf) return
        anchorRaf = requestAnimationFrame(() => {
          anchorRaf = 0
          setDrawToolbarAnchor(buildToolbarAnchorFromGeom(geom))
        })
      })
      map.addInteraction(modify)
    }

    attachDrawRef.current = attachDraw
    attachModifyRef.current = attachModify

    return () => {
      detachDraw()
      detachModify()
      map.removeLayer(layer)
      source.clear()
      dblClickZoom?.setActive(true)
      attachDrawRef.current = null
      attachModifyRef.current = null
    }
  }, [drawTool, mapContext?.mapInstanceRef, clearDrawToolbarAnchor])

  useEffect(() => {
    if (!drawTool) return
    if (drawPhase === 'drawing') {
      attachDrawRef.current?.(drawTool)
    } else {
      attachModifyRef.current?.()
    }
  }, [drawTool, drawPhase])

  /** 폼 닫힐 때 그리기 정리 */
  useEffect(() => {
    return () => {
      clearDrawSession()
    }
  }, [clearDrawSession])

  return {
    drawTool,
    drawPhase,
    drawToolbarAnchor,
    toolPickerOpen,
    openToolPicker,
    closeToolPicker,
    startDraw,
    redrawShape,
    cancelDraw,
    confirmDraw,
    clearDrawSession,
  }
}
