'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import TileLayer from 'ol/layer/Tile';
import TileState from 'ol/TileState';
import XYZ from 'ol/source/XYZ';
import { transformExtent } from 'ol/proj';
import type Tile from 'ol/Tile';
import type ImageTile from 'ol/ImageTile';
import { call } from '@/lib/api';
import { GEOM_STACK_ZINDEX_BASE } from '@/lib/mapLayerGeometryOrder';
import { useMapContext } from '../../_mapComponents/MapContext';
import type { WorkUnitItem } from './aerialMediaTypes';
import { mockUnitsForKind, subscribeMockWorkUnits } from './aerialMediaMockData';
import { useAerialOrthoZoomLimit } from './useAerialOrthoZoomLimit';
import { AERIAL_ORTHO_TILE_FULL_MAX_ZOOM } from './aerialOrthoZoomLimit';

const LAYER_PREFIX = 'aerial-ortho-tif-';
/** 보라 bbox 위 · 일반 WMS 면(GEOM_STACK_ZINDEX_BASE) 아래 */
const ORTHO_TILE_Z_INDEX = GEOM_STACK_ZINDEX_BASE - 1;

/** JPEG nodata(순수 검정)만 투명. 검정이 없으면 원본 그대로 쓴다. */
async function jpegBlobWithoutBlack(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || canvas.width === 0) return URL.createObjectURL(blob);
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    let punched = false;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! <= 2 && d[i + 1]! <= 2 && d[i + 2]! <= 2) {
        d[i + 3] = 0;
        punched = true;
      }
    }
    if (!punched) return URL.createObjectURL(blob);
    ctx.putImageData(imgData, 0, 0);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return URL.createObjectURL(out ?? blob);
  } finally {
    bitmap.close();
  }
}

/**
 * 타일은 한 번만 받는다. 서버가 JPEG를 주면 검은 테두리만 지우고, PNG는 그대로 쓴다.
 * LoadFunction 시그니처는 Tile이지만 XYZ는 ImageTile로 호출한다.
 */
function orthoTileLoadFunction(tile: Tile, src: string) {
  const imageTile = tile as ImageTile;
  const img = imageTile.getImage() as HTMLImageElement;
  void fetch(src, { credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok) {
        tile.setState(TileState.ERROR);
        return;
      }
      const blob = await res.blob();
      const type = (res.headers.get('content-type') ?? blob.type).toLowerCase();
      const url = type.includes('jpeg') || type.includes('jpg') ? await jpegBlobWithoutBlack(blob) : URL.createObjectURL(blob);
      img.addEventListener(
        'load',
        () => {
          URL.revokeObjectURL(url);
        },
        { once: true }
      );
      img.src = url;
    })
    .catch(() => {
      tile.setState(TileState.ERROR);
    });
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
  /** 데이터조회 bbox 클릭 등 외부에서 켠 tuKey */
  extraTuKeys?: number[];
  /** false면 카메라 이동은 호출측(범위 레이어)에 맡긴다 */
  fitView?: boolean;
}) {
  const { enabled, unit = null, checkedFileIds, checkedUnitIds, extraTuKeys, fitView = true } = params;
  const mapContext = useMapContext();
  const layersRef = useRef<Map<string, TileLayer<XYZ>>>(new Map());
  const lastFitKeyRef = useRef('');
  const [listTick, setListTick] = useState(0);
  const { displayMaxZoom } = useAerialOrthoZoomLimit();
  const tileMaxZoom = displayMaxZoom ?? AERIAL_ORTHO_TILE_FULL_MAX_ZOOM;

  useEffect(() => {
    if (!checkedUnitIds) return;
    return subscribeMockWorkUnits(() => setListTick((t) => t + 1));
  }, [checkedUnitIds]);

  const checkedTuKeys = useMemo(() => {
    const keys: number[] = [];
    if (checkedUnitIds) {
      void listTick;
      for (const u of mockUnitsForKind('ortho')) {
        if (!checkedUnitIds.has(u.id)) continue;
        for (const f of u.files) {
          if (f.status === 'done' && f.tuKey != null) keys.push(f.tuKey);
        }
      }
    } else if (unit && unit.kind === 'ortho' && checkedFileIds) {
      for (const f of unit.files) {
        if (checkedFileIds.has(f.id) && f.status === 'done' && f.tuKey != null) {
          keys.push(f.tuKey);
        }
      }
    }
    for (const k of extraTuKeys ?? []) {
      if (Number.isFinite(k)) keys.push(Number(k));
    }
    return [...new Set(keys)].sort((a, b) => a - b);
  }, [unit, checkedFileIds, checkedUnitIds, listTick, extraTuKeys]);

  const checkedKey = checkedTuKeys.join(',');

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const unitModeOk = Boolean(unit && unit.kind === 'ortho' && checkedFileIds);
    const layerPanelModeOk = Boolean(checkedUnitIds);
    const extraOk = (extraTuKeys?.length ?? 0) > 0;
    if (!map || !enabled || (!unitModeOk && !layerPanelModeOk && !extraOk)) {
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
      const existing = layersRef.current.get(key);
      if (existing) {
        // 보라 bbox 위 · 일반 WMS 면 아래 — 같이 켜서 겹쳐 볼 수 있게
        existing.setZIndex(ORTHO_TILE_Z_INDEX);
        if (existing.get('orthoMaxZoom') !== tileMaxZoom) {
          existing.setSource(
            new XYZ({
              url: `/api/aerial/ortho-tiles/${tuKey}/{z}/{x}/{y}.png`,
              maxZoom: tileMaxZoom,
              crossOrigin: 'anonymous',
              tileSize: 512,
              wrapX: false,
              attributions: '© aerial ortho',
              tileLoadFunction: orthoTileLoadFunction,
            })
          );
          existing.set('orthoMaxZoom', tileMaxZoom);
        }
        continue;
      }
      const layer = new TileLayer({
        source: new XYZ({
          url: `/api/aerial/ortho-tiles/${tuKey}/{z}/{x}/{y}.png`,
          maxZoom: tileMaxZoom,
          crossOrigin: 'anonymous',
          tileSize: 512,
          wrapX: false,
          attributions: '© aerial ortho',
          tileLoadFunction: orthoTileLoadFunction,
        }),
        properties: {
          id: `${LAYER_PREFIX}${key}`,
          orthoMaxZoom: tileMaxZoom,
          geomStackSkip: true,
        },
        // 보라 bbox 위 · 일반 WMS 면 아래
        zIndex: ORTHO_TILE_Z_INDEX,
        opacity: 1,
      });
      map.addLayer(layer);
      layersRef.current.set(key, layer);
    }

    if (fitView && checkedKey && checkedKey !== lastFitKeyRef.current && checkedTuKeys.length > 0) {
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
            maxZoom: Math.min(19, tileMaxZoom),
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
    tileMaxZoom,
    fitView,
    mapContext?.mapInstanceRef,
    extraTuKeys,
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
