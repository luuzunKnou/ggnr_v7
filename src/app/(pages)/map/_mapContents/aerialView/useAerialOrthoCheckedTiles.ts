'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import TileLayer from 'ol/layer/Tile';
import TileState from 'ol/TileState';
import XYZ from 'ol/source/XYZ';
import { transformExtent } from 'ol/proj';
import type Tile from 'ol/Tile';
import type ImageTile from 'ol/ImageTile';
import { call } from '@/lib/api';
import { useMapContext } from '../../_mapComponents/MapContext';
import { VWORLD_MAX_ZOOM_INDEX } from '../../_mapComponents/layerFactory/backgroundLayerFactory';
import type { WorkUnitItem } from './aerialMediaTypes';
import { mockUnitsForKind, subscribeMockWorkUnits } from './aerialMediaMockData';

const LAYER_PREFIX = 'aerial-ortho-tif-';

/** JPEG nodata(순수 검정) → 투명. 원본 RGB min≈11 이라 실데이터는 남김 */
function punchJpegBlackToAlpha(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return image.src;
  ctx.drawImage(image, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i]! <= 2 && d[i + 1]! <= 2 && d[i + 2]! <= 2) d[i + 3] = 0;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * PNG 우선, 없으면 JPG. JPG는 알파 없어서 검정이 깔리므로 순수 검정만 투명 처리.
 * LoadFunction 시그니처는 Tile이지만 XYZ는 ImageTile로 호출한다.
 */
function orthoTileLoadFunction(tile: Tile, src: string) {
  const imageTile = tile as ImageTile;
  const img = imageTile.getImage() as HTMLImageElement;
  const candidates = src.endsWith('.png')
    ? [src, src.replace(/\.png$/i, '.jpg')]
    : src.endsWith('.jpg') || src.endsWith('.jpeg')
      ? [src, src.replace(/\.jpe?g$/i, '.png')]
      : [src];

  let idx = 0;
  const loadNext = () => {
    const url = candidates[idx];
    if (!url) {
      tile.setState(TileState.ERROR);
      return;
    }
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      try {
        const isJpeg = /\.jpe?g$/i.test(url);
        img.src = isJpeg ? punchJpegBlackToAlpha(probe) : url;
      } catch {
        img.src = url;
      }
    };
    probe.onerror = () => {
      idx += 1;
      loadNext();
    };
    probe.src = url;
  };
  loadNext();
}

/**
 * 드론영상 상세에서 체크한 변환완료 TIF를 지도 오버레이 XYZ로 on/off.
 * 자체항공영상(배경지도)과 별개. 체크 시 해당 타일 범위로 이동.
 * `checkedUnitIds`가 있으면 영상조회 패널 모드(작업단위 단위로 변환완료 TIF 전부).
 */
export function useAerialOrthoCheckedTiles(params: {
  enabled: boolean;
  unit?: WorkUnitItem | null;
  checkedFileIds?: Set<string>;
  checkedUnitIds?: Set<string>;
}) {
  const { enabled, unit = null, checkedFileIds, checkedUnitIds } = params;
  const mapContext = useMapContext();
  const layersRef = useRef<Map<string, TileLayer<XYZ>>>(new Map());
  const lastFitKeyRef = useRef('');
  const [listTick, setListTick] = useState(0);

  useEffect(() => {
    if (!checkedUnitIds) return;
    return subscribeMockWorkUnits(() => setListTick((t) => t + 1));
  }, [checkedUnitIds]);

  const checkedTuKeys = useMemo(() => {
    if (checkedUnitIds) {
      void listTick;
      const keys: number[] = [];
      for (const u of mockUnitsForKind('ortho')) {
        if (!checkedUnitIds.has(u.id)) continue;
        for (const f of u.files) {
          if (f.status === 'done' && f.tuKey != null) keys.push(f.tuKey);
        }
      }
      return keys.sort((a, b) => a - b);
    }
    if (!unit || unit.kind !== 'ortho' || !checkedFileIds) return [] as number[];
    return unit.files
      .filter((f) => checkedFileIds.has(f.id) && f.status === 'done' && f.tuKey != null)
      .map((f) => f.tuKey!)
      .sort((a, b) => a - b);
  }, [unit, checkedFileIds, checkedUnitIds, listTick]);

  const checkedKey = checkedTuKeys.join(',');

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const unitModeOk = Boolean(unit && unit.kind === 'ortho' && checkedFileIds);
    const layerPanelModeOk = Boolean(checkedUnitIds);
    if (!map || !enabled || (!unitModeOk && !layerPanelModeOk)) {
      for (const [, layer] of layersRef.current) {
        mapContext?.mapInstanceRef?.current?.removeLayer(layer);
      }
      layersRef.current.clear();
      lastFitKeyRef.current = '';
      return;
    }

    const want = new Set(checkedTuKeys.map(String));

    for (const [key, layer] of [...layersRef.current.entries()]) {
      if (!want.has(key)) {
        map.removeLayer(layer);
        layersRef.current.delete(key);
      }
    }

    for (const tuKey of checkedTuKeys) {
      const key = String(tuKey);
      if (layersRef.current.has(key)) continue;
      const layer = new TileLayer({
        source: new XYZ({
          url: `/api/aerial/ortho-tiles/${tuKey}/{z}/{x}/{y}.png`,
          maxZoom: VWORLD_MAX_ZOOM_INDEX,
          crossOrigin: 'anonymous',
          tileSize: 512,
          wrapX: false,
          attributions: '© aerial ortho',
          tileLoadFunction: orthoTileLoadFunction,
        }),
        properties: { id: `${LAYER_PREFIX}${key}` },
        zIndex: 200,
        opacity: 1,
      });
      map.addLayer(layer);
      layersRef.current.set(key, layer);
    }

    if (checkedKey && checkedKey !== lastFitKeyRef.current && checkedTuKeys.length > 0) {
      lastFitKeyRef.current = checkedKey;
      const focusTu = checkedTuKeys[checkedTuKeys.length - 1]!;
      void call('', 'POST', {
        service: 'aerialOrthoService',
        action: 'getOrthoTifExtentWgs84',
        params: { tuKey: focusTu },
      })
        .then((res) => {
          if (!res?.success) return;
          const d = (res.data ?? res) as {
            minLon?: number | null;
            minLat?: number | null;
            maxLon?: number | null;
            maxLat?: number | null;
          };
          if (
            d.minLon == null ||
            d.minLat == null ||
            d.maxLon == null ||
            d.maxLat == null ||
            !Number.isFinite(d.minLon) ||
            !Number.isFinite(d.minLat) ||
            !Number.isFinite(d.maxLon) ||
            !Number.isFinite(d.maxLat)
          ) {
            return;
          }
          const m = mapContext?.mapInstanceRef?.current;
          if (!m) return;
          const extent3857 = transformExtent(
            [d.minLon, d.minLat, d.maxLon, d.maxLat],
            'EPSG:4326',
            'EPSG:3857'
          );
          m.getView().fit(extent3857, {
            duration: 450,
            maxZoom: 19,
            padding: [48, 48, 48, 48],
          });
        })
        .catch(() => undefined);
    }

    if (!checkedKey) lastFitKeyRef.current = '';
  }, [
    enabled,
    unit,
    checkedKey,
    checkedTuKeys,
    checkedFileIds,
    checkedUnitIds,
    mapContext?.mapInstanceRef,
  ]);

  useEffect(() => {
    return () => {
      const map = mapContext?.mapInstanceRef?.current;
      for (const [, layer] of layersRef.current) {
        map?.removeLayer(layer);
      }
      layersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
