'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/app/shadcnComponents/ui/switch';
import { ALL_PARCEL_ITEM_IDS, PARCEL_ANALYSIS_GROUPS } from './parcelAnalysisItems';

type Props = {
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  disabled?: boolean;
};

const CHECKBOX_CLASS =
  'size-3.5 shrink-0 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500/30';

function bulkSwitchTitle(allOn: boolean): string {
  return allOn ? '전체 해제' : '전체 선택';
}

function initialOpenGroups(): Record<string, boolean> {
  const initial: Record<string, boolean> = {};
  for (const g of PARCEL_ANALYSIS_GROUPS) initial[g.id] = true;
  return initial;
}

export function ParcelAnalysisItemSelector({ selectedIds, onSelectedIdsChange, disabled }: Props) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpenGroups);

  const totalCount = ALL_PARCEL_ITEM_IDS.length;
  const selectedCount = selectedIds.size;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const someSelected = selectedCount > 0 && !allSelected;

  const toggleGroupOpen = useCallback((groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  const setAll = useCallback(
    (on: boolean) => {
      onSelectedIdsChange(on ? new Set(ALL_PARCEL_ITEM_IDS) : new Set());
    },
    [onSelectedIdsChange]
  );

  const setGroupAll = useCallback(
    (groupId: string, on: boolean) => {
      const group = PARCEL_ANALYSIS_GROUPS.find((g) => g.id === groupId);
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
    for (const group of PARCEL_ANALYSIS_GROUPS) {
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
  }, [selectedIds]);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', disabled && 'pointer-events-none opacity-50')}>
      <div className="shrink-0 border-b border-slate-200 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[#666]">분석 항목</p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {selectedCount}/{totalCount} 선택
            </p>
          </div>
          <Switch
            id="parcel-analysis-all"
            aria-label={bulkSwitchTitle(allSelected)}
            title={bulkSwitchTitle(allSelected)}
            checked={allSelected}
            indeterminate={someSelected}
            onCheckedChange={(on) => setAll(on || someSelected)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {PARCEL_ANALYSIS_GROUPS.map((group) => {
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
                    <ChevronRight className="size-3.5 shrink-0 text-slate-500" />
                  )}
                  <span className="truncate text-[12px] font-semibold text-[#666]">{group.title}</span>
                  {!isOpen && (allOn || someOn) && (
                    <span className="shrink-0 text-[10px] font-normal text-slate-500">
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
                  onCheckedChange={(on) => setGroupAll(group.id, on || someOn)}
                />
              </div>

              {isOpen && (
                <ul className="ml-1.5 mt-1 space-y-0.5 border-l border-slate-200 pl-2">
                  {group.items.map((item) => {
                    const checked = selectedIds.has(item.id);
                    return (
                      <li key={item.id}>
                        <label
                          className="flex cursor-pointer items-center gap-2 rounded py-1 pr-1 hover:bg-slate-50"
                          title={item.description}
                        >
                          <input
                            type="checkbox"
                            className={CHECKBOX_CLASS}
                            checked={checked}
                            onChange={() => toggleItem(item.id)}
                          />
                          <span className="text-[11px] text-[#666]">{item.title}</span>
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
