'use client';

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Map, Box, Crosshair, Globe } from 'lucide-react';
import { toLonLat } from 'ol/proj';
import OpenLayersMap from './OpenLayersMap';
import { MapControlPanel, defaultMapControlGroups } from './mapControlPanel/mapControlPanel';
import type { MapControlGroup } from './mapControlPanel/mapControlPanel';
import {
  tilesetLayerKey,
  type CesiumMapRef,
  type Visible3DTilesetEntry,
} from '../../3dMap/CesiumMap';
import { useSearchBarOffset } from '../searchBarOffsetContext';
import { call } from '@/lib/api';
import { useMapContext } from './MapContext';
import {
  BackgroundMapSelector,
  defaultBackgroundMapGroups,
  type BackgroundMapGroup,
} from './mapControlPanel/backgroundMapSelector';
import { patchPersistedBackgroundMap } from './hooks/useMapStatePersist';
import { DEFAULT_CAMERA_HEIGHT_3D, DEFAULT_ZOOM_2D } from './config/mapDefaults';
import { MapSplitLayout } from './mapSplit/MapSplitLayout';
import { MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX } from './mapSplit/mapSplitTypes';
import { useSplitGutterControlOffset } from './mapSplit/useSplitGutterControlOffset';
import { useStreetViewSecondary } from '../_mapContents/streetView/useStreetViewSecondary';
import { useMapSplitSecondary } from '../_mapContents/mapSplit/useMapSplitSecondary';
import { AerialViewLayerPanel } from '../_mapContents/aerialView/AerialViewLayerPanel';

/** 3D 오른쪽 패널에서 다중 토글 허용 id (OpenLayers MULTI_SELECT_IDS 와 동일 계열) */
const MULTI_SELECT_CONTROLS_3D = ['cadastral', 'thematic-map'] as const;

const CesiumMap = dynamic(() => import('../../3dMap/CesiumMap'), { ssr: false });

/** 3D 타일: 3dtiles_pnts/<데이터셋> | 3dtiles_b3dm/<데이터셋> */

type MapStartView = {
  lon: number;
  lat: number;
  height?: number;
};

function build3dStartViewFrom2d(
  map: import('ol/Map').default | null | undefined,
  fallback: { lon: number; lat: number } | null
): MapStartView | null {
  const view = map?.getView();
  const center = view?.getCenter();
  const zoom = view?.getZoom();
  if (!center || !Array.isArray(center) || center.length < 2) {
    return fallback ? { ...fallback, height: DEFAULT_CAMERA_HEIGHT_3D } : null;
  }
  const [lon, lat] = toLonLat(center);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return fallback ? { ...fallback, height: DEFAULT_CAMERA_HEIGHT_3D } : null;
  }
  const zoomNum = Number.isFinite(zoom) ? Number(zoom) : DEFAULT_ZOOM_2D;
  const height = Math.min(
    20_000_000,
    Math.max(100, DEFAULT_CAMERA_HEIGHT_3D * Math.pow(2, DEFAULT_ZOOM_2D - zoomNum))
  );
  return { lon, lat, height };
}

function ViewModeButton({
  label,
  icon: Icon,
  isActive,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-[45px] w-full min-w-0 flex-col items-center justify-center gap-0 overflow-hidden box-border p-0 transition-colors cursor-pointer',
        'hover:bg-slate-100 hover:text-blue-600',
        'dark:text-white/90 dark:hover:bg-white/10 dark:hover:text-white',
        isActive && 'bg-slate-100 text-blue-600 dark:bg-white/20 dark:text-white',
        'rounded-b-[4px]'
      )}
      title={label}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
      <span className="max-w-full leading-tight text-center whitespace-nowrap overflow-hidden truncate px-0.5" style={{ fontSize: '9px' }}>{label}</span>
    </button>
  );
}

