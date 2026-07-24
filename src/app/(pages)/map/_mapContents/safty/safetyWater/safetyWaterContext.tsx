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
import type Map from 'ol/Map';
import { fromLonLat } from 'ol/proj';
import { call } from '@/lib/api';
import { useMapContext } from '../../../_mapComponents/MapContext';
import type { ItsCctvItem } from '../../road/roadCCTV/itsCctvTypes';
import {
  SAFETY_WATER_CCTV_NEAR_M,
  buildStationIdsWithCctv,
  fetchMergedCctvList,
  withinStation,
} from './safetyWaterCctv';
import { SAFETY_WATER_DUMMY_FORECASTS } from './safetyWaterDummyForecast';
import type {
  FloodBatchKindAvg,
  FloodTimeType,
  FloodUiError,
  SafetyWaterForecast,
  SafetyWaterObservation,
  SafetyWaterStation,
  SafetyWaterStationKind,
} from './safetyWaterTypes';

const UI_MSG = {
  provider: '현재 제공처 상태가 원활하지 않습니다.',
  ours: '연계 실패',
  noData: '검색된 자료가 없습니다.',
} as const;

function parseFloodError(data: unknown): FloodUiError | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (o.errorClass !== 'provider' && o.errorClass !== 'ours') return null;
  const code = typeof o.code === 'number' ? o.code : Number(o.code);
  return {
    errorClass: o.errorClass,
    uiMessage:
      code === 990
        ? UI_MSG.noData
        : typeof o.uiMessage === 'string' && o.uiMessage
          ? o.uiMessage
          : UI_MSG[o.errorClass],
    code: Number.isFinite(code) ? code : undefined,
  };
}

function isNoDataError(error: FloodUiError | null | undefined) {
  return error?.code === 990;
}

