'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map } from 'ol';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import Point from 'ol/geom/Point';
import { Style, Stroke, Fill, Text } from 'ol/style';
import { getCenter } from 'ol/extent';
import { call } from '@/lib/api';
import {
  fetchLandInfoConfig,
  fetchLatestOfficialLandPriceForPnu,
} from '../landInfo/api';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import { isJijukJibunLabelVisible } from '../layerFactory/boundaryLayerFactory';

const LAYER_Z_INDEX = 920;
const FETCH_LIMIT = 120;
const PRICE_CONCURRENCY = 6;
const MOVEEND_DEBOUNCE_MS = 450;

type JijukParcelRow = {
  pnu?: string;
  jibun?: string;
  geom?: unknown;
};

function parcelFeatureStyles(feature: Feature<Geometry>): Style[] {
  const geom = feature.getGeometry();
  if (!geom) return [];
  const jibun = String(feature.get('jibun') ?? '-');
  const priceLabel = String(feature.get('priceLabel') ?? '-');
  const center = getCenter(geom.getExtent());
  return [
    new Style({
      stroke: new Stroke({ color: 'rgba(234, 88, 12, 0.95)', width: 1.5 }),
      fill: new Fill({ color: 'rgba(251, 146, 60, 0.18)' }),
    }),
    new Style({
      geometry: new Point(center),
      text: new Text({
        text: `${jibun}\n${priceLabel}`,
        font: '600 11px "Malgun Gothic", sans-serif',
        fill: new Fill({ color: '#1e293b' }),
        stroke: new Stroke({ color: 'rgba(255,255,255,0.95)', width: 3 }),
        overflow: true,
        textAlign: 'center',
      }),
    }),
  ];
}

function formatJibun(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return s || '-';
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await fn(items[cur]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

function formatPriceLabel(priceNum: number | null | undefined): string {
  if (priceNum == null || !Number.isFinite(priceNum)) return '-';
  return `${priceNum.toLocaleString('ko-KR')}원/㎡`;
}

async function fetchCachedLandPricesByPnu(
  pnus: string[]
): Promise<Record<string, { pblntf_pclnd: number | null }>> {
  if (!pnus.length) return {};
  try {
    const res = await call('', 'POST', {
      service: 'jijukLandAttrService',
      action: 'getJijukLandAttrsByPnus',
      params: { pnus },
    });
    const payload = (res?.data ?? res) as {
      rows?: Record<string, { pblntf_pclnd?: unknown }>;
    };
    const rows = payload?.rows ?? {};
    const out: Record<string, { pblntf_pclnd: number | null }> = {};
    for (const [pnu, row] of Object.entries(rows)) {
      const num = Number(row?.pblntf_pclnd);
      out[pnu] = { pblntf_pclnd: Number.isFinite(num) ? num : null };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 공시지가 토글 시 bbox 내 jijuk 필지 + VWorld 공시지가를 OpenLayers 벡터·텍스트로 표시.
 * 지도 이동(moveend)마다 재조회·재그림.
 */
export function useOfficialLandPriceMapLayer(
  map: Map | null,
  mapReady: boolean,
  enabled: boolean
) {
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const [vworldKey, setVworldKey] = useState('');
  const requestSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setVworldKey('');
      return;
    }
    let alive = true;
    fetchLandInfoConfig().then((cfg) => {
      if (!alive) return;
      setVworldKey(cfg.vworldKey);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!map || !mapReady) return;

    if (!sourceRef.current) {
      sourceRef.current = new VectorSource();
    }
    if (!layerRef.current) {
      layerRef.current = new VectorLayer({
        source: sourceRef.current,
        zIndex: LAYER_Z_INDEX,
        renderOrder: compareFeaturesByGeometryStackOrder,
        style: (feature) => parcelFeatureStyles(feature as Feature<Geometry>),
      });
      map.addLayer(layerRef.current);
    }

    const layer = layerRef.current;
    layer.setVisible(enabled);

    const refresh = async () => {
      if (!enabled || !sourceRef.current) return;

      const view = map.getView();
      const resolution = view.getResolution();
      if (resolution == null || !isJijukJibunLabelVisible(resolution)) {
        sourceRef.current.clear();
        return;
      }

      const extent = view.calculateExtent(map.getSize());
      if (!extent || extent.length < 4) return;

      const seq = ++requestSeqRef.current;
      const [minX, minY, maxX, maxY] = extent;
      const projCode = view.getProjection()?.getCode() ?? 'EPSG:3857';
      const srid = Number(projCode.replace(/^EPSG:/i, '')) || 3857;

      let parcels: JijukParcelRow[] = [];
      try {
        const res = await call('', 'POST', {
          service: 'standardService',
          action: 'getJijukParcelsInBbox',
          params: { minX, minY, maxX, maxY, srid, limit: FETCH_LIMIT },
        });
        const data = (res?.data ?? res) as { parcels?: JijukParcelRow[] };
        parcels = Array.isArray(data?.parcels) ? data.parcels : [];
      } catch {
        if (seq !== requestSeqRef.current) return;
        sourceRef.current.clear();
        return;
      }

      if (seq !== requestSeqRef.current) return;

      const geoJson = new GeoJSON();
      const withGeom = parcels.filter((p) => p.geom && String(p.pnu ?? '').trim());
      const pnuList = withGeom.map((row) => String(row.pnu ?? '').trim());
      const cachedPrices = await fetchCachedLandPricesByPnu(pnuList);

      const priced = await mapWithConcurrency(withGeom, PRICE_CONCURRENCY, async (row) => {
        const pnu = String(row.pnu ?? '').trim();
        const jibun = formatJibun(row.jibun);
        const cached = cachedPrices[pnu];
        if (cached?.pblntf_pclnd != null) {
          return {
            row,
            jibun,
            priceLabel: formatPriceLabel(cached.pblntf_pclnd),
          };
        }
        if (!vworldKey) {
          return { row, jibun, priceLabel: '-' };
        }
        try {
          const price = await fetchLatestOfficialLandPriceForPnu({ pnu, vworldKey });
          return {
            row,
            jibun: jibun !== '-' ? jibun : formatJibun(price.jibun) || jibun,
            priceLabel: price.priceLabel,
          };
        } catch {
          return { row, jibun, priceLabel: '-' };
        }
      });

      if (seq !== requestSeqRef.current || !sourceRef.current) return;

      const features: Feature<Geometry>[] = [];
      for (const item of priced) {
        const geom = item.row.geom;
        if (!geom) continue;
        try {
          const feature = geoJson.readFeature(
            { type: 'Feature', geometry: geom, properties: {} },
            {
              dataProjection: 'EPSG:4326',
              featureProjection: view.getProjection() ?? 'EPSG:3857',
            }
          ) as Feature<Geometry>;
          feature.set('jibun', item.jibun);
          feature.set('priceLabel', item.priceLabel);
          feature.set('pnu', String(item.row.pnu ?? ''));
          features.push(feature);
        } catch {
          /* skip invalid geom */
        }
      }

      sourceRef.current.clear();
      if (features.length) sourceRef.current.addFeatures(features);
    };

    const scheduleRefresh = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void refresh();
      }, MOVEEND_DEBOUNCE_MS);
    };

    if (enabled) {
      scheduleRefresh();
      map.on('moveend', scheduleRefresh);
    } else {
      sourceRef.current?.clear();
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      map.un('moveend', scheduleRefresh);
    };
  }, [map, mapReady, enabled, vworldKey]);

  useEffect(() => {
    return () => {
      if (map && layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
        sourceRef.current = null;
      }
    };
  }, [map]);
}
