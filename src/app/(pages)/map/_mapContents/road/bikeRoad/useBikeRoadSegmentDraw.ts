"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Feature from "ol/Feature";
import { LineString, Point } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import DragPan from "ol/interaction/DragPan";
import { fromLonLat, toLonLat } from "ol/proj";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { getAddressFromCoord } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import {
  buildSegmentsFromCenterPath,
  type BuiltSegmentDrawResult,
} from "./bikeRoadSegmentGeom";
import {
  BIKE_ROAD_NET_MAX_RES,
  loadBikeRoadNetByBbox,
  netPathFollowStep,
  projectOnNet,
  projectOnNetForDrag,
  snapTolM,
  type BikeRoadNet,
  type Pt,
  type RoadNetHit,
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
  /** 직전 구간 종점 좌표 — 있으면 첫 점으로 이어 붙임 */
  chainFromLonLat?: [number, number] | null;
  /** 직전 구간 종점명 — 새 구간 기점에 사용 */
  chainStartName?: string | null;
  onComplete: (result: BuiltSegmentDrawResult) => void;
  onCancel: () => void;
};

const PREVIEW_Z = 920;
/** 합친 도로구간(원 레이어) 안내선 */
const ROAD_NET_GUIDE_Z = 410;

/** 이어 그리기 — 직전 종점에서 이 거리(m) 안이면 연속 */
const CONTINUE_JOIN_M = 25;

type StrokeMark = {
  /** 이 획까지 포함한 path 길이 */
  pathLen: number;
  endHit: RoadNetHit;
};

/**
 * 도로구간 위 드래그 따라그리기.
 * 두 점 최단경로 없음 — 사용자가 도로를 따라 그린 모양이 곧 구간.
 */
