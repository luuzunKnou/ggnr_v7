'use client';

import { useEffect, useRef } from 'react';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import '../../../_mapComponents/config/projections';
import { call } from '@/lib/api';
import { useMapContext } from '../../../_mapComponents/MapContext';
import {
  WATER_PLAY_MGMT_ZONE_GEO_TABLE,
  WATER_PLAY_SIGN_GEO_TABLE,
} from '../../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { getRowValueByDefineField } from '../../../_mapComponents/standard/defineLayerRowUtils';
import type { WaterPlaySignListItem } from '@/service/waterPlaySignService';

function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

function parseRowId(row: Record<string, unknown>): number | null {
  const raw = getRowValueByDefineField(row, 'id');
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

async function identifyFirstRow(
  x: number,
  y: number,
  buffer: number,
  tableName: string
): Promise<Record<string, unknown> | null> {
  const res = await call('', 'POST', {
    service: 'standardService',
    action: 'identifyFeatures',
    params: {
      x,
      y,
      buffer,
      tables: [tableName],
      schema: 'layer',
    },
  });
  const data = res?.data ?? res;
  const results = Array.isArray(data?.results) ? data.results : [];
  const layerHit = results.find(
    (r: { tableName?: string }) =>
      String(r?.tableName ?? '')
        .trim()
        .toLowerCase() === tableName
  ) as { features?: { data?: Record<string, unknown> }[] } | undefined;
  return layerHit?.features?.[0]?.data ?? null;
}

type Options = {
  mapReady: boolean;
  panelOpen: boolean;
  items: WaterPlaySignListItem[];
  onSelectDetailId: (id: number) => void;
  /** 관리지역 레이어 ON일 때 우선 identify */
  mgmtLayerOn?: boolean;
  onMgmtHit?: (row: Record<string, unknown>) => void;
};

export function useWaterPlaySignMapClick({
  mapReady,
  panelOpen,
  items,
  onSelectDetailId,
  mgmtLayerOn = false,
  onMgmtHit,
}: Options) {
  const mapContext = useMapContext();
  const itemsRef = useRef(items);
  const onSelectRef = useRef(onSelectDetailId);
  const panelOpenRef = useRef(panelOpen);
  const visRef = useRef(mapContext?.safetyMapLayerVisibility ?? {});
  const mgmtOnRef = useRef(mgmtLayerOn);
  const onMgmtHitRef = useRef(onMgmtHit);

  itemsRef.current = items;
  onSelectRef.current = onSelectDetailId;
  panelOpenRef.current = panelOpen;
  visRef.current = mapContext?.safetyMapLayerVisibility ?? {};
  mgmtOnRef.current = mgmtLayerOn;
  onMgmtHitRef.current = onMgmtHit;

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

      const zoom = evt.map.getView().getZoom() ?? 10;
      const bufferMeters = zoomToBuffer(zoom);
      const [x, y] = evt.coordinate as [number, number];

      try {
        const wantMgmt = Boolean(mgmtOnRef.current && onMgmtHitRef.current);
        const wantSign = visRef.current[WATER_PLAY_SIGN_GEO_TABLE] === true;
        if (!wantMgmt && !wantSign) return;

        const [mgmtRow, signRow] = await Promise.all([
          wantMgmt
            ? identifyFirstRow(x, y, bufferMeters, WATER_PLAY_MGMT_ZONE_GEO_TABLE)
            : Promise.resolve(null),
          wantSign
            ? identifyFirstRow(x, y, bufferMeters, WATER_PLAY_SIGN_GEO_TABLE)
            : Promise.resolve(null),
        ]);

        if (mgmtRow && onMgmtHitRef.current) {
          onMgmtHitRef.current(mgmtRow);
        }

        if (signRow) {
          const id = parseRowId(signRow);
          if (id) onSelectRef.current(id);
        }
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
