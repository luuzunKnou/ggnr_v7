'use client';

import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Modify from 'ol/interaction/Modify';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { transform } from 'ol/proj';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { useMapContext } from '../MapContext';

const PICK_LAYER_KEY = 'roadFrontageMarkerPointPick';
const DRAFT_FEATURE_ID = 'draft';
const CURSOR_FEATURE_ID = 'cursor';

/** 표주 하이라이트·메모 점찍기와 동일 계열 */
const styleDraft = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.9)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});

const styleCursor = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.45)' }),
    stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.85)', width: 1.5 }),
  }),
});

/**
 * 접도구역 표주 — 모달 편집 중 지도 점 찍기(커서 미리보기 점·드래그 이동).
 */
export function useRoadFrontageMarkerPointPickLayer(mapReady: boolean) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const modifyRef = useRef<Modify | null>(null);
  const pointPickRef = useRef(mapContext?.roadFrontageMarkerPointPickRef);
  const pointPickActiveRef = useRef(false);
  const panelOpenRef = useRef(false);
  const draftPointRef = useRef<{ lon: number; lat: number } | null>(null);

  const panelOpen = mapContext?.roadFrontageMarkerPanelOpen ?? false;
  const pointPickActive = mapContext?.roadFrontageMarkerPointPickActive ?? false;
  const draftPoint = mapContext?.roadFrontageMarkerDraftPoint ?? null;

  panelOpenRef.current = panelOpen;
  pointPickRef.current = mapContext?.roadFrontageMarkerPointPickRef;
  pointPickActiveRef.current = pointPickActive;
  draftPointRef.current = draftPoint;

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      zIndex: 1102,
      properties: { [PICK_LAYER_KEY]: true },
      style: (f) => (f.getId() === CURSOR_FEATURE_ID ? styleCursor : styleDraft),
    });
    map.addLayer(layer);
    layerRef.current = layer;

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!panelOpenRef.current || !pointPickActiveRef.current) return;
      const pickCb = pointPickRef.current?.current;
      if (!pickCb) return;
      const [lon, lat] = transform(evt.coordinate, 'EPSG:3857', 'EPSG:4326');
      pickCb(lon, lat);
      evt.stopPropagation();
    };

    const onPointerMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!panelOpenRef.current || !pointPickActiveRef.current) return;
      const src = sourceRef.current;
      if (!src) return;
      const hasDraft = draftPointRef.current != null;
      const cursor = src.getFeatureById(CURSOR_FEATURE_ID);
      if (hasDraft) {
        if (cursor) src.removeFeature(cursor);
        return;
      }
      if (!cursor) {
        const next = new Feature({ geometry: new Point(evt.coordinate) });
        next.setId(CURSOR_FEATURE_ID);
        src.addFeature(next);
      } else {
        const geom = cursor.getGeometry();
        if (geom instanceof Point) geom.setCoordinates(evt.coordinate);
      }
      layerRef.current?.changed();
    };

    const clickKey = map.on('singleclick', onClick as never);
    const moveKey = map.on('pointermove', onPointerMove as never);

    return () => {
      unByKey(clickKey);
      unByKey(moveKey);
      if (modifyRef.current) {
        map.removeInteraction(modifyRef.current);
        modifyRef.current = null;
      }
      map.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
    };
  }, [mapReady, mapContext?.mapInstanceRef]);

  /** 드래프트·커서 미리보기 점 + Modify(드래그 이동) */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    const layer = layerRef.current;
    if (!map || !source || !layer) return;

    source.getFeatures().forEach((f) => {
      if (f.getId() === DRAFT_FEATURE_ID) source.removeFeature(f);
    });

    if (modifyRef.current) {
      map.removeInteraction(modifyRef.current);
      modifyRef.current = null;
    }

    const show = panelOpen && pointPickActive;
    layer.setVisible(show);
    if (!show) {
      const cursor = source.getFeatureById(CURSOR_FEATURE_ID);
      if (cursor) source.removeFeature(cursor);
      return;
    }

    if (
      draftPoint &&
      Number.isFinite(draftPoint.lon) &&
      Number.isFinite(draftPoint.lat)
    ) {
      const coord = transform([draftPoint.lon, draftPoint.lat], 'EPSG:4326', 'EPSG:3857');
      const draft = new Feature({ geometry: new Point(coord) });
      draft.setId(DRAFT_FEATURE_ID);
      source.addFeature(draft);

      const modify = new Modify({
        source,
        hitDetection: layer,
        insertVertexCondition: () => false,
        filter: (f) => f.getId() === DRAFT_FEATURE_ID,
      });
      modify.on('modifyend', (evt) => {
        const features = evt.features.getArray();
        const f = features.find((x) => x.getId() === DRAFT_FEATURE_ID);
        const geom = f?.getGeometry();
        if (!(geom instanceof Point)) return;
        const [lon, lat] = transform(geom.getCoordinates(), 'EPSG:3857', 'EPSG:4326');
        const pickCb = pointPickRef.current?.current;
        if (pickCb) pickCb(lon, lat);
      });
      map.addInteraction(modify);
      modifyRef.current = modify;
    }

    layer.changed();
  }, [panelOpen, pointPickActive, draftPoint, mapContext?.mapInstanceRef]);
}