export default function MapViewModeWrapper({
  defaultCenter = null,
  projectName,
}: {
  defaultCenter?: { lon: number; lat: number } | null;
  projectName?: string;
}) {
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [pntsTilesetNames, setPntsTilesetNames] = useState<string[]>([]);
  const [meshTilesetNames, setMeshTilesetNames] = useState<string[]>([]);
  const [tilesetNamesLoading, setTilesetNamesLoading] = useState(false);
  const [pntsTilesetEnabled, setPntsTilesetEnabled] = useState<Record<string, boolean>>({});
  const [meshTilesetEnabled, setMeshTilesetEnabled] = useState<Record<string, boolean>>({});
  const [tilesetError, setTilesetError] = useState<string | null>(null);
  const [globeVisible, setGlobeVisible] = useState(true);
  const [pointCloudCategoryEnabled, setPointCloudCategoryEnabled] = useState(true);
  const [meshCategoryEnabled, setMeshCategoryEnabled] = useState(true);
  const [meshTilesetZOffsetM, setMeshTilesetZOffsetM] = useState(0);
  const [meshTilesetZOffsetInput, setMeshTilesetZOffsetInput] = useState('0');
  /** 3D 오른쪽 패널 활성 컨트롤 id (지적도 WMS 등) */
  const [activeControls3d, setActiveControls3d] = useState<string[]>([]);
  /** 3D 배경: 2D에서 마지막으로 쓴 mapBackgroundMapIdRef 와 동기화 */
  const [cesiumBackgroundMapId, setCesiumBackgroundMapId] = useState('aerial-2022');
  const [backgroundMapGroups3d, setBackgroundMapGroups3d] =
    useState<BackgroundMapGroup[]>(defaultBackgroundMapGroups);
  const [isBackgroundPanelExiting3d, setIsBackgroundPanelExiting3d] = useState(false);
  const [isAerialViewPanelExiting3d, setIsAerialViewPanelExiting3d] = useState(false);
  const [aerialViewCheckedIds3d, setAerialViewCheckedIds3d] = useState<Set<string>>(() => new Set());
  const [default3dView, setDefault3dView] = useState<MapStartView | null>(
    defaultCenter ? { ...defaultCenter, height: DEFAULT_CAMERA_HEIGHT_3D } : null
  );
  const cesiumMapRef = useRef<CesiumMapRef>(null);
  const { leftPx, topPx } = useSearchBarOffset();
  const mapContext = useMapContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const systemKey = searchParams.get('system') ?? '';
  const mapControlGroups3d = useMemo((): MapControlGroup[] => {
    if (systemKey === 'uav') return defaultMapControlGroups;
    return defaultMapControlGroups.map((g) =>
      g.id === 'base-maps'
        ? { ...g, items: g.items.filter((item) => item.id !== 'aerial-view') }
        : g
    );
  }, [systemKey]);

  useEffect(() => {
    setDefault3dView(defaultCenter ? { ...defaultCenter, height: DEFAULT_CAMERA_HEIGHT_3D } : null);
  }, [defaultCenter]);

  useEffect(() => {
    if (!isAerialViewPanelExiting3d) return;
    const t = setTimeout(() => setIsAerialViewPanelExiting3d(false), 400);
    return () => clearTimeout(t);
  }, [isAerialViewPanelExiting3d]);

  const fetch3DTilesetDirs = useCallback(async () => {
    setTilesetNamesLoading(true);
    try {
      const [pntsRes, b3dmRes] = await Promise.all([
        call('', 'POST', {
          service: 'fileManagerService',
          action: 'list3DTilesetDirs',
          params: {},
        }),
        call('', 'POST', {
          service: 'fileManagerService',
          action: 'list3DB3dmTilesetDirs',
          params: {},
        }),
      ]);
      const pntsData = pntsRes?.data ?? pntsRes;
      const b3dmData = b3dmRes?.data ?? b3dmRes;
      const pntsDirs = Array.isArray(pntsData?.directories) ? pntsData.directories : [];
      const b3dmDirs = Array.isArray(b3dmData?.directories) ? b3dmData.directories : [];
      setPntsTilesetNames(pntsDirs);
      setMeshTilesetNames(b3dmDirs);
      setPntsTilesetEnabled((prev) => {
        const next = { ...prev };
        pntsDirs.forEach((name: string) => {
          if (next[name] === undefined) next[name] = true;
        });
        return next;
      });
      setMeshTilesetEnabled((prev) => {
        const next = { ...prev };
        b3dmDirs.forEach((name: string) => {
          if (next[name] === undefined) next[name] = true;
        });
        return next;
      });
    } catch {
      setPntsTilesetNames([]);
      setMeshTilesetNames([]);
    } finally {
      setTilesetNamesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === '3d') fetch3DTilesetDirs();
  }, [viewMode, fetch3DTilesetDirs]);

  useEffect(() => {
    if (viewMode !== '3d') cesiumMapRef.current = null;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== '3d') setActiveControls3d([]);
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== '3d') return;
    const id = mapContext?.mapBackgroundMapIdRef?.current ?? 'aerial-2022';
    setCesiumBackgroundMapId(id);
  }, [viewMode, mapContext]);

  useEffect(() => {
    if (!isBackgroundPanelExiting3d) return;
    const t = setTimeout(() => setIsBackgroundPanelExiting3d(false), 400);
    return () => clearTimeout(t);
  }, [isBackgroundPanelExiting3d]);

  // 자체항공영상 목록 — OpenLayersMap 과 동일 orthophotoService 연동
  useEffect(() => {
    let cancelled = false;
    const buildLabelFromOrthoFolder = (id: string): string | null => {
      const m = /^satellite_(\d{4})(?:_([^_]+)(?:_(.+))?)?$/i.exec(id);
      if (!m) return null;
      const year = m[1];
      const seg3 = (m[2] ?? '').trim();
      const seg4 = (m[3] ?? '').trim();
      if (/^\d+$/.test(seg3)) {
        return seg4 || `항공영상(${year})`;
      }
      return seg3 || `항공영상(${year})`;
    };
    const run = async () => {
      try {
        const res = await call('', 'POST', {
          service: 'orthophotoService',
          action: 'listOrthophotoTileOutputs',
          params: {},
        });
        if (cancelled) return;
        const d = (res?.data ?? res) as {
          groups?: { groupName: string; tileSetIds: string[] }[];
          legacyTileSetIds?: string[];
        };
        const idSet = new Set<string>();
        for (const id of d.legacyTileSetIds ?? []) idSet.add(id);
        for (const g of d.groups ?? []) idSet.add(g.groupName);
        const opts = Array.from(idSet)
          .map((id) => ({ id, label: buildLabelFromOrthoFolder(id) }))
          .filter((x): x is { id: string; label: string } => !!x.label)
          .sort((a, b) => b.id.localeCompare(a.id))
          .map((x) => ({ id: x.id, label: x.label }));
        setBackgroundMapGroups3d((prev) =>
          prev.map((g) => (g.id === 'custom-aerial' ? { ...g, options: opts } : g))
        );
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyBackgroundChoice = useCallback(
    (value: string) => {
      setCesiumBackgroundMapId(value);
      if (mapContext?.mapBackgroundMapIdRef) {
        mapContext.mapBackgroundMapIdRef.current = value;
      }
      patchPersistedBackgroundMap(value, projectName);
    },
    [mapContext, projectName]
  );

  const visibleTilesets = useMemo((): Visible3DTilesetEntry[] => {
    const out: Visible3DTilesetEntry[] = [];
    if (pointCloudCategoryEnabled) {
      for (const name of pntsTilesetNames) {
        if (pntsTilesetEnabled[name] ?? false) out.push({ kind: 'pnts', name });
      }
    }
    if (meshCategoryEnabled) {
      for (const name of meshTilesetNames) {
        if (meshTilesetEnabled[name] ?? false) out.push({ kind: 'b3dm', name });
      }
    }
    return out;
  }, [
    pointCloudCategoryEnabled,
    meshCategoryEnabled,
    pntsTilesetNames,
    meshTilesetNames,
    pntsTilesetEnabled,
    meshTilesetEnabled,
  ]);

  const handleMeshFlyTo = useCallback((name: string) => {
    setMeshCategoryEnabled(true);
    setMeshTilesetEnabled((prev) => {
      const alreadyEnabled = prev[name] ?? true;
      if (alreadyEnabled) {
        queueMicrotask(() => {
          cesiumMapRef.current?.flyToTileset(tilesetLayerKey('b3dm', name));
        });
        return prev;
      }
      return {
        ...prev,
        [name]: true,
      };
    });
    setTilesetError(null);
  }, []);

  const handleTilesetLoadError = useCallback((_name: string, message: string) => {
    setTilesetError(message);
  }, []);

  const adjustMeshTilesetZOffset = useCallback((delta: number) => {
    const next = Number((meshTilesetZOffsetM + delta).toFixed(2));
    setMeshTilesetZOffsetM(next);
    setMeshTilesetZOffsetInput(String(next));
  }, [meshTilesetZOffsetM]);

  const viewModeControls2d = (
    <ViewModeButton
      label="3D 지도"
      icon={Box}
      isActive={viewMode === '3d'}
      onClick={() => {
        setDefault3dView(build3dStartViewFrom2d(mapContext?.mapInstanceRef?.current, defaultCenter));
        setViewMode('3d');
      }}
    />
  );

  const viewModeControls3d = (
    <ViewModeButton
      label="2D 지도"
      icon={Map}
      isActive={viewMode === '3d'}
      onClick={() => setViewMode('2d')}
    />
  );

  const secondaryKind = mapContext?.mapSplitSecondaryKind ?? null;
  const mapSync = mapContext?.mapSplitMapSync ?? true;
  const streetViewActive = secondaryKind === 'streetView';
  const mapSplitActive = secondaryKind === 'map';

  const streetView = useStreetViewSecondary({
    active: streetViewActive && viewMode === '2d',
    mapSync,
    projectName,
  });

  const mapSplit = useMapSplitSecondary({
    active: mapSplitActive && viewMode === '2d',
    projectName,
  });

  const {
    controlOffsetRatio: splitControlOffsetRatio,
    setControlOffsetRatio: onSplitControlOffsetChange,
  } = useSplitGutterControlOffset(projectName);

  // 보조 칸 스위치 — streetView | map
  let secondaryPanel = null as ReactNode;
  let gutterControls: ReturnType<typeof useStreetViewSecondary>['controls'] = undefined;
  let splitControlsExpanded: boolean | undefined;
  let onSplitControlsExpandedChange: ((expanded: boolean) => void) | undefined;
  if (secondaryKind === 'streetView') {
    secondaryPanel = streetView.panel;
    gutterControls = streetView.controls;
    splitControlsExpanded = streetView.controlsExpanded;
    onSplitControlsExpandedChange = streetView.onControlsExpandedChange;
  } else if (secondaryKind === 'map') {
    secondaryPanel = mapSplit.panel;
    gutterControls = mapSplit.controls;
    splitControlsExpanded = mapSplit.controlsExpanded;
    onSplitControlsExpandedChange = mapSplit.onControlsExpandedChange;
  }

  const onSplitSizeTick = useCallback(() => {
    mapContext?.mapInstanceRef?.current?.updateSize();
    mapContext?.mapSplitSecondaryMapRef?.current?.updateSize();
  }, [mapContext?.mapInstanceRef, mapContext?.mapSplitSecondaryMapRef]);

  const [splitOrientation, setSplitOrientation] = useState<'horizontal' | 'vertical'>(
    'horizontal'
  );

  useEffect(() => {
    if (viewMode !== '3d') return;
    mapContext?.setMapSplitSecondaryKind?.(null);
  }, [viewMode, mapContext]);

  // 상하 분할: 레이아웃 왼쪽 스페이서만 쓰고 view 왼쪽 패딩은 0.
  // override로 부모 apply가 다시 왼쪽 패딩을 넣지 않게 함(워커 소실 방지).
  useLayoutEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || viewMode !== '2d') return;
    const view = map.getView();
    const overrideRef = mapContext?.mapViewPaddingOverrideRef;
    const center = view.getCenter();
    const preserved = center ? [...center] : null;

    const verticalInset = secondaryKind != null && splitOrientation === 'vertical';
    if (overrideRef) {
      overrideRef.current = verticalInset ? [0, 0, 0, 0] : null;
    }

    if (verticalInset) {
      view.padding = [0, 0, 0, 0];
      map.updateSize();
      if (preserved) view.setCenter(preserved);
    } else {
      mapContext?.applyMapViewPaddingRef?.current?.();
      map.updateSize();
      if (preserved && secondaryKind !== 'streetView') {
        view.setCenter(preserved);
      }
    }

    return () => {
      if (overrideRef && verticalInset) {
        overrideRef.current = null;
      }
    };
  }, [
    secondaryKind,
    splitOrientation,
    viewMode,
    mapContext?.mapInstanceRef,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapViewPaddingOverrideRef,
    mapContext?.mapPaddingLeft,
  ]);

  return (
    <div className="relative w-full h-full">
      {viewMode === '2d' && (
        <MapSplitLayout
          splitActive={secondaryKind != null}
          primary={
            <OpenLayersMap
              extraControls={viewModeControls2d}
              defaultCenter={defaultCenter}
              projectName={projectName}
            />
          }
          secondary={secondaryPanel}
          gutterControls={gutterControls}
          controlOffsetRatio={splitControlOffsetRatio}
          onControlOffsetRatioChange={onSplitControlOffsetChange}
          controlOffsetDraggable={Boolean(onSplitControlOffsetChange)}
          controlsExpanded={splitControlsExpanded}
          onControlsExpandedChange={onSplitControlsExpandedChange}
          onSizeTick={onSplitSizeTick}
          mapPaddingLeft={mapContext?.mapPaddingLeft ?? 0}
          mapPaddingRight={
            mapContext?.mapPaddingRight ?? MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX
          }
          onOrientationChange={setSplitOrientation}
        />
      )}

      {viewMode === '3d' && (
        <>
          <CesiumMap
            ref={cesiumMapRef}
            onReady={(api) => {
              cesiumMapRef.current = api;
            }}
            defaultCenter={default3dView}
            visibleTilesets={visibleTilesets}
            onTilesetLoadError={handleTilesetLoadError}
            globeVisible={globeVisible}
            meshTilesetZOffsetM={meshTilesetZOffsetM}
            cadastralWmsEnabled={activeControls3d.includes('cadastral')}
            cadastralVisibleTableNames={null}
            backgroundMapId={cesiumBackgroundMapId}
            basemapImageryVisible
          />
          {/* 2D와 동일: 배경지도 선택 + 오른쪽 맵 컨트롤 (지적도 WMS 등)
              래퍼 pointer-events-none — flex 빈 영역이 지도 입력을 가로채지 않게 */}
          <div
            className="pointer-events-none absolute right-4 z-10 flex flex-col items-end gap-3"
            style={{ top: '60px' }}
          >
            <div className="pointer-events-none flex items-start gap-3">
              {(activeControls3d.includes('background-map') || isBackgroundPanelExiting3d) && (
                <div
                  className={
                    isBackgroundPanelExiting3d
                      ? 'pointer-events-auto animate-out fade-out-0 slide-out-to-right-4 duration-[400ms]'
                      : 'pointer-events-auto animate-in fade-in-0 slide-in-from-right-4 duration-[400ms]'
                  }
                >
                  <BackgroundMapSelector
                    groups={backgroundMapGroups3d}
                    value={cesiumBackgroundMapId}
                    onValueChange={applyBackgroundChoice}
                  />
                </div>
              )}
              {(activeControls3d.includes('aerial-view') || isAerialViewPanelExiting3d) && (
                <div
                  className={
                    isAerialViewPanelExiting3d
                      ? 'pointer-events-auto animate-out fade-out-0 slide-out-to-right-4 duration-[400ms]'
                      : 'pointer-events-auto animate-in fade-in-0 slide-in-from-right-4 duration-[400ms]'
                  }
                >
                  <AerialViewLayerPanel
                    checkedUnitIds={aerialViewCheckedIds3d}
                    onCheckedChange={setAerialViewCheckedIds3d}
                    onClose={() => {
                      setIsAerialViewPanelExiting3d(true);
                      setActiveControls3d((prev) => prev.filter((x) => x !== 'aerial-view'));
                    }}
                  />
                </div>
              )}
              <div className="pointer-events-auto">
                <MapControlPanel
                  groups={mapControlGroups3d}
                  activeIds={activeControls3d}
                  onItemClick={(id, isActive) => {
                    if (id === 'shooting-request') {
                      const current = new URLSearchParams(Array.from(searchParams.entries()));
                      current.set('opened', 'shootingRequest');
                      current.set('shotForm', 'new');
                      router.push(`/map?${current.toString()}`);
                      return;
                    }
                    if (id === 'cadastral' || id === 'thematic-map') {
                      setActiveControls3d((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                      );
                      return;
                    }
                    if (id === 'background-map') {
                      if (isActive) {
                        setIsBackgroundPanelExiting3d(true);
                        setActiveControls3d((prev) =>
                          prev.filter((item) =>
                            MULTI_SELECT_CONTROLS_3D.includes(
                              item as (typeof MULTI_SELECT_CONTROLS_3D)[number]
                            )
                          )
                        );
                      } else {
                        setIsBackgroundPanelExiting3d(false);
                        setIsAerialViewPanelExiting3d(false);
                        setActiveControls3d((prev) => {
                          const withoutSingle = prev.filter((item) =>
                            MULTI_SELECT_CONTROLS_3D.includes(
                              item as (typeof MULTI_SELECT_CONTROLS_3D)[number]
                            )
                          );
                          return [...withoutSingle, 'background-map'];
                        });
                      }
                      return;
                    }
                    if (id === 'aerial-view') {
                      if (isActive) {
                        setIsAerialViewPanelExiting3d(true);
                        setActiveControls3d((prev) =>
                          prev.filter((item) =>
                            MULTI_SELECT_CONTROLS_3D.includes(
                              item as (typeof MULTI_SELECT_CONTROLS_3D)[number]
                            )
                          )
                        );
                      } else {
                        setIsAerialViewPanelExiting3d(false);
                        setIsBackgroundPanelExiting3d(false);
                        setActiveControls3d((prev) => {
                          const withoutSingle = prev.filter((item) =>
                            MULTI_SELECT_CONTROLS_3D.includes(
                              item as (typeof MULTI_SELECT_CONTROLS_3D)[number]
                            )
                          );
                          return [...withoutSingle, 'aerial-view'];
                        });
                      }
                    }
                  }}
                  onItemRightClick={(id) => {
                    if (id === 'background-map') {
                      if (activeControls3d.includes('background-map')) {
                        setIsBackgroundPanelExiting3d(true);
                        setActiveControls3d((p) => p.filter((x) => x !== 'background-map'));
                      } else {
                        setActiveControls3d((p) => {
                          const next = p.filter((x) => x !== 'aerial-view');
                          return next.includes('background-map') ? next : [...next, 'background-map'];
                        });
                      }
                    }
                    if (id === 'aerial-view') {
                      if (activeControls3d.includes('aerial-view')) {
                        setIsAerialViewPanelExiting3d(true);
                        setActiveControls3d((p) => p.filter((x) => x !== 'aerial-view'));
                      } else {
                        setActiveControls3d((p) => {
                          const next = p.filter((x) => x !== 'background-map');
                          return next.includes('aerial-view') ? next : [...next, 'aerial-view'];
                        });
                      }
                    }
                  }}
                  extraAfterFirstGroup={viewModeControls3d}
                />
              </div>
            </div>
          </div>
          {/* 3D 전용 플로팅: 배경지도 + 타일셋 켜기/끄기 */}
          <div
            className={cn(
              'absolute z-20 w-[min(18rem,calc(100vw-2rem))]',
              'rounded border border-border bg-background/95 shadow-lg p-3'
            )}
            style={{ left: leftPx, top: topPx + 50 }}
          >
            <button
              type="button"
              onClick={() => setGlobeVisible((v) => !v)}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors mb-3',
                globeVisible
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  : 'text-blue-600 bg-blue-50 hover:bg-blue-100'
              )}
              title={globeVisible ? '배경지도 끄기' : '배경지도 켜기'}
              aria-label={globeVisible ? '배경지도 끄기' : '배경지도 켜기'}
            >
              <Globe className="w-4 h-4 shrink-0" />
              {globeVisible ? '배경지도 끄기' : '배경지도 켜기'}
            </button>
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="font-medium text-sm">3D 데이터</span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={fetch3DTilesetDirs}
                  disabled={tilesetNamesLoading}
                  className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
                  title="목록 새로고침 (3dtiles_pnts · 3dtiles_b3dm)"
                >
                  새로고침
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  onClick={() => setViewMode('2d')}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  2D 지도
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {/* 포인트 클라우드 */}
              <div className="rounded-md border border-border p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">포인트 클라우드</span>
                  <input
                    type="checkbox"
                    checked={pointCloudCategoryEnabled}
                    onChange={() => setPointCloudCategoryEnabled((v) => !v)}
                    className="rounded shrink-0"
                    title="포인트 클라우드 타일 전체 표시"
                    aria-label="포인트 클라우드 표시"
                  />
                </div>
                <div
                  className={cn(
                    'space-y-2',
                    !pointCloudCategoryEnabled && 'opacity-50 pointer-events-none'
                  )}
                >
                  {tilesetNamesLoading ? (
                    <p className="text-xs text-muted-foreground">목록 불러오는 중…</p>
                  ) : pntsTilesetNames.length === 0 ? (
                    <p className="text-xs text-muted-foreground">PNTS 없음 (3dtiles_pnts/…/pnts)</p>
                  ) : (
                    pntsTilesetNames.map((name) => (
                      <div key={`pnts-${name}`} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`tileset-pnts-${name}`}
                          checked={pntsTilesetEnabled[name] ?? false}
                          onChange={() => {
                            setPntsTilesetEnabled((prev) => ({
                              ...prev,
                              [name]: !(prev[name] ?? true),
                            }));
                            setTilesetError(null);
                          }}
                          className="rounded"
                        />
                        <label
                          htmlFor={`tileset-pnts-${name}`}
                          className="text-sm cursor-pointer flex-1 min-w-0 truncate"
                        >
                          {name}
                        </label>
                        {(pntsTilesetEnabled[name] ?? false) && pointCloudCategoryEnabled && (
                          <button
                            type="button"
                            onClick={() =>
                              cesiumMapRef.current?.flyToTileset(tilesetLayerKey('pnts', name))
                            }
                            className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                            title="해당 위치로 이동"
                          >
                            <Crosshair className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 메시 (3dtiles_b3dm) */}
              <div className="rounded-md border border-border p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">메시 데이터</span>
                  <input
                    type="checkbox"
                    checked={meshCategoryEnabled}
                    onChange={() => setMeshCategoryEnabled((v) => !v)}
                    className="rounded shrink-0"
                    title="메시 타일 전체 표시"
                    aria-label="메시 데이터 표시"
                  />
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">전체 Z 오프셋</span>
                    <button
                      type="button"
                      onClick={() => {
                        setMeshTilesetZOffsetM(0);
                        setMeshTilesetZOffsetInput('0');
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline"
                    >
                      초기화
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => adjustMeshTilesetZOffset(-1)}
                      className="h-7 w-7 shrink-0 rounded border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-background"
                      title="메시 전체 높이 1m 내리기"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      step="0.1"
                      value={meshTilesetZOffsetInput}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setMeshTilesetZOffsetInput(raw);
                        const next = Number(raw);
                        if (Number.isFinite(next)) {
                          setMeshTilesetZOffsetM(next);
                        }
                      }}
                      onBlur={() => setMeshTilesetZOffsetInput(String(meshTilesetZOffsetM))}
                      className="h-7 w-full rounded border border-input bg-background px-2 text-xs"
                      aria-label="전체 메시 Z 오프셋 미터"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">m</span>
                    <button
                      type="button"
                      onClick={() => adjustMeshTilesetZOffset(1)}
                      className="h-7 w-7 shrink-0 rounded border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-background"
                      title="메시 전체 높이 1m 올리기"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    모든 메시 데이터에 일괄 적용됩니다.
                  </p>
                </div>
                <div
                  className={cn(
                    'space-y-2',
                    !meshCategoryEnabled && 'opacity-50 pointer-events-none'
                  )}
                >
                  {tilesetNamesLoading ? (
                    <p className="text-xs text-muted-foreground">목록 불러오는 중…</p>
                  ) : meshTilesetNames.length === 0 ? (
                    <p className="text-xs text-muted-foreground">메시 없음 (3dtiles_b3dm)</p>
                  ) : (
                    meshTilesetNames.map((name) => (
                      <div key={`b3dm-${name}`} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`tileset-b3dm-${name}`}
                          checked={meshTilesetEnabled[name] ?? false}
                          onChange={() => {
                            setMeshTilesetEnabled((prev) => ({
                              ...prev,
                              [name]: !(prev[name] ?? true),
                            }));
                            setTilesetError(null);
                          }}
                          className="rounded"
                        />
                        <label
                          htmlFor={`tileset-b3dm-${name}`}
                          className="text-sm cursor-pointer flex-1 min-w-0 truncate"
                        >
                          {name}
                        </label>
                        <button
                          type="button"
                          onClick={() => handleMeshFlyTo(name)}
                          className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="해당 위치로 이동"
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {tilesetError && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">{tilesetError}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
