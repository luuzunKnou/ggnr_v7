'use client';

import '@/app/(pages)/map/_mapComponents/config/projections';
import { useEffect, useMemo, useRef, useState } from 'react';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { getTransform } from 'ol/proj';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style';
import { boundingExtent } from 'ol/extent';
import { useMapContext } from '../../_mapComponents/MapContext';
import type { AerialKind, WorkUnitItem } from './aerialMediaTypes';
import { mockUnitsForKind, subscribeMockWorkUnits } from './aerialMediaMockData';
import { collectFileLocations5181 } from './aerialLocationParse';

const LAYER_ID = 'aerial-view-checked-units';
const to3857 = getTransform('EPSG:5181', 'EPSG:3857');

const ALL_KINDS: AerialKind[] = ['ortho', 'drone', 'panorama', 'satellite'];

function markerStyle() {
  return new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({ color: 'rgba(14, 165, 233, 0.9)' }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
  });
}

function allStoreUnits(): WorkUnitItem[] {
  return ALL_KINDS.flatMap((k) => mockUnitsForKind(k));
}

/**
 * 영상조회 패널에서 체크한 작업단위의 촬영 위치를 지도에 표시.
 * (드론영상 ortho 타일은 useAerialOrthoCheckedTiles 다중 단위 모드)
 */
export function useAerialViewCheckedMarkers(params: {
  enabled: boolean;
  checkedUnitIds: Set<string>;
}) {
  const { enabled, checkedUnitIds } = params;
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const lastKeyRef = useRef<string>('');
  const [listTick, setListTick] = useState(0);

  useEffect(() => subscribeMockWorkUnits(() => setListTick((t) => t + 1)), []);

  const checkedKey = useMemo(
    () => `${Array.from(checkedUnitIds).sort().join(',')}|${listTick}`,
    [checkedUnitIds, listTick]
  );

  useEffect(() => {
    if (!enabled) {
      const m = mapContext?.mapInstanceRef?.current;
      const layer = layerRef.current;
      if (m && layer) m.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
      lastKeyRef.current = '';
      return;
    }
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    if (!sourceRef.current) {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source,
        properties: { id: LAYER_ID },
        zIndex: 9500,
        style: markerStyle,
      });
      map.addLayer(layer);
      sourceRef.current = source;
      layerRef.current = layer;
    }

    return () => {
      const m = mapContext?.mapInstanceRef?.current;
      const layer = layerRef.current;
      if (m && layer) m.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
      lastKeyRef.current = '';
    };
  }, [enabled, mapContext?.mapInstanceRef]);

  useEffect(() => {
    if (!enabled) return;
    const source = sourceRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!source || !map) return;
    if (checkedKey === lastKeyRef.current) return;
    lastKeyRef.current = checkedKey;

    source.clear();
    const units = allStoreUnits().filter((u) => checkedUnitIds.has(u.id));
    const coords3857: number[][] = [];

    for (const unit of units) {
      if (unit.kind === 'satellite' || unit.kind === 'ortho') continue;
      const locs = collectFileLocations5181(unit.files);
      for (const loc of locs) {
        const [x, y] = to3857(loc.coord, undefined, undefined);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        coords3857.push([x, y]);
        source.addFeature(
          new Feature({
            geometry: new Point([x, y]),
            unitId: unit.id,
            fileId: loc.fileId,
          })
        );
      }
    }

    if (coords3857.length === 0) return;
    if (coords3857.length === 1) {
      map.getView().animate({ center: coords3857[0], duration: 350 });
      return;
    }
    const extent = boundingExtent(coords3857);
    map.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom: 17, duration: 350 });
  }, [enabled, checkedKey, checkedUnitIds, mapContext?.mapInstanceRef]);
}
