import type { CSSProperties } from 'react';
import { darkerHex } from '@/lib/geoserverStyleUtils';
import { withBasePath } from '@/lib/basePath';

export type SafetyFacSubtypeId =
  | 'coldShelter'
  | 'heatShelter'
  | 'heatMitigation'
  | 'eqOutdoor'
  | 'tsunamiEvac'
  | 'displacedHousing';

export type SafetyFacFacilityRow = {
  id: string;
  table: string;
  subtype: SafetyFacSubtypeId;
  name: string;
  address: string;
  phone?: string;
  lon?: number;
  lat?: number;
  detailAttrs: Record<string, unknown>;
  /** WGS84 GeoJSON — 지도 붉은 강조용 */
  geomJson?: unknown;
};

/** 레이어명(영문 테이블) = public/symbol/{fileName}.svg. borderColor는 원 테두리·칩 테두리 */
export const SAFETY_FAC_SYMBOL: Record<
  SafetyFacSubtypeId,
  { color: string; borderColor: string; fileName: string; src: string }
> = {
  coldShelter: {
    color: '#2196F3',
    borderColor: '#1769aa',
    fileName: 'sd_cold_wave_shelter',
    src: withBasePath('/symbol/sd_cold_wave_shelter.svg'),
  },
  heatShelter: {
    color: '#E91E63',
    borderColor: '#a31545',
    fileName: 'sd_heat_wave_shelter',
    src: withBasePath('/symbol/sd_heat_wave_shelter.svg'),
  },
  heatMitigation: {
    color: '#FF9800',
    borderColor: '#b26a00',
    fileName: 'sd_heat_mitigation_facility',
    src: withBasePath('/symbol/sd_heat_mitigation_facility.svg'),
  },
  eqOutdoor: {
    color: '#3F51B5',
    borderColor: '#2c387e',
    fileName: 'sd_earthquake_outdoor_evac_site',
    src: withBasePath('/symbol/sd_earthquake_outdoor_evac_site.svg'),
  },
  tsunamiEvac: {
    color: '#673AB7',
    borderColor: '#482880',
    fileName: 'sd_tsunami_emergency_evac_site',
    src: withBasePath('/symbol/sd_tsunami_emergency_evac_site.svg'),
  },
  displacedHousing: {
    color: '#009688',
    borderColor: '#00695f',
    fileName: 'sd_mois_displaced_temp_housing',
    src: withBasePath('/symbol/sd_mois_displaced_temp_housing.svg'),
  },
};

export const SAFETY_FAC_SUBTYPE_TO_TABLE: Record<SafetyFacSubtypeId, string> = {
  coldShelter: 'sd_cold_wave_shelter',
  heatShelter: 'sd_heat_wave_shelter',
  heatMitigation: 'sd_heat_mitigation_facility',
  eqOutdoor: 'sd_earthquake_outdoor_evac_site',
  tsunamiEvac: 'sd_tsunami_emergency_evac_site',
  displacedHousing: 'sd_mois_displaced_temp_housing',
};

export const SAFETY_FAC_TABLE_TO_SUBTYPE: Record<string, SafetyFacSubtypeId> = Object.fromEntries(
  Object.entries(SAFETY_FAC_SUBTYPE_TO_TABLE).map(([subtype, table]) => [table, subtype])
) as Record<string, SafetyFacSubtypeId>;

/** 목록 칩 — 도로대장 도로종류 뱃지와 비슷한 짧은 한글 */
export const SAFETY_FAC_LIST_CHIP_LABEL: Record<SafetyFacSubtypeId, string> = {
  coldShelter: '한파쉼터',
  heatShelter: '무더위',
  heatMitigation: '폭염저감',
  eqOutdoor: '지진옥외',
  tsunamiEvac: '지진해일',
  displacedHousing: '임시주거',
};

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 도로대장 도로종류 뱃지와 동일: 연한 배경 + 진한 글자 + 반투명 테두리 */
export function getSafetyFacBadgeStyle(subtype: SafetyFacSubtypeId, selected = true): CSSProperties {
  const hex = SAFETY_FAC_SYMBOL[subtype].color;
  if (!selected) {
    return {
      backgroundColor: 'var(--background)',
      color: darkerHex(hex, 0.52),
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: hexToRgba(hex, 0.22),
    };
  }
  return {
    backgroundColor: hexToRgba(hex, 0.14),
    color: darkerHex(hex, 0.52),
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: hexToRgba(hex, 0.38),
  };
}
