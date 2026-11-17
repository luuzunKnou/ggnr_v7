"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Feature from "ol/Feature";
import { LineString, Point } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import ImageLayer from "ol/layer/Image";
import ImageWMS from "ol/source/ImageWMS";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import { toLonLat } from "ol/proj";
import { getGeoServerBase } from "@/lib/geoserverUrl";
import { WORKSPACE } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { getAddressFromCoord } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import {
  buildSegmentsFromCenterPath,
  type BuiltSegmentDrawResult,
} from "./bikeRoadSegmentGeom";
import {
  loadBikeRoadNetByBbox,
  netPath,
  projectOnNet,
  snapTolM,
  type BikeRoadNet,
  type Pt,
  type RoadNetHit,
  ROAD_LAYER,
} from "./bikeRoadRoadNet";

export type BikeRoadDrawSideMode = "both" | "one";

export type BikeRoadSegmentDrawState = {
  active: boolean;
  mode: BikeRoadDrawSideMode | null;
  pointCount: number;
  busy: boolean;
  notice: string | null;
};

type Options = {
  /** 그리기 활성 (수정 중 + 측 선택 후) */
  active: boolean;
  mode: BikeRoadDrawSideMode | null;
  routePrefix: string;
  nextIndex1: number;
  onComplete: (result: BuiltSegmentDrawResult) => void;
  onCancel: () => void;
};

const PREVIEW_Z = 920;
const ROAD_PREVIEW_Z = 410;

/**
 * 도로구간 네트워크 위 다점 경로 그리기.
 * 클릭 → 스냅 → 직전 점과 netPath 이어붙이기.
 */
