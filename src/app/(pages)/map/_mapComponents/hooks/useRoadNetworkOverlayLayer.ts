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
import { formatRoadNetworkListTitle } from '@/app/(pages)/map/_mapContents/road/roadNetwork/roadNetworkFormat';
import type { RoadNetworkRow } from '@/app/(pages)/map/_mapContents/road/roadNetwork/roadNetworkMock';

export const ROAD_NETWORK_LABEL_LAYER_KEY = 'roadNetworkLabels';
export const ROAD_NETWORK_POINT_LAYER_KEY = 'roadNetworkSitePoints';

const LABEL_PROP = 'roadNetworkLabel';
/** 이 줌 미만에서는 라벨 숨김(과밀 방지) */
const LABEL_MIN_ZOOM = 11;

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

function labelStyleForFeature(f: FeatureLike, selected: boolean): Style | undefined {
  const text = String(f.get(LABEL_PROP) ?? '').trim();
  if (!text) return undefined;
  return new Style({
    text: new Text({
      text,
      font: selected ? '700 12px sans-serif' : '600 11px sans-serif',
      fill: new Fill({ color: selected ? '#0f172a' : '#334155' }),
      stroke: new Stroke({ color: 'rgba(255,255,255,0.95)', width: selected ? 4 : 3 }),
      placement: 'line',
      overflow: false,
      maxAngle: Math.PI / 5,
      padding: [2, 4, 2, 4],
    }),
  });
}

/**
 * 도로망도 — 배경 선은 GeoServer WMS.
 * 목록과 동일한 도로명 라벨 + 기·종점·현장 점 + 점찍기.
 */
export function useRoadNetworkOverlayLayer(mapReady: boolean) {
  const mapContext = useMapContext();
  const labelLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const labelSourceRef = useRef<VectorSource | null>(null);
  const pointLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const pointSourceRef = useRef<VectorSource | null>(null);
  const panelOpenRef = useRef(false);
  const pointPickRef = useRef(mapContext?.roadNetworkPointPickRef);
  const pointPickActiveRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);

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
  pointPickRef.current = mapContext?.roadNetworkPointPickRef;
  pointPickActiveRef.current = pointPickActive;
  selectedIdRef.current = selectedId;

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const labelSource = new VectorSource();
    labelSourceRef.current = labelSource;
    const labelLayer = new VectorLayer({
      source: labelSource,
      declutter: true,
      style: (f) => {
        const zoom = map.getView().getZoom() ?? 0;
        if (zoom < LABEL_MIN_ZOOM) return undefined;
        const id = String(f.getId() ?? '');
        return labelStyleForFeature(f, id === selectedIdRef.current);
      },
      // 선택 하이라이트(1101)보다 위 — 라벨이 펄스에 가려지지 않게
      zIndex: 1103,
      updateWhileAnimating: false,
      updateWhileInteracting: false,
    });
    labelLayer.set(ROAD_NETWORK_LABEL_LAYER_KEY, true);
    map.getLayers().push(labelLayer);
    labelLayerRef.current = labelLayer;

    const onZoom = () => {
      labelLayer.changed();
    };
    const zoomKey = map.getView().on('change:resolution', onZoom);

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
      }
    };

    const key = map.on('singleclick', onClick as never);

    return () => {
      unByKey(key);
      unByKey(zoomKey);
      map.removeLayer(labelLayer);
      map.removeLayer(pointLayer);
      labelLayerRef.current = null;
      labelSourceRef.current = null;
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

  /** 목록과 동일 제목의 라인 라벨 */
  useEffect(() => {
    const layer = labelLayerRef.current;
    const source = labelSourceRef.current;
    const map = mapContext?.mapInstanceRef?.current;
    if (!layer || !source || !map) return;

    layer.setVisible(panelOpen);
    source.clear();
    if (!panelOpen || rows.length === 0) {
      layer.changed();
      return;
    }

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const format = new GeoJSONFormat();
    const features = rows.flatMap((row: RoadNetworkRow) => {
      if (!row.geom) return [];
      const title = formatRoadNetworkListTitle(row).trim();
      if (!title) return [];
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            id: row.id,
            geometry: row.geom,
            properties: { [LABEL_PROP]: title },
          },
        ],
      };
      const read = format.readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: viewProj,
      });
      for (const f of read) {
        f.setId(row.id);
        f.set(LABEL_PROP, title);
      }
      return read;
    });
    source.addFeatures(features);
    layer.changed();
  }, [panelOpen, rows, mapContext?.mapInstanceRef, mapReady]);

  useEffect(() => {
    labelLayerRef.current?.changed();
  }, [selectedId]);

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
