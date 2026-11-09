"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Files, Search, Waves, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  riverBasicPlanAsDefineTable,
  riverBasicPlanRiverNameFilterableLayers,
  buildRiverBasicPlanRiverNameCqlByLayer,
  buildRiverBasicPlanReportRiversCqlByLayer,
  type RiverBasicPlanTab,
} from "@/lib/riverBasicPlanMapAttachmentLayers";
import { useMapContext } from "../../../_mapComponents/MapContext";
import {
  ServiceFilePdfPreview,
  type ServiceFilePdfPreviewItem,
} from "../../../_mapComponents/standard/ServiceFilePdfPreview";
import { useRiverBasicPlanExistingMapLayers } from "./useRiverBasicPlanExistingMapLayers";
import { useRiverBasicPlanFocusRiver, useRiverBasicPlanFocusRivers } from "./useRiverBasicPlanFocusRiver";
import { useRiverBasicPlanReportFolders } from "./useRiverBasicPlanReportFolders";
import { RiverOrthoControl } from "./riverOrtho/RiverOrthoControl";
import type { RiverBasicPlanPreferredPlan } from "./RiverBasicPlanDetailPanel";
import type { RiverBasicPlanListAxis } from "./RiverBasicPlanScopeModal";
import { RiverBasicPlanReportCardList } from "./RiverBasicPlanReportCardList";
import {
  riverBasicPlanPlanKey,
  riverBasicPlanReportPdfItems,
  riverBasicPlanShownRivers,
  riverBasicPlanYearLabel,
  type RiverBasicPlanReportPlan,
  type RiverBasicPlanReportRiver,
} from "./riverBasicPlanReportPlans";
type RiverType = RiverBasicPlanTab;

type RiverItem = {
  riverName: string;
  riverType: string | null;
  riverCode: string;
  /** 같은 하천명이 하천코드로 나뉠 때만 — rivp_name 의 `_` 뒤 값 */
  rivpLabel: string;
  count: number;
};

type PlanListItem = RiverBasicPlanReportPlan;

type Props = {
  tab: RiverType;
  onTabChange: (tab: RiverType) => void;
  /** null이면 보기 미선택 — 모달 유도 */
  listAxis: RiverBasicPlanListAxis | null;
  selectedRiver: string;
  /** 상세·목록에서 고른 계획 — 보고서별 카드 선택 표시 */
  preferredPlan?: RiverBasicPlanPreferredPlan | null;
  onSelectRiver: (riverName: string, preferredPlan?: RiverBasicPlanPreferredPlan | null) => void;
  /** 보고서 기준 보기 ⇄ 하천 기준 보기 바로 전환 */
  onChangeAxis: (axis: RiverBasicPlanListAxis) => void;
  onClose: () => void;
};

const AXIS_OPTIONS: {
  axis: RiverBasicPlanListAxis;
  label: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { axis: "byPlan", label: "보고서 기준", desc: "보고서 묶음별", icon: Files },
  { axis: "byRiver", label: "하천 기준", desc: "하천 이름별", icon: Waves },
];

function defaultLayersForTab(tab: RiverType): readonly string[] {
  return riverBasicPlanRiverNameFilterableLayers(tab);
}

