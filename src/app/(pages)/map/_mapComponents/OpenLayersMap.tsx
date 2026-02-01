'use client';

import { useRef, useState } from 'react';
import 'ol/ol.css';
import {
  MapControlPanel,
  defaultMapControlGroups,
} from './_mapControlPanel/mapControlPanel';
import { BackgroundMapSelector } from './_mapControlPanel/backgroundMapSelector';
import { useMapInstance } from './hooks/useMapInstance';
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
  const mapInstanceRef = useMapInstance(mapRef);
  const [activeControls, setActiveControls] = useState<string[]>([]);
  const [selectedBackgroundMap, setSelectedBackgroundMap] = useState('aerial-2022');
  const [activeInteractions, setActiveInteractions] = useState<string[]>([]);

  // 측정 타입 결정
  const measureType: MeasureType | null = activeControls.includes('distance')
    ? 'distance'
    : activeControls.includes('area')
    ? 'area'
    : null;

  // 배경지도 관리
  useBackgroundLayer(mapInstanceRef.current, selectedBackgroundMap);

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
        {/* 배경지도 선택 패널 */}
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
    </div>
  );
}
