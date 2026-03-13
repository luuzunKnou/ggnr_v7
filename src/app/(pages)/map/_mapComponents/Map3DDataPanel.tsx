'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { call } from '@/lib/api';
import { useMapContext } from './MapContext';
import { RefreshCw, Box, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type Map from 'ol/Map';
import GeoTIFF from 'ol/source/GeoTIFF';
import WebGLTileLayer from 'ol/layer/WebGLTile';
import { transformExtent } from 'ol/proj';

type TifItem = { folder: string; name: string };
const LAYER_KEY = 'geotiffLayer';

export default function Map3DDataPanel({ onClose }: { onClose: () => void }) {
  const mapContext = useMapContext();
  const [items, setItems] = useState<TifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const layersRef = useRef<Map<string, WebGLTileLayer<GeoTIFF>>>(new Map());

  const itemKey = (item: TifItem) => `${item.folder}/${item.name}`;

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'listDirectory',
        params: { relativePath: 'service_data/3dtiles_tiff' },
      });
      const data = res?.data ?? res;
      const dirs = Array.isArray(data?.directories) ? data.directories : [];
      const all: TifItem[] = [];
      await Promise.all(
        dirs.map(async (folder: string) => {
          const r = await call('', 'POST', {
            service: 'fileManagerService',
            action: 'listDirectory',
            params: { relativePath: `service_data/3dtiles_tiff/${folder}` },
          }).catch(() => ({ data: { files: [] } }));
          const files = (r?.data ?? r)?.files ?? [];
          files.forEach((f: { name: string }) => {
            const lower = f.name.toLowerCase();
            if (lower.endsWith('.tif') || lower.endsWith('.tiff')) all.push({ folder, name: f.name });
          });
        })
      );
      all.sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
      setItems(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const addLayer = useCallback((map: Map, key: string) => {
    if (layersRef.current.has(key)) return;
    const [folder, ...rest] = key.split('/');
    const fileName = rest.join('/');
    const url = `/api/3dtiles_tiff/${encodeURIComponent(folder)}/${encodeURIComponent(fileName)}`;
    const view = map.getView();
    // 좌표계를 모를 때는 임시로 EPSG:5187(중부원점 GRS80)으로 읽음. nodata: 0 → 알파 밴드 생성 후 배경 투명화.
    const source = new GeoTIFF({
      sources: [{ url, nodata: 0 }],
      projection: 'EPSG:5187',
      convertToRGB: 'auto',
      sourceOptions: { allowFullFile: true },
    });
    const layer = new WebGLTileLayer({
      source,
      style: {
        variables: {
          min: 0,
          max: 255,
        },
        color: [
          'array',
          ['band', 1],
          ['band', 2],
          ['band', 3],
          ['band', 4],
        ],
      },
    });
    layer.set(LAYER_KEY, true);
    map.addLayer(layer);
    layersRef.current.set(key, layer);

    const layers = map.getLayers().getArray();
    const layerInMap = layers.includes(layer);
    const layerIndex = layers.indexOf(layer);
    const layersWithIndex = layers.map((l, idx) => ({
      index: idx,
      isGeotiff: l.get(LAYER_KEY) === true,
    }));
    console.log('[Map3DDataPanel] layer push 직후', {
      key,
      layerInMap,
      layerIndex,
      layersLength: layers.length,
      visible: layer.getVisible(),
      layersWithIndex,
    });

    const tryFitToExtent = () => {
      if (source.getState() !== 'ready') return;
      const srcProj = source.getProjection();
      const viewProj = view.getProjection();
      console.log('[Map3DDataPanel] TIF 로드 후 좌표계', {
        현재지도좌표계: viewProj?.getCode?.() ?? viewProj,
        tif파일좌표계: srcProj?.getCode?.() ?? srcProj,
      });
      const tileGrid = source.getTileGrid?.();
      if (!tileGrid?.getExtent || !srcProj || !viewProj) {
        console.log('[Map3DDataPanel] 좌표이동 스킵 (조건 불충족)', {
          hasTileGrid: !!tileGrid,
          hasGetExtent: !!tileGrid?.getExtent,
          hasSrcProj: !!srcProj,
          hasViewProj: !!viewProj,
        });
        return;
      }
      let ext = tileGrid.getExtent();
      if (!ext || ext.length < 4 || !ext.every(Number.isFinite)) {
        console.log('[Map3DDataPanel] 좌표이동 스킵 (extent 없음)', { ext });
        return;
      }
      try {
        const extView = transformExtent(ext, srcProj, viewProj);
        console.log('[Map3DDataPanel] 좌표이동 대상', {
          소스좌표계_extent: ext,
          뷰좌표계_extent: extView,
          유효: extView.every(Number.isFinite),
        });
        if (extView.every(Number.isFinite)) {
          view.fit(extView, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 500 });
        }
      } catch (e) {
        console.log('[Map3DDataPanel] 좌표이동 실패 (transform/fit 에러)', e);
      }
    };

    const onSourceChange = () => {
      tryFitToExtent();
      if (source.getState() === 'ready' || source.getState() === 'error') {
        source.un('change', onSourceChange);
      }
    };
    source.on('change', onSourceChange);
    tryFitToExtent();
  }, []);

  const removeLayer = useCallback((map: Map, key: string) => {
    const layer = layersRef.current.get(key);
    if (layer) {
      map.removeLayer(layer);
      layersRef.current.delete(key);
    }
  }, []);

  const toggleVisible = useCallback(
    (key: string) => {
      const map = mapContext?.mapInstanceRef?.current;
      setVisible((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
          if (map) removeLayer(map, key);
        } else {
          next.add(key);
          if (map) addLayer(map, key);
        }
        return next;
      });
    },
    [mapContext?.mapInstanceRef, addLayer, removeLayer]
  );

  useEffect(() => {
    return () => {
      const map = mapContext?.mapInstanceRef?.current;
      if (map) {
        layersRef.current.forEach((layer) => map.getLayers().remove(layer));
        layersRef.current.clear();
      }
    };
  }, [mapContext?.mapInstanceRef]);

  const handleClose = () => {
    const map = mapContext?.mapInstanceRef?.current;
    if (map) {
      layersRef.current.forEach((layer) => map.getLayers().remove(layer));
      layersRef.current.clear();
    }
    setVisible(new Set());
    onClose();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden opacity-[0.95]">
      <div className="border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary/5 shrink-0">
              <Box className="h-[18px] w-[18px] text-primary/80" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">3D 데이터</h1>
              <p className="text-xs text-muted-foreground">
                {items.length > 0 ? `GeoTIFF ${items.length}개` : '목록 없음'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={fetchList}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              title="새로고침"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
              title="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">목록 불러오는 중…</div>
        ) : error ? (
          <div className="px-4 py-6 text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">GeoTIFF 파일이 없습니다.</div>
        ) : (
          <div className="py-2">
            {items.map((item) => {
              const key = itemKey(item);
              const isChecked = visible.has(key);
              return (
                <label
                  key={key}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors hover:bg-slate-50',
                    isChecked && 'bg-primary/5'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleVisible(key)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm truncate flex-1 min-w-0" title={key}>
                    {item.folder}/{item.name}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
