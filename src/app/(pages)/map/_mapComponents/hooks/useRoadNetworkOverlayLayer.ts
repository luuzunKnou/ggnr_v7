'use client';

import { useEffect, useRef } from 'react';
import '../config/projections';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { Style, Stroke, Circle as CircleStyle, Fill, Text } from 'ol/style';
import { transform } from 'ol/proj';
import type { FeatureLike } from 'ol/Feature';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import { useMapContext } from '../MapContext';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import type { RoadNetworkType } from '@/app/(pages)/map/_mapContents/road/roadNetwork/roadNetworkMock';

export const ROAD_NETWORK_OVERLAY_LAYER_KEY = 'roadNetworkOverlay';
export const ROAD_NETWORK_FEATURE_ID_PROP = 'roadNetworkId';
export const ROAD_NETWORK_POINT_LAYER_KEY = 'roadNetworkSitePoints';

const TYPE_STROKE: Record<RoadNetworkType, string> = {
  국도: '#1d4ed8',
  지방도: '#0284c7',
  국지도: '#4f46e5',
  군도: '#059669',
  농도: '#d97706',
  일반도로: '#475569',
  임도: '#65a30d',
  입체교차로: '#7c3aed',
};

function strokeForFeature(f: FeatureLike): Style {
  const type = String(f.get('roadType') ?? '') as RoadNetworkType;
  const openStatus = f.get('openStatus');
  const color = TYPE_STROKE[type] ?? '#64748b';
  const width = openStatus === '미개설' ? 2.5 : 3.5;
  const lineDash = openStatus === '미개설' ? [8, 6] : undefined;
  return new Style({
    stroke: new Stroke({ color, width, lineDash }),
  });
}

function sitePointStyle(kind: string, focused: boolean): Style {
  if (kind === 'start' || kind === 'end') {
    const fill = kind === 'start' ? '#059669' : '#c2410c';
    const label = kind === 'start' ? '기점' : '종점';
    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: fill }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
      text: new Text({
        text: label,
        offsetY: -14,
        font: '600 11px sans-serif',
        fill: new Fill({ color: fill }),
        stroke: new Stroke({ color: '#fff', width: 3 }),
      }),
    });
  }
  const fill = kind === 'comp' ? '#ea580c' : '#2563eb';
  return new Style({
    image: new CircleStyle({
      radius: focused ? 10 : 7,
      fill: new Fill({ color: fill }),
      stroke: new Stroke({ color: '#fff', width: focused ? 3 : 2 }),
    }),
  });
}

