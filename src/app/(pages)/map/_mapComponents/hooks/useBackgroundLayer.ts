import { useEffect } from 'react';
import { Map } from 'ol';
import BaseLayer from 'ol/layer/Base';
import { call } from '@/lib/api';
import { updateViewProjection } from '../services/coordinateService';
import {
  createBackgroundLayerById,
  createLocalOrthoTileLayer,
  getProviderFromId,
  isDynamicOrthoBackgroundId,
  isLocalOrthoBackgroundId,
  ORTHO_TILESET_GROUP_LS_KEY,
  ORTHO_TILESET_OUTPUT_SLUG_LS_KEY,
} from '../layerFactory/backgroundLayerFactory';

function orthoOutputSlugFromLs(tileSetId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(ORTHO_TILESET_OUTPUT_SLUG_LS_KEY);
    if (!raw) return undefined;
    const m = JSON.parse(raw) as Record<string, string>;
    const v = m[tileSetId];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

function mergeOrthoGroupInLs(tileSetId: string, group: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(ORTHO_TILESET_GROUP_LS_KEY);
    const m = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    m[tileSetId] = group;
    window.localStorage.setItem(ORTHO_TILESET_GROUP_LS_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/**
 * 배경지도 레이어 관리 훅
 * 배경지도 변경 시 레이어를 교체하고 좌표계를 조정
 */
export function useBackgroundLayer(
  map: Map | null,
  selectedBackgroundMap: string
) {
  useEffect(() => {
    if (!map) return;

    const layers = map.getLayers();
    const backgroundLayer = layers
      .getArray()
      .find((layer) => layer.get('name') === 'background');

    if (backgroundLayer) {
      map.removeLayer(backgroundLayer);
    }

    let cancelled = false;

    const applyLayer = (layer: BaseLayer | null, provider: ReturnType<typeof getProviderFromId>) => {
      if (cancelled || !layer) return;
      layer.set('name', 'background');
      map.getLayers().insertAt(0, layer);
      if (provider === 'kakao') {
        updateViewProjection(map, 'EPSG:5181');
      } else {
        updateViewProjection(map, 'EPSG:3857');
      }
    };

    const run = async () => {
      const provider = getProviderFromId(selectedBackgroundMap);

      if (isLocalOrthoBackgroundId(selectedBackgroundMap)) {
        // 동적 ID(satellite_YYYY[_표시명])는 곧 디스크 그룹 폴더명. LS/resolve 우회하고 즉시 타일 레이어 생성.
        if (isDynamicOrthoBackgroundId(selectedBackgroundMap)) {
          if (cancelled) return;
          const orthoLayer = createLocalOrthoTileLayer(selectedBackgroundMap, '') as BaseLayer;
          orthoLayer.set('name', 'background');
          map.getLayers().insertAt(0, orthoLayer);
          updateViewProjection(map, 'EPSG:3857');
          return;
        }

        let resolvedGroup: string | undefined;
        try {
          const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ORTHO_TILESET_GROUP_LS_KEY) : null;
          if (raw) {
            const m = JSON.parse(raw) as Record<string, string>;
            if (Object.prototype.hasOwnProperty.call(m, selectedBackgroundMap)) {
              resolvedGroup = m[selectedBackgroundMap];
            }
          }
        } catch {
          resolvedGroup = undefined;
        }

        if (resolvedGroup === undefined) {
          try {
            const res = await call('', 'POST', {
              service: 'orthophotoService',
              action: 'resolveOrthoGroupForTileset',
              params: { tileSetId: selectedBackgroundMap },
            });
            const g = (res?.data as { group?: string | null } | undefined)?.group;
            if (g !== null && g !== undefined) {
              resolvedGroup = g;
              mergeOrthoGroupInLs(selectedBackgroundMap, g);
            }
          } catch {
            /* ignore */
          }
        }

        if (cancelled) return;
        if (resolvedGroup !== undefined) {
          const orthoLayer = createLocalOrthoTileLayer(
            selectedBackgroundMap,
            resolvedGroup,
            orthoOutputSlugFromLs(selectedBackgroundMap)
          ) as BaseLayer;
          applyLayer(orthoLayer, provider);
        }
        return;
      }

      const newLayer = createBackgroundLayerById(selectedBackgroundMap);
      applyLayer(newLayer, provider);
    };

    void run();

    return () => {
      cancelled = true;
      const bg = map.getLayers().getArray().find((layer) => layer.get('name') === 'background');
      if (bg) {
        map.removeLayer(bg);
      }
    };
  }, [map, selectedBackgroundMap]);
}
