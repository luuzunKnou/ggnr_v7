'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import 'ol/ol.css';
import { call } from '@/lib/api';
import {
  MapControlPanel,
  defaultMapControlGroups,
} from './_mapControlPanel/mapControlPanel';
import { BackgroundMapSelector } from './_mapControlPanel/backgroundMapSelector';
import { useMapInstance } from './hooks/useMapInstance';
import { useMapContext } from './MapContext';
import { useBackgroundLayer } from './hooks/useBackgroundLayer';
import { useMapInteractions } from './hooks/useMapInteractions';
import { useMeasure, MeasureType } from './hooks/useMeasure';
import { MapView } from './MapView';

// 다중 선택 가능한 아이템 ID 목록
const MULTI_SELECT_IDS = [
  'cadastral',
  'building-road',
  'thematic',
  'land-category',
  'ownership',
  'street-view',
];

// 액션 전용 버튼 (토글 없이 클릭만)
const ACTION_ONLY_IDS = ['print', 'reset-measurements'];

// 측정 관련 버튼 ID 목록
const MEASUREMENT_IDS = ['distance', 'area', 'altitude', 'slope'];

export default function OpenLayersMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapContext = useMapContext();
  const sharedMapRef = mapContext?.mapInstanceRef ?? null;
  const { mapInstanceRef, mapReady } = useMapInstance(mapRef, sharedMapRef);
  const showDebugUi = mapContext?.showDebugUi ?? false;
  const [activeControls, setActiveControls] = useState<string[]>([]);
  const [selectedBackgroundMap, setSelectedBackgroundMap] = useState('aerial-2022');
  const [activeInteractions, setActiveInteractions] = useState<string[]>([]);
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  const [centerXY, setCenterXY] = useState<{ x: number; y: number } | null>(null);
  const [projectionCode, setProjectionCode] = useState<string | null>(null);
  const [isBackgroundPanelExiting, setIsBackgroundPanelExiting] = useState(false);
  const [geoserverLogLines, setGeoserverLogLines] = useState<string[]>([]);

  const fetchGeoserverLog = useCallback(async () => {
    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getGeoServerLog',
        params: { maxLines: 500 },
      });
      const d = res?.data ?? res;
      setGeoserverLogLines(Array.isArray(d?.lines) ? d.lines : []);
    } catch {
      setGeoserverLogLines([]);
    }
  }, []);

  useEffect(() => {
    fetchGeoserverLog();
    const t = setInterval(fetchGeoserverLog, 2000);
    return () => clearInterval(t);
  }, [fetchGeoserverLog]);

  // 측정 타입 결정
  const measureType: MeasureType | null = activeControls.includes('distance')
    ? 'distance'
    : activeControls.includes('area')
    ? 'area'
    : null;

  // 배경지도 관리
  useBackgroundLayer(mapInstanceRef.current, selectedBackgroundMap);

  // 줌 레벨 + 좌표계 + x,y 표시 (맵 준비 후 구독, 뷰 변경 시마다 실시간 갱신)
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const view = map.getView();
    const proj = view.getProjection();
    const update = () => {
      const z = view.getZoom();
      setZoomLevel(z !== undefined ? z : null);
      const center = view.getCenter();
      if (center) setCenterXY({ x: center[0], y: center[1] });
      if (proj) setProjectionCode(proj.getCode());
    };
    update();
    view.on('change', update);
    return () => view.un('change', update);
  }, [mapReady]);

  // 배경지도 패널: exit 애니메이션 끝난 뒤 상태 정리 (duration 400ms)
  useEffect(() => {
    if (!isBackgroundPanelExiting) return;
    const t = setTimeout(() => setIsBackgroundPanelExiting(false), 400);
    return () => clearTimeout(t);
  }, [isBackgroundPanelExiting]);

  // 지적도 버튼 → 지적도 관련 레이어(ri, emd, jijuk) 동시 on/off
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    const visible = activeControls.includes('cadastral');
    map.getLayers().getArray().forEach((l) => {
      if (l.get('cadastralLayer')) l.setVisible(visible);
    });
  }, [activeControls, mapReady]);

  // 인터랙션 관리 (draw, snap 등)
  useMapInteractions(mapInstanceRef.current, activeInteractions);

  // 측정 기능
  const { clearMeasurements } = useMeasure(
    mapInstanceRef.current,
    measureType,
    (result) => {
      console.log('측정 완료:', result);
    }
  );

  const handleControlClick = (id: string, isActive: boolean) => {
    // 초기화 버튼: 측정 관련 버튼 모두 선택 해제 및 측정 결과 초기화
    if (id === 'reset-measurements') {
      setActiveControls((prev) => prev.filter((item) => !MEASUREMENT_IDS.includes(item)));
      clearMeasurements();
      console.log(`[v0] Reset measurements triggered`);
      return;
    }

    // 액션 전용 버튼은 상태 변경 없이 액션만 실행
    if (ACTION_ONLY_IDS.includes(id)) {
      console.log(`[v0] Action triggered: ${id}`);
      // 여기에 인쇄 등 실제 액션 로직 추가
      return;
    }

    if (MULTI_SELECT_IDS.includes(id)) {
      // 다중 선택 가능한 항목: 토글
      setActiveControls((prev) =>
        isActive ? prev.filter((item) => item !== id) : [...prev, id]
      );
    } else if (id === 'background-map' && isActive) {
      // 배경지도 패널 닫기: exit 애니메이션 먼저 시작한 뒤 activeControls에서 제거 (깜빡임 방지)
      setIsBackgroundPanelExiting(true);
      setActiveControls((prev) => {
        const withoutSingle = prev.filter((item) => MULTI_SELECT_IDS.includes(item));
        return withoutSingle;
      });
    } else {
      // 단일 선택 항목: 배타적 토글
      // 측정 도구는 서로 배타적 (거리/면적 동시 선택 불가)
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

      {/* 오른쪽 맵 컨트롤 패널 */}
      <div className="absolute right-4 top-20 z-10 flex items-start gap-3">
        {/* 배경지도 선택 패널 (등장/퇴장 애니메이션, duration 400ms) */}
        {(activeControls.includes('background-map') || isBackgroundPanelExiting) && (
          <div
            className={
              isBackgroundPanelExiting
                ? 'animate-out fade-out-0 slide-out-to-right-4 duration-[400ms]'
                : 'animate-in fade-in-0 slide-in-from-right-4 duration-[400ms]'
            }
          >
            <BackgroundMapSelector
              value={selectedBackgroundMap}
              onValueChange={setSelectedBackgroundMap}
            />
          </div>
        )}

        <MapControlPanel
          groups={defaultMapControlGroups}
          activeIds={activeControls}
          onItemClick={handleControlClick}
        />
      </div>

      {/* 하단: GeoServer 로그 (줌 레벨 위) — showDebugUi 시에만 표시 */}
      {showDebugUi && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10 w-full max-w-2xl px-2">
          <div
            className="font-mono text-xs leading-tight bg-black/70 text-green-400 px-2 py-1 rounded shadow overflow-y-scroll overflow-x-hidden break-words scrollbar-hide"
            style={{ maxHeight: '7.5rem', minHeight: '2.5rem' }}
          >
            {geoserverLogLines.length === 0 ? (
              <span className="text-white/60">GeoServer 로그 없음</span>
            ) : (
              geoserverLogLines.map((line, i) => (
                <div key={i} className="break-words" title={line}>
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 하단 중앙: 줌 레벨, 좌표계, x, y — showDebugUi 시에만 표시 */}
      {showDebugUi && zoomLevel !== null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-full max-w-2xl px-2">
          <div className="w-full text-red-600 font-mono text-sm font-medium bg-white/90 px-2 py-1 rounded shadow flex items-center gap-4">
            <span>zoomLevel: {Number(zoomLevel).toFixed(1)}</span>
            {projectionCode && <span>{projectionCode}</span>}
            {centerXY && (
              <span>
                x: {centerXY.x.toFixed(0)} y: {centerXY.y.toFixed(0)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
