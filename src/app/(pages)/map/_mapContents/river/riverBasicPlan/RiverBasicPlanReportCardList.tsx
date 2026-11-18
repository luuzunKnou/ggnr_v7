"use client";

import type { KeyboardEvent } from "react";
import { Files, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatRiverBasicPlanKm,
  riverBasicPlanPlanFolderKey,
  riverBasicPlanPlanKey,
  riverBasicPlanPlanLengthLabel,
  riverBasicPlanPlanTitle,
  riverBasicPlanShownRivers,
  riverBasicPlanYearLabel,
  type RiverBasicPlanReportFolderSummary,
  type RiverBasicPlanReportPlan,
  type RiverBasicPlanReportRiver,
} from "./riverBasicPlanReportPlans";

type Props = {
  plans: RiverBasicPlanReportPlan[];
  /** null이면 보고서 폴더 확인 중 */
  folderSummary: RiverBasicPlanReportFolderSummary | null;
  /** 고른 연도 — null이면 전체(카드에 연도 표시) */
  year: string | null;
  /** 하천 목록이 펼쳐진 카드 */
  openedPlanKey: string | null;
  /** 펼친 하천 목록이 차지할 수 있는 최대 높이(목록 영역) */
  riverListMaxPx?: number;
  /** 상세에서 보고 있는 계획·하천 */
  selectedPlanKey: string | null;
  selectedRiver: string;
  onOpenPlan: (plan: RiverBasicPlanReportPlan) => void;
  onSelectRiver: (plan: RiverBasicPlanReportPlan, river: RiverBasicPlanReportRiver) => void;
  onOpenReport: (plan: RiverBasicPlanReportPlan) => void;
};

/** 보고서 전체 PDF 수 — 보고서 폴더 바로 아래 + 하천별 폴더 */
function reportPdfCount(plan: RiverBasicPlanReportPlan, summary: RiverBasicPlanReportFolderSummary): number {
  const key = riverBasicPlanPlanFolderKey(plan);
  const folder = key ? summary[key] : undefined;
  if (!folder) return 0;
  return (
    folder.rootPdfs.length +
    Object.values(folder.riverPdfs ?? {}).reduce((n, names) => n + names.length, 0)
  );
}

const Dot = () => <span className="text-muted-foreground/40" aria-hidden>·</span>;

/**
 * 카드 아래로 펼치는 하천 목록.
 * 높이는 내용만큼 늘어나고, 목록 영역이 가득 차면 그 안에서 스크롤한다.
 */
function PlanRiverList({
  plan,
  selectedRiver,
  maxHeightPx,
  onSelectRiver,
}: {
  plan: RiverBasicPlanReportPlan;
  selectedRiver: string | null;
  /** 목록 패널에서 비어 보이지 않도록 잡아 둔 최대 높이. 0이면 패널 높이에 맞춤 */
  maxHeightPx: number;
  onSelectRiver: (river: RiverBasicPlanReportRiver) => void;
}) {
  const rivers = riverBasicPlanShownRivers(plan);
  return (
    <ul
      className="overflow-y-auto overscroll-contain rounded-b-md border border-t-0 border-primary/30 bg-background py-0.5"
      style={{ maxHeight: maxHeightPx > 0 ? maxHeightPx : "calc(100dvh - 16rem)" }}
    >
      {rivers.map((r) => {
        const active = selectedRiver === r.riverName;
        const len = formatRiverBasicPlanKm(r.planLen);
        return (
          <li key={r.riverName}>
            <button
              type="button"
              onClick={() => onSelectRiver(r)}
              className={cn(
                "group relative w-full py-1.5 pl-4 pr-3 text-left transition-colors",
                active ? "bg-primary/[0.08]" : "hover:bg-muted/50"
              )}
              title={r.riverName}
            >
              <span
                className={cn(
                  "absolute inset-y-1 left-1.5 w-[3px] rounded transition-colors",
                  active ? "bg-primary" : "bg-transparent group-hover:bg-primary/30"
                )}
                aria-hidden
              />
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "min-w-0 truncate text-xs font-medium",
                    active ? "text-primary" : "text-foreground"
                  )}
                >
                  {r.riverName}
                </span>
                {len ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{len}</span> : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 보고서별 — 보고서마다 한 줄 카드(보고서명 / 연도·합계연장·개소 / 보고서 아이콘).
 * 하천이 한 곳이어도 여러 곳이어도 누르면 카드 아래로 하천 목록이 펼쳐진다.
 */
export function RiverBasicPlanReportCardList({
  plans,
  folderSummary,
  year,
  openedPlanKey,
  riverListMaxPx = 0,
  selectedPlanKey,
  selectedRiver,
  onOpenPlan,
  onSelectRiver,
  onOpenReport,
}: Props) {
  const shown = year ? plans.filter((p) => p.planYear === year) : plans;

  return (
    <ul className="flex flex-col gap-1.5 p-2.5" aria-label="보고서별 기본계획">
      {shown.map((plan) => {
        const key = riverBasicPlanPlanKey(plan);
        const opened = openedPlanKey === key;
        const selected = selectedPlanKey === key;
        const title = riverBasicPlanPlanTitle(plan);
        const length = riverBasicPlanPlanLengthLabel(plan);
        const reportChecking = folderSummary == null;
        const pdfCount = folderSummary != null ? reportPdfCount(plan, folderSummary) : 0;
        const reportReady = pdfCount > 0;
        const open = () => onOpenPlan(plan);
        const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        };
        return (
          <li key={key}>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={opened}
              onClick={open}
              onKeyDown={onKey}
              title={title}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border py-2 pl-3 pr-2 outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring",
                opened && "rounded-b-none",
                opened
                  ? "border-primary/30 border-l-[3px] border-l-primary bg-primary/[0.11] pl-[10px] hover:bg-primary/[0.14] dark:bg-primary/20"
                  : selected
                    ? "border-primary/40 bg-background hover:bg-muted/50"
                    : "border-border bg-background hover:bg-muted/50"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold leading-5 text-foreground">{title}</p>
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
                  {!year && plan.planYear ? (
                    <>
                      <span>{riverBasicPlanYearLabel(plan.planYear)}</span>
                      <Dot />
                    </>
                  ) : null}
                  <span className="truncate">
                    {plan.riverCount > 1 ? "합계" : "연장"}{" "}
                    <span className="font-medium text-foreground/80">{length ?? "—"}</span>
                  </span>
                  <Dot />
                  <span className="shrink-0">
                    <span className="font-medium text-foreground/80">{plan.riverCount}</span>개소
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={!reportReady}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenReport(plan);
                }}
                title={
                  reportChecking
                    ? "보고서 확인 중"
                    : reportReady
                      ? `보고서 전체 PDF 보기 (${pdfCount}개)`
                      : "보고서 PDF 없음"
                }
                aria-label="보고서 전체"
                className={cn(
                  "inline-flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
                  "border-amber-300/70 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-950",
                  "dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60",
                  !reportReady && "cursor-not-allowed border-border bg-muted/40 text-muted-foreground/50 hover:bg-muted/40 hover:text-muted-foreground/50"
                )}
              >
                {reportChecking ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Files className="size-3.5" aria-hidden />
                )}
              </button>
            </div>
            {opened ? (
              <PlanRiverList
                plan={plan}
                maxHeightPx={riverListMaxPx}
                selectedRiver={selected ? selectedRiver : null}
                onSelectRiver={(r) => onSelectRiver(plan, r)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
