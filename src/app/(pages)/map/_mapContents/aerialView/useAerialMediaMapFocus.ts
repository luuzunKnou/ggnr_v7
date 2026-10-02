'use client';

import '@/app/(pages)/map/_mapComponents/config/projections';
import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { getTransform } from 'ol/proj';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style';
import type Map from 'ol/Map';
import { boundingExtent } from 'ol/extent';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight';
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { useMapContext } from '../../_mapComponents/MapContext';
import type { WorkUnitItem } from './aerialMediaTypes';
import { collectFileLocations5181 } from './aerialLocationParse';

const LAYER_ID = 'aerial-media-locations';
const HIGHLIGHT_LAYER_ID = 'aerial-media-location-highlight';
const to3857 = getTransform('EPSG:5181', 'EPSG:3857');

function defaultMarkerStyle() {
  return new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({ color: 'rgba(245, 158, 11, 0.9)' }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
  });
}

function moveMapToPoint(
  map: Map,
  center: [number, number],
  applyMapViewPadding?: (() => void) | null
) {
  const zoom = Math.max(map.getView().getZoom() ?? 15, 17);
  scheduleAnimateMapToCenter3857(map, center, zoom, {
    duration: 450,
    applyMapViewPadding,
  });
}

export type MediaPointPick = {
  unitId: string;
  fileId: string;
};

/**
 * 목록·선택 모두 촬영 위치 점은 유지.
 * 파일 선택 → 해당 지점으로 이동하고, 점 표시 위에 강조만 얹는다.
 * 점 클릭 → 해당 작업단위·파일 상세.
 */
