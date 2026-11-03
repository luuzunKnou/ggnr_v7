"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFiniteNumberKoTrimZeros } from "@/lib/formatDetailScalar";
import { buildRiverBasicPlanReportPlanFolderKeyFromParts } from "./riverBasicPlanReportFolder";

export type RiverBasicPlanTreeRiver = {
  riverName: string;
  planLen: string;
  riverType: string;
  riverCode: string;
};

export type RiverBasicPlanTreePlan = {
  planYear: string;
  planName: string;
  rivpSuffix: string;
  riverCount: number;
  rivers?: RiverBasicPlanTreeRiver[];
  totalPlanLen?: number | null;
  /** 검색어가 하천명에 걸린 하천 — 있으면 그 하천만 보여 줌 */
  matchedRivers?: { riverName: string }[];
};

/** 계획 폴더별 보고서 구성 — 서버 폴더 요약 */
export type RiverBasicPlanReportFolderSummary = Record<string, { rootPdfs: string[]; riverFolders: string[] }>;

export function riverBasicPlanTreeKey(p: Pick<RiverBasicPlanTreePlan, "planYear" | "planName" | "rivpSuffix">): string {
  return `${p.planYear}\0${p.planName}\0${p.rivpSuffix}`;
}

export function riverBasicPlanTreeFolderKey(p: RiverBasicPlanTreePlan): string | null {
  return buildRiverBasicPlanReportPlanFolderKeyFromParts({
    planYear: p.planYear,
    planName: p.planName,
    rivpSuffix: p.rivpSuffix,
  });
}

function planTitle(p: RiverBasicPlanTreePlan): string {
  return p.rivpSuffix ? `${p.planName}_${p.rivpSuffix}` : p.planName;
}

function formatKm(raw: string | number | null | undefined): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return `${formatFiniteNumberKoTrimZeros(Number(n.toFixed(3)))}km`;
}

const ROW = "flex h-7 w-full items-center gap-1.5 pr-2 text-left transition-colors";
const CHEVRON = "size-3.5 shrink-0 text-muted-foreground";

type Props = {
  plans: RiverBasicPlanTreePlan[];
  /** null이면 폴더 확인 중 */
  folderSummary: RiverBasicPlanReportFolderSummary | null;
  keyword: string;
  selectedPlanKey: string | null;
  selectedRiver: string;
  onSelectRiver: (plan: RiverBasicPlanTreePlan, river: RiverBasicPlanTreeRiver) => void;
  /** 계획 폴더에 바로 있는 PDF(모든 하천 공통 보고서) 열기 */
  onOpenReport: (plan: RiverBasicPlanTreePlan, folderKey: string, pdfNames: string[]) => void;
  /**
   * filter: 연도는 목록 위 «연도» 선택상자로 고르고 트리는 보고서 > 하천 두 단계 (기본)
   * tree: 연도 > 보고서 > 하천 세 단계 트리
   */
  yearLayout?: "filter" | "tree";
  /** filter 일 때 고른 연도 — null이면 전체 */
  year?: string | null;
};

export function riverBasicPlanYearLabel(year: string): string {
  return /^\d+$/.test(year) ? `${year}년` : year;
}

/**
 * 보고서별 — 파일 탐색기처럼 한 줄 트리.
 * 보고서는 선택·검색 걸린 것만 펼침. 하천 1곳 보고서는 누르면 바로 상세.
 */
