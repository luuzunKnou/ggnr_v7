'use client';

import '@/app/(pages)/map/_mapComponents/config/projections';
import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { getTransform } from 'ol/proj';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style';
import { boundingExtent } from 'ol/extent';
import { useMapContext } from '../../_mapComponents/MapContext';
import type { WorkUnitItem } from './aerialMediaTypes';
import { collectFileLocations5181 } from './aerialLocationParse';

const LAYER_ID = 'aerial-media-locations';
const to3857 = getTransform('EPSG:5181', 'EPSG:3857');

function markerStyle(selected: boolean) {
  return new Style({
    image: new CircleStyle({
      radius: selected ? 9 : 7,
      fill: new Fill({
        color: selected ? 'rgba(14, 165, 233, 0.95)' : 'rgba(245, 158, 11, 0.9)',
      }),
      stroke: new Stroke({ color: '#fff', width: selected ? 2.5 : 2 }),
    }),
  });
}

/**
 * 작업단위 선택 → 파일 좌표 전부 보이게 fit.
 * 파일 선택 → 해당 좌표로 이동·강조.
 * (항공영상·좌표 없는 단위는 호출측에서 enabled=false)
 */
export function useAerialMediaMapFocus(params: {
  enabled: boolean;
  unit: WorkUnitItem | null;
  selectedFileId: string | null;
}) {
  const { enabled, unit, selectedFileId } = params;
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const lastFitUnitIdRef = useRef<string | null>(null);
  const lastFlyFileIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    if (!sourceRef.current) {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source,
        properties: { id: LAYER_ID },
        zIndex: 9500,
        style: (feat) =>
          markerStyle(Boolean(feat.get('selected'))),
      });
      map.addLayer(layer);
      sourceRef.current = source;
      layerRef.current = layer;
    }

    return () => {
      const m = mapContext?.mapInstanceRef?.current;
      const layer = layerRef.current;
      if (m && layer) {
        m.removeLayer(layer);
      }
      layerRef.current = null;
      sourceRef.current = null;
      lastFitUnitIdRef.current = null;
      lastFlyFileIdRef.current = null;
    };
  }, [enabled, mapContext?.mapInstanceRef]);

  useEffect(() => {
    if (!enabled) return;
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    if (!map || !source) return;

    source.clear();

    if (!unit) {
      lastFitUnitIdRef.current = null;
      lastFlyFileIdRef.current = null;
      return;
    }

    const locations = collectFileLocations5181(unit.files);
    if (locations.length === 0) return;

    const coords3857: [number, number][] = [];
    for (const loc of locations) {
      const c = to3857(loc.coord, undefined, undefined) as [number, number];
      coords3857.push(c);
      const f = new Feature({
        geometry: new Point(c),
        fileId: loc.fileId,
        selected: loc.fileId === selectedFileId,
      });
      source.addFeature(f);
    }

    const view = map.getView();

    // 파일 선택: 해당 좌표로 이동
    if (selectedFileId) {
      const hit = locations.find((l) => l.fileId === selectedFileId);
      if (hit && lastFlyFileIdRef.current !== selectedFileId) {
        lastFlyFileIdRef.current = selectedFileId;
        const c = to3857(hit.coord, undefined, undefined) as [number, number];
        const z = view.getZoom() ?? 15;
        view.animate({
          center: c,
          zoom: Math.max(z, 16),
          duration: 400,
        });
      }
      return;
    }

    // 작업단위만 선택: 전체 파일이 보이도록 fit (같은 단위 재클릭은 스킵)
    if (lastFitUnitIdRef.current === unit.id) return;
    lastFitUnitIdRef.current = unit.id;
    lastFlyFileIdRef.current = null;

    if (coords3857.length === 1) {
      view.animate({
        center: coords3857[0],
        zoom: Math.max(view.getZoom() ?? 15, 16),
        duration: 400,
      });
      return;
    }

    const extent = boundingExtent(coords3857);
    view.fit(extent, {
      duration: 450,
      maxZoom: 18,
      padding: [48, 48, 48, 48],
    });
  }, [enabled, unit, selectedFileId, mapContext?.mapInstanceRef]);
}
