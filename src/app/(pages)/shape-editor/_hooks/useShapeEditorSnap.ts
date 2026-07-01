'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { Map as OLMap } from 'ol';
import type { EventsKey } from 'ol/events';
import GeoJSON from 'ol/format/GeoJSON';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { unByKey } from 'ol/Observable';
import { fetchWfsGeoJsonByBbox } from '@/lib/geoserverWfs';
import type { ShapeEditorLayerItem } from '../types';

const SNAP_LAYER_Z = 800;
const SNAP_DEBOUNCE_MS = 350;
const WFS_MAX_FEATURES = 3000;
const BBOX_BUFFER_RATIO = 0.08;

function bufferedExtent(extent: number[]): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = extent;
  const dx = (maxX - minX) * BBOX_BUFFER_RATIO;
  const dy = (maxY - minY) * BBOX_BUFFER_RATIO;
  return [minX - dx, minY - dy, maxX + dx, maxY + dy];
}

/**
 * WFS 벡터(투명) 로드 — Snap 인터랙션은 Draw/Modify 직후 Engine에서 붙임
 */
export function useShapeEditorSnap(
  map: OLMap,
  snapLayer: ShapeEditorLayerItem | null
): RefObject<VectorSource | null> {
  const snapSourceRef = useRef<VectorSource | null>(null);
  const fetchSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      opacity: 0,
      visible: true,
      zIndex: SNAP_LAYER_Z,
    });
    layer.set('shapeEditorSnapLayer', true);
    snapSourceRef.current = source;
    map.addLayer(layer);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      map.removeLayer(layer);
      source.clear();
      snapSourceRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const source = snapSourceRef.current;
    if (!source) return;

    if (!snapLayer) {
      fetchSeqRef.current += 1;
      source.clear();
      return;
    }

    const loadSnapFeatures = async () => {
      const seq = ++fetchSeqRef.current;
      const extent = map.getView().calculateExtent(map.getSize());
      const json = await fetchWfsGeoJsonByBbox({
        layerName: snapLayer.tableName,
        bbox: bufferedExtent(extent),
        srsName: 'EPSG:3857',
        maxFeatures: WFS_MAX_FEATURES,
      });
      if (seq !== fetchSeqRef.current || !snapSourceRef.current) return;
      source.clear();
      if (!json?.features?.length) return;
      const format = new GeoJSON();
      const features = format.readFeatures(json, {
        dataProjection: 'EPSG:3857',
        featureProjection: 'EPSG:3857',
      });
      source.addFeatures(features);
    };

    const scheduleLoad = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        void loadSnapFeatures();
      }, SNAP_DEBOUNCE_MS);
    };

    scheduleLoad();
    const moveKey = map.on('moveend', scheduleLoad) as EventsKey;

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      unByKey(moveKey);
      fetchSeqRef.current += 1;
      source.clear();
    };
  }, [map, snapLayer?.id, snapLayer?.tableName]);

  return snapSourceRef;
}
