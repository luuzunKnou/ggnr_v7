'use client';

import { useEffect, useRef } from 'react';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { call } from '@/lib/api';
import { useMapContext } from '../../_mapComponents/MapContext';
import { encodeMemoRowKey, MEMO_SCHEMA, MEMO_TABLES } from './memoConfig';

type MemoTableRef = { tableName: string };

/** d = 300000 * 0.54^z — 민원·재난대응시설 식별과 동일 */
function zoomToBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

function pickMemoKey(row: Record<string, unknown>): string | null {
  const raw = row.memo_key ?? row.memoKey ?? row.MEMO_KEY;
  const s = String(raw ?? '').trim();
  return s || null;
}

type Props = {
  enabled: boolean;
  /** 없으면 공통 메모 테이블 전체 */
  tables?: readonly MemoTableRef[];
  onSelectRowKey: (rowKey: string) => void | Promise<void>;
};

/**
 * 메모관리 패널이 열린 동안 메모 레이어만 식별.
 * 클릭 시 상세를 열고, 강조·이동은 목록 쪽에서 처리한다(지도 클릭은 이동 없음).
 */
export function useMemoMapClick({ enabled, tables, onSelectRowKey }: Props) {
  const mapContext = useMapContext();
  const onSelectRef = useRef(onSelectRowKey);
  onSelectRef.current = onSelectRowKey;
  const tableNames = (tables && tables.length > 0 ? tables : MEMO_TABLES).map((t) => t.tableName);
  const tableKey = tableNames.join(',');
  const tableNamesRef = useRef(tableNames);
  tableNamesRef.current = tableNames;

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
            tables: tableNamesRef.current,
            schema: MEMO_SCHEMA,
          },
        });
        const data = res?.data ?? res;
        const allowed = new Set(tableNamesRef.current.map((t) => t.toLowerCase()));
        const results = Array.isArray(data?.results) ? data.results : [];
        const first = results.find((r: { tableName?: string; features?: unknown[] }) => {
          const table = String(r?.tableName ?? '')
            .trim()
            .toLowerCase();
          return allowed.has(table) && Array.isArray(r?.features) && r.features.length > 0;
        }) as
          | {
              tableName?: string;
              features?: { data?: Record<string, unknown> }[];
            }
          | undefined;
        const table = String(first?.tableName ?? '')
          .trim()
          .toLowerCase();
        if (!table || !allowed.has(table)) return;

        const row = first?.features?.[0]?.data;
        if (!row) return;
        const memoKey = pickMemoKey(row);
        if (!memoKey) return;

        await onSelectRef.current(encodeMemoRowKey(table, memoKey));
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
    tableKey,
  ]);
}
