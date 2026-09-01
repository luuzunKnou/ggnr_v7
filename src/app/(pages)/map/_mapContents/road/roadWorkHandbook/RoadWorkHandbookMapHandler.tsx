"use client"

import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import Draw, { type DrawEvent } from "ol/interaction/Draw"
import DoubleClickZoom from "ol/interaction/DoubleClickZoom"
import VectorLayer from "ol/layer/Vector"
import VectorSource from "ol/source/Vector"
import { LineString, Polygon, type Geometry } from "ol/geom"
import { getArea, getLength } from "ol/sphere"
import { transform } from "ol/proj"
import type { FeatureLike } from "ol/Feature"
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style"
import { DrawToolbarActions } from "../../../_mapComponents/analysisArea"
import { useMapContext } from "../../../_mapComponents/MapContext"
import { canStartMapDrawInteraction } from "../../../_mapComponents/mapDrawInteraction"
import { useMapVisualCenterPixel } from "../../../_mapComponents/hooks/useMapVisualCenterPixel"
import { GEOM_EDIT_HINT_BELOW_SEARCH_GAP, useSearchBarOffset } from "../../../searchBarOffsetContext"
import { useHandbookMapPick } from "./roadWorkHandbookMapContext"

const OVERLAY_Z = 865

const pillShell =
  "pointer-events-auto flex max-w-[min(100vw-16px,560px)] flex-wrap items-center gap-1.5 rounded-full border border-border bg-background/95 px-2 py-2 text-foreground shadow-lg backdrop-blur"

const managedBtn =
  "cursor-pointer rounded-full bg-muted px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground sm:text-sm"

const VERTEX_IMAGE = new CircleStyle({
  radius: 5,
  fill: new Fill({ color: "#2563eb" }),
  stroke: new Stroke({ color: "#fff", width: 1.5 }),
})

const LINE_STYLE = new Style({
  stroke: new Stroke({ color: "#2563eb", width: 3 }),
})

const POLY_STYLE = new Style({
  fill: new Fill({ color: "rgba(37, 99, 235, 0.16)" }),
  stroke: new Stroke({ color: "#2563eb", width: 2 }),
})

function overlayStyle(feature: FeatureLike) {
  return feature.get("handbookKind") === "polygon" ? POLY_STYLE : LINE_STYLE
}

/** 그리기 중 — 꼭짓점·커서 점이 구간과 같이 따라오게 */
function sketchStyle(kind: "line" | "polygon") {
  return new Style({
    fill: kind === "polygon" ? new Fill({ color: "rgba(37, 99, 235, 0.16)" }) : undefined,
    stroke: new Stroke({ color: "#2563eb", width: kind === "polygon" ? 2 : 3 }),
    image: VERTEX_IMAGE,
  })
}

function lengthKm(geom: Geometry, viewProj: string): number {
  if (geom.getType() !== "LineString") return 0
  const coords4326 = (geom as LineString)
    .getCoordinates()
    .map((c) => transform(c, viewProj, "EPSG:4326"))
  if (coords4326.length < 2) return 0
  return getLength(new LineString(coords4326), { projection: "EPSG:4326" }) / 1000
}

function areaSqm(geom: Geometry, viewProj: string): number {
  if (geom.getType() !== "Polygon") return 0
  return getArea(geom as Polygon, { projection: viewProj })
}

function formatKm(km: number): string {
  if (!Number.isFinite(km) || km <= 0) return ""
  return (Math.round(km * 100) / 100).toFixed(2)
}

function formatSqm(sqm: number): string {
  if (!Number.isFinite(sqm) || sqm <= 0) return ""
  return String(Math.round(sqm))
}

