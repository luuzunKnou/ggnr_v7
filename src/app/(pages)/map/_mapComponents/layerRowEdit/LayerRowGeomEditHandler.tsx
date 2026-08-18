"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type OlMap from "ol/Map";
import Draw from "ol/interaction/Draw";
import DoubleClickZoom from "ol/interaction/DoubleClickZoom";
import Modify from "ol/interaction/Modify";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import WKT from "ol/format/WKT";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import { MultiPolygon, Polygon } from "ol/geom";
import { createEmpty, extend as extendExtent, type Extent } from "ol/extent";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import {
  occupationFillRgba,
  occupationStrokeRgba,
} from "@/lib/occupationLayerStyle";
import { useMapContext } from "../MapContext";
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from "../../searchBarOffsetContext";
import { call } from "@/lib/api";
import {
  DrawToolbarActions,
  useDrawToolbarPosition,
  type DrawToolbarMapAnchor,
} from "../analysisArea";
import type { LayerRowParcelItem } from "./types";

const EDIT_LAYER_Z = 900;
const LAYER_ROW_KIND_KEY = "layerRowKind";
const LAYER_ROW_KIND_PARENT = "parent";
const LAYER_ROW_KIND_PARCEL = "parcel";
const PARCEL_ADDRESS_KEY = "parcelAddress";

/** 수정 모드에서 도형삭제 후 저장 전 — DB geom NULL */
export const LAYER_ROW_GEOM_CLEAR_SENTINEL = "";

function writeCombinedWkt5181FromParentFeatures(source: VectorSource): string | null {
  const parents = getParentFeatures(source);
  if (parents.length === 0) return null;

  const polygonCoords: number[][][][] = [];
  for (const feature of parents) {
    const geom = feature.getGeometry()?.clone();
    if (!geom) continue;
    geom.transform("EPSG:3857", "EPSG:5181");
    const type = geom.getType();
    if (type === "Polygon") {
      polygonCoords.push((geom as Polygon).getCoordinates());
    } else if (type === "MultiPolygon") {
      for (const coords of (geom as MultiPolygon).getCoordinates()) {
        polygonCoords.push(coords);
      }
    }
  }
  if (polygonCoords.length === 0) return null;
  if (polygonCoords.length === 1) {
    return new WKT().writeGeometry(new Polygon(polygonCoords[0]));
  }
  return new WKT().writeGeometry(new MultiPolygon(polygonCoords));
}

function getParentFeatures(source: VectorSource): Feature[] {
  return source.getFeatures().filter((f) => f.get(LAYER_ROW_KIND_KEY) === LAYER_ROW_KIND_PARENT);
}

function buildToolbarAnchorFromSource(source: VectorSource): DrawToolbarMapAnchor | null {
  const parents = getParentFeatures(source);
  if (parents.length === 0) return null;
  const extent: Extent = createEmpty();
  let has = false;
  for (const feature of parents) {
    const geom = feature.getGeometry() as Geometry | undefined;
    if (!geom) continue;
    extendExtent(extent, geom.getExtent());
    has = true;
  }
  if (!has) return null;
  return { topCenter: [(extent[0] + extent[2]) / 2, extent[3]] };
}

function buildToolbarAnchorFromGeom(geom: Geometry): DrawToolbarMapAnchor {
  const ext = geom.getExtent();
  return { topCenter: [(ext[0] + ext[2]) / 2, ext[3]] };
}

function replaceParentFeaturesFromWkt5181(source: VectorSource, wkt5181: string) {
  removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
  const format = new WKT();
  const geom = format.readGeometry(wkt5181, {
    dataProjection: "EPSG:5181",
    featureProjection: "EPSG:3857",
  });
  const feature = new Feature(geom);
  markAsParentFeature(feature);
  source.addFeature(feature);
}

function createParentEditStyle() {
  return new Style({
    stroke: new Stroke({ color: occupationStrokeRgba("parentActive"), width: 2.5 }),
    fill: new Fill({ color: occupationFillRgba("parentActive") }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: occupationFillRgba("parentActive", 0.95) }),
      stroke: new Stroke({ color: "#fff", width: 1.5 }),
    }),
  });
}

const parcelEditStyle = new Style({
  stroke: new Stroke({ color: occupationStrokeRgba("parcel"), width: 2 }),
  fill: new Fill({ color: occupationFillRgba("parcel") }),
});

