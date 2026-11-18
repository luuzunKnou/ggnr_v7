'use client';

import { useEffect, useRef, useState } from 'react';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import ImageLayer from 'ol/layer/Image';
import XYZ from 'ol/source/XYZ';
import ImageWMS from 'ol/source/ImageWMS';
import { fromLonLat, toLonLat } from 'ol/proj';
import { call } from '@/lib/api';
import { getGeoServerBase } from '@/lib/geoserverUrl';
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad';
import { WTL_LAYER_SHAPE_DEFS } from '@/lib/wtlLayerShapeDefs';
import { WORKSPACE } from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory';
import { UNDERGROUND_FACILITY_LAYERS } from '@/app/(pages)/map/_mapComponents/layerFactory/undergroundFacilityLayerFactory';
import {
  DEFAULT_CAMERA_HEIGHT_3D,
  DEFAULT_CENTER_LAT,
  DEFAULT_CENTER_LON,
  DEFAULT_ZOOM_2D,
  VIEW_RESOLUTIONS_3857,
} from '@/app/(pages)/map/_mapComponents/config/mapDefaults';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { getCesium } from '@/app/(pages)/3dMap/cesiumLoader';
import type { ManholeFeature, PipeSegment } from '../threeJs/shapeTypes';
import { pipeWallThicknessM } from '../threeJs/groundPipes';

type CesiumViewer = import('cesium').Viewer;
type CesiumEntity = import('cesium').Entity;

const LAYER_OPTIONS = WTL_LAYER_SHAPE_DEFS.filter((d) => d.fromGround).map((d) => ({
  kind: d.kind,
  label: d.label,
  desc: d.geom === 'line' ? `${d.kind} — 중공 파이프` : `${d.kind} — 원통(규격·구경)`,
  geom: d.geom,
}));

type CameraMode = 'ground' | 'under';

function emptyChecked(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const opt of LAYER_OPTIONS) out[opt.kind] = false;
  return out;
}

