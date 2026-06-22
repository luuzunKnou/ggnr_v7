'use client';

import { useEffect, useRef } from 'react';
import { useBackgroundLayer } from '../map/_mapComponents/hooks/useBackgroundLayer';
import { useServiceLayerSync } from '../map/_mapComponents/layerFactory/serviceLayerFactory';
import { useShapeEditorMapInstance } from './_hooks/useShapeEditorMapInstance';
import { useShapeEditorContext } from './ShapeEditorContext';
import { ShapeEditorEngine } from './_components/ShapeEditorEngine';

type ShapeEditorMapProps = {
  projectName: string;
  defaultCenter?: { lon: number; lat: number } | null;
  backgroundMapId: string;
};

export function ShapeEditorMap({ projectName, defaultCenter, backgroundMapId }: ShapeEditorMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const { mapInstanceRef, mapReady } = useShapeEditorMapInstance(mapRef, defaultCenter, projectName);
  const { registerMap, visibleLayerNames, wmsRefreshToken } = useShapeEditorContext();

  useEffect(() => {
    registerMap(mapInstanceRef.current);
    return () => registerMap(null);
  }, [mapReady, registerMap, mapInstanceRef]);

  useBackgroundLayer(mapInstanceRef.current, backgroundMapId);

  useServiceLayerSync(mapInstanceRef.current, mapReady, visibleLayerNames);

  // 저장 후 WMS 갱신
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
