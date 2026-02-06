'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

// 배경지도 옵션 타입
export interface BackgroundMapOption {
  id: string;
  label: string;
}

// 배경지도 그룹 타입
export interface BackgroundMapGroup {
  id: string;
  title: string;
  options: BackgroundMapOption[];
}

// 기본 배경지도 그룹 데이터
export const defaultBackgroundMapGroups: BackgroundMapGroup[] = [
  {
    id: 'custom-aerial',
    title: '국토정보지리원 영상',
    options: [
      { id: 'aerial-2017', label: '항공영상(2017)' },
      { id: 'aerial-2021', label: '항공영상(2021)' },
      { id: 'aerial-2022', label: '항공영상(2022)' },
      { id: 'high-res-2024', label: '고정밀영상(2024)' },
      { id: 'fire-nir', label: '산불영상(근적외)' },
      { id: 'fire-ortho', label: '산불영상(정사)' },
      { id: 'fire-drone', label: '산불영상(드론)' },
    ],
  },
  {
    id: 'general',
    title: '일반영상',
    options: [
      { id: 'general-vworld', label: '일반지도(vworld)' },
      { id: 'general-google-building', label: '일반지도(구글건물)' },
      { id: 'general-google', label: '일반지도(구글)' },
      { id: 'general-osm', label: '일반지도(OSM)' },
      { id: 'general-osm-hot', label: '일반지도(HOT)' },
    ],
  },
  {
    id: 'aerial',
    title: '항공영상',
    options: [
      { id: 'aerial-vworld', label: '항공영상(vworld)' },
      { id: 'aerial-google', label: '항공영상(구글)' },
      { id: 'aerial-osm', label: '항공영상(OSM)' },
    ],
  },
  {
    id: 'topographic',
    title: '지형도',
    options: [
      { id: 'topo-google', label: '지형도(구글)' },
      { id: 'topo-osm', label: '지형도(OSM)' },
    ],
  },
  {
    id: 'other',
    title: '기타영상',
    options: [
      { id: 'white-map', label: '백색지도' },
      { id: 'night-map', label: '야간지도' },
      { id: 'no-background', label: '배경없음' },
    ],
  },
];

// 그룹 컴포넌트 (접기/펼치기 지원)
function BackgroundMapGroupSection({
  group,
  selectedValue,
  onValueChange,
  defaultExpanded = true,
}: {
  group: BackgroundMapGroup;
  selectedValue: string;
  onValueChange: (value: string) => void;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasSelectedItem = group.options.some((opt) => opt.id === selectedValue);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      {/* 그룹 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center justify-between w-full px-3 py-2 text-[13px] font-medium transition-colors',
          'bg-slate-100 hover:bg-slate-200',
          hasSelectedItem && 'text-blue-600'
        )}
      >
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-blue-500 rounded-full" />
          <span>{group.title}</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {/* 그룹 옵션들 */}
      {isExpanded && (
        <div className="pb-1">
          {group.options.map((option) => (
            <label
              key={option.id}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors',
                'hover:bg-slate-50',
                selectedValue === option.id && 'bg-blue-50'
              )}
            >
              <input
                type="radio"
                name="background-map"
                value={option.id}
                checked={selectedValue === option.id}
                onChange={() => onValueChange(option.id)}
                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <span
                className={cn(
                  'text-xs',
                  selectedValue === option.id
                    ? 'text-blue-600 font-medium'
                    : 'text-slate-700'
                )}
              >
                {option.label}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// 메인 배경지도 선택 컴포넌트
export interface BackgroundMapSelectorProps {
  groups?: BackgroundMapGroup[];
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function BackgroundMapSelector({
  groups = defaultBackgroundMapGroups,
  value,
  onValueChange,
  className,
}: BackgroundMapSelectorProps) {
  const [internalValue, setInternalValue] = useState('aerial-2022');
  const selectedValue = value ?? internalValue;

  const handleValueChange = (newValue: string) => {
    setInternalValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <div
      className={cn(
        'w-56 bg-white shadow-xl overflow-hidden flex flex-col max-h-[calc(100vh-30px)] rounded-[10px]',
        className
      )}
    >
      {/* 스크롤 영역 */}
      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => (
          <BackgroundMapGroupSection
            key={group.id}
            group={group}
            selectedValue={selectedValue}
            onValueChange={handleValueChange}
          />
        ))}
      </div>
    </div>
  );
}
