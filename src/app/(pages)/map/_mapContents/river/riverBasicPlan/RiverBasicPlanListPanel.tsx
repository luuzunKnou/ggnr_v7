"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Search, X } from "lucide-react";
import { call } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SER_FILE_ENG } from "@/lib/serviceFileDataSerEng";
import {
  riverBasicPlanAsDefineTable,
  riverBasicPlanRiverNameFilterableLayers,
  buildRiverBasicPlanRiverNameCqlByLayer,
  type RiverBasicPlanTab,
} from "@/lib/riverBasicPlanMapAttachmentLayers";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { LayerRowPanelButton } from "../../../_mapComponents/layerRowEdit/LayerRowPanelButton";
import { serviceFileDataDownloadUrl } from "../../../_mapComponents/standard/useServiceFileData";
import {
  ServiceFilePdfPreview,
  type ServiceFilePdfPreviewItem,
} from "../../../_mapComponents/standard/ServiceFilePdfPreview";
import { useRiverBasicPlanExistingMapLayers } from "./useRiverBasicPlanExistingMapLayers";
import { RiverOrthoControl } from "./riverOrtho/RiverOrthoControl";
import type { RiverBasicPlanPreferredPlan } from "./RiverBasicPlanDetailPanel";
import type { RiverBasicPlanListAxis } from "./RiverBasicPlanScopeModal";
import {
  RiverBasicPlanReportTree,
  riverBasicPlanTreeKey,
  riverBasicPlanYearLabel,
  type RiverBasicPlanTreePlan,
  type RiverBasicPlanReportFolderSummary,
} from "./RiverBasicPlanReportTree";
type RiverType = RiverBasicPlanTab;

type RiverItem = {
  riverName: string;
  riverType: string | null;
  count: number;
};

type PlanListItem = RiverBasicPlanTreePlan;

