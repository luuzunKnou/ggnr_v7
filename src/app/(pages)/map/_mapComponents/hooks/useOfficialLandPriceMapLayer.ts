'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map } from 'ol';
import VectorSource from 'ol/source/Vector';
import VectorImageLayer from 'ol/layer/VectorImage';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import Point from 'ol/geom/Point';
import { Style, Stroke, Fill, Text } from 'ol/style';
import { containsExtent, getCenter } from 'ol/extent';
import { call } from '@/lib/api';
import {
  fetchLandInfoConfig,
  fetchLatestOfficialLandPriceForPnu,
} from '../landInfo/api';
import { fetchVworldOfficialLandPricesByPrefix } from '@/lib/vworldParcelLandClient';
import { isJijukJibunLabelVisible } from '../layerFactory/boundaryLayerFactory';

const LAYER_Z_INDEX = 920;
/** 서버 상한과 같게 — 넘치면 화면 가운데에서 가까운 필지부터 표시 */
const FETCH_LIMIT = 10000;
const PRICE_CONCURRENCY = 6;
const VWORLD_PREFIX_CONCURRENCY = 3;
/** 법정동 일괄 조회가 실패했을 때 필지별 조회로 대신하는 최대 건수 */
const VWORLD_PER_PNU_FALLBACK_MAX = 60;
const MOVEEND_DEBOUNCE_MS = 450;
/** 지적 지번 라벨과 같은 축척(GeoServer 지적 스타일 1:2,000)에서만 표시 */
function isOfficialLandPriceZoomOk(resolution: number): boolean {
  return isJijukJibunLabelVisible(resolution);
}

type JijukParcelRow = {
  pnu?: string;
  jibun?: string;
  geom?: unknown;
};

type DbPriceEntry = { priceNum: number | null; priceLabel: string };

/** 브이월드 필지별 조회 결과(가격 없음 포함) — 지도를 옮길 때마다 다시 부르지 않는다 */
const perPnuPriceCache = new globalThis.Map<string, string>();

const PARCEL_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(234, 88, 12, 0.95)', width: 1.5 }),
  fill: new Fill({ color: 'rgba(251, 146, 60, 0.18)' }),
});
const LABEL_FILL = new Fill({ color: '#1e293b' });
const LABEL_STROKE = new Stroke({ color: 'rgba(255,255,255,0.95)', width: 3 });
const LABEL_STYLE_PROP = '__officialPriceLabelStyle';

/** 필지가 수천 건이라 매 프레임 스타일을 새로 만들지 않도록 라벨 스타일은 필지마다 한 번만 만든다 */
function parcelLabelStyle(feature: Feature<Geometry>): Style | null {
  const cached = feature.get(LABEL_STYLE_PROP) as Style | undefined;
  if (cached) return cached;
  const geom = feature.getGeometry();
  if (!geom) return null;
  const style = new Style({
    geometry: new Point(getCenter(geom.getExtent())),
    text: new Text({
      text: `${String(feature.get('jibun') ?? '-')}\n${String(feature.get('priceLabel') ?? '-')}`,
      font: '600 11px "Malgun Gothic", sans-serif',
      fill: LABEL_FILL,
      stroke: LABEL_STROKE,
      overflow: true,
      textAlign: 'center',
    }),
  });
  feature.set(LABEL_STYLE_PROP, style, true);
  return style;
}

