'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Switch } from '@/app/shadcnComponents/ui/switch';

export type ParcelAnalysisItemDef = {
  id: string;
  title: string;
  description?: string;
};

export type ParcelAnalysisGroupDef = {
  id: string;
  title: string;
  items: ParcelAnalysisItemDef[];
};

/** v6 data.json 구조 + 시설목록(1차 mock) */
export const PARCEL_ANALYSIS_GROUPS: ParcelAnalysisGroupDef[] = [
  {
    id: 'basicMap',
    title: '기본도',
    items: [
      { id: 'basicMap:aerial', title: '항공영상', description: '결과보고서 배경 항공영상' },
      { id: 'basicMap:jijuk', title: '연속지적도', description: '연속지적도·지번주소' },
      { id: 'basicMap:building', title: '건물 및 건물군' },
      { id: 'basicMap:road', title: '실폭도로' },
    ],
  },
  {
    id: 'building',
    title: '건축물',
    items: [{ id: 'building:ledger', title: '건축물대장', description: '건축물대장 현황 분석' }],
  },
  {
    id: 'parcel',
    title: '필지분석',
    items: [
      { id: 'parcel:land', title: '토지현황', description: '필지 목록·필지정보' },
      { id: 'parcel:owner', title: '소유자 현황' },
      { id: 'parcel:jimok', title: '지목별 현황' },
      { id: 'parcel:landUse', title: '토지이용계획 현황' },
    ],
  },
  {
    id: 'facility',
    title: '시설목록 현황',
    items: [],
  },
];

export const ALL_PARCEL_ITEM_IDS = PARCEL_ANALYSIS_GROUPS.flatMap((g) =>
  g.items.map((i) => i.id)
);

/** 시설목록 제외 고정 그룹 — SSR·수화 전 표시용 */
export const STATIC_PARCEL_ANALYSIS_GROUPS = PARCEL_ANALYSIS_GROUPS.filter((g) => g.id !== 'facility');

export const STATIC_PARCEL_ITEM_IDS = STATIC_PARCEL_ANALYSIS_GROUPS.flatMap((g) =>
  g.items.map((i) => i.id)
);

export type FacilityLayerMeta = {
  layerKey: string;
  layerKorName: string;
  geomType: string;
  schema: string;
  physicalTableName?: string;
  rowFilterSql?: string | null;
};

type FacilityCatalogResponse = {
  ok?: boolean;
  groups?: Array<{
    id: string;
    title: string;
    description: string;
    layers: FacilityLayerMeta[];
    wmsLayerKeys?: string[];
  }>;
};

export function useParcelAnalysisGroups(isOpen: boolean) {
  const [facilityLayerMap, setFacilityLayerMap] = useState<Record<string, FacilityLayerMeta[]>>({});
  const [facilityWmsLayerMap, setFacilityWmsLayerMap] = useState<Record<string, string[]>>({});
  const [facilityItems, setFacilityItems] = useState<ParcelAnalysisGroupDef['items']>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFacilityLayerMap({});
      setFacilityWmsLayerMap({});
      setFacilityItems([]);
      setCatalogLoaded(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'mapAnalyseService',
          action: 'getParcelAnalysisFacilityCatalog',
          params: {},
        });
        const data = (res?.data ?? res) as FacilityCatalogResponse | undefined;
        if (cancelled) return;
        const groups = data?.groups ?? [];
        const layerMap: Record<string, FacilityLayerMeta[]> = {};
        const wmsMap: Record<string, string[]> = {};
        const items = groups.map((g) => {
          const layerCount = g.layers?.length ?? 0;
          layerMap[g.id] = g.layers ?? [];
          if (g.wmsLayerKeys?.length) wmsMap[g.id] = g.wmsLayerKeys;
          const baseTitle = g.title;
          return {
            id: g.id,
            title: layerCount > 0 ? `${baseTitle} (${layerCount}개)` : baseTitle,
            description: g.description,
          };
        });
        setFacilityLayerMap(layerMap);
        setFacilityWmsLayerMap(wmsMap);
        setFacilityItems(items);
      } catch {
        if (!cancelled) {
          setFacilityLayerMap({});
          setFacilityWmsLayerMap({});
          setFacilityItems([]);
        }
      } finally {
        if (!cancelled) setCatalogLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const groups = useMemo<ParcelAnalysisGroupDef[]>(() => {
    const staticGroups = PARCEL_ANALYSIS_GROUPS.filter((g) => g.id !== 'facility');
    if (!facilityItems.length) return staticGroups;
    return [...staticGroups, { id: 'facility', title: '시설목록 현황', items: facilityItems }];
  }, [facilityItems]);

  const allItemIds = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.id)), [groups]);

  return { groups, allItemIds, facilityLayerMap, facilityWmsLayerMap, catalogLoaded };
}

