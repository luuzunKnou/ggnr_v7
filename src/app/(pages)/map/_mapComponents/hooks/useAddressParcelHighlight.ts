'use client';

import { useEffect, useRef } from 'react';
import '../config/projections'; // EPSG:5181 등 좌표계 등록
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Stroke, Fill } from 'ol/style';
import { call } from '@/lib/api';
import { useMapContext } from '../MapContext';
import type { AddressInfoDetailState } from '../MapContext';
import { transformCoordinate } from '../services/coordinateService';

function addHighlightFeatures(
  source: VectorSource,
  geometry4326: Record<string, unknown>,
  viewProjection: string
) {
  const geojson = {
    type: 'FeatureCollection' as const,
    features: [{ type: 'Feature' as const, geometry: geometry4326, properties: {} }],
  };
  const format = new GeoJSON();
  const olFeatures = format.readFeatures(geojson, {
    dataProjection: 'EPSG:4326',
    featureProjection: viewProjection || 'EPSG:3857',
  });
  source.clear();
  source.addFeatures(olFeatures);
  return olFeatures[0]?.getGeometry?.() ?? null;
}

/**
 * 주소정보 패널이 열려 있을 때 해당 필지를 지도 위에 하이라이트.
 * 로컬 jijuk → VWorld 연속지적 폴백 (V6 drawRightCoorLayer와 동일 목적).
 */
export function useAddressParcelHighlight(mapReady: boolean, addressInfoDetail: AddressInfoDetailState) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const addressParcelGeometryRef = mapContext?.addressParcelGeometryRef;
  const addressParcelSeedGeom4326Ref = mapContext?.addressParcelSeedGeom4326Ref;

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      style: new Style({
        fill: new Fill({ color: 'rgba(251, 146, 60, 0.4)' }),
        stroke: new Stroke({ color: 'rgb(234, 88, 12)', width: 3 }),
      }),
      zIndex: 999999,
    });
    layer.set('addressParcelHighlight', true);
    map.getLayers().push(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
      if (addressParcelGeometryRef) addressParcelGeometryRef.current = null;
    };
  }, [mapReady, mapContext?.mapInstanceRef, addressParcelGeometryRef]);

  const coordinate = addressInfoDetail?.coordinate;
  const viewProjection = addressInfoDetail?.viewProjection;
  const pnu = addressInfoDetail?.pnu;
  const geomSeedAt = addressInfoDetail?.geomSeedAt;

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    if (!map || !source) return;

    if (!coordinate || !viewProjection) {
      source.clear();
      if (addressParcelGeometryRef) addressParcelGeometryRef.current = null;
      if (addressParcelSeedGeom4326Ref) addressParcelSeedGeom4326Ref.current = null;
      return;
    }

    const seedGeom = addressParcelSeedGeom4326Ref?.current;
    if (seedGeom && typeof seedGeom === 'object') {
      const olGeom = addHighlightFeatures(source, seedGeom, viewProjection);
      layerRef.current?.setZIndex(999999);
      map.render();
      if (addressParcelGeometryRef && olGeom) {
        addressParcelGeometryRef.current = (
          olGeom as { clone(): import('ol/geom').Geometry }
        ).clone();
      }
    }

    let cancelled = false;
    const coord3857 = transformCoordinate(coordinate, viewProjection, 'EPSG:3857');
    const params: { x?: number; y?: number; pnu?: string } = {};
    if (coord3857) {
      params.x = coord3857[0];
      params.y = coord3857[1];
    }
    const pnuDigits = String(pnu ?? '').replace(/\D/g, '').slice(0, 19);
    if (pnuDigits) params.pnu = pnuDigits;

    call('', 'POST', {
      service: 'standardService',
      action: 'getParcelHighlightGeom',
      params,
    })
      .then((res: unknown) => {
        if (cancelled) return;
        const payload = (res as { data?: { pnu?: string; geometry4326?: Record<string, unknown> } })?.data ?? res;
        const body = payload as { pnu?: string; geometry4326?: Record<string, unknown> | null };
        const geometry4326 = body?.geometry4326;
        if (!geometry4326 || typeof geometry4326 !== 'object') {
          if (!seedGeom) {
            source.clear();
            if (addressParcelGeometryRef) addressParcelGeometryRef.current = null;
          }
          return;
        }
        const olGeom = addHighlightFeatures(source, geometry4326, viewProjection);
        layerRef.current?.setZIndex(999999);
        map.render();
        if (addressParcelGeometryRef && olGeom) {
          addressParcelGeometryRef.current = (
            olGeom as { clone(): import('ol/geom').Geometry }
          ).clone();
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (!seedGeom) {
          source.clear();
          if (addressParcelGeometryRef) addressParcelGeometryRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    addressParcelGeometryRef,
    addressParcelSeedGeom4326Ref,
    coordinate,
    mapContext?.mapInstanceRef,
    mapReady,
    pnu,
    geomSeedAt,
    viewProjection,
  ]);
}

/** 우클릭 지적 조회 직후 시드 도형 — getParcelHighlightGeom 응답 전 즉시 표시 */
export function parseParcelGeomField(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  let geom: unknown = value;
  if (typeof value === 'string') {
    try {
      geom = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return null;
  return geom as Record<string, unknown>;
}
