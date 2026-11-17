'use client';

import { useEffect, useRef } from 'react';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { call } from '@/lib/api';
import { useMapContext } from '../../_mapComponents/MapContext';
import { GROUNDWATER_PERMIT_WMS_LAYER_ID } from './groundwaterPermitLayerId';
import { setGroundwaterPermitHighlightFit } from './useGroundwaterPermitMapHighlight';

/** d = 300000 * 0.54^z — 메모·민원 식별과 동일 */
function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

const LAYER_ID = GROUNDWATER_PERMIT_WMS_LAYER_ID.toLowerCase();

function pickSoinnKey(row: Record<string, unknown>): string | null {
  const raw =
    row.soinn_key ?? row.soinnKey ?? row.SOINN_KEY ?? row.Soinn_Key ?? row.id;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.floor(n));
}

type Props = {
  enabled: boolean;
  onSelectId: (id: string) => void | Promise<void>;
};

/**
 * 지하수 개발허가 패널이 열린 동안 soinn00001 만 식별.
 * 클릭 시 상세를 열고, 강조는 상세 훅에서 처리(지도 클릭은 맵 이동 없음).
 */
export function useGroundwaterPermitMapClick({ enabled, onSelectId }: Props) {
  const mapContext = useMapContext();
  const onSelectRef = useRef(onSelectId);
  onSelectRef.current = onSelectId;

  useEffect(() => {
    if (!enabled) return;
    const map = mapContext?.mapInstanceRef?.current;
    const mapReady = mapContext?.mapReady;
    if (!mapReady || !map) return;

    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (!evt.map) return;
      if (mapContext?.spatialDrawRequest) return;
      if (mapContext?.mapMeasureTool) return;
      if (mapContext?.mapDrawInputSuspended) return;
      if (mapContext?.layerRowGeomEdit) return;

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
            tables: [GROUNDWATER_PERMIT_WMS_LAYER_ID],
            schema: 'layer',
          },
        });
        const data = res?.data ?? res;
        const results = Array.isArray(data?.results) ? data.results : [];
        const first = results.find((r: { tableName?: string; features?: unknown[] }) => {
          const table = String(r?.tableName ?? '')
            .trim()
            .toLowerCase();
          return table === LAYER_ID && Array.isArray(r?.features) && r.features.length > 0;
        }) as
          | {
              tableName?: string;
              features?: { data?: Record<string, unknown> }[];
            }
          | undefined;
        const row = first?.features?.[0]?.data;
        if (!row) return;
        const id = pickSoinnKey(row);
        if (!id) return;

        setGroundwaterPermitHighlightFit(id, false);
        await onSelectRef.current(id);
      } catch {
        /* 클릭 식별 실패는 무시 */
      }
    };

    const key = map.on('singleclick', handleClick as never);
    return () => {
      if (key) unByKey(key);
    };
  }, [
    enabled,
    mapContext?.mapInstanceRef,
    mapContext?.mapReady,
    mapContext?.spatialDrawRequest,
    mapContext?.mapMeasureTool,
    mapContext?.mapDrawInputSuspended,
    mapContext?.layerRowGeomEdit,
  ]);
}
