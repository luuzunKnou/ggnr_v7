'use client';

import { useEffect, useState } from 'react';
import { containsExtent, intersects } from 'ol/extent';
import MVT from 'ol/format/MVT';
import VectorTileLayer from 'ol/layer/VectorTile';
import { transformExtent } from 'ol/proj';
import VectorTileSource from 'ol/source/VectorTile';
import { createXYZ } from 'ol/tilegrid';
import { withBasePath } from '@/lib/basePath';
import { GEOM_STACK_UI_ZINDEX_MIN } from '@/lib/mapLayerGeometryOrder';
import { useMapContext } from '../../_mapComponents/MapContext';
import { DIGITAL_MAP_OUTLINE_MAX_ZOOM } from './digitalMapConfig';
import { createDigitalMapTileStyle, digitalMapMercatorScaleAtY } from './digitalMapTileStyle';

/** 서버가 알려주는 PMTiles 하나의 정보 (digitalMapService.listFolders) */
export type DigitalMapFolderRow = {
  /** 파일명(확장자 제외) — 예: 수치지형도(25000) */
  name: string;
  minZoom: number;
  maxZoom: number;
  /** [minLon, minLat, maxLon, maxLat] */
  bounds: [number, number, number, number];
  sizeMB?: number;
};

export type DigitalMapFolderLayerStatus = {
  loading: boolean;
  /** 도엽 테두리만 보이는 줌 구간 */
  outlineOnly: boolean;
  error: string | null;
};

const TILE_ERROR_MESSAGE = '수치지형도 타일을 불러오지 못했습니다.';

/**
 * 폴더(PMTiles 파일) 하나 — 벡터타일로 표시.
 * 축소(960m 이하): 도엽 테두리 / 확대: 줌별 도면(도로·하천·등고·건물·글자). 색·점선·글자는 도면 원본 값.
 * 타일 최대 줌을 넘는 확대는 마지막 줌 타일을 늘려 표시한다.
 */
export function useDigitalMapTileLayer(
  row: DigitalMapFolderRow | null,
  enabled: boolean
): DigitalMapFolderLayerStatus {
  const mapContext = useMapContext();
  const mapRef = mapContext?.mapInstanceRef;
  const [loading, setLoading] = useState(false);
  const [outlineOnly, setOutlineOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const name = row?.name ?? null;
  const minZoom = row?.minZoom ?? 0;
  const maxZoom = row?.maxZoom ?? 17;
  const [bMinX, bMinY, bMaxX, bMaxY] = row?.bounds ?? [0, 0, 0, 0];

  useEffect(() => {
    const map = mapRef?.current;
    // 호스트가 폴더별로 마운트/언마운트하므로 꺼진 상태의 초기화는 필요 없다
    if (!map || !enabled || !name) return;

    let pending = 0;

    const style = createDigitalMapTileStyle(() => {
      const c = map.getView().getCenter();
      return c ? digitalMapMercatorScaleAtY(c[1]) : 1;
    });

    const source = new VectorTileSource({
      format: new MVT(),
      projection: 'EPSG:3857',
      // tileGrid 를 직접 주면 source.maxZoom 은 무시된다 — 그리드 최대 줌을 타일 존재 줌에 맞춰야
      // 그 이상 확대 때 새 타일을 요청하지 않고 마지막 줌 타일을 늘려 쓴다
      tileGrid: createXYZ({ minZoom, maxZoom, tileSize: 256 }),
      url: `${withBasePath('/api/digitalMap/tile/{z}/{x}/{y}')}?folder=${encodeURIComponent(name)}`,
    });

    const tileLayer = new VectorTileLayer({
      source,
      style,
      declutter: false,
      updateWhileAnimating: true,
      updateWhileInteracting: true,
      zIndex: GEOM_STACK_UI_ZINDEX_MIN + 6,
      properties: { id: `digital-map-tile-${name}`, geomStackSkip: true },
    });

    const onLoadStart = () => {
      pending += 1;
      if (pending === 1) setLoading(true);
    };
    const onLoadEnd = () => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) setLoading(false);
      setError((prev) => (prev === null ? prev : null));
    };
    const onLoadError = () => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) setLoading(false);
      setError(TILE_ERROR_MESSAGE);
    };
    source.on('tileloadstart', onLoadStart);
    source.on('tileloadend', onLoadEnd);
    source.on('tileloaderror', onLoadError);

    const syncOutline = () => {
      const z = map.getView().getZoom();
      const only = z == null || !Number.isFinite(z) || Math.floor(z) <= DIGITAL_MAP_OUTLINE_MAX_ZOOM;
      setOutlineOnly((prev) => (prev === only ? prev : only));
    };

    map.addLayer(tileLayer);
    syncOutline();
    map.on('moveend', syncOutline);

    // 화면에 수치지형도 범위가 전혀 안 걸리면 전체 범위로 이동
    const size = map.getSize();
    if (size && bMaxX > bMinX && bMaxY > bMinY) {
      const view = map.getView();
      const mapCode = view.getProjection().getCode();
      try {
        const target = transformExtent([bMinX, bMinY, bMaxX, bMaxY], 'EPSG:4326', mapCode);
        const viewExtent = view.calculateExtent(size);
        if (!intersects(viewExtent, target) && !containsExtent(viewExtent, target)) {
          view.fit(target, { padding: [72, 72, 72, 72], maxZoom: 16, duration: 450 });
        }
      } catch {
        /* 좌표 변환 실패 시 이동 생략 */
      }
    }

    return () => {
      map.un('moveend', syncOutline);
      source.un('tileloadstart', onLoadStart);
      source.un('tileloadend', onLoadEnd);
      source.un('tileloaderror', onLoadError);
      map.removeLayer(tileLayer);
      source.clear();
      setLoading(false);
    };
  }, [mapRef, enabled, name, minZoom, maxZoom, bMinX, bMinY, bMaxX, bMaxY]);

  return { loading, outlineOnly, error };
}
