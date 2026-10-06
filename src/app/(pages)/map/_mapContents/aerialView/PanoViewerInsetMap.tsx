'use client';

import '@/app/(pages)/map/_mapComponents/config/projections';
import { useEffect, useRef, useState } from 'react';
import Feature, { type FeatureLike } from 'ol/Feature';
import Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import View from 'ol/View';
import Point from 'ol/geom/Point';
import DragPan from 'ol/interaction/DragPan';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import MouseWheelZoom from 'ol/interaction/MouseWheelZoom';
import PinchZoom from 'ol/interaction/PinchZoom';
import VectorLayer from 'ol/layer/Vector';
import { getTransform } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, RegularShape, Stroke, Style } from 'ol/style';
import { useMapContext } from '../../_mapComponents/MapContext';
import { useBackgroundLayer } from '../../_mapComponents/hooks/useBackgroundLayer';
import { createCadastralLayers, createBuildingRoadLayers } from '../../_mapComponents/layerFactory/boundaryLayerFactory';
import { createSafetyFacBuildingRoadLayers } from '../../_mapComponents/layerFactory/safetyFacBuildingRoadLayerFactory';
import { createBasicSectionLayers } from '../../_mapComponents/layerFactory/basicSectionLayerFactory';
import { createJimokLayers } from '../../_mapComponents/layerFactory/jimokLayerFactory';
import { createOwnershipLayers } from '../../_mapComponents/layerFactory/ownershipLayerFactory';
import { createThematicMapLayers } from '../../_mapComponents/layerFactory/thematicMapLayerFactory';
import { createUndergroundFacilityLayers } from '../../_mapComponents/layerFactory/undergroundFacilityLayerFactory';
import { createSafetydataMapLayers } from '../../_mapComponents/layerFactory/safetydataMapLayerFactory';
import { createServiceLayer } from '../../_mapComponents/layerFactory/serviceLayerFactory';
import { syncSecondaryLayersFromPrimary } from '../mapSplit/syncSecondaryLayersFromPrimary';
import {
  clearDynamicLayerMirrors,
  type DynamicMirrorRegistry,
} from '../mapSplit/mirrorPrimaryDynamicLayers';
import { mockUnitsForKind, subscribeMockWorkUnits } from './aerialMediaMockData';
import { collectFileLocations5181, fileCoord5181 } from './aerialLocationParse';
import type { WorkFileItem } from './aerialMediaTypes';

/** 네이버 거리뷰 미니맵과 같은 가로:세로 */
const NAVER_ROADVIEW_RATIO = 3 / 2;

