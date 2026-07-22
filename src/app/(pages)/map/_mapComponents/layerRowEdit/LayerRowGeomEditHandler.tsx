"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Draw from "ol/interaction/Draw";
import DoubleClickZoom from "ol/interaction/DoubleClickZoom";
import Modify from "ol/interaction/Modify";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import WKT from "ol/format/WKT";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import { MultiPolygon, Polygon } from "ol/geom";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import { useMapContext } from "../MapContext";
import {
  GEOM_EDIT_HINT_BELOW_SEARCH_GAP,
  useSearchBarOffset,
} from "../../searchBarOffsetContext";
import { call } from "@/lib/api";
import { layerRowPanelButtonClass } from "./layerRowPanelButtonStyles";
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
    stroke: new Stroke({ color: "rgba(239, 68, 68, 0.95)", width: 2.5 }),
    fill: new Fill({ color: "rgba(239, 68, 68, 0.12)" }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: "rgba(239, 68, 68, 0.95)" }),
      stroke: new Stroke({ color: "#fff", width: 1.5 }),
    }),
  });
}

const parcelEditStyle = new Style({
  stroke: new Stroke({ color: "#1d4ed8", width: 3 }),
  fill: new Fill({ color: "rgba(29, 78, 216, 0.32)" }),
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
  reset: () => void | Promise<void>;
  deleteGeom: () => void;
  startDraw: () => void;
};

/** MapContext.layerRowGeomEdit — 지도 도형 그리기/수정 */
export function LayerRowGeomEditHandler({
  centerPixel,
}: {
  centerPixel?: { x: number; y: number } | null;
}) {
  const mapContext = useMapContext();
  const edit = mapContext?.layerRowGeomEdit ?? null;
  const setEdit = mapContext?.setLayerRowGeomEdit;
  const wktRef = mapContext?.layerRowGeomEditWktRef;
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const setLayerRowDraftParcels = mapContext?.setLayerRowDraftParcels;
  const layerRowParcelRemoveRef = mapContext?.layerRowParcelRemoveRef;
  const draftParcels = mapContext?.layerRowDraftParcels ?? [];
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const { inputBottomPx } = useSearchBarOffset();
  const hintTopPx = inputBottomPx + GEOM_EDIT_HINT_BELOW_SEARCH_GAP;
  const mapOpsRef = useRef<GeomMapOps | null>(null);
  const geomEditSourceRef = useRef<VectorSource | null>(null);
  const attachModifyRef = useRef<(() => void) | null>(null);
  const loadParcelsRef = useRef<((opts?: { silent?: boolean }) => Promise<void>) | null>(null);
  const isDrawActiveRef = useRef(false);
  const [loadingParcels, setLoadingParcels] = useState(false);
  const [uiMode, setUiMode] = useState<"draw" | "modify">("modify");
  const [hasParentGeom, setHasParentGeom] = useState(false);

  useEffect(() => {
    setUiMode(edit?.mode ?? "draw");
  }, [edit?.mode, edit?.keyValue, edit?.layerName]);

  const handleReset = useCallback(() => {
    void mapOpsRef.current?.reset();
  }, []);

  const handleDeleteGeom = useCallback(() => {
    mapOpsRef.current?.deleteGeom();
  }, []);

  const handleAddGeom = useCallback(() => {
    mapOpsRef.current?.startDraw();
  }, []);

  const loadParcelsFromParentGeom = useCallback(
    async (opts?: { silent?: boolean }) => {
      const source = geomEditSourceRef.current;
      const wktFromSource = source ? writeCombinedWkt5181FromParentFeatures(source) : null;
      const wkt = wktFromSource ?? wktRef?.current ?? null;
      if (wktFromSource && wktRef) wktRef.current = wktFromSource;
      const apply = mapContext?.layerRowParcelApplyRef?.current;
      if (!wkt || wkt === LAYER_ROW_GEOM_CLEAR_SENTINEL) {
        apply?.([], { replaceAuto: true });
        return;
      }
      if (!apply) return;

      setLoadingParcels(true);
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
        const raw = Array.isArray(data?.parcels) ? data.parcels : [];
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
      } catch {
        if (!opts?.silent) window.alert("필지목록을 불러오지 못했습니다.");
      } finally {
        setLoadingParcels(false);
      }
    },
    [mapContext?.layerRowParcelApplyRef, wktRef]
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

    const syncFromSource = () => {
      const wkt = writeCombinedWkt5181FromParentFeatures(source);
      if (wkt) {
        wktRef.current = wkt;
      } else if (wktRef.current !== LAYER_ROW_GEOM_CLEAR_SENTINEL) {
        wktRef.current = null;
      }
      setHasParentGeom(getParentFeatures(source).length > 0);
      syncDraftParcelsFromSource(source, setLayerRowDraftParcels);
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
        } else {
          replaceParentFeaturesFromWkt5181(source, String(data.wkt5181));
          wktRef.current = String(data.wkt5181);
          setHasParentGeom(true);
        }
        syncFromSource();
        attachModifyRef.current?.();
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

    const attachModify = () => {
      detachModify();
      modify = new Modify({ source });
      modify.on("modifyend", () => {
        syncFromSource();
        loadParcelsAfterDraw();
      });
      map.addInteraction(modify);
      setUiMode("modify");
    };
    attachModifyRef.current = attachModify;

    const invalidateLoad = () => {
      loadSeq += 1;
    };

    const loadParcelsAfterDraw = (attempt = 0) => {
      requestAnimationFrame(() => {
        const fn = loadParcelsRef.current;
        if (!fn) {
          if (attempt < 8) loadParcelsAfterDraw(attempt + 1);
          return;
        }
        void fn({ silent: true });
      });
    };

    const startDraw = () => {
      invalidateLoad();
      detachDraw();
      detachModify();
      draw = new Draw({ source, type: "Polygon", stopClick: true });
      draw.on("drawend", (e) => {
        markAsParentFeature(e.feature);
        syncFromSource();
        detachDraw();
        attachModify();
        loadParcelsAfterDraw();
      });
      map.addInteraction(draw);
      isDrawActiveRef.current = true;
      setUiMode("draw");
    };

    const loadModifyGeom = async (): Promise<boolean> => {
      if (edit.protoGeom) {
        const seed = String(edit.seedWkt5181 ?? wktRef?.current ?? "").trim();
        if (seed && seed !== LAYER_ROW_GEOM_CLEAR_SENTINEL) {
          replaceParentFeaturesFromWkt5181(source, seed);
          syncFromSource();
          attachModify();
          void loadParcelsRef.current?.({ silent: true });
          return true;
        }
        attachModify();
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
        attachModify();
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
      reset: async () => {
        detachDraw();
        if (edit.mode === "modify") {
          removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
          wktRef.current = null;
          await loadModifyGeom();
          return;
        }
        if (getParentFeatures(source).length === 0) return;
        removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
        wktRef.current = null;
        setHasParentGeom(false);
        mapContext?.layerRowParcelApplyRef?.current?.([], { replaceAuto: true });
        attachModify();
      },
      deleteGeom: () => {
        invalidateLoad();
        detachDraw();
        removeFeaturesByKind(source, LAYER_ROW_KIND_PARENT);
        setHasParentGeom(false);
        wktRef.current =
          edit.mode === "modify" ? LAYER_ROW_GEOM_CLEAR_SENTINEL : null;
        mapContext?.layerRowParcelApplyRef?.current?.([], { replaceAuto: true });
        attachModify();
      },
      startDraw: () => startDraw(),
    };

    void (async () => {
      if (edit.mode === "modify") {
        const loaded = await loadModifyGeom();
        if (!loaded && source.getFeatures().length > 0) attachModify();
        return;
      }
      attachModify();
    })();

    return () => {
      cancelled = true;
      if (layerRowParcelRemoveRef) layerRowParcelRemoveRef.current = null;
      dblClickZoom?.setActive(true);
      mapOpsRef.current = null;
      geomEditSourceRef.current = null;
      attachModifyRef.current = null;
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

  const showReset = edit.mode === "modify" || hasParentGeom;
  const hintText = loadingParcels
    ? "필지목록 조회 중…"
    : uiMode === "draw"
      ? "지도에서 도형을 그려 주세요."
      : hasParentGeom
        ? "도형을 수정하면 필지목록이 자동으로 갱신됩니다."
        : "도형추가 버튼으로 부모 도형을 그리세요.";

  return (
    <div
      className="pointer-events-none absolute z-[15] flex -translate-x-1/2 flex-col gap-1.5 rounded border border-red-300 bg-red-50/95 px-3 py-1.5 text-[11px] font-medium text-red-700 shadow-sm"
      style={
        centerPixel
          ? { left: centerPixel.x, top: hintTopPx }
          : { left: "50%", top: hintTopPx }
      }
    >
      <span className="whitespace-nowrap text-center">{hintText}</span>
      <div className="pointer-events-none flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className={layerRowPanelButtonClass(
            "default",
            "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100"
          )}
          disabled={uiMode === "draw"}
          onClick={handleAddGeom}
        >
          도형추가
        </button>
        {showReset && (
          <button
            type="button"
            className={layerRowPanelButtonClass(
              "default",
              "pointer-events-auto shrink-0 border-red-200 text-red-700 hover:bg-red-100"
            )}
            onClick={handleReset}
          >
            초기화
          </button>
        )}
        <button
          type="button"
          className={layerRowPanelButtonClass("danger", "pointer-events-auto shrink-0")}
          onClick={handleDeleteGeom}
        >
          도형삭제
        </button>
      </div>
    </div>
  );
}
