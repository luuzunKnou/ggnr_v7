'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import { MapSideListPanel } from '../../_mapComponents/MapSideListPanel';
import { call } from '@/lib/api';
import { dxfStringToOlFeatures } from '@/lib/dxfToOpenLayers';
import {
  DRAWING_CRS_OPTIONS,
  DRAWING_DEFAULT_CRS,
  DRAWING_DISPLAY_PANEL_MAX_WIDTH,
  DRAWING_DISPLAY_PANEL_MIN_WIDTH,
  type DrawingCrsCode,
} from './drawingDisplayConfig';
import type { DrawingDisplayItem } from './drawingDisplayTypes';
import {
  useDrawingDisplayLayer,
  type DrawingLayerStatus,
} from './useDrawingDisplayLayer';
import { DrawingDisplayPanel } from './DrawingDisplayPanel';
import { useUploadCrsCandidates } from '../userDataUpload/useUploadCrsCandidates';
import type { UploadCrsCode } from '../userDataUpload/userDataUploadConfig';

type Props = {
  width: number;
  leftOffsetPx: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
};

type StoredRow = {
  id: string;
  fileName: string;
  crs: string;
  manualCrs: boolean;
  visible: boolean;
  createdAt?: string;
};

const EMPTY_HIDDEN = new Set<string>();