const otherPointStyle = new Style({
  image: new RegularShape({
    points: 4,
    radius: 7,
    angle: Math.PI / 4,
    fill: new Fill({ color: 'rgba(234, 88, 12, 0.95)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});

const currentPointStyle = new Style({
  image: new RegularShape({
    points: 4,
    radius: 9,
    angle: Math.PI / 4,
    fill: new Fill({ color: 'rgba(234, 88, 12, 1)' }),
    stroke: new Stroke({ color: '#fff', width: 3 }),
  }),
});

function pointStyle(feature: FeatureLike) {
  return feature.get('current') ? currentPointStyle : otherPointStyle;
}

function toMapCoord(coord5181: [number, number], projection: string): [number, number] | null {
  const [x, y] = getTransform('EPSG:5181', projection)(coord5181, undefined, undefined);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

/**
 * 항공뷰 왼쪽 아래 지도. 다른 항공뷰 위치를 보여주고, 누르면 그 화면으로 바꾼다.
 */
export function PanoViewerInsetMap({
  file,
  onPick,
}: {
  file?: WorkFileItem | null;
  onPick?: (unitId: string, fileId: string) => void;
}) {
  const mapContext = useMapContext();
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [mini, setMini] = useState<Map | null>(null);
  const [bgId, setBgId] = useState('');
  const [box, setBox] = useState({ width: 188, height: 125 });
  const shot = file ? fileCoord5181(file) : null;
  const shotKey = shot ? `${shot[0]},${shot[1]}` : '';
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const fileIdRef = useRef(file?.id ?? '');
  fileIdRef.current = file?.id ?? '';
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const syncRef = useRef<() => void>(() => {});
  const recenterRef = useRef<() => void>(() => {});
  const [listTick, setListTick] = useState(0);

  useEffect(() => subscribeMockWorkUnits(() => setListTick((tick) => tick + 1)), []);

  useEffect(() => {
    const parent = frame?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const rect = parent.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return;
      let width = Math.round(Math.min(rect.width * 0.15, rect.height * 0.2 * NAVER_ROADVIEW_RATIO));
      width = Math.max(168, Math.min(width, 200));
      if (width > rect.width - 40) width = Math.max(148, Math.round(rect.width - 40));
      const height = Math.round(width / NAVER_ROADVIEW_RATIO);
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [frame]);

  useEffect(() => {
    setBgId(mapContext?.mapBackgroundMapIdRef?.current ?? '');
  }, [mapContext?.mapBackgroundMapIdRef]);

  useEffect(() => {
    const main = mapContext?.mapInstanceRef?.current;
    if (!host || !main) return;
    const mainView = main.getView();
    const view = new View({
      projection: mainView.getProjection(),
      center: mainView.getCenter() ?? undefined,
      zoom: mainView.getZoom() ?? 16,
    });
    const source = new VectorSource();
    const map = new Map({
      target: host,
      view,
      controls: [],
      layers: [
        new VectorLayer({
          source,
          style: pointStyle,
          zIndex: 8000,
          properties: { id: 'pano-inset-points', geomStackSkip: true },
        }),
        ...createCadastralLayers(),
        ...createBuildingRoadLayers(),
        ...createSafetyFacBuildingRoadLayers(),
        ...createBasicSectionLayers(),
        ...createJimokLayers(),
        ...createOwnershipLayers(),
        ...createThematicMapLayers(),
        ...createUndergroundFacilityLayers(),
        ...createSafetydataMapLayers(),
      ],
      interactions: [new DragPan(), new MouseWheelZoom(), new DoubleClickZoom(), new PinchZoom()],
    });
    map.addLayer(createServiceLayer());
    const mirrorRegistry: DynamicMirrorRegistry = new globalThis.Map();
    const syncMainLayers = () => syncSecondaryLayersFromPrimary(main, map, mirrorRegistry);
    syncMainLayers();
    const mainLayers = main.getLayers();
    mainLayers.on('add', syncMainLayers);
    mainLayers.on('remove', syncMainLayers);
    const syncTimer = window.setInterval(syncMainLayers, 400);
    const sync = () => {
      const active = map.getView();
      const projection = active.getProjection().getCode();
      const currentId = fileIdRef.current;
      const seen = new Set<string>();
      source.clear();
      const addPoint = (unitId: string, fileId: string, coord5181: [number, number]) => {
        if (seen.has(fileId)) return;
        const coord = toMapCoord(coord5181, projection);
        if (!coord) return;
        seen.add(fileId);
        const feat = new Feature({ geometry: new Point(coord) });
        feat.set('unitId', unitId);
        feat.set('fileId', fileId);
        feat.set('current', fileId === currentId);
        source.addFeature(feat);
      };
      for (const unit of mockUnitsForKind('panorama')) {
        for (const loc of collectFileLocations5181(unit.files)) {
          addPoint(unit.id, loc.fileId, loc.coord);
        }
      }
    };
    const recenter = () => {
      const current = shotRef.current;
      if (!current) return;
      const coord = toMapCoord(current, map.getView().getProjection().getCode());
      if (!coord) return;
      map.getView().setZoom(14);
      map.getView().setCenter(coord);
    };
    syncRef.current = sync;
    recenterRef.current = recenter;
    const onClick = (evt: MapBrowserEvent) => {
      const hits = map.getFeaturesAtPixel(evt.pixel, { hitTolerance: 8 }) as Feature[];
      const picked = hits.find((feat) => feat.get('fileId'));
      if (!picked) return;
      const unitId = String(picked.get('unitId') ?? '');
      const fileId = String(picked.get('fileId') ?? '');
      if (!unitId || !fileId) return;
      onPickRef.current?.(unitId, fileId);
    };
    const onMove = (evt: MapBrowserEvent) => {
      const hits = map.getFeaturesAtPixel(evt.pixel, { hitTolerance: 8 }) as Feature[];
      const el = map.getTargetElement();
      if (el) el.style.cursor = hits.some((feat) => feat.get('fileId')) ? 'pointer' : '';
    };
    const onView = () => sync();
    map.on('singleclick', onClick as never);
    map.on('pointermove', onMove as never);
    map.on('change:view', onView);
    sync();
    recenter();
    setMini(map);
    requestAnimationFrame(() => map.updateSize());

    return () => {
      window.clearInterval(syncTimer);
      mainLayers.un('add', syncMainLayers);
      mainLayers.un('remove', syncMainLayers);
      clearDynamicLayerMirrors(map, mirrorRegistry);
      map.un('singleclick', onClick as never);
      map.un('pointermove', onMove as never);
      map.un('change:view', onView);
      syncRef.current = () => {};
      recenterRef.current = () => {};
      setMini(null);
      map.setTarget(undefined);
      map.dispose();
    };
  }, [host, mapContext?.mapInstanceRef, mapContext?.mapReady]);

  useEffect(() => {
    if (!mini) return;
    syncRef.current();
  }, [mini, listTick, file?.id]);

  useEffect(() => {
    if (!mini) return;
    recenterRef.current();
  }, [mini, shotKey]);

  useBackgroundLayer(mini, bgId || 'aerial-2022');

  useEffect(() => {
    mini?.updateSize();
  }, [mini, box.width, box.height]);

  return (
    <div
      ref={setFrame}
      className="pointer-events-none absolute z-30"
      style={{ left: 16, bottom: 16 }}
    >
      <div
        className="pointer-events-auto overflow-hidden rounded-lg border-2 border-slate-500 shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="relative overflow-hidden rounded-md" style={{ width: box.width, height: box.height }}>
          <div
            ref={setHost}
            className="h-full w-full [&_.ol-attribution]:hidden [&_.ol-rotate]:hidden [&_.ol-viewport]:bg-slate-900 [&_.ol-zoom]:hidden"
          />
        </div>
      </div>
    </div>
  );
}