export function RiverBasicPlanReportTree({
  plans,
  folderSummary,
  keyword,
  selectedPlanKey,
  selectedRiver,
  onSelectRiver,
  onOpenReport,
  yearLayout = "filter",
  year = null,
}: Props) {
  const kw = keyword.trim().toLowerCase();
  /** 사용자가 직접 접고 편 상태 — 없으면 기본값(연도: 펼침, 보고서: 선택·검색일 때 펼침) */
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const isOpen = (id: string, fallback: boolean) => (toggled.has(id) ? toggled.get(id)! : fallback);
  const toggle = (id: string, current: boolean) =>
    setToggled((prev) => {
      const next = new Map(prev);
      next.set(id, !current);
      return next;
    });

  const years = useMemo(() => {
    const out: { year: string; plans: RiverBasicPlanTreePlan[] }[] = [];
    for (const p of plans) {
      const year = p.planYear || "연도 미상";
      const last = out[out.length - 1];
      if (last && last.year === year) last.plans.push(p);
      else out.push({ year, plans: [p] });
    }
    return out;
  }, [plans]);

  const filteredPlans = year ? plans.filter((p) => p.planYear === year) : plans;

  const renderPlan = (plan: RiverBasicPlanTreePlan, showYear: boolean) => {
    const key = riverBasicPlanTreeKey(plan);
    const planActive = selectedPlanKey === key;
    const folderKey = riverBasicPlanTreeFolderKey(plan);
    const folder = folderKey && folderSummary ? folderSummary[folderKey] : undefined;
    const rootPdfs = folder?.rootPdfs ?? [];
    const rivers = plan.rivers ?? [];
    const matchedNames = kw && plan.matchedRivers?.length ? new Set(plan.matchedRivers.map((m) => m.riverName)) : null;
    const shownRivers = matchedNames ? rivers.filter((r) => matchedNames.has(r.riverName)) : rivers;
    const single = rivers.length === 1;
    const planOpen = !single && isOpen(`p:${key}`, planActive || matchedNames != null);
    const riverCountLabel = matchedNames
      ? `하천 ${shownRivers.length}/${plan.riverCount}개`
      : `하천 ${plan.riverCount}개`;

    return (
      <div
        key={key}
        role="treeitem"
        aria-expanded={single ? undefined : planOpen}
        aria-selected={planActive}
        className="border-b border-border"
      >
        <div
          className={cn(
            "group flex items-center",
            planActive && (single || !planOpen) ? "bg-primary/10" : "hover:bg-muted/50",
          )}
        >
          <button
            type="button"
            onClick={() => (single ? onSelectRiver(plan, rivers[0]!) : toggle(`p:${key}`, planOpen))}
            className={cn(ROW, "min-w-0 flex-1 pl-1.5")}
            title={single ? `${planTitle(plan)} · ${rivers[0]!.riverName}` : planTitle(plan)}
          >
            {single ? (
              <span className="size-3.5 shrink-0" aria-hidden />
            ) : planOpen ? (
              <ChevronDown className={CHEVRON} />
            ) : (
              <ChevronRight className={CHEVRON} />
            )}
            {planOpen ? (
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span
              className={cn("min-w-0 flex-1 truncate", planActive ? "font-medium text-primary" : "text-foreground")}
            >
              {showYear && plan.planYear ? (
                <span className="mr-1 text-[11px] font-normal tabular-nums text-muted-foreground">{plan.planYear}</span>
              ) : null}
              {planTitle(plan)}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{riverCountLabel}</span>
          </button>
          {folderKey && rootPdfs.length > 0 ? (
            <button
              type="button"
              onClick={() => onOpenReport(plan, folderKey, rootPdfs)}
              title="보고서 PDF 보기 (모든 하천 공통)"
              className="mr-1.5 inline-flex h-5 shrink-0 items-center rounded border border-border bg-background px-1.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              보고서
            </button>
          ) : null}
        </div>

        {planOpen ? (
          <div role="group" className="mb-1 ml-[21px] border-l border-border/70">
            {shownRivers.map((r) => {
              const active = planActive && selectedRiver === r.riverName;
              const matched = kw !== "" && r.riverName.toLowerCase().includes(kw);
              const len = formatKm(r.planLen);
              return (
                <button
                  key={r.riverName}
                  type="button"
                  role="treeitem"
                  aria-selected={active}
                  onClick={() => onSelectRiver(plan, r)}
                  className={cn(ROW, "pl-3", active ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted/50")}
                  title={r.riverName}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      !active && (matched ? "font-medium text-primary" : "text-foreground/90"),
                    )}
                  >
                    {r.riverName}
                  </span>
                  {len ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{len}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  if (yearLayout === "filter") {
    return (
      <div className="text-[12px]" role="tree" aria-label="보고서별 기본계획">
        {filteredPlans.map((plan) => renderPlan(plan, !year))}
      </div>
    );
  }

  return (
    <div className="py-1 text-[12px]" role="tree" aria-label="보고서별 기본계획">
      {years.map((y) => {
        const yearId = `y:${y.year}`;
        const yearOpen = isOpen(yearId, true);
        return (
          <div key={y.year} role="treeitem" aria-expanded={yearOpen} aria-selected={false}>
            <button
              type="button"
              onClick={() => toggle(yearId, yearOpen)}
              className={cn(ROW, "pl-2 font-semibold text-foreground hover:bg-muted/50")}
            >
              {yearOpen ? <ChevronDown className={CHEVRON} /> : <ChevronRight className={CHEVRON} />}
              <span>{riverBasicPlanYearLabel(y.year)}</span>
            </button>
            {yearOpen ? (
              <div role="group" className="ml-[15px] border-l border-border/70">
                {y.plans.map((plan) => renderPlan(plan, false))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
