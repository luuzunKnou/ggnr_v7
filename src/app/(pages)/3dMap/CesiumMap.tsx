'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  DEFAULT_CENTER_LON,
  DEFAULT_CENTER_LAT,
  DEFAULT_CAMERA_HEIGHT_3D,
  TILESET_CACHE_BYTES,
  TILESET_DYNAMIC_SCREEN_SPACE_ERROR,
  TILESET_FOVEATED_SCREEN_SPACE_ERROR,
  TILESET_HEIGHT_OFFSET_M,
  TILESET_MAX_CACHE_OVERFLOW_BYTES,
  TILESET_MAX_SCREEN_SPACE_ERROR,
  TILESET_POINT_CLOUD_POINT_SIZE,
} from '../map/_mapComponents/config/mapDefaults';
import { getCesium } from './cesiumLoader';
import { useCadastralWmsImagery } from './hooks/useCadastralWmsImagery';
import { useCesiumBasemapImagery } from './hooks/useCesiumBasemapImagery';
import {
  useCesiumTileFeaturePick,
  type TileFeaturePickResult,
} from './hooks/useCesiumTileFeaturePick';

export type { TileFeaturePickResult };

type CesiumViewer = import('cesium').Viewer;
type Cesium3DTileset = import('cesium').Cesium3DTileset;
type CesiumModule = Awaited<ReturnType<typeof getCesium>>;

function applyTilesetVerticalOffset(
  Cesium: CesiumModule,
  tileset: Cesium3DTileset,
  offsetMeters: number
): void {
  if (!Number.isFinite(offsetMeters) || Math.abs(offsetMeters) < 1e-6) {
    tileset.modelMatrix = Cesium.Matrix4.IDENTITY;
    return;
  }
  const bs = tileset.boundingSphere;
  if (!bs?.center) return;
  const { x, y, z } = bs.center;
  const lenSq = x * x + y * y + z * z;
  if (!Number.isFinite(lenSq) || lenSq < 1e-12) return;
  const up = Cesium.Cartesian3.normalize(bs.center, new Cesium.Cartesian3());
  const translation = Cesium.Cartesian3.multiplyByScalar(
    up,
    offsetMeters,
    new Cesium.Cartesian3()
  );
  tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
}

function getTilesetKindFromLayerKey(layerKey: string): Visible3DTilesetEntry['kind'] | null {
  if (layerKey.startsWith('pnts:')) return 'pnts';
  if (layerKey.startsWith('b3dm:')) return 'b3dm';
  return null;
}

function formatPickPropertyValue(val: unknown): string {
  if (val === null || val === undefined) return String(val);
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

/**
 * [위치이동] 타일셋의 위치로 카메라 이동
 */
async function safeZoomToTileset(
  viewer: CesiumViewer,
  tileset: Cesium3DTileset,
  name?: string
): Promise<void> {
  const label = name ?? 'tileset';
  const Cesium = await getCesium();

  // 1. BoundingSphere가 생길 때까지 잠시 대기 (최신 Cesium 대응)
  // tileset.ready가 true여도 boundingSphere가 즉시 계산되지 않을 수 있음
  const getBounds = (): any => tileset.boundingSphere;

  let bs = getBounds();
  let attempts = 0;

  // 최대 2초 동안 boundingSphere가 잡히는지 확인
  while ((!bs || bs.radius <= 0) && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    bs = getBounds();
    attempts++;
  }

  if (!bs || !Number.isFinite(bs.radius) || bs.radius <= 0) {
    try {
      void (viewer as import('cesium').Viewer).zoomTo(tileset);
    } catch {
      console.warn('[CesiumMap] 위치이동 스킵: bounding sphere 유효하지 않음', label);
    }
    return;
  }

  const c = bs.center;
  const lenSq = c.x * c.x + c.y * c.y + c.z * c.z;
  if (!Number.isFinite(lenSq) || lenSq < 1e-20) {
    try {
      void (viewer as import('cesium').Viewer).zoomTo(tileset);
    } catch {
      console.warn('[CesiumMap] 위치이동 스킵: center 값이 유효하지 않음', label);
    }
    return;
  }

  try {
    const carto = Cesium.Cartographic.fromCartesian(bs.center);
    const lonDeg = (carto.longitude * 180) / Math.PI;
    const latDeg = (carto.latitude * 180) / Math.PI;
    console.info('[CesiumMap] 이동할 좌표', {
      name: label,
      ECEF: { x: c.x, y: c.y, z: c.z },
      경위도: { longitude: lonDeg, latitude: latDeg, height: carto.height },
      radius: bs.radius,
    });
  } catch (_) {}

  const range = Math.max(bs.radius * 3.5, 500);
  viewer.camera.cancelFlight();
  try {
    viewer.camera.flyToBoundingSphere(bs, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), range),
    });
  } catch (err) {
    console.warn('[CesiumMap] flyToBoundingSphere 실행 중 오류:', err);
    try {
      void (viewer as import('cesium').Viewer).zoomTo(tileset);
    } catch (e2) {
      console.warn('[CesiumMap] zoomTo fallback 실패:', e2);
    }
  }
}

