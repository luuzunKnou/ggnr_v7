"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import { LineString, MultiLineString, Point } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import type { Map as OlMap } from "ol";
import type { MapBrowserEvent } from "ol";
import { fromLonLat, toLonLat } from "ol/proj";
import { call } from "@/lib/api";
import { fetchWfsGeoJsonByBbox } from "@/lib/geoserverWfs";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { getAddressFromCoord } from "../../../_mapComponents/addressSearch/vworldAddressSearch";
import {
  bikeRoadPointAddressLabel,
  buildSegmentFromDrawnPath,
  collectSegmentLines,
  isBikeRoadPlaceholderName,
  type BuiltSegmentDrawResult,
} from "./bikeRoadSegmentGeom";
import {
  bikeRoadStrokeColor,
  pathStyleFromPathType,
  type BikeRoadSegment,
  type BikeRoadSegmentSide,
} from "./bikeRoadMock";
import {
  BIKE_ROAD_NET_MAX_RES,
  ROAD_LAYER,
  mergeBikeRoadNets,
  netCacheCoversView,
  netPath,
  projectOnNet,
  snapTolM,
  unionBbox3857,
  type BikeRoadNet,
  type Pt,
  type RoadNetHit,
} from "./bikeRoadRoadNet";
import {
  loadBikeRoadNetByBbox,
  peekBikeRoadNetCache,
} from "./loadBikeRoadNet";
import { bikeRoadLineStyles } from "./bikeRoadStrokeStyle";

function hitDist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** 찍은 점들만으로 경로를 매번 다시 이음 — 좌·우 모서리 모두 끊기지 않게 */
function rebuildPathFromHits(
  net: BikeRoadNet,
  hits: RoadNetHit[]
): Pt[] | null {
  if (hits.length === 0) return [];
  if (hits.length === 1) return [[hits[0]!.point[0], hits[0]!.point[1]]];
  let path: Pt[] = [];
  for (let i = 0; i < hits.length - 1; i++) {
    const a = hits[i]!;
    const b = hits[i + 1]!;
    const seg = netPath(net, a, b);
    if (!seg || seg.length < 2) return null;
    // 양 끝은 클릭 스냅으로 고정 (한쪽만 맞추다 반대쪽이 뜨는 것 방지)
    const pinned: Pt[] = seg.map((p) => [p[0], p[1]] as Pt);
    pinned[0] = [a.point[0], a.point[1]];
    pinned[pinned.length - 1] = [b.point[0], b.point[1]];

    if (path.length === 0) {
      path = pinned;
      continue;
    }
    const end = path[path.length - 1]!;
    const start = pinned[0]!;
    if (hitDist(end, start) <= 3) {
      for (let j = 1; j < pinned.length; j++) {
        path.push(pinned[j]!);
      }
    } else if (hitDist(end, start) <= 18) {
      // 짧은 틈만 메움 — 먼 점프(건물 가로지름)는 실패 처리
      for (const p of pinned) path.push(p);
    } else {
      return null;
    }
  }
  return path.length >= 2 ? path : null;
}

/** 편측·양측(한 번에 좌우) */
export type BikeRoadDrawSideMode = "C" | "both";

export type BikeRoadSegmentDrawState = {
  active: boolean;
  mode: BikeRoadDrawSideMode | null;
  pointCount: number;
  draftCount: number;
  busy: boolean;
  notice: string | null;
  netLoading: boolean;
};

export type DrawSnapAnchor = {
  point3857: Pt;
  name?: string;
};

type Options = {
  /** 세션 열림 (수정 중 + 추가 시작) */
  active: boolean;
  /** 현재 줄의 측 — 없으면 점 찍기 대기(측 선택 필요) */
  mode: BikeRoadDrawSideMode | null;
  routePrefix: string;
  /** 이미 표에 있는 구간 수 — 일괄 반영 시 시작 일련 */
  nextIndex1: number;
  /** 모달 전용 지도 — 있으면 본지도 대신 사용 */
  mapOverride?: OlMap | null;
  /** 기존·초안 끝점 — 기점·종점 맞닿음 스냅 */
  snapAnchors?: DrawSnapAnchor[];
  /** 이미 등록된 구간 — 모달 지도에 레이어로 표시 */
  existingSegments?: BikeRoadSegment[];
  onCommit: (result: BuiltSegmentDrawResult) => void;
  onCancel: () => void;
  /** 이 줄 확정 후 측을 다시 고르도록 */
  onLineConfirmed?: () => void;
};

