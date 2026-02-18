/**
 * 레이어 그룹별 아이콘 설정 (define_table_group 한글명 → 아이콘 컴포넌트)
 * - Lucide 아이콘을 그대로 import해 사용
 * - 레이어 그룹 버튼 앞에 표시할 아이콘용
 */

import type { LucideIcon } from 'lucide-react';
import {
  Layers,
  Flame,
  Droplets,
  Route,
  Leaf,
  FileText,
  Zap,
} from 'lucide-react';

export type LayerGroupIconEntry = {
  /** 레이어 그룹 한글명 (define_table_group 값과 일치) */
  groupKor: string;
  /** 아이콘 컴포넌트 (Lucide 등) */
  icon: LucideIcon;
  /** 아이콘 색상 (CSS color 값, 미지정 시 버튼 텍스트 색 상속) */
  color?: string;
};

/** 레이어 그룹 한글명 + 아이콘 + 색상 목록 */
export const LAYER_GROUP_ICON_ENTRIES: LayerGroupIconEntry[] = [
  { groupKor: '가스', icon: Flame, color: '#ea580c' },
  { groupKor: '광역상수', icon: Droplets, color: '#0891b2' },
  { groupKor: '맑은물', icon: Droplets, color: '#0ea5e9' },
  { groupKor: '농업', icon: Leaf, color: '#16a34a' },
  { groupKor: '개간농지대장', icon: Leaf, color: '#65a30d' },
  { groupKor: '도로', icon: Route, color: '#64748b' },
  { groupKor: '상수', icon: Droplets, color: '#2563eb' },
  { groupKor: '민원', icon: FileText, color: '#7c3aed' },
  { groupKor: '전기', icon: Zap, color: '#ca8a04' },
];

export type LayerGroupIconItem = {
  icon: LucideIcon;
  color?: string;
};

/** groupKor → { icon, color } 맵 (버튼에서 조회용, 미등록 그룹은 undefined) */
export function getLayerGroupIconMap(): Record<string, LayerGroupIconItem | undefined> {
  const map: Record<string, LayerGroupIconItem | undefined> = {};
  for (const { groupKor, icon, color } of LAYER_GROUP_ICON_ENTRIES) {
    if (groupKor.trim()) map[groupKor.trim()] = { icon, color };
  }
  return map;
}

/** 아이콘 미지정 그룹용 기본 아이콘 (Lucide Layers) */
export const defaultLayerGroupIcon = Layers;