export function RoadWorkHandbookMapHandler() {
  const mapContext = useMapContext()
  const pick = useHandbookMapPick()
  const { inputBottomPx } = useSearchBarOffset()
  const sourceRef = useRef<VectorSource | null>(null)
  const finishPickRef = useRef(pick?.finishPick)
  const cancelPickRef = useRef(pick?.cancelPick)
  finishPickRef.current = pick?.finishPick
  cancelPickRef.current = pick?.cancelPick

  const mapInstanceRef = mapContext?.mapInstanceRef
  const mapReady = mapContext?.mapReady
  const paddingLeft = mapContext?.mapPaddingLeft ?? 0
  const sessionKey = pick?.sessionKey
  const activePick = pick?.activePick ?? null
  const clearTick = pick?.clearTick ?? 0
  const pendingClearKey = pick?.pendingClearKey ?? null
  const hintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP
  const centerPixel = useMapVisualCenterPixel(
    mapReady ? (mapInstanceRef?.current ?? null) : null,
    Boolean(mapReady),
    paddingLeft
  )

  useEffect(() => {
    const map = mapInstanceRef?.current
    if (!map || !mapReady) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: overlayStyle,
      zIndex: OVERLAY_Z,
    })
    layer.set("roadWorkHandbookOverlay", true)
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      sourceRef.current = null
    }
  }, [mapInstanceRef, mapReady])

  useEffect(() => {
    sourceRef.current?.clear()
  }, [sessionKey])

  useEffect(() => {
    if (clearTick === 0) return
    const source = sourceRef.current
    if (!source) return
    if (pendingClearKey == null) {
      source.clear()
      return
    }
    source.getFeatures().forEach((f) => {
      if (f.get("fieldKey") === pendingClearKey) source.removeFeature(f)
    })
  }, [clearTick, pendingClearKey])

  useEffect(() => {
    const map = mapInstanceRef?.current
    if (!map || !activePick) return

    if (!canStartMapDrawInteraction(mapContext, "spatialSearch")) {
      cancelPickRef.current?.()
      return
    }
    mapContext?.clearMapDrawInteractionsRef.current?.()

    const source = sourceRef.current
    if (!source) {
      cancelPickRef.current?.()
      return
    }

    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined
    dblClickZoom?.setActive(false)

    const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857"
    const parked = source.getFeatures().filter((f) => f.get("fieldKey") === activePick.fieldKey)
    parked.forEach((f) => source.removeFeature(f))

    const draw = new Draw({
      source,
      type: activePick.kind === "polygon" ? "Polygon" : "LineString",
      stopClick: true,
      style: sketchStyle(activePick.kind),
    })

    let committed = false

    const restoreParked = () => {
      parked.forEach((f) => {
        if (!source.getFeatures().includes(f)) source.addFeature(f)
      })
    }

    const onEnd = (e: DrawEvent) => {
      const geom = e.feature?.getGeometry()
      if (!geom) return
      e.feature.set("fieldKey", activePick.fieldKey)
      e.feature.set("handbookKind", activePick.kind === "polygon" ? "polygon" : "line")

      const apply = () => {
        if (activePick.kind === "line") {
          const km = formatKm(lengthKm(geom, viewProj))
          if (!km) {
            source.removeFeature(e.feature)
            cancelPickRef.current?.()
            return
          }
          committed = true
          finishPickRef.current?.(km, `지도 구간 ${km}km를 ${activePick.label}에 넣었습니다.`)
        } else {
          const sqm = formatSqm(areaSqm(geom, viewProj))
          if (!sqm) {
            source.removeFeature(e.feature)
            cancelPickRef.current?.()
            return
          }
          committed = true
          finishPickRef.current?.(
            sqm,
            `지도 범위 ${Number(sqm).toLocaleString("ko-KR")}㎡를 ${activePick.label}에 넣었습니다.`
          )
        }
      }
      queueMicrotask(apply)
    }

    draw.on("drawend", onEnd)
    map.addInteraction(draw)

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return
      cancelPickRef.current?.()
    }
    window.addEventListener("keydown", onKey)

    return () => {
      window.removeEventListener("keydown", onKey)
      map.removeInteraction(draw)
      draw.dispose()
      dblClickZoom?.setActive(true)
      if (!committed) restoreParked()
    }
  }, [mapContext, mapInstanceRef, activePick])

  const showDrawing = Boolean(activePick)
  const showManaged = !activePick && (pick?.drawnFieldKeys.length ?? 0) > 0

  if ((!showDrawing && !showManaged) || typeof document === "undefined") return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[15] flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={{
        left: centerPixel?.x ?? "50%",
        top: hintTopPx,
      }}
    >
      {showDrawing ? (
        <DrawToolbarActions
          drawPhase="drawing"
          confirmDraw={() => {}}
          redrawShape={() => {}}
          cancelDraw={() => cancelPickRef.current?.()}
        />
      ) : (
        <div className={pillShell}>
          {pick?.lastDrawn ? (
            <button type="button" title="다시 그리기" aria-label="다시 그리기" className={managedBtn} onClick={() => pick.redrawLast()}>
              다시 그리기
            </button>
          ) : null}
          <button type="button" title="도형삭제" aria-label="도형삭제" className={managedBtn} onClick={() => pick?.clearDrawn()}>
            도형삭제
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}
