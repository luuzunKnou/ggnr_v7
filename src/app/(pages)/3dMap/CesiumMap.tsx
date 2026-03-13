'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { DEFAULT_CENTER_LON, DEFAULT_CENTER_LAT, DEFAULT_CAMERA_HEIGHT_3D, TILESET_HEIGHT_OFFSET_M } from '../map/_mapComponents/config/mapDefaults';
import { getCesium } from './cesiumLoader';

type CesiumViewer = import('cesium').Viewer;
type Cesium3DTileset = import('cesium').Cesium3DTileset;

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

export type CesiumMapProps = {
  visibleTilesetNames: string[];
  onTilesetLoadError?: (name: string, message: string) => void;
  /** 배경 지도(글로브/이미지) 표시 여부. 기본 true */
  globeVisible?: boolean;
  /** dynamic()으로 로드 시 ref가 전달되지 않으므로, 마운트 후 API를 이 콜백으로 전달 */
  onReady?: (api: CesiumMapRef) => void;
};

export type CesiumMapRef = {
  flyToTileset: (name: string) => void;
};

const CesiumMap = forwardRef<CesiumMapRef, CesiumMapProps>(function CesiumMap(
  { visibleTilesetNames, onTilesetLoadError, globeVisible = true, onReady },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const tilesetsRef = useRef<Map<string, Cesium3DTileset>>(new Map());
  const visibleRef = useRef<Set<string>>(new Set());
  const globeVisibleRef = useRef(globeVisible);
  const [viewerReady, setViewerReady] = useState(false);

  const apiRef = useRef<CesiumMapRef>({
    flyToTileset(name: string) {
      const v = viewerRef.current;
      const currentMap = tilesetsRef.current;
      const loadedNames = Array.from(currentMap.keys());
      const t = currentMap.get(name);

      console.info('[CesiumMap] 위치이동 버튼 클릭', {
        로드된_타일_목록: loadedNames,
        이동_대상: name,
        viewer_준비: !!v,
        tileset_존재: !!t,
      });

      if (v && t) {
        safeZoomToTileset(v, t, name);
      } else {
        if (!v) console.warn('[CesiumMap] 위치이동 불가: viewer 미준비');
        if (!t) console.warn('[CesiumMap] 위치이동 불가: 타일 미로드', name);
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

  // ========== 맵 초기화 ==========
  useEffect(() => {
    if (!containerRef.current) return;
    let viewer: CesiumViewer;

    (async () => {
      const Cesium = await getCesium();
      if (typeof window !== 'undefined' && !(window as any).CESIUM_BASE_URL) {
        (window as any).CESIUM_BASE_URL = '/cesiumStatic';
      }

      viewer = new Cesium.Viewer(containerRef.current!, {
        terrainProvider: await Cesium.createWorldTerrainAsync(),
        animation: false,
        timeline: false,
        navigationHelpButton: false,
        sceneModePicker: false,
      });

      viewerRef.current = viewer;
      viewer.scene.globe.show = globeVisibleRef.current;
      // 지형/수면(저수지 등)에 가려지지 않도록 끔 → 포인트 클라우드가 지형 아래 있어도 보임
      viewer.scene.globe.depthTestAgainstTerrain = false;
      
      // 포인트 클라우드 최적화
      const pcs = (viewer.scene as any).pointCloudShading;
      if (pcs) {
        pcs.maximumAttenuation = 64;
        pcs.eyeDomeLighting = true;
      }

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          DEFAULT_CENTER_LON,
          DEFAULT_CENTER_LAT,
          DEFAULT_CAMERA_HEIGHT_3D
        ),
      });

      setViewerReady(true);
    })();

    return () => {
      setViewerReady(false);
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      tilesetsRef.current.clear();
    };
  }, []);

  // ========== 레이어 표시/숨김 및 추가 ==========
  useEffect(() => {
    if (!viewerReady || !viewerRef.current) return;

    const viewer = viewerRef.current;
    const primitives = viewer.scene.primitives;
    const currentMap = tilesetsRef.current;
    const nextVisibleNames = new Set(visibleTilesetNames);

    // 1. 이미 로드된 타일셋은 show만 토글 (remove/destroy 없이 → 에러 방지, 끄면 화면에서 숨김)
    for (const [name, tileset] of currentMap) {
      const show = nextVisibleNames.has(name);
      tileset.show = show;
    }
    console.info('[CesiumMap] 타일 표시/숨김', {
      표시할_목록: visibleTilesetNames,
      현재_로드된_목록: Array.from(currentMap.keys()),
    });
    visibleRef.current = nextVisibleNames;

    // 2. 아직 로드 안 된 이름만 추가
    visibleTilesetNames.forEach(async (name) => {
      if (currentMap.has(name)) return;

      const url = `/api/3dtiles/${encodeURIComponent(name)}/tileset.json`;
      
      try {
        const Cesium = await getCesium();
        const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
          maximumScreenSpaceError: 16,
        });

        if (!viewerRef.current || !visibleRef.current.has(name)) return;

        primitives.add(tileset);
        currentMap.set(name, tileset);

        console.info('[CesiumMap] 타일 로드 완료', {
          name,
          url,
          로드된_타일_목록: Array.from(currentMap.keys()),
        });

        // 고도 오프셋: 지형/수면 위로 올려서 표시
        if (TILESET_HEIGHT_OFFSET_M !== 0) {
          const rp = (tileset as { readyPromise?: Promise<Cesium3DTileset> }).readyPromise;
          if (rp) {
            rp.then(() => {
              const bs = tileset.boundingSphere;
              if (bs?.center) {
                const up = Cesium.Cartesian3.normalize(bs.center, new Cesium.Cartesian3());
                const translation = Cesium.Cartesian3.multiplyByScalar(
                  up,
                  TILESET_HEIGHT_OFFSET_M,
                  new Cesium.Cartesian3()
                );
                tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
                try {
                  const carto = Cesium.Cartographic.fromCartesian(bs.center);
                  const lonDeg = (carto.longitude * 180) / Math.PI;
                  const latDeg = (carto.latitude * 180) / Math.PI;
                  console.info('[CesiumMap] 타일 boundingSphere (로드 검증)', {
                    name,
                    ECEF: { x: bs.center.x, y: bs.center.y, z: bs.center.z },
                    경위도: { longitude: lonDeg, latitude: latDeg, height: carto.height },
                    radius: bs.radius,
                  });
                } catch (_) {}
              }
            }).catch(() => {});
          }
        }

        // 타일셋이 로드된 후 위치로 이동
        await safeZoomToTileset(viewer, tileset, name);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CesiumMap] ${name} 로드 실패:`, msg);
        onTilesetLoadError?.(name, msg);
      }
    });
  }, [viewerReady, visibleTilesetNames]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
});

export default CesiumMap;