type Props = {
  groups: ParcelAnalysisGroupDef[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  disabled?: boolean;
  itemsReady?: boolean;
};

const CHECKBOX_CLASS =
  'size-3.5 shrink-0 cursor-pointer rounded border-border text-primary focus:ring-primary/30';

function bulkSwitchTitle(allOn: boolean): string {
  return allOn ? '전체 해제' : '전체 선택';
}

function initialOpenGroups(groups: ParcelAnalysisGroupDef[]): Record<string, boolean> {
  const initial: Record<string, boolean> = {};
  for (const g of groups) initial[g.id] = true;
  return initial;
}

export function ParcelAnalysisItemSelector({
  groups,
  selectedIds,
  onSelectedIdsChange,
  disabled,
  itemsReady = true,
}: Props) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => initialOpenGroups(groups));

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (!(g.id in next)) next[g.id] = true;
      }
      return next;
    });
  }, [groups]);

  const allItemIds = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.id)), [groups]);
  const totalCount = allItemIds.length;
  const selectedCount = selectedIds.size;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const someSelected = selectedCount > 0 && !allSelected;

  const toggleGroupOpen = useCallback((groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  const setAll = useCallback(
    (on: boolean) => {
      onSelectedIdsChange(on ? new Set(allItemIds) : new Set());
    },
    [onSelectedIdsChange, allItemIds]
  );

  const setGroupAll = useCallback(
    (groupId: string, on: boolean) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      const next = new Set(selectedIds);
      for (const item of group.items) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      onSelectedIdsChange(next);
    },
    [selectedIds, onSelectedIdsChange]
  );

  const toggleItem = useCallback(
    (itemId: string) => {
      const next = new Set(selectedIds);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      onSelectedIdsChange(next);
    },
    [selectedIds, onSelectedIdsChange]
  );

  const groupStats = useMemo(() => {
    const stats: Record<
      string,
      { allOn: boolean; someOn: boolean; selected: number; total: number }
    > = {};
    for (const group of groups) {
      const groupIds = group.items.map((i) => i.id);
      const selected = groupIds.filter((id) => selectedIds.has(id)).length;
      stats[group.id] = {
        allOn: selected === groupIds.length && groupIds.length > 0,
        someOn: selected > 0 && selected < groupIds.length,
        selected,
        total: groupIds.length,
      };
    }
    return stats;
  }, [selectedIds, groups]);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', disabled && 'pointer-events-none opacity-50')}>
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-muted-foreground">분석 항목</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {itemsReady ? `${selectedCount}/${totalCount} 선택` : '항목 불러오는 중…'}
            </p>
          </div>
          <Switch
            id="parcel-analysis-all"
            aria-label={bulkSwitchTitle(allSelected)}
            title={bulkSwitchTitle(allSelected)}
            checked={allSelected}
            indeterminate={someSelected}
            disabled={!itemsReady}
            onCheckedChange={(on) => setAll(on || someSelected)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group) => {
          const { allOn, someOn, selected, total } = groupStats[group.id];
          const isOpen = openGroups[group.id] !== false;
          const groupSwitchId = `parcel-group-${group.id}`;

          return (
            <div key={group.id} className="mb-3 last:mb-0">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => toggleGroupOpen(group.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 py-0.5 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-[12px] font-semibold text-muted-foreground">{group.title}</span>
                  {!isOpen && (allOn || someOn) && (
                    <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                      {selected}/{total}
                    </span>
                  )}
                </button>
                <Switch
                  id={groupSwitchId}
                  aria-label={`${group.title} ${bulkSwitchTitle(allOn)}`}
                  title={bulkSwitchTitle(allOn)}
                  checked={allOn}
                  indeterminate={someOn}
                  disabled={!itemsReady}
                  onCheckedChange={(on) => setGroupAll(group.id, on || someOn)}
                />
              </div>

              {isOpen && (
                <ul className="ml-1.5 mt-1 space-y-0.5 border-l border-border pl-2">
                  {group.items.map((item) => {
                    const checked = selectedIds.has(item.id);
                    return (
                      <li key={item.id}>
                        <label
                          className="flex cursor-pointer items-center gap-2 rounded py-1 pr-1 hover:bg-muted/60"
                          title={item.description}
                        >
                          <input
                            type="checkbox"
                            className={CHECKBOX_CLASS}
                            checked={checked}
                            onChange={() => toggleItem(item.id)}
                          />
                          <span className="text-[11px] text-muted-foreground">{item.title}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
