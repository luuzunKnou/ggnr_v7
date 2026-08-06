/**
 * 수위 관측소 기준수위 대비 현재 상태 (목록·범례·그래프 공통)
 */
import type { LucideIcon } from 'lucide-react';
import { Angry, Frown, Meh, Smile } from 'lucide-react';
import type { SafetyWaterLevelThresholds } from './safetyWaterTypes';

/** 그래프·목록에 쓰는 단계 (계획홍수 제외) */
export type WaterStatusLevel = '관심' | '주의보' | '경보' | '심각';

export type ThresholdStageKey = 'attwl' | 'wrnwl' | 'almwl' | 'srswl';

/** 관심→심각: 파랑·초록·노랑·빨강 */
export const WATER_STATUS_HEX: Record<WaterStatusLevel, string> = {
  관심: '#0B65C6',
  주의보: '#00897B',
  경보: '#EAB308',
  심각: '#DC2626',
};

export const WATER_STATUS_SWATCH: Record<WaterStatusLevel, string> = {
  관심: 'rgba(11, 101, 198, 0.55)',
  주의보: 'rgba(0, 137, 123, 0.55)',
  경보: 'rgba(234, 179, 8, 0.55)',
  심각: 'rgba(220, 38, 38, 0.55)',
};

export const WATER_STATUS_BAND_FILL: Record<WaterStatusLevel, string> = {
  관심: 'rgba(11, 101, 198, 0.22)',
  주의보: 'rgba(0, 137, 123, 0.22)',
  경보: 'rgba(234, 179, 8, 0.22)',
  심각: 'rgba(220, 38, 38, 0.22)',
};

export const WATER_STATUS_ICON: Record<WaterStatusLevel, LucideIcon> = {
  관심: Smile,
  주의보: Meh,
  경보: Frown,
  심각: Angry,
};

export const WATER_STATUS_LEGEND: {
  level: WaterStatusLevel;
  label: string;
  color: string;
  Icon: LucideIcon;
}[] = [
  { level: '관심', label: '관심', color: WATER_STATUS_HEX.관심, Icon: Smile },
  { level: '주의보', label: '주의보', color: WATER_STATUS_HEX.주의보, Icon: Meh },
  { level: '경보', label: '경보', color: WATER_STATUS_HEX.경보, Icon: Frown },
  { level: '심각', label: '심각', color: WATER_STATUS_HEX.심각, Icon: Angry },
];

export const THRESHOLD_KEY_TO_LEVEL: Record<ThresholdStageKey, WaterStatusLevel> = {
  attwl: '관심',
  wrnwl: '주의보',
  almwl: '경보',
  srswl: '심각',
};

/** null·비유한·0 이하는 미설정 */
export function isValidThreshold(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

/**
 * 현재 수위(m) vs 기준수위. 안전·무자료·관심 미만 → null.
 * 계획홍수 단계는 상태색에 쓰지 않음(심각 이상이면 심각).
 */
export function resolveWaterStatusLevel(
  waterLevelM: number | null | undefined,
  thresholds: Partial<SafetyWaterLevelThresholds> | null | undefined
): WaterStatusLevel | null {
  if (waterLevelM == null || !Number.isFinite(waterLevelM)) return null;
  const t = thresholds ?? {};
  const stages: { level: WaterStatusLevel; wl: number | null | undefined }[] = [
    { level: '심각', wl: t.srswl },
    { level: '경보', wl: t.almwl },
    { level: '주의보', wl: t.wrnwl },
    { level: '관심', wl: t.attwl },
  ];
  for (const s of stages) {
    if (!isValidThreshold(s.wl)) continue;
    if (waterLevelM >= s.wl) return s.level;
  }
  return null;
}

export function waterStatusFillColor(level: WaterStatusLevel | null): string | null {
  if (!level) return null;
  return WATER_STATUS_SWATCH[level];
}

export function waterStatusHex(level: WaterStatusLevel | null): string | null {
  if (!level) return null;
  return WATER_STATUS_HEX[level];
}
