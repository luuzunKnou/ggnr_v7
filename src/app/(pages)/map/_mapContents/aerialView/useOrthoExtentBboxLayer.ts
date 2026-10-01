'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { fromExtent } from 'ol/geom/Polygon';
import { transformExtent } from 'ol/proj';
import type { FeatureLike } from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { call } from '@/lib/api';
import { GEOM_STACK_ZINDEX_BASE } from '@/lib/mapLayerGeometryOrder';
import { useMapContext } from '../../_mapComponents/MapContext';
import type { MapHitOverlapOption } from '../../_mapComponents/MapHitOverlapSelect';
import type { IdentifyPopupState } from '../../_mapComponents/hooks/useFeatureIdentify';
import { ORTHO_DATA_QUERY_LAYER_ID } from './orthoDataQueryLayerId';

const LAYER_KEY = 'ortho-data-query-bbox';
/** 드론영상 타일보다 아래 · 일반 WMS(면=GEOM_STACK_ZINDEX_BASE)보다도 아래 */
const ORTHO_BBOX_Z_INDEX = GEOM_STACK_ZINDEX_BASE - 2;

type OrthoExtentClientItem = {
  tuKey: number;
  title?: string;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

/** 브라우저 세션 동안 재조회 방지 — 켜기/끄기 토글 시 체감 지연 완화 */
let clientExtentItemsCache: OrthoExtentClientItem[] | null = null;

const purpleStyle = new Style({
  stroke: new Stroke({ color: 'rgba(124, 58, 237, 0.95)', width: 2 }),
  fill: new Fill({ color: 'rgba(124, 58, 237, 0.18)' }),
});

const activeStyle = new Style({
  stroke: new Stroke({ color: 'rgba(91, 33, 182, 1)', width: 3 }),
  fill: new Fill({ color: 'rgba(124, 58, 237, 0.32)' }),
});

function fitFeature(map: import('ol').Map, feat: FeatureLike) {
  const geom = (feat as Feature).getGeometry?.();
  if (!geom) return;
  map.getView().fit(geom.getExtent(), {
    padding: [80, 80, 80, 80],
    maxZoom: 18,
    duration: 400,
  });
}

function applyExtentItems(source: VectorSource, items: OrthoExtentClientItem[]) {
  source.clear();
  for (const it of items) {
    if (
      !Number.isFinite(it.minLon) ||
      !Number.isFinite(it.minLat) ||
      !Number.isFinite(it.maxLon) ||
      !Number.isFinite(it.maxLat)
    ) {
      continue;
    }
    const ext3857 = transformExtent(
      [it.minLon, it.minLat, it.maxLon, it.maxLat],
      'EPSG:4326',
      'EPSG:3857'
    ) as [number, number, number, number];
    const poly = fromExtent(ext3857);
    const feat = new Feature({ geometry: poly });
    feat.set('tuKey', it.tuKey);
    feat.set('title', it.title ?? `드론영상 ${it.tuKey}`);
    feat.set('extent3857', ext3857);
    feat.set('tableName', ORTHO_DATA_QUERY_LAYER_ID);
    source.addFeature(feat);
  }
}

/**
 * 데이터조회 «드론영상» — 변환완료 TIF bbox 보라색 폴리곤.
 * 클릭 시 영상 표시. 겹치면 우측 «지도에서 선택된 항목» 목록으로 고른다.
 */
export function useOrthoExtentBboxLayer(enabled: boolean) {
  const mapContext = useMapContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceRef = useRef(new VectorSource());
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const activeTuRef = useRef<number[]>([]);

  useEffect(() => {
    activeTuRef.current = mapContext?.orthoDataQueryTuKeys ?? [];
    layerRef.current?.changed();
  }, [mapContext?.orthoDataQueryTuKeys]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    if (!enabled) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current.clear();
      mapContext?.setOrthoDataQueryTuKeys?.([]);
      mapContext?.setOrthoDataQueryHitOptions?.([]);
      return;
    }

    let cancelled = false;
    const source = sourceRef.current;
    if (!layerRef.current) {
      layerRef.current = new VectorLayer({
        source,
        style: (feat) => {
          const tu = Number(feat.get('tuKey'));
          return activeTuRef.current.includes(tu) ? activeStyle : purpleStyle;
        },
        // 드론영상 타일보다 아래, 일반 WMS보다도 아래
        zIndex: ORTHO_BBOX_Z_INDEX,
        properties: { id: LAYER_KEY, ggnrOrthoBbox: true, geomStackSkip: true },
      });
    }
    if (!map.getLayers().getArray().includes(layerRef.current)) {
      map.addLayer(layerRef.current);
    }

    (async () => {
      try {
        if (clientExtentItemsCache) {
          applyExtentItems(source, clientExtentItemsCache);
          return;
        }
        const res = await call('', 'POST', {
          service: 'aerialOrthoService',
          action: 'listCompletedOrthoExtents',
          params: {},
        });
        if (cancelled) return;
        const items = (res?.data?.items ?? res?.items ?? []) as OrthoExtentClientItem[];
        clientExtentItemsCache = items;
        applyExtentItems(source, items);
      } catch {
        if (!cancelled) source.clear();
      }
    })();

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!layerRef.current) return;
      const seen = new Set<number>();
      const hits: FeatureLike[] = [];
      const pushHit = (f: FeatureLike) => {
        const tu = Number(f.get('tuKey'));
        if (!Number.isFinite(tu) || seen.has(tu)) return;
        seen.add(tu);
        hits.push(f);
      };

      // 1) 클릭 좌표가 폴리곤 안에 있는 모든 범위
      for (const f of source.getFeaturesAtCoordinate(evt.coordinate)) {
        pushHit(f);
      }
      // 2) 가장자리·근접 클릭 보완
      const pixelFeatures = map.getFeaturesAtPixel(evt.pixel, {
        layerFilter: (layer) => layer === layerRef.current,
        hitTolerance: 14,
      }) as FeatureLike[];
      for (const f of pixelFeatures) pushHit(f);

      if (hits.length === 0) return;
      evt.stopPropagation();
      evt.preventDefault();

      const options: MapHitOverlapOption[] = hits.map((f) => ({
        value: String(f.get('tuKey')),
        label: String(f.get('title') ?? f.get('tuKey')),
        extent3857: (f.get('extent3857') as [number, number, number, number] | undefined) ?? null,
      }));
      mapContext?.setOrthoDataQueryHitOptions?.(options);

      const first = hits[0]!;
      const firstTu = Number(first.get('tuKey'));
      mapContext?.setOrthoDataQueryTuKeys?.([firstTu]);
      layerRef.current.changed();
      fitFeature(map, first);

      // 2건 이상: 데이터조회와 동일하게 우측 «지도에서 선택된 항목» 목록
      if (hits.length > 1) {
        const coord = evt.coordinate as [number, number];
        const identify: IdentifyPopupState = {
          coordinate: coord,
          listHeaderLabel: '드론영상',
          results: [
            {
              tableName: ORTHO_DATA_QUERY_LAYER_ID,
              korName: '드론영상',
              titleField: 'title',
              features: hits.map((f) => ({
                titleValue: String(f.get('title') ?? ''),
                data: {
                  tuKey: f.get('tuKey'),
                  title: f.get('title'),
                  extent3857: f.get('extent3857'),
                  __orthoExtent: true,
                },
              })),
            },
          ],
        };
        mapContext?.setIdentifyResultList?.(identify);
        mapContext?.setIdentifySelectedRow?.(null);

        const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
        const opened = rawOpened.map((w) => (w === 'dataQuery' ? 'standardList' : w));
        const nextOpened = [...opened];
        if (!nextOpened.includes('standardList')) nextOpened.push('standardList');
        if (!nextOpened.includes('listView')) nextOpened.push('listView');
        const next = new URLSearchParams(Array.from(searchParams.entries()));
        next.set('opened', nextOpened.join(','));
        next.set('dataTable', ORTHO_DATA_QUERY_LAYER_ID);
        next.delete('dataKey');
        router.push(`/map?${next.toString()}`);
      }
    };

    map.on('singleclick', onClick as never);

    return () => {
      cancelled = true;
      map.un('singleclick', onClick as never);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      source.clear();
    };
  }, [
    enabled,
    mapContext?.mapInstanceRef,
    mapContext?.setOrthoDataQueryTuKeys,
    mapContext?.setOrthoDataQueryHitOptions,
    mapContext?.setIdentifyResultList,
    mapContext?.setIdentifySelectedRow,
    router,
    searchParams,
  ]);
}
