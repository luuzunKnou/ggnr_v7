'use client';

import { useEffect, useRef } from 'react';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { call } from '@/lib/api';
import { useMapContext } from '../../../_mapComponents/MapContext';
import {
  ROAD_REWARD_PARCEL_WMS_LAYER_ID,
  ROAD_REWARD_WMS_LAYER_ID,
} from './roadRewardLayerId';

/** d = 300000 * 0.54^z — 민원·재난대응시설·일반 식별과 동일 */
function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

export type RoadRewardMapPick = {
  caseId: string;
  parcelId?: string;
};

function pickOgcFid(row: Record<string, unknown>): string | null {
  const raw = row.ogc_fid ?? row.OGC_FID ?? row.gid ?? row.fid;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.trunc(n));
}

function pickRewardKey(row: Record<string, unknown>): string | null {
  const raw = row.reward_key ?? row.rewardKey ?? row.REWARD_KEY;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.trunc(n));
}

function parseIdentifyPick(
  results: {
    tableName?: string;
    features?: { data?: Record<string, unknown> }[];
  }[]
): RoadRewardMapPick | null {
  let caseHit: RoadRewardMapPick | null = null;

  for (const block of results) {
    const table = String(block.tableName ?? '')
      .trim()
      .toLowerCase();
    const row = block.features?.[0]?.data;
    if (!row) continue;

    if (table === ROAD_REWARD_PARCEL_WMS_LAYER_ID) {
      const parcelId = pickOgcFid(row);
      const caseId = pickRewardKey(row);
      if (parcelId && caseId) {
        return { caseId, parcelId };
      }
      continue;
    }

    if (table === ROAD_REWARD_WMS_LAYER_ID && !caseHit) {
      const caseId = pickOgcFid(row);
      if (caseId) {
        caseHit = { caseId };
      }
    }
  }

  return caseHit;
}

type Props = {
  enabled: boolean;
  onPick: (pick: RoadRewardMapPick) => void | Promise<void>;
};

/**
 * 보상편입용지 패널이 열린 동안 `road_reward`·`road_reward_parcel` 레이어 식별.
 * 필지 클릭 시 부모 건 + 필지 id, 건 클릭 시 건 id만 전달한다.
 */
export function useRoadRewardMapClick({ enabled, onPick }: Props) {
  const mapContext = useMapContext();
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

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
            tables: [ROAD_REWARD_WMS_LAYER_ID, ROAD_REWARD_PARCEL_WMS_LAYER_ID],
            schema: 'layer',
          },
        });
        const data = res?.data ?? res;
        const results = Array.isArray(data?.results) ? data.results : [];
        const pick = parseIdentifyPick(results);
        if (!pick) return;

        await onPickRef.current(pick);
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
