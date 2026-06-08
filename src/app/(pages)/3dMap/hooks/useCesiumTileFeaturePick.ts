'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { getCesium } from '../cesiumLoader';

export type TileFeaturePickResult = {
  layerKey: string | null;
  datasetName: string | null;
  kind: 'pnts' | 'b3dm' | null;
  /** 3D Tiles 1.0 배치 ID / glTF feature id */
  featureId: number;
  properties: Record<string, unknown>;
};

/** 번들이 Cesium을 두 벌 넣으면 instanceof 가 실패하므로 프로퍼티로 판별 */
type TileFeatureLike = {
  tileset: import('cesium').Cesium3DTileset;
  featureId: number;
  getPropertyIds: () => string[];
  getProperty: (name: string) => unknown;
  color: import('cesium').Color;
};

function isTileFeatureLike(obj: unknown): obj is TileFeatureLike {
  if (obj == null || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.getPropertyIds === 'function' &&
    'tileset' in o &&
    typeof (o as TileFeatureLike).featureId === 'number' &&
    typeof (o as TileFeatureLike).getProperty === 'function' &&
    'color' in o
  );
}

function parseLayerKey(layerKey: string | null): {
  kind: 'pnts' | 'b3dm' | null;
  name: string | null;
} {
  if (!layerKey) return { kind: null, name: null };
  const idx = layerKey.indexOf(':');
  if (idx <= 0) return { kind: null, name: layerKey };
  const rawKind = layerKey.slice(0, idx);
  const kind = rawKind === 'pnts' || rawKind === 'b3dm' ? rawKind : null;
  return { kind, name: layerKey.slice(idx + 1) };
}

function findTileFeatureFromDrill(
  drills: { object?: unknown }[],
  pickSingle: unknown
): TileFeatureLike | undefined {
  for (let i = 0; i < drills.length; i++) {
    const o = drills[i]?.object;
    if (isTileFeatureLike(o)) return o;
  }
  if (isTileFeatureLike(pickSingle)) return pickSingle;
  return undefined;
}

/**
 * 3D Tiles(b3dm·pnts) 피처 클릭 선택.
 * Viewer 의 screenSpaceEventHandler 에만 등록 (별도 ScreenSpaceEventHandler 생성 시 충돌 가능).
 */
export function useCesiumTileFeaturePick(
  viewerRef: MutableRefObject<import('cesium').Viewer | null>,
  viewerReady: boolean,
  tilesetsRef: MutableRefObject<globalThis.Map<string, import('cesium').Cesium3DTileset>>
): {
  pickResult: TileFeaturePickResult | null;
  clearPick: () => void;
} {
  const [pickResult, setPickResult] = useState<TileFeaturePickResult | null>(null);
  const lastFeatureRef = useRef<TileFeatureLike | null>(null);

  const clearPick = useCallback(() => {
    const f = lastFeatureRef.current;
    lastFeatureRef.current = null;
    if (f) {
      void getCesium().then((Cesium) => {
        try {
          f.color = Cesium.Color.WHITE;
        } catch {
          /* 타일 언로드 등 */
        }
      });
    }
    setPickResult(null);
  }, []);

  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;

    let alive = true;
    /** 클릭 체인 + 언마운트 시 복원용 */
    type ClickCb = import('cesium').ScreenSpaceEventHandler.PositionedEventCallback;
    const restoreLeftClickRef: { prev: ClickCb | undefined } = { prev: undefined };

    void getCesium().then((Cesium) => {
      const viewer = viewerRef.current;
      if (!alive || !viewer || viewer.isDestroyed?.()) return;

      const ssh = viewer.screenSpaceEventHandler;
      restoreLeftClickRef.prev = ssh.getInputAction(
        Cesium.ScreenSpaceEventType.LEFT_CLICK
      ) as ClickCb | undefined;

      const onLeftClick = (click: import('cesium').ScreenSpaceEventHandler.PositionedEvent) => {
        const v = viewerRef.current;
        if (!v || v.isDestroyed?.()) return;

        if (lastFeatureRef.current) {
          try {
            lastFeatureRef.current.color = Cesium.Color.WHITE;
          } catch {
            /* noop */
          }
          lastFeatureRef.current = null;
        }

        const drills = v.scene.drillPick(click.position, 25);
        const single = v.scene.pick(click.position);
        const tileFeature = findTileFeatureFromDrill(drills, single);

        if (!tileFeature) {
          setPickResult(null);
          restoreLeftClickRef.prev?.(click);
          return;
        }

        const ts = tileFeature.tileset;
        let layerKey: string | null = null;
        for (const [k, t] of tilesetsRef.current) {
          if (t === ts) {
            layerKey = k;
            break;
          }
        }

        const { kind, name: datasetName } = parseLayerKey(layerKey);

        const props: Record<string, unknown> = {};
        try {
          const ids = tileFeature.getPropertyIds();
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            props[id] = tileFeature.getProperty(id);
          }
        } catch {
          /* 배치·메타 없음 */
        }

        try {
          tileFeature.color = Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.9);
        } catch {
          /* noop */
        }
        lastFeatureRef.current = tileFeature;

        setPickResult({
          layerKey,
          datasetName,
          kind,
          featureId: tileFeature.featureId,
          properties: props,
        });

        restoreLeftClickRef.prev?.(click);
      };

      ssh.setInputAction(onLeftClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    });

    return () => {
      alive = false;
      const f = lastFeatureRef.current;
      lastFeatureRef.current = null;
      if (f) {
        void getCesium().then((Cesium) => {
          try {
            f.color = Cesium.Color.WHITE;
          } catch {
            /* noop */
          }
        });
      }

      const prev = restoreLeftClickRef.prev;
      void getCesium().then((Cesium) => {
        const v = viewerRef.current;
        if (!v || v.isDestroyed?.()) return;
        try {
          const ssh = v.screenSpaceEventHandler;
          if (prev) {
            ssh.setInputAction(prev, Cesium.ScreenSpaceEventType.LEFT_CLICK);
          }
        } catch {
          /* noop */
        }
      });
    };
  }, [viewerReady, viewerRef, tilesetsRef]);

  return { pickResult, clearPick };
}
