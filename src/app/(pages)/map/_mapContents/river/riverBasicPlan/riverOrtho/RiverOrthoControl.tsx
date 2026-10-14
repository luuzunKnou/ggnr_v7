"use client";

import { useEffect, useMemo, useState } from "react";
import { call } from "@/lib/api";
import {
  pickRiverOrthoGroupsForYear,
  RIVER_ORTHO_KIND_LABEL,
  riverOrthoYears,
  type RiverOrthoGroup,
  type RiverOrthoKind,
} from "@/lib/riverOrthoGroups";
import type { RiverBasicPlanTab as RiverType } from "@/lib/riverBasicPlanMapAttachmentLayers";
import { useRiverOrthoLayers } from "./useRiverOrthoLayers";

const TAB_TO_ORTHO_KIND: Record<RiverType, RiverOrthoKind> = {
  river: "bigriver",
  smallRiver: "smallriver",
};

/** 하천기본계획 목록 통합검색 아래: 드론영상 켜기 + 연도 선택 (현재 탭 종류 영상만) */
export function RiverOrthoControl({ tab }: { tab: RiverType }) {
  const [allGroups, setAllGroups] = useState<RiverOrthoGroup[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [enabledTab, setEnabledTab] = useState(tab);
  if (enabledTab !== tab) {
    setEnabledTab(tab);
    setEnabled(false);
  }
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call("", "POST", {
      service: "riverBasicPlanService",
      action: "listRiverOrthoGroups",
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setAllGroups(Array.isArray(data?.groups) ? (data.groups as RiverOrthoGroup[]) : []);
      })
      .catch(() => {
        if (!cancelled) setAllGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kind = TAB_TO_ORTHO_KIND[tab];
  const groups = useMemo(() => allGroups.filter((g) => g.kind === kind), [allGroups, kind]);
  const years = useMemo(() => riverOrthoYears(groups), [groups]);
  const selectedYear = year != null && years.includes(year) ? year : (years[0] ?? null);
  const shown = useMemo(
    () => (enabled && selectedYear != null ? pickRiverOrthoGroupsForYear(groups, selectedYear) : []),
    [enabled, groups, selectedYear]
  );
  useRiverOrthoLayers(shown.map((g) => g.id));
  if (years.length === 0) return null;

  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
      <label className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-sky-600"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {RIVER_ORTHO_KIND_LABEL[kind]} 드론영상
      </label>
      <select
        className="h-7 w-[100px] shrink-0 rounded border border-border bg-background px-1.5 text-xs text-foreground disabled:opacity-50"
        value={selectedYear ?? ""}
        disabled={!enabled}
        onChange={(e) => setYear(Number(e.target.value))}
        aria-label="드론영상 연도"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}년
          </option>
        ))}
      </select>
    </div>
  );
}
