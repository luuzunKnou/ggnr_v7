'use client';

import { useEffect, useRef } from 'react';
import '../config/projections'; // EPSG:5181 등 좌표계 등록
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Stroke, Fill } from 'ol/style';
import { call } from '@/lib/api';
import type { Map } from 'ol';
import { useMapContext } from '../MapContext';
import type { AddressInfoDetailState } from '../MapContext';
import { transformCoordinate } from '../services/coordinateService';

/** jijuk 테이블의 geom 필드로 필지 하이라이트 */
function getGeomFromJijukRow(row: Record<string, unknown>): unknown {
  const g = row?.geom;
  if (g == null) return null;
  let geom: unknown = g;
  if (typeof g === 'string') {
    try {
      geom = JSON.parse(g) as unknown;
    } catch {
      return null;
    }
  }
  if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return null;
  return geom;
}

/**
 * 주소정보 패널이 열려 있을 때 해당 좌표의 필지(지적도)를 identify하여
 * 지도 위에 하이라이트 벡터 레이어로 표시.
 */
export function useAddressParcelHighlight(
  map: Map | null,
  mapReady: boolean,
  addressInfoDetail: AddressInfoDetailState
) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);

  useEffect(() => {
    if (!mapReady || !map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      style: new Style({
        fill: new Fill({ color: 'rgba(251, 146, 60, 0.4)' }),
        stroke: new Stroke({ color: 'rgb(234, 88, 12)', width: 3 }),
      }),
      zIndex: 1000,
    });
    layer.set('addressParcelHighlight', true);
    map.getLayers().push(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
    };
  }, [map, mapReady]);

  // 좌표/뷰만 의존: 주소 로딩 완료 시 객체만 바뀌어도 identify를 다시 호출하지 않음 (한 번 우클릭 시 1회만 요청)
  const coordinate = addressInfoDetail?.coordinate;
  const viewProjection = addressInfoDetail?.viewProjection;

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;

    source.clear();
    if (mapContext?.addressParcelGeometryRef) mapContext.addressParcelGeometryRef.current = null;
    if (!coordinate || !viewProjection) return;

    const coord3857 = transformCoordinate(coordinate, viewProjection, 'EPSG:3857');
    if (!coord3857) return;

    const [x, y] = coord3857;

    call('', 'POST', {
      service: 'standardService',
      action: 'getJijukParcelAtPoint',
      params: { x, y },
    })
      .then((res: unknown) => {
        const payload = res as { data?: { results?: { features: { data: Record<string, unknown> }[] }[] }; results?: { features: { data: Record<string, unknown> }[] }[] };
        const data = payload?.data ?? payload;
        const results = Array.isArray(data?.results) ? data.results : [];
        const jijukResult = results.find((r: { tableName?: string; features?: { data: Record<string, unknown> }[] }) => r?.tableName === 'jijuk');
        if (!jijukResult) return;
        const firstFeature = jijukResult?.features?.[0]?.data;
        if (!firstFeature || typeof firstFeature !== 'object') return;
        const geom = getGeomFromJijukRow(firstFeature as Record<string, unknown>);
        if (!geom) return;
        const geojson = {
          type: 'FeatureCollection' as const,
          features: [{ type: 'Feature' as const, geometry: geom, properties: {} }],
        };
        const format = new GeoJSON();
        const viewProj = viewProjection || 'EPSG:3857';
        // DB(jijuk)는 5181 저장, API는 ST_Transform(..., 4326)으로 4326 반환 → 수신 geom은 4326. 지도 뷰는 3857.
        const olFeatures = format.readFeatures(geojson, {
          dataProjection: 'EPSG:4326',
          featureProjection: viewProj,
        });
        source.clear();
        source.addFeatures(olFeatures);
        const olGeom = olFeatures[0]?.getGeometry?.();
        if (mapContext?.addressParcelGeometryRef && olGeom)
          mapContext.addressParcelGeometryRef.current = (olGeom as { clone(): import('ol/geom').Geometry }).clone();
      })
      .catch(() => {
        source.clear();
        if (mapContext?.addressParcelGeometryRef) mapContext.addressParcelGeometryRef.current = null;
      });
  }, [coordinate, viewProjection]);
}
