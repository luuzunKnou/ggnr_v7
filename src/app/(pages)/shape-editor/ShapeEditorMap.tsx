'use client';

import { useEffect, useRef } from 'react';
import { useBackgroundLayer } from '../map/_mapComponents/hooks/useBackgroundLayer';
import { useOfficialLandPriceMapLayer } from '../map/_mapComponents/hooks/useOfficialLandPriceMapLayer';
import {
  useBuildingRoadLayerSync,
} from '../map/_mapComponents/layerFactory/boundaryLayerFactory';
import { useJimokLayerSync } from '../map/_mapComponents/layerFactory/jimokLayerFactory';
import { useLandownLayerSync } from '../map/_mapComponents/layerFactory/landownLayerFactory';
import { useServiceLayerSync } from '../map/_mapComponents/layerFactory/serviceLayerFactory';
import type { ShapeEditorOverlayControls } from './_hooks/useShapeEditorOverlayControls';
import { useShapeEditorMapInstance } from './_hooks/useShapeEditorMapInstance';
import { useShapeEditorContext } from './ShapeEditorContext';
import { ShapeEditorEngine } from './_components/ShapeEditorEngine';

type ShapeEditorMapProps = {
  projectName: string;
  defaultCenter?: { lon: number; lat: number } | null;
  backgroundMapId: string;
  overlayControls: ShapeEditorOverlayControls;
};

export function ShapeEditorMap({
  projectName,
  defaultCenter,
  backgroundMapId,
  overlayControls,
}: ShapeEditorMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const { mapInstanceRef, mapReady } = useShapeEditorMapInstance(mapRef, defaultCenter, projectName);
  const { registerMap, visibleLayerNames, wmsRefreshToken, hiddenWmsFeaturesByLayer } =
    useShapeEditorContext();

  const {
    activeControls,
    visibleJimokLayerNames,
    visibleLandownLayerNames,
    visibleBuildingRoadLayerNames,
  } = overlayControls;

  useEffect(() => {
    registerMap(mapInstanceRef.current);
    return () => registerMap(null);
  }, [mapReady, registerMap, mapInstanceRef]);

  useBackgroundLayer(mapInstanceRef.current, backgroundMapId);

  useBuildingRoadLayerSync(
    mapInstanceRef.current,
    mapReady,
    activeControls,
    visibleBuildingRoadLayerNames
  );
  useJimokLayerSync(mapInstanceRef.current, mapReady, activeControls, visibleJimokLayerNames);
  useLandownLayerSync(mapInstanceRef.current, mapReady, activeControls, visibleLandownLayerNames);
  useOfficialLandPriceMapLayer(
    mapInstanceRef.current,
    mapReady,
    activeControls.includes('official-land-price')
  );

  useServiceLayerSync(
    mapInstanceRef.current,
    mapReady,
    visibleLayerNames,
    undefined,
    undefined,
    undefined,
    hiddenWmsFeaturesByLayer
  );

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || wmsRefreshToken === 0) return;
    const serviceLayer = mapInstanceRef.current
      .getLayers()
      .getArray()
      .find((l) => l.get('serviceLayer')) as { getSource?: () => { changed?: () => void } | null } | undefined;
    serviceLayer?.getSource?.()?.changed?.();
  }, [mapReady, wmsRefreshToken, mapInstanceRef]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="h-full w-full" />
      {mapReady && mapInstanceRef.current ? (
        <ShapeEditorEngine map={mapInstanceRef.current} />
      ) : null}
    </div>
  );
}
