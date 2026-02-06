'use client';

import { useRef, useState, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'maplibre-gl-draw/dist/mapbox-gl-draw.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  MapControlPanel,
  defaultMapControlGroups,
} from './_mapControlPanel/mapControlPanel';
import { BackgroundMapSelector } from './_mapControlPanel/backgroundMapSelector';
import { MapView } from './MapView';
import { useMapContext } from './MapContext';
import { getBackgroundLayerSpecById } from './backgroundLayerFactory';
import { createServiceLayerViewLayer } from './serviceLayerFactory';
import { fetchIndexLayers } from './indexLayerFactory';
import { useLayerCategory } from './LayerCategoryContext';
import { useMeasure, formatDistance, formatArea } from './hooks/useMeasure';
import { call } from '@/lib/api';

const MULTI_SELECT_IDS = [
  'cadastral',
  'building-road',
  'thematic',
  'land-category',
  'ownership',
  'street-view',
];
const ACTION_ONLY_IDS = ['print', 'reset-measurements'];
const MEASUREMENT_IDS = ['distance', 'area', 'altitude', 'slope'];

const BACKGROUND_SOURCE_ID = 'background';
const BACKGROUND_LAYER_ID = 'background';

/** 안동 시청 근처 (경도, 위도) */
const DEFAULT_CENTER: [number, number] = [128.7229, 36.5664];
const DEFAULT_ZOOM = 10;

