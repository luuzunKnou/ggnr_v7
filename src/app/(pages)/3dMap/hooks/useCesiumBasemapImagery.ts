'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import { call } from '@/lib/api';
import { getCesium } from '../cesiumLoader';
import {
  buildLocalOrthoXyzUrlTemplate,
  getCesiumRasterBasemapSpecForId,
  isDynamicOrthoBackgroundId,
  isLocalOrthoBackgroundId,
  ORTHO_TILESET_GROUP_LS_KEY,
  ORTHO_TILESET_OUTPUT_SLUG_LS_KEY,
  VWORLD_MAX_ZOOM_INDEX,
} from '../../map/_mapComponents/layerFactory/backgroundLayerFactory';

type CesiumViewer = import('cesium').Viewer;

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
    /* noop */
  }
}

async function resolveOrthoGroupForTileset(tileSetId: string): Promise<string | undefined> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ORTHO_TILESET_GROUP_LS_KEY) : null;
    if (raw) {
      const m = JSON.parse(raw) as Record<string, string>;
      if (Object.prototype.hasOwnProperty.call(m, tileSetId)) {
        return m[tileSetId];
      }
    }
  } catch {
    /* noop */
  }
  try {
    const res = await call('', 'POST', {
      service: 'orthophotoService',
      action: 'resolveOrthoGroupForTileset',
      params: { tileSetId },
    });
    const g = (res?.data as { group?: string | null } | undefined)?.group;
    if (g !== null && g !== undefined && String(g).trim()) {
      const gs = String(g).trim();
      mergeOrthoGroupInLs(tileSetId, gs);
      return gs;
    }
  } catch {
    /* noop */
  }
  return undefined;
}

function replaceBottomImageryLayer(
  viewer: CesiumViewer,
  Cesium: typeof import('cesium'),
  newBottom: InstanceType<typeof Cesium.ImageryLayer>
): void {
  if (viewer.imageryLayers.length > 0) {
    viewer.imageryLayers.remove(viewer.imageryLayers.get(0), true);
  }
  viewer.imageryLayers.add(newBottom, 0);
}

/** 최하단 래스터만 제거 (배경없음). 지적도 등 상위 인덱스 레이어는 유지 */
function removeBottomBasemapLayer(viewer: CesiumViewer): void {
  if (viewer.imageryLayers.length > 0) {
    viewer.imageryLayers.remove(viewer.imageryLayers.get(0), true);
  }
}

function applyBottomBasemapShow(viewer: CesiumViewer, show: boolean): void {
  if (viewer.imageryLayers.length === 0) return;
  try {
    viewer.imageryLayers.get(0).show = show;
  } catch {
    /* noop */
  }
}

/**
 * 2D 배경 id와 동일하게 Cesium 최하단 배경을 맞춤.
 * - 자체 정사: `/api/2dtiles/...` UrlTemplate
 * - VWorld / Google / OSM·Esri·OpenTopo: WebMercator XYZ (2D와 동일 URL 규칙)
 * - 배경없음: 하단 래스터만 제거
 * - 카카오(EPSG:5181): Cesium 기본망과 달라 Ion 세계영상으로 폴백
 * - 그 외: Ion 세계영상
 */
export function useCesiumBasemapImagery(
  viewerRef: MutableRefObject<CesiumViewer | null>,
  viewerReady: boolean,
  backgroundMapId: string,
  basemapImageryVisible = true
): void {
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;

    const id = ++runIdRef.current;
    let alive = true;

    void (async () => {
      const Cesium = await getCesium();
      if (!alive || id !== runIdRef.current) return;

      const viewer = viewerRef.current;
      if (!viewer) return;

      if (backgroundMapId === 'no-background') {
        removeBottomBasemapLayer(viewer);
        return;
      }

      if (isLocalOrthoBackgroundId(backgroundMapId)) {
        let templateRel: string | undefined;
        if (isDynamicOrthoBackgroundId(backgroundMapId)) {
          templateRel = buildLocalOrthoXyzUrlTemplate(backgroundMapId, '');
        } else {
          const group = await resolveOrthoGroupForTileset(backgroundMapId);
          if (!alive || id !== runIdRef.current) return;
          const v = viewerRef.current;
          if (!v) return;
          if (group !== undefined) {
            templateRel = buildLocalOrthoXyzUrlTemplate(
              backgroundMapId,
              group,
              orthoOutputSlugFromLs(backgroundMapId)
            );
          }
        }

        if (!templateRel || !alive || id !== runIdRef.current) {
          const v = viewerRef.current;
          if (!v) return;
          const world = Cesium.ImageryLayer.fromWorldImagery({});
          replaceBottomImageryLayer(v, Cesium, world);
          applyBottomBasemapShow(v, basemapImageryVisible);
          return;
        }

        const absUrl =
          typeof window !== 'undefined'
            ? new URL(templateRel, window.location.origin).href
            : templateRel;

        const vOrtho = viewerRef.current;
        if (!vOrtho || !alive || id !== runIdRef.current) return;

        const provider = new Cesium.UrlTemplateImageryProvider({
          url: absUrl,
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
          tileWidth: 512,
          tileHeight: 512,
          maximumLevel: VWORLD_MAX_ZOOM_INDEX,
          enablePickFeatures: false,
        });

        const layer = new Cesium.ImageryLayer(provider, {
          alpha: 1,
          show: basemapImageryVisible,
        });
        replaceBottomImageryLayer(vOrtho, Cesium, layer);
        applyBottomBasemapShow(vOrtho, basemapImageryVisible);
        return;
      }

      const spec = getCesiumRasterBasemapSpecForId(backgroundMapId);
      if (spec?.kind === 'xyzTemplate') {
        const v = viewerRef.current;
        if (!v || !alive || id !== runIdRef.current) return;

        const provider = new Cesium.UrlTemplateImageryProvider({
          url: spec.url,
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
          tileWidth: spec.tileWidth,
          tileHeight: spec.tileHeight,
          maximumLevel: spec.maximumLevel,
          enablePickFeatures: false,
          ...(spec.credit ? { credit: spec.credit } : {}),
          ...(spec.subdomains !== undefined ? { subdomains: spec.subdomains } : {}),
        });

        const layer = new Cesium.ImageryLayer(provider, {
          alpha: 1,
          show: basemapImageryVisible,
        });
        replaceBottomImageryLayer(v, Cesium, layer);
        applyBottomBasemapShow(v, basemapImageryVisible);
        return;
      }

      const vFall = viewerRef.current;
      if (!vFall || !alive || id !== runIdRef.current) return;
      const world = Cesium.ImageryLayer.fromWorldImagery({});
      replaceBottomImageryLayer(vFall, Cesium, world);
      applyBottomBasemapShow(vFall, basemapImageryVisible);
    })();

    return () => {
      alive = false;
    };
  }, [viewerRef, viewerReady, backgroundMapId, basemapImageryVisible]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !viewerReady) return;
    applyBottomBasemapShow(v, basemapImageryVisible);
  }, [viewerRef, viewerReady, basemapImageryVisible, backgroundMapId]);
}