export function useBikeRoadSegmentDraw({
  active,
  mode,
  routePrefix,
  nextIndex1,
  chainFromLonLat = null,
  chainStartName = null,
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
  const startHitRef = useRef<RoadNetHit | null>(null);
  const endHitRef = useRef<RoadNetHit | null>(null);
  const strokesRef = useRef<StrokeMark[]>([]);
  const path3857Ref = useRef<Pt[]>([]);
  const previewSourceRef = useRef<VectorSource | null>(null);
  const netGuideSourceRef = useRef<VectorSource | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onCancelRef = useRef(onCancel);
  const modeRef = useRef(mode);
  const prefixRef = useRef(routePrefix);
  const indexRef = useRef(nextIndex1);
  const chainFromRef = useRef(chainFromLonLat);
  const chainNameRef = useRef(chainStartName);

  onCompleteRef.current = onComplete;
  onCancelRef.current = onCancel;
  modeRef.current = mode;
  prefixRef.current = routePrefix;
  indexRef.current = nextIndex1;
  chainFromRef.current = chainFromLonLat;
  chainNameRef.current = chainStartName;

  const syncPointCount = useCallback(() => {
    // 배너 «점» — 기점 + 획마다 종점 (완료 가능 여부에 사용)
    const n =
      path3857Ref.current.length < 2
        ? startHitRef.current
          ? 1
          : 0
        : 1 + strokesRef.current.length;
    setPointCount(n);
  }, []);

  const refreshPreview = useCallback(() => {
    const source = previewSourceRef.current;
    if (!source) return;
    source.clear();
    const path = path3857Ref.current;
    if (path.length >= 2) {
      source.addFeature(new Feature({ geometry: new LineString(path) }));
    }
    if (startHitRef.current) {
      source.addFeature(
        new Feature({
          geometry: new Point(startHitRef.current.point),
          role: "vertex",
        })
      );
    }
    if (endHitRef.current && path.length >= 2) {
      source.addFeature(
        new Feature({
          geometry: new Point(endHitRef.current.point),
          role: "vertex",
        })
      );
    }
  }, []);

  const resetDraw = useCallback(() => {
    startHitRef.current = null;
    endHitRef.current = null;
    strokesRef.current = [];
    path3857Ref.current = [];
    setPointCount(0);
    setNotice(null);
    refreshPreview();
  }, [refreshPreview]);

  const undoLast = useCallback(() => {
    const strokes = strokesRef.current;
    if (strokes.length === 0) {
      // 기점만 있는 경우
      if (startHitRef.current) {
        startHitRef.current = null;
        endHitRef.current = null;
        path3857Ref.current = [];
        setNotice("도로 위에서 눌러 드래그해 구간을 그리세요.");
        syncPointCount();
        refreshPreview();
      }
      return;
    }
    strokes.pop();
    if (strokes.length === 0) {
      // 첫 획만 지움 — 기점만 남김
      const start = startHitRef.current;
      path3857Ref.current = start ? [start.point] : [];
      endHitRef.current = start;
      setNotice("도로를 따라 다시 드래그하세요.");
    } else {
      const prev = strokes[strokes.length - 1]!;
      path3857Ref.current = path3857Ref.current.slice(0, prev.pathLen);
      endHitRef.current = prev.endHit;
      setNotice("더 드래그하거나 «완료»하세요.");
    }
    syncPointCount();
    refreshPreview();
  }, [refreshPreview, syncPointCount]);

  const finish = useCallback(async () => {
    const path = path3857Ref.current;
    const sideMode = modeRef.current;
    const startHit = startHitRef.current;
    const endHit = endHitRef.current;
    if (!sideMode || !startHit || !endHit || path.length < 2) {
      setNotice("도로를 따라 드래그해 구간을 그린 뒤 «완료»하세요.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const startLl = toLonLat(startHit.point);
      const endLl = toLonLat(endHit.point);
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
      const chained = (chainNameRef.current ?? "").trim();
      if (chained) startName = chained;

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

    const netGuideSource = new VectorSource();
    netGuideSourceRef.current = netGuideSource;
    const netGuideLayer = new VectorLayer({
      source: netGuideSource,
      zIndex: ROAD_NET_GUIDE_Z,
      opacity: 0.95,
      style: [
        new Style({
          stroke: new Stroke({
            color: "rgba(255,255,255,0.85)",
            width: 6,
            lineCap: "round",
            lineJoin: "round",
          }),
        }),
        new Style({
          stroke: new Stroke({
            color: "#03A9F4",
            width: 3.5,
            lineCap: "round",
            lineJoin: "round",
          }),
        }),
      ],
    });
    netGuideLayer.set("bikeRoadSegmentDrawRoad", true);
    map.addLayer(netGuideLayer);

    const paintNetGuide = (net: BikeRoadNet | null) => {
      netGuideSource.clear();
      if (!net) return;
      for (const coords of net.edgeCoords) {
        if (coords.length < 2) continue;
        netGuideSource.addFeature(new Feature({ geometry: new LineString(coords) }));
      }
    };

    let fetchSeq = 0;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let dragging = false;
    const loadNet = async () => {
      // 드래그 중 망 갱신 → 옛 edgeId로 edgeLenM 등 깨짐 방지
      if (dragging) return;
      const seq = ++fetchSeq;
      const resolution = map.getView().getResolution() ?? 1;
      if (resolution > BIKE_ROAD_NET_MAX_RES) {
        netRef.current = null;
        paintNetGuide(null);
        setNotice("지도를 더 확대한 뒤 도로 위에서 드래그하세요.");
        return;
      }
      const extent = map.getView().calculateExtent(map.getSize());
      const net = await loadBikeRoadNetByBbox(
        extent as [number, number, number, number],
        { resolution }
      );
      if (seq !== fetchSeq || dragging) return;
      netRef.current = net;
      paintNetGuide(net);
      if (!net || net.edges.length === 0) {
        setNotice("이 화면의 도로구간을 불러오지 못했습니다. 확대해 보세요.");
        return;
      }
      // 망이 바뀌면 기점·종점 스냅을 새 엣지에 다시 맞춤
      const res = map.getView().getResolution() ?? 1;
      const tol = snapTolM(res) * 2;
      if (startHitRef.current) {
        const s = projectOnNet(net, startHitRef.current.point, tol);
        if (s) startHitRef.current = s;
      }
      if (endHitRef.current) {
        const e = projectOnNet(net, endHitRef.current.point, tol);
        if (e) endHitRef.current = e;
      }
      const chainLl = chainFromRef.current;
      if (chainLl && !startHitRef.current) {
        const p = fromLonLat(chainLl) as Pt;
        const hit = projectOnNet(net, [p[0], p[1]], tol);
        if (hit) {
          startHitRef.current = hit;
          endHitRef.current = hit;
          path3857Ref.current = [hit.point];
          syncPointCount();
          setNotice("이전 구간 종점에서 이어집니다. 도로를 따라 드래그하세요.");
          refreshPreview();
          return;
        }
      }
      setNotice(
        chainLl
          ? "이전 구간 종점 근처로 확대한 뒤 드래그하세요."
          : null
      );
    };
    const scheduleLoad = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void loadNet();
      }, 500);
    };
    scheduleLoad();
    const moveKey = map.on("moveend", scheduleLoad) as EventsKey;

    const setPan = (on: boolean) => {
      map.getInteractions().forEach((inter) => {
        if (inter instanceof DragPan) inter.setActive(on);
      });
    };

    type DragState = {
      active: boolean;
      moved: boolean;
      startPx: [number, number];
      cursorHit: RoadNetHit;
      trail: Pt[];
      lastMapPt: Pt;
      /** 이번 획 시작 전 path 길이 — 취소 시 복원 */
      pathLenBefore: number;
    };
    let drag: DragState | null = null;
    let raf = 0;
    let pending: Pt | null = null;

    const viewport = map.getViewport();

    const paintLive = (trail: Pt[], cursor: RoadNetHit) => {
      const source = previewSourceRef.current;
      if (!source) return;
      source.clear();
      const show =
        path3857Ref.current.length === 0
          ? trail
          : [...path3857Ref.current, ...trail.slice(1)];
      if (show.length >= 2) {
        source.addFeature(new Feature({ geometry: new LineString(show) }));
      }
      if (startHitRef.current) {
        source.addFeature(
          new Feature({
            geometry: new Point(startHitRef.current.point),
            role: "vertex",
          })
        );
      }
      source.addFeature(
        new Feature({
          geometry: new Point(cursor.point),
          role: "vertex",
        })
      );
    };

    const onPointerDown = (evt: PointerEvent) => {
      if (busyRef.current || evt.button !== 0) return;
      const net = netRef.current;
      if (!net) {
        setNotice("도로구간을 불러오는 중입니다.");
        return;
      }
      const coord = map.getCoordinateFromPixel(
        map.getEventPixel(evt)
      ) as Pt;
      const res = map.getView().getResolution() ?? 1;
      const preferId =
        endHitRef.current?.edgeId ?? startHitRef.current?.edgeId ?? null;
      const hit = projectOnNet(net, coord, snapTolM(res), {
        preferEdgeId: preferId,
        preferSlackM: 12,
      });
      if (!hit) {
        setNotice("합친 도로구간 위에서 눌러 드래그하세요.");
        return;
      }

      // 이미 그린 구간이 있으면 종점 근처에서만 이어 그림
      const end = endHitRef.current;
      if (end && path3857Ref.current.length >= 2) {
        const d = Math.hypot(
          end.point[0] - hit.point[0],
          end.point[1] - hit.point[1]
        );
        if (d > CONTINUE_JOIN_M) {
          setNotice("이어서 그리려면 초록 종점 근처에서 드래그하세요.");
          return;
        }
      }

      evt.preventDefault();
      evt.stopPropagation();
      setPan(false);
      dragging = true;

      let anchor = hit;
      if (!startHitRef.current) {
        startHitRef.current = hit;
        endHitRef.current = hit;
        path3857Ref.current = [hit.point];
        syncPointCount();
      } else if (end) {
        anchor = end;
      }

      drag = {
        active: true,
        moved: false,
        startPx: [evt.clientX, evt.clientY],
        cursorHit: anchor,
        trail: [anchor.point],
        lastMapPt: coord,
        pathLenBefore: path3857Ref.current.length,
      };
      paintLive(drag.trail, anchor);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    };

    const onPointerMove = (evt: PointerEvent) => {
      if (!drag?.active) return;
      const dx = evt.clientX - drag.startPx[0];
      const dy = evt.clientY - drag.startPx[1];
      if (!drag.moved && dx * dx + dy * dy > 16) {
        drag.moved = true;
        setNotice("도로를 따라 드래그하세요. 사거리에서 가고 싶은 쪽으로 끌면 됩니다.");
      }
      pending = map.getCoordinateFromPixel(map.getEventPixel(evt)) as Pt;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!pending || !drag?.active) return;
        const net = netRef.current;
        if (!net) return;
        const res = map.getView().getResolution() ?? 1;
        const moveVec: Pt = [
          pending[0] - drag.lastMapPt[0],
          pending[1] - drag.lastMapPt[1],
        ];
        drag.lastMapPt = pending;
        const hit = projectOnNetForDrag(
          net,
          pending,
          snapTolM(res),
          drag.cursorHit,
          moveVec
        );
        if (!hit) return;

        const step = netPathFollowStep(net, drag.cursorHit, hit);
        if (!step || step.length < 2) {
          paintLive(drag.trail, drag.cursorHit);
          return;
        }
        for (let i = 1; i < step.length; i++) {
          const p = step[i]!;
          const last = drag.trail[drag.trail.length - 1]!;
          if (Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.05) {
            drag.trail.push(p);
          }
        }
        drag.cursorHit = hit;
        paintLive(drag.trail, hit);
      });
    };

    const endPointer = (commit: boolean) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      pending = null;
      setPan(true);
      dragging = false;
      const d = drag;
      drag = null;
      if (!d) {
        refreshPreview();
        return;
      }
      if (!commit || !d.moved || d.trail.length < 2) {
        if (!d.moved && startHitRef.current && strokesRef.current.length === 0) {
          setNotice("버튼을 누른 채 도로를 따라 드래그하세요.");
        }
        refreshPreview();
        return;
      }

      const base = path3857Ref.current;
      const joined =
        base.length === 0 ? d.trail : [...base, ...d.trail.slice(1)];
      if (joined.length < 2) {
        refreshPreview();
        return;
      }
      path3857Ref.current = joined;
      endHitRef.current = d.cursorHit;
      strokesRef.current.push({
        pathLen: joined.length,
        endHit: d.cursorHit,
      });
      syncPointCount();
      setNotice("원하는 모양까지 더 드래그하거나 «완료»하세요.");
      refreshPreview();
    };

    const onPointerUp = () => endPointer(true);
    const onPointerCancel = () => endPointer(false);

    viewport.addEventListener("pointerdown", onPointerDown, true);

    setNotice(
      chainFromLonLat
        ? "이전 구간 종점에서 이어집니다. 도로를 따라 드래그하세요."
        : "합친 도로구간 위에서 눌러 드래그해 구간을 그리세요."
    );

    return () => {
      if (debounce) clearTimeout(debounce);
      unByKey(moveKey);
      viewport.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      setPan(true);
      map.removeLayer(previewLayer);
      map.removeLayer(netGuideLayer);
      previewSourceRef.current = null;
      netGuideSourceRef.current = null;
      netRef.current = null;
      startHitRef.current = null;
      endHitRef.current = null;
      strokesRef.current = [];
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
