'use client';

import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Stroke, Style } from 'ol/style';
import { fromExtent } from 'ol/geom/Polygon';
import { transformExtent } from 'ol/proj';
import { createEmpty, extend as extendExtent, isEmpty } from 'ol/extent';
import { call } from '@/lib/api';
import { GEOM_STACK_ZINDEX_BASE } from '@/lib/mapLayerGeometryOrder';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { useMapContext } from '../../_mapComponents/MapContext';
import type { MapHitOverlapOption } from '../../_mapComponents/MapHitOverlapSelect';

const LAYER_KEY = 'aerial-ortho-panel-bbox';
/** 드론영상 타일보다 아래 · 일반 WMS보다도 아래 */
const ORTHO_BBOX_Z_INDEX = GEOM_STACK_ZINDEX_BASE - 2;

type OrthoExtentClientItem = {
  tuKey: number;
  wuKey?: number;
  title?: string;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export type OrthoBboxPick = {
  wuKey: number;
  tuKey: number;
  /** 2건 이상일 때만. 상세 상단에서 고른다 */
  overlaps?: MapHitOverlapOption[];
  /** 임시: 우측 겹침 목록 위치. 되돌릴 때 이 필드와 클릭 좌표 전달만 빼면 된다 */
  clientX?: number;
  clientY?: number;
};

let clientExtentItemsCache: OrthoExtentClientItem[] | null = null;

const purpleStyle = new Style({
  stroke: new Stroke({ color: 'rgba(124, 58, 237, 0.95)', width: 2 }),
});

const highlightStyle = new Style({
  stroke: new Stroke({ color: 'rgba(109, 40, 217, 1)', width: 3 }),
});

const dimStyle = new Style({
  stroke: new Stroke({ color: 'rgba(124, 58, 237, 0.22)', width: 1 }),
});

const activeStyle = new Style({
  stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.95)', width: 2 }),
});

function extent3857Of(it: OrthoExtentClientItem): [number, number, number, number] | null {
  if (
    !Number.isFinite(it.minLon) ||
    !Number.isFinite(it.minLat) ||
    !Number.isFinite(it.maxLon) ||
    !Number.isFinite(it.maxLat)
  ) {
    return null;
  }
  return transformExtent(
    [it.minLon, it.minLat, it.maxLon, it.maxLat],
    'EPSG:4326',
    'EPSG:3857'
  ) as [number, number, number, number];
}

/**
 * 드론영상 탭 — 변환완료 TIF 범위.
 * tuKeys 가 없으면 전체, 있으면 선택한 작업단위 파일만.
 */