const parentEditStyle = createParentEditStyle();

function layerRowGeomFeatureStyle(feature: FeatureLike) {
  return feature.get(LAYER_ROW_KIND_KEY) === LAYER_ROW_KIND_PARCEL ? parcelEditStyle : parentEditStyle;
}

function markAsParentFeature(feature: Feature) {
  feature.set(LAYER_ROW_KIND_KEY, LAYER_ROW_KIND_PARENT);
}

function removeFeaturesByKind(source: VectorSource, kind: string) {
  source
    .getFeatures()
    .filter((f) => f.get(LAYER_ROW_KIND_KEY) === kind)
    .forEach((f) => source.removeFeature(f));
}

function draftParcelsSignature(parcels: LayerRowParcelItem[]): string {
  return parcels
    .map((p) => `${p.address}|${p.geometry3857 ? "1" : "0"}|${p.showMapGeom === false ? "list" : "map"}`)
    .join("\n");
}

function shouldShowParcelOnMap(parcel: LayerRowParcelItem): boolean {
  return parcel.showMapGeom !== false;
}

function syncParcelFeatures(source: VectorSource, parcels: LayerRowParcelItem[]) {
  removeFeaturesByKind(source, LAYER_ROW_KIND_PARCEL);
  const format = new GeoJSON();
  for (const parcel of parcels) {
    if (!shouldShowParcelOnMap(parcel)) continue;
    if (!parcel.geometry3857) continue;
    try {
      const features = format.readFeatures(
        {
          type: "Feature",
          geometry: parcel.geometry3857,
          properties: { [PARCEL_ADDRESS_KEY]: parcel.address },
        },
        { dataProjection: "EPSG:3857", featureProjection: "EPSG:3857" }
      );
      for (const f of features) {
        f.set(LAYER_ROW_KIND_KEY, LAYER_ROW_KIND_PARCEL);
        f.set(PARCEL_ADDRESS_KEY, parcel.address);
      }
      source.addFeatures(features);
    } catch {
      // skip invalid geometry
    }
  }
}

function syncDraftParcelsFromSource(
  source: VectorSource,
  setDraftParcels: ((updater: (prev: LayerRowParcelItem[]) => LayerRowParcelItem[]) => void) | undefined
) {
  if (!setDraftParcels) return;
  const format = new GeoJSON();
  const updated = new Map<string, LayerRowParcelItem>();
  for (const f of source.getFeatures()) {
    if (f.get(LAYER_ROW_KIND_KEY) !== LAYER_ROW_KIND_PARCEL) continue;
    const address = String(f.get(PARCEL_ADDRESS_KEY) ?? "").trim();
    if (!address) continue;
    const geom = f.getGeometry()?.clone();
    if (!geom) continue;
    const geometry3857 = format.writeGeometryObject(geom, {
      dataProjection: "EPSG:3857",
      featureProjection: "EPSG:3857",
    }) as unknown as Record<string, unknown>;
    const ext = geom.getExtent();
    const extent3857 =
      ext.length === 4 && ext.every((v) => Number.isFinite(v))
        ? (ext as [number, number, number, number])
        : null;
    updated.set(address.toLowerCase(), {
      address,
      extent3857,
      geometry3857,
      showMapGeom: true,
    });
  }
  if (updated.size === 0) return;
  setDraftParcels((prev) =>
    prev.map((p) => {
      const next = updated.get(p.address.toLowerCase());
      if (!next || !shouldShowParcelOnMap(p)) return p;
      return { ...p, ...next, address: p.address, showMapGeom: true };
    })
  );
}

type GeomMapOps = {
  confirmApply: () => void;
  redrawShape: () => void;
  cancelDraw: () => void | Promise<void>;
  addGeom: () => void;
  modifyGeom: () => void;
  deleteGeom: () => void;
};