export function RiverBasicPlanListPanel({
  tab,
  onTabChange,
  listAxis,
  selectedRiver,
  preferredPlan = null,
  onSelectRiver,
  onChangeAxis,
  onClose,
}: Props) {
  /** 보고서별 — 하천 목록이 펼쳐진 카드(하천 2곳 이상) */
  const [openedPlanKey, setOpenedPlanKey] = useState<string | null>(null);
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const [keyword, setKeyword] = useState("");
  /** 보고서별 연도 필터 — 빈 문자열이면 전체 */
  const [planYear, setPlanYear] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riverItems, setRiverItems] = useState<RiverItem[]>([]);
  const [planItems, setPlanItems] = useState<PlanListItem[]>([]);
  /** 보고서 폴더 구성(바로 있는 PDF·하천 폴더) — null 이면 확인 중 */
  const folderSummary = useRiverBasicPlanReportFolders(tab, listAxis === "byPlan");
  const [reportPreview, setReportPreview] = useState<{
    items: ServiceFilePdfPreviewItem[];
    initialIndex: number;
  } | null>(null);
  /** 카드 선택 표시 — 목록·상세에서 고른 계획과 같음 */
  const selectedPlanKey = preferredPlan ? riverBasicPlanPlanKey(preferredPlan) : null;
  const existingMapLayers = useRiverBasicPlanExistingMapLayers(tab);
  const axisReady = listAxis != null;

  useEffect(() => {
    const ctx = mapContextRef.current;
    if (!ctx?.setVisibleLayerNames) return;
    const thisTabLayers = defaultLayersForTab(tab);
    const offLayers = defaultLayersForTab(tab === "smallRiver" ? "river" : "smallRiver");
    const onLayers = existingMapLayers ?? [];
    ctx.setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of offLayers) {
        if (next.delete(id)) changed = true;
      }
      for (const id of thisTabLayers) {
        if (!onLayers.includes(id) && next.delete(id)) changed = true;
      }
      if (existingMapLayers != null) {
        for (const id of onLayers) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
    return () => {
      const c = mapContextRef.current;
      if (!c?.setVisibleLayerNames) return;
      c.setVisibleLayerNames((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of [...thisTabLayers, ...offLayers]) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : prev;
      });
      c.setServiceWmsCqlByLayer?.(null);
    };
  }, [tab, existingMapLayers]);

  const listHasRows =
    listAxis === "byRiver" ? riverItems.length > 0 : planItems.length > 0;

  useEffect(() => {
    const ctx = mapContextRef.current;
    if (!ctx?.setVisibleLayerNames || loading || !axisReady) return;
    if (existingMapLayers == null) return;
    const onLayers = existingMapLayers;
    const enableCurrent = !error && listHasRows;
    ctx.setVisibleLayerNames((prev) => {
      const next = new Set(prev);
      let changed = false;
      if (enableCurrent) {
        for (const id of onLayers) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
      } else {
        for (const id of defaultLayersForTab(tab)) {
          if (next.delete(id)) changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tab, loading, error, listHasRows, existingMapLayers, axisReady]);

  /** 하천 목록이 열린 보고서 — 하천을 아직 고르지 않았으면 그 보고서 하천 전체를 지도에 */
  const openedPlan = useMemo(
    () => (openedPlanKey ? (planItems.find((p) => riverBasicPlanPlanKey(p) === openedPlanKey) ?? null) : null),
    [openedPlanKey, planItems]
  );

  useEffect(() => {
    const setCql = mapContextRef.current?.setServiceWmsCqlByLayer;
    if (!setCql) return;
    if (!selectedRiver && openedPlan) {
      setCql(
        buildRiverBasicPlanReportRiversCqlByLayer(
          tab,
          riverBasicPlanShownRivers(openedPlan).map((r) => r.riverName),
          openedPlan
        )
      );
      return;
    }
    setCql(buildRiverBasicPlanRiverNameCqlByLayer(tab, selectedRiver));
  }, [tab, selectedRiver, openedPlan]);

  const [resetKey, setResetKey] = useState(`${tab}|${listAxis}`);
  if (resetKey !== `${tab}|${listAxis}`) {
    setResetKey(`${tab}|${listAxis}`);
    setKeyword("");
    setPlanYear("");
    setOpenedPlanKey(null);
  }

  useEffect(() => {
    if (!listAxis) {
      setRiverItems([]);
      setPlanItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        if (listAxis === "byRiver") {
          const res = await call("", "POST", {
            service: "riverBasicPlanService",
            action: "getRiverBasicPlanRiverList",
            params: { tab, keyword },
          });
          const data = res?.data ?? res;
          setRiverItems(Array.isArray(data?.rivers) ? data.rivers : []);
          setPlanItems([]);
        } else {
          const res = await call("", "POST", {
            service: "riverBasicPlanService",
            action: "getRiverBasicPlanPlanList",
            params: { tab, keyword },
          });
          const data = res?.data ?? res;
          setPlanItems(Array.isArray(data?.plans) ? data.plans : []);
          setRiverItems([]);
        }
      } catch (e: unknown) {
        setRiverItems([]);
        setPlanItems([]);
        setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [tab, keyword, listAxis]);

  const focusRiver = useRiverBasicPlanFocusRiver(tab);
  const focusRivers = useRiverBasicPlanFocusRivers(tab);

  const selectRiver = useCallback(
    async (riverName: string, preferredPlan?: RiverBasicPlanPreferredPlan | null) => {
      onSelectRiver(riverName, preferredPlan ?? null);
      await focusRiver(riverName);
    },
    [onSelectRiver, focusRiver]
  );

  const planAsLayer = riverBasicPlanAsDefineTable(tab);

  /** 보고서 하천 → 그 보고서 기준 상세 */
  const handleSelectPlanRiver = useCallback(
    (plan: PlanListItem, river: RiverBasicPlanReportRiver) => {
      void selectRiver(river.riverName, {
        planYear: plan.planYear,
        planName: plan.planName,
        rivpSuffix: plan.rivpSuffix,
        planLen: river.planLen,
        riverType: river.riverType,
        riverCode: river.riverCode,
      });
    },
    [selectRiver]
  );

  /**
   * 카드 — 하천이 한 곳이면 그 하천 상세를 바로 연다.
   * 여러 곳이면 카드 아래로 하천 목록을 펼치고(다시 누르면 접음), 하천을 고르지 않은 채 보고서 하천 전체가 지도에 보이게 한다.
   */
  const handleOpenPlan = useCallback(
    (plan: PlanListItem) => {
      const rivers = riverBasicPlanShownRivers(plan);
      if (rivers.length <= 1) {
        setOpenedPlanKey(null);
        if (rivers[0]) handleSelectPlanRiver(plan, rivers[0]);
        return;
      }
      const key = riverBasicPlanPlanKey(plan);
      if (openedPlanKey === key) {
        setOpenedPlanKey(null);
        return;
      }
      setOpenedPlanKey(key);
      onSelectRiver("", null);
      void focusRivers(rivers.map((r) => r.riverName));
    },
    [openedPlanKey, handleSelectPlanRiver, onSelectRiver, focusRivers]
  );

  /** 카드 «보고서» — 계획 폴더 바로 아래 PDF와 하천별 폴더 PDF를 함께 열기 */
  const handleOpenReport = useCallback(
    (plan: PlanListItem) => {
      const items = riverBasicPlanReportPdfItems(plan, folderSummary, planAsLayer);
      if (items.length > 0) setReportPreview({ items, initialIndex: 0 });
    },
    [folderSummary, planAsLayer]
  );

  const title = useMemo(
    () => (tab === "smallRiver" ? "소하천 기본계획" : "지방하천 기본계획"),
    [tab]
  );

  const searchPlaceholder =
    listAxis === "byRiver" ? "하천명 통합검색" : "보고서·하천명 검색";

  /** 보고서별 연도 선택 — 다른 업무(개발부담금 등)와 같은 «전체 연도» 선택상자. 검색으로 사라진 연도면 전체 */
  const yearOptions = useMemo(
    () => [...new Set(planItems.map((p) => p.planYear).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [planItems]
  );
  const activePlanYear = planYear && yearOptions.includes(planYear) ? planYear : "";
  const shownPlans = useMemo(
    () => (activePlanYear ? planItems.filter((p) => p.planYear === activePlanYear) : planItems),
    [planItems, activePlanYear]
  );

  return (
    <div className="flex flex-col min-h-0 h-full bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2 pb-1.5">
        <p className="min-w-0 flex-1 text-sm font-semibold text-foreground truncate">{title}</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-1.5 border-b border-border px-3 pb-2.5" role="tablist" aria-label="목록 기준">
        {AXIS_OPTIONS.map(({ axis, label, desc, icon: Icon }) => {
          const active = listAxis === axis;
          return (
            <button
              key={axis}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (!active) onChangeAxis(axis);
              }}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                active
                  ? "border-primary bg-primary/[0.06] ring-1 ring-inset ring-primary/40"
                  : "border-border bg-background hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              <span
                className={cn(
                  "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
                aria-hidden
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate text-xs font-semibold leading-4",
                    active ? "text-primary" : "text-foreground"
                  )}
                >
                  {label}
                </span>
                <span className="block truncate text-[10px] leading-4 text-muted-foreground">{desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 border-b border-border bg-background">
        <div className="flex">
          <button
            type="button"
            onClick={() => onTabChange("river")}
            className={cn(
              "w-1/2 px-3 py-2 text-xs font-medium text-center transition-colors",
              tab === "river"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            지방하천
          </button>
          <button
            type="button"
            onClick={() => onTabChange("smallRiver")}
            className={cn(
              "w-1/2 px-3 py-2 text-xs font-medium text-center transition-colors",
              tab === "smallRiver"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            소하천
          </button>
        </div>
      </div>

      {!axisReady ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8">
          <p className="text-sm text-muted-foreground text-center">
            위에서 «보고서 기준» 또는 «하천 기준»을 고르세요.
          </p>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="flex items-center gap-1.5">
              {listAxis === "byPlan" ? (
                <select
                  className="standard-filter-select h-9 w-[6.5rem] max-w-none"
                  value={activePlanYear}
                  onChange={(e) => setPlanYear(e.target.value)}
                  aria-label="기본계획 연도"
                >
                  <option value="">전체 연도</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {riverBasicPlanYearLabel(y)}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="relative min-w-0 flex-1">
                <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full h-9 rounded border border-border pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
                />
              </div>
            </div>
            <RiverOrthoControl tab={tab} />
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {loading && !listHasRows ? (
              <p className="text-sm text-muted-foreground px-4 py-4">불러오는 중...</p>
            ) : error ? (
              <p className="text-sm px-4 py-4 text-destructive">{error}</p>
            ) : listAxis === "byRiver" ? (
              riverItems.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-4">검색 결과가 없습니다.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {riverItems.map((item) => {
                    /** 같은 하천명이 하천코드로 나뉜 항목은 하천코드까지 같아야 선택 표시 */
                    const active =
                      selectedRiver === item.riverName &&
                      (!item.rivpLabel || preferredPlan?.riverCode === item.riverCode);
                    return (
                      <li key={`${item.riverName}-${item.riverCode}`}>
                        <button
                          type="button"
                          onClick={() =>
                            void selectRiver(
                              item.riverName,
                              item.rivpLabel
                                ? {
                                    planYear: "",
                                    planName: "",
                                    rivpSuffix: "",
                                    riverType: item.riverType ?? undefined,
                                    riverCode: item.riverCode,
                                  }
                                : null
                            )
                          }
                          className={cn(
                            "w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors",
                            active && "bg-primary/10"
                          )}
                        >
                          <div className="flex items-center justify-between gap-3 min-w-0">
                            <p
                              className={cn(
                                "text-sm font-medium truncate min-w-0",
                                active ? "text-primary" : "text-foreground"
                              )}
                              title={item.rivpLabel ? `${item.riverName} ${item.rivpLabel}` : item.riverName}
                            >
                              {item.riverName}
                              {item.rivpLabel ? (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  {item.rivpLabel}
                                </span>
                              ) : null}
                            </p>
                            <span className="text-xs text-muted-foreground shrink-0">
                              기본계획 {item.count}건
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : planItems.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-4">검색 결과가 없습니다.</p>
            ) : (
              <RiverBasicPlanReportCardList
                plans={planItems}
                folderSummary={folderSummary}
                year={activePlanYear || null}
                openedPlanKey={openedPlanKey}
                selectedPlanKey={selectedPlanKey}
                selectedRiver={selectedRiver}
                onOpenPlan={handleOpenPlan}
                onSelectRiver={handleSelectPlanRiver}
                onOpenReport={handleOpenReport}
              />
            )}
          </div>
          {listAxis === "byPlan" && shownPlans.length > 0 ? (
            <div className="standard-list-footer">
              보고서 {shownPlans.length}건 · 하천 {shownPlans.reduce((n, p) => n + p.riverCount, 0)}곳
            </div>
          ) : null}
        </>
      )}
      {reportPreview != null ? (
        <ServiceFilePdfPreview
          items={reportPreview.items}
          initialIndex={reportPreview.initialIndex}
          onClose={() => setReportPreview(null)}
        />
      ) : null}
    </div>
  );
}