function viewQueryPolygon(map: Map): [number, number][] | null {
  const extent = map.getView().calculateExtent(map.getSize());
  if (!extent || extent.some((n) => !Number.isFinite(n))) return null;
  const [minX, minY, maxX, maxY] = extent;
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/** 위에서 수직이 아니라 지평선이 보이도록 기울인 기본 시선 (도) */
const OBLIQUE_PITCH_DEG = -32;
/** 이보다 지면이 굵게 보이면 실제 관경 원통이 화면에 잡힘. 그 전엔 2D 레이어를 얹음 */
const PIPE_VISIBLE_MPP = 0.4;

function metersPerPixel(range: number, canvasH: number): number {
  return (Math.max(80, range) * 2 * Math.tan(Math.PI / 6)) / Math.max(200, canvasH);
}

const MIN_RES_2D = VIEW_RESOLUTIONS_3857[VIEW_RESOLUTIONS_3857.length - 1] ?? 0.04;

function rangeFromResolution(resolution: number, heightPx: number): number {
  return Math.max(2, (resolution * heightPx) / (2 * Math.tan(Math.PI / 6)));
}

async function placeCesiumCamera(
  viewer: CesiumViewer,
  lon: number,
  lat: number,
  range: number,
  keepAngle = true
): Promise<void> {
  const Cesium = await getCesium();
  const carto = Cesium.Cartographic.fromDegrees(lon, lat);
  const gh = viewer.scene.globe.getHeight(carto);
  const h = gh != null && Number.isFinite(gh) ? gh : 0;
  const pitch = keepAngle ? viewer.camera.pitch : Cesium.Math.toRadians(OBLIQUE_PITCH_DEG);
  const heading = keepAngle ? viewer.camera.heading : 0;
  viewer.camera.lookAt(
    Cesium.Cartesian3.fromDegrees(lon, lat, h),
    new Cesium.HeadingPitchRange(heading, pitch, Math.max(2, range))
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}

function enableFreeCamera(viewer: CesiumViewer): void {
  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.enableZoom = true;
  ctrl.enableTranslate = true;
  ctrl.enableRotate = true;
  ctrl.enableTilt = true;
  ctrl.enableLook = false;
  ctrl.enableCollisionDetection = false;
  ctrl.minimumZoomDistance = 1;
}

function applyUndergroundLook(viewer: CesiumViewer, mode: CameraMode): void {
  const translucency = viewer.scene.globe.translucency;
  const imageryAlpha = mode === 'under' ? 0.22 : 1;
  if (mode === 'under') {
    translucency.enabled = true;
    translucency.frontFaceAlpha = 0.28;
    translucency.backFaceAlpha = 0.12;
    const alphaByDistance = translucency as {
      frontFaceAlphaByDistance?: import('cesium').NearFarScalar;
      backFaceAlphaByDistance?: import('cesium').NearFarScalar;
    };
    alphaByDistance.frontFaceAlphaByDistance = undefined;
    alphaByDistance.backFaceAlphaByDistance = undefined;
    viewer.scene.globe.depthTestAgainstTerrain = true;
  } else {
    translucency.enabled = false;
    viewer.scene.globe.depthTestAgainstTerrain = false;
  }
  const layers = viewer.imageryLayers;
  for (let i = 0; i < layers.length; i++) {
    layers.get(i).alpha = imageryAlpha;
  }
  viewer.scene.requestRender();
}

/** 관 중심에서 진행 방향의 옆면으로 반지름만큼 옮긴 위치 (라벨을 표면에 붙임) */
function labelOnPipeWall(
  path: { lon: number; lat: number }[],
  index: number,
  radiusM: number
): { lon: number; lat: number } {
  const p = path[index] ?? path[0];
  if (!p) return { lon: 0, lat: 0 };
  const prev = path[Math.max(0, index - 1)] ?? p;
  const next = path[Math.min(path.length - 1, index + 1)] ?? p;
  const latRad = (p.lat * Math.PI) / 180;
  const east = (next.lon - prev.lon) * Math.cos(latRad) * 111320;
  const north = (next.lat - prev.lat) * 111320;
  const len = Math.hypot(east, north) || 1;
  const sideEast = (-north / len) * radiusM;
  const sideNorth = (east / len) * radiusM;
  return {
    lon: p.lon + sideEast / (111320 * Math.cos(latRad) || 1),
    lat: p.lat + sideNorth / 111320,
  };
}

function mercatorToLonLat(x: number, y: number): [number, number] {
  const [lon, lat] = toLonLat([x, y]);
  return [lon, lat];
}

/** 바깥·안쪽 반지름의 고리 단면. Three.js 중공 관과 같이 속이 빈 파이프 */
function pipeRing(
  Cesium: typeof import('cesium'),
  outerR: number,
  innerR: number
): import('cesium').Cartesian2[] {
  const n = 12;
  const shape: import('cesium').Cartesian2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    shape.push(new Cesium.Cartesian2(Math.cos(a) * outerR, Math.sin(a) * outerR));
  }
  for (let i = n; i >= 0; i--) {
    const a = (i / n) * Math.PI * 2;
    shape.push(new Cesium.Cartesian2(Math.cos(a) * innerR, Math.sin(a) * innerR));
  }
  return shape;
}

function decimatePipe(
  coords: [number, number][],
  depths: number[] | undefined,
  fallbackDepth: number,
  maxPts: number
): { x: number; y: number; depth: number }[] {
  const n = coords.length;
  if (n < 2) return [];
  const take = Math.min(n, maxPts);
  const raw: { x: number; y: number; depth: number }[] = [];
  for (let i = 0; i < take; i++) {
    const idx = take === n ? i : Math.round((i * (n - 1)) / (take - 1));
    const c = coords[idx];
    if (!c) continue;
    const depthRaw = depths && depths.length === n ? depths[idx] : fallbackDepth;
    raw.push({
      x: c[0],
      y: c[1],
      depth: Math.max(0.05, depthRaw ?? fallbackDepth),
    });
  }
  const out: { x: number; y: number; depth: number }[] = [];
  for (const p of raw) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 0.4) continue;
    out.push(p);
  }
  return out.length >= 2 ? out : raw.slice(0, 2);
}

/** 구글 항공. WebGL 타일은 Cesium과 컨텍스트가 겹쳐 2D가 비므로 캔버스 XYZ만 사용 */
const GOOGLE_AERIAL_URL = 'https://mt0.google.com/vt/lyrs=s&hl=ko&x={x}&y={y}&z={z}';