export function useBikeRoadSegmentDraw({
  active,
  mode,
  routePrefix,
  nextIndex1,
  onComplete,
  onCancel,
}: Options) {
  const mapContext = useMapContext();
  const map = mapContext?.mapInstanceRef?.current ?? null;
  const mapReady = mapContext?.mapReady;

  const [pointCount, setPointCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);

  const netRef = useRef<BikeRoadNet | null>(null);
  const hitsRef = useRef<RoadNetHit[]>([]);
  const path3857Ref = useRef<Pt[]>([]);
  const previewSourceRef = useRef<VectorSource | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onCancelRef = useRef(onCancel);
  const modeRef = useRef(mode);
  const prefixRef = useRef(routePrefix);
  const indexRef = useRef(nextIndex1);

  onCompleteRef.current = onComplete;
  onCancelRef.current = onCancel;
  modeRef.current = mode;
  prefixRef.current = routePrefix;
  indexRef.current = nextIndex1;

  const refreshPreview = useCallback(() => {
    const source = previewSourceRef.current;
    if (!source) return;
    source.clear();
    const path = path3857Ref.current;
    if (path.length >= 2) {
      source.addFeature(new Feature({ geometry: new LineString(path) }));
    }
    for (const hit of hitsRef.current) {
      source.addFeature(
        new Feature({
          geometry: new Point(hit.point),
          role: "vertex",
        })
      );
    }
  }, []);

  const resetDraw = useCallback(() => {
    hitsRef.current = [];
    path3857Ref.current = [];
    setPointCount(0);
    setNotice(null);
    refreshPreview();
  }, [refreshPreview]);

  const undoLast = useCallback(() => {
    if (hitsRef.current.length === 0) return;
    hitsRef.current = hitsRef.current.slice(0, -1);
    if (hitsRef.current.length === 0) {
      path3857Ref.current = [];
    } else if (hitsRef.current.length === 1) {
      path3857Ref.current = [hitsRef.current[0]!.point];
    } else {
      // 재계산
      const net = netRef.current;
      if (!net) return;
      let path: Pt[] = [hitsRef.current[0]!.point];
      for (let i = 1; i < hitsRef.current.length; i++) {
        const seg = netPath(net, hitsRef.current[i - 1]!, hitsRef.current[i]!);
        if (!seg || seg.length < 2) {
          setNotice("경로를 다시 이을 수 없습니다. 점을 다시 찍어 주세요.");
          return;
        }
        path = [...path, ...seg.slice(1)];
      }
      path3857Ref.current = path;
    }
    setPointCount(hitsRef.current.length);
    setNotice(null);
    refreshPreview();
  }, [refreshPreview]);

  const finish = useCallback(async () => {
    const path = path3857Ref.current;
    const hits = hitsRef.current;
    const sideMode = modeRef.current;
    if (!sideMode || hits.length < 2 || path.length < 2) {
      setNotice("기점과 종점을 포함해 두 점 이상 찍어 주세요.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const start = hits[0]!.point;
      const end = hits[hits.length - 1]!.point;
      const startLl = toLonLat(start);
      const endLl = toLonLat(end);
      let startName = "";
      let endName = "";
      try {
        const [sAddr, eAddr] = await Promise.all([
          getAddressFromCoord(startLl[0]!, startLl[1]!),
          getAddressFromCoord(endLl[0]!, endLl[1]!),
        ]);
        startName = (sAddr?.road || sAddr?.jibun || "").trim();
        endName = (eAddr?.road || eAddr?.jibun || "").trim();
      } catch {
        /* 주소 실패해도 도형은 저장 */
      }
      if (!startName) startName = "기점";
      if (!endName) endName = "종점";

      const result = buildSegmentsFromCenterPath({
        center3857: path,
        mode: sideMode,
        routePrefix: prefixRef.current,
        startIndex1: indexRef.current,
        startName,
        endName,
      });
      onCompleteRef.current(result);
      resetDraw();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [resetDraw]);

  // 레이어·클릭
  useEffect(() => {
    if (!active || !mode || !mapReady || !map) {
      resetDraw();
      return;
    }

    const previewSource = new VectorSource();
    previewSourceRef.current = previewSource;
    const previewLayer = new VectorLayer({
      source: previewSource,
      zIndex: PREVIEW_Z,
      style: (feature) => {
        if (feature.get("role") === "vertex") {
          return new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: "#ffffff" }),
              stroke: new Stroke({ color: "#00C853", width: 2.5 }),
            }),
          });
        }
        return [
          new Style({
            stroke: new Stroke({
              color: "rgba(255,255,255,0.9)",
              width: 7,
            }),
          }),
          new Style({
            stroke: new Stroke({
              color: "#00C853",
              width: 4,
              lineCap: "round",
              lineJoin: "round",
            }),
          }),
        ];
      },
    });
    previewLayer.set("bikeRoadSegmentDrawPreview", true);
    map.addLayer(previewLayer);

    const geoServerBase = getGeoServerBase();
    const roadLayer = new ImageLayer({
      visible: true,
      zIndex: ROAD_PREVIEW_Z,
      opacity: 0.85,
      source: new ImageWMS({
        url: `${geoServerBase}/${WORKSPACE}/wms`,
        params: {
          LAYERS: `${WORKSPACE}:${ROAD_LAYER}`,
          STYLES: ROAD_LAYER,
        },
        serverType: "geoserver",
        ratio: 1.5,
      }),
    });
    roadLayer.set("bikeRoadSegmentDrawRoad", true);
    map.addLayer(roadLayer);

    let fetchSeq = 0;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const loadNet = async () => {
      const seq = ++fetchSeq;
      const extent = map.getView().calculateExtent(map.getSize());
      const net = await loadBikeRoadNetByBbox(
        extent as [number, number, number, number]
      );
      if (seq !== fetchSeq) return;
      netRef.current = net;
      if (!net || net.edges.length === 0) {
        setNotice("이 화면의 도로구간을 불러오지 못했습니다. 확대해 보세요.");
      } else {
        setNotice(null);
      }
    };
    const scheduleLoad = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void loadNet();
      }, 350);
    };
    scheduleLoad();
    const moveKey = map.on("moveend", scheduleLoad) as EventsKey;

    const onClick = (evt: { coordinate: number[]; originalEvent: Event }) => {
      if (busyRef.current) return;
      const oe = evt.originalEvent as MouseEvent;
      if (oe.button != null && oe.button !== 0) return;
      const net = netRef.current;
      if (!net) {
        setNotice("도로구간을 불러오는 중입니다.");
        return;
      }
      const res = map.getView().getResolution() ?? 1;
      const tol = snapTolM(res);
      const hit = projectOnNet(net, [evt.coordinate[0]!, evt.coordinate[1]!], tol);
      if (!hit) {
        setNotice("도로구간 위에서 찍어 주세요.");
        return;
      }
      const prev = hitsRef.current[hitsRef.current.length - 1];
      if (!prev) {
        hitsRef.current = [hit];
        path3857Ref.current = [hit.point];
        setPointCount(1);
        setNotice("종점(또는 경유점)을 찍어 주세요.");
        refreshPreview();
        return;
      }
      const seg = netPath(net, prev, hit);
      if (!seg || seg.length < 2) {
        setNotice("두 점 사이 도로 경로를 찾지 못했습니다.");
        return;
      }
      hitsRef.current = [...hitsRef.current, hit];
      path3857Ref.current = [...path3857Ref.current, ...seg.slice(1)];
      setPointCount(hitsRef.current.length);
      setNotice(
        hitsRef.current.length >= 2
          ? "경유점을 더 찍거나 «완료»하세요."
          : null
      );
      refreshPreview();
    };

    const clickKey = map.on("click", onClick) as EventsKey;

    setNotice(
      mode === "both"
        ? "양측: 도로 따라 기점→종점을 찍으세요."
        : "편측: 도로 따라 기점→종점을 찍으세요."
    );

    return () => {
      if (debounce) clearTimeout(debounce);
      unByKey(moveKey);
      unByKey(clickKey);
      map.removeLayer(previewLayer);
      map.removeLayer(roadLayer);
      previewSourceRef.current = null;
      netRef.current = null;
      hitsRef.current = [];
      path3857Ref.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, map, mapReady]);

  return {
    pointCount,
    busy,
    notice,
    undoLast,
    finish,
    cancel: () => {
      resetDraw();
      onCancelRef.current();
    },
    state: {
      active,
      mode,
      pointCount,
      busy,
      notice,
    } satisfies BikeRoadSegmentDrawState,
  };
}
