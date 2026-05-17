'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { Map, Box, Crosshair, Globe } from 'lucide-react';
import OpenLayersMap from './OpenLayersMap';
import { MapControlPanel, defaultMapControlGroups } from './mapControlPanel/mapControlPanel';
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

/** 3D 오른쪽 패널에서 다중 토글 허용 id (OpenLayers MULTI_SELECT_IDS 와 동일 계열) */
const MULTI_SELECT_CONTROLS_3D = ['cadastral', 'thematic-map'] as const;

const CesiumMap = dynamic(() => import('../../3dMap/CesiumMap'), { ssr: false });

/** 3D 타일: service_data/3dtiles/<데이터셋>/pnts|b3dm */

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
        'flex flex-col items-center justify-center gap-0 shrink-0 box-border p-0 transition-colors',
        'hover:bg-slate-100 hover:text-blue-600',
        isActive && 'bg-slate-100 text-blue-600'
      )}
      style={{ width: 45, height: 45 }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
      <span className="leading-tight text-center whitespace-nowrap overflow-hidden truncate" style={{ maxWidth: 45, fontSize: '9px' }}>{label}</span>
    </button>
  );
}

export default function MapViewModeWrapper() {
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
  /** 3D 오른쪽 패널 활성 컨트롤 id (지적도 WMS 등) */
  const [activeControls3d, setActiveControls3d] = useState<string[]>([]);
  /** 3D 배경: 2D에서 마지막으로 쓴 mapBackgroundMapIdRef 와 동기화 */
  const [cesiumBackgroundMapId, setCesiumBackgroundMapId] = useState('aerial-2022');
  const [backgroundMapGroups3d, setBackgroundMapGroups3d] =
    useState<BackgroundMapGroup[]>(defaultBackgroundMapGroups);
  const [isBackgroundPanelExiting3d, setIsBackgroundPanelExiting3d] = useState(false);
  const cesiumMapRef = useRef<CesiumMapRef>(null);
  const { leftPx, topPx } = useSearchBarOffset();
  const mapContext = useMapContext();

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
        if (opts.length === 0) return;
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
      patchPersistedBackgroundMap(value);
    },
    [mapContext]
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

  const handleTilesetLoadError = useCallback((_name: string, message: string) => {
    setTilesetError(message);
  }, []);

  const viewModeControls2d = (
    <ViewModeButton
      label="3D 지도"
      icon={Box}
      isActive={viewMode === '3d'}
      onClick={() => setViewMode('3d')}
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

  return (
    <div className="relative w-full h-full">
      {viewMode === '2d' && (
        <OpenLayersMap extraControls={viewModeControls2d} />
      )}

      {viewMode === '3d' && (
        <>
          <CesiumMap
            ref={cesiumMapRef}
            onReady={(api) => {
              cesiumMapRef.current = api;
            }}
            visibleTilesets={visibleTilesets}
            onTilesetLoadError={handleTilesetLoadError}
            globeVisible={globeVisible}
            cadastralWmsEnabled={activeControls3d.includes('cadastral')}
            cadastralVisibleTableNames={null}
            backgroundMapId={cesiumBackgroundMapId}
            basemapImageryVisible
          />
          {/* 2D와 동일: 배경지도 선택 + 오른쪽 맵 컨트롤 (지적도 WMS 등) */}
          <div className="absolute right-4 z-10 flex flex-col items-end gap-3" style={{ top: '60px' }}>
            <div className="flex items-start gap-3">
              {(activeControls3d.includes('background-map') || isBackgroundPanelExiting3d) && (
                <div
                  className={
                    isBackgroundPanelExiting3d
                      ? 'animate-out fade-out-0 slide-out-to-right-4 duration-[400ms]'
                      : 'animate-in fade-in-0 slide-in-from-right-4 duration-[400ms]'
                  }
                >
                  <BackgroundMapSelector
                    groups={backgroundMapGroups3d}
                    value={cesiumBackgroundMapId}
                    onValueChange={applyBackgroundChoice}
                  />
                </div>
              )}
              <MapControlPanel
                groups={defaultMapControlGroups}
                activeIds={activeControls3d}
                onItemClick={(id, isActive) => {
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
                      setActiveControls3d((prev) => {
                        const withoutSingle = prev.filter((item) =>
                          MULTI_SELECT_CONTROLS_3D.includes(
                            item as (typeof MULTI_SELECT_CONTROLS_3D)[number]
                          )
                        );
                        return [...withoutSingle, 'background-map'];
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
                      setActiveControls3d((p) => (p.includes('background-map') ? p : [...p, 'background-map']));
                    }
                  }
                }}
                extraAfterFirstGroup={viewModeControls3d}
              />
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
                  title="목록 새로고침 (service_data/3dtiles/…/pnts·b3dm)"
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
                    <p className="text-xs text-muted-foreground">PNTS 없음 (3dtiles/…/pnts)</p>
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
                <div
                  className={cn(
                    'space-y-2',
                    !meshCategoryEnabled && 'opacity-50 pointer-events-none'
                  )}
                >
                  {tilesetNamesLoading ? (
                    <p className="text-xs text-muted-foreground">목록 불러오는 중…</p>
                  ) : meshTilesetNames.length === 0 ? (
                    <p className="text-xs text-muted-foreground">메시 없음 (3dtiles/…/b3dm)</p>
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
                        {(meshTilesetEnabled[name] ?? false) && meshCategoryEnabled && (
                          <button
                            type="button"
                            onClick={() =>
                              cesiumMapRef.current?.flyToTileset(tilesetLayerKey('b3dm', name))
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