function createGoogleAerialLayer(): TileLayer<XYZ> {
  return new TileLayer({
    source: new XYZ({
      url: GOOGLE_AERIAL_URL,
      maxZoom: 21,
      crossOrigin: 'anonymous',
      attributions: '© Google',
    }),
  });
}

type WmsSpec = { tableName: string; styleName: string; cql?: string };

/** 우측 «지하시설물»과 동일 — 분할 레이어가 있으면 부모 대신 그 이름·조건으로 요청 */
function wmsSpecsForKind(kind: string): WmsSpec[] {
  const key = kind.trim().toLowerCase();
  const children = UNDERGROUND_FACILITY_LAYERS.filter(
    (l) => (l.parentTableName ?? '').trim().toLowerCase() === key
  );
  const rows = children.length
    ? children
    : UNDERGROUND_FACILITY_LAYERS.filter((l) => l.tableName.trim().toLowerCase() === key);
  if (rows.length) {
    return rows.map((l) => ({
      tableName: l.tableName,
      styleName: l.tableName,
      cql: l.cqlFilter,
    }));
  }
  return [{ tableName: kind, styleName: kind }];
}

/** 본 지도 서비스 레이어와 동일. 뷰·이미지 모두 EPSG:3857 (저장 좌표 5181은 GeoServer가 변환) */
function createOverlayWmsLayer(visible: boolean): ImageLayer<ImageWMS> {
  return new ImageLayer({
    visible,
    source: new ImageWMS({
      url: `${getGeoServerBase()}/${WORKSPACE}/wms`,
      projection: 'EPSG:3857',
      params: {
        LAYERS: '',
        STYLES: '',
        TRANSPARENT: 'true',
        FORMAT: 'image/png',
        EXCEPTIONS: 'application/vnd.ogc.se_xml',
      },
      serverType: 'geoserver',
      ratio: 1.5,
      crossOrigin: 'anonymous',
      imageLoadFunction: geoserverWmsImageLoadFunction,
    }),
  });
}

function applyWmsSpecs(layer: ImageLayer<ImageWMS>, specs: WmsSpec[]): void {
  const source = layer.getSource();
  if (!source) return;
  if (!specs.length) {
    source.updateParams({ LAYERS: '', STYLES: '' });
    const params = source.getParams();
    delete params.CQL_FILTER;
    layer.setVisible(false);
    source.changed();
    return;
  }
  const cqls = specs.map((s) => (s.cql && s.cql.trim()) || 'INCLUDE');
  const allInclude = cqls.every((c) => c === 'INCLUDE');
  source.updateParams({
    LAYERS: specs.map((s) => `${WORKSPACE}:${s.tableName}`).join(','),
    STYLES: specs.map((s) => s.styleName).join(','),
    TRANSPARENT: 'true',
    FORMAT: 'image/png',
    EXCEPTIONS: 'application/vnd.ogc.se_xml',
    CQL_FILTER: allInclude ? undefined : cqls.join(';'),
  });
  if (allInclude) delete source.getParams().CQL_FILTER;
  layer.setVisible(true);
  source.changed();
}