/** MapContext.layerRowGeomEdit — 지도 도형 그리기/수정 (변동이력 알약 툴바·적용 흐름) */
export function LayerRowGeomEditHandler({
  centerPixel,
}: {
  centerPixel?: { x: number; y: number } | null;
}) {
  const mapContext = useMapContext();
  const edit = mapContext?.layerRowGeomEdit ?? null;
  const setEdit = mapContext?.setLayerRowGeomEdit;
  const wktRef = mapContext?.layerRowGeomEditWktRef;
  const dirtyRef = mapContext?.layerRowGeomEditDirtyRef;
  const geomDrawnRef = mapContext?.layerRowGeomDrawnRef;
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const setLayerRowDraftParcels = mapContext?.setLayerRowDraftParcels;
  const layerRowParcelRemoveRef = mapContext?.layerRowParcelRemoveRef;
  const draftParcels = mapContext?.layerRowDraftParcels ?? [];
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapRef = (mapContext?.mapInstanceRef ?? { current: null }) as RefObject<OlMap | null>;
  const { inputBottomPx } = useSearchBarOffset();
  const hintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const mapOpsRef = useRef<GeomMapOps | null>(null);
  const geomEditSourceRef = useRef<VectorSource | null>(null);
  const attachModifyRef = useRef<(() => void) | null>(null);
  const loadParcelsRef = useRef<((opts?: { silent?: boolean }) => Promise<void>) | null>(null);
  const isDrawActiveRef = useRef(false);
  /** 적용 전 — 필지목록·점용장소는 «적용»에서만 반영 */
  const pendingApplyRef = useRef(true);
  const baselineWktRef = useRef<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [drawPhase, setDrawPhase] = useState<"drawing" | "editing" | "managed">("drawing");
  const [hasParentGeom, setHasParentGeom] = useState(false);
  const [toolbarAnchor, setToolbarAnchor] = useState<DrawToolbarMapAnchor | null>(null);
  const setToolbarAnchorRef = useRef(setToolbarAnchor);
  setToolbarAnchorRef.current = setToolbarAnchor;
  const drawPhaseRef = useRef(drawPhase);
  drawPhaseRef.current = drawPhase;

  const shapeToolbarActive = Boolean(edit) && drawPhase === "editing" && toolbarAnchor != null;
  const toolbarPlacement = useDrawToolbarPosition(
    mapRef,
    toolbarAnchor,
    toolbarRef,
    shapeToolbarActive
  );

  const handleConfirmApply = useCallback(() => {
    mapOpsRef.current?.confirmApply();
  }, []);

  const handleRedrawShape = useCallback(() => {
    mapOpsRef.current?.redrawShape();
  }, []);

  const handleCancelDraw = useCallback(() => {
    void mapOpsRef.current?.cancelDraw();
  }, []);

  const handleAddGeom = useCallback(() => {
    mapOpsRef.current?.addGeom();
  }, []);

  const handleModifyGeom = useCallback(() => {
    mapOpsRef.current?.modifyGeom();
  }, []);

  const handleDeleteGeom = useCallback(() => {
    mapOpsRef.current?.deleteGeom();
  }, []);

  const loadParcelsFromParentGeom = useCallback(
    async (opts?: { silent?: boolean; attempt?: number }) => {
      const source = geomEditSourceRef.current;
      const wktFromSource = source ? writeCombinedWkt5181FromParentFeatures(source) : null;
      const wkt = wktFromSource ?? wktRef?.current ?? null;
      if (wktFromSource && wktRef) wktRef.current = wktFromSource;
      const apply = mapContext?.layerRowParcelApplyRef?.current;
      if (!wkt || wkt === LAYER_ROW_GEOM_CLEAR_SENTINEL) {
        apply?.([], { replaceAuto: true });
        return;
      }
      if (!apply) {
        const attempt = opts?.attempt ?? 0;
        if (attempt < 12) {
          requestAnimationFrame(() => {
            void loadParcelsFromParentGeom({ ...opts, attempt: attempt + 1 });
          });
        }
        return;
      }

      try {
        const res = await call("", "POST", {
          service: "layerRowService",
          action: "listJijukParcelsByGeomWkt5181",
          params: { wkt5181: wkt },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          if (!opts?.silent) window.alert(String(data.error));
          return;
        }
        if (!Array.isArray(data?.parcels) || data.parcels.length === 0) {
          apply?.([], { replaceAuto: true });
          return;
        }
        const raw = data.parcels;
        const items = raw
          .map((x: Record<string, unknown>) => {
            const address = String(x?.address ?? "").trim();
            const pnu = String(x?.pnu ?? "").trim();
            const geometry3857 =
              x?.geometry3857 != null && typeof x.geometry3857 === "object"
                ? (x.geometry3857 as Record<string, unknown>)
                : null;
            const extRaw = x?.extent3857 as unknown;
            const extent3857 =
              Array.isArray(extRaw) && extRaw.length === 4 && extRaw.every((v) => Number.isFinite(Number(v)))
                ? (extRaw.map((v) => Number(v)) as [number, number, number, number])
                : null;
            if (!address && !pnu) return null;
            return {
              address: address || pnu,
              pnu: pnu || undefined,
              extent3857,
              geometry3857,
            };
          })
          .filter(
            (
              x: {
                address: string;
                pnu?: string;
                extent3857: [number, number, number, number] | null;
                geometry3857: Record<string, unknown> | null;
              } | null
            ): x is {
              address: string;
              pnu?: string;
              extent3857: [number, number, number, number] | null;
              geometry3857: Record<string, unknown> | null;
            } => x != null
          );
        apply(items, { replaceAuto: true });
        // 도형 추가 직후 notify는 필지 폴백이 비어 실패할 수 있음 → 필지 반영 후 장소 재채움
        const wktNow = String(wktRef?.current ?? "").trim();
        if (wktNow && wktNow !== LAYER_ROW_GEOM_CLEAR_SENTINEL) {
          queueMicrotask(() => {
            mapContext?.layerRowGeomDrawnRef?.current?.({
              wkt5181: wktNow,
              source: "draw",
            });
          });
        }
      } catch {
        if (!opts?.silent) window.alert("필지목록을 불러오지 못했습니다.");
      }
    },
    [mapContext?.layerRowGeomDrawnRef, mapContext?.layerRowParcelApplyRef, wktRef]
  );

  useEffect(() => {
    loadParcelsRef.current = loadParcelsFromParentGeom;
  }, [loadParcelsFromParentGeom]);

  useEffect(() => {
    if (!edit || !map || !wktRef) return;

    const layerName = edit.layerName.toLowerCase();
    setVisibleLayerNames?.((prev) => {
      if (prev.has(layerName)) return prev;
      return new Set(prev).add(layerName);
    });

    const source = new VectorSource();
    geomEditSourceRef.current = source;
    syncParcelFeatures(source, draftParcels);

    const layer = new VectorLayer({
      source,
      style: layerRowGeomFeatureStyle,
      zIndex: EDIT_LAYER_Z,
    });
    layer.set("layerRowGeomEditLayer", true);
    map.addLayer(layer);

    const dblClickZoom = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DoubleClickZoom) as DoubleClickZoom | undefined;
    dblClickZoom?.setActive(false);

    let draw: Draw | null = null;
    let modify: Modify | null = null;
    let cancelled = false;
    let loadSeq = 0;

    const syncFromSource = (opts?: { markDirty?: boolean }) => {
      const wkt = writeCombinedWkt5181FromParentFeatures(source);
      if (wkt) {
        wktRef.current = wkt;
      } else if (wktRef.current !== LAYER_ROW_GEOM_CLEAR_SENTINEL) {
        wktRef.current = null;
      }
      if (opts?.markDirty && dirtyRef) dirtyRef.current = true;
      setHasParentGeom(getParentFeatures(source).length > 0);
      syncDraftParcelsFromSource(source, setLayerRowDraftParcels);
    };

    const notifyGeomDrawn = (sourceKind: "draw" | "modify") => {
      const wkt = String(wktRef?.current ?? "").trim();
      if (!wkt || wkt === LAYER_ROW_GEOM_CLEAR_SENTINEL) return;
      const cb =
        mapContext?.layerRowGeomDrawnRef?.current ?? geomDrawnRef?.current;
      cb?.({ wkt5181: wkt, source: sourceKind });
    };

    const setPending = (next: boolean) => {
      pendingApplyRef.current = next;
    };

    const rememberBaseline = () => {
      const wkt = writeCombinedWkt5181FromParentFeatures(source);
      baselineWktRef.current = wkt;
    };

    const subtractParcelFromParentGeom = async (parcel: {
      address: string;
      pnu?: string;
      geometry3857?: Record<string, unknown> | null;
    }) => {
      const parentWkt = writeCombinedWkt5181FromParentFeatures(source);
      if (!parentWkt) return;

      const hasSubtractGeom = parcel.geometry3857 != null || String(parcel.pnu ?? "").trim();
      if (!hasSubtractGeom) return;

      try {
        const res = await call("", "POST", {
          service: "layerRowService",
          action: "subtractParcelFromParentWkt5181",
          params: {
            parentWkt5181: parentWkt,
            subtractGeoJson3857: parcel.geometry3857 ?? null,
            subtractPnu: parcel.pnu ?? null,
          },
        });
        const data = res?.data ?? res;
        if (data?.error) return;

        if (data?.cleared || !data?.wkt5181) {
          removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
          wktRef.current = edit.mode === "modify" ? LAYER_ROW_GEOM_CLEAR_SENTINEL : null;
          setHasParentGeom(false);
          setToolbarAnchorRef.current(null);
        } else {
          replaceParentFeaturesFromWkt5181(source, String(data.wkt5181));
          wktRef.current = String(data.wkt5181);
          setHasParentGeom(true);
          setToolbarAnchorRef.current(buildToolbarAnchorFromSource(source));
        }
        syncFromSource({ markDirty: true });
        if (!pendingApplyRef.current) {
          rememberBaseline();
          notifyGeomDrawn("modify");
          void loadParcelsRef.current?.({ silent: true });
          // managed 유지 — 꼭짓점 편집은 도형수정으로만
        } else {
          attachModifyRef.current?.();
        }
      } catch {
        // 필지 목록 삭제는 유지, 도형 갱신만 생략
      }
    };

    if (layerRowParcelRemoveRef) {
      layerRowParcelRemoveRef.current = subtractParcelFromParentGeom;
    }

    const detachModify = () => {
      if (modify) {
        map.removeInteraction(modify);
        modify.dispose();
        modify = null;
      }
    };

    const detachDraw = () => {
      if (draw) {
        map.removeInteraction(draw);
        draw.dispose();
        draw = null;
        isDrawActiveRef.current = false;
      }
    };

    const syncToolbarAnchor = () => {
      setToolbarAnchorRef.current(buildToolbarAnchorFromSource(source));
    };

    const clearToolbarAnchor = () => {
      setToolbarAnchorRef.current(null);
    };

    const attachModify = () => {
      detachModify();
      modify = new Modify({ source });
      let anchorRaf = 0;
      const scheduleAnchor = () => {
        if (anchorRaf) return;
        anchorRaf = requestAnimationFrame(() => {
          anchorRaf = 0;
          syncToolbarAnchor();
        });
      };
      modify.on("modifyend", () => {
        syncFromSource({ markDirty: true });
        scheduleAnchor();
        setDrawPhase("editing");
      });
      map.addInteraction(modify);
      syncToolbarAnchor();
      setDrawPhase("editing");
    };
    attachModifyRef.current = () => {
      // managed에서는 꼭짓점 수정 비활성 — 도형수정으로만 진입
      if (drawPhaseRef.current === "managed" || isDrawActiveRef.current) return;
      if (pendingApplyRef.current) attachModify();
    };

    const goManaged = () => {
      detachDraw();
      detachModify();
      setPending(false);
      syncToolbarAnchor();
      setDrawPhase("managed");
    };

    const invalidateLoad = () => {
      loadSeq += 1;
    };

    const loadParcelsAfterApply = (attempt = 0) => {
      requestAnimationFrame(() => {
        const fn = loadParcelsRef.current;
        if (!fn) {
          if (attempt < 8) loadParcelsAfterApply(attempt + 1);
          return;
        }
        void fn({ silent: true });
      });
    };

    const startDraw = (opts?: { clearParents?: boolean }) => {
      const clearParents = opts?.clearParents !== false;
      invalidateLoad();
      detachDraw();
      detachModify();
      if (clearParents) {
        removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
        if (wktRef.current !== LAYER_ROW_GEOM_CLEAR_SENTINEL) {
          wktRef.current = null;
        }
        setHasParentGeom(false);
        clearToolbarAnchor();
      }
      setPending(true);
      setDrawPhase("drawing");
      draw = new Draw({ source, type: "Polygon", stopClick: true });
      draw.on("drawend", (e) => {
        markAsParentFeature(e.feature);
        const geom = e.feature.getGeometry();
        requestAnimationFrame(() => {
          syncFromSource({ markDirty: true });
          setPending(true);
          if (geom) {
            setToolbarAnchorRef.current(
              buildToolbarAnchorFromSource(source) ?? buildToolbarAnchorFromGeom(geom)
            );
          } else {
            syncToolbarAnchor();
          }
          detachDraw();
          attachModify();
        });
      });
      map.addInteraction(draw);
      isDrawActiveRef.current = true;
    };

    const restoreBaselineOrDraw = async () => {
      const baseline = baselineWktRef.current;
      detachDraw();
      removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
      if (baseline && baseline !== LAYER_ROW_GEOM_CLEAR_SENTINEL) {
        replaceParentFeaturesFromWkt5181(source, baseline);
        syncFromSource();
        if (dirtyRef) dirtyRef.current = false;
        goManaged();
        void loadParcelsRef.current?.({ silent: true });
        return;
      }
      wktRef.current =
        edit.mode === "modify" && baseline === LAYER_ROW_GEOM_CLEAR_SENTINEL
          ? LAYER_ROW_GEOM_CLEAR_SENTINEL
          : null;
      if (dirtyRef) dirtyRef.current = false;
      setHasParentGeom(false);
      mapContext?.layerRowParcelApplyRef?.current?.([], { replaceAuto: true });
      clearToolbarAnchor();
      goManaged();
    };

    const loadModifyGeom = async (): Promise<boolean> => {
      if (edit.protoGeom) {
        const seed = String(edit.seedWkt5181 ?? wktRef?.current ?? "").trim();
        if (seed && seed !== LAYER_ROW_GEOM_CLEAR_SENTINEL) {
          replaceParentFeaturesFromWkt5181(source, seed);
          syncFromSource();
          rememberBaseline();
          setPending(false);
          goManaged();
          void loadParcelsRef.current?.({ silent: true });
          return true;
        }
        baselineWktRef.current = null;
        goManaged();
        clearToolbarAnchor();
        return true;
      }

      const seq = ++loadSeq;
      const keyValue = String(edit.keyValue ?? "").trim();
      if (!keyValue) {
        window.alert("도형을 불러올 키 정보가 없습니다.");
        setEdit?.(null);
        return false;
      }
      try {
        const res = await call("", "POST", {
          service: "layerRowService",
          action: "getTableRowGeomGeoJson3857",
          params: {
            table: edit.layerName,
            schema: edit.schema,
            keyField: edit.keyField,
            keyValue,
          },
        });
        if (cancelled || seq !== loadSeq) return false;
        const data = res?.data ?? res;
        if (data?.error) {
          window.alert(String(data.error));
          setEdit?.(null);
          return false;
        }
        if (!data?.geometry) {
          if (edit.allowEmptyGeom) {
            wktRef.current = null;
            if (dirtyRef) dirtyRef.current = false;
            setHasParentGeom(false);
            baselineWktRef.current = null;
            setPending(false);
            clearToolbarAnchor();
            goManaged();
            return true;
          }
          window.alert("DB에서 기존 도형을 찾지 못했습니다.");
          setEdit?.(null);
          return false;
        }
        const format = new GeoJSON();
        const features = format.readFeatures(
          {
            type: "FeatureCollection",
            features: [{ type: "Feature", geometry: data.geometry, properties: {} }],
          },
          { dataProjection: "EPSG:3857", featureProjection: "EPSG:3857" }
        );
        if (!features.length) {
          window.alert("도형 데이터를 해석하지 못했습니다.");
          setEdit?.(null);
          return false;
        }
        if (cancelled || seq !== loadSeq) return false;
        removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
        for (const f of features) markAsParentFeature(f);
        source.addFeatures(features);
        syncFromSource();
        if (dirtyRef) dirtyRef.current = false;
        rememberBaseline();
        setPending(false);
        goManaged();
        void loadParcelsRef.current?.({ silent: true });
        return true;
      } catch {
        if (!cancelled) {
          window.alert("DB 도형 조회에 실패했습니다.");
          setEdit?.(null);
        }
        return false;
      }
    };

    mapOpsRef.current = {
      confirmApply: () => {
        const wkt = writeCombinedWkt5181FromParentFeatures(source);
        if (!wkt) {
          window.alert("그린 도형이 없습니다. 지도에 도형을 그려 주세요.");
          return;
        }
        syncFromSource({ markDirty: true });
        setPending(false);
        rememberBaseline();
        notifyGeomDrawn("draw");
        loadParcelsAfterApply();
        goManaged();
      },
      redrawShape: () => {
        invalidateLoad();
        mapContext?.layerRowParcelApplyRef?.current?.([], { replaceAuto: true });
        if (dirtyRef) dirtyRef.current = true;
        startDraw({ clearParents: true });
      },
      cancelDraw: async () => {
        await restoreBaselineOrDraw();
      },
      addGeom: () => {
        if (dirtyRef) dirtyRef.current = true;
        startDraw({ clearParents: false });
      },
      modifyGeom: () => {
        if (getParentFeatures(source).length === 0) {
          window.alert("수정할 도형이 없습니다. 먼저 도형을 추가해 주세요.");
          return;
        }
        rememberBaseline();
        setPending(true);
        if (dirtyRef) dirtyRef.current = true;
        attachModify();
      },
      deleteGeom: () => {
        invalidateLoad();
        detachDraw();
        removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
        setHasParentGeom(false);
        wktRef.current =
          edit.mode === "modify" ? LAYER_ROW_GEOM_CLEAR_SENTINEL : null;
        if (dirtyRef) dirtyRef.current = true;
        baselineWktRef.current =
          edit.mode === "modify" ? LAYER_ROW_GEOM_CLEAR_SENTINEL : null;
        mapContext?.layerRowParcelApplyRef?.current?.([], { replaceAuto: true });
        clearToolbarAnchor();
        goManaged();
      },
    };

    void (async () => {
      baselineWktRef.current = null;
      clearToolbarAnchor();
      if (edit.mode === "modify") {
        const loaded = await loadModifyGeom();
        if (!loaded && source.getFeatures().length > 0) {
          goManaged();
        }
        return;
      }
      // 신규: 도형 없을 때 바로 그리기
      startDraw({ clearParents: true });
    })();

    return () => {
      cancelled = true;
      if (layerRowParcelRemoveRef) layerRowParcelRemoveRef.current = null;
      dblClickZoom?.setActive(true);
      mapOpsRef.current = null;
      geomEditSourceRef.current = null;
      attachModifyRef.current = null;
      clearToolbarAnchor();
      detachDraw();
      detachModify();
      map.removeLayer(layer);
      source.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, map, setEdit, setLayerRowDraftParcels, setVisibleLayerNames, wktRef]);

  useEffect(() => {
    const source = geomEditSourceRef.current;
    if (!edit || !source) return;
    syncParcelFeatures(source, draftParcels);
    if (!isDrawActiveRef.current) {
      attachModifyRef.current?.();
    }
  }, [draftParcelsSignature(draftParcels), edit]);

  if (!edit) return null;

  const toolbar = (
    <DrawToolbarActions
      drawPhase={drawPhase}
      confirmDraw={handleConfirmApply}
      redrawShape={handleRedrawShape}
      cancelDraw={handleCancelDraw}
      applyDisabled={drawPhase === "editing" && !hasParentGeom}
      addGeom={handleAddGeom}
      modifyGeom={handleModifyGeom}
      deleteGeom={handleDeleteGeom}
      showDeleteGeom={hasParentGeom || edit.mode === "modify"}
      showModifyGeom={hasParentGeom}
    />
  );

  // 그리기·적용 후(도형추가/삭제/수정) — 검색창 아래 상단 고정 (왔다갔다 최소화)
  if (drawPhase === "drawing" || drawPhase === "managed") {
    return (
      <div
        className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col items-center gap-1.5"
        style={
          centerPixel
            ? { left: centerPixel.x, top: hintTopPx }
            : { left: "50%", top: hintTopPx }
        }
      >
        {toolbar}
      </div>
    );
  }

  // 적용 전 편집 — 도형 위에 적용/다시그리기/취소
  return (
    <div
      ref={toolbarRef}
      className="pointer-events-none fixed z-[1200] flex flex-col items-start gap-1.5"
      style={
        toolbarPlacement
          ? { left: toolbarPlacement.left, top: toolbarPlacement.top }
          : centerPixel
            ? { left: centerPixel.x, top: hintTopPx, transform: "translateX(-50%)" }
            : { left: "50%", top: hintTopPx, transform: "translateX(-50%)" }
      }
    >
      {toolbar}
    </div>
  );
}
