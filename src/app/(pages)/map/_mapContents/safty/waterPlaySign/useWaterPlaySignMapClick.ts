'use client';

import { useEffect, useRef } from 'react';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import '../../../_mapComponents/config/projections';
import { call } from '@/lib/api';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { WATER_PLAY_SIGN_GEO_TABLE } from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { getRowValueByDefineField } from '../../../_mapComponents/standard/defineLayerRowUtils';
import type { WaterPlaySignListItem } from '@/service/waterPlaySignService';
import { flyToWaterPlaySignRow } from './waterPlaySignMapFly';

function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

function parseRowId(row: Record<string, unknown>): number | null {
  const raw = getRowValueByDefineField(row, 'id');
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

type Options = {
  mapReady: boolean;
  panelOpen: boolean;
  items: WaterPlaySignListItem[];
  onSelectDetailId: (id: number) => void;
};

export function useWaterPlaySignMapClick({
  mapReady,
  panelOpen,
  items,
  onSelectDetailId,
}: Options) {
  const mapContext = useMapContext();
  const itemsRef = useRef(items);
  const onSelectRef = useRef(onSelectDetailId);
  const panelOpenRef = useRef(panelOpen);
  const visRef = useRef(mapContext?.safetyMapLayerVisibility ?? {});

  itemsRef.current = items;
  onSelectRef.current = onSelectDetailId;
  panelOpenRef.current = panelOpen;
  visRef.current = mapContext?.safetyMapLayerVisibility ?? {};

  useEffect(() => {
    if (!panelOpen) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (!panelOpenRef.current) return;
      if (mapContext?.spatialDrawRequest) return;
      if (mapContext?.mapMeasureTool) return;
      if (mapContext?.mapDrawInputSuspended) return;
      if (mapContext?.layerRowGeomEdit) return;

      if (visRef.current[WATER_PLAY_SIGN_GEO_TABLE] !== true) return;

      const zoom = evt.map.getView().getZoom() ?? 10;
      const bufferMeters = zoomToBuffer(zoom);
      const [x, y] = evt.coordinate as [number, number];

      try {
        const res = await call('', 'POST', {
          service: 'standardService',
          action: 'identifyFeatures',
          params: {
            x,
            y,
            buffer: bufferMeters,
            tables: [WATER_PLAY_SIGN_GEO_TABLE],
            schema: 'layer',
          },
        });
        const data = res?.data ?? res;
        const results = Array.isArray(data?.results) ? data.results : [];
        const layerHit = results.find(
          (r: { tableName?: string }) =>
            String(r?.tableName ?? '')
              .trim()
              .toLowerCase() === WATER_PLAY_SIGN_GEO_TABLE
        ) as { features?: { data?: Record<string, unknown> }[] } | undefined;
        const row = layerHit?.features?.[0]?.data;
        if (!row) return;

        const id = parseRowId(row);
        if (!id) return;

        onSelectRef.current(id);
        flyToWaterPlaySignRow(map, itemsRef.current.find((r) => r.id === id) ?? null);
      } catch {
        /* 식별 실패 무시 */
      }
    };

    const key = map.on('singleclick', handleClick as never);
    return () => {
      if (key) unByKey(key);
    };
  }, [
    mapReady,
    panelOpen,
    mapContext?.mapInstanceRef,
    mapContext?.spatialDrawRequest,
    mapContext?.mapMeasureTool,
    mapContext?.mapDrawInputSuspended,
    mapContext?.layerRowGeomEdit,
    mapContext?.safetyMapLayerVisibility,
  ]);
}