export function useAerialMediaMapFocus(params: {
  enabled: boolean;
  unit: WorkUnitItem | null;
  selectedFileId: string | null;
  /** 목록만 볼 때 전체 작업단위의 촬영 위치 */
  listUnits?: WorkUnitItem[] | null;
  /** 같은 배열을 갈아끼워도 지도 점을 다시 그리게 하는 목록 갱신 번호 */
  listRevision?: number;
  onPick?: (hit: MediaPointPick) => void;
}) {
  const { enabled, unit, selectedFileId, listUnits = null, listRevision = 0, onPick } = params;
  const mapContext = useMapContext();
  const mapReady = Boolean(mapContext?.mapReady);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const highlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const highlightSourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
  const lastFitUnitIdRef = useRef<string | null>(null);
  const lastAllFitKeyRef = useRef<string | null>(null);
  const lastFlyFileIdRef = useRef<string | null>(null);
  const radarStyleFnRef = useRef(createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current));
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!enabled) {
      const map = mapContext?.mapInstanceRef?.current;
      for (const layer of [layerRef.current, highlightLayerRef.current]) {
        if (map && layer) map.removeLayer(layer);
      }
      layerRef.current = null;
      sourceRef.current = null;
      highlightLayerRef.current = null;
      highlightSourceRef.current = null;
      return;
    }
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    if (!sourceRef.current) {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source,
        properties: { id: LAYER_ID, geomStackSkip: true },
        zIndex: 9500,
        updateWhileAnimating: true,
        updateWhileInteracting: true,
        style: defaultMarkerStyle(),
      });
      map.addLayer(layer);
      sourceRef.current = source;
      layerRef.current = layer;
    }
    if (!highlightSourceRef.current) {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source,
        properties: { id: HIGHLIGHT_LAYER_ID, geomStackSkip: true },
        zIndex: 9600,
        updateWhileAnimating: true,
        updateWhileInteracting: true,
        style: (feat, resolution) => radarStyleFnRef.current(feat, resolution),
      });
      map.addLayer(layer);
      highlightSourceRef.current = source;
      highlightLayerRef.current = layer;
    }
    layerRef.current?.setVisible(true);

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!onPickRef.current || !layerRef.current) return;
      const hits = map.getFeaturesAtPixel(evt.pixel, {
        layerFilter: (candidate) => candidate === layerRef.current,
        hitTolerance: 8,
      }) as Feature[];
      const picked = hits.find((feat) => feat.get('unitId') && feat.get('fileId'));
      if (!picked) return;
      evt.stopPropagation();
      onPickRef.current({
        unitId: String(picked.get('unitId')),
        fileId: String(picked.get('fileId')),
      });
    };
    const onMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!layerRef.current) return;
      const hit = map.hasFeatureAtPixel(evt.pixel, {
        layerFilter: (candidate) => candidate === layerRef.current,
        hitTolerance: 8,
      });
      const el = map.getTargetElement();
      if (el) el.style.cursor = hit ? 'pointer' : '';
    };
    map.on('singleclick', onClick as never);
    map.on('pointermove', onMove as never);

    return () => {
      map.un('singleclick', onClick as never);
      map.un('pointermove', onMove as never);
      const el = map.getTargetElement();
      if (el) el.style.cursor = '';
    };
  }, [enabled, mapReady, mapContext?.mapInstanceRef]);

  useEffect(() => {
    return () => {
      const map = mapContext?.mapInstanceRef?.current;
      for (const layer of [layerRef.current, highlightLayerRef.current]) {
        if (map && layer) map.removeLayer(layer);
      }
      layerRef.current = null;
      sourceRef.current = null;
      highlightLayerRef.current = null;
      highlightSourceRef.current = null;
    };
  }, [mapContext?.mapInstanceRef]);

  /** 선택 포인트 레이더 펄스. 촬영 위치 레이어는 갱신하지 않는다. */
  useEffect(() => {
    if (!enabled || !selectedFileId) return;
    let rafId = 0;
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP;
      highlightSourceRef.current?.changed();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [enabled, selectedFileId]);

  /** 촬영 위치 점. 파일 선택과 무관하게 유지 */
  useEffect(() => {
    if (!enabled) return;
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    if (!map || !source) return;
    layerRef.current?.setVisible(true);

    const drawUnits = listUnits && listUnits.length > 0 ? listUnits : unit ? [unit] : [];
    const pointKey =
      drawUnits.length === 0
        ? ''
        : drawUnits
            .map((item) => {
              const locs = collectFileLocations5181(item.files);
              return `${item.id}:${locs.map((loc) => `${loc.fileId}@${loc.coord[0]},${loc.coord[1]}`).join(',')}`;
            })
            .join('|');
    if (source.getFeatures().length > 0 && lastAllFitKeyRef.current === pointKey) {
      layerRef.current?.setVisible(true);
      return;
    }

    source.clear();
    lastAllFitKeyRef.current = pointKey || null;
    if (drawUnits.length === 0) return;

    const coords3857: [number, number][] = [];
    for (const item of drawUnits) {
      for (const loc of collectFileLocations5181(item.files)) {
        const c = to3857(loc.coord, undefined, undefined) as [number, number];
        if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
        coords3857.push(c);
        source.addFeature(
          new Feature({
            geometry: new Point(c),
            fileId: loc.fileId,
            unitId: item.id,
          })
        );
      }
    }
    if (coords3857.length === 0 || unit) return;

    const applyPadding = () => mapContext?.applyMapViewPaddingRef?.current?.();
    if (coords3857.length === 1) {
      const only = coords3857[0];
      if (only) moveMapToPoint(map, only, applyPadding);
      return;
    }
    map.getView().fit(boundingExtent(coords3857), {
      duration: 450,
      maxZoom: 17,
      padding: [80, 80, 80, 80],
    });
  }, [enabled, listUnits, listRevision, unit, mapReady, mapContext?.mapInstanceRef]);

  /** 강조와 지도 이동만. 촬영 위치 점은 건드리지 않는다. */
  useEffect(() => {
    if (!enabled) return;
    const map = mapContext?.mapInstanceRef?.current;
    const highlight = highlightSourceRef.current;
    if (!map || !highlight) return;
    layerRef.current?.setVisible(true);
    highlight.clear();

    const applyPadding = () => mapContext?.applyMapViewPaddingRef?.current?.();
    const pool = listUnits && listUnits.length > 0 ? listUnits : unit ? [unit] : [];
    let selectedCoord: [number, number] | null = null;
    const unitCoords: [number, number][] = [];
    for (const item of pool) {
      const inUnit = Boolean(unit && item.id === unit.id);
      for (const loc of collectFileLocations5181(item.files)) {
        const c = to3857(loc.coord, undefined, undefined) as [number, number];
        if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
        if (inUnit) unitCoords.push(c);
        if (inUnit && loc.fileId === selectedFileId) selectedCoord = c;
      }
    }

    if (selectedCoord && selectedFileId) {
      highlight.addFeature(
        new Feature({
          geometry: new Point(selectedCoord),
          isRadarPoint: true,
        })
      );
      if (unit) lastFitUnitIdRef.current = unit.id;
      if (lastFlyFileIdRef.current !== selectedFileId) {
        lastFlyFileIdRef.current = selectedFileId;
        moveMapToPoint(map, selectedCoord, applyPadding);
      }
      return;
    }

    lastFlyFileIdRef.current = null;
    if (!unit || unitCoords.length === 0) {
      lastFitUnitIdRef.current = null;
      return;
    }
    if (lastFitUnitIdRef.current === unit.id) return;
    lastFitUnitIdRef.current = unit.id;
    const only = unitCoords[0];
    if (unitCoords.length === 1 && only) {
      moveMapToPoint(map, only, applyPadding);
      return;
    }
    map.getView().fit(boundingExtent(unitCoords), {
      duration: 450,
      maxZoom: 17,
      padding: [80, 80, 80, 80],
    });
  }, [enabled, unit, listUnits, listRevision, selectedFileId, mapReady, mapContext?.mapInstanceRef]);
}
