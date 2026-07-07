import type { ParcelAnalysisGroupDef } from './parcelAnalysisItems';
import { BASIC_MAP_COMPOSITE_SECTION_ID } from './parcelAnalysisBasicMapConfig';
import {
  DUMMY_BUILDING_LEDGER_ROWS,
  USE_DUMMY_BUILDING_LEDGER,
} from './parcelAnalysisBuildingLedgerDummy';

export type MockLandRow = {
  pnu: string;
  addr: string;
  jimok: string;
  area: string;
  ownerType?: string;
  ownerName?: string;
  publicPrice?: string;
};

export type MockOwnerStat = { label: string; count: number; area: string; ratio: string };
export type MockJimokStat = { jimok: string; count: number; area: string; ratio: string };
export type MockLandUseStat = { zone: string; count: number; area: string; ratio: string };

export type MockLandRowsProgress = { loaded: number; total: number; loading: boolean };

export type MockBuildingRow = {
  pnu: string;
  addr: string;
  bldNm: string;
  platLoc: string;
  jibun: string;
  roadAddr: string;
  bcRat: string;
  vlRat: string;
  jijigu: string;
  platArea: string;
  totArea: string;
};

export type MockFacilityStatRow = {
  layerKey: string;
  layerKorName: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON';
  stats: string;
  unit: string;
};

export type MockParcelAnalysisResult = {
  parcelCount: number;
  totalAreaSqm: number;
  itemCount: number;
  landRows: MockLandRow[];
  ownerStats: MockOwnerStat[];
  jimokStats: MockJimokStat[];
  buildingRows: MockBuildingRow[];
  facilityStats: Record<string, MockFacilityStatRow[]>;
  landUseStats: MockLandUseStat[];
  landRowsProgress?: MockLandRowsProgress;
  landUseProgress?: MockLandRowsProgress;
  wkt5181?: string;
};

export function buildMockParcelAnalysisResult(selectedItemIds: string[]): MockParcelAnalysisResult {
  const landRows: MockLandRow[] = [
    { pnu: '4711110100100010001', addr: '동부동 123', jimok: '대', area: '1,240㎡', ownerType: '개인' },
    { pnu: '4711110100100010002', addr: '동부동 124', jimok: '전', area: '890㎡', ownerType: '국유' },
    { pnu: '4711110100100020001', addr: '송정리 45-1', jimok: '답', area: '2,100㎡', ownerType: '개인' },
  ];

  return {
    parcelCount: 12,
    totalAreaSqm: 42000,
    itemCount: selectedItemIds.length,
    landRows: selectedItemIds.some((id) => id.startsWith('parcel:land')) ? landRows : [],
    ownerStats: selectedItemIds.some((id) => id.startsWith('parcel:owner'))
      ? [
          { label: '개인', count: 8, area: '28,000㎡', ratio: '66.7%' },
          { label: '국유', count: 3, area: '11,000㎡', ratio: '26.2%' },
          { label: '법인', count: 1, area: '3,000㎡', ratio: '7.1%' },
        ]
      : [],
    jimokStats: selectedItemIds.some((id) => id.startsWith('parcel:jimok'))
      ? [
          { jimok: '대', count: 5, area: '19,000㎡', ratio: '45.2%' },
          { jimok: '전', count: 4, area: '14,000㎡', ratio: '33.3%' },
          { jimok: '답', count: 3, area: '9,000㎡', ratio: '21.5%' },
        ]
      : [],
    buildingRows: selectedItemIds.includes('building:ledger') && USE_DUMMY_BUILDING_LEDGER
      ? DUMMY_BUILDING_LEDGER_ROWS
      : [],
    facilityStats: {},
    landUseStats: selectedItemIds.includes('parcel:landUse')
      ? [{ zone: '제2종일반주거지역', count: 5, area: '12,000㎡', ratio: '28.6%' }]
      : [],
  };
}

export type ResultSectionKind =
  | 'land'
  | 'owner'
  | 'jimok'
  | 'landUse'
  | 'building'
  | 'basicMap'
  | 'facility'
  | 'placeholder';

export type ResultSectionDef = {
  id: string;
  groupTitle: string;
  itemTitle: string;
  kind: ResultSectionKind;
  /** 기본도 합성 지도 — 선택된 basicMap:* id 목록 */
  basicMapLayerIds?: string[];
};

const ITEM_SECTION_MAP: Record<string, ResultSectionKind> = {
  'parcel:land': 'land',
  'parcel:owner': 'owner',
  'parcel:jimok': 'jimok',
  'parcel:landUse': 'landUse',
  'building:ledger': 'building',
  'basicMap:aerial': 'basicMap',
  'basicMap:jijuk': 'basicMap',
  'basicMap:building': 'basicMap',
  'basicMap:road': 'basicMap',
};

function resolveSectionKind(itemId: string): ResultSectionKind {
  if (ITEM_SECTION_MAP[itemId]) return ITEM_SECTION_MAP[itemId];
  if (itemId.startsWith('facility:')) return 'facility';
  return 'placeholder';
}

export function buildResultSections(
  selectedItemIds: string[],
  groups: ParcelAnalysisGroupDef[]
): ResultSectionDef[] {
  const sections: ResultSectionDef[] = [];
  const order = ['basicMap', 'building', 'parcel', 'facility'];

  for (const groupId of order) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) continue;

    if (groupId === 'basicMap') {
      const selectedBasic = group.items.filter((item) => selectedItemIds.includes(item.id));
      if (!selectedBasic.length) continue;
      const layerIds = selectedBasic.map((item) => item.id);
      sections.push({
        id: BASIC_MAP_COMPOSITE_SECTION_ID,
        groupTitle: group.title,
        itemTitle: group.title,
        kind: 'basicMap',
        basicMapLayerIds: layerIds,
      });
      continue;
    }

    for (const item of group.items) {
      if (!selectedItemIds.includes(item.id)) continue;
      sections.push({
        id: item.id,
        groupTitle: group.title,
        itemTitle: item.title,
        kind: resolveSectionKind(item.id),
      });
    }
  }
  return sections;
}
