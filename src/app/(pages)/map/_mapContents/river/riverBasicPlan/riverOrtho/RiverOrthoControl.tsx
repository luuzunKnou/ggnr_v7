"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "@/lib/api";
import {
  pickRiverOrthoGroupsForYear,
  RIVER_ORTHO_KIND_LABEL,
  riverOrthoYears,
  type RiverOrthoGroup,
  type RiverOrthoKind,
} from "@/lib/riverOrthoGroups";
import type { RiverBasicPlanTab as RiverType } from "@/lib/riverBasicPlanMapAttachmentLayers";
import { useMapCorner } from "../../../aerialView/AerialViewerMetaChip";
import { useRiverOrthoLayers } from "./useRiverOrthoLayers";

const TAB_TO_ORTHO_KIND: Record<RiverType, RiverOrthoKind> = {
  river: "bigriver",
  smallRiver: "smallriver",
};

/** 하천기본계획 열림 시 주소검색 아래: 드론영상 켜기 + 연도 선택 (현재 탭 종류 영상만) */
export function RiverOrthoControl({ tab }: { tab: RiverType }) {
  const [allGroups, setAllGroups] = useState<RiverOrthoGroup[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [enabledTab, setEnabledTab] = useState(tab);
  if (enabledTab !== tab) {
    setEnabledTab(tab);
    setEnabled(false);
  }
  const [year, setYear] = useState<number | null>(null);
  const corner = useMapCorner(true);

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
  if (years.length === 0 || !corner || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-30 flex items-center gap-2 rounded-md bg-white/95 px-2.5 py-1.5 text-[12px] shadow-md ring-1 ring-black/10"
      style={{ left: corner.left, top: corner.top }}
    >
      <label className="flex cursor-pointer items-center gap-1.5 font-medium text-slate-800">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-sky-600"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {RIVER_ORTHO_KIND_LABEL[kind]} 드론영상
      </label>
      <select
        className="h-6 rounded border border-slate-300 bg-white px-1 text-[12px] text-slate-800 disabled:opacity-50"
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
    </div>,
    document.body
  );
}