/** MapLibre 지도 화면. 배경지도 선택에 따라 backgroundLayerFactory 스펙으로 배경 전환. */
export default function OpenLayersMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useMapContext();
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  const [activeControls, setActiveControls] = useState<string[]>([]);
  const [selectedBackgroundMap, setSelectedBackgroundMap] = useState('aerial-2022');

  const { activeCategories } = useLayerCategory() ?? { activeCategories: [] as string[] };

  const isDistanceActive = activeControls.includes('distance');
  const isAreaActive = activeControls.includes('area');
  const measureMode = isDistanceActive ? 'distance' : isAreaActive ? 'area' : null;

  const { distanceM, areaSqM, mousePosition: measureMousePosition, reset: resetMeasure } = useMeasure({
    mapRef: mapInstanceRef,
    mode: measureMode && mapReady ? measureMode : null,
  });

  const isMeasureActive = isDistanceActive || isAreaActive;

  useEffect(() => {
    if (!mapRef.current || !mapInstanceRef) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: { version: 8, sources: {}, layers: [] },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapInstanceRef.current = map;
    map.once('load', () => {
      map.resize();
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, [mapInstanceRef]);

  /** 배경지도 적용: id에 따라 factory에서 스펙 조회 후 소스/레이어 교체 */
  const applyBackground = (map: maplibregl.Map, id: string) => {
    const style = map.getStyle();
    if (!style?.sources) return;
    const hasLayer = style.layers?.some((l) => l.id === BACKGROUND_LAYER_ID);
    const hasSource = style.sources[BACKGROUND_SOURCE_ID];
    if (hasLayer) map.removeLayer(BACKGROUND_LAYER_ID);
    if (hasSource) map.removeSource(BACKGROUND_SOURCE_ID);

    const spec = getBackgroundLayerSpecById(id);
    if (spec) {
      map.addSource(BACKGROUND_SOURCE_ID, {
        type: 'raster',
        tiles: spec.tiles,
        tileSize: spec.tileSize,
        attribution: spec.attribution,
        minzoom: spec.minzoom,
        maxzoom: spec.maxzoom,
      });
      map.addLayer({ id: BACKGROUND_LAYER_ID, type: 'raster', source: BACKGROUND_SOURCE_ID });
    }
  };

  useEffect(() => {
    const map = mapInstanceRef?.current;
    if (!map) return;
    const onLoad = () => applyBackground(map, selectedBackgroundMap);
    if (map.getStyle()?.sources) {
      onLoad();
    } else {
      map.once('load', onLoad);
    }
    return () => {
      map.off('load', onLoad);
    };
  }, [mapInstanceRef, selectedBackgroundMap]);

  /** 컨테이너 크기 변경 시 지도 resize (반만 그려지는 현상 방지) */
  useEffect(() => {
    const map = mapInstanceRef?.current;
    const el = mapRef.current;
    if (!map || !el) return;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapInstanceRef, mapReady]);

  /** 줌 레벨 구독 */
  useEffect(() => {
    const map = mapInstanceRef?.current;
    if (!map || !mapReady) return;
    const onZoom = () => setZoomLevel(map.getZoom());
    setZoomLevel(map.getZoom());
    map.on('zoom', onZoom);
    return () => {
      map.off('zoom', onZoom);
    };
  }, [mapInstanceRef, mapReady]);

  /** deck.gl MapboxOverlay 추가 */
  useEffect(() => {
    const map = mapInstanceRef?.current;
    if (!map || !mapReady) return;

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    deckOverlayRef.current = overlay;

    return () => {
      map.removeControl(overlay as unknown as maplibregl.IControl);
      overlay.finalize?.();
      deckOverlayRef.current = null;
    };
  }, [mapInstanceRef, mapReady]);

  /** 단일 MVT(serviceLayerView) 레이어 + 거리뷰/카테고리별 필터 */
  const isStreetViewOn = activeControls.includes('street-view');
  useEffect(() => {
    const overlay = deckOverlayRef.current;
    if (!overlay) return;

    let cancelled = false;
    fetchIndexLayers()
      .then((entries) => {
        if (cancelled) return;
        const allIds = entries
          .map((e) => e.id)
          .filter((id) => !id.includes('serviceLayerView'));
        let activeLayerNames: string[];
        if (isStreetViewOn) {
          activeLayerNames = allIds;
        } else {
          activeLayerNames = [];
          if (activeCategories.includes('상수관망도')) {
            activeLayerNames.push(...allIds.filter((id) => id.includes('wtl')));
          }
          if (activeCategories.includes('하수관망도') || activeCategories.includes('하수')) {
            activeLayerNames.push(...allIds.filter((id) => id.includes('swl')));
          }
        }
        const layer = createServiceLayerViewLayer(activeLayerNames);
        overlay.setProps({ layers: [layer] });
      })
      .catch(() => {
        if (!cancelled) overlay.setProps({ layers: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [mapReady, activeCategories, isStreetViewOn]);

  const handleControlClick = (id: string, isActive: boolean) => {
    if (id === 'reset-measurements') {
      resetMeasure();
      setActiveControls((prev) => prev.filter((item) => !MEASUREMENT_IDS.includes(item)));
      return;
    }

    if (id === 'print') {
      call('', 'POST', {
        service: 'layerViewService',
        action: 'createServiceLayerView',
        params: { execute: true },
      })
        .then((res: { success?: boolean; data?: { executed?: boolean; layerCount?: number; error?: string } }) => {
          const data = res?.data;
          if (res?.success && data?.executed) {
            alert(`serviceLayerView 뷰 생성 완료 (${data.layerCount ?? 0}개 레이어)`);
          } else if (data?.error) {
            alert(`뷰 생성 실패: ${data?.error}`);
          } else {
            alert('뷰 생성 요청이 완료되었습니다.');
          }
        })
        .catch((err: { error?: string; message?: string }) => {
          alert(`오류: ${err?.error ?? err?.message ?? '알 수 없음'}`);
        });
      return;
    }

    if (ACTION_ONLY_IDS.includes(id)) return;

    if (MULTI_SELECT_IDS.includes(id)) {
      setActiveControls((prev) =>
        isActive ? prev.filter((item) => item !== id) : [...prev, id]
      );
    } else if (id === 'background-map' && isActive) {
      setActiveControls((prev) => prev.filter((item) => MULTI_SELECT_IDS.includes(item)));
    } else {
      if (MEASUREMENT_IDS.includes(id)) {
        setActiveControls((prev) => {
          const withoutMeasurements = prev.filter((item) => !MEASUREMENT_IDS.includes(item));
          return isActive ? withoutMeasurements : [...withoutMeasurements, id];
        });
      } else {
        setActiveControls((prev) => {
          const withoutSingle = prev.filter((item) => MULTI_SELECT_IDS.includes(item));
          return isActive ? withoutSingle : [...withoutSingle, id];
        });
      }
    }
  };

  return (
    <div className="relative w-full h-full">
      <MapView ref={mapRef} />

      {/* 측정 중 마우스 따라다니는 안내 툴팁 */}
      {isMeasureActive && measureMousePosition != null && (
        <div
          className="fixed z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-slate-200 px-2 py-1 pointer-events-none"
          style={{
            left: `${measureMousePosition.x + 15}px`,
            top: `${measureMousePosition.y - 10}px`,
            fontSize: '0.7rem',
          }}
        >
          {isDistanceActive ? (
            distanceM != null ? (
              <div className="font-medium text-slate-700">
                총 거리: <span className="text-blue-600 font-semibold">{formatDistance(distanceM)}</span>
              </div>
            ) : (
              <div className="text-slate-600">클릭하여 선을 그리세요. 더블클릭으로 완료</div>
            )
          ) : areaSqM != null ? (
            <div className="font-medium text-slate-700">
              총 면적: <span className="text-blue-600 font-semibold">{formatArea(areaSqM)}</span>
            </div>
          ) : (
            <div className="text-slate-600">클릭하여 영역을 그리세요. 더블클릭으로 완료</div>
          )}
        </div>
      )}

      <div className="absolute right-4 top-20 z-10 flex items-start gap-3">
        {activeControls.includes('background-map') && (
          <BackgroundMapSelector
            value={selectedBackgroundMap}
            onValueChange={setSelectedBackgroundMap}
          />
        )}

        <MapControlPanel
          groups={defaultMapControlGroups}
          activeIds={activeControls}
          onItemClick={handleControlClick}
        />
      </div>

      {zoomLevel != null && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-md border border-slate-200 text-sm font-medium text-slate-700">
          Zoom: {zoomLevel.toFixed(1)}
        </div>
      )}
    </div>
  );
}
