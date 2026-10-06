'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MapBrowserEvent } from 'ol';
import { Feature } from 'ol';
import type { Map as OlMap } from 'ol';
import type { Coordinate } from 'ol/coordinate';
import GeoJSON from 'ol/format/GeoJSON';
import WKT from 'ol/format/WKT';
import { LineString, MultiLineString, MultiPoint, Polygon } from 'ol/geom';
import type CircleGeom from 'ol/geom/Circle';
import type Geometry from 'ol/geom/Geometry';
import { fromCircle } from 'ol/geom/Polygon';
import Draw, { createBox } from 'ol/interaction/Draw';
import type MultiPolygon from 'ol/geom/MultiPolygon';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { unByKey } from 'ol/Observable';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { call } from '@/lib/api';
import {
  ownGbnLabel,
  privateLandRangeMode,
  type PrivateLandAnalysisLayer,
  type PrivateLandRangeMode,
} from '@/lib/privateLandAnalysisLayers';
import { useMapContext } from '../../_mapComponents/MapContext';
import {
  getBlockingMapDrawInteraction,
  notifyMapDrawInteractionBlocked,
} from '../../_mapComponents/mapDrawInteraction';
import { ANALYSIS_AREA_BLUE, ANALYSIS_AREA_STYLE } from '../../_mapComponents/analysisArea';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults';
import {
  collectSegments,
  invalidChordPair,
  seamChordNear,
  shortestChordAt,
  snapInside,
  toAreaGeometry,
  type Chord,
  type Seam,
} from './privateLandAnalysisGeom';
import { hexToRgba, matchesOwnFilter, OWN_FILTER_ALL, ownGbnColor } from './privateLandAnalysisFormat';

/** 끝 위치 이동이 멈춘 뒤 구간 미리보기 요청 대기(ms) */
const PREVIEW_DEBOUNCE_MS = 250;
/** 커서가 하천 밖이어도 이 픽셀 안이면 경계 안쪽으로 붙임 */
const SNAP_PX = 40;
/** 커서가 도형끼리 맞닿은 경계선에서 이 픽셀 안이면 그 선을 절단선으로 사용 */
const SEAM_SNAP_PX = 12;
/** 같은 지류 후보에서 기존 끝선과 이 배수(선 길이 기준) 안이면 새 끝선으로 교체 */
const TRIB_REPLACE_FACTOR = 3;
/** 접선이 지류 후보 경계에서 이 거리(지도 단위) 안이면 그 지류의 접선으로 본다 — 후보는 본류에서 조금 떼어 계산됨 */
const TRIB_SEAM_TOL_M = 3;
/** 누른 채 이 픽셀 안으로 움직여도 지도 끌기가 아닌 클릭으로 본다 */
const CLICK_MOVE_TOL_PX = 8;
/** 누른 뒤 이 시간(ms) 안에 떼야 클릭으로 본다 */
const CLICK_MAX_MS = 700;
/** 클릭 위치에서 선을 못 만들면, 이 픽셀 안에서 미리보기로 보였던 선을 쓴다 */
const CLICK_HOVER_TOL_PX = 14;
/** 같은 자리를 이 시간(ms)·픽셀 안에 다시 누르면 한 번으로 본다 */
const CLICK_DEDUPE_MS = 350;
const CLICK_DEDUPE_PX = 4;

export type PrivateLandAnalysisPhase =
  | 'layer'
  | 'start'
  | 'loadingBase'
  | 'end'
  | 'ranged'
  | 'applying'
  | 'applied'
  | 'analyzing'
  | 'result';

/** 닫힌 범위 지정 방식 — 경계선 찍기 / 도형(다각형·사각형·원) 그리기 */
export type PrivateLandClosedTool = 'line' | 'polygon' | 'rect' | 'circle';

export type PrivateLandParcel = {
  address: string;
  pnu: string;
  jimok: string;
  /** 소유구분 이름 */
  ownGbn: string;
  areaSqm: number | null;
  intersectAreaSqm: number | null;
  geometry3857: Record<string, unknown> | null;
  extent3857: [number, number, number, number] | null;
};

type Ctx = {
  layers: PrivateLandAnalysisLayer[];
  layersLoading: boolean;
  layer: PrivateLandAnalysisLayer | null;
  phase: PrivateLandAnalysisPhase;
  busy: boolean;
  message: string;
  baseName: string;
  zoneAreaSqm: number | null;
  parcels: PrivateLandParcel[];
  truncated: boolean;
  ownFilter: string;
  keyword: string;
  filteredParcels: PrivateLandParcel[];
  selectedPnu: string | null;
  selectedParcel: PrivateLandParcel | null;
  /** 시작 위치 하천 구분(하천코드·하천명)이 있어 지류 포함을 쓸 수 있음 */
  riverKnown: boolean;
  includeTributary: boolean;
  tribCandidateCount: number;
  tribCutCount: number;
  setIncludeTributary: (on: boolean) => void;
  /** 지류 추가 창 — 열려 있는 동안만 지도에서 지류 끝을 찍음 */
  tributaryPicking: boolean;
  openTributaryPick: () => void;
  /** 완료 — 찍은 지류가 없으면 미포함으로 되돌림 */
  closeTributaryPick: () => void;
  /** 마지막으로 찍은 지류 끝선 지우기 */
  undoTributaryCut: () => void;
  /** 분석 구역(레이어) 선택 모달 */
  areaModalOpen: boolean;
  openAreaModal: () => void;
  closeAreaModal: () => void;
  /** 지정한 구간을 서버에서 확인 중 — 끝나기 전엔 적용 불가 */
  rangeChecking: boolean;
  /** 지정한 구간이 잘못됨 — 있으면 적용 불가, 다시 지정만 */
  rangeError: string | null;
  /** 이어진 하천 반대쪽 갈래를 막지 않음 — 끝까지 포함됨(안내만) */
  riverOpen: boolean;
  /** 구간 지정 방식 — 하천 두 선 / 도로 닫힌 범위 */
  rangeMode: PrivateLandRangeMode;
  /** 닫힌 범위 — 찍은 경계선 수 */
  closedLineCount: number;
  /** 경계선이 아직 범위를 닫지 못함 */
  closedOpen: boolean;
  /** 닫힌 범위 — 마지막 경계선 지우기 */
  undoLastLine: () => void;
  /** 닫힌 범위 지정 방식 — 바꾸면 찍은 선·그린 도형을 지움 */
  closedTool: PrivateLandClosedTool;
  setClosedTool: (tool: PrivateLandClosedTool) => void;
  /** 닫힌 범위 — 도형을 그림 */
  hasShape: boolean;
  /** 닫힌 범위 — 그린 도형을 지우고 다시 그리기 */
  redrawShape: () => void;
  /** 화면이 넓어 레이어 면을 불러오지 않음 — 확대 필요 */
  viewTooLarge: boolean;
  selectLayer: (table: string) => void;
  /** 구간 확정 후 곧바로 필지 분석까지 */
  apply: () => void;
  changeArea: () => void;
  resetAll: () => void;
  setOwnFilter: (v: string) => void;
  setKeyword: (v: string) => void;
  selectParcel: (pnu: string | null) => void;
};

const PrivateLandAnalysisCtx = createContext<Ctx | null>(null);

export function usePrivateLandAnalysis(): Ctx {
  const ctx = useContext(PrivateLandAnalysisCtx);
  if (!ctx) throw new Error('사유지분석 컨텍스트가 없습니다.');
  return ctx;
}

const accent = (alpha: number) => `rgba(${ANALYSIS_AREA_BLUE}, ${alpha})`;