export function useAerialOrthoPanelBbox(params: {
  enabled: boolean;
  /** undefined = 전체, 배열 = 해당 TIF만 */
  tuKeys?: number[];
  /** 우측 패널 — 켠 작업목록(wuKey)의 범위만 */
  wuKeys?: number[];
  /** 범위 클릭 — 작업단위 상세·해당 TIF */
  onPick?: (hit: OrthoBboxPick) => void;
  /** false면 범위만 그리고 지도는 움직이지 않는다 */
  fitView?: boolean;
  /** 목록에서 가리키는 작업만 진하게 */
  highlightWuKey?: number | null;
  /** 켠 작업의 범위 테두리를 빨간색으로 */
  checkedWuKeys?: ReadonlySet<number>;
}) {
  const { enabled, tuKeys, wuKeys, onPick, fitView = true, highlightWuKey = null, checkedWuKeys } = params;
  const mapContext = useMapContext();
  const mapReady = Boolean(mapContext?.mapReady);
  const sourceRef = useRef(new VectorSource());
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const itemsRef = useRef<OrthoExtentClientItem[]>([]);
  const lastFitKeyRef = useRef<string | null>(null);
  const filterKey =
    wuKeys != null
      ? wuKeys.length === 0
        ? 'wu:none'
        : `wu:${[...wuKeys].sort((a, b) => a - b).join(',')}`
      : tuKeys == null
        ? '*'
        : tuKeys.length === 0
          ? 'none'
          : [...tuKeys].sort((a, b) => a - b).join(',');
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const fitViewRef = useRef(fitView);
  fitViewRef.current = fitView;
  const highlightWuRef = useRef<number | null>(highlightWuKey);
  highlightWuRef.current = highlightWuKey;
  const checkedOn = checkedWuKeys !== undefined;
  const checkedWuRef = useRef<ReadonlySet<number> | null>(checkedWuKeys ?? null);
  checkedWuRef.current = checkedWuKeys ?? null;
  const checkedKey = checkedWuKeys ? [...checkedWuKeys].sort((a, b) => a - b).join(',') : '';
  const activeSourceRef = useRef(new VectorSource());
  const activeLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    if (!enabled) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current.clear();
      activeSourceRef.current.clear();
      if (activeLayerRef.current) {
        map.removeLayer(activeLayerRef.current);
        activeLayerRef.current = null;
      }
      itemsRef.current = [];
      lastFitKeyRef.current = null;
      return;
    }

    let cancelled = false;
    const source = sourceRef.current;
    if (!layerRef.current) {
      layerRef.current = new VectorLayer({
        source,
        style: (feat) => {
          const hi = highlightWuRef.current;
          if (hi == null) return purpleStyle;
          return Number(feat.get('wuKey')) === hi ? highlightStyle : dimStyle;
        },
        zIndex: ORTHO_BBOX_Z_INDEX,
        properties: { id: LAYER_KEY, ggnrOrthoBbox: true, geomStackSkip: true },
      });
    }
    if (!map.getLayers().getArray().includes(layerRef.current)) {
      map.addLayer(layerRef.current);
    }
    if (checkedOn && !activeLayerRef.current) {
      activeLayerRef.current = new VectorLayer({
        source: activeSourceRef.current,
        style: activeStyle,
        zIndex: GEOM_STACK_ZINDEX_BASE,
        properties: { id: `${LAYER_KEY}-active`, geomStackSkip: true },
      });
    }
    if (activeLayerRef.current && !map.getLayers().getArray().includes(activeLayerRef.current)) {
      map.addLayer(activeLayerRef.current);
    }

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      const seen = new Set<number>();
      const hits: Feature[] = [];
      const pushHit = (feat: Feature) => {
        const tu = Number(feat.get('tuKey'));
        const wu = Number(feat.get('wuKey'));
        if (!Number.isFinite(tu) || !Number.isFinite(wu) || seen.has(tu)) return;
        seen.add(tu);
        hits.push(feat);
      };
      for (const feat of source.getFeaturesAtCoordinate(evt.coordinate) as Feature[]) pushHit(feat);
      const pixelHits = map.getFeaturesAtPixel(evt.pixel, {
        layerFilter: (layer) => layer === layerRef.current,
        hitTolerance: 14,
      }) as Feature[];
      for (const feat of pixelHits) pushHit(feat);
      if (!onPickRef.current) return;
      hits.sort((a, b) => featureArea(a) - featureArea(b));
      const picked = hits[0];
      if (!picked) return;
      const tuKey = Number(picked.get('tuKey'));
      const wuKey = Number(picked.get('wuKey'));
      evt.stopPropagation();
      const overlaps =
        hits.length > 1
          ? hits.map((feat) => ({
              value: `${feat.get('wuKey')}:${feat.get('tuKey')}`,
              label: String(feat.get('title') ?? feat.get('tuKey')),
            }))
          : undefined;
      const pointer = evt.originalEvent;
      onPickRef.current?.({
        wuKey,
        tuKey,
        overlaps,
        clientX: pointer.clientX,
        clientY: pointer.clientY,
      });
    };
    const onMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!onPickRef.current) return;
      const hit = source.getFeaturesAtCoordinate(evt.coordinate).length > 0;
      const el = map.getTargetElement();
      if (el) el.style.cursor = hit ? 'pointer' : '';
    };
    map.on('singleclick', onClick as never);
    map.on('pointermove', onMove as never);

    (async () => {
      try {
        if (clientExtentItemsCache?.some((it) => it.wuKey == null)) {
          clientExtentItemsCache = null;
        }
        if (!clientExtentItemsCache) {
          const res = await call('', 'POST', {
            service: 'aerialOrthoService',
            action: 'listCompletedOrthoExtents',
            params: {},
          });
          if (cancelled) return;
          clientExtentItemsCache = (res?.data?.items ?? res?.items ?? []) as OrthoExtentClientItem[];
        }
        if (cancelled) return;
        itemsRef.current = clientExtentItemsCache;
        applyFilter(
          map,
          source,
          clientExtentItemsCache,
          filterKeyRef.current,
          lastFitKeyRef,
          () => mapContext?.applyMapViewPaddingRef?.current?.(),
          fitViewRef.current
        );
        syncActiveBoxes(source, activeSourceRef.current, checkedWuRef.current);
      } catch {
        if (!cancelled) {
          source.clear();
          activeSourceRef.current.clear();
        }
      }
    })();

    return () => {
      cancelled = true;
      map.un('singleclick', onClick as never);
      map.un('pointermove', onMove as never);
      const el = map.getTargetElement();
      if (el) el.style.cursor = '';
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      if (activeLayerRef.current) {
        map.removeLayer(activeLayerRef.current);
        activeLayerRef.current = null;
      }
      source.clear();
      activeSourceRef.current.clear();
      lastFitKeyRef.current = null;
    };
  }, [enabled, mapReady, mapContext?.mapInstanceRef, checkedOn]);

  useEffect(() => {
    highlightWuRef.current = highlightWuKey;
    layerRef.current?.changed();
  }, [highlightWuKey]);

  useEffect(() => {
    syncActiveBoxes(sourceRef.current, activeSourceRef.current, checkedWuRef.current);
  }, [checkedKey]);

  useEffect(() => {
    if (!enabled) return;
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    if (!map || !source || itemsRef.current.length === 0) return;
    applyFilter(
      map,
      source,
      itemsRef.current,
      filterKey,
      lastFitKeyRef,
      () => mapContext?.applyMapViewPaddingRef?.current?.(),
      fitView
    );
    syncActiveBoxes(source, activeSourceRef.current, checkedWuRef.current);
  }, [enabled, filterKey, fitView, mapContext?.mapInstanceRef]);
}

