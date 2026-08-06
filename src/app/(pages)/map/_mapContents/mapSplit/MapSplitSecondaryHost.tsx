'use client';

import { useEffect, useRef, useState } from 'react';
import { Map as OlMap, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { defaults } from 'ol/control';
import { Crosshair } from 'lucide-react';
import { useMapContext } from '../../_mapComponents/MapContext';
import { RESOLUTIONS_3857 } from '../../_mapComponents/config/mapDefaults';
import '../../_mapComponents/config/projections';
import { createCadastralLayers, createBuildingRoadLayers } from '../../_mapComponents/layerFactory/boundaryLayerFactory';
import { createBasicSectionLayers } from '../../_mapComponents/layerFactory/basicSectionLayerFactory';
import { createJimokLayers } from '../../_mapComponents/layerFactory/jimokLayerFactory';
import { createOwnershipLayers } from '../../_mapComponents/layerFactory/ownershipLayerFactory';
import { createThematicMapLayers } from '../../_mapComponents/layerFactory/thematicMapLayerFactory';
import { createSafetydataMapLayers } from '../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { createServiceLayer } from '../../_mapComponents/layerFactory/serviceLayerFactory';
import { useBackgroundLayer } from '../../_mapComponents/hooks/useBackgroundLayer';
import { FALLBACK_BACKGROUND_MAP_ID } from '../../_mapComponents/mapControlPanel/backgroundMapSelector';
import { syncSecondaryLayersFromPrimary } from './syncSecondaryLayersFromPrimary';
import {
  clearDynamicLayerMirrors,
  type DynamicMirrorRegistry,
} from './mirrorPrimaryDynamicLayers';
import { useMapSplitViewSync } from './useMapSplitViewSync';
import { useMapSplitBasemapSync } from './useMapSplitBasemap';
import { useMapSplitIdentifyBridge } from './useMapSplitIdentifyBridge';
import { useMapSplitPointerBridge } from './useMapSplitPointerBridge';
import { MapSplitSecondaryMapInputs } from './MapSplitSecondaryMapInputs';

type MapSplitSecondaryHostProps = {
  active: boolean;
};

/**
 * 지도분할 보조(우측) OL 맵 — 전체 OpenLayersMap 이중 마운트 없이 경량 Host.
 */
export function MapSplitSecondaryHost({ active }: MapSplitSecondaryHostProps) {
  const mapContext = useMapContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const localMapRef = useRef<OlMap | null>(null);
  const mirrorRegistryRef = useRef<DynamicMirrorRegistry>(new globalThis.Map());
  const [secondaryReady, setSecondaryReady] = useState(false);
  const [secondaryMap, setSecondaryMap] = useState<OlMap | null>(null);

  const primary = mapContext?.mapInstanceRef?.current ?? null;
  const mapSync = mapContext?.mapSplitMapSync ?? true;
  const secondaryBackgroundId =
    mapContext?.mapSplitSecondaryBackgroundId ?? FALLBACK_BACKGROUND_MAP_ID;
  const primaryBackgroundId = mapContext?.mapBackgroundMapIdRef?.current;

  useMapSplitBasemapSync(active, primaryBackgroundId);

  // 맵 생성
  useEffect(() => {
    if (!active || !containerRef.current || localMapRef.current) return;

    const primaryMap = mapContext?.mapInstanceRef?.current ?? null;
    const pView = primaryMap?.getView();
    const center = pView?.getCenter() ?? [0, 0];
    const resolution = pView?.getResolution();
    const zoom = pView?.getZoom();

    const map = new OlMap({
      target: containerRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
          properties: { name: 'background' },
        }),
        ...createCadastralLayers(),
        ...createBuildingRoadLayers(),
        ...createBasicSectionLayers(),
        ...createJimokLayers(),
        ...createOwnershipLayers(),
        ...createThematicMapLayers(),
        ...createSafetydataMapLayers(),
      ],
      view: new View({
        center: [...center],
        ...(resolution != null ? { resolution } : { zoom: zoom ?? 12 }),
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
      }),
      controls: defaults({
        zoom: false,
        attribution: false,
      }),
    });

    map.getLayers().push(createServiceLayer());

    localMapRef.current = map;
    if (mapContext?.mapSplitSecondaryMapRef) {
      mapContext.mapSplitSecondaryMapRef.current = map;
    }
    setSecondaryMap(map);
    setSecondaryReady(true);

    // 진입 시 보조 배경 = 주 배경
    const bg = mapContext?.mapBackgroundMapIdRef?.current;
    if (bg) mapContext?.setMapSplitSecondaryBackgroundId?.(bg);

    return () => {
      clearDynamicLayerMirrors(map, mirrorRegistryRef.current);
      map.setTarget(undefined);
      localMapRef.current = null;
      if (mapContext?.mapSplitSecondaryMapRef) {
        mapContext.mapSplitSecondaryMapRef.current = null;
      }
      setSecondaryMap(null);
      setSecondaryReady(false);
    };
    // active 전환 시에만 생성/파괴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useBackgroundLayer(
    secondaryReady ? secondaryMap : null,
    secondaryBackgroundId
  );

  // 레이어 visible/params + 동적(API) 레이어 미러
  useEffect(() => {
    if (!active || !secondaryReady || !primary || !secondaryMap) return;

    const registry = mirrorRegistryRef.current;
    const sync = () => syncSecondaryLayersFromPrimary(primary, secondaryMap, registry);
    sync();

    const layers = primary.getLayers();
    const onAdd = () => sync();
    const onRemove = () => sync();
    layers.on('add', onAdd);
    layers.on('remove', onRemove);

    const timer = window.setInterval(sync, 400);
    return () => {
      layers.un('add', onAdd);
      layers.un('remove', onRemove);
      window.clearInterval(timer);
    };
  }, [active, secondaryReady, primary, secondaryMap]);

  // 포커스: 우측 포인터 → secondary
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const el = containerRef.current;
    const onPointer = () => {
      mapContext?.setMapSplitBasemapFocus?.('secondary');
    };
    el.addEventListener('pointerdown', onPointer);
    return () => el.removeEventListener('pointerdown', onPointer);
  }, [active, mapContext]);

  useMapSplitViewSync(
    primary,
    secondaryReady ? secondaryMap : null,
    active && secondaryReady,
    mapSync
  );

  useMapSplitPointerBridge(
    primary,
    secondaryReady ? secondaryMap : null,
    active && secondaryReady
  );

  useMapSplitIdentifyBridge(
    primary,
    secondaryReady ? secondaryMap : null,
    active && secondaryReady
  );

  if (!active) return null;

  return (
    <div
      className="relative h-full w-full bg-black"
      data-map-split-secondary
    >
      <MapSplitSecondaryMapInputs map={secondaryMap} active={active && secondaryReady} />
      <div ref={containerRef} className="h-full w-full [&_.ol-viewport]:bg-black" />
      {/* 우측 분할지도 중앙 마크 — 좌측과 동일 (주황 크로스헤어) */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-[5] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
        aria-hidden
      >
        <Crosshair
          className="h-6 w-6 text-orange-600 opacity-80 drop-shadow-md"
          strokeWidth={2}
        />
      </div>
    </div>
  );
}