/** 찍은 선은 분석 결과에서도 남으므로 필지보다 위에 그림 */
const CHORD_STYLE = new Style({ stroke: new Stroke({ color: accent(1), width: 3 }), zIndex: 5 });
const CHORD_MOVING_STYLE = new Style({
  stroke: new Stroke({ color: accent(1), width: 3, lineDash: [8, 6] }),
  zIndex: 5,
});
/** 절단선 양 끝 — 필지분석 꼭짓점과 같은 점 */
const CHORD_ENDS_STYLE = new Style({
  zIndex: 5,
  geometry: (f) => {
    const g = f.getGeometry();
    return g instanceof LineString ? new MultiPoint([g.getFirstCoordinate(), g.getLastCoordinate()]) : undefined;
  },
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: accent(1) }),
    stroke: new Stroke({ color: '#fff', width: 1.5 }),
  }),
});
const PREVIEW_STYLE = new Style({
  stroke: new Stroke({ color: accent(0.85), width: 1.5, lineDash: [6, 4] }),
  fill: new Fill({ color: accent(0.1) }),
});
/** 필지 — 목록 소유구분 배지와 같은 색 */
const parcelStyleCache = new Map<string, Style | Style[]>();
function parcelStyle(ownGbn: string, picked: boolean): Style | Style[] {
  const key = `${ownGbn}|${picked ? 1 : 0}`;
  const cached = parcelStyleCache.get(key);
  if (cached) return cached;
  const color = ownGbnColor(ownGbn);
  const style = picked
    ? [
        new Style({ stroke: new Stroke({ color: '#fff', width: 6 }), zIndex: 1 }),
        new Style({
          stroke: new Stroke({ color: '#111827', width: 2.5 }),
          fill: new Fill({ color: hexToRgba(color, 0.65) }),
          zIndex: 2,
        }),
      ]
    : new Style({
        stroke: new Stroke({ color, width: 1.2 }),
        fill: new Fill({ color: hexToRgba(color, 0.35) }),
      });
  parcelStyleCache.set(key, style);
  return style;
}

function chordStyles(moving: boolean): Style[] {
  return [moving ? CHORD_MOVING_STYLE : CHORD_STYLE, CHORD_ENDS_STYLE];
}

/** 닫힌 범위 — 하나로 합친 레이어 면. 다른 도형보다 아래에 그림 */
const LAYER_BASE_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(217, 119, 6, 0.95)', width: 1.5 }),
  fill: new Fill({ color: 'rgba(253, 224, 71, 0.5)' }),
  zIndex: -1,
});

/** 닫힌 범위 — 경계선 안쪽으로 잡힌 구간 미리보기 */
const CLOSED_PREVIEW_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.95)', width: 2 }),
  fill: new Fill({ color: 'rgba(239, 68, 68, 0.45)' }),
});

/** 닫힌 범위 — 그린 도형 테두리 */
const SHAPE_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.95)', width: 2, lineDash: [8, 6] }),
  fill: new Fill({ color: 'rgba(220, 38, 38, 0.04)' }),
  zIndex: 4,
});

/** 분석 결과 중에는 숨기는 도형 — 구간 윤곽만. 찍은 선은 남김 */
const RESULT_HIDDEN_KINDS = ['zone'];

function featureStyle(feature: Feature<Geometry>): Style | Style[] | undefined {
  if (feature.get('hidden')) return undefined;
  switch (feature.get('kind')) {
    case 'layerBase':
      return LAYER_BASE_STYLE;
    case 'cut':
      return chordStyles(false);
    case 'chord1':
      return chordStyles(false);
    case 'chordStart':
      return chordStyles(true);
    case 'chord2':
      return chordStyles(Boolean(feature.get('preview')));
    case 'preview':
      return feature.get('closed') ? CLOSED_PREVIEW_STYLE : PREVIEW_STYLE;
    case 'zone':
      return ANALYSIS_AREA_STYLE;
    case 'parcel':
      return parcelStyle(String(feature.get('ownGbn') ?? ''), Boolean(feature.get('picked')));
    case 'tribCut':
      return chordStyles(false);
    case 'tribMoving':
      return chordStyles(true);
    case 'shape':
      return SHAPE_STYLE;
    default:
      return undefined;
  }
}

function chordGeometry(chord: Chord): LineString {
  return new LineString(chord.path ?? [chord[0], chord[1]]);
}

function readGeometry3857(raw: unknown): Geometry | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    return new GeoJSON().readGeometry(raw, {
      dataProjection: 'EPSG:3857',
      featureProjection: 'EPSG:3857',
    }) as Geometry;
  } catch {
    return null;
  }
}

