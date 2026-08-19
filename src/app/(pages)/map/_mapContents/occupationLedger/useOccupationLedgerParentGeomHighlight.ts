'use client';

import { useEffect, useRef } from 'react';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Stroke, Fill } from 'ol/style';
import { call } from '@/lib/api';
import {
  occupationFillRgba,
  occupationStrokeRgba,
} from '@/lib/occupationLayerStyle';
import { useMapContext } from '../../_mapComponents/MapContext';
import { LAYER_ROW_NEW_ID } from '../../_mapComponents/layerRowEdit';

/** 목록·상세 선택 시 본표 강조 — 기존 빨간 표시 */
const PARENT_GEOM_STYLE = new Style({
  stroke: new Stroke({ color: occupationStrokeRgba('parentActive'), width: 2.5 }),
  fill: new Fill({ color: occupationFillRgba('parentActive') }),
});

/** 상세 조회 — 점용(부모) 도형 활성 표시 (하천점용과 동일) */
export function useOccupationLedgerParentGeomHighlight(
  detailId: string,
  tableName: string,
  keyField: string,
  active: boolean,
  isEditing: boolean,
  reloadToken = 0
) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const parentExtentRef = useRef<[number, number, number, number] | null>(null);
  const lastKeyRef = useRef('');

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: PARENT_GEOM_STYLE,
      zIndex: 910,
    });
    layer.set('occupationLedgerParentGeomHighlight', true);
    map.addLayer(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
      parentExtentRef.current = null;
    };
  }, [mapContext?.mapInstanceRef]);

  useEffect(() => {
    const source = layerRef.current?.getSource();
    if (!source) return;

    source.clear();

    const key = String(detailId ?? '').trim();
    const table = String(tableName ?? '').trim();
    const kf = String(keyField ?? '').trim() || 'ogc_fid';
    if (!key || key === LAYER_ROW_NEW_ID || !table) {
      parentExtentRef.current = null;
      return;
    }
    if (lastKeyRef.current !== `${table}:${kf}:${key}`) {
      lastKeyRef.current = `${table}:${kf}:${key}`;
      parentExtentRef.current = null;
    }

    const showFeatures = active && !isEditing;
    let cancelled = false;
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'layerRowService',
          action: 'getTableRowGeomGeoJson3857',
          params: {
            table,
            schema: 'layer',
            keyField: kf,
            keyValue: key,
          },
        });
        if (cancelled) return;
        const data = res?.data ?? res;
        const geometry = data?.geometry;
        if (!geometry || typeof geometry !== 'object') return;

        const format = new GeoJSON();
        const features = format.readFeatures(
          { type: 'Feature', geometry, properties: {} },
          { dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' }
        );
        if (cancelled || features.length === 0) return;
        const ext = features[0]?.getGeometry()?.getExtent();
        if (ext && ext.length === 4 && ext.every((v) => Number.isFinite(v))) {
          parentExtentRef.current = ext as [number, number, number, number];
        }
        if (!showFeatures) return;
        source.clear();
        source.addFeatures(features);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, detailId, isEditing, keyField, reloadToken, tableName]);

  return { parentExtentRef };
}