/** 도로망도 패널 열림 시 필터 결과 항시 표시 + 현장 점 + 클릭 선택/점찍기 */
export function useRoadNetworkOverlayLayer(mapReady: boolean) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pointLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pointSourceRef = useRef<VectorSource | null>(null);
  const panelOpenRef = useRef(false);
  const setSelectedIdRef = useRef(mapContext?.setRoadNetworkSelectedId);
  const pointPickRef = useRef(mapContext?.roadNetworkPointPickRef);
  const pointPickActiveRef = useRef(false);

  const panelOpen = mapContext?.roadNetworkPanelOpen ?? false;
  const rows = mapContext?.roadNetworkOverlayRows ?? [];
  const selectedId = mapContext?.roadNetworkSelectedId ?? null;
  const allRows = mapContext?.roadNetworkRows ?? [];
  const draftPoint = mapContext?.roadNetworkDraftSitePoint ?? null;
  const pointPickActive = mapContext?.roadNetworkPointPickActive ?? false;
  const sitePointKind = mapContext?.roadNetworkSitePointKind ?? null;
  const endpointMarkers = mapContext?.roadNetworkEndpointMarkers ?? null;
  const focusedSiteKey = mapContext?.roadNetworkFocusedSitePointKey ?? null;
  const focusedSiteKeyRef = useRef(focusedSiteKey);
  focusedSiteKeyRef.current = focusedSiteKey;

  panelOpenRef.current = panelOpen;
  setSelectedIdRef.current = mapContext?.setRoadNetworkSelectedId;
  pointPickRef.current = mapContext?.roadNetworkPointPickRef;
  pointPickActiveRef.current = pointPickActive;
  const didFitRef = useRef(false);

  useEffect(() => {
    if (!panelOpen) didFitRef.current = false;
  }, [panelOpen]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: strokeForFeature,
      zIndex: 1090,
    });
    layer.set(ROAD_NETWORK_OVERLAY_LAYER_KEY, true);
    map.getLayers().push(layer);
    layerRef.current = layer;

    const pointSource = new VectorSource();
    pointSourceRef.current = pointSource;
    const pointLayer = new VectorLayer({
      source: pointSource,
      style: (f) =>
        sitePointStyle(
          String(f.get('kind') ?? 'maint'),
          String(f.getId() ?? '') === focusedSiteKeyRef.current
        ),
      zIndex: 1095,
    });
    pointLayer.set(ROAD_NETWORK_POINT_LAYER_KEY, true);
    map.getLayers().push(pointLayer);
    pointLayerRef.current = pointLayer;

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!panelOpenRef.current) return;

      const pickCb = pointPickRef.current?.current;
      if (pointPickActiveRef.current && pickCb) {
        const [lon, lat] = transform(evt.coordinate, 'EPSG:3857', 'EPSG:4326');
        pickCb(lon, lat);
        evt.stopPropagation();
        return;
      }

      const hit = map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          const id = feature.get(ROAD_NETWORK_FEATURE_ID_PROP);
          return typeof id === 'string' && id ? id : undefined;
        },
        { hitTolerance: 10 }
      );
      if (hit) {
        evt.stopPropagation();
        setSelectedIdRef.current?.(hit);
      }
    };

    const key = map.on('singleclick', onClick as never);

    return () => {
      unByKey(key);
      map.removeLayer(layer);
      map.removeLayer(pointLayer);
      layerRef.current = null;
      sourceRef.current = null;
      pointLayerRef.current = null;
      pointSourceRef.current = null;
    };
  }, [mapReady, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const el = map?.getTargetElement?.();
    if (!el) return;
    if (panelOpen && pointPickActive) {
      el.style.cursor = 'crosshair';
      return () => {
        el.style.cursor = '';
      };
    }
    el.style.cursor = '';
  }, [panelOpen, pointPickActive, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const layer = layerRef.current;
    const source = sourceRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!layer || !source || !map) return;

    layer.setVisible(panelOpen);
    source.clear();
    if (!panelOpen || rows.length === 0) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const format = new GeoJSONFormat();
    const features = rows.flatMap((row) => {
      if (!row.geom) return [];
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: row.geom,
            properties: {
              [ROAD_NETWORK_FEATURE_ID_PROP]: row.id,
              roadType: row.roadType,
              openStatus: row.openStatus,
            },
          },
        ],
      };
      const read = format.readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: viewProj,
      });
      for (const f of read) {
        f.set(ROAD_NETWORK_FEATURE_ID_PROP, row.id);
        f.set('roadType', row.roadType);
        f.set('openStatus', row.openStatus);
      }
      return read;
    });
    source.addFeatures(features);

    if (!didFitRef.current && features.length > 0) {
      try {
        const extent = source.getExtent();
        if (extent && extent.every((v) => Number.isFinite(v))) {
          map.getView().fit(extent, {
            padding: [80, 80, 80, 320],
            maxZoom: 13,
            duration: 350,
          });
          didFitRef.current = true;
        }
      } catch {
        /* ignore */
      }
    }
  }, [panelOpen, rows, mapContext?.mapInstanceRef, mapReady]);

  useEffect(() => {
    const pointLayer = pointLayerRef.current;
    const pointSource = pointSourceRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!pointLayer || !pointSource || !map) return;

    const points: { lon: number; lat: number; kind: string; key: string }[] = [];

    if (endpointMarkers?.start) {
      points.push({
        lon: endpointMarkers.start.lon,
        lat: endpointMarkers.start.lat,
        kind: 'start',
        key: 'endpoint-start',
      });
    }
    if (endpointMarkers?.end) {
      points.push({
        lon: endpointMarkers.end.lon,
        lat: endpointMarkers.end.lat,
        kind: 'end',
        key: 'endpoint-end',
      });
    }

    /** 편집 중 드래프트가 있으면 해당 항목 저장 점은 숨기고 드래프트로 대체(같은 키로 강조) */
    const editingKey = draftPoint ? focusedSiteKeyRef.current : null;

    if (sitePointKind && selectedId) {
      const selected = allRows.find((r) => r.id === selectedId);
      if (selected) {
        if (sitePointKind === 'maint') {
          for (const m of selected.maintenance ?? []) {
            if (!m.point) continue;
            const key = `m-${m.id}`;
            if (editingKey && key === editingKey) continue;
            points.push({
              lon: m.point.lon,
              lat: m.point.lat,
              kind: 'maint',
              key,
            });
          }
        } else {
          for (const c of selected.complaints ?? []) {
            if (!c.point) continue;
            const key = `c-${c.id}`;
            if (editingKey && key === editingKey) continue;
            points.push({
              lon: c.point.lon,
              lat: c.point.lat,
              kind: 'comp',
              key,
            });
          }
        }
      }
    }

    /** 유지보수·민원 점찍기 초안만 여기 반영(기점·종점은 endpointMarkers) */
    if (draftPoint && sitePointKind) {
      points.push({
        lon: draftPoint.lon,
        lat: draftPoint.lat,
        kind: sitePointKind === 'comp' ? 'comp' : 'maint',
        key: editingKey || 'draft',
      });
    }

    const showPoints = panelOpen && points.length > 0;
    pointLayer.setVisible(showPoints);
    pointSource.clear();
    if (!showPoints) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    for (const p of points) {
      const coord = transform([p.lon, p.lat], 'EPSG:4326', viewProj);
      const f = new Feature({ geometry: new Point(coord) });
      f.set('kind', p.kind);
      f.setId(p.key);
      pointSource.addFeature(f);
    }
    pointLayer.changed();
  }, [
    panelOpen,
    selectedId,
    allRows,
    draftPoint,
    sitePointKind,
    endpointMarkers,
    focusedSiteKey,
    mapContext?.mapInstanceRef,
    mapReady,
  ]);
}
