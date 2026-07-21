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

/** 자체항공영상이 없을 때 사용하는 배경지도 id */
export const FALLBACK_BACKGROUND_MAP_ID = 'aerial-vworld';

export type OrthophotoTileOutputsPayload = {
  groups?: { groupName: string; tileSetIds: string[] }[];
  legacyTileSetIds?: string[];
};

/** tiles_jpg 폴더명 → UI 표시 라벨 (satellite_YYYY[_CRS[_이름]] 규칙) */
export function buildLabelFromOrthoFolder(id: string): string | null {
  const m = /^satellite_(\d{4})(?:_([^_]+)(?:_(.+))?)?$/i.exec(id);
  if (!m) return null;
  const year = m[1];
  const seg3 = (m[2] ?? '').trim();
  const seg4 = (m[3] ?? '').trim();
  if (/^\d+$/.test(seg3)) return seg4 || `항공영상(${year})`;
  return seg3 || `항공영상(${year})`;
}

/** orthophotoService.listOrthophotoTileOutputs → 자체항공영상 옵션 (최신순) */
export function buildCustomAerialBackgroundOptions(
  payload: OrthophotoTileOutputsPayload
): BackgroundMapOption[] {
  const idSet = new Set<string>();
  for (const id of payload.legacyTileSetIds ?? []) idSet.add(id);
  for (const g of payload.groups ?? []) idSet.add(g.groupName);
  return Array.from(idSet)
    .map((id) => {
      const label = buildLabelFromOrthoFolder(id);
      return label ? { id, label } : null;
    })
    .filter((x): x is BackgroundMapOption => x != null)
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** 자체항공영상 중 id 기준 최신(목록 첫 항목) */
export function pickLatestCustomAerialBackgroundId(
  payload: OrthophotoTileOutputsPayload
): string | null {
  return buildCustomAerialBackgroundOptions(payload)[0]?.id ?? null;
}

// 기본 배경지도 그룹 데이터
export const defaultBackgroundMapGroups: BackgroundMapGroup[] = [
  {
    id: 'custom-aerial',
    title: '자체항공영상',
    // 디스크의 tiles_jpg 폴더 내용으로 동적 채움(없으면 빈 목록)
    options: [],
  },
  {
    id: 'aerial',
    title: '항공영상',
    options: [
      { id: 'aerial-vworld', label: '항공영상(vworld)' },
      // { id: 'aerial-daum', label: '항공영상(다음)' },
      { id: 'aerial-google', label: '항공영상(구글)' },
    ],
  },
  {
    id: 'general',
    title: '일반영상',
    options: [
      { id: 'general-vworld', label: '일반지도(vworld)' },
      // { id: 'general-daum', label: '일반지도(다음)' },
      { id: 'general-google-building', label: '일반지도(구글건물)' },
      { id: 'general-google', label: '일반지도(구글)' },
      { id: 'general-osm', label: '일반지도(OSM)' },
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
    <div className="border-b border-slate-100 last:border-b-0 dark:border-white/10">
      {/* 그룹 헤더 */}
      <button
        type="button"
        title={group.title}
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex cursor-pointer items-center justify-between w-full px-3 py-2 text-[13px] font-medium transition-colors',
          'bg-slate-100 text-foreground hover:bg-slate-200',
          'dark:bg-white/10 dark:text-white/90 dark:hover:bg-white/15 dark:hover:text-white',
          hasSelectedItem && 'text-blue-600 dark:text-white'
        )}
      >
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-blue-500 rounded-full dark:bg-blue-400" />
          <span>{group.title}</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400 dark:text-white/50" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 dark:text-white/50" />
        )}
      </button>

      {/* 그룹 옵션들 */}
      {isExpanded && (
        <div className="pb-1">
          {group.options.map((option) => (
            <div
              key={option.id}
              className={cn(
                'flex items-center px-3 py-1.5 transition-colors',
                'hover:bg-slate-50 dark:hover:bg-white/10',
                selectedValue === option.id && 'bg-blue-50 dark:bg-white/20'
              )}
            >
              <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                <input
                  type="radio"
                  name="background-map"
                  value={option.id}
                  checked={selectedValue === option.id}
                  onChange={() => onValueChange(option.id)}
                  className="w-4 h-4 shrink-0 text-blue-600 border-gray-300 focus:ring-blue-500 dark:text-blue-400 dark:border-white/30"
                />
                <span
                  className={cn(
                    'text-xs truncate',
                    selectedValue === option.id
                      ? 'text-blue-600 font-medium dark:text-white'
                      : 'text-slate-700 dark:text-white/90'
                  )}
                >
                  {option.label}
                </span>
              </label>
            </div>
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
  const [internalValue, setInternalValue] = useState(FALLBACK_BACKGROUND_MAP_ID);
  const selectedValue = value ?? internalValue;

  const handleValueChange = (newValue: string) => {
    setInternalValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <div
      className={cn(
        'w-56 bg-white shadow-xl overflow-hidden flex flex-col rounded-[5px] opacity-90',
        'dark:bg-black/40 dark:text-white/90 dark:opacity-100 dark:backdrop-blur-sm dark:border dark:border-white/10',
        className
      )}
    >
      {/* 스크롤 영역 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
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