const PREVIEW_Z = 920;
const ROAD_NET_GUIDE_Z = 410;
const DRAFT_Z = 915;
const EXISTING_Z = 905;
/** 기존·초안 기점·종점 근처면 같은 좌표로 붙는 거리 (m) */
const ANCHOR_SNAP_M = 10;

function sideLabel(side: BikeRoadDrawSideMode): string {
  if (side === "both") return "양측";
  return "편측";
}

function strokeStyleForPathType(pathType: string) {
  const color = bikeRoadStrokeColor(pathStyleFromPathType(pathType));
  return bikeRoadLineStyles(color);
}

export function bikeRoadDrawSideLabel(side: BikeRoadDrawSideMode | string): string {
  if (side === "both" || side === "R,L") return "양측";
  if (side === "R") return "우측";
  if (side === "L") return "좌측";
  return "편측";
}

type StrokeMark = {
  pathLen: number;
  endHit: RoadNetHit;
};

/**
 * 도로구간을 따라 점 잇기 + 세션 초안.
 * 점과 점 사이는 도로 경로(곡선 포함). 사거리는 다음 점 위치로 갈래 선택.
 */
export function useBikeRoadSegmentDraw({
  active,
  mode,
  routePrefix,
  nextIndex1,
  mapOverride = null,
  snapAnchors = [],
  existingSegments = [],
  onCommit,
  onCancel,
  onLineConfirmed,
}: Options) {
  const mapContext = useMapContext();
  const map = mapOverride ?? mapContext?.mapInstanceRef?.current ?? null;
  const mapReady = mapOverride ? Boolean(mapOverride) : mapContext?.mapReady;
  const vworldApiKey = mapContext?.vworldApiKey?.trim() || undefined;

  const [pointCount, setPointCount] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  const [drafts, setDrafts] = useState<BikeRoadSegment[]>([]);
  const [busy, setBusy] = useState(false);
  const [netLoading, setNetLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);

  const netRef = useRef<BikeRoadNet | null>(null);
  const path3857Ref = useRef<Pt[]>([]);
  const clickHitsRef = useRef<RoadNetHit[]>([]);
  const clickNamesRef = useRef<(string | null)[]>([]);
  const strokesRef = useRef<StrokeMark[]>([]);
  const sessionDraftsRef = useRef<BikeRoadSegment[]>([]);
  const existingRef = useRef<BikeRoadSegment[]>(existingSegments);
  const previewSourceRef = useRef<VectorSource | null>(null);
  const draftSourceRef = useRef<VectorSource | null>(null);
  const existingSourceRef = useRef<VectorSource | null>(null);
  const netGuideSourceRef = useRef<VectorSource | null>(null);
  existingRef.current = existingSegments;
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  const onLineConfirmedRef = useRef(onLineConfirmed);
  const confirmLineRef = useRef<() => void>(() => {});
  const modeRef = useRef(mode);
  const prefixRef = useRef(routePrefix);
  const indexRef = useRef(nextIndex1);
  const anchorsRef = useRef(snapAnchors);

  onCommitRef.current = onCommit;
  onCancelRef.current = onCancel;
  onLineConfirmedRef.current = onLineConfirmed;
  modeRef.current = mode;
  prefixRef.current = routePrefix;
  indexRef.current = nextIndex1;
  anchorsRef.current = snapAnchors;

  const syncCounts = useCallback(() => {
    setPointCount(clickHitsRef.current.length);
    setDraftCount(sessionDraftsRef.current.length);
    setDrafts([...sessionDraftsRef.current]);
  }, []);

  /** 기존+초안 — side(R/L/C) 그대로 표시 (자동 겹침 변환 없음) */
  const paintLayers = useCallback(() => {
    const draftSource = draftSourceRef.current;
    const existingSource = existingSourceRef.current;
    if (!draftSource || !existingSource) return;
    draftSource.clear();
    existingSource.clear();
    const drafts = sessionDraftsRef.current;
    const existing = existingRef.current;
    const draftIds = new Set(drafts.map((s) => s.id));
    const byId = new Map(
      [...existing, ...drafts].map((s) => [s.id, s] as const)
    );
    for (const line of collectSegmentLines([...existing, ...drafts])) {
      if (line.coords.length < 2) continue;
      const seg = byId.get(line.segmentId);
      const pts = line.coords.map((c) => fromLonLat(c) as Pt);
      const isDraft = draftIds.has(line.segmentId);
      (isDraft ? draftSource : existingSource).addFeature(
        new Feature({
          geometry: new LineString(pts),
          role: isDraft ? "draft" : "existing",
          pathType: seg?.pathType ?? "겸용(분리)",
        })
      );
    }
  }, []);

  const paintDrafts = useCallback(() => {
    paintLayers();
  }, [paintLayers]);

  const paintExisting = useCallback(() => {
    paintLayers();
  }, [paintLayers]);

  const refreshPreview = useCallback(() => {
    const source = previewSourceRef.current;
    if (!source) return;
    source.clear();
    const path = path3857Ref.current;
    if (path.length >= 2) {
      source.addFeature(new Feature({ geometry: new LineString(path) }));
    }
    for (const h of clickHitsRef.current) {
      source.addFeature(
        new Feature({
          geometry: new Point(h.point),
          role: "vertex",
        })
      );
    }
  }, []);

  const resetCurrentLine = useCallback(() => {
    path3857Ref.current = [];
    clickHitsRef.current = [];
    clickNamesRef.current = [];
    strokesRef.current = [];
    setPointCount(0);
    refreshPreview();
  }, [refreshPreview]);

  const resetSession = useCallback(() => {
    sessionDraftsRef.current = [];
    resetCurrentLine();
    setDraftCount(0);
    setDrafts([]);
    setNotice(null);
    paintDrafts();
  }, [paintDrafts, resetCurrentLine]);

  const removeDraftAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= sessionDraftsRef.current.length) return;
      sessionDraftsRef.current = sessionDraftsRef.current.filter((_, i) => i !== index);
      paintDrafts();
      syncCounts();
      setNotice(
        sessionDraftsRef.current.length > 0
          ? `초안 ${sessionDraftsRef.current.length}줄.`
          : "초안이 비었습니다. 편측·양측을 고른 뒤 점을 찍으세요."
      );
    },
    [paintDrafts, syncCounts]
  );

  const updateDraftField = useCallback(
    (index: number, key: "startName" | "endName", value: string) => {
      const list = [...sessionDraftsRef.current];
      if (index < 0 || index >= list.length) return;
      const cur = list[index]!;
      list[index] = { ...cur, [key]: value };
      const centerKey = JSON.stringify(cur.centerLineCoords ?? null);
      for (let i = 0; i < list.length; i++) {
        if (i === index) continue;
        const o = list[i]!;
        if (
          (cur.side === "R" || cur.side === "L") &&
          (o.side === "R" || o.side === "L") &&
          o.side !== cur.side &&
          JSON.stringify(o.centerLineCoords ?? null) === centerKey
        ) {
          list[i] = { ...o, [key]: value };
        }
      }
      sessionDraftsRef.current = list;
      setDrafts(list);
    },
    []
  );

  /** 도로·기존 끝점 스냅. 기점·종점 근처면 같은 좌표로 고정 */
  const snapHit = useCallback((
    coord: Pt,
    net: BikeRoadNet,
    res: number
  ): { hit: RoadNetHit; name: string | null; fromAnchor: boolean } | null => {
    // 클로저 할당은 TS가 null로만 좁히므로 홀더로 둔다
    const anchorHold: {
      cur: { point: Pt; name: string | null; d: number } | null;
    } = { cur: null };

    const consider = (point: Pt, nameRaw: string | null | undefined, d: number) => {
      if (d > ANCHOR_SNAP_M) return;
      if (anchorHold.cur && d >= anchorHold.cur.d) return;
      const nm = nameRaw?.trim() || null;
      anchorHold.cur = {
        point: [point[0], point[1]],
        name: isBikeRoadPlaceholderName(nm) ? null : nm,
        d,
      };
    };

    for (const a of anchorsRef.current) {
      const d = Math.hypot(
        a.point3857[0] - coord[0],
        a.point3857[1] - coord[1]
      );
      consider(a.point3857, a.name, d);
    }
    for (const seg of sessionDraftsRef.current) {
      const coords = seg.centerLineCoords ?? seg.lineCoords;
      if (!coords || coords.length < 2) continue;
      const ends: { ll: [number, number]; name: string }[] = [
        { ll: coords[0]!, name: seg.startName },
        { ll: coords[coords.length - 1]!, name: seg.endName },
      ];
      for (const e of ends) {
        const p = fromLonLat(e.ll) as Pt;
        const d = Math.hypot(p[0] - coord[0], p[1] - coord[1]);
        consider(p, e.name, d);
      }
    }
    // 등록된 구간(모달 existing) 끝점도 동일 규칙
    for (const seg of existingRef.current) {
      const coords = seg.centerLineCoords ?? seg.lineCoords;
      if (!coords || coords.length < 2) continue;
      for (const e of [
        { ll: coords[0]!, name: seg.startName },
        { ll: coords[coords.length - 1]!, name: seg.endName },
      ]) {
        const p = fromLonLat(e.ll) as Pt;
        const d = Math.hypot(p[0] - coord[0], p[1] - coord[1]);
        consider(p, e.name, d);
      }
    }

    const tol = snapTolM(res);
    const bestAnchor = anchorHold.cur;
    // 기존 시·종점 근처 → 그 좌표 그대로 (도로 투영으로 살짝 밀리지 않게)
    if (bestAnchor) {
      const anchorHit = projectOnNet(
        net,
        bestAnchor.point,
        Math.max(tol * 3, ANCHOR_SNAP_M)
      );
      if (anchorHit) {
        return {
          hit: {
            ...anchorHit,
            point: [bestAnchor.point[0], bestAnchor.point[1]],
            dist: bestAnchor.d,
          },
          name: bestAnchor.name,
          fromAnchor: true,
        };
      }
    }

    const roadHit = projectOnNet(net, coord, tol);
    if (!roadHit) return null;
    return { hit: roadHit, name: null, fromAnchor: false };
  }, []);

  const undoLast = useCallback(() => {
    const hits = clickHitsRef.current;
    if (hits.length === 0) return;
    hits.pop();
    clickNamesRef.current.pop();
    strokesRef.current.pop();
    if (hits.length === 0) {
      path3857Ref.current = [];
      setNotice(
        modeRef.current
          ? "도로 위를 클릭해 기점을 찍으세요."
          : "편측·양측을 고르세요."
      );
    } else if (hits.length === 1) {
      path3857Ref.current = [hits[0]!.point];
      setNotice("다음 점을 도로 위에 찍으세요. 사거리는 가고 싶은 갈래에 찍으세요.");
    } else {
      const prev = strokesRef.current[strokesRef.current.length - 1]!;
      path3857Ref.current = path3857Ref.current.slice(0, prev.pathLen);
      setNotice("점을 더 찍거나 «확정»(더블클릭)하세요.");
    }
    syncCounts();
    refreshPreview();
  }, [refreshPreview, syncCounts]);

  const confirmLine = useCallback(async () => {
    const side = modeRef.current;
    const path = path3857Ref.current;
    if (!side) {
      setNotice("편측·양측을 먼저 고르세요.");
      return;
    }
    if (path.length < 2) {
      setNotice("점을 두 개 이상 찍은 뒤 «확정»하세요.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const startPt = path[0]!;
      const endPt = path[path.length - 1]!;
      // 시·종점 = 찍은 점 좌표의 주소(지번 우선). 수동 입력이 아님.
      let startName = "";
      let endName = "";
      try {
        const startLl = toLonLat(startPt);
        const endLl = toLonLat(endPt);
        let apiKey = vworldApiKey;
        if (!apiKey) {
          try {
            const res = await call("", "POST", {
              service: "configService",
              action: "getMapConfig",
              params: {},
            });
            const data = res?.data ?? res;
            apiKey = String(data?.VWORLD_API_KEY ?? "").trim() || undefined;
            if (apiKey) mapContext?.setVworldApiKey?.(apiKey);
          } catch {
            /* ignore */
          }
        }
        const opts = apiKey ? { apiKey } : undefined;
        const [sAddr, eAddr] = await Promise.all([
          getAddressFromCoord(startLl[0]!, startLl[1]!, opts),
          getAddressFromCoord(endLl[0]!, endLl[1]!, opts),
        ]);
        startName = bikeRoadPointAddressLabel(sAddr);
        endName = bikeRoadPointAddressLabel(eAddr);
      } catch {
        /* 주소 실패 시 빈 칸 — «기점»«종점» 자리표시 쓰지 않음 */
      }

      const index1 =
        indexRef.current + sessionDraftsRef.current.length;
      const prefix = prefixRef.current;
      const added: BikeRoadSegment[] = [];
      if (side === "both") {
        added.push(
          buildSegmentFromDrawnPath({
            path3857: path,
            side: "R",
            routePrefix: prefix,
            index1,
            startName,
            endName,
          }),
          buildSegmentFromDrawnPath({
            path3857: path,
            side: "L",
            routePrefix: prefix,
            index1: index1 + 1,
            startName,
            endName,
          })
        );
      } else if (side === "C") {
        added.push(
          buildSegmentFromDrawnPath({
            path3857: path,
            side: "C",
            routePrefix: prefix,
            index1,
            startName,
            endName,
          })
        );
      }
      sessionDraftsRef.current = [...sessionDraftsRef.current, ...added];
      resetCurrentLine();
      paintDrafts();
      syncCounts();
      setNotice(
        `초안 ${sessionDraftsRef.current.length}줄. 이어서 그리거나 «일괄»하세요.`
      );
      onLineConfirmedRef.current?.();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [mapContext, paintDrafts, resetCurrentLine, syncCounts, vworldApiKey]);
  confirmLineRef.current = () => {
    void confirmLine();
  };

  const commitAll = useCallback(() => {
    const drafts = sessionDraftsRef.current;
    if (drafts.length === 0) {
      setNotice("확정한 줄이 없습니다. 점을 찍고 «확정»하세요.");
      return;
    }
    const centerLonLat = drafts[0]?.centerLineCoords ?? [];
    onCommitRef.current({ segments: [...drafts], centerLonLat });
    resetSession();
  }, [resetSession]);

  const cancel = useCallback(() => {
    resetSession();
    onCancelRef.current();
  }, [resetSession]);

  useEffect(() => {
    if (!active || !mapReady || !map) {
      resetSession();
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
        return bikeRoadLineStyles("#00C853");
      },
    });
    previewLayer.set("bikeRoadSegmentDrawPreview", true);
    map.addLayer(previewLayer);

    const draftSource = new VectorSource();
    draftSourceRef.current = draftSource;
    const draftLayer = new VectorLayer({
      source: draftSource,
      zIndex: DRAFT_Z,
      style: (feature) => strokeStyleForPathType(String(feature.get("pathType") ?? "겸용(분리)")),
    });
    draftLayer.set("bikeRoadSegmentDrawDraft", true);
    map.addLayer(draftLayer);

    const existingSource = new VectorSource();
    existingSourceRef.current = existingSource;
    const existingLayer = new VectorLayer({
      source: existingSource,
      zIndex: EXISTING_Z,
      style: (feature) => strokeStyleForPathType(String(feature.get("pathType") ?? "겸용(분리)")),
    });
    existingLayer.set("bikeRoadSegmentDrawExisting", true);
    map.addLayer(existingLayer);
    paintExisting();

    const netGuideSource = new VectorSource();
    netGuideSourceRef.current = netGuideSource;
    const netGuideLayer = new VectorLayer({
      source: netGuideSource,
      zIndex: ROAD_NET_GUIDE_Z,
      opacity: 0.9,
      style: [
        new Style({
          stroke: new Stroke({
            color: "rgba(255,255,255,0.75)",
            width: 4,
            lineCap: "round",
            lineJoin: "round",
          }),
        }),
        new Style({
          stroke: new Stroke({
            color: "#03A9F4",
            width: 2.5,
            lineCap: "round",
            lineJoin: "round",
          }),
        }),
      ],
    });
    netGuideLayer.set("bikeRoadSegmentDrawRoad", true);
    map.addLayer(netGuideLayer);

    /** 원본 도로구간 안내선 */
    const paintGuideLines = (lines: Pt[][] | null | undefined) => {
      if (!lines?.length) return;
      const ok = lines.filter((c) => c.length >= 2);
      if (!ok.length) return;
      netGuideSource.clear();
      netGuideSource.addFeature(
        new Feature({ geometry: new MultiLineString(ok) })
      );
    };

    const paintRawGuide = (json: {
      type?: string;
      features?: unknown[];
    }) => {
      if (netRef.current) return;
      try {
        const format = new GeoJSON();
        const features = format.readFeatures(json, {
          dataProjection: "EPSG:3857",
          featureProjection: "EPSG:3857",
        });
        const lines: Pt[][] = [];
        for (const f of features) {
          const g = f.getGeometry();
          if (!g) continue;
          const t = g.getType();
          if (t === "LineString") {
            const c = (g as LineString).getCoordinates() as Pt[];
            if (c.length >= 2) lines.push(c);
          } else if (t === "MultiLineString") {
            for (const part of (g as MultiLineString).getCoordinates() as Pt[][]) {
              if (part.length >= 2) lines.push(part);
            }
          }
        }
        paintGuideLines(lines);
      } catch {
        /* ignore */
      }
    };

    let fetchSeq = 0;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let cachedBbox: [number, number, number, number] | null = null;
    let loading = false;

    const hasDrawnPath = () =>
      path3857Ref.current.length >= 2 || clickHitsRef.current.length > 0;

    /**
     * 그린 경로가 있을 때는 점·경로를 새 망에 억지로 옮기지 않음.
     */
    const loadNet = async (force = false) => {
      const resolution = map.getView().getResolution() ?? 1;
      if (resolution > BIKE_ROAD_NET_MAX_RES) {
        if (!netRef.current) {
          setNotice("지도를 더 확대한 뒤 도로 위를 클릭하세요.");
        }
        return;
      }
      const extent = map.getView().calculateExtent(map.getSize()) as [
        number,
        number,
        number,
        number,
      ];
      if (
        !force &&
        netRef.current &&
        cachedBbox &&
        netCacheCoversView(cachedBbox, extent)
      ) {
        return;
      }

      const peeked = peekBikeRoadNetCache(extent);
      if (peeked && (!netRef.current || !hasDrawnPath())) {
        netRef.current = peeked.net;
        cachedBbox = peeked.bufferedBbox;
        paintGuideLines(peeked.guideLines);
        setNetLoading(false);
        if (!force && netCacheCoversView(peeked.bufferedBbox, extent)) {
          return;
        }
      }

      if (loading) return;
      loading = true;
      if (!netRef.current) setNetLoading(true);
      const seq = ++fetchSeq;
      try {
        if (!netRef.current) {
          void fetchWfsGeoJsonByBbox({
            layerName: ROAD_LAYER,
            bbox: extent,
            srsName: "EPSG:3857",
            maxFeatures: 1200,
          }).then((json) => {
            if (seq !== fetchSeq || !json?.features?.length) return;
            if (netRef.current) return;
            paintRawGuide(json);
          });
        }

        const loaded = await loadBikeRoadNetByBbox(extent, {
          resolution,
          bufferRatio: 0.12,
        });
        if (seq !== fetchSeq) return;
        if (!loaded || loaded.net.edges.length === 0) {
          if (!netRef.current) {
            setNotice("이 화면의 도로구간을 불러오지 못했습니다. 확대해 보세요.");
          }
          return;
        }

        const hasDrawn = hasDrawnPath();
        if (hasDrawn && netRef.current) {
          netRef.current = mergeBikeRoadNets(netRef.current, loaded.net);
          cachedBbox = cachedBbox
            ? unionBbox3857(cachedBbox, loaded.bufferedBbox)
            : loaded.bufferedBbox;
          if (loaded.guideLines?.length) {
            paintGuideLines(loaded.guideLines);
          }
        } else {
          netRef.current = loaded.net;
          cachedBbox = loaded.bufferedBbox;
          paintGuideLines(loaded.guideLines);
        }

        if (!modeRef.current) {
          setNotice(
            sessionDraftsRef.current.length > 0
              ? `초안 ${sessionDraftsRef.current.length}줄. 측을 고른 뒤 이어서 그리세요.`
              : "편측·양측을 고른 뒤 도로를 따라 점을 찍으세요."
          );
        } else if (clickHitsRef.current.length === 0) {
          setNotice(
            `${sideLabel(modeRef.current)} — 도로를 따라 점을 찍으세요.`
          );
        }
      } finally {
        loading = false;
        if (seq === fetchSeq) setNetLoading(false);
      }
    };
    const scheduleLoad = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void loadNet(false);
      }, 400);
    };
    void loadNet(true);
    const moveKey = map.on("moveend", scheduleLoad) as EventsKey;

    const onClick = (
      evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>
    ) => {
      if (busyRef.current) return;
      const side = modeRef.current;
      if (!side) {
        setNotice("편측·양측을 고른 뒤 점을 찍으세요.");
        return;
      }
      const net = netRef.current;
      if (!net) {
        setNotice("도로구간을 불러오는 중입니다.");
        return;
      }
      const coord = evt.coordinate as Pt;
      const res = map.getView().getResolution() ?? 1;
      const snapped = snapHit(coord, net, res);
      if (!snapped) {
        setNotice(
          "도로 안내선 위, 또는 기존 기점·종점 근처(같게 붙음)를 클릭하세요."
        );
        return;
      }

      evt.stopPropagation();
      evt.preventDefault();

      const hits = clickHitsRef.current;
      const last = hits[hits.length - 1];
      if (
        last &&
        Math.hypot(
          last.point[0] - snapped.hit.point[0],
          last.point[1] - snapped.hit.point[1]
        ) < 0.5
      ) {
        setNotice("같은 점입니다. 다음 위치를 클릭하세요.");
        return;
      }

      if (!last) {
        hits.push(snapped.hit);
        clickNamesRef.current.push(snapped.name);
        path3857Ref.current = [snapped.hit.point];
        syncCounts();
        refreshPreview();
        setNotice(
          snapped.fromAnchor
            ? "기존 기점·종점에 붙였습니다. 다음 점을 찍으세요."
            : "다음 점을 도로 위에 찍으세요. 사거리는 가고 싶은 갈래에 찍으세요."
        );
        return;
      }

      hits.push(snapped.hit);
      clickNamesRef.current.push(snapped.name);
      // 점 전체로 경로 재구성 — 조각 이음 끊김(왼쪽 사진) 방지
      const rebuilt = rebuildPathFromHits(net, hits);
      if (!rebuilt || rebuilt.length < 2) {
        hits.pop();
        clickNamesRef.current.pop();
        setNotice("도로가 이어지지 않습니다. 같은 연결 도로 위에 점을 찍으세요.");
        return;
      }
      path3857Ref.current = rebuilt;
      strokesRef.current.push({
        pathLen: rebuilt.length,
        endHit: snapped.hit,
      });
      syncCounts();
      refreshPreview();
      setNotice(
        snapped.fromAnchor
          ? "기존 기점·종점에 붙였습니다. 더 찍거나 «확정»하세요."
          : "점을 더 찍거나 «확정»(더블클릭)하세요."
      );
    };

    const onDblClick = (
      evt: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>
    ) => {
      if (busyRef.current) return;
      if (!modeRef.current) return;
      if (clickHitsRef.current.length < 2) return;
      evt.stopPropagation();
      evt.preventDefault();
      void confirmLineRef.current();
    };

    const clickKey = map.on("singleclick", onClick) as EventsKey;
    const dblKey = map.on("dblclick", onDblClick) as EventsKey;

    setNotice(
      mode
        ? `${sideLabel(mode)} — 도로를 따라 점을 찍으세요.`
        : "편측·양측을 고르세요."
    );
    paintDrafts();
    paintExisting();

    return () => {
      if (debounce) clearTimeout(debounce);
      unByKey(moveKey);
      unByKey(clickKey);
      unByKey(dblKey);
      map.removeLayer(previewLayer);
      map.removeLayer(draftLayer);
      map.removeLayer(existingLayer);
      map.removeLayer(netGuideLayer);
      previewSourceRef.current = null;
      draftSourceRef.current = null;
      existingSourceRef.current = null;
      netGuideSourceRef.current = null;
      netRef.current = null;
      sessionDraftsRef.current = [];
      path3857Ref.current = [];
      clickHitsRef.current = [];
      clickNamesRef.current = [];
      strokesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, map, mapReady]);

  useEffect(() => {
    if (!active) return;
    paintExisting();
  }, [active, existingSegments, paintExisting]);

  useEffect(() => {
    if (!active) return;
    if (mode) {
      setNotice(`${sideLabel(mode)} — 도로를 따라 점을 찍으세요.`);
    } else if (sessionDraftsRef.current.length > 0) {
      setNotice(
        `초안 ${sessionDraftsRef.current.length}줄. 측을 고르거나 «일괄»하세요.`
      );
    }
  }, [active, mode]);

  return {
    pointCount,
    draftCount,
    drafts,
    busy,
    netLoading,
    notice,
    undoLast,
    confirmLine,
    commitAll,
    cancel,
    removeDraftAt,
    updateDraftField,
    state: {
      active,
      mode,
      pointCount,
      draftCount,
      busy,
      notice,
      netLoading,
    } satisfies BikeRoadSegmentDrawState,
  };
}