export function CesiumSplitContent() {
  const cesiumHostRef = useRef<HTMLDivElement>(null);
  const olHostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const mapRef = useRef<Map | null>(null);
  const facilityWmsRef = useRef<ImageLayer<ImageWMS> | null>(null);
  const entitiesRef = useRef<CesiumEntity[]>([]);
  const lastQueryKeyRef = useRef('');
  const ignoreCesiumUntilRef = useRef(0);
  const ignoreOlUntilRef = useRef(0);
  const requestSeqRef = useRef(0);
  const cameraModeRef = useRef<CameraMode>('ground');
  const cesiumDrapeRef = useRef<import('cesium').ImageryLayer[]>([]);
  const freeZoomRef = useRef(false);
  const poseRef = useRef<{
    lon: number;
    lat: number;
    range: number;
    heading: number;
    pitch: number;
  } | null>(null);
  const drapeSeqRef = useRef(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>('ground');
  const [checked, setChecked] = useState(emptyChecked);
  const [extentTick, setExtentTick] = useState(0);
  const [status, setStatus] = useState('지도를 불러오는 중');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const cesiumHost = cesiumHostRef.current;
    const olHost = olHostRef.current;
    if (!cesiumHost || !olHost) return;

    let cancelled = false;
    let viewer: CesiumViewer | null = null;
    const emdLayer = createOverlayWmsLayer(true);
    emdLayer.setZIndex(10);
    applyWmsSpecs(emdLayer, [{ tableName: 'emd', styleName: 'emd' }]);
    const facilityLayer = createOverlayWmsLayer(false);
    facilityLayer.setZIndex(20);
    facilityWmsRef.current = facilityLayer;

    const map = new Map({
      target: olHost,
      layers: [createGoogleAerialLayer(), emdLayer, facilityLayer],
      view: new View({
        projection: 'EPSG:3857',
        center: fromLonLat([DEFAULT_CENTER_LON, DEFAULT_CENTER_LAT]),
        zoom: DEFAULT_ZOOM_2D,
        resolutions: VIEW_RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: VIEW_RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
      }),
    });
    mapRef.current = map;

    const onMoveEnd = () => {
      if (performance.now() < ignoreOlUntilRef.current) return;
      const v = viewerRef.current;
      const view = map.getView();
      const center = view.getCenter();
      if (v && center) {
        ignoreCesiumUntilRef.current = performance.now() + 700;
        void (async () => {
          const [lon, lat] = toLonLat(center);
          const resolution = view.getResolution() ?? 10;
          const heightPx = olHost.clientHeight || 600;
          const range2d = rangeFromResolution(resolution, heightPx);
          const atCeiling = resolution <= MIN_RES_2D * 1.05;
          const range =
            freeZoomRef.current && atCeiling
              ? (poseRef.current?.range ?? range2d)
              : range2d;
          if (!atCeiling) freeZoomRef.current = false;
          await placeCesiumCamera(v, lon, lat, range, true);
          poseRef.current = {
            lon,
            lat,
            range,
            heading: v.camera.heading,
            pitch: v.camera.pitch,
          };
        })();
      }
      setExtentTick((n) => n + 1);
    };
    map.on('moveend', onMoveEnd);
    requestAnimationFrame(() => map.updateSize());
    window.setTimeout(() => map.updateSize(), 200);

    const resize = () => {
      map.updateSize();
      viewerRef.current?.resize();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(cesiumHost);
    observer.observe(olHost);

    void (async () => {
      const Cesium = await getCesium();
      if (cancelled) return;
      if (typeof window !== 'undefined' && !(window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL) {
        const base = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
        (window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = `${base}/cesiumStatic`;
      }
      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

      let terrain: import('cesium').TerrainProvider = new Cesium.EllipsoidTerrainProvider();
      try {
        terrain = await Cesium.createWorldTerrainAsync();
      } catch {
        terrain = new Cesium.EllipsoidTerrainProvider();
      }
      if (cancelled) return;

      const googleAerial = new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: GOOGLE_AERIAL_URL,
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
          maximumLevel: 21,
          credit: '© Google',
        })
      );
      viewer = new Cesium.Viewer(cesiumHost, {
        terrainProvider: terrain,
        baseLayer: googleAerial,
        animation: false,
        timeline: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        selectionIndicator: false,
      });
      if (cancelled) {
        viewer.destroy();
        viewer = null;
        return;
      }
      const globe = viewer.scene.globe;
      globe.enableLighting = false;
      globe.depthTestAgainstTerrain = false;
      globe.undergroundColor = new Cesium.Color(0.78, 0.82, 0.86, 1);
      globe.translucency.enabled = false;
      viewer.scene.light = new Cesium.DirectionalLight({
        direction: new Cesium.Cartesian3(0.35, -0.55, -0.76),
        intensity: 2,
      });
      enableFreeCamera(viewer);
      viewer.scene.requestRenderMode = true;
      viewer.scene.maximumRenderTimeChange = Infinity;
      viewer.scene.globe.maximumScreenSpaceError = 4;
      viewer.scene.globe.preloadAncestors = false;
      viewer.scene.globe.preloadSiblings = false;
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.fog.enabled = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
      if (viewer.scene.sun) viewer.scene.sun.show = false;
      if (viewer.scene.moon) viewer.scene.moon.show = false;
      if (window.devicePixelRatio > 1) viewer.resolutionScale = 0.75;
      const fxaa = viewer.scene.postProcessStages.fxaa;
      if (fxaa) fxaa.enabled = false;
      const credit = viewer.cesiumWidget.creditContainer as HTMLElement | undefined;
      if (credit) credit.style.display = 'none';
      try {
        const emdProvider = new Cesium.WebMapServiceImageryProvider({
          url: `${getGeoServerBase()}/${WORKSPACE}/wms`,
          layers: `${WORKSPACE}:emd`,
          parameters: {
            transparent: 'true',
            format: 'image/png',
            styles: 'emd',
          },
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
          enablePickFeatures: false,
        });
        viewer.imageryLayers.add(new Cesium.ImageryLayer(emdProvider));
      } catch (e) {
        console.warn('[CesiumSplit] 읍면동 레이어 추가 실패', e);
      }
      const ground0 = viewer.scene.globe.getHeight(
        Cesium.Cartographic.fromDegrees(DEFAULT_CENTER_LON, DEFAULT_CENTER_LAT)
      );
      viewer.camera.lookAt(
        Cesium.Cartesian3.fromDegrees(
          DEFAULT_CENTER_LON,
          DEFAULT_CENTER_LAT,
          ground0 != null && Number.isFinite(ground0) ? ground0 : 0
        ),
        new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(OBLIQUE_PITCH_DEG),
          DEFAULT_CAMERA_HEIGHT_3D
        )
      );
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      poseRef.current = {
        lon: DEFAULT_CENTER_LON,
        lat: DEFAULT_CENTER_LAT,
        range: DEFAULT_CAMERA_HEIGHT_3D,
        heading: 0,
        pitch: Cesium.Math.toRadians(OBLIQUE_PITCH_DEG),
      };
      const groundHit = () => {
        const canvas = viewer!.scene.canvas;
        const mid = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        const ray = viewer!.camera.getPickRay(mid);
        return ray ? viewer!.scene.globe.pick(ray, viewer!.scene) : undefined;
      };
      const syncDrape = (hit?: import('cesium').Cartesian3) => {
        const canvasH = viewer!.scene.canvas.clientHeight || 600;
        const range = hit
          ? Cesium.Cartesian3.distance(viewer!.camera.position, hit)
          : Math.max(80, viewer!.camera.positionCartographic?.height ?? DEFAULT_CAMERA_HEIGHT_3D);
        const show = metersPerPixel(range, canvasH) > PIPE_VISIBLE_MPP;
        for (const ly of cesiumDrapeRef.current) ly.show = show;
      };
      viewer.camera.moveEnd.addEventListener(() => {
        const hit = groundHit();
        syncDrape(hit);
        viewer!.scene.requestRender();
        if (performance.now() < ignoreCesiumUntilRef.current) return;
        const m = mapRef.current;
        if (!m) return;
        const carto = hit
          ? Cesium.Cartographic.fromCartesian(hit)
          : viewer!.camera.positionCartographic;
        if (!carto) return;
        ignoreOlUntilRef.current = performance.now() + 700;
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const range = hit
          ? Math.max(80, Cesium.Cartesian3.distance(viewer!.camera.position, hit))
          : Math.max(80, carto.height);
        const heightPx = olHost.clientHeight || 600;
        const resolution = (range * 2 * Math.tan(Math.PI / 6)) / heightPx;
        const minRange = rangeFromResolution(MIN_RES_2D, heightPx);
        const prev = poseRef.current;
        const pitchNow = viewer!.camera.pitch;
        const headNow = viewer!.camera.heading;
        const pitchDelta = prev ? Math.abs(pitchNow - prev.pitch) : 0;
        const headDelta = prev ? Math.abs(Cesium.Math.negativePiToPi(headNow - prev.heading)) : 0;
        const rangeShift = prev ? Math.abs(range - prev.range) / Math.max(prev.range, 1) : 1;
        if (prev && (pitchDelta > 0.03 || headDelta > 0.03) && rangeShift < 0.18) {
          poseRef.current = { ...prev, heading: headNow, pitch: pitchNow };
          ignoreCesiumUntilRef.current = performance.now() + 500;
          void placeCesiumCamera(viewer!, prev.lon, prev.lat, prev.range, true);
          return;
        }
        const closerThan2d = range < minRange * 0.92;
        freeZoomRef.current = closerThan2d;
        poseRef.current = { lon, lat, range, heading: headNow, pitch: pitchNow };
        const view = m.getView();
        view.setCenter(fromLonLat([lon, lat]));
        view.setResolution(closerThan2d ? MIN_RES_2D : resolution);
        setExtentTick((n) => n + 1);
      });
      viewerRef.current = viewer;
      setReady(true);
      setExtentTick((n) => n + 1);
      setStatus('레이어를 고르면 현재 범위에 표시합니다');
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
      map.un('moveend', onMoveEnd);
      map.setTarget(undefined);
      mapRef.current = null;
      facilityWmsRef.current = null;
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      } else if (viewer) {
        viewer.destroy();
      }
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const facilityLayer = facilityWmsRef.current;
    if (!facilityLayer) return;
    const viewer = viewerRef.current;
    const selected = LAYER_OPTIONS.filter((o) => checked[o.kind]);
    const specs = selected.flatMap((o) => wmsSpecsForKind(o.kind));
    applyWmsSpecs(facilityLayer, specs);
    if (!viewer) return;

    for (const ly of cesiumDrapeRef.current) {
      try {
        viewer.imageryLayers.remove(ly, true);
      } catch {
        /* 이미 제거됨 */
      }
    }
    cesiumDrapeRef.current = [];
    const seq = ++drapeSeqRef.current;
    void (async () => {
      const Cesium = await getCesium();
      if (drapeSeqRef.current !== seq || viewerRef.current !== viewer) return;
      const canvasH = viewer.scene.canvas.clientHeight || 600;
      const camH = viewer.camera.positionCartographic?.height ?? DEFAULT_CAMERA_HEIGHT_3D;
      const pitchSin = Math.abs(Math.sin(viewer.camera.pitch));
      const show =
        metersPerPixel(pitchSin > 0.2 ? camH / pitchSin : camH, canvasH) > PIPE_VISIBLE_MPP;
      for (const spec of specs) {
        try {
          const provider = new Cesium.WebMapServiceImageryProvider({
            url: `${getGeoServerBase()}/${WORKSPACE}/wms`,
            layers: `${WORKSPACE}:${spec.tableName}`,
            parameters: {
              transparent: 'true',
              format: 'image/png',
              styles: spec.styleName,
              ...(spec.cql ? { CQL_FILTER: spec.cql } : {}),
            },
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
            enablePickFeatures: false,
          });
          if (drapeSeqRef.current !== seq || viewerRef.current !== viewer) return;
          const layer = viewer.imageryLayers.addImageryProvider(provider);
          layer.show = show;
          layer.alpha = cameraModeRef.current === 'under' ? 0.22 : 1;
          cesiumDrapeRef.current.push(layer);
        } catch (e) {
          console.warn('[CesiumSplit] 2D 레이어 얹기 실패', spec.tableName, e);
        }
      }
      viewer.scene.requestRender();
    })();
  }, [checked, ready]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const viewer = viewerRef.current;
    if (!map || !viewer) return;

    const selected = LAYER_OPTIONS.filter((o) => checked[o.kind]);
    const polygon3857 = viewQueryPolygon(map);

    const clearGraphics = () => {
      const v = viewerRef.current;
      if (!v) return;
      for (const e of entitiesRef.current) {
        v.entities.remove(e);
      }
      entitiesRef.current = [];
      v.scene.requestRender();
    };

    if (!selected.length || !polygon3857) {
      lastQueryKeyRef.current = '';
      clearGraphics();
      setStatus(selected.length ? '범위 없음' : '레이어를 선택하세요');
      return;
    }

    const queryKey = `${selected.map((o) => o.kind).join(',')}|${polygon3857
      .map((p) => `${Math.round(p[0] / 40)},${Math.round(p[1] / 40)}`)
      .join(';')}`;
    if (queryKey === lastQueryKeyRef.current) return;

    const timer = window.setTimeout(() => {
      const requestId = ++requestSeqRef.current;
      setStatus('조회 중…');
      void (async () => {
        const Cesium = await getCesium();
        const notes: string[] = [];
        const entities: CesiumEntity[] = [];
        const pipeDraws: {
          color: string;
          diameterM: number;
          label: string;
          path: { lon: number; lat: number; depth: number; surface?: number }[];
        }[] = [];

        await Promise.all(
          selected.map(async (opt) => {
            try {
              const action =
                opt.geom === 'line' ? 'getWtlLineLayerInExtent' : 'getWtlPointLayerInExtent';
              const res = await call('', 'POST', {
                service: 'elevationService',
                action,
                params: { srid: 3857, polygon3857, table: opt.kind },
              });
              if (requestSeqRef.current !== requestId) return;
              const data = (res?.data ?? res) as {
                success?: boolean;
                pipes?: PipeSegment[];
                manholes?: ManholeFeature[];
                error?: string;
              };
              if (!data?.success) {
                notes.push(data?.error ?? `${opt.label} 실패`);
                return;
              }
              if (opt.geom === 'line') {
                const pipes = Array.isArray(data.pipes) ? data.pipes : [];
                notes.push(`${opt.label} ${pipes.length}건`);
                for (const pipe of pipes) {
                  if (!pipe.coords3857 || pipe.coords3857.length < 2) continue;
                  const path = decimatePipe(pipe.coords3857, pipe.depthsM, pipe.depthM, 16);
                  if (path.length < 2) continue;
                  const surface =
                    pipe.surfaceElevM != null && Number.isFinite(pipe.surfaceElevM)
                      ? pipe.surfaceElevM
                      : undefined;
                  pipeDraws.push({
                    color: pipe.color || '#38bdf8',
                    diameterM: pipe.diameterM || 0.1,
                    label: (pipe.label ?? '').trim(),
                    path: path.map((p) => {
                      const [lon, lat] = mercatorToLonLat(p.x, p.y);
                      return { lon, lat, depth: p.depth, surface };
                    }),
                  });
                }
              } else {
                const points = Array.isArray(data.manholes) ? data.manholes : [];
                notes.push(`${opt.label} ${points.length}건`);
                for (const pt of points) {
                  const color = pt.color || '#c084fc';
                  const [lon, lat] = mercatorToLonLat(pt.x3857, pt.y3857);
                  const length = Math.max(0.6, pt.depthM || 0.8);
                  const radius = Math.max(0.15, (pt.diameterM || 0.4) / 2);
                  const hasSurf = pt.surfaceElevM != null && Number.isFinite(pt.surfaceElevM);
                  entities.push(
                    viewer.entities.add({
                      name: pt.label || opt.label,
                      position: Cesium.Cartesian3.fromDegrees(
                        lon,
                        lat,
                        hasSurf ? pt.surfaceElevM! + length / 2 : length / 2
                      ),
                      cylinder: {
                        length,
                        topRadius: radius,
                        bottomRadius: radius,
                        material: Cesium.Color.fromCssColorString(color).withAlpha(0.9),
                        heightReference: hasSurf
                          ? Cesium.HeightReference.NONE
                          : Cesium.HeightReference.RELATIVE_TO_GROUND,
                      },
                    })
                  );
                }
              }
            } catch (e) {
              notes.push(e instanceof Error ? e.message : `${opt.label} 오류`);
            }
          })
        );

        if (requestSeqRef.current !== requestId || viewerRef.current !== viewer) {
          for (const e of entities) viewer.entities.remove(e);
          return;
        }

        const cartos = pipeDraws.flatMap((d) =>
          d.path.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat))
        );
        let terrainH: number[] = [];
        if (cartos.length) {
          try {
            const sampled = await Cesium.sampleTerrainMostDetailed(
              viewer.terrainProvider,
              cartos
            );
            if (requestSeqRef.current !== requestId || viewerRef.current !== viewer) {
              for (const e of entities) viewer.entities.remove(e);
              return;
            }
            terrainH = sampled.map((c) => c.height);
          } catch {
            terrainH = [];
          }
        }

        let ti = 0;
        for (const draw of pipeDraws) {
          const outerR = Math.max(0.04, draw.diameterM / 2);
          const wall = pipeWallThicknessM(draw.diameterM);
          const innerR = Math.max(0.008, Math.min(outerR - wall, outerR * 0.92));
          const flat: number[] = [];
          let midH = 0;
          const midIndex = Math.floor(draw.path.length / 2);
          draw.path.forEach((p, i) => {
            const sampled = terrainH[ti++];
            // 보이는 지형(Cesium) 바로 아래에서 심도만큼만. 등고 해발은 지형과 어긋나 너무 깊게 묻힌다.
            const ground =
              sampled != null && Number.isFinite(sampled)
                ? sampled
                : p.surface != null && Number.isFinite(p.surface)
                  ? p.surface
                  : 0;
            const h = ground - p.depth;
            flat.push(p.lon, p.lat, h);
            if (i === midIndex) midH = h;
          });
          entities.push(
            viewer.entities.add({
              polylineVolume: {
                positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat),
                shape: pipeRing(Cesium, outerR, innerR),
                material: Cesium.Color.fromCssColorString(draw.color),
                cornerType: Cesium.CornerType.MITERED,
              },
            })
          );
          if (draw.label) {
            const onWall = labelOnPipeWall(draw.path, midIndex, outerR);
            entities.push(
              viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(onWall.lon, onWall.lat, midH),
                label: {
                  text: draw.label,
                  font: '12px sans-serif',
                  fillColor: Cesium.Color.WHITE,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                  verticalOrigin: Cesium.VerticalOrigin.CENTER,
                  pixelOffset: new Cesium.Cartesian2(0, 0),
                  eyeOffset: new Cesium.Cartesian3(0, 0, 0),
                  distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 800),
                },
              })
            );
          }
        }

        clearGraphics();
        lastQueryKeyRef.current = queryKey;
        entitiesRef.current = entities;
        viewer.scene.requestRender();
        setStatus(notes.join(' · ') || '결과 없음');
      })();
    }, 450);

    return () => {
      window.clearTimeout(timer);
      requestSeqRef.current += 1;
    };
  }, [checked, extentTick, ready]);

  const applyCameraMode = (mode: CameraMode) => {
    cameraModeRef.current = mode;
    setCameraMode(mode);
    const v = viewerRef.current;
    const map = mapRef.current;
    const center = map?.getView().getCenter();
    if (!v || !map || !center) return;
    applyUndergroundLook(v, mode);
    ignoreCesiumUntilRef.current = performance.now() + 700;
    const [lon, lat] = toLonLat(center);
    const resolution = map.getView().getResolution() ?? 10;
    const heightPx = olHostRef.current?.clientHeight || 600;
    const range = Math.max(80, (resolution * heightPx) / (2 * Math.tan(Math.PI / 6)));
    void placeCesiumCamera(v, lon, lat, range);
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-2 py-1.5 text-[12px] font-medium text-foreground">
          레이어 도형
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {LAYER_OPTIONS.map((opt) => (
            <li key={opt.kind}>
              <label
                className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/60"
                title={opt.label}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary"
                  checked={!!checked[opt.kind]}
                  onChange={(e) =>
                    setChecked((prev) => ({ ...prev, [opt.kind]: e.target.checked }))
                  }
                />
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-foreground">{opt.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{opt.desc}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">{status}</p>
      </aside>
      <section className="relative min-h-0 min-w-0 flex-1 border-r border-border">
        <div ref={olHostRef} className="absolute inset-0" />
        <span className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-card/90 px-1.5 py-0.5 text-[11px] text-foreground">
          2D
        </span>
      </section>
      <section className="relative min-h-0 min-w-0 flex-1">
        <div ref={cesiumHostRef} className="absolute inset-0" />
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
          <button
            type="button"
            title="지상"
            className={`cursor-pointer rounded border px-2 py-1 text-[12px] ${
              cameraMode === 'ground'
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-card text-foreground hover:bg-muted'
            }`}
            onClick={() => applyCameraMode('ground')}
          >
            지상
          </button>
          <button
            type="button"
            title="지하"
            className={`cursor-pointer rounded border px-2 py-1 text-[12px] ${
              cameraMode === 'under'
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-card text-foreground hover:bg-muted'
            }`}
            onClick={() => applyCameraMode('under')}
          >
            지하
          </button>
        </div>
        <span className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-card/90 px-1.5 py-0.5 text-[11px] text-foreground">
          3D
        </span>
      </section>
    </div>
  );
}