function syncActiveBoxes(
  bboxSource: VectorSource,
  activeSource: VectorSource,
  checked: ReadonlySet<number> | null
) {
  activeSource.clear();
  if (!checked || checked.size === 0) return;
  for (const feat of bboxSource.getFeatures()) {
    const wu = Number(feat.get('wuKey'));
    const geom = feat.getGeometry();
    if (!checked.has(wu) || !geom) continue;
    activeSource.addFeature(new Feature({ geometry: geom.clone() }));
  }
}

function applyFilter(
  map: import('ol').Map,
  source: VectorSource,
  items: OrthoExtentClientItem[],
  filterKey: string,
  lastFitKeyRef: { current: string | null },
  applyMapViewPadding?: (() => void) | null,
  fitView = true
) {
  const allowTu =
    filterKey === '*' || filterKey.startsWith('wu:')
      ? null
      : filterKey === 'none'
        ? new Set<number>()
        : new Set(
            filterKey
              .split(',')
              .map((s) => Number(s))
              .filter((n) => Number.isFinite(n))
          );
  const allowWu =
    filterKey === 'wu:none'
      ? new Set<number>()
      : filterKey.startsWith('wu:')
        ? new Set(
            filterKey
              .slice(3)
              .split(',')
              .map((s) => Number(s))
              .filter((n) => Number.isFinite(n))
          )
        : null;

  const keep = new Set<number>();
  for (const it of items) {
    if (allowWu) {
      if (it.wuKey == null || !allowWu.has(it.wuKey)) continue;
    } else if (allowTu && !allowTu.has(it.tuKey)) continue;
    if (extent3857Of(it)) keep.add(it.tuKey);
  }

  for (const feat of [...source.getFeatures()]) {
    const tuKey = Number(feat.get('tuKey'));
    if (!keep.has(tuKey)) source.removeFeature(feat);
  }

  const present = new Set(source.getFeatures().map((feat) => Number(feat.get('tuKey'))));
  const union = createEmpty();
  for (const it of items) {
    if (!keep.has(it.tuKey)) continue;
    const ext = extent3857Of(it);
    if (!ext) continue;
    if (!present.has(it.tuKey)) {
      const feat = new Feature({ geometry: fromExtent(ext) });
      feat.set('tuKey', it.tuKey);
      if (it.wuKey != null) feat.set('wuKey', it.wuKey);
      feat.set('title', it.title ?? `드론영상 ${it.tuKey}`);
      feat.set('extent3857', ext);
      source.addFeature(feat);
    }
    extendExtent(union, ext);
  }

  if (filterKey === lastFitKeyRef.current || isEmpty(union)) return;
  lastFitKeyRef.current = filterKey;
  if (!fitView) return;
  scheduleFitMapToExtent3857(map, union, {
    maxZoom: 18,
    duration: 450,
    fitPadding: [80, 80, 80, 80],
    applyMapViewPadding,
  });
}

function featureArea(feat: Feature): number {
  const ext = feat.getGeometry()?.getExtent();
  if (!ext) return Infinity;
  return Math.abs((ext[2]! - ext[0]!) * (ext[3]! - ext[1]!));
}