function parcelFeatureStyles(feature: Feature<Geometry>, resolution: number): Style[] {
  if (!isOfficialLandPriceZoomOk(resolution)) return [PARCEL_STYLE];
  const label = parcelLabelStyle(feature);
  return label ? [PARCEL_STYLE, label] : [PARCEL_STYLE];
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

function hasUsableDbPrice(entry: DbPriceEntry | undefined): entry is DbPriceEntry {
  return (
    entry != null &&
    entry.priceNum != null &&
    Number.isFinite(entry.priceNum) &&
    entry.priceLabel !== '-'
  );
}

/**
 * 공시지가 토글 시 bbox 내 jijuk 필지 + 공시지가(KOREPS 파일 테이블 우선, 없으면 VWorld)를
 * OpenLayers 벡터·텍스트로 표시. 지도 이동(moveend)마다 재조회·재그림.
 */
export function useOfficialLandPriceMapLayer(
  map: Map | null,
  mapReady: boolean,
  enabled: boolean
) {
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorImageLayer<VectorSource> | null>(null);
  const [vworldKey, setVworldKey] = useState('');
  const requestSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 마지막으로 받은 범위 — 상한에 안 걸렸으면 그 안에서 확대·이동할 때 다시 받지 않는다 */
  const loadedRef = useRef<{ extent: number[]; complete: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
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
      /** 이미지 방식 — 끌기·확대 중에는 그려 둔 결과만 옮기고, 멈췄을 때 한 번 다시 그린다 */
      layerRef.current = new VectorImageLayer({
        source: sourceRef.current,
        zIndex: LAYER_Z_INDEX,
        imageRatio: 1.5,
        declutter: true,
        style: (feature, resolution) => parcelFeatureStyles(feature as Feature<Geometry>, resolution),
      });
      map.addLayer(layerRef.current);
    }

    const layer = layerRef.current;
    layer.setVisible(enabled);
    loadedRef.current = null;

    const refresh = async () => {
      if (!enabled || !sourceRef.current) return;

      const view = map.getView();
      const resolution = view.getResolution();
      if (resolution == null || !isOfficialLandPriceZoomOk(resolution)) {
        sourceRef.current.clear();
        loadedRef.current = null;
        return;
      }

      const extent = view.calculateExtent(map.getSize());
      if (!extent || extent.length < 4) return;
      const loaded = loadedRef.current;
      if (loaded && loaded.complete && containsExtent(loaded.extent, extent)) return;

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
        loadedRef.current = null;
        return;
      }

      if (seq !== requestSeqRef.current) return;

      const geoJson = new GeoJSON();
      const withGeom = parcels.filter((p) => p.geom && String(p.pnu ?? '').trim());
      const pnus = withGeom.map((p) => String(p.pnu ?? '').trim()).filter(Boolean);

      let dbPrices: Record<string, DbPriceEntry> = {};
      if (pnus.length) {
        try {
          const priceRes = await call('', 'POST', {
            service: 'standardService',
            action: 'getLatestOfficialLandPricesByPnus',
            params: { pnus },
          });
          const priceData = (priceRes?.data ?? priceRes) as {
            prices?: Record<string, DbPriceEntry>;
          };
          dbPrices =
            priceData?.prices && typeof priceData.prices === 'object' ? priceData.prices : {};
        } catch {
          dbPrices = {};
        }
      }

      if (seq !== requestSeqRef.current) return;

      /** 파일에 없는 필지 — 법정동 단위로 브이월드 일괄 조회, 실패한 동은 소수일 때만 필지별 조회 */
      const vworldPrices = new globalThis.Map<string, number>();
      const perPnuFallback: string[] = [];
      if (vworldKey) {
        const missingByPrefix = new globalThis.Map<string, string[]>();
        for (const pnu of pnus) {
          if (hasUsableDbPrice(dbPrices[pnu]) || !/^\d{19}$/.test(pnu)) continue;
          const prefix = pnu.slice(0, 10);
          missingByPrefix.set(prefix, [...(missingByPrefix.get(prefix) ?? []), pnu]);
        }
        const prefixes = [...missingByPrefix.keys()];
        const byPrefix = await mapWithConcurrency(prefixes, VWORLD_PREFIX_CONCURRENCY, (prefix) =>
          fetchVworldOfficialLandPricesByPrefix(prefix, vworldKey).catch(() => null)
        );
        prefixes.forEach((prefix, i) => {
          const prices = byPrefix[i];
          const missing = missingByPrefix.get(prefix) ?? [];
          if (prices) {
            for (const pnu of missing) {
              const price = prices.get(pnu);
              if (price != null) vworldPrices.set(pnu, price);
            }
          } else {
            perPnuFallback.push(...missing);
          }
        });
      }
      const fallbackSet = new Set(
        perPnuFallback.filter((pnu) => !perPnuPriceCache.has(pnu)).slice(0, VWORLD_PER_PNU_FALLBACK_MAX)
      );

      if (seq !== requestSeqRef.current) return;

      const priced = await mapWithConcurrency(withGeom, PRICE_CONCURRENCY, async (row) => {
        const pnu = String(row.pnu ?? '').trim();
        const jibun = formatJibun(row.jibun);
        const fromDb = dbPrices[pnu];
        if (hasUsableDbPrice(fromDb)) {
          return { row, jibun, priceLabel: fromDb.priceLabel };
        }
        const fromVworld = vworldPrices.get(pnu);
        if (fromVworld != null) {
          return { row, jibun, priceLabel: `${fromVworld.toLocaleString('ko-KR')}원/㎡` };
        }
        const cachedLabel = perPnuPriceCache.get(pnu);
        if (cachedLabel != null) return { row, jibun, priceLabel: cachedLabel };
        if (!vworldKey || !fallbackSet.has(pnu)) {
          return { row, jibun, priceLabel: '-' };
        }
        try {
          const price = await fetchLatestOfficialLandPriceForPnu({ pnu, vworldKey });
          perPnuPriceCache.set(pnu, price.priceLabel);
          return {
            row,
            jibun: jibun !== '-' ? jibun : formatJibun(price.jibun) || jibun,
            priceLabel: price.priceLabel,
          };
        } catch {
          perPnuPriceCache.set(pnu, '-');
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
      loadedRef.current = { extent, complete: parcels.length < FETCH_LIMIT };
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