export type Visible3DTilesetEntry = {
  kind: 'pnts' | 'b3dm';
  name: string;
};

/** Cesium primitives 맵 키 (충돌 방지) */
export function tilesetLayerKey(kind: 'pnts' | 'b3dm', name: string): string {
  return `${kind}:${name}`;
}

export type CesiumMapProps = {
  /** 초기 기본 중심 좌표(WGS84). 미지정 시 하드코드 fallback 사용 */
  defaultCenter?: { lon: number; lat: number; height?: number } | null;
  /** 표시할 3D Tiles — 디스크: 3dtiles_pnts/(이름) 또는 3dtiles_b3dm/(이름) */
  visibleTilesets: Visible3DTilesetEntry[];
  onTilesetLoadError?: (name: string, message: string) => void;
  /** 배경 지도(글로브/이미지) 표시 여부. 기본 true */
  globeVisible?: boolean;
  /** 모든 메시(B3DM)에 일괄 적용할 Z 오프셋(m) */
  meshTilesetZOffsetM?: number;
  /** GeoServer WMS 지적도 오버레이 (2D와 동일 레이어 소스) */
  cadastralWmsEnabled?: boolean;
  /** null 이면 지적도 전 테이블, 아니면 해당 tableName 만 */
  cadastralVisibleTableNames?: readonly string[] | null;
  /** 2D MapContext 배경 id와 맞춤 — 자체항공영상이면 /api/2dtiles XYZ 로 최하단 배경 */
  backgroundMapId?: string;
  /** 최하단 배경 래스터(항공·XYZ 등). 끄면 글로브만 보임. 지적도 WMS 등 상위 레이어는 유지 */
  basemapImageryVisible?: boolean;
  /** dynamic()으로 로드 시 ref가 전달되지 않으므로, 마운트 후 API를 이 콜백으로 전달 */
  onReady?: (api: CesiumMapRef) => void;
  /** b3dm/pnts 피처 클릭 시 배치 속성(변경될 때마다 호출, 닫기 시 null) */
  onTileFeaturePick?: (detail: TileFeaturePickResult | null) => void;
};

export type CesiumMapRef = {
  /** `tilesetLayerKey(kind, name)` 형식, 예: pnts:mydata / b3dm:mydata */
  flyToTileset: (layerKey: string) => void;
};

