'use client';

import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import WKT from 'ol/format/WKT';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { call } from '@/lib/api';
import { useMapContext } from '../../_mapComponents/MapContext';

/** 지적 편집(900)보다 아래, 배경 위 — 경계는 참고 표시용 */
const BOUNDARY_LAYER_Z = 850;

const boundaryStyle = new Style({
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.9)', width: 2.5, lineDash: [6, 4] }),
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.05)' }),
});

/**
 * 필지분석 진입 시 사업 시군구(읍면동 union) 경계를 지도에 표시.
 * 좌측 패널 없이 영역을 지정하는 단계에서 대상 지역을 눈으로 확인하기 위한 참고 레이어.
 * 필지분석 종료 시 레이어를 제거한다.
 */
export function useParcelAnalysisSigunguBoundary(active: boolean) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !active) return;

    let cancelled = false;
    const source = new VectorSource();
    const layer = new VectorLayer({ source, style: boundaryStyle, zIndex: BOUNDARY_LAYER_Z });
    layer.set('parcelAnalysisBoundary', true);
    map.addLayer(layer);
    layerRef.current = layer;

    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'devTestService',
          action: 'getProjectEmdBoundary5181',
          params: {},
        });
        const data = res?.data ?? res;
        const wkt = data?.wkt ? String(data.wkt) : null;
        if (!wkt || cancelled) return;
        const geom = new WKT().readGeometry(wkt, {
          dataProjection: 'EPSG:5181',
          featureProjection: 'EPSG:3857',
        });
        source.clear();
        source.addFeature(new Feature(geom));
      } catch {
        /* 경계 표시는 참고용 — 실패해도 필지분석 진행 */
      }
    })();

    return () => {
      cancelled = true;
      map.removeLayer(layer);
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [active, mapContext?.mapInstanceRef]);
}
