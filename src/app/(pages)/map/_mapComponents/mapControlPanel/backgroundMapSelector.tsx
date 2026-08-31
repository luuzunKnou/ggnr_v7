'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MAP_LAYER_PANEL_SURFACE_CLASS } from './mapLayerPanelLayout';

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

/** 지도분할·배경 싱크 OFF — 좌는 globals primary(청록) 그대로, 우만 파란 accent */
export const BACKGROUND_MAP_SPLIT_RADIO_CLASS = {
  left: 'h-4 w-4 shrink-0 cursor-pointer border-gray-300 dark:border-white/30',
  right:
    'background-map-radio-right h-4 w-4 shrink-0 cursor-pointer border-gray-300 dark:border-white/30',
} as const;

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

/** 지도분할·배경 싱크 OFF 시 좌·우 독립 선택 */
export type BackgroundMapSplitSelect = {
  leftValue: string;
  rightValue: string;
  onLeftChange: (value: string) => void;
  onRightChange: (value: string) => void;
};

// 그룹 컴포넌트 (접기/펼치기 지원)
function BackgroundMapGroupSection({
  group,
  selectedValue,
  onValueChange,
  splitSelect,
  defaultExpanded = true,
}: {
  group: BackgroundMapGroup;
  selectedValue: string;
  onValueChange: (value: string) => void;
  splitSelect?: BackgroundMapSplitSelect;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasSelectedItem = splitSelect
    ? group.options.some(
        (opt) =>
          opt.id === splitSelect.leftValue || opt.id === splitSelect.rightValue
      )
    : group.options.some((opt) => opt.id === selectedValue);

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
          hasSelectedItem && 'text-primary'
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
          {group.options.map((option) => {
            if (splitSelect) {
              const leftOn = splitSelect.leftValue === option.id;
              const rightOn = splitSelect.rightValue === option.id;
              return (
                <div
                  key={option.id}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 transition-colors',
                    'hover:bg-slate-50 dark:hover:bg-white/10',
                    (leftOn || rightOn) && 'bg-blue-50 dark:bg-white/20'
                  )}
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-xs',
                      leftOn || rightOn
                        ? 'font-medium text-primary'
                        : 'text-slate-700 dark:text-white/90'
                    )}
                    title={option.label}
                  >
                    {option.label}
                  </span>
                  <input
                    type="radio"
                    name="background-map-left"
                    value={option.id}
                    checked={leftOn}
                    title="좌측 지도"
                    aria-label={`${option.label} — 좌측 지도`}
                    onChange={() => splitSelect.onLeftChange(option.id)}
                    className={BACKGROUND_MAP_SPLIT_RADIO_CLASS.left}
                  />
                  <div
                    className="mx-0.5 h-4 w-0 shrink-0 border-l border-dashed border-slate-300 dark:border-white/30"
                    aria-hidden
                  />
                  <input
                    type="radio"
                    name="background-map-right"
                    value={option.id}
                    checked={rightOn}
                    title="우측 지도"
                    aria-label={`${option.label} — 우측 지도`}
                    onChange={() => splitSelect.onRightChange(option.id)}
                    className={BACKGROUND_MAP_SPLIT_RADIO_CLASS.right}
                  />
                </div>
              );
            }

            return (
              <div
                key={option.id}
                className={cn(
                  'flex items-center px-3 py-1.5 transition-colors',
                  'hover:bg-slate-50 dark:hover:bg-white/10',
                  selectedValue === option.id && 'bg-blue-50 dark:bg-white/20'
                )}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="background-map"
                    value={option.id}
                    checked={selectedValue === option.id}
                    title={option.label}
                    onChange={() => onValueChange(option.id)}
                    className="h-4 w-4 shrink-0 border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-white/30 dark:text-blue-400"
                  />
                  <span
                    className={cn(
                      'truncate text-xs',
                      selectedValue === option.id
                        ? 'font-medium text-primary'
                        : 'text-slate-700 dark:text-white/90'
                    )}
                  >
                    {option.label}
                  </span>
                </label>
              </div>
            );
          })}
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
  /** 지도분할·배경 싱크 OFF 시 좌·우 라디오 */
  splitSelect?: BackgroundMapSplitSelect;
  className?: string;
}

export function BackgroundMapSelector({
  groups = defaultBackgroundMapGroups,
  value,
  onValueChange,
  splitSelect,
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
        'flex flex-col overflow-hidden',
        MAP_LAYER_PANEL_SURFACE_CLASS,
        splitSelect ? 'w-64' : 'w-56',
        className
      )}
    >
      {/* 스크롤 영역 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <BackgroundMapGroupSection
            key={group.id}
            group={group}
            selectedValue={selectedValue}
            onValueChange={handleValueChange}
            splitSelect={splitSelect}
          />
        ))}
      </div>
    </div>
  );
}