function dist2(a: SafetyWaterStation, b: SafetyWaterStation) {
  const dx = a.lon - b.lon;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

function findNearestOpposite(from: SafetyWaterStation, all: SafetyWaterStation[]) {
  const targetKind = from.kind === 'water' ? 'rain' : 'water';
  let best: SafetyWaterStation | null = null;
  let bestD = Infinity;
  for (const s of all) {
    if (s.kind !== targetKind) continue;
    const d = dist2(from, s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

async function fetchStationObservation(st: SafetyWaterStation, time: FloodTimeType) {
  const qs = new URLSearchParams({ kind: st.kind, code: st.code, time });
  const res = await fetch(`/api/flood/observations?${qs.toString()}`);
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = parseFloodError(j) ?? { errorClass: 'ours' as const, uiMessage: UI_MSG.ours };
    if (isNoDataError(error) || Number(j.code) === 990) {
      return { ok: true as const, item: null, noData: true as const };
    }
    return { ok: false as const, error, noData: false as const };
  }
  const item = j.item as SafetyWaterObservation | null | undefined;
  return {
    ok: true as const,
    item: item ? { ...item, stationName: st.name } : null,
    noData: false as const,
  };
}

function avgToObservation(
  kind: SafetyWaterStationKind,
  avg: FloodBatchKindAvg | null | undefined
): SafetyWaterObservation | null {
  if (!avg) return null;
  return {
    code: '',
    value: avg.average,
    observedAt: avg.observedAt ?? '',
    isAverage: true,
    averageCount: avg.count,
    stationName: kind === 'water' ? '평균 수위' : '평균 강수량',
  };
}

/** 전체 모드: 목록의 수위·강수 관측소 전부 조회 후 종류별 평균 */
async function fetchAverageObservations(stations: SafetyWaterStation[], time: FloodTimeType) {
  const waterStations = stations
    .filter((item) => item.kind === 'water')
    .map((item) => ({ code: item.code, kind: 'water' as const }));
  const rainStations = stations
    .filter((item) => item.kind === 'rain')
    .map((item) => ({ code: item.code, kind: 'rain' as const }));

  const res = await fetch('/api/flood/observations/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ time, stations: [...waterStations, ...rainStations] }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false as const,
      error: parseFloodError(j) ?? { errorClass: 'ours' as const, uiMessage: UI_MSG.ours },
    };
  }
  return {
    ok: true as const,
    water: avgToObservation('water', j.water as FloodBatchKindAvg | undefined),
    rain: avgToObservation('rain', j.rain as FloodBatchKindAvg | undefined),
  };
}

type SafetyWaterContextValue = {
  map: Map | null;
  mapReady: boolean;
  loading: boolean;
  refreshing: boolean;
  obsLoading: boolean;
  listOpen: boolean;
  setListOpen: (open: boolean) => void;
  stations: SafetyWaterStation[];
  waterObs: SafetyWaterObservation | null;
  rainObs: SafetyWaterObservation | null;
  /** 수위 카드: HRFCO 990 등 자료 없음 */
  waterNoData: boolean;
  /** 강수 카드: HRFCO 990 등 자료 없음 */
  rainNoData: boolean;
  obsError: FloodUiError | null;
  uiError: FloodUiError | null;
  selectedStationId: string | null;
  setSelectedStationId: (id: string | null) => void;
  /** 관측소 선택 + 지도 이동(동일 id 재클릭에도 이동) */
  focusStation: (id: string) => void;
  selectedStation: SafetyWaterStation | null;
  timeType: FloodTimeType;
  setTimeType: (value: FloodTimeType) => void;
  statsKinds: SafetyWaterStationKind[];
  toggleStats: (kind: SafetyWaterStationKind) => void;
  closeStats: () => void;
  isAverageMode: boolean;
  rainIsPaired: boolean;
  waterIsPaired: boolean;
  rainLabel: string;
  waterLabel: string;
  /** 디버그: 강수량 관측소 코드(RFOBSCD) */
  rainStationCode: string | null;
  /** 디버그: 수위 관측소 코드(WLOBSCD) */
  waterStationCode: string | null;
  getStatsStationLabel: (kind: SafetyWaterStationKind) => string;
  getStatsTargetStations: (kind: SafetyWaterStationKind) => SafetyWaterStation[];
  lastRefresh: Date | null;
  refreshStations: () => void;
  forecasts: SafetyWaterForecast[];
  forecastLoading: boolean;
  forecastOpen: boolean;
  setForecastOpen: (open: boolean) => void;
  toggleForecastOpen: () => void;
  /** 홍수 예보 패널 화면 하단 y (주변 도로 top 계산용). 닫히면 null */
  forecastPanelBottomPx: number | null;
  setForecastPanelBottomPx: (bottom: number | null) => void;
  cctvOpen: boolean;
  setCctvOpen: (open: boolean) => void;
  toggleCctvOpen: () => void;
  cctvLayerItems: ItsCctvItem[];
  cctvListItems: ItsCctvItem[];
  cctvLoading: boolean;
  cctvError: string | null;
  stationIdsWithCctv: Set<string>;
  hasCctvForSelection: boolean;
  selectedCctvKey: string | null;
  setSelectedCctvKey: (key: string | null) => void;
};

const SafetyWaterContext = createContext<SafetyWaterContextValue | null>(null);

export function useSafetyWater() {
  const ctx = useContext(SafetyWaterContext);
  if (!ctx) throw new Error('useSafetyWater must be used within SafetyWaterProvider');
  return ctx;
}

type ProviderProps = {
  children: ReactNode;
  statsKinds: SafetyWaterStationKind[];
  onStatsKindsChange: (kinds: SafetyWaterStationKind[]) => void;
};

export function SafetyWaterProvider({ children, statsKinds, onStatsKindsChange }: ProviderProps) {
  const mapContext = useMapContext();
  const mapRef = mapContext?.mapInstanceRef;
  const [map, setMap] = useState<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [obsLoading, setObsLoading] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [stations, setStations] = useState<SafetyWaterStation[]>([]);
  const [waterObs, setWaterObs] = useState<SafetyWaterObservation | null>(null);
  const [rainObs, setRainObs] = useState<SafetyWaterObservation | null>(null);
  const [waterNoData, setWaterNoData] = useState(false);
  const [rainNoData, setRainNoData] = useState(false);
  const [obsError, setObsError] = useState<FloodUiError | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [timeType, setTimeType] = useState<FloodTimeType>('10M');
  const [uiError, setUiError] = useState<FloodUiError | null>(null);
  const [forecasts, setForecasts] = useState<SafetyWaterForecast[]>([]);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [forecastPanelBottomPx, setForecastPanelBottomPx] = useState<number | null>(null);
  const [cctvOpen, setCctvOpen] = useState(false);
  const [cctvLayerItems, setCctvLayerItems] = useState<ItsCctvItem[]>([]);
  const [cctvLoading, setCctvLoading] = useState(false);
  const [cctvError, setCctvError] = useState<string | null>(null);
  const [selectedCctvKey, setSelectedCctvKey] = useState<string | null>(null);
  const cctvFetchGenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      const m = mapRef?.current ?? null;
      if (m) {
        if (!cancelled) {
          setMap(m);
          setMapReady(true);
        }
        return;
      }
      if (!cancelled) requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [mapRef]);

  const loadStations = useCallback(async () => {
    setLoading(true);
    setUiError(null);
    try {
      const extRes = await call('', 'POST', {
        service: 'devTestService',
        action: 'getEmdExtentWgs84',
        params: {},
      });
      const d = extRes?.data ?? extRes;
      const minX = Number(d?.minX);
      const maxX = Number(d?.maxX);
      const minY = Number(d?.minY);
      const maxY = Number(d?.maxY);
      if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
        setUiError({ errorClass: 'ours', uiMessage: UI_MSG.ours });
        setStations([]);
        setForecasts([]);
        return;
      }

      const qs = new URLSearchParams({
        minX: String(minX),
        maxX: String(maxX),
        minY: String(minY),
        maxY: String(maxY),
      });
      const stRes = await fetch(`/api/flood/stations?${qs.toString()}`);
      const stJson = (await stRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!stRes.ok) {
        setUiError(parseFloodError(stJson) ?? { errorClass: 'ours', uiMessage: UI_MSG.ours });
        setStations([]);
        setWaterObs(null);
        setRainObs(null);
        setForecasts([]);
        return;
      }

      const items = Array.isArray(stJson.items) ? (stJson.items as SafetyWaterStation[]) : [];
      setStations(items);
      setSelectedStationId((prev) => (prev && items.some((item) => item.id === prev) ? prev : null));
      setLastRefresh(new Date());

      // 홍수 예보 — 더미 표시 (실 API 연동 전)
      setForecastLoading(false);
      setForecasts(SAFETY_WATER_DUMMY_FORECASTS);
    } catch (e) {
      console.error('[flood] loadStations failed', e);
      setUiError({ errorClass: 'ours', uiMessage: UI_MSG.ours });
      setStations([]);
      setForecasts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  const selectedStation = useMemo(
    () => stations.find((item) => item.id === selectedStationId) ?? null,
    [stations, selectedStationId]
  );
  const nearestOpposite = useMemo(
    () => (selectedStation ? findNearestOpposite(selectedStation, stations) : null),
    [selectedStation, stations]
  );
  const waterTargetStation =
    selectedStation?.kind === 'water'
      ? selectedStation
      : nearestOpposite?.kind === 'water'
        ? nearestOpposite
        : null;
  const rainTargetStation =
    selectedStation?.kind === 'rain'
      ? selectedStation
      : nearestOpposite?.kind === 'rain'
        ? nearestOpposite
        : null;
  const isAverageMode = selectedStationId === null;

  const stationIdsWithCctv = useMemo(
    () => buildStationIdsWithCctv(stations, cctvLayerItems, SAFETY_WATER_CCTV_NEAR_M),
    [stations, cctvLayerItems]
  );

  const cctvListItems = useMemo(() => {
    if (!selectedStation) return cctvLayerItems;
    if (selectedStation.kind !== 'water') return [];
    return cctvLayerItems.filter((it) =>
      withinStation(it, selectedStation, SAFETY_WATER_CCTV_NEAR_M)
    );
  }, [cctvLayerItems, selectedStation]);

  const hasCctvForSelection = cctvListItems.length > 0;

  useEffect(() => {
    if (!cctvOpen) {
      setSelectedCctvKey(null);
      return;
    }
    if (cctvListItems.length === 0) {
      setSelectedCctvKey(null);
      return;
    }
    setSelectedCctvKey((prev) =>
      prev && cctvListItems.some((x) => x.key === prev) ? prev : cctvListItems[0].key
    );
  }, [cctvOpen, cctvListItems]);

  useEffect(() => {
    if (stations.length === 0) {
      setCctvLayerItems([]);
      setCctvError(null);
      setCctvOpen(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const gen = ++cctvFetchGenRef.current;
      setCctvLoading(true);
      setCctvError(null);
      try {
        const extRes = await call('', 'POST', {
          service: 'devTestService',
          action: 'getEmdExtentWgs84',
          params: {},
        });
        if (cancelled || gen !== cctvFetchGenRef.current) return;
        const d = extRes?.data ?? extRes;
        const bbox = {
          minX: Number(d?.minX),
          maxX: Number(d?.maxX),
          minY: Number(d?.minY),
          maxY: Number(d?.maxY),
        };
        if (![bbox.minX, bbox.maxX, bbox.minY, bbox.maxY].every(Number.isFinite)) {
          setCctvError('범위를 불러오지 못했습니다.');
          setCctvLayerItems([]);
          return;
        }
        const merged = await fetchMergedCctvList(bbox);
        if (cancelled || gen !== cctvFetchGenRef.current) return;
        setCctvLayerItems(
          merged.filter((it) =>
            stations.some(
              (st) => st.kind === 'water' && withinStation(it, st, SAFETY_WATER_CCTV_NEAR_M)
            )
          )
        );
      } catch (e) {
        if (cancelled || gen !== cctvFetchGenRef.current) return;
        setCctvError(e instanceof Error ? e.message : String(e));
        setCctvLayerItems([]);
      } finally {
        if (!cancelled && gen === cctvFetchGenRef.current) setCctvLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stations]);

  useEffect(() => {
    if (!hasCctvForSelection && cctvOpen) setCctvOpen(false);
  }, [hasCctvForSelection, cctvOpen]);

  const toggleCctvOpen = useCallback(() => {
    setCctvOpen((prev) => !prev);
  }, []);

  const toggleForecastOpen = useCallback(() => {
    setForecastOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!forecastOpen) setForecastPanelBottomPx(null);
  }, [forecastOpen]);

  useEffect(() => {
    if (stations.length === 0) {
      setWaterObs(null);
      setRainObs(null);
      setWaterNoData(false);
      setRainNoData(false);
      setObsError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setObsLoading(true);
      setObsError(null);
      try {
        if (selectedStation) {
          const [waterRes, rainRes] = await Promise.all([
            waterTargetStation
              ? fetchStationObservation(waterTargetStation, timeType)
              : Promise.resolve({ ok: true as const, item: null, noData: false as const }),
            rainTargetStation
              ? fetchStationObservation(rainTargetStation, timeType)
              : Promise.resolve({ ok: true as const, item: null, noData: false as const }),
          ]);
          if (cancelled) return;
          setWaterObs(waterRes.ok ? waterRes.item : null);
          setRainObs(rainRes.ok ? rainRes.item : null);
          setWaterNoData(waterRes.ok ? waterRes.noData : false);
          setRainNoData(rainRes.ok ? rainRes.noData : false);
          const err =
            !waterRes.ok && !isNoDataError(waterRes.error)
              ? waterRes.error
              : !rainRes.ok && !isNoDataError(rainRes.error)
                ? rainRes.error
                : null;
          setObsError(err);
        } else {
          const avgRes = await fetchAverageObservations(stations, timeType);
          if (cancelled) return;
          if (!avgRes.ok) {
            if (isNoDataError(avgRes.error)) {
              setWaterObs(null);
              setRainObs(null);
              setWaterNoData(true);
              setRainNoData(true);
              setObsError(null);
            } else {
              setWaterObs(null);
              setRainObs(null);
              setWaterNoData(false);
              setRainNoData(false);
              setObsError(avgRes.error);
            }
          } else {
            setWaterObs(avgRes.water);
            setRainObs(avgRes.rain);
            setWaterNoData(!avgRes.water || avgRes.water.averageCount === 0);
            setRainNoData(!avgRes.rain || avgRes.rain.averageCount === 0);
            setObsError(null);
          }
        }
        setLastRefresh(new Date());
      } catch (e) {
        if (cancelled) return;
        console.error('[flood] loadCurrentObservations failed', e);
        setWaterNoData(false);
        setRainNoData(false);
        setObsError({ errorClass: 'ours', uiMessage: UI_MSG.ours });
      } finally {
        if (!cancelled) setObsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [stations, selectedStation, waterTargetStation, rainTargetStation, timeType]);

  const focusStation = useCallback(
    (id: string) => {
      const st = stations.find((item) => item.id === id);
      setSelectedStationId(id);
      if (!st) return;
      const instance = mapRef?.current ?? map;
      if (!instance || !mapReady) return;
      instance.getView().animate({
        center: fromLonLat([st.lon, st.lat]),
        duration: 450,
      });
    },
    [stations, map, mapReady, mapRef]
  );

  const rainIsPaired = !isAverageMode && selectedStation?.kind === 'water' && !!rainTargetStation;
  const waterIsPaired = !isAverageMode && selectedStation?.kind === 'rain' && !!waterTargetStation;
  const rainLabel = isAverageMode ? '평균 강수량' : rainObs?.stationName ?? rainTargetStation?.name ?? '강수 관측소';
  const waterLabel = isAverageMode ? '평균 수위' : waterObs?.stationName ?? waterTargetStation?.name ?? '수위 관측소';
  const rainStationCode = isAverageMode ? null : rainTargetStation?.code ?? rainObs?.code ?? null;
  const waterStationCode = isAverageMode ? null : waterTargetStation?.code ?? waterObs?.code ?? null;

  const getStatsStationLabel = useCallback(
    (kind: SafetyWaterStationKind) => {
      if (isAverageMode) return '전체';
      if (kind === 'water') return waterTargetStation?.name ?? '수위 관측소';
      return rainTargetStation?.name ?? '강수 관측소';
    },
    [isAverageMode, waterTargetStation, rainTargetStation]
  );

  const getStatsTargetStations = useCallback(
    (kind: SafetyWaterStationKind) => {
      if (isAverageMode) return stations.filter((item) => item.kind === kind);
      const target = kind === 'water' ? waterTargetStation : rainTargetStation;
      return target ? [target] : [];
    },
    [isAverageMode, stations, waterTargetStation, rainTargetStation]
  );

  const toggleStats = useCallback(
    (kind: SafetyWaterStationKind) => {
      if (statsKinds.includes(kind)) {
        onStatsKindsChange(statsKinds.filter((item) => item !== kind));
        return;
      }
      onStatsKindsChange([...statsKinds, kind]);
    },
    [statsKinds, onStatsKindsChange]
  );

  const closeStats = useCallback(() => {
    onStatsKindsChange([]);
  }, [onStatsKindsChange]);

  const refreshStations = useCallback(() => {
    setRefreshing(true);
    void loadStations();
  }, [loadStations]);

  const value = useMemo<SafetyWaterContextValue>(
    () => ({
      map,
      mapReady,
      loading,
      refreshing,
      obsLoading,
      listOpen,
      setListOpen,
      stations,
      waterObs,
      rainObs,
      waterNoData,
      rainNoData,
      obsError,
      uiError,
      selectedStationId,
      setSelectedStationId,
      focusStation,
      selectedStation,
      timeType,
      setTimeType,
      statsKinds,
      toggleStats,
      closeStats,
      isAverageMode,
      rainIsPaired,
      waterIsPaired,
      rainLabel,
      waterLabel,
      rainStationCode,
      waterStationCode,
      getStatsStationLabel,
      getStatsTargetStations,
      lastRefresh,
      refreshStations,
      forecasts,
      forecastLoading,
      forecastOpen,
      setForecastOpen,
      toggleForecastOpen,
      forecastPanelBottomPx,
      setForecastPanelBottomPx,
      cctvOpen,
      setCctvOpen,
      toggleCctvOpen,
      cctvLayerItems,
      cctvListItems,
      cctvLoading,
      cctvError,
      stationIdsWithCctv,
      hasCctvForSelection,
      selectedCctvKey,
      setSelectedCctvKey,
    }),
    [
      map,
      mapReady,
      loading,
      refreshing,
      obsLoading,
      listOpen,
      stations,
      waterObs,
      rainObs,
      waterNoData,
      rainNoData,
      obsError,
      uiError,
      selectedStationId,
      selectedStation,
      focusStation,
      timeType,
      statsKinds,
      toggleStats,
      closeStats,
      isAverageMode,
      rainIsPaired,
      waterIsPaired,
      rainLabel,
      waterLabel,
      rainStationCode,
      waterStationCode,
      getStatsStationLabel,
      getStatsTargetStations,
      lastRefresh,
      refreshStations,
      forecasts,
      forecastLoading,
      forecastOpen,
      toggleForecastOpen,
      forecastPanelBottomPx,
      cctvOpen,
      toggleCctvOpen,
      cctvLayerItems,
      cctvListItems,
      cctvLoading,
      cctvError,
      stationIdsWithCctv,
      hasCctvForSelection,
      selectedCctvKey,
    ]
  );

  return <SafetyWaterContext.Provider value={value}>{children}</SafetyWaterContext.Provider>;
}