function rawExtentFromFeatures(features: Feature<Geometry>[]): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of features) {
    const e = f.getGeometry()?.getExtent();
    if (!e || !e.every(Number.isFinite)) continue;
    minX = Math.min(minX, e[0]);
    minY = Math.min(minY, e[1]);
    maxX = Math.max(maxX, e[2]);
    maxY = Math.max(maxY, e[3]);
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

function isGeographicExtent([minX, minY, maxX, maxY]: [number, number, number, number]): boolean {
  return Math.abs(minX) <= 180 && Math.abs(maxX) <= 180 && Math.abs(minY) <= 90 && Math.abs(maxY) <= 90;
}

function asDrawingCrs(raw: string | undefined | null): DrawingCrsCode {
  const code = String(raw ?? '');
  if (DRAWING_CRS_OPTIONS.some((o) => o.code === code)) return code as DrawingCrsCode;
  return DRAWING_DEFAULT_CRS;
}

async function fetchDxfText(id: string): Promise<string> {
  const res = await fetch(`/api/drawingDisplay/dxf?id=${encodeURIComponent(id)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `도면을 불러오지 못했습니다. (${res.status})`);
  }
  return res.text();
}

function itemFromDxf(
  row: StoredRow,
  dxfText: string,
  shouldFit: boolean
): DrawingDisplayItem | null {
  const { features: parsed, parseError } = dxfStringToOlFeatures(dxfText);
  if (!parsed.length) return null;
  return {
    id: row.id,
    fileName: row.fileName,
    createdAt: row.createdAt || new Date().toISOString(),
    dxfText,
    features: parsed,
    crs: asDrawingCrs(row.crs),
    manualCrs: Boolean(row.manualCrs),
    /** 새로 올린 건은 자동 좌표계 확인, 복원 건은 저장된 좌표계 사용 */
    mapCrsReady: !shouldFit || Boolean(row.manualCrs),
    visible: row.visible !== false,
    parseNote: parseError,
    shouldFit,
  };
}

function DrawingItemHost({
  item,
  onPatch,
  onStatus,
  onFitted,
}: {
  item: DrawingDisplayItem;
  onPatch: (id: string, patch: Partial<DrawingDisplayItem>) => void;
  onStatus: (id: string, status: DrawingLayerStatus) => void;
  onFitted: (id: string) => void;
}) {
  const extent = useMemo(() => rawExtentFromFeatures(item.features), [item.features]);
  const crsCheck = useUploadCrsCandidates(extent);
  const topCandidate = crsCheck.candidates?.[0]?.code as UploadCrsCode | undefined;

  useEffect(() => {
    if (!item.features.length) {
      if (item.mapCrsReady) onPatch(item.id, { mapCrsReady: false });
      return;
    }
    if (item.manualCrs) {
      if (!item.mapCrsReady) onPatch(item.id, { mapCrsReady: true });
      return;
    }
    if (!extent) return;

    if (isGeographicExtent(extent)) {
      const patch: Partial<DrawingDisplayItem> = { mapCrsReady: true };
      if (item.crs !== '4326') patch.crs = '4326';
      if (!item.mapCrsReady || item.crs !== '4326') onPatch(item.id, patch);
      return;
    }

    if (crsCheck.loading) return;

    const patch: Partial<DrawingDisplayItem> = { mapCrsReady: true };
    if (topCandidate && DRAWING_CRS_OPTIONS.some((o) => o.code === topCandidate) && item.crs !== topCandidate) {
      patch.crs = topCandidate as DrawingCrsCode;
    }
    if (!item.mapCrsReady || patch.crs) onPatch(item.id, patch);
  }, [
    item.id,
    item.features.length,
    item.manualCrs,
    item.mapCrsReady,
    item.crs,
    extent,
    crsCheck.loading,
    topCandidate,
    onPatch,
  ]);

  const enabled = item.visible && item.mapCrsReady && item.features.length > 0;
  const status = useDrawingDisplayLayer(enabled, enabled ? item.features : null, item.crs, EMPTY_HIDDEN, {
    layerKey: `drawing-display-${item.id}`,
    imageKey: `drawing-display-ov-${item.id}`,
    fitView: item.shouldFit,
  });

  useEffect(() => {
    onStatus(item.id, status);
  }, [item.id, status, onStatus]);

  useEffect(() => {
    if (!item.shouldFit) return;
    if (status.mode === 'lod' || status.mode === 'vector') {
      onFitted(item.id);
    }
  }, [item.id, item.shouldFit, status.mode, onFitted]);

  return null;
}

/**
 * 도면 표시 제어 — 서버 저장 목록·파일별 레이어.
 * 패널이 열려 있을 때만 마운트(닫으면 지도에서 제거).
 */
export function DrawingDisplayControl({ width, leftOffsetPx, onWidthChange, onClose }: Props) {
  const [items, setItems] = useState<DrawingDisplayItem[]>([]);
  const [statuses, setStatuses] = useState<Record<string, DrawingLayerStatus>>({});
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const persistMeta = useCallback((item: DrawingDisplayItem) => {
    const prev = persistTimers.current[item.id];
    if (prev) clearTimeout(prev);
    persistTimers.current[item.id] = setTimeout(() => {
      void call('', 'POST', {
        service: 'drawingDisplayService',
        action: 'updateItem',
        params: {
          id: item.id,
          crs: item.crs,
          manualCrs: item.manualCrs,
          visible: item.visible,
        },
      }).catch(() => {
        /* 메타 저장 실패는 지도 표시를 막지 않음 */
      });
    }, 400);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    setError(null);
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'drawingDisplayService',
          action: 'listItems',
          params: {},
        });
        if (cancelled) return;
        if (!res?.success) {
          setError((res as { message?: string })?.message ?? '도면 목록을 불러오지 못했습니다.');
          setItems([]);
          return;
        }
        const data = (res.data ?? res) as { items?: StoredRow[] };
        const rows = Array.isArray(data.items) ? data.items : [];
        const restored: DrawingDisplayItem[] = [];
        for (const row of rows) {
          if (cancelled) return;
          try {
            const text = await fetchDxfText(row.id);
            const item = itemFromDxf(row, text, false);
            if (item) restored.push(item);
          } catch (e) {
            console.warn('[drawingDisplay] restore failed', row.id, e);
          }
        }
        if (!cancelled) setItems(restored);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '도면 목록을 불러오지 못했습니다.');
          setItems([]);
        }
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchItem = useCallback(
    (id: string, patch: Partial<DrawingDisplayItem>, persist = false) => {
      setItems((prev) => {
        const next = prev.map((it) => (it.id === id ? { ...it, ...patch } : it));
        if (persist) {
          const hit = next.find((it) => it.id === id);
          if (hit) persistMeta(hit);
        }
        return next;
      });
    },
    [persistMeta]
  );

  const handleStatus = useCallback((id: string, status: DrawingLayerStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);

  const handleFitted = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id && it.shouldFit ? { ...it, shouldFit: false } : it))
    );
  }, []);

  /** 좌표계 자동 확정 시 서버에도 반영 */
  const patchFromHost = useCallback(
    (id: string, patch: Partial<DrawingDisplayItem>) => {
      const shouldPersist = patch.crs != null || patch.manualCrs != null;
      patchItem(id, patch, shouldPersist);
    },
    [patchItem]
  );

  const handleFiles = useCallback(async (fileList: FileList | File[] | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    const errors: string[] = [];

    for (const file of files) {
      if (seq !== loadSeq.current) return;
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/drawingDisplay/upload', {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        const data = (await res.json().catch(() => ({}))) as {
          item?: StoredRow;
          dxfText?: string;
          error?: string;
        };
        if (seq !== loadSeq.current) return;
        if (!res.ok || !data.item || !data.dxfText) {
          throw new Error(data.error ?? `${file.name}: 업로드에 실패했습니다. (${res.status})`);
        }
        const item = itemFromDxf(data.item, data.dxfText, true);
        if (!item) {
          throw new Error(`${file.name}: DXF에서 도형을 읽지 못했습니다.`);
        }
        setItems((prev) => [...prev, item]);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    if (seq === loadSeq.current) {
      if (errors.length) setError(errors.join('\n'));
      setLoading(false);
    }
  }, []);

  const toggleVisible = useCallback(
    (id: string, visible: boolean) => {
      patchItem(id, { visible }, true);
    },
    [patchItem]
  );

  const removeItem = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await call('', 'POST', {
        service: 'drawingDisplayService',
        action: 'deleteItem',
        params: { id },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제에 실패했습니다.');
    }
  }, []);

  const clearAll = useCallback(async () => {
    loadSeq.current += 1;
    setItems([]);
    setStatuses({});
    setError(null);
    setLoading(false);
    try {
      await call('', 'POST', {
        service: 'drawingDisplayService',
        action: 'clearAll',
        params: {},
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '모두 지우기에 실패했습니다.');
    }
  }, []);

  const setCrs = useCallback(
    (id: string, crs: DrawingCrsCode) => {
      patchItem(id, { crs, manualCrs: true, mapCrsReady: true, shouldFit: true }, true);
    },
    [patchItem]
  );

  const busy = loading || hydrating;

  return (
    <>
      {items.map((item) => (
        <DrawingItemHost
          key={item.id}
          item={item}
          onPatch={patchFromHost}
          onStatus={handleStatus}
          onFitted={handleFitted}
        />
      ))}
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={width}
          minWidth={DRAWING_DISPLAY_PANEL_MIN_WIDTH}
          maxWidth={DRAWING_DISPLAY_PANEL_MAX_WIDTH}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={onWidthChange}
        >
          <DrawingDisplayPanel
            onClose={onClose}
            items={items}
            statuses={statuses}
            loading={busy}
            error={error}
            onFiles={handleFiles}
            onToggleVisible={toggleVisible}
            onRemove={removeItem}
            onClearAll={clearAll}
            onCrsChange={setCrs}
          />
        </MapSideListPanel>
      </div>
    </>
  );
}