const CesiumMap = forwardRef<CesiumMapRef, CesiumMapProps>(function CesiumMap(
  {
    defaultCenter = null,
    visibleTilesets,
    onTilesetLoadError,
    globeVisible = true,
    meshTilesetZOffsetM = 0,
    cadastralWmsEnabled = false,
    cadastralVisibleTableNames = null,
    backgroundMapId = 'aerial-2022',
    basemapImageryVisible = true,
    onReady,
    onTileFeaturePick,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const tilesetsRef = useRef<globalThis.Map<string, Cesium3DTileset>>(new Map());
  const visibleRef = useRef<Set<string>>(new Set());
  const globeVisibleRef = useRef(globeVisible);
  const [viewerReady, setViewerReady] = useState(false);

  const apiRef = useRef<CesiumMapRef>({
    flyToTileset(layerKey: string) {
      const v = viewerRef.current;
      const currentMap = tilesetsRef.current;
      const loadedNames = Array.from(currentMap.keys());
      const t = currentMap.get(layerKey);

      console.info('[CesiumMap] 위치이동 버튼 클릭', {
        로드된_타일_목록: loadedNames,
        이동_대상: layerKey,
        viewer_준비: !!v,
        tileset_존재: !!t,
      });

      if (v && t) {
        safeZoomToTileset(v, t, layerKey);
      } else {
        if (!v) console.warn('[CesiumMap] 위치이동 불가: viewer 미준비');
        if (!t) console.warn('[CesiumMap] 위치이동 불가: 타일 미로드', layerKey);
      }
    },
  });

  globeVisibleRef.current = globeVisible;
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.scene.globe.show = globeVisible;
  }, [globeVisible]);

  useImperativeHandle(ref, () => apiRef.current, []);

  useEffect(() => {
    onReady?.(apiRef.current);
  }, [onReady]);

  useCesiumBasemapImagery(viewerRef, viewerReady, backgroundMapId, basemapImageryVisible);

  useCadastralWmsImagery(
    viewerRef.current,
    viewerReady,
    cadastralWmsEnabled,
    cadastralVisibleTableNames
  );

  const { pickResult, clearPick } = useCesiumTileFeaturePick(
    viewerRef,
    viewerReady,
    tilesetsRef
  );

  useEffect(() => {
    onTileFeaturePick?.(pickResult);
  }, [pickResult, onTileFeaturePick]);

  // ========== 맵 초기화 ==========
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    /** viewer 생성 직후 · viewerRef 할당 전에 cleanup 이 들어오는 구간 대비 */
    let createdViewer: CesiumViewer | null = null;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    function destroyViewerInstance(v: CesiumViewer | null | undefined): void {
      if (!v) return;
      try {
        v.destroy();
      } catch {
        /* 이미 destroy 된 인스턴스 등 */
      }
    }

    void (async () => {
      const Cesium = await getCesium();
      if (cancelled) return;

      if (typeof window !== 'undefined' && !(window as any).CESIUM_BASE_URL) {
        (window as any).CESIUM_BASE_URL = '/cesiumStatic';
      }

      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      if (ionToken) {
        Cesium.Ion.defaultAccessToken = ionToken;
      }

      const terrainProvider = await Cesium.createWorldTerrainAsync();
      if (cancelled) return;

      const viewer = new Cesium.Viewer(container, {
        terrainProvider,
        animation: false,
        timeline: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        baseLayerPicker: false,
        // skyBox 객체가 있으면 backgroundColor가 무시됨(show만 끄는 것으로는 부족). 문서: skyBox false 시 별·태양·달 미추가
        skyBox: false,
        skyAtmosphere: false,
      });
      createdViewer = viewer;

      if (cancelled) {
        destroyViewerInstance(viewer);
        createdViewer = null;
        return;
      }

      viewerRef.current = viewer;
      const scene = viewer.scene;
      viewer.scene.globe.show = globeVisibleRef.current;
      // 지형/수면(저수지 등)에 가려지지 않도록 끔 → 포인트 클라우드가 지형 아래 있어도 보임
      viewer.scene.globe.depthTestAgainstTerrain = false;

      // 우주/대기: Viewer 옵션으로 skyBox·skyAtmosphere 미생성 → scene.backgroundColor 가 실제로 보임
      scene.backgroundColor = Cesium.Color.BLACK;
      // 타일 사이·해저 등 이미지 없을 때 기본 타일 색이 파란 바다 톤으로 보이는 것 완화
      scene.globe.baseColor = Cesium.Color.BLACK;
      if (scene.skyBox) scene.skyBox.show = false;
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
      if (scene.sun) scene.sun.show = false;
      if (scene.moon) scene.moon.show = false;
      if (scene.fog) scene.fog.enabled = false;
      scene.globe.showGroundAtmosphere = false;
      scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.NONE;
      scene.atmosphere.brightnessShift = -1.0;
      if (scene.highDynamicRangeSupported) {
        scene.highDynamicRange = false;
      }

      // 포인트 클라우드 최적화
      const pcs = (viewer.scene as any).pointCloudShading;
      if (pcs) {
        pcs.maximumAttenuation = 64;
        pcs.eyeDomeLighting = true;
      }

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          defaultCenter?.lon ?? DEFAULT_CENTER_LON,
          defaultCenter?.lat ?? DEFAULT_CENTER_LAT,
          defaultCenter?.height ?? DEFAULT_CAMERA_HEIGHT_3D
        ),
      });

      if (cancelled) {
        destroyViewerInstance(viewer);
        if (viewerRef.current === viewer) {
          viewerRef.current = null;
        }
        createdViewer = null;
        return;
      }

      setViewerReady(true);
    })();

    return () => {
      cancelled = true;
      setViewerReady(false);
      const toDestroy = viewerRef.current ?? createdViewer;
      destroyViewerInstance(toDestroy);
      viewerRef.current = null;
      createdViewer = null;

      const el = containerRef.current;
      if (el) {
        while (el.firstChild) {
          el.removeChild(el.firstChild);
        }
      }

      tilesetsRef.current.clear();
    };
  }, [defaultCenter]);

  // ========== 레이어 표시/숨김 및 추가 ==========
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;

    const viewer = viewerRef.current;
    const primitives = viewer.scene.primitives;
    const currentMap = tilesetsRef.current;
    const nextVisibleKeys = new Set(
      visibleTilesets.map((e) => tilesetLayerKey(e.kind, e.name))
    );

    viewer.scene.globe.depthTestAgainstTerrain = visibleTilesets.some((entry) => entry.kind === 'b3dm');

    void getCesium().then((Cesium) => {
      for (const [layerKey, tileset] of currentMap) {
        if (getTilesetKindFromLayerKey(layerKey) === 'b3dm') {
          applyTilesetVerticalOffset(Cesium, tileset, meshTilesetZOffsetM);
        }
      }
    });

    // 1. 이미 로드된 타일셋은 show만 토글 (remove/destroy 없이 → 에러 방지, 끄면 화면에서 숨김)
    for (const [layerKey, tileset] of currentMap) {
      const show = nextVisibleKeys.has(layerKey);
      tileset.show = show;
    }
    console.info('[CesiumMap] 타일 표시/숨김', {
      표시할_목록: Array.from(nextVisibleKeys),
      현재_로드된_목록: Array.from(currentMap.keys()),
    });
    visibleRef.current = nextVisibleKeys;

    // 2. 아직 로드 안 된 항목만 추가
    visibleTilesets.forEach(async ({ kind, name }) => {
      const layerKey = tilesetLayerKey(kind, name);
      if (currentMap.has(layerKey)) return;

      const url =
        kind === 'pnts'
          ? `/api/3dtiles/${encodeURIComponent(name)}/tileset.json`
          : `/api/3dtiles_b3dm/${encodeURIComponent(name)}/tileset.json`;

      try {
        const Cesium = await getCesium();
        const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
          maximumScreenSpaceError: TILESET_MAX_SCREEN_SPACE_ERROR,
          dynamicScreenSpaceError: TILESET_DYNAMIC_SCREEN_SPACE_ERROR,
          foveatedScreenSpaceError: TILESET_FOVEATED_SCREEN_SPACE_ERROR,
          cacheBytes: TILESET_CACHE_BYTES,
          maximumCacheOverflowBytes: TILESET_MAX_CACHE_OVERFLOW_BYTES,
        });

        if (kind === 'pnts') {
          tileset.style = new Cesium.Cesium3DTileStyle({
            pointSize: TILESET_POINT_CLOUD_POINT_SIZE,
          });
        }

        if (!viewerRef.current || !visibleRef.current.has(layerKey)) return;

        primitives.add(tileset);
        currentMap.set(layerKey, tileset);

        console.info('[CesiumMap] 타일 로드 완료', {
          layerKey,
          kind,
          name,
          url,
          로드된_타일_목록: Array.from(currentMap.keys()),
        });

        if (kind === 'b3dm') {
          const rp = (tileset as { readyPromise?: Promise<Cesium3DTileset> }).readyPromise;
          if (rp) {
            rp.then(() => {
              applyTilesetVerticalOffset(Cesium, tileset, meshTilesetZOffsetM);
            }).catch(() => {});
          } else {
            applyTilesetVerticalOffset(Cesium, tileset, meshTilesetZOffsetM);
          }
        }

        // 포인트 클라우드만 필요 시 지형 위로 조금 올려서 가시성을 확보한다.
        if (kind === 'pnts' && TILESET_HEIGHT_OFFSET_M !== 0) {
          const rp = (tileset as { readyPromise?: Promise<Cesium3DTileset> }).readyPromise;
          if (rp) {
            rp.then(() => {
              const bs = tileset.boundingSphere;
              if (bs?.center) {
                applyTilesetVerticalOffset(Cesium, tileset, TILESET_HEIGHT_OFFSET_M);
                try {
                  const carto = Cesium.Cartographic.fromCartesian(bs.center);
                  const lonDeg = (carto.longitude * 180) / Math.PI;
                  const latDeg = (carto.latitude * 180) / Math.PI;
                  console.info('[CesiumMap] 타일 boundingSphere (로드 검증)', {
                    layerKey,
                    ECEF: { x: bs.center.x, y: bs.center.y, z: bs.center.z },
                    경위도: { longitude: lonDeg, latitude: latDeg, height: carto.height },
                    radius: bs.radius,
                  });
                } catch (_) {}
              }
            }).catch(() => {});
          }
        }

        await safeZoomToTileset(viewer, tileset, layerKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CesiumMap] ${layerKey} 로드 실패:`, msg);
        onTilesetLoadError?.(layerKey, msg);
      }
    });
  }, [viewerReady, visibleTilesets, meshTilesetZOffsetM, onTilesetLoadError]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {pickResult && (
        <div
          className="pointer-events-auto absolute bottom-4 right-4 z-[70] max-h-[min(50vh,22rem)] w-[min(22rem,calc(100vw-5rem))] overflow-hidden rounded-md border border-border bg-background/95 text-sm shadow-lg"
          role="dialog"
          aria-label="선택한 3D 객체 속성"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="font-medium truncate">
              3D 객체{' '}
              {pickResult.kind === 'b3dm'
                ? '(메시)'
                : pickResult.kind === 'pnts'
                  ? '(포인트)'
                  : ''}
            </span>
            <button
              type="button"
              onClick={() => clearPick()}
              className="shrink-0 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              닫기
            </button>
          </div>
          <div className="max-h-[min(46vh,18rem)] overflow-y-auto px-3 py-2 space-y-2 text-xs">
            {pickResult.datasetName && (
              <p className="text-muted-foreground">
                데이터셋:{' '}
                <span className="font-mono text-foreground">{pickResult.datasetName}</span>
              </p>
            )}
            <p className="text-muted-foreground">
              featureId / batch:{' '}
              <span className="font-mono text-foreground">{pickResult.featureId}</span>
            </p>
            {Object.keys(pickResult.properties).length === 0 ? (
              <p className="text-muted-foreground">
                배치 테이블·메타데이터 속성이 없습니다. (단순 메시 타일일 수 있음)
              </p>
            ) : (
              <dl className="space-y-1.5">
                {Object.entries(pickResult.properties).map(([key, val]) => (
                  <div key={key}>
                    <dt className="font-mono text-[11px] text-muted-foreground">{key}</dt>
                    <dd className="break-all font-mono text-[11px] text-foreground">
                      {formatPickPropertyValue(val)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
            다른 객체를 클릭하면 선택이 바뀝니다. 하늘·빈 화면 클릭 시 선택이 해제됩니다.
          </p>
        </div>
      )}
    </div>
  );
});

export default CesiumMap;