function chordMid(c: Chord): Coordinate {
  return [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
}

function chordLength(c: Chord): number {
  return Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
}

function readSeams3857(raw: unknown): Seam[] {
  const geom = readGeometry3857(raw);
  if (geom instanceof LineString) return [geom.getCoordinates()];
  if (geom instanceof MultiLineString) return geom.getCoordinates();
  return [];
}

type Props = {
  system: string;
  onDetailOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

export function PrivateLandAnalysisRoot({ system, onDetailOpenChange, children }: Props) {
  const mapContext = useMapContext();
  const mapRef = mapContext?.mapInstanceRef;
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const setDrawSuspended = mapContext?.setMapDrawInputSuspended;

  const [layers, setLayers] = useState<PrivateLandAnalysisLayer[]>([]);
  const [layersLoading, setLayersLoading] = useState(true);
  const [layer, setLayer] = useState<PrivateLandAnalysisLayer | null>(null);
  const [phase, setPhase] = useState<PrivateLandAnalysisPhase>('layer');
  const [message, setMessage] = useState('');
  const [baseName, setBaseName] = useState('');
  const [zoneAreaSqm, setZoneAreaSqm] = useState<number | null>(null);
  const [parcels, setParcels] = useState<PrivateLandParcel[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [ownFilter, setOwnFilter] = useState(OWN_FILTER_ALL);
  const [keyword, setKeyword] = useState('');
  const [selectedPnu, setSelectedPnu] = useState<string | null>(null);
  const [riverKnown, setRiverKnown] = useState(false);
  const [includeTributary, setIncludeTributaryState] = useState(false);
  const [tribCandidateCount, setTribCandidateCount] = useState(0);
  const [tribCutCount, setTribCutCount] = useState(0);
  const [tributaryPicking, setTributaryPicking] = useState(false);
  const tribPickingRef = useRef(false);
  tribPickingRef.current = tributaryPicking;
  const [areaModalOpen, setAreaModalOpen] = useState(true);
  const [rangeChecking, setRangeChecking] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  /** 실제 지정 구간 확인 순번 — 지류 위 hover 미리보기와 구분 */
  const rangeSeqRef = useRef(0);
  const rangeBlockedRef = useRef(false);
  rangeBlockedRef.current = rangeChecking || rangeError != null;
  /** 이어진 하천 반대쪽 갈래를 막지 않음 — 끝까지 포함됨(안내만) */
  const [riverOpen, setRiverOpen] = useState(false);
  const rangeMode = privateLandRangeMode(layer);
  const rangeModeRef = useRef(rangeMode);
  rangeModeRef.current = rangeMode;
  /** 닫힌 범위 — 찍은 경계선 */
  const closedCutsRef = useRef<Chord[]>([]);
  const [closedLineCount, setClosedLineCount] = useState(0);
  /** 경계선이 아직 범위를 닫지 못함 — 오류가 아니라 더 찍어야 하는 상태 */
  const [closedOpen, setClosedOpen] = useState(false);
  const closedOpenRef = useRef(false);
  closedOpenRef.current = closedOpen;
  const [viewTooLarge, setViewTooLarge] = useState(false);
  const viewTooLargeRef = useRef(false);
  viewTooLargeRef.current = viewTooLarge;
  const [closedTool, setClosedToolState] = useState<PrivateLandClosedTool>('line');
  const closedToolRef = useRef<PrivateLandClosedTool>('line');
  closedToolRef.current = closedTool;
  /** 닫힌 범위 — 그린 도형(3857) */
  const shapeRef = useRef<Polygon | null>(null);
  const [hasShape, setHasShape] = useState(false);

  const sourceRef = useRef<VectorSource | null>(null);
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const baseRef = useRef<{
    geom: Polygon | MultiPolygon;
    segs: ReturnType<typeof collectSegments>;
    seams: Seam[];
    /** 다른 하천까지 합친 주변 면 — 끝 위치가 다른 하천으로 넘어갈 때 */
    all: { geom: Polygon | MultiPolygon; segs: ReturnType<typeof collectSegments> } | null;
  } | null>(null);
  const chord1Ref = useRef<Chord | null>(null);
  const chord2Ref = useRef<Chord | null>(null);
  /** 시작 위치 하천(본류) 기준 — 지류 제외용 */
  const riverRef = useRef<{ field: string; value: string } | null>(null);
  const includeTributaryRef = useRef(false);
  /** 본류 구간에 합류하는 지류 후보 (자르기 선 계산용) */
  const tribCandidatesRef = useRef<{ geom: Polygon | MultiPolygon; segs: ReturnType<typeof collectSegments> }[]>([]);
  const tribCutsRef = useRef<Chord[]>([]);
  /** 지류를 더하기 전 구간 — 지류 끝선이 합류부 어느 쪽인지 판정 */
  const tribMainRef = useRef<Polygon | MultiPolygon | null>(null);
  /** 지류 위 이동 끝선으로 늘린 미리보기를 보여주는 중 */
  const tribMovingRef = useRef(false);
  /** 이 기능이 켠 레이어·연속지적만 닫을 때 끔 */
  const addedLayerRef = useRef<string | null>(null);
  const cadastralOnRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const messageTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewSeqRef = useRef(0);

  const flash = useCallback((text: string) => {
    setMessage(text);
    if (messageTimerRef.current != null) window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage(''), 2800);
  }, []);

  useEffect(() => {
    let alive = true;
    setLayersLoading(true);
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'listPrivateLandAnalysisLayers',
          params: { system },
        });
        const data = res?.data ?? res;
        if (alive) setLayers(Array.isArray(data?.layers) ? (data.layers as PrivateLandAnalysisLayer[]) : []);
      } catch {
        if (alive) setLayers([]);
      } finally {
        if (alive) setLayersLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [system]);

  const ensureSource = useCallback((map: OlMap): VectorSource => {
    if (sourceRef.current && vectorLayerRef.current) return sourceRef.current;
    const source = new VectorSource();
    const vl = new VectorLayer({
      source,
      style: (f) => featureStyle(f as Feature<Geometry>),
      zIndex: 80,
    });
    vl.set('mapSplitNoMirror', true);
    map.addLayer(vl);
    sourceRef.current = source;
    vectorLayerRef.current = vl;
    return source;
  }, []);

  const removeKinds = useCallback((kinds: string[]) => {
    const source = sourceRef.current;
    if (!source) return;
    source
      .getFeatures()
      .filter((f) => kinds.includes(String(f.get('kind'))))
      .forEach((f) => source.removeFeature(f));
  }, []);

  const addFeature = useCallback(
    (kind: string, geom: Geometry, props?: Record<string, unknown>) => {
      const map = mapRef?.current;
      if (!map) return;
      const f = new Feature(geom);
      f.set('kind', kind);
      if (props) Object.entries(props).forEach(([k, v]) => f.set(k, v));
      ensureSource(map).addFeature(f);
    },
    [ensureSource, mapRef]
  );

  /** force — 이 기능이 켜지 않았어도(이미 켜져 있던 지적) 그대로 보냄 */
  const setCadastral = useCallback((on: boolean, force = false) => {
    if (!force && on === cadastralOnRef.current) return;
    cadastralOnRef.current = on;
    window.dispatchEvent(
      new CustomEvent('ggnr-map-control-set', {
        detail: { id: 'cadastral', active: on, tableNames: ['jijuk'] },
      })
    );
  }, []);

  const clearArea = useCallback(() => {
    if (previewTimerRef.current != null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    previewSeqRef.current += 1;
    removeKinds(['chordStart', 'chord1', 'chord2', 'preview', 'zone', 'parcel', 'tribCut', 'tribMoving', 'cut', 'shape']);
    closedCutsRef.current = [];
    shapeRef.current = null;
    setHasShape(false);
    setClosedLineCount(0);
    setClosedOpen(false);
    tribMovingRef.current = false;
    includeTributaryRef.current = false;
    setIncludeTributaryState(false);
    tribPickingRef.current = false;
    setTributaryPicking(false);
    baseRef.current = null;
    chord1Ref.current = null;
    chord2Ref.current = null;
    riverRef.current = null;
    tribCandidatesRef.current = [];
    tribCutsRef.current = [];
    tribMainRef.current = null;
    setRiverKnown(false);
    setTribCandidateCount(0);
    setTribCutCount(0);
    rangeSeqRef.current += 1;
    setRangeChecking(false);
    setRangeError(null);
    setRiverOpen(false);
    setBaseName('');
    setZoneAreaSqm(null);
    setParcels([]);
    setTruncated(false);
    setOwnFilter(OWN_FILTER_ALL);
    setKeyword('');
    setSelectedPnu(null);
    setMessage('');
    setCadastral(false);
  }, [removeKinds, setCadastral]);

  const hideAddedLayer = useCallback((table?: string | null) => {
    const name = table ?? addedLayerRef.current;
    if (!name) return;
    addedLayerRef.current = null;
    setVisibleLayerNames?.((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, [setVisibleLayerNames]);

  const selectLayer = useCallback(
    (table: string) => {
      const next = layers.find((l) => l.table === table) ?? null;
      if (!next) return;
      clearArea();
      const prevTable = addedLayerRef.current ?? layerRef.current?.table ?? null;
      if (prevTable && prevTable !== next.table) hideAddedLayer(prevTable);
      /** 닫힌 범위는 원래 레이어 대신 하나로 합친 면을 직접 그림 */
      if (privateLandRangeMode(next) !== 'closed') {
        addedLayerRef.current = next.table;
        setVisibleLayerNames?.((prev) => (prev.has(next.table) ? prev : new Set(prev).add(next.table)));
      }
      setLayer(next);
      setClosedToolState('line');
      setPhase('start');
      setAreaModalOpen(false);
    },
    [clearArea, hideAddedLayer, layers, setVisibleLayerNames]
  );

  const changeArea = useCallback(() => {
    clearArea();
    setAreaModalOpen(false);
    setPhase(layerRef.current ? 'start' : 'layer');
  }, [clearArea]);

  const resetAll = useCallback(() => {
    clearArea();
    hideAddedLayer(addedLayerRef.current ?? layerRef.current?.table ?? null);
    setLayer(null);
    setPhase('layer');
    setAreaModalOpen(true);
  }, [clearArea, hideAddedLayer]);

  /** 메뉴 닫힘 — 지도에 그린 것·켠 레이어 정리 */
  useEffect(
    () => () => {
      const map = mapRef?.current;
      if (map && vectorLayerRef.current) map.removeLayer(vectorLayerRef.current);
      vectorLayerRef.current = null;
      sourceRef.current = null;
      if (messageTimerRef.current != null) window.clearTimeout(messageTimerRef.current);
    },
    [mapRef]
  );
  useEffect(() => () => hideAddedLayer(), [hideAddedLayer]);
  useEffect(() => () => setCadastral(false), [setCadastral]);
  /** 지적은 분석 결과에서만 — 구간을 새로 지정하기 시작하면(재설정·영역 변경·다시 지정) 끈다 */
  useEffect(() => {
    if (phase === 'start') setCadastral(false, true);
  }, [phase, setCadastral]);

  /** 분석 모드 동안 기존 지도 클릭 식별 중지 */
  useEffect(() => {
    setDrawSuspended?.(true);
    return () => setDrawSuspended?.(false);
  }, [setDrawSuspended]);

  const drawChord2 = useCallback(
    (chord: Chord | null, preview: boolean) => {
      removeKinds(['chord2']);
      if (!chord || !chord1Ref.current) return;
      addFeature('chord2', chordGeometry(chord), { preview });
    },
    [addFeature, removeKinds]
  );

  const cancelPreview = useCallback(() => {
    if (previewTimerRef.current != null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    previewSeqRef.current += 1;
  }, []);

  /**
   * 지류 요청 값. 미리보기는 합류 지류가 있는지 알기 위해 항상 후보를 받고,
   * 적용·분석은 지류를 포함해 자른 곳이 있을 때만 보낸다.
   */
  const tributaryParams = useCallback((forPreview: boolean, cutsOverride?: Chord[]) => {
    if (!riverRef.current) return {};
    const cuts = cutsOverride ?? tribCutsRef.current;
    const include = includeTributaryRef.current && cuts.length > 0;
    if (!forPreview && !include) return {};
    const wkt = new WKT();
    return {
      includeTributary: true,
      tributaryLines: include ? cuts.map((c) => wkt.writeGeometry(chordGeometry(c))) : [],
    };
  }, []);

  /** 합류 지류 후보 — 지도에는 그리지 않고 지류 끝 찍기 판정에만 사용 */
  const storeTribCandidates = useCallback((raws: unknown) => {
    const list: typeof tribCandidatesRef.current = [];
    if (Array.isArray(raws)) {
      for (const raw of raws) {
        const geom = toAreaGeometry(readGeometry3857(raw));
        if (geom) list.push({ geom, segs: collectSegments(geom) });
      }
    }
    tribCandidatesRef.current = list;
    setTribCandidateCount(list.length);
  }, []);

  const drawTribCuts = useCallback(() => {
    removeKinds(['tribCut']);
    for (const c of tribCutsRef.current) addFeature('tribCut', chordGeometry(c));
    setTribCutCount(tribCutsRef.current.length);
  }, [addFeature, removeKinds]);

  /** 두 선 사이 하천 구간(하천 모양 그대로) 미리보기 — 적용과 같은 서버 계산 */
  const requestZonePreview = useCallback(
    (chord: Chord, delayMs: number, cutsOverride?: Chord[]) => {
      cancelPreview();
      const c1 = chord1Ref.current;
      const current = layerRef.current;
      if (!c1 || !current) return;
      const seq = previewSeqRef.current;
      const fixed = phaseRef.current === 'ranged';
      const realCheck = fixed && cutsOverride == null;
      const run = async () => {
        const rangeSeq = realCheck ? ++rangeSeqRef.current : 0;
        if (realCheck) setRangeChecking(true);
        const settleRange = (error: string | null, open = false) => {
          if (!realCheck || rangeSeq !== rangeSeqRef.current) return;
          setRangeError(error);
          setRiverOpen(open);
          setRangeChecking(false);
        };
        const wkt = new WKT();
        try {
          const res = await call('', 'POST', {
            service: 'privateLandAnalysisService',
            action: 'computePrivateLandAnalysisZone',
            params: {
              layer: current.table,
              line1Wkt3857: wkt.writeGeometry(chordGeometry(c1)),
              line2Wkt3857: wkt.writeGeometry(chordGeometry(chord)),
              river: riverRef.current,
              ...(fixed ? tributaryParams(true, cutsOverride) : {}),
            },
          });
          const data = res?.data ?? res;
          const geom = readGeometry3857(data?.zoneGeometry3857);
          settleRange(
            geom ? null : String(data?.error || '두 선 사이의 구간을 찾지 못했습니다. 구간을 다시 지정하세요.'),
            geom != null && data?.open === true
          );
          if (seq !== previewSeqRef.current) return;
          const p = phaseRef.current;
          if (p !== 'end' && p !== 'ranged') return;
          removeKinds(['preview']);
          if (geom) addFeature('preview', geom);
          if (fixed) {
            storeTribCandidates(data?.tributaryCandidates3857);
            const mainGeom = toAreaGeometry(readGeometry3857(data?.mainGeometry3857));
            if (mainGeom) tribMainRef.current = mainGeom;
          }
          /** 끝선 너머 하천에 찍은 지류 끝선 → 새 끝선으로 바꿈 */
          const swap = data?.endSwapIndex;
          const swapCut = realCheck && typeof swap === 'number' ? tribCutsRef.current[swap] : undefined;
          if (swapCut) {
            chord2Ref.current = swapCut;
            tribCutsRef.current = tribCutsRef.current.filter((_, i) => i !== swap);
            drawChord2(swapCut, false);
            drawTribCuts();
          }
        } catch {
          settleRange('구간을 확인하지 못했습니다. 구간을 다시 지정하세요.');
        }
      };
      if (delayMs <= 0) {
        void run();
        return;
      }
      previewTimerRef.current = window.setTimeout(() => {
        previewTimerRef.current = null;
        void run();
      }, delayMs);
    },
    [addFeature, cancelPreview, drawChord2, drawTribCuts, removeKinds, storeTribCandidates, tributaryParams]
  );

  useEffect(() => () => cancelPreview(), [cancelPreview]);

  /** 지류 설정이 바뀌면 적용 전 단계로 되돌리고 다시 미리보기 */
  const refreshRanged = useCallback(() => {
    const c2 = chord2Ref.current;
    const p = phaseRef.current;
    if (!c2 || (p !== 'ranged' && p !== 'applied')) return;
    if (p === 'applied') {
      removeKinds(['zone']);
      setZoneAreaSqm(null);
      phaseRef.current = 'ranged';
      setPhase('ranged');
    }
    requestZonePreview(c2, 0);
  }, [removeKinds, requestZonePreview]);

  const setIncludeTributary = useCallback(
    (on: boolean) => {
      includeTributaryRef.current = on;
      setIncludeTributaryState(on);
      removeKinds(['tribMoving']);
      if (!on) {
        tribPickingRef.current = false;
        setTributaryPicking(false);
      }
      if (on || tribCutsRef.current.length === 0) return;
      tribCutsRef.current = [];
      drawTribCuts();
      refreshRanged();
    },
    [drawTribCuts, refreshRanged, removeKinds]
  );

  const openTributaryPick = useCallback(() => {
    setIncludeTributary(true);
    tribPickingRef.current = true;
    setTributaryPicking(true);
  }, [setIncludeTributary]);

  const closeTributaryPick = useCallback(() => {
    tribPickingRef.current = false;
    setTributaryPicking(false);
    const target = mapRef?.current?.getTargetElement();
    if (target) target.style.cursor = '';
    if (tribMovingRef.current) {
      removeKinds(['tribMoving']);
      tribMovingRef.current = false;
      const c2 = chord2Ref.current;
      if (c2) requestZonePreview(c2, 0);
    }
    if (tribCutsRef.current.length === 0) setIncludeTributary(false);
  }, [mapRef, removeKinds, requestZonePreview, setIncludeTributary]);

  const undoTributaryCut = useCallback(() => {
    if (tribCutsRef.current.length === 0) return;
    tribCutsRef.current = tribCutsRef.current.slice(0, -1);
    drawTribCuts();
    refreshRanged();
  }, [drawTribCuts, refreshRanged]);

  /** 커서 아래 지류를 가로지르는 끝선과, 그 지류의 기존 끝선을 바꾼 끝선 목록 */
  const tribCutAt = useCallback(
    (coord: Coordinate): { chord: Chord; cuts: Chord[] } | null => {
      const res = mapRef?.current?.getView().getResolution() ?? 1;
      const base = baseRef.current;
      for (const cand of tribCandidatesRef.current) {
        const p = snapInside(cand.geom, coord, SNAP_PX * res);
        if (!p) continue;
        const widthChord = shortestChordAt(cand.geom, cand.segs, p);
        if (!widthChord) continue;
        /** 이 지류 경계 위 접선(합류부 경계 등) 가까이면 그 접선을 끝선으로 */
        const seam = base
          ? seamChordNear(base.seams, coord, SEAM_SNAP_PX * res, widthChord, base.all?.segs ?? base.segs)
          : null;
        const seamPts = seam ? (seam.path ?? [seam[0], seam[1]]) : [];
        const seamMid = seamPts[Math.floor(seamPts.length / 2)];
        const onCand =
          seamMid != null &&
          (() => {
            const q = cand.geom.getClosestPoint(seamMid);
            return Math.hypot(q[0] - seamMid[0], q[1] - seamMid[1]) <= TRIB_SEAM_TOL_M + 3 * res;
          })();
        const chord = seam && onCand ? seam : widthChord;
        /** 같은 후보 안, 합류부 같은 쪽의 가까운 끝선만 교체 — 큰 하천은 합류부 양쪽을 따로 막을 수 있게 */
        const newMid = chordMid(chord);
        const newLen = chordLength(chord);
        const junction = tribMainRef.current?.getClosestPoint(newMid) ?? null;
        const sameSide = (mid: Coordinate, len: number): boolean => {
          if (!junction) return true;
          const ax = newMid[0] - junction[0];
          const ay = newMid[1] - junction[1];
          const bx = mid[0] - junction[0];
          const by = mid[1] - junction[1];
          const minOff = 0.25 * Math.max(newLen, len);
          if (Math.hypot(ax, ay) < minOff || Math.hypot(bx, by) < minOff) return true;
          return ax * bx + ay * by > 0;
        };
        const others = tribCutsRef.current.filter((c) => {
          const mid = chordMid(c);
          if (!cand.geom.intersectsCoordinate(mid)) return true;
          const len = chordLength(c);
          const reach = TRIB_REPLACE_FACTOR * Math.max(newLen, len);
          if (Math.hypot(mid[0] - newMid[0], mid[1] - newMid[1]) > reach) return true;
          return !sameSide(mid, len);
        });
        return { chord, cuts: [...others, chord] };
      }
      return null;
    },
    [mapRef]
  );

  /** 지류 위 클릭 → 그 위치 끝선 확정 (지류당 1개, 다시 찍으면 교체) */
  const pickTributaryCut = useCallback(
    (coord: Coordinate): boolean => {
      const hit = tribCutAt(coord);
      if (!hit) return false;
      removeKinds(['tribMoving']);
      tribMovingRef.current = false;
      tribCutsRef.current = hit.cuts;
      drawTribCuts();
      refreshRanged();
      return true;
    },
    [drawTribCuts, refreshRanged, removeKinds, tribCutAt]
  );

  /** 시작 위치 찍기 전 — 화면 범위 레이어 면으로 찍을 수 있는 곳 판정 */
  const layerViewRef = useRef<{
    geom: Polygon | MultiPolygon | null;
    segs: ReturnType<typeof collectSegments>;
    seams: Seam[];
    bbox: number[];
  } | null>(null);

  /** 시작 위치 — 커서 위치 하천 폭 방향 선과, 가까운 접선이 있으면 그 접선 */
  const startChordAt = useCallback(
    (coord: Coordinate): { width: Chord | null; seam: Chord | null } => {
      const view = layerViewRef.current;
      if (!view?.geom || view.segs.length === 0) return { width: null, seam: null };
      const res = mapRef?.current?.getView().getResolution() ?? 1;
      const p = snapInside(view.geom, coord, 2 * res);
      const width = p ? shortestChordAt(view.geom, view.segs, p) : null;
      /** 화면 범위 면은 해상도, 접선은 해상도 절반으로 단순화돼 내려옴 */
      return { width, seam: seamChordNear(view.seams, coord, SEAM_SNAP_PX * res, width, view.segs, 2 * res) };
    },
    [mapRef]
  );

  const pickStart = useCallback(
    async (coord: Coordinate) => {
      const current = layerRef.current;
      if (!current) return;
      const viewSeam = startChordAt(coord).seam;
      removeKinds(['chordStart']);
      setPhase('loadingBase');
      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'getPrivateLandAnalysisBase',
          params: { layer: current.table, x: coord[0], y: coord[1] },
        });
        const data = res?.data ?? res;
        if (layerRef.current?.table !== current.table) return;
        if (!data?.inside) {
          flash(data?.error ? String(data.error) : '선택한 레이어 범위가 아닙니다.');
          setPhase('start');
          return;
        }
        const geom = toAreaGeometry(readGeometry3857(data.geometry3857));
        if (!geom) {
          flash('하천 도형을 불러오지 못했습니다.');
          setPhase('start');
          return;
        }
        const segs = collectSegments(geom);
        const seams = readSeams3857(data.seams3857);
        const allGeom = toAreaGeometry(readGeometry3857(data.allGeometry3857));
        const all = allGeom ? { geom: allGeom, segs: collectSegments(allGeom) } : null;
        const widthChord = shortestChordAt(geom, segs, coord);
        if (!widthChord) {
          flash('이 위치에서는 하천을 가로지르는 선을 만들 수 없습니다.');
          setPhase('start');
          return;
        }
        const resolution = mapRef?.current?.getView().getResolution() ?? 1;
        const chord =
          viewSeam ??
          seamChordNear(seams, coord, SEAM_SNAP_PX * resolution, widthChord, all?.segs ?? segs) ??
          widthChord;
        baseRef.current = { geom, segs, seams, all };
        chord1Ref.current = chord;
        riverRef.current = data.river && typeof data.river === 'object' ? data.river : null;
        setRiverKnown(riverRef.current != null);
        setBaseName(String(data.name ?? '').trim());
        addFeature('chord1', chordGeometry(chord));
        setPhase('end');
      } catch {
        flash('하천 도형을 불러오지 못했습니다.');
        setPhase('start');
      }
    },
    [addFeature, flash, mapRef, removeKinds, startChordAt]
  );

  const chordAt = useCallback(
    (coord: Coordinate): Chord | null => {
      const base = baseRef.current;
      if (!base) return null;
      const res = mapRef?.current?.getView().getResolution() ?? 1;
      const edgeSegs = base.all?.segs ?? base.segs;
      /** 시작 하천 밖이지만 이어진 다른 하천 위 — 그 하천을 가로지르는 끝선 */
      if (!base.geom.intersectsCoordinate(coord) && base.all?.geom.intersectsCoordinate(coord)) {
        const widthChord = shortestChordAt(base.all.geom, base.all.segs, coord);
        return seamChordNear(base.seams, coord, SEAM_SNAP_PX * res, widthChord, edgeSegs) ?? widthChord;
      }
      const p = snapInside(base.geom, coord, SNAP_PX * res);
      if (!p) return null;
      const widthChord = shortestChordAt(base.geom, base.segs, p);
      return seamChordNear(base.seams, coord, SEAM_SNAP_PX * res, widthChord, edgeSegs) ?? widthChord;
    },
    [mapRef]
  );

  const startAllowed = useCallback(
    (coord: Coordinate): boolean => {
      const view = layerViewRef.current;
      if (!view) return rangeModeRef.current !== 'closed';
      const [x1, y1, x2, y2] = view.bbox;
      if (coord[0] < x1 || coord[0] > x2 || coord[1] < y1 || coord[1] > y2) return true;
      if (!view.geom) return false;
      const res = mapRef?.current?.getView().getResolution() ?? 1;
      return snapInside(view.geom, coord, 2 * res) != null;
    },
    [mapRef]
  );

  /** 시작 점찍기 전 — 커서 위치에서 하천을 가로지르는 점선 */
  const drawStartChordPreview = useCallback(
    (coord: Coordinate | null) => {
      removeKinds(['chordStart']);
      if (!coord) return;
      const { width, seam } = startChordAt(coord);
      const chord = seam ?? width;
      if (chord) addFeature('chordStart', chordGeometry(chord));
    },
    [addFeature, removeKinds, startChordAt]
  );

  /** 닫힌 범위 — 커서 위치에서 합친 면을 가로지르는 경계선 */
  const closedChordAt = useCallback(
    (coord: Coordinate): Chord | null => {
      const view = layerViewRef.current;
      if (!view?.geom || view.segs.length === 0) return null;
      const res = mapRef?.current?.getView().getResolution() ?? 1;
      const p = snapInside(view.geom, coord, 2 * res);
      return p ? shortestChordAt(view.geom, view.segs, p) : null;
    },
    [mapRef]
  );

  /** 닫힌 범위 — 찍은 경계선으로 둘러싼 구간 미리보기·문제 판정 */
  const requestClosedPreview = useCallback(() => {
    cancelPreview();
    removeKinds(['preview']);
    const current = layerRef.current;
    const cuts = closedCutsRef.current;
    const rangeSeq = ++rangeSeqRef.current;
    if (!current || cuts.length < 2) {
      setRangeChecking(false);
      setRangeError(null);
      setClosedOpen(cuts.length > 0);
      return;
    }
    const seq = previewSeqRef.current;
    setRangeChecking(true);
    const wkt = new WKT();
    void (async () => {
      let error: string | null = null;
      let geom: Geometry | null = null;
      let open = false;
      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'computePrivateLandAnalysisZone',
          params: { layer: current.table, lines: cuts.map((c) => wkt.writeGeometry(chordGeometry(c))) },
        });
        const data = res?.data ?? res;
        geom = readGeometry3857(data?.zoneGeometry3857);
        open = !geom && data?.open === true;
        if (!geom && !open) error = String(data?.error || '경계선으로 둘러싸인 구간을 찾지 못했습니다.');
      } catch {
        error = '구간을 확인하지 못했습니다. 경계선을 다시 확인하세요.';
      }
      if (rangeSeq !== rangeSeqRef.current || seq !== previewSeqRef.current) return;
      setRangeError(error);
      setClosedOpen(open);
      setRangeChecking(false);
      if (phaseRef.current !== 'ranged') return;
      removeKinds(['preview']);
      if (geom) addFeature('preview', geom, { closed: true });
    })();
  }, [addFeature, cancelPreview, removeKinds]);

  /** 닫힌 범위 — 그린 도형 안 도로 면 미리보기 */
  const requestShapePreview = useCallback(() => {
    cancelPreview();
    removeKinds(['preview']);
    const current = layerRef.current;
    const shape = shapeRef.current;
    const rangeSeq = ++rangeSeqRef.current;
    setClosedOpen(false);
    if (!current || !shape) {
      setRangeChecking(false);
      setRangeError(null);
      return;
    }
    const seq = previewSeqRef.current;
    setRangeChecking(true);
    void (async () => {
      let error: string | null = null;
      let geom: Geometry | null = null;
      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'computePrivateLandAnalysisZone',
          params: { layer: current.table, polygonWkt3857: new WKT().writeGeometry(shape) },
        });
        const data = res?.data ?? res;
        geom = readGeometry3857(data?.zoneGeometry3857);
        if (!geom) error = String(data?.error || '도형 안에 도로가 없습니다. 도로 위에 다시 그리세요.');
      } catch {
        error = '구간을 확인하지 못했습니다. 도형을 다시 그리세요.';
      }
      if (rangeSeq !== rangeSeqRef.current || seq !== previewSeqRef.current) return;
      setRangeError(error);
      setRangeChecking(false);
      if (phaseRef.current !== 'ranged') return;
      removeKinds(['preview']);
      if (geom) addFeature('preview', geom, { closed: true });
    })();
  }, [addFeature, cancelPreview, removeKinds]);

  /** 닫힌 범위 — 찍은 선·그린 도형을 지우고 지정 처음(그리기 대기)으로 */
  const clearClosedRange = useCallback(() => {
    cancelPreview();
    removeKinds(['cut', 'chordStart', 'preview', 'shape']);
    closedCutsRef.current = [];
    setClosedLineCount(0);
    setClosedOpen(false);
    shapeRef.current = null;
    setHasShape(false);
    rangeSeqRef.current += 1;
    setRangeChecking(false);
    setRangeError(null);
    phaseRef.current = 'start';
    setPhase('start');
  }, [cancelPreview, removeKinds]);

  const setClosedTool = useCallback(
    (tool: PrivateLandClosedTool) => {
      if (tool === closedToolRef.current) return;
      if (tool !== 'line') {
        const blocker = getBlockingMapDrawInteraction(mapContext);
        if (blocker) {
          notifyMapDrawInteractionBlocked(blocker, 'spatialSearch');
          return;
        }
      }
      clearClosedRange();
      closedToolRef.current = tool;
      setClosedToolState(tool);
    },
    [clearClosedRange, mapContext]
  );

  const redrawShape = useCallback(() => {
    if (closedToolRef.current !== 'line') clearClosedRange();
  }, [clearClosedRange]);

  /** 닫힌 범위 — 도형 그리기. 다 그리면 이전 도형을 바꾸고 미리보기 */
  const shapeDrawActive =
    rangeMode === 'closed' && closedTool !== 'line' && (phase === 'start' || phase === 'ranged');
  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !shapeDrawActive) return;
    const draw =
      closedTool === 'rect'
        ? new Draw({ type: 'Circle', geometryFunction: createBox(), stopClick: true })
        : closedTool === 'circle'
          ? new Draw({ type: 'Circle', stopClick: true })
          : new Draw({ type: 'Polygon', stopClick: true });
    draw.on('drawend', (evt) => {
      const raw = evt.feature.getGeometry();
      const shape = raw?.getType() === 'Circle' ? fromCircle(raw as CircleGeom, 64) : raw;
      if (!(shape instanceof Polygon)) return;
      shapeRef.current = shape;
      setHasShape(true);
      removeKinds(['shape']);
      addFeature('shape', shape);
      if (phaseRef.current !== 'ranged') {
        phaseRef.current = 'ranged';
        setPhase('ranged');
      }
      requestShapePreview();
    });
    map.addInteraction(draw);
    return () => {
      map.removeInteraction(draw);
    };
  }, [addFeature, closedTool, mapRef, removeKinds, requestShapePreview, shapeDrawActive]);

  const drawClosedCuts = useCallback(() => {
    removeKinds(['cut']);
    for (const c of closedCutsRef.current) addFeature('cut', chordGeometry(c));
    setClosedLineCount(closedCutsRef.current.length);
  }, [addFeature, removeKinds]);

  /** 닫힌 범위 — 지도 클릭으로 경계선 추가 */
  const addClosedLine = useCallback(
    (coord: Coordinate) => {
      if (!layerViewRef.current) {
        flash(viewTooLargeRef.current ? '지도를 더 확대한 뒤 찍으세요.' : '도로 면을 불러오는 중입니다.');
        return;
      }
      const chord = closedChordAt(coord);
      if (!chord) {
        flash('도로 위를 찍으세요.');
        return;
      }
      for (const c of closedCutsRef.current) {
        const invalid = invalidChordPair(c, chord);
        if (invalid) {
          flash(invalid.includes('겹칩니다') ? '기존 경계선과 겹칩니다. 다른 위치를 찍으세요.' : '기존 경계선과 너무 가깝습니다.');
          return;
        }
      }
      closedCutsRef.current = [...closedCutsRef.current, chord];
      drawClosedCuts();
      if (phaseRef.current !== 'ranged') {
        phaseRef.current = 'ranged';
        setPhase('ranged');
      }
      requestClosedPreview();
    },
    [closedChordAt, drawClosedCuts, flash, requestClosedPreview]
  );

  const undoLastLine = useCallback(() => {
    if (phaseRef.current !== 'ranged' || closedCutsRef.current.length === 0) return;
    closedCutsRef.current = closedCutsRef.current.slice(0, -1);
    drawClosedCuts();
    if (closedCutsRef.current.length === 0) {
      phaseRef.current = 'start';
      setPhase('start');
    }
    requestClosedPreview();
  }, [drawClosedCuts, requestClosedPreview]);

  /**
   * 화면 범위 레이어 면 — 하천은 시작 위치 찍기 전 판정용,
   * 닫힌 범위(도로)는 하나로 합친 면을 지도에 그리고 경계선 계산에도 쓴다.
   */
  const closedMode = rangeMode === 'closed';
  const layerViewActive = closedMode ? phase !== 'layer' : phase === 'start';
  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !layer || !layerViewActive) return;
    let seq = 0;
    let timer = 0;
    const drawBase = (geom: Geometry | null) => {
      if (!closedMode) return;
      removeKinds(['layerBase']);
      if (geom) addFeature('layerBase', geom);
    };
    const load = async () => {
      const mine = ++seq;
      const view = map.getView();
      const bbox = view.calculateExtent(map.getSize());
      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'getPrivateLandAnalysisLayerView',
          params: { layer: layer.table, bbox, tolerance: view.getResolution() ?? 1 },
        });
        if (mine !== seq) return;
        const data = res?.data ?? res;
        const geom = toAreaGeometry(readGeometry3857(data?.geometry3857));
        const usable = !data?.tooLarge && !data?.error;
        layerViewRef.current = usable
          ? { geom, segs: geom ? collectSegments(geom) : [], seams: readSeams3857(data?.seams3857), bbox }
          : null;
        setViewTooLarge(data?.tooLarge === true);
        drawBase(usable ? geom : null);
      } catch {
        if (mine !== seq) return;
        layerViewRef.current = null;
        drawBase(null);
      }
    };
    void load();
    const onMoveEnd = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 200);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      seq += 1;
      window.clearTimeout(timer);
      map.un('moveend', onMoveEnd);
      layerViewRef.current = null;
      setViewTooLarge(false);
      removeKinds(['layerBase']);
    };
  }, [addFeature, closedMode, layer, layerViewActive, mapRef, removeKinds]);

  /** 시작·끝 지정 — 지도 클릭·이동 */
  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !layer) return;
    const target = map.getTargetElement();
    let raf = 0;
    let lastCoord: Coordinate | null = null;
    /** 마지막으로 미리보기가 보였던 커서 위치 — 클릭 위치에서 선을 못 만들 때 대신 사용 */
    let hover: { phase: PrivateLandAnalysisPhase; coord: Coordinate; chord: Chord | null } | null = null;
    let lastClick: { at: number; pixel: number[] } | null = null;
    let down: { at: number; x: number; y: number; clicked: boolean } | null = null;

    /** 사유지분석이 바꾼 커서 — 지정 단계가 끝나면(분석 적용 등) 이 커서만 되돌려 다른 지도 기능 커서는 건드리지 않음 */
    let ownCursor: string | null = null;
    const setCursor = (value: string) => {
      if (!target) return;
      target.style.cursor = value;
      ownCursor = value;
    };
    const clearCursor = () => {
      if (target && ownCursor !== null && target.style.cursor === ownCursor) target.style.cursor = '';
      ownCursor = null;
    };

    const setHover = (coord: Coordinate, chord: Chord | null) => {
      hover = chord ? { phase: phaseRef.current, coord, chord } : null;
    };
    /** 클릭 위치 근처에서 같은 단계에 미리보기로 보였던 위치 */
    const hoverNear = (pixel: number[]): typeof hover => {
      if (!hover || hover.phase !== phaseRef.current) return null;
      const hp = map.getPixelFromCoordinate(hover.coord);
      if (!hp) return null;
      return Math.hypot(hp[0] - pixel[0], hp[1] - pixel[1]) <= CLICK_HOVER_TOL_PX ? hover : null;
    };

    const onMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (evt.dragging) return;
      const p = phaseRef.current;
      if (rangeModeRef.current === 'closed') {
        if ((p !== 'start' && p !== 'ranged') || closedToolRef.current !== 'line') {
          clearCursor();
          return;
        }
        lastCoord = evt.coordinate;
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          const now = phaseRef.current;
          if ((now !== 'start' && now !== 'ranged') || closedToolRef.current !== 'line' || !lastCoord) return;
          const chord = closedChordAt(lastCoord);
          setHover(lastCoord, chord);
          setCursor(chord ? 'crosshair' : 'not-allowed');
          removeKinds(['chordStart']);
          if (chord) addFeature('chordStart', chordGeometry(chord));
        });
        return;
      }
      if (p === 'start') {
        lastCoord = evt.coordinate;
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          if (phaseRef.current !== 'start' || !lastCoord) return;
          const allowed = startAllowed(lastCoord);
          const { width, seam } = allowed ? startChordAt(lastCoord) : { width: null, seam: null };
          setHover(lastCoord, seam ?? width);
          setCursor(allowed ? 'crosshair' : 'not-allowed');
          drawStartChordPreview(allowed ? lastCoord : null);
        });
        return;
      }
      if (p === 'ranged') {
        if (!tribPickingRef.current) {
          clearCursor();
          return;
        }
        lastCoord = evt.coordinate;
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          const c2 = chord2Ref.current;
          if (phaseRef.current !== 'ranged' || !tribPickingRef.current || !lastCoord || !c2) return;
          const hit = tribCutAt(lastCoord);
          setHover(lastCoord, hit?.chord ?? null);
          if (hit) setCursor('crosshair');
          else clearCursor();
          removeKinds(['tribMoving']);
          if (hit) {
            addFeature('tribMoving', chordGeometry(hit.chord));
            tribMovingRef.current = true;
            requestZonePreview(c2, PREVIEW_DEBOUNCE_MS, hit.cuts);
          } else if (tribMovingRef.current) {
            tribMovingRef.current = false;
            requestZonePreview(c2, PREVIEW_DEBOUNCE_MS);
          }
        });
        return;
      }
      if (p !== 'end') {
        clearCursor();
        return;
      }
      lastCoord = evt.coordinate;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (phaseRef.current !== 'end' || !lastCoord) return;
        const chord = chordAt(lastCoord);
        setHover(lastCoord, chord);
        setCursor(chord ? 'crosshair' : 'not-allowed');
        drawChord2(chord, true);
        if (chord) requestZonePreview(chord, PREVIEW_DEBOUNCE_MS);
      });
    };

    /** 이 단계에서 지도 클릭을 사유지분석이 가져감(다른 지도 클릭·더블클릭 확대 막음) */
    const ownsClick = (): boolean => {
      const p = phaseRef.current;
      /** 도형 그리기 중에는 그리기 도구가 클릭·더블클릭을 받는다 */
      if (rangeModeRef.current === 'closed') return (p === 'start' || p === 'ranged') && closedToolRef.current === 'line';
      return p === 'start' || p === 'loadingBase' || p === 'end' || (p === 'ranged' && tribPickingRef.current);
    };

    const handleClick = (coordinate: Coordinate, pixel: number[]) => {
      const now = Date.now();
      if (
        lastClick &&
        now - lastClick.at < CLICK_DEDUPE_MS &&
        Math.hypot(lastClick.pixel[0] - pixel[0], lastClick.pixel[1] - pixel[1]) <= CLICK_DEDUPE_PX
      ) {
        return;
      }
      lastClick = { at: now, pixel };
      const near = hoverNear(pixel);
      const p = phaseRef.current;
      if (rangeModeRef.current === 'closed') {
        if ((p !== 'start' && p !== 'ranged') || closedToolRef.current !== 'line') return;
        addClosedLine(closedChordAt(coordinate) || !near ? coordinate : near.coord);
        return;
      }
      if (p === 'start') {
        const at = startAllowed(coordinate) ? coordinate : near?.coord;
        if (!at) {
          flash('선택한 레이어 범위가 아닙니다.');
          return;
        }
        void pickStart(at);
        return;
      }
      if (p === 'end') {
        const chord = chordAt(coordinate) ?? near?.chord ?? null;
        if (!chord) {
          flash('선택한 레이어 범위가 아닙니다.');
          return;
        }
        chord2Ref.current = chord;
        drawChord2(chord, false);
        const c1 = chord1Ref.current;
        clearCursor();
        phaseRef.current = 'ranged';
        setPhase('ranged');
        const invalid = c1 ? invalidChordPair(c1, chord) : null;
        if (invalid) {
          cancelPreview();
          removeKinds(['preview']);
          rangeSeqRef.current += 1;
          setRangeChecking(false);
          setRangeError(invalid);
          setRiverOpen(false);
          return;
        }
        requestZonePreview(chord, 0);
        return;
      }
      if (p === 'ranged' && tribPickingRef.current) {
        if (pickTributaryCut(coordinate)) return;
        if (near && pickTributaryCut(near.coord)) return;
        flash('포함할 지류 위를 찍으세요.');
      }
    };

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (down) down.clicked = true;
      if (!ownsClick()) return;
      evt.stopPropagation();
      handleClick(evt.coordinate, evt.pixel);
    };

    const onDblClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (ownsClick()) evt.stopPropagation();
    };

    /** 누른 채 조금 움직여 지도 끌기로 처리돼 클릭이 사라진 경우 */
    const viewport = map.getViewport();
    const onMapSurface = (e: PointerEvent): boolean => {
      const el = e.target as Node | null;
      return el != null && viewport.contains(el) && !map.getOverlayContainerStopEvent().contains(el);
    };
    const onPointerDown = (e: PointerEvent) => {
      down =
        e.isPrimary && e.button === 0 && onMapSurface(e)
          ? { at: Date.now(), x: e.clientX, y: e.clientY, clicked: false }
          : null;
    };
    const onPointerUp = (e: PointerEvent) => {
      const d = down;
      if (!d || !e.isPrimary || e.button !== 0) return;
      if (Date.now() - d.at > CLICK_MAX_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_MOVE_TOL_PX) {
        down = null;
        return;
      }
      window.setTimeout(() => {
        if (down === d) down = null;
        if (d.clicked || !ownsClick()) return;
        const pixel = map.getEventPixel(e);
        const coordinate = map.getCoordinateFromPixel(pixel);
        if (coordinate) handleClick(coordinate, pixel);
      }, 0);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || phaseRef.current !== 'end') return;
      cancelPreview();
      removeKinds(['chord1', 'chord2', 'preview']);
      baseRef.current = null;
      chord1Ref.current = null;
      setPhase('start');
    };

    const moveKey = map.on('pointermove', onMove as never);
    const clickKey = map.on('click', onClick as never);
    const dblClickKey = map.on('dblclick', onDblClick as never);
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKey);
    return () => {
      unByKey(moveKey);
      unByKey(clickKey);
      unByKey(dblClickKey);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKey);
      if (raf) window.cancelAnimationFrame(raf);
      if (target) target.style.cursor = '';
      removeKinds(['chordStart']);
    };
  }, [
    addClosedLine,
    closedChordAt,
    cancelPreview,
    chordAt,
    drawChord2,
    drawStartChordPreview,
    flash,
    layer,
    mapRef,
    pickStart,
    addFeature,
    pickTributaryCut,
    removeKinds,
    requestZonePreview,
    startAllowed,
    startChordAt,
    tribCutAt,
  ]);

  const chordWkts = useCallback(() => {
    const c1 = chord1Ref.current;
    const c2 = chord2Ref.current;
    if (!c1 || !c2) return null;
    const wkt = new WKT();
    return {
      line1Wkt3857: wkt.writeGeometry(chordGeometry(c1)),
      line2Wkt3857: wkt.writeGeometry(chordGeometry(c2)),
    };
  }, []);

  const apply = useCallback(() => {
    const current = layerRef.current;
    if (!current || phaseRef.current !== 'ranged' || rangeBlockedRef.current) return;
    let params: Record<string, unknown>;
    if (rangeModeRef.current === 'closed' && closedToolRef.current !== 'line') {
      const shape = shapeRef.current;
      if (!shape) return;
      params = { layer: current.table, polygonWkt3857: new WKT().writeGeometry(shape) };
    } else if (rangeModeRef.current === 'closed') {
      if (closedCutsRef.current.length < 2 || closedOpenRef.current) return;
      const wkt = new WKT();
      params = { layer: current.table, lines: closedCutsRef.current.map((c) => wkt.writeGeometry(chordGeometry(c))) };
      removeKinds(['chordStart']);
    } else {
      const lines = chordWkts();
      if (!lines) return;
      params = { layer: current.table, ...lines, river: riverRef.current, ...tributaryParams(false) };
    }
    tribPickingRef.current = false;
    setTributaryPicking(false);
    removeKinds(['tribMoving']);
    tribMovingRef.current = false;
    setPhase('applying');
    /** 분석 실패 — 구간은 그대로 두고 적용 전으로 되돌려 다시 적용할 수 있게 */
    const backToRanged = (text: string) => {
      removeKinds(['zone']);
      setZoneAreaSqm(null);
      flash(text);
      setPhase('ranged');
    };
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'computePrivateLandAnalysisZone',
          params,
        });
        const data = res?.data ?? res;
        const geom = readGeometry3857(data?.zoneGeometry3857);
        if (data?.error || !geom) {
          removeKinds(['preview']);
          setRangeError(data?.error ? String(data.error) : '구간을 계산하지 못했습니다. 구간을 다시 지정하세요.');
          setPhase('ranged');
          return;
        }
        removeKinds(['preview', 'zone']);
        addFeature('zone', geom);
        setZoneAreaSqm(typeof data?.areaSqm === 'number' ? data.areaSqm : null);
        setPhase('analyzing');
      } catch {
        setRangeError('구간을 계산하지 못했습니다. 구간을 다시 지정하세요.');
        setPhase('ranged');
        return;
      }

      try {
        const res = await call('', 'POST', {
          service: 'privateLandAnalysisService',
          action: 'listPrivateLandAnalysisParcels',
          params,
        });
        const data = res?.data ?? res;
        if (data?.error) {
          backToRanged(String(data.error));
          return;
        }
        const rows = (Array.isArray(data?.parcels) ? (data.parcels as PrivateLandParcel[]) : []).map((r) => ({
          ...r,
          ownGbn: ownGbnLabel(r.ownGbn),
        }));
        setParcels(rows);
        setTruncated(data?.truncated === true);
        setOwnFilter(OWN_FILTER_ALL);
        setKeyword('');
        setSelectedPnu(null);
        setPhase('result');
        setCadastral(true);
        const map = mapRef?.current;
        const zone = sourceRef.current?.getFeatures().find((f) => f.get('kind') === 'zone');
        const ext = zone?.getGeometry()?.getExtent();
        if (map && ext) {
          scheduleFitMapToExtent3857(map, ext as [number, number, number, number], {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          });
        }
      } catch {
        backToRanged('필지 목록을 불러오지 못했습니다.');
      }
    })();
  }, [addFeature, chordWkts, flash, mapRef, removeKinds, setCadastral, tributaryParams]);

  const filteredParcels = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return parcels.filter((p) => {
      if (!matchesOwnFilter(ownFilter, p.ownGbn)) return false;
      if (!q) return true;
      return `${p.address} ${p.pnu} ${p.ownGbn} ${p.jimok}`.toLowerCase().includes(q);
    });
  }, [keyword, ownFilter, parcels]);

  const selectedParcel = useMemo(
    () => (selectedPnu ? parcels.find((p) => p.pnu === selectedPnu) ?? null : null),
    [parcels, selectedPnu]
  );

  /** 걸러진 필지만 지도에 표시 */
  useEffect(() => {
    removeKinds(['parcel']);
    for (const f of sourceRef.current?.getFeatures() ?? []) {
      if (RESULT_HIDDEN_KINDS.includes(String(f.get('kind')))) f.set('hidden', phase === 'result');
    }
    if (phase !== 'result') return;
    for (const p of filteredParcels) {
      const geom = readGeometry3857(p.geometry3857);
      if (geom) addFeature('parcel', geom, { pnu: p.pnu, ownGbn: p.ownGbn, picked: p.pnu === selectedPnu });
    }
  }, [addFeature, filteredParcels, phase, removeKinds, selectedPnu]);

  const selectParcel = useCallback(
    (pnu: string | null) => {
      setSelectedPnu(pnu);
      if (!pnu) return;
      const row = parcels.find((p) => p.pnu === pnu);
      const map = mapRef?.current;
      const ext = row?.extent3857 ?? readGeometry3857(row?.geometry3857)?.getExtent() ?? null;
      if (map && ext) {
        scheduleFitMapToExtent3857(map, ext as [number, number, number, number], {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        });
      }
    },
    [mapRef, parcels]
  );

  /** 결과 중 지도에서 필지 클릭 → 목록 선택 */
  useEffect(() => {
    if (phase !== 'result') return;
    const map = mapRef?.current;
    if (!map) return;
    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      const vl = vectorLayerRef.current;
      if (!vl) return;
      let hit = '';
      map.forEachFeatureAtPixel(
        evt.pixel,
        (f) => {
          if (f.get('kind') !== 'parcel') return undefined;
          hit = String(f.get('pnu') ?? '');
          return hit ? true : undefined;
        },
        { hitTolerance: 3, layerFilter: (l) => l === vl }
      );
      if (!hit) return;
      evt.stopPropagation();
      setSelectedPnu(hit);
    };
    const key = map.on('singleclick', onClick as never);
    return () => unByKey(key);
  }, [mapRef, phase]);

  useEffect(() => {
    onDetailOpenChange?.(selectedParcel != null);
  }, [onDetailOpenChange, selectedParcel]);
  useEffect(() => () => onDetailOpenChange?.(false), [onDetailOpenChange]);

  const openAreaModal = useCallback(() => setAreaModalOpen(true), []);
  const closeAreaModal = useCallback(() => setAreaModalOpen(false), []);

  const busy = phase === 'loadingBase' || phase === 'applying' || phase === 'analyzing';

  const value = useMemo<Ctx>(
    () => ({
      layers,
      layersLoading,
      layer,
      phase,
      busy,
      message,
      baseName,
      zoneAreaSqm,
      parcels,
      truncated,
      ownFilter,
      keyword,
      filteredParcels,
      selectedPnu,
      selectedParcel,
      riverKnown,
      includeTributary,
      tribCandidateCount,
      tribCutCount,
      setIncludeTributary,
      tributaryPicking,
      openTributaryPick,
      closeTributaryPick,
      undoTributaryCut,
      areaModalOpen,
      openAreaModal,
      closeAreaModal,
      rangeChecking,
      rangeError,
      riverOpen,
      rangeMode,
      closedLineCount,
      closedOpen,
      undoLastLine,
      closedTool,
      setClosedTool,
      hasShape,
      redrawShape,
      viewTooLarge,
      selectLayer,
      apply,
      changeArea,
      resetAll,
      setOwnFilter,
      setKeyword,
      selectParcel,
    }),
    [
      apply,
      riverOpen,
      rangeMode,
      closedLineCount,
      closedOpen,
      undoLastLine,
      closedTool,
      setClosedTool,
      hasShape,
      redrawShape,
      viewTooLarge,
      tributaryPicking,
      openTributaryPick,
      closeTributaryPick,
      undoTributaryCut,
      areaModalOpen,
      closeAreaModal,
      openAreaModal,
      rangeChecking,
      rangeError,
      baseName,
      busy,
      changeArea,
      filteredParcels,
      includeTributary,
      keyword,
      layer,
      layers,
      layersLoading,
      message,
      ownFilter,
      parcels,
      phase,
      resetAll,
      riverKnown,
      selectLayer,
      selectParcel,
      selectedParcel,
      selectedPnu,
      setIncludeTributary,
      tribCandidateCount,
      tribCutCount,
      truncated,
      zoneAreaSqm,
    ]
  );

  return <PrivateLandAnalysisCtx.Provider value={value}>{children}</PrivateLandAnalysisCtx.Provider>;
}