type Props = {
  tab: RiverType;
  onTabChange: (tab: RiverType) => void;
  /** null이면 보기 미선택 — 모달 유도 */
  listAxis: RiverBasicPlanListAxis | null;
  selectedRiver: string;
  /** 상세·목록에서 고른 계획 — 보고서별 목록 하이라이트·펼침 동기 */
  preferredPlan?: RiverBasicPlanPreferredPlan | null;
  onSelectRiver: (riverName: string, preferredPlan?: RiverBasicPlanPreferredPlan | null) => void;
  onChangeAxis: () => void;
  onClose: () => void;
};

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
  /** 보고서 폴더 구성(바로 있는 PDF·하천 폴더) — 현재 탭 것이 아니면 확인 중(null) */
  const [folderSummaryState, setFolderSummaryState] = useState<{
    tab: RiverType;
    folders: RiverBasicPlanReportFolderSummary;
  } | null>(null);
  const folderSummary = folderSummaryState?.tab === tab ? folderSummaryState.folders : null;
  const [reportPreview, setReportPreview] = useState<{
    items: ServiceFilePdfPreviewItem[];
    initialIndex: number;
  } | null>(null);
  /** 카드 선택 표시 — 목록·상세에서 고른 계획과 같음 */
  const selectedPlanKey = preferredPlan ? riverBasicPlanTreeKey(preferredPlan) : null;
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

  useEffect(() => {
    const setCql = mapContextRef.current?.setServiceWmsCqlByLayer;
    if (!setCql) return;
    setCql(buildRiverBasicPlanRiverNameCqlByLayer(tab, selectedRiver));
  }, [tab, selectedRiver]);

  const [resetKey, setResetKey] = useState(`${tab}|${listAxis}`);
  if (resetKey !== `${tab}|${listAxis}`) {
    setResetKey(`${tab}|${listAxis}`);
    setKeyword("");
    setPlanYear("");
  }

  /** 보고서별 — 탭마다 보고서 폴더 구성을 한 번 조회 */
  useEffect(() => {
    if (listAxis !== "byPlan") return;
    let cancelled = false;
    void call("", "POST", {
      service: "riverBasicPlanService",
      action: "getRiverBasicPlanReportFolderSummary",
      params: { tab },
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setFolderSummaryState({
          tab,
          folders:
            data?.folders && typeof data.folders === "object"
              ? (data.folders as RiverBasicPlanReportFolderSummary)
              : {},
        });
      })
      .catch(() => {
        if (!cancelled) setFolderSummaryState({ tab, folders: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, listAxis]);

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

  const fitRiverExtent = useCallback(
    async (riverName: string) => {
      try {
        let res = await call("", "POST", {
          service: "riverBasicPlanService",
          action: "getRiverBasicPlanIndexExtent",
          params: { tab, riverName },
        });
        let data = res?.data ?? res;
        let ext = Array.isArray(data?.extent3857) ? data.extent3857 : null;
        if (!ext || ext.length !== 4) {
          res = await call("", "POST", {
            service: "riverBasicPlanService",
            action: "getRiverBasicPlanExtent",
            params: { tab, riverName },
          });
          data = res?.data ?? res;
          ext = Array.isArray(data?.extent3857) ? data.extent3857 : null;
        }
        const map = mapContext?.mapInstanceRef?.current;
        if (!map || !ext || ext.length !== 4) return;
        scheduleFitMapToExtent3857(map, ext as number[], {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          pointThreshold: 1,
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
      } catch {
        // ignore
      }
    },
    [tab, mapContext]
  );

  const selectRiver = useCallback(
    async (riverName: string, preferredPlan?: RiverBasicPlanPreferredPlan | null) => {
      onSelectRiver(riverName, preferredPlan ?? null);
      mapContext?.riverBasicPlanExitIndexViewToDetailRef?.current?.();
      await fitRiverExtent(riverName);
    },
    [onSelectRiver, mapContext, fitRiverExtent]
  );

  const planAsLayer = riverBasicPlanAsDefineTable(tab);

  /** 트리의 하천 행 — 그 보고서 기준으로 하천 상세 */
  const handleSelectCardRiver = useCallback(
    (plan: PlanListItem, river: { riverName: string; planLen: string }) => {
      void selectRiver(river.riverName, {
        planYear: plan.planYear,
        planName: plan.planName,
        rivpSuffix: plan.rivpSuffix,
        planLen: river.planLen,
      });
    },
    [selectRiver]
  );

  /** 트리 보고서 행의 «보고서» — 계획 폴더에 바로 있는 PDF(모든 하천 공통)를 하천 선택 없이 열기 */
  const handleOpenSharedReport = useCallback(
    (_plan: PlanListItem, folderKey: string, pdfNames: string[]) => {
      setReportPreview({
        items: pdfNames.map((name) => ({
          url: serviceFileDataDownloadUrl(SER_FILE_ENG.riverBasicPlan, planAsLayer, folderKey, name),
          fileName: name,
        })),
        initialIndex: 0,
      });
    },
    [planAsLayer]
  );

  const title = useMemo(
    () => (tab === "smallRiver" ? "소하천 기본계획" : "지방하천 기본계획"),
    [tab]
  );

  const axisLabel = listAxis === "byRiver" ? "하천별" : listAxis === "byPlan" ? "보고서별" : "";

  const searchPlaceholder =
    listAxis === "byRiver" ? "하천명 통합검색" : "보고서·하천명 검색";

  /** 보고서별 연도 선택 — 다른 업무(개발부담금 등)와 같은 «전체 연도» 선택상자. 검색으로 사라진 연도면 전체 */
  const yearOptions = useMemo(
    () => [...new Set(planItems.map((p) => p.planYear).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [planItems]
  );
  const activePlanYear = planYear && yearOptions.includes(planYear) ? planYear : "";

  return (
    <div className="flex flex-col min-h-0 h-full bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{title}</p>
          {axisReady ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{axisLabel} 목록</p>
          ) : (
            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">목록 보기를 선택하세요</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <LayerRowPanelButton
            type="button"
            title={axisReady ? `보기 변경 (현재 ${axisLabel})` : "목록 보기 선택"}
            onClick={onChangeAxis}
            className="border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
          >
            <Pencil className="h-3 w-3 shrink-0" aria-hidden />
            {axisReady ? "보기 변경" : "보기 선택"}
          </LayerRowPanelButton>
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
            위 «보기 선택»에서 목록 기준을 고르세요.
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
                    const active = selectedRiver === item.riverName;
                    return (
                      <li key={`${item.riverName}-${item.riverType ?? ""}`}>
                        <button
                          type="button"
                          onClick={() => void selectRiver(item.riverName, null)}
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
                            >
                              {item.riverName}
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
              <RiverBasicPlanReportTree
                plans={planItems}
                folderSummary={folderSummary}
                keyword={keyword}
                selectedPlanKey={selectedPlanKey}
                selectedRiver={selectedRiver}
                onSelectRiver={handleSelectCardRiver}
                onOpenReport={handleOpenSharedReport}
                year={activePlanYear || null}
              />
            )}
          </div>
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
