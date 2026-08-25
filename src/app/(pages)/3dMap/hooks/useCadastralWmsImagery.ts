'use client';

import { useEffect, useRef } from 'react';
import { getCesium } from '../cesiumLoader';
import { CADASTRAL_LAYERS } from '../../map/_mapComponents/layerFactory/boundaryLayerFactory';
import { WORKSPACE } from '../../map/_mapComponents/layerFactory/serviceLayerFactory';
import { getGeoServerBase } from '@/lib/geoserverUrl';

type CesiumViewer = import('cesium').Viewer;
type ImageryLayer = import('cesium').ImageryLayer;

/** Ion/배경 이미지가 비동기로 올라오며 순서가 밀릴 수 있어 여러 번 맨 위로 올림 */
const RAISE_AGAIN_DELAYS_MS = [0, 200, 800, 2000] as const;

/**
 * 2D 지적도와 동일 GeoServer WMS(jijuk, ri, emd)를 Cesium 글로브에 이미지 레이어로 올림.
 * - groupOn: activeControls 에 cadastral 포함 여부
 * - visibleTableNames: null 이면 전부, 배열이면 해당 tableName 만 (2D visibleCadastralLayerNames 와 동일 규칙)
 */
export function useCadastralWmsImagery(
  viewer: CesiumViewer | null,
  viewerReady: boolean,
  groupOn: boolean,
  visibleTableNames: readonly string[] | null
): void {
  const layersRef = useRef<ImageryLayer[]>([]);
  const raiseTimeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    raiseTimeoutsRef.current.forEach((id) => clearTimeout(id));
    raiseTimeoutsRef.current = [];

    const viewerInst = viewer;
    if (!viewerReady || !viewerInst) return;

    const clearLayers = () => {
      layersRef.current.forEach((ly) => {
        try {
          viewerInst.imageryLayers.remove(ly, true);
        } catch {
          /* noop */
        }
      });
      layersRef.current = [];
    };

    let alive = true;
    clearLayers();

    if (!groupOn) {
      return () => {
        alive = false;
        clearLayers();
      };
    }

    const raiseCadastralToTop = () => {
      for (const ly of layersRef.current) {
        try {
          if (viewerInst.imageryLayers.contains(ly)) {
            viewerInst.imageryLayers.raiseToTop(ly);
          }
        } catch {
          /* noop */
        }
      }
    };

    void (async () => {
      const Cesium = await getCesium();
      if (!alive || !viewerInst) return;

      const base = getGeoServerBase();
      const wmsUrl = `${base}/${WORKSPACE}/wms`;
      const showAll = visibleTableNames == null;

      for (const { tableName } of CADASTRAL_LAYERS) {
        if (!alive) return;
        const allowed =
          showAll || (visibleTableNames != null && visibleTableNames.includes(tableName));
        if (!allowed) continue;

        try {
          // 기본은 Geographic(4326) + SRS=EPSG:4326 — GeoServer/OL은 Web Mercator(3857)로 맞추는 경우가 많음.
          // WebMercatorTilingScheme을 주면 WMS 1.1.1 에 SRS=EPSG:3857 및 bbox가 2D 맵과 동일 규칙으로 맞춰짐.
          const tilingScheme = new Cesium.WebMercatorTilingScheme();
          const provider = new Cesium.WebMapServiceImageryProvider({
            url: wmsUrl,
            layers: `${WORKSPACE}:${tableName}`,
            parameters: {
              transparent: 'true',
              format: 'image/png',
              styles: tableName,
            },
            tilingScheme,
            enablePickFeatures: false,
          });
          const layer = new Cesium.ImageryLayer(provider, {
            alpha: 1,
            show: true,
          });
          viewerInst.imageryLayers.add(layer);
          layer.alpha = 1;
          layersRef.current.push(layer);
        } catch (e) {
          console.warn('[useCadastralWmsImagery] 레이어 추가 실패:', tableName, e);
        }
      }

      raiseCadastralToTop();
      requestAnimationFrame(raiseCadastralToTop);

      for (const ms of RAISE_AGAIN_DELAYS_MS) {
        const id = window.setTimeout(() => {
          if (alive) raiseCadastralToTop();
        }, ms);
        raiseTimeoutsRef.current.push(id);
      }
    })();

    return () => {
      alive = false;
      raiseTimeoutsRef.current.forEach((id) => clearTimeout(id));
      raiseTimeoutsRef.current = [];
      clearLayers();
    };
  }, [viewer, viewerReady, groupOn, visibleTableNames]);
}
