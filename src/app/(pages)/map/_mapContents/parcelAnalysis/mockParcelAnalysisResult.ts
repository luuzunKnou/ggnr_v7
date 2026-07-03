import type { ParcelAnalysisGroupDef } from './parcelAnalysisItems';

export type MockLandRow = {
  pnu: string;
  addr: string;
  jimok: string;
  area: string;
  ownerType: string;
};

export type MockOwnerStat = { label: string; count: number; area: string; ratio: string };
export type MockJimokStat = { jimok: string; count: number; area: string; ratio: string };

export type MockParcelAnalysisResult = {
  parcelCount: number;
  totalAreaSqm: number;
  itemCount: number;
  landRows: MockLandRow[];
  ownerStats: MockOwnerStat[];
  jimokStats: MockJimokStat[];
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
  };
}

export type ResultSectionDef = {
  id: string;
  groupTitle: string;
  itemTitle: string;
  kind: 'land' | 'owner' | 'jimok' | 'placeholder';
};

const ITEM_SECTION_MAP: Record<string, ResultSectionDef['kind']> = {
  'parcel:land': 'land',
  'parcel:owner': 'owner',
  'parcel:jimok': 'jimok',
};

export function buildResultSections(
  selectedItemIds: string[],
  groups: ParcelAnalysisGroupDef[]
): ResultSectionDef[] {
  const sections: ResultSectionDef[] = [];
  const order = ['basicMap', 'building', 'parcel', 'facility'];

  for (const groupId of order) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) continue;
    for (const item of group.items) {
      if (!selectedItemIds.includes(item.id)) continue;
      const kind = ITEM_SECTION_MAP[item.id] ?? 'placeholder';
      sections.push({
        id: item.id,
        groupTitle: group.title,
        itemTitle: item.title,
        kind,
      });
    }
  }
  return sections;
}
